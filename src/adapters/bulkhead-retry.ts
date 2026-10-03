import { bulkheadPlugin } from "@fetchkit/ffetch/plugins/bulkhead";
import { createFfetchClient } from "./ffetch.js";
import { competitorAdapters } from "./competitors.js";
import type { RetryAdapter } from "./types.js";
export const bulkheadRetryAdapters: RetryAdapter[] = [
  { name: "ffetch", create(fetch, { retries, delayMs }) {
    return createFfetchClient(fetch, { retries, retryDelay: delayMs, throwOnHttpError: true,
      plugins: [bulkheadPlugin({ maxConcurrent: 1, maxQueue: 1 })] });
  } },
  ...competitorAdapters.filter(adapter => ["resilient-fetch-client", "@resili/fetch", "fetch-resilience", "flowshield"].includes(adapter.name)).map(adapter => ({
    ...adapter, create: (fetch, options) => adapter.create(fetch, { ...options, combination: "bulkhead" }),
  } satisfies RetryAdapter)),
];
