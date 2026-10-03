import { hedgePlugin } from "@fetchkit/ffetch/plugins/hedge";
import { createFfetchClient } from "./ffetch.js";
import { competitorAdapters } from "./competitors.js";
import type { RetryAdapter } from "./types.js";
export const hedgeAdapters: RetryAdapter[] = [
  { name: "ffetch", create(fetch, { timeoutMs }) {
    return createFfetchClient(fetch, { timeout: timeoutMs ?? 0,
      plugins: [hedgePlugin({ delay: 10, maxHedges: 1 })] });
  } },
  ...competitorAdapters.filter(adapter => ["@resili/fetch", "flowshield"].includes(adapter.name)).map(adapter => ({
    ...adapter, create: (fetch, options) => adapter.create(fetch, { ...options, combination: "hedge" }),
  } satisfies RetryAdapter)),
];
