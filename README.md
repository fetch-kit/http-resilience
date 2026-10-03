# Fetch resiliency

Correctness matrix for 11 pinned libraries across 21 scenarios. Requires Node.js 24.

```sh
npm ci
npm run check
npm run report
```

Open `results/matrix.html` for the matrix, configurations, exact expected errors, assertion failures, and failure traces. Markdown and JSON are written alongside it. Failed correctness assertions still generate the report and make the command exit nonzero.

PASS/FAIL come from executed assertions. N/A identifies an unavailable combination and links to its reason. NOT TESTED means no implementation; NOT RUN means a registered test was absent from the run. Harness/reporter tests are excluded.

The adapters preserve library results and errors. Generic flowshield and fetch-resilience circuit policies use an explicitly classified HTTP operation; fetch-smartly retains its parsed result. Tests use each library's terminal error contract and retry-count convention. Public circuit/deduplication helpers are composed where appropriate; fetch-smartly's circuit helper counts every rejected operation, including caller aborts. Circuit tests respect attempt/logical accounting and single, queued or unrestricted half-open probes. Jitter is deterministic in scripted tests. Flowshield discards hedge loser results; its test checks the winning stream and caller-owned cancellation. Resili hedges POST too, so its deliberate circuit failure uses two transport attempts.

Cancellation cases require prompt settlement, no dispatch after cancellation, and recovered queue capacity. A library offering retry or queuing can fail these combination requirements even when its documentation makes no explicit promise about interrupting a backoff or removing a cancelled waiter.

## Libraries under test

| Library | Version |
| --- | --- |
| ffetch | 5.7.1 |
| ky | 2.1.0 |
| fetch-retry | 6.0.0 |
| ofetch | 1.5.1 |
| wretch | 3.0.9 |
| resilient-fetch-client | 0.3.0 |
| fetch-smartly | 1.0.2 |
| @resili/fetch | 0.2.0-beta.1 |
| fetch-resilience | 0.1.0 |
| flowshield | 1.0.4 |
| ts-retry-circuit | 2.1.1 |

Reproduce a library's existing scenarios:

```sh
npm test -- --testNamePattern "fetch-retry"
```

## Implemented scenarios

| Scenario | Check |
| --- | --- |
| Retry recovery | Two 503s then 200; exactly three attempts |
| Retry exhaustion | Three 503s; library-specific terminal response/error |
| Zero retries | One attempt; exact terminal response/error |
| Retry + backoff abort | Prompt abort error; no subsequent dispatch; healthy follow-up |
| Bulkhead + queued abort | Correct abort; remove waiter; admit replacement |
| Hedge + streaming body | Winning body readable to EOF; documented loser ownership |
| Circuit + hedge | Losing 503 does not trip circuit; deliberate failure does; exact refusal |
| Real HTTP retry | Three server arrivals and a usable successful body |
| Real HTTP timeout | Exact timeout error/wrapper; healthy follow-up |
| Retry + body replay | Byte-for-byte POST replay; explicit rejection of unreplayable bodies |
| Retry-After + abort | Seconds/date parsing, fallback/cap, exact cancellation and no later dispatch |
| Retry + throwing hooks | Sentinel error identity; no accidental retry; healthy follow-up |
| Hedge + all branches fail | Both completion orders; exact terminal error/cause and bounded attempts |
| Hedge + timeout | Deadline around hedge launch; exact error; cancellation and no late hedge |
| Dedupe + retry | One shared retry sequence; every caller gets a usable body; fresh follow-up |
| Dedupe + caller cancellation | Follower/owner/all cancellation obeys ownership; no stranded subscriber |
| Bulkhead + retry | Declared slot ownership, queue ordering, exhaustion and capacity recovery |
| Circuit + half-open concurrency | Reset boundary, declared probe admission, failed-probe recovery and stale completion isolation |
| Circuit + local cancellation | Exact abort, no late retry, declared health classification and recovery |
| Circuit + retry accounting | Exact trip point and errors at declared attempt/logical boundary |
| Retry + total timeout | Original deadline covers backoff and later attempts; exact timeout error; no late dispatch |
