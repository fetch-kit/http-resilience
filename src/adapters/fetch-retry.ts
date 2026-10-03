import fetchRetry from "fetch-retry";
import type { RetryAdapter } from "./types.js";

export const fetchRetryAdapter: RetryAdapter = {
  name: "fetch-retry",
  create(fetch, { retries, delayMs }) {
    return fetchRetry(fetch, {
      retries,
      retryDelay: delayMs,
      retryOn: [503],
    });
  },
};
