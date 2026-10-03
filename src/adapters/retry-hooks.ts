import ky from "ky";
import fetchRetry from "fetch-retry";
import { createFetch as createOfetch } from "ofetch";
import wretch from "wretch";
import { retry as wretchRetry } from "wretch/middlewares";
import { fetchWithRetry } from "fetch-smartly";
import { createFetch as createResiliFetch } from "@resili/fetch";
import * as flow from "flowshield";
import { CircuitBreaker, createCircuitFetch } from "ts-retry-circuit";
import { createFfetchClient } from "./ffetch.js";
import { HttpStatusError } from "./competitors.js";
import type { FetchImplementation, RequestClient } from "./types.js";
export const hookProfiles = [
  { name: "ffetch", variants: ["predicate", "callback", "async-callback"] },
  { name: "ky", variants: ["predicate", "async-predicate", "callback", "async-callback"] },
  { name: "fetch-retry", variants: ["predicate", "async-predicate"] },
  { name: "ofetch", variants: ["delay", "callback", "async-callback"] },
  { name: "wretch", variants: ["predicate", "async-predicate", "callback", "async-callback"] },
  { name: "fetch-smartly", variants: ["predicate", "callback"], globalFetch: true },
  { name: "@resili/fetch", variants: ["predicate"] },
  { name: "flowshield", variants: ["predicate", "callback"] },
  { name: "ts-retry-circuit", variants: ["predicate"], globalFetch: true },
];
export function hookClient(name: string, fetch: FetchImplementation, variant: string, sentinel: Error): RequestClient {
  let armed = true;
  const bomb = () => { if (armed) { armed = false; throw sentinel; } return false; };
  const asyncBomb = async () => bomb();
  const callback = variant.startsWith("async") ? asyncBomb : bomb;
  switch (name) {
    case "ffetch": return createFfetchClient(fetch, {
      retries: 2, retryDelay: 20,
      ...(variant === "predicate" ? { shouldRetry: bomb } : { hooks: { onRetry: async () => { await callback(); } } }),
    });
    case "ky": {
      const client = ky.create({ fetch, timeout: false,
        retry: { limit: 2, statusCodes: [503], delay: () => 20,
          ...(variant.includes("predicate") ? { shouldRetry: callback } : {}) },
        ...(variant.includes("callback") ? { hooks: { beforeRetry: [async () => { await callback(); }] } } : {}),
      });
      return (input, init) => client(input, init);
    }
    case "fetch-retry": return fetchRetry(fetch, { retries: 2, retryDelay: 20, retryOn: callback });
    case "ofetch": {
      const client = createOfetch({ fetch });
      return (input, init) => client.raw(input instanceof URL ? String(input) : input, { ...init,
        responseType: "stream", retry: 2, retryStatusCodes: [503],
        retryDelay: variant === "delay" ? () => { bomb(); return 20; } : 20,
        ...(variant.includes("callback") ? { onResponseError: async () => { await callback(); } } : {}),
      });
    }
    case "wretch": {
      const client = wretch().fetchPolyfill(fetch).middlewares([wretchRetry({ maxAttempts: 2, delayTimer: 20,
        ...(variant.includes("predicate") ? { until: async () => { await callback(); return true; } }
          : { until: response => response?.ok ?? false, onRetry: async () => { await callback(); } }),
      })]);
      return (input, init) => client.url(String(input)).options(init ?? {}).get().res();
    }
    case "fetch-smartly": return (input, init) => fetchWithRetry<string>({ url: String(input), ...init,
      ...(init?.signal ? { signal: init.signal } : {}), timeout: 60_000,
      retry: { maxRetries: 2, baseDelay: 20, jitter: false, ...(variant === "predicate" ? { shouldRetry: bomb } : {}) },
      ...(variant === "callback" ? { onRetry: bomb } : {}),
    } as Parameters<typeof fetchWithRetry<string>>[0]);
    case "@resili/fetch": {
      const client = createResiliFetch({ fetch, retry: { maxAttempts: 3, baseDelayMs: 20, retryOn: bomb } });
      return Object.assign((input: RequestInfo | URL, init?: RequestInit) => client(input, init), { dispose: () => client.destroy() });
    }
    case "flowshield": return (input, init) => flow.retry({ maxAttempts: 3, delay: 20,
      ...(variant === "predicate" ? { shouldRetry: bomb } : { onRetry: bomb }),
    })(async () => { const response = await fetch(input, init); if (!response.ok) throw new HttpStatusError(response); return response; });
    case "ts-retry-circuit": return createCircuitFetch(new CircuitBreaker({
      failureThreshold: 1, cooldownPeriod: 1_000, maxRetries: 2, initialRetryDelay: 20, isExpectedError: bomb,
    }));
    default: throw new Error("Unknown hook profile: " + name);
  }
}
