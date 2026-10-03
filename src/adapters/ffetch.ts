import { createClient } from "@fetchkit/ffetch";
import type { ClientPlugin, FFetchOptions } from "@fetchkit/ffetch";

type ClientOptions = Omit<FFetchOptions, "plugins"> & {
  plugins?: readonly ClientPlugin<Record<PropertyKey, unknown>>[];
};
import type { FetchImplementation, RetryAdapter } from "./types.js";

export function createFfetchClient(
  fetch: FetchImplementation,
  options: ClientOptions = {},
) {
  // 5.7.1's declarations require an index signature on undecorated plugin
  // promises. Bridge that declaration mismatch only; runtime plugins are unchanged.
  return createClient({
    timeout: 0,
    retries: 0,
    ...options,
    fetchHandler: fetch,
  } as FFetchOptions);
}

export const ffetchAdapter: RetryAdapter = {
  name: "ffetch",
  create(fetch, { retries, delayMs }) {
    return createFfetchClient(fetch, {
      retries,
      retryDelay: delayMs,
      throwOnHttpError: true,
      shouldRetry: ({ response, error }) =>
        response?.status === 503 || error !== undefined,
    });
  },
};
