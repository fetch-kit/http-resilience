import ky from "ky";
import type { RetryAdapter } from "./types.js";

export const kyAdapter: RetryAdapter = {
  name: "ky",
  create(fetch, { retries, delayMs, timeoutMs, retryPosts }) {
    const client = ky.create({
      fetch,
      timeout: timeoutMs ?? false,
      retry: {
        limit: retries,
        methods: ["get", ...(retryPosts ? ["post"] : [])],
        statusCodes: [503],
        delay: () => delayMs,
        jitter: false,
      },
    });
    return (input, init) => client(input, init);
  },
};
