import { ffetchAdapter } from "./ffetch.js";
import { kyAdapter } from "./ky.js";
import { fetchRetryAdapter } from "./fetch-retry.js";

export const retryAdapters = [ffetchAdapter, kyAdapter, fetchRetryAdapter];
export { competitorAdapters } from "./competitors.js";
