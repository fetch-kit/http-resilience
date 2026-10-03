# Failing scenarios

The current pinned run has **25 failing cells**. Full assertions and current transport traces are linked from [the matrix](../results/matrix.html).

| Scenario | Libraries | Observed |
| --- | --- | --- |
| Abort during backoff | fetch-retry, ofetch, wretch, resilient-fetch-client, @resili/fetch, fetch-resilience | Late cancellation; all except Resili dispatch again after abort. |
| Cancelled bulkhead waiter | resilient-fetch-client, @resili/fetch, fetch-resilience, flowshield | Cancelled waiter retains queue capacity; replacement is rejected. The latter two also invoke the cancelled operation. |
| Retry + total timeout | wretch, resilient-fetch-client, fetch-resilience, flowshield | Work continues past the total deadline; Wretch also settles late. |
| Retry-After + abort | resilient-fetch-client, @resili/fetch | Late abort; resilient-fetch-client dispatches again. Resili also ignores the advertised header wait. |
| Retry + throwing hooks | wretch | Throwing/rejecting onRetry strands the request and raises unhandled rejections. |
| Hedge + timeout | flowshield | Hedge dispatch/work survives the deadline. |
| Dedupe + retry | @resili/fetch | Shared retry succeeds but subscribers receive the same consumed Response body. |
| Circuit + half-open concurrency | ffetch, fetch-smartly, ts-retry-circuit | Stale success closes newer circuit state; Smart/TS admit early. TS also rejects at the exact reset deadline. |
| Circuit + local cancellation | resilient-fetch-client, @resili/fetch, fetch-resilience | Backoff abort settles late; first and third dispatch again. Health accounting and recovery assertions pass. |

Reproduce a scenario or the complete matrix:

```sh
npm test -- test/conformance/circuit-half-open-concurrency.test.ts
npm test -- test/conformance/circuit-local-cancellation.test.ts
npm run report
```

These are failures against the suite's declared correctness requirements. Versions, configuration and exact expected error contracts appear in every matrix cell. Cancellation requirements include prompt settlement and no subsequent dispatch, even where a library does not explicitly promise interruptible waits.
