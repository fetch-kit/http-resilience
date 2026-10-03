import type { SmartFetchResponse } from "fetch-smartly";

export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ClientResult = Response | SmartFetchResponse<string>;
export type RequestClient = ((input: RequestInfo | URL, init?: RequestInit) => Promise<ClientResult>) & { ready?: Promise<void>; dispose?: () => Promise<void> | void };
export interface RetryOptions {
  retries: number;
  retryPosts?: boolean;
  delayMs: number;
  timeoutMs?: number;
  combination?: "bulkhead" | "hedge" | "circuit-hedge";
}
export interface RetryAdapter {
  name: string;
  globalFetch?: boolean;
  create(fetch: FetchImplementation, options: RetryOptions): RequestClient;
}
export function readBody(result: ClientResult): Promise<string> {
  return result instanceof Response ? result.text() : Promise.resolve(result.data);
}
