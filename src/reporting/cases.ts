export const libraries = [
  { id: "ffetch", package: "@fetchkit/ffetch" },
  { id: "ky", package: "ky" },
  { id: "fetch-retry", package: "fetch-retry" },
  { id: "ofetch", package: "ofetch" },
  { id: "wretch", package: "wretch" },
  { id: "resilient-fetch-client", package: "resilient-fetch-client" },
  { id: "fetch-smartly", package: "fetch-smartly" },
  { id: "@resili/fetch", package: "@resili/fetch" },
  { id: "fetch-resilience", package: "fetch-resilience" },
  { id: "flowshield", package: "flowshield" },
  { id: "ts-retry-circuit", package: "ts-retry-circuit" },
] as const;

export const scenarios = [
  { id: "retry-recovery", title: "Retry recovery", description: "Two 503 responses followed by a successful third attempt." },
  { id: "retry-exhaustion", title: "Retry exhaustion", description: "Repeated 503 responses exhaust the retry budget." },
  { id: "retry-disabled", title: "Zero retries", description: "A zero retry budget permits exactly one attempt." },
  { id: "retry-backoff-abort", title: "Retry + abort during backoff", description: "Cancel during backoff, drain timers, then make a healthy request." },
  { id: "bulkhead-queued-abort", title: "Bulkhead + queued abort", description: "Cancel a queued request and admit its replacement." },
  { id: "hedge-stream-winner", title: "Hedge + streaming body", description: "The hedge wins while the primary hangs; consume the winning stream." },
  { id: "circuit-hedge", title: "Circuit + hedge accounting", description: "A failed primary loses to a healthy hedge; then deliberately trip the circuit." },
  { id: "http-retry", title: "Retry over real HTTP", description: "Native fetch receives two 503 responses before recovery." },
  { id: "http-timeout", title: "Timeout over real HTTP", description: "Headers exceed the deadline; verify the error and healthy follow-up." },
  {"id":"retry-total-timeout","title":"Retry + total timeout","description":"Deadline expires during backoff or the second attempt."},
  {"id":"retry-body-replay","title":"Retry + body replay","description":"Consume POST payload before returning 503, then retry."},
  {"id":"retry-after-abort","title":"Retry-After + abort","description":"Seconds/date/malformed/large Retry-After values, then cancellation during the advertised wait."},
  {"id":"retry-hook-error","title":"Retry + throwing hooks","description":"Retry predicate, delay or callback throws/rejects a unique sentinel."},
  {"id":"hedge-all-fail","title":"Hedge + all branches fail","description":"Distinct primary/hedge errors finish in both possible orders."},
  {"id":"hedge-timeout","title":"Hedge + timeout","description":"Both branches hang; timeout before, at or after hedge launch."},
  {"id":"dedupe-retry","title":"Dedupe + retry","description":"Four callers share two failures and a streamed success."},
  {"id":"dedupe-caller-abort","title":"Dedupe + caller cancellation","description":"Cancel follower, owner or every subscriber."},
  {"id":"bulkhead-retry","title":"Bulkhead + retry","description":"A failed request backs off while another caller waits; repeat through exhaustion."},
  {"id":"circuit-retry-accounting","title":"Circuit + retry accounting","description":"Trip a threshold-two circuit using exhausted retry sequences."},
  {"id":"circuit-half-open-concurrency","title":"Circuit + half-open concurrency","description":"Concurrent probes at reset, failed-probe recovery and stale success after reopening."},
  {"id":"circuit-local-cancellation","title":"Circuit + local cancellation","description":"Caller aborts during fetch and retry backoff; verify health accounting and recovery."},
] as const;

export type ScenarioId = typeof scenarios[number]["id"];
export type LibraryId = typeof libraries[number]["id"];

export interface CaseDefinition {
  scenarioId: ScenarioId;
  libraryId: LibraryId;
  configuration: string;
  expected: string;
  traceFile?: string;
  notApplicable?: string;
}

