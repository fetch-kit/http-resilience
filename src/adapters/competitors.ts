import { createFetch as createOfetch } from "ofetch";
import wretch from "wretch";
import { retry as wretchRetry } from "wretch/middlewares";
import AbortAddon from "wretch/addons/abort";
import { createFetchClient } from "resilient-fetch-client";
import { fetchWithRetry } from "fetch-smartly";
import type { HttpMethod } from "fetch-smartly";
import { createFetch as createResiliFetch } from "@resili/fetch";

import * as resilience from "fetch-resilience";
import * as flow from "flowshield";
import { CircuitBreaker, createCircuitFetch } from "ts-retry-circuit";
import type { RetryAdapter, FetchImplementation, RequestClient } from "./types.js";

// Generic policies require the operation to classify unsuccessful HTTP responses.
export class HttpStatusError extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super("HTTP " + response.status);
    this.name = "HttpStatusError";
    this.response = response;
  }
}
async function classified(fetch: FetchImplementation, input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!response.ok) throw new HttpStatusError(response);
  return response;
}
export const competitorAdapters: RetryAdapter[] = [
  {
    name: "ofetch",
    create(fetch, { retries, delayMs, timeoutMs }) {
      const client = createOfetch({ fetch });
      return (input, init) => client.raw(input instanceof URL ? input.toString() : input, {
        ...init, retry: retries, retryDelay: delayMs, retryStatusCodes: [503],
        responseType: "stream", ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
      });
    },
  },
  {
    name: "wretch",
    create(fetch, { retries, delayMs, timeoutMs }) {
      const client = wretch().fetchPolyfill(fetch).addon(AbortAddon());
      // maxAttempts=0 means infinite retries in this middleware: omit it for zero retries.
      const configured = retries === 0 ? client : client.middlewares([wretchRetry({
        maxAttempts: retries, delayTimer: delayMs, delayRamp: () => delayMs,
        until: response => response?.status !== 503, resolveWithLatestResponse: true,
      })]);
      return (input, init) => {
        const chain = configured.url(String(input)).options(init ?? {}).fetch(init?.method ?? "GET");
        return timeoutMs === undefined ? chain.res() : chain.setTimeout(timeoutMs).res();
      };
    },
  },
  {
    name: "resilient-fetch-client",
    create(fetch, { retries, delayMs, timeoutMs, combination, retryPosts }) {
      const client = createFetchClient({
        fetch, consoleLogHttpIssues: false,
        retries: { maxRetries: retries, initialDelay: delayMs, maxDelay: delayMs, exponent: 1, retryPosts: retryPosts ?? false, retryStatusCodes: [503] },
        ...(timeoutMs === undefined ? {} : { timeoutRequest: timeoutMs }),
        ...(combination === "bulkhead" ? { parallelRequests: { maxParallelRequests: 1, maxQueuedRequests: 1 } } : {}),
      });
      const request: RequestClient = async (input, init) => (await client).fetch(input, init);
      request.ready = client.then(() => undefined);
      request.dispose = async () => { await (await client).close({ timeout: 0 }); };
      return request;
    },
  },
  {
    name: "fetch-smartly", globalFetch: true,
    create(_fetch, { retries, delayMs, timeoutMs }) {
      return (input, init) => {
        const { signal, method, ...fetchInit } = init ?? {};
        return fetchWithRetry<string>({
        ...fetchInit, url: String(input), method: (method ?? "GET") as HttpMethod,
        ...(signal ? { signal } : {}),
        timeout: timeoutMs ?? 60_000,
        retry: { maxRetries: retries, baseDelay: delayMs, maxDelay: delayMs, backoffFactor: 1, jitter: false, retryOn: [503] },
        });
      };
    },
  },
  {
    name: "@resili/fetch",
    create(fetch, { retries, delayMs, timeoutMs, combination }) {

      const options = {
        fetch,
        // A one-attempt retry policy deliberately exercises its zero-retry contract.
        retry: { maxAttempts: retries + 1, backoff: "fixed" as const, baseDelayMs: delayMs, maxDelayMs: delayMs, jitter: "none" as const },
        ...(timeoutMs === undefined ? {} : { timeout: { perAttemptMs: timeoutMs } }),
        ...(combination === "bulkhead" ? { bulkhead: { maxConcurrent: 1, maxQueue: 1 } } : {}),
        ...(combination === "circuit-hedge" ? { circuitBreaker: {
          window: { type: "count" as const, size: 1 }, minimumThroughput: 1,
          failureRateThreshold: 100, resetTimeoutMs: 1_000, key: "shared-circuit",
        } } : {}),
      };
      const client = createResiliFetch({
        ...options,
        ...(["hedge", "circuit-hedge"].includes(combination ?? "") ? { hedge: { delay: 10, shouldAccept: (response: Response) => response.ok, abortLosers: true } } : {}),
      });
      const request: RequestClient = (input, init) => client(input, init);
      request.dispose = () => client.destroy();
      return request;
    },
  },
  {
    name: "fetch-resilience",
    create(fetch, { retries, delayMs, timeoutMs, combination }) {
      const policies: resilience.Policy<Response>[] = [
        resilience.retry({ attempts: retries, backoff: "fixed", delayMs, jitter: false, retryOn: [503] }),
      ];
      if (combination === "bulkhead") policies.push(resilience.bulkhead({ maxConcurrent: 1, maxQueue: 1 }));
      if (timeoutMs !== undefined) policies.push(resilience.timeout({ ms: timeoutMs }));
      return resilience.wrap(fetch, policies);
    },
  },
  {
    name: "flowshield",
    create(fetch, { retries, delayMs, timeoutMs, combination }) {
      const bulkhead = combination === "bulkhead" ? flow.bulkhead({ maxConcurrent: 1, maxQueue: 1 }) : undefined;
      const circuit = combination === "circuit-hedge" ? flow.circuitBreaker({ failureThreshold: 1, resetTimeout: 1_000 }) : undefined;
      return (input, init) => {
        let operation = () => classified(fetch, input, init);
        if (["hedge", "circuit-hedge"].includes(combination ?? "") && init?.method !== "POST") {
          const inner = operation;
          operation = () => flow.hedge({ hedgeDelay: 10 })(inner);
        }
        if (circuit) { const inner = operation; operation = () => circuit.execute(inner); }
        if (bulkhead) { const inner = operation; operation = () => bulkhead.execute(inner); }
        if (timeoutMs !== undefined) { const inner = operation; operation = () => flow.timeout({ ms: timeoutMs })(inner); }
        // No retry policy when disabled, preserving the underlying operation's exact error.
        return retries === 0 ? operation() : flow.retry({
          maxAttempts: retries + 1, delay: delayMs, backoff: "constant", ...(init?.signal ? { signal: init.signal } : {}),
        })(operation);
      };
    },
  },
  {
    name: "ts-retry-circuit", globalFetch: true,
    create(_fetch, { retries, delayMs, timeoutMs }) {
      const breaker = new CircuitBreaker({
        failureThreshold: 100, cooldownPeriod: 1_000, maxRetries: retries, initialRetryDelay: delayMs,
        ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
      });
      return createCircuitFetch(breaker);
    },
  },
];
