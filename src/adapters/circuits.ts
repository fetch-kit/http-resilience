import { circuitPlugin } from "@fetchkit/ffetch/plugins/circuit";
import { createFetchClient } from "resilient-fetch-client";
import { BrokenCircuitError } from "cockatiel";
import { createFetch } from "@resili/fetch";
import { CircuitOpenError as ResiliCircuitOpenError } from "@resili/core";
import * as resilience from "fetch-resilience";
import * as flow from "flowshield";
import { CircuitBreaker as TsCircuit, createCircuitFetch, CircuitOpenError as TsCircuitOpenError } from "ts-retry-circuit";
import { CircuitBreaker as SmartCircuit, CircuitOpenError as SmartCircuitOpenError, fetchWithRetry } from "fetch-smartly";
import { CircuitOpenError as FfetchCircuitOpenError } from "@fetchkit/ffetch";
import { createFfetchClient } from "./ffetch.js";
import { HttpStatusError } from "./competitors.js";
import type { RetryAdapter, RequestClient } from "./types.js";

export const circuitProfiles = [
  { name: "ffetch", accounting: "logical", probes: "unbounded", abortCounts: false, error: FfetchCircuitOpenError },
  { name: "resilient-fetch-client", accounting: "attempt", probes: "queued", abortCounts: false, error: BrokenCircuitError },
  { name: "@resili/fetch", accounting: "attempt", probes: "one", abortCounts: false, error: ResiliCircuitOpenError },
  { name: "fetch-resilience", accounting: "logical", probes: "unbounded", abortCounts: true, error: resilience.CircuitOpenError },
  { name: "flowshield", accounting: "logical", probes: "unbounded", abortCounts: true, error: flow.CircuitOpenError },
  { name: "ts-retry-circuit", accounting: "logical", probes: "one", abortCounts: false, error: TsCircuitOpenError },
  { name: "fetch-smartly", accounting: "logical", probes: "one", abortCounts: true, error: SmartCircuitOpenError },
] as const;
export function circuitAdapter(name: string, threshold = 2, resetMs = 1_000): RetryAdapter {
  return { name, globalFetch: ["fetch-smartly", "ts-retry-circuit"].includes(name), create(fetch, { retries, delayMs }) {
    switch (name) {
      case "ffetch": {
        const warmup = createFfetchClient(async () => new Response("busy", { status: 503 }), { throwOnHttpError: true });
        const client: RequestClient = createFfetchClient(fetch, { retries, retryDelay: delayMs, throwOnHttpError: true,
          plugins: [circuitPlugin({ threshold, reset: resetMs })] });
        client.ready = warmup("https://example.test/warmup").then(() => undefined, () => undefined);
        return client;
      }
      case "resilient-fetch-client": {
        const client = createFetchClient({ fetch,
          retries: { maxRetries: retries, initialDelay: delayMs, maxDelay: delayMs, exponent: 1 },
          circuitBreaker: { openAfterFailedAttempts: threshold, halfOpenAfter: resetMs },
        });
        return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => (await client).fetch(input, init), {
          ready: client.then(() => undefined), dispose: async () => { await (await client).close({ timeout: 0 }); },
        });
      }
      case "@resili/fetch": {
        const client = createFetch({ fetch,
          ...(retries ? { retry: { maxAttempts: retries + 1, backoff: "fixed" as const, baseDelayMs: delayMs } } : {}),
          circuitBreaker: { window: { type: "count", size: threshold }, minimumThroughput: threshold,
            failureRateThreshold: 100, resetTimeoutMs: resetMs, halfOpenMaxCalls: 1 },
        });
        return Object.assign((input: RequestInfo | URL, init?: RequestInit) => client(input, init), { dispose: () => client.destroy() });
      }
      case "fetch-resilience": {
        const circuit = resilience.circuitBreaker({ threshold, halfOpenAfter: resetMs });
        const retry = resilience.retry({ attempts: retries, delayMs });
        return (input, init) => circuit.execute(() => retry.execute(async () => {
          const response = await fetch(input, init);
          if (!response.ok) throw new HttpStatusError(response);
          return response;
        }));
      }
      case "flowshield": {
        const circuit = flow.circuitBreaker({ failureThreshold: threshold, resetTimeout: resetMs });
        return (input, init) => circuit.execute(() => {
          const operation = async () => {
            const response = await fetch(input, init);
            if (!response.ok) throw new HttpStatusError(response);
            return response;
          };
          return retries ? flow.retry({ maxAttempts: retries + 1, delay: delayMs, backoff: "constant",
            ...(init?.signal ? { signal: init.signal } : {}) })(operation) : operation();
        });
      }
      case "ts-retry-circuit": return createCircuitFetch(new TsCircuit({
        failureThreshold: threshold, cooldownPeriod: resetMs, maxRetries: retries, initialRetryDelay: delayMs,
      }));
      case "fetch-smartly": {
        const circuit = new SmartCircuit({ enabled: true, failureThreshold: threshold, resetTimeout: resetMs, halfOpenMaxAttempts: 1 });
        return async (input, init) => {
          circuit.allowRequest(String(input), "GET");
          try {
            const result = await fetchWithRetry<string>({ url: String(input),
              ...(init?.signal ? { signal: init.signal } : {}), timeout: 60_000,
              retry: { maxRetries: retries, baseDelay: delayMs, maxDelay: delayMs, backoffFactor: 1, jitter: false, retryOn: [503] } });
            circuit.onSuccess(); return result;
          } catch (error) { circuit.onFailure(); throw error; }
        };
      }
      default: throw new Error("Unknown circuit: " + name);
    }
  } };
}