const httpContracts: Record<LibraryId, string> = {
  ffetch: "Exact HttpError; cause is a 503 Response with the original body",
  ky: "Exact HTTPError; response.status is 503",
  "fetch-retry": "Return the final 503 Response with the original body",
  ofetch: "Exact FetchError; status is 503",
  wretch: "Exact WretchError constructor; status 503",
  "resilient-fetch-client": "Exact HttpError; cause responseStatus; details.status 503",
  "fetch-smartly": "Exact HttpError; status 503 and original error body",
  "@resili/fetch": "Exact RetryExceededError; ERR_RETRY_EXCEEDED; attempts and identical cause/lastError",
  "fetch-resilience": "Return the final 503 Response with the original body",
  flowshield: "Exact RetryExhaustedError with attempts and HttpStatusError cause carrying response.status 503; with zero retries, exact underlying HttpStatusError",
  "ts-retry-circuit": "Exact Error constructor and HTTP 503 message from createCircuitFetch",
};
const abortContracts: Record<LibraryId, string> = {
  ffetch: "Exact AbortError",
  ky: "Exact DOMException, identical caller abort reason",
  "fetch-retry": "Exact DOMException, identical caller abort reason",
  ofetch: "Exact FetchError with caller abort reason as cause",
  wretch: "Exact DOMException, identical caller abort reason",
  "resilient-fetch-client": "Exact DOMException, identical caller abort reason",
  "fetch-smartly": "Exact DOMException, identical caller abort reason",
  "@resili/fetch": "Exact DOMException, identical caller abort reason forwarded by the fetch adapter",
  "fetch-resilience": "Exact DOMException, identical caller abort reason",
  flowshield: "Exact DOMException, identical caller abort reason",
  "ts-retry-circuit": "Exact CircuitAbortedError, CIRCUIT_ABORTED",
};
const timeoutContracts: Partial<Record<LibraryId, string>> = {
  ffetch: "Exact TimeoutError",
  ky: "Exact TimeoutError",
  ofetch: "Exact FetchError; exact Error cause named TimeoutError with code 23",
  wretch: "Exact DOMException named AbortError from AbortAddon.setTimeout",
  "resilient-fetch-client": "Exact Cockatiel TaskCancelledError identifying timeout",
  "fetch-smartly": "Exact TimeoutError with timeout 100",
  "@resili/fetch": "Exact RetryExceededError (1 attempt); cause is exact TimeoutError, ERR_TIMEOUT, timeoutMs 100",
  "fetch-resilience": "Exact TimeoutError",
  flowshield: "Exact TimeoutError",
  "ts-retry-circuit": "Exact CircuitTimeoutError, CIRCUIT_TIMEOUT, timeoutMs 100",
};
function notApplicable(library: LibraryId, scenario: ScenarioId): string | undefined {
  if (scenario === "circuit-local-cancellation" && !["ffetch","resilient-fetch-client","@resili/fetch","fetch-resilience","flowshield","ts-retry-circuit","fetch-smartly"].includes(library)) return "No circuit breaker policy/helper is offered.";
  if (scenario === "circuit-half-open-concurrency" && !["ffetch","resilient-fetch-client","@resili/fetch","fetch-resilience","flowshield","ts-retry-circuit","fetch-smartly"].includes(library)) return "No circuit breaker policy/helper is offered.";
  if (scenario === "circuit-retry-accounting" && !["ffetch","resilient-fetch-client","@resili/fetch","fetch-resilience","flowshield","ts-retry-circuit","fetch-smartly"].includes(library)) return "No circuit breaker policy/helper is offered.";
  if (scenario === "bulkhead-retry" && !["ffetch","resilient-fetch-client","@resili/fetch","fetch-resilience","flowshield"].includes(library)) return "No queued bulkhead is exposed; immediate capacity rejection is a different contract.";
  if (scenario === "dedupe-caller-abort" && !["ffetch","wretch","fetch-smartly","@resili/fetch"].includes(library)) return "No request deduplication policy/helper is offered.";
  if (scenario === "dedupe-retry" && !["ffetch","wretch","fetch-smartly","@resili/fetch"].includes(library)) return "No request deduplication policy/helper is offered.";
  if (scenario === "hedge-timeout" && !["ffetch","@resili/fetch","flowshield"].includes(library)) return "No hedging policy is offered.";
  if (scenario === "hedge-all-fail" && !["ffetch","@resili/fetch","flowshield"].includes(library)) return "No hedging policy is offered.";
  if (scenario === "retry-hook-error" && !["ffetch","ky","fetch-retry","ofetch","wretch","fetch-smartly","@resili/fetch","flowshield","ts-retry-circuit"].includes(library)) return "No configurable retry predicate, delay function or retry callback is exposed.";
  if (scenario === "retry-after-abort" && !["ffetch","ky","resilient-fetch-client","fetch-smartly","@resili/fetch"].includes(library)) return "No Retry-After handling is offered by this package.";
  if (scenario === "retry-body-replay" && !["ffetch","ky","fetch-retry","ofetch","wretch","resilient-fetch-client","fetch-smartly","@resili/fetch","fetch-resilience","flowshield","ts-retry-circuit"].includes(library)) return "No POST retry support.";
  if (scenario === "retry-total-timeout" && !["ffetch","ky","wretch","resilient-fetch-client","fetch-resilience","flowshield"].includes(library)) return "No overall deadline encompassing retry/backoff is exposed by this fetch API; per-attempt timeout is a different contract.";
  if (scenario === "bulkhead-queued-abort" && !["ffetch", "resilient-fetch-client", "@resili/fetch", "fetch-resilience", "flowshield"].includes(library)) {
    return library === "ts-retry-circuit" ? "Capacity rejects immediately; no queued bulkhead is offered." : "No bulkhead queue is offered by this package.";
  }
  if (["hedge-stream-winner", "circuit-hedge"].includes(scenario) && !["ffetch", "@resili/fetch", "flowshield"].includes(library)) {
    return "No hedging policy is offered by this package.";
  }
  if (scenario === "http-timeout" && library === "fetch-retry") return "No timeout policy is offered; native fetch alone does not supply this deadline.";
  return undefined;
}
const settings: Record<ScenarioId, string> = {
  "circuit-local-cancellation": "Reset 10000 ms. Active-fetch variant: threshold 1, no retries. Backoff variant: threshold 2, one retry, delay 100 ms; count preceding 503 at declared attempt/logical boundary.",
  "circuit-half-open-concurrency": "Threshold 1; reset 100 ms; zero retries. Single probe, queued followers (Cockatiel), or unrestricted probes per contract. fetch-smartly public circuit helper wraps fetchWithRetry.",
  "circuit-retry-accounting": "Circuit threshold 2; 2 retries; repeated 503; explicit circuit outside retry except resilient-fetch-client/Resili native attempt accounting",
  "bulkhead-retry": "Capacity 1; queue 1; one retry; 100ms backoff; concurrent A/B; success and exhaustion; fresh C",
  "dedupe-caller-abort": "Two same-key callers with distinct controllers; cancel follower/owner/all at 20ms; response at 100ms; fresh same-key follow-up",
  "dedupe-retry": "4 same-key GET callers; dedupe outside retry (Resili public policy order 150); two delayed 503s then streamed ready; 2 retries; delay 20ms; fresh same-key follow-up",
  "hedge-timeout": "Hedge delay 10ms; timeout 5/10/11/100ms; primary/hedge hang; no retries; healthy follow-up",
  "hedge-all-fail": "Primary and one hedge after 10ms; distinct TypeErrors; completion at 20/60ms or 30/50ms; no retries",
  "retry-hook-error": "503 then healthy response; 2 retries configured; throw/reject from supported predicate/delay/retry callback",
  "retry-after-abort": "503 (429 for fetch-smartly); 1 retry; Retry-After seconds/date/invalid/large; documented delay caps; abort at 20ms",
  "retry-body-replay": "Explicit POST retries; text, Request and one-shot stream bodies; first attempt consumes payload then returns 503",
  "retry-total-timeout": "100ms overall deadline; 1 retry; backoff 300ms or 80ms with second attempt hanging",
  "retry-recovery": "GET; two 503 responses then 200; 2 retries; delay 20ms",
  "retry-exhaustion": "GET; three 503 responses; 2 retries; delay 20ms",
  "retry-disabled": "GET; one 503; 0 retries",
  "retry-backoff-abort": "2 retries; backoff 100ms; caller abort at 20ms; drain timers; healthy follow-up",
  "bulkhead-queued-abort": "Capacity 1; queue 1; first request 100ms; queued caller abort at 20ms; replacement",
  "hedge-stream-winner": "Primary hangs; hedge after 10ms; winning body chunks at +20ms and +40ms",
  "circuit-hedge": "Circuit trips after one logical failure; hedge at 10ms; primary 503 at 15ms; winning hedge at 30ms; unhedged POST failure",
  "http-retry": "Native fetch; loopback HTTP; 2 retries; delay 5ms",
  "http-timeout": "Native fetch; loopback HTTP; headers delayed 1000ms; per-request/attempt timeout 100ms; 0 retries",
};
const expectations: Partial<Record<ScenarioId, string>> = {
  "circuit-local-cancellation": "Exact abort error/reason; prompt settlement and no late dispatch. Abort excluded as failure by classified circuits (Resili still records a nonfailure sample in its rate window); generic all-error policies and fetch-smartly public helper count it. Trip at the exact remaining real-failure budget; exact refusal; healthy recovery.",
  "circuit-half-open-concurrency": "No dispatch before reset; admit at deadline; exact refusal errors; failed probes restart cooldown; late success cannot close a reopened circuit; healthy recovery.",
  "circuit-retry-accounting": "Attempt-counting circuits dispatch twice then refuse; logical-counting circuits permit 3 attempts per request and trip after 2 requests; exact trip-point and subsequent refusal errors",
  "bulkhead-retry": "Never exceed one transport attempt at once; ffetch holds the logical-request slot (A,A,B), others release during backoff (A,B,A); exact exhaustion outcome; no deadlock/leaked capacity",
  "dedupe-caller-abort": "Exact ownership: ffetch follower detaches but owner abort cancels shared work; Resili subscribers detach independently, preserve the caller DOMException reason, and final detach aborts shared work; wretch/Smart DedupManager share owner's promise and ignore follower signal; no stranded caller; fresh call works",
  "dedupe-retry": "Exactly 3 shared transport attempts; every caller settles with 200 and independently usable body; registry cleans up and follow-up dispatches once",
  "hedge-timeout": "Exact timeout error/wrapper; deadline settlement; no dispatch at/after deadline; cooperative branches stop; no late hedge; same client recovers",
  "hedge-all-fail": "Two attempts; exact terminal error/cause: ffetch last RetryLimitError -> original TypeError, Resili last original error, flowshield primary original error; no leaked work",
  "retry-hook-error": "Sentinel error preserved by identity; one transport attempt; no late retry; same client accepts healthy follow-up",
  "retry-after-abort": "Correct header wait or documented cap/fallback; exact caller abort error; prompt settlement; no subsequent dispatch; no leftover transport timers",
  "retry-body-replay": "Replayable payload identical on every attempt; supported Request/stream cloning works; unsupported replay fails explicitly with exact TypeError or documented wrapper; never silently empty",
  "retry-total-timeout": "Exact library timeout error; settle at 100ms; original budget preserved; no dispatch after deadline; cooperative work stops; healthy follow-up",
  "retry-recovery": "200; body ready; exactly 3 attempts; no late attempts, active attempts or transport timers",
  "hedge-stream-winner": "Body winner readable to EOF; primary cancelled; exactly 2 attempts; no active attempts, bodies or transport timers",
  "circuit-hedge": "Winner and next request succeed; deliberate failure follows HTTP contract; next call throws exact CircuitOpenError; exactly 4 attempts",
  "http-retry": "200; body ready; exactly 3 server arrivals",
};
export const cases: CaseDefinition[] = libraries.flatMap(library => scenarios.map(scenario => {
  const na = notApplicable(library.id, scenario.id);
  let expected = expectations[scenario.id] ?? "";
  if (["retry-exhaustion", "retry-disabled"].includes(scenario.id)) expected = httpContracts[library.id] + "; exactly " + (scenario.id === "retry-disabled" ? 1 : 3) + " attempts; no transport timers";
  if (["retry-backoff-abort", "bulkhead-queued-abort"].includes(scenario.id)) expected = abortContracts[library.id] + "; prompt settlement; cancelled caller never dispatched again; replacement/follow-up succeeds; no leaked transport work";
  if (scenario.id === "http-timeout") expected = (timeoutContracts[library.id] ?? "") + "; healthy follow-up succeeds";
  let configuration = settings[scenario.id];
  if (library.id === "wretch") configuration += "; retry middleware resolves final response to Wretch HTTP handling; omit retry middleware for zero budget";
  if (library.id === "fetch-smartly") configuration += "; original parsed SmartFetchResponse result; normal timeout 60000ms";
  if (library.id === "flowshield") configuration += "; HTTP operation throws HttpStatusError; circuit outside hedge; retry omitted for zero budget";
  if (library.id === "ts-retry-circuit") configuration += "; public createCircuitFetch; full-jitter exponential backoff; deterministic Math.random=0.5 in scripted tests";
  if (library.id === "resilient-fetch-client") configuration += "; published backoff with initial/max delay configured; deterministic Math.random=0.5";
  if (library.id === "@resili/fetch") configuration += "; maxAttempts=retries+1; circuit outside hedge";
  if (library.id === "@resili/fetch" && scenario.id === "circuit-hedge") configuration += "; POST hedges too; failed POST uses 2 attempts; same circuit instance throughout";
  if (library.id === "ffetch" && scenario.id === "circuit-hedge") expected = "Winner and next request succeed; threshold-crossing POST and subsequent refusal throw exact CircuitOpenError; exactly 4 attempts";
  if (library.id === "@resili/fetch" && scenario.id === "circuit-hedge") expected = "Winner and follow-up succeed; hedged POST failure throws exact Error with message No acceptable hedged result completed.; next call exact CircuitOpenError; 5 transport attempts";
  if (library.id === "flowshield" && scenario.id === "hedge-stream-winner") expected = "Body winner readable to EOF; loser result discarded as documented; caller abort cleans up the hanging loser; exactly 2 attempts; no remaining transport work";
  const oldFfetchTraces: Partial<Record<ScenarioId, string>> = {
    "retry-backoff-abort": "ffetch-retry-abort.json", "bulkhead-queued-abort": "ffetch-bulkhead-abort.json",
    "hedge-stream-winner": "ffetch-hedge-stream.json", "circuit-hedge": "ffetch-circuit-hedge.json",
  };
  const definition: CaseDefinition = { scenarioId: scenario.id, libraryId: library.id, configuration, expected };
  if (na) { definition.notApplicable = na; definition.configuration = "Not applicable"; definition.expected = na; }
  else if (!scenario.id.startsWith("http-")) definition.traceFile = library.id === "ffetch" && oldFfetchTraces[scenario.id]
    ? oldFfetchTraces[scenario.id]!
    : (library.id + "-" + (scenario.id === "retry-disabled" ? "zero-retries" : scenario.id)).replace(/[^a-z0-9_-]/gi, "-") + ".json";
  return definition;
}));
export function getCase(scenarioId: ScenarioId, libraryId: string): CaseDefinition {
  const definition = cases.find(item => item.scenarioId === scenarioId && item.libraryId === libraryId);
  if (!definition) throw new Error("Unregistered matrix case: " + scenarioId + "/" + libraryId);
  return definition;
}
