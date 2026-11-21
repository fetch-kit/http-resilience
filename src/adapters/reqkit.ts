import { createFetch } from "@boy-offi9-inc/reqkit";
import type { RetryAdapter } from "./types.js";

// reqkit adapter: createFetch wires retry + timeout + the caller's signal into
// every attempt. Throwing on non-2xx comes from throwHttpErrors (default true),
// which yields HTTPError with the response attached — the harness classifies
// via expectHttpOutcome below.
export const reqkitAdapter: RetryAdapter = {
  name: "reqkit",
  create(fetch, { retries, delayMs, timeoutMs, retryPosts }) {
    const client = createFetch({
      fetch,
      retry: {
        retries,
        baseDelayMs: delayMs,
        maxDelayMs: delayMs,
        factor: 1,
        jitter: 0,
        // Matrix determinism: never wait longer than the scripted delay.
        maxRetryAfterMs: delayMs,
        ...(retryPosts ? { methods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "POST"] } : {}),
      },
      timeout: timeoutMs ?? false,
      throwHttpErrors: true,
      dedupe: false,
    });
    return (input, init) =>
      input instanceof Request
        ? client(input.url, { method: input.method, headers: input.headers, body: input.body ?? undefined, duplex: "half", ...(init as object) } as never)
        : client(input instanceof URL ? input.toString() : String(input), init ?? {});
  },
};
