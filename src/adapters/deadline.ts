import ky from "ky";
import wretch from "wretch";
import AbortAddon from "wretch/addons/abort";
import { retry as wretchRetry } from "wretch/middlewares";
import { createFetchClient } from "resilient-fetch-client";
import * as resilience from "fetch-resilience";
import * as flow from "flowshield";
import { createFfetchClient } from "./ffetch.js";
import { HttpStatusError } from "./competitors.js";
import type { RetryAdapter } from "./types.js";
export const deadlineAdapters: RetryAdapter[] = [
  { name: "ffetch", create(fetch, { delayMs }) {
    return createFfetchClient(fetch, { timeout: 100, retries: 1, retryDelay: delayMs });
  } },
  { name: "ky", create(fetch, { delayMs }) {
    const client = ky.create({ fetch, timeout: false, totalTimeout: 100,
      retry: { limit: 1, methods: ["get"], statusCodes: [503], delay: () => delayMs, jitter: false } });
    return (input, init) => client(input, init);
  } },
  { name: "wretch", create(fetch, { delayMs }) {
    const client = wretch().fetchPolyfill(fetch).addon(AbortAddon()).middlewares([wretchRetry({
      maxAttempts: 1, delayTimer: delayMs, delayRamp: () => delayMs,
      until: response => response?.status !== 503, resolveWithLatestResponse: true,
    })]);
    return (input, init) => client.url(String(input)).options(init ?? {}).get().setTimeout(100).res();
  } },
  { name: "resilient-fetch-client", create(fetch, { delayMs }) {
    const client = createFetchClient({ fetch, timeoutTotal: 100,
      retries: { maxRetries: 1, initialDelay: delayMs, maxDelay: delayMs, exponent: 1 } });
    return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => (await client).fetch(input, init), {
      ready: client.then(() => undefined), dispose: async () => { await (await client).close({ timeout: 0 }); },
    });
  } },
  { name: "fetch-resilience", create(fetch, { delayMs }) {
    return resilience.wrap(fetch, [resilience.timeout({ ms: 100 }), resilience.retry({ attempts: 1, delayMs })]);
  } },
  { name: "flowshield", create(fetch, { delayMs }) {
    return (input, init) => flow.timeout({ ms: 100 })(() => flow.retry({
      maxAttempts: 2, delay: delayMs, backoff: "constant",
    })(async () => {
      const response = await fetch(input, init);
      if (response.status === 503) throw new HttpStatusError(response);
      return response;
    }));
  } },
];
