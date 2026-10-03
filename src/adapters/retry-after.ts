import ky from "ky";
import { createFetchClient } from "resilient-fetch-client";
import { fetchWithRetry } from "fetch-smartly";
import { createFetch } from "@resili/fetch";
import { createFfetchClient } from "./ffetch.js";
import type { RetryAdapter } from "./types.js";
export const retryAfterAdapters: RetryAdapter[] = [
  { name: "ffetch", create(fetch) { return createFfetchClient(fetch, { retries: 1 }); } },
  { name: "ky", create(fetch) {
    const client = ky.create({ fetch, timeout: false, retry: { limit: 1, statusCodes: [503],
      afterStatusCodes: [503], maxRetryAfter: 1_000, delay: () => 50, jitter: false } });
    return (input, init) => client(input, init);
  } },
  { name: "resilient-fetch-client", create(fetch) {
    const client = createFetchClient({ fetch, retries: { maxRetries: 1, initialDelay: 50, maxDelay: 50, exponent: 1 } });
    return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => (await client).fetch(input, init), {
      ready: client.then(() => undefined), dispose: async () => { await (await client).close({ timeout: 0 }); },
    });
  } },
  { name: "fetch-smartly", globalFetch: true, create() {
    return (input, init) => fetchWithRetry<string>({ url: String(input), ...(init?.signal ? { signal: init.signal } : {}),
      timeout: 60_000, retry: { maxRetries: 1, baseDelay: 50, maxDelay: 1_000, jitter: false, retryOn: [429] } });
  } },
  { name: "@resili/fetch", create(fetch) {
    const client = createFetch({ fetch, retry: { maxAttempts: 2, backoff: "fixed", baseDelayMs: 50,
      maxDelayMs: 1_000, respectRetryAfter: true } });
    return Object.assign((input: RequestInfo | URL, init?: RequestInit) => client(input, init), { dispose: () => client.destroy() });
  } },
];
