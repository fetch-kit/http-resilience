import { dedupePlugin } from "@fetchkit/ffetch/plugins/dedupe";
import wretch from "wretch";
import { dedupe, retry } from "wretch/middlewares";
import { DedupManager, fetchWithRetry, getDedupKey } from "fetch-smartly";
import { createFetch } from "@resili/fetch";
import { dedupePolicy } from "@resili/core";
import type { PolicyFactory } from "@resili/core";
const logicalDedupe: PolicyFactory = {
  ...dedupePolicy, order: 150,
  create(services, options) { return { ...dedupePolicy.create(services, options), order: 150 }; },
};
import { createFfetchClient } from "./ffetch.js";
import type { RetryAdapter } from "./types.js";
export const dedupeAdapters: RetryAdapter[] = [
  { name: "ffetch", create(fetch, { retries, delayMs }) {
    return createFfetchClient(fetch, { retries, retryDelay: delayMs, plugins: [dedupePlugin()] });
  } },
  { name: "wretch", create(fetch, { retries, delayMs }) {
    const client = wretch().fetchPolyfill(fetch).middlewares([
      dedupe(), ...(retries ? [retry({ maxAttempts: retries, delayTimer: delayMs, delayRamp: () => delayMs,
        until: response => response?.status !== 503, resolveWithLatestResponse: true })] : []),
    ]);
    return (input, init) => client.url(String(input)).options(init ?? {}).get().res();
  } },
  { name: "fetch-smartly", globalFetch: true, create(_fetch, { retries, delayMs }) {
    const manager = new DedupManager();
    return (input, init) => {
      const key = getDedupKey("GET", String(input));
      return manager.get<string>(key) ?? manager.track(key, fetchWithRetry<string>({
        url: String(input), ...(init?.signal ? { signal: init.signal } : {}), timeout: 60_000,
        retry: { maxRetries: retries, baseDelay: delayMs, maxDelay: delayMs, backoffFactor: 1, jitter: false, retryOn: [503] },
      }));
    };
  } },
  { name: "@resili/fetch", create(fetch, { retries, delayMs }) {
    const client = createFetch({ fetch, policies: [{ factory: logicalDedupe, options: { key: () => "same-resource", abortSharedWhenUnused: true } }],
      retry: { maxAttempts: retries + 1, backoff: "fixed", baseDelayMs: delayMs } });
    return Object.assign((input: RequestInfo | URL, init?: RequestInit) => client(input, init), { dispose: () => client.destroy() });
  } },
];
