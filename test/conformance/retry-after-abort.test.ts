import { beforeEach, describe, expect, vi } from "vitest";
import { retryAfterAdapters } from "../../src/adapters/retry-after.js";
import { readBody } from "../../src/adapters/types.js";
import { expectAbort } from "../contracts.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(retryAfterAdapters)("$name: Retry-After", adapter => {
  beforeEach(fakeTime);
  matrixIt("retry-after-abort", adapter.name, async () => {
    for (const value of ["1", new Date(1_000).toUTCString(), "bad", "1000"]) {
      for (const abort of [false, true]) {
        vi.setSystemTime(0);
        const status = adapter.name === "fetch-smartly" ? 429 : 503;
        const fixture = transport(adapter.name + "-retry-after-abort", [
          { type: "response", status, headers: { "Retry-After": value } },
          { type: "response", body: "ready" },
        ]);
        const client = await clientFor(adapter, fixture.fetch, { retries: 1, delayMs: 50 });
        const controller = new AbortController();
        const result = observe(client("https://example.test/retry-after", { signal: controller.signal }));
        const capped = ["ky", "fetch-smartly", "@resili/fetch"].includes(adapter.name);
        const delay = value === "bad" ? (adapter.name === "ffetch" ? 450 : 50)
          : value === "1000" && !capped ? 1_000_000 : 1_000;
        if (abort) {
          await vi.advanceTimersByTimeAsync(20);
          controller.abort();
          await vi.advanceTimersByTimeAsync(0);
          const prompt = result.outcome;
          await vi.advanceTimersByTimeAsync(delay + 1_000);
          expect.soft(prompt, "Abort must interrupt header-derived wait: " + value).toBeDefined();
          const final = result.outcome;
          expect(final).toBeDefined();
          if (final) {
            expect(final.ok).toBe(false);
            if (!final.ok) expectAbort(adapter.name, final.error, controller.signal.reason);
          }
          expect.soft(fixture.attempts, "No dispatch after header-wait cancellation").toBe(1);
        } else {
          await vi.advanceTimersByTimeAsync(value === "bad" && adapter.name === "resilient-fetch-client" ? 0 : delay - 1);
          expect.soft(fixture.attempts, "Retry-After must control retry timing: " + value).toBe(1);
          await vi.advanceTimersByTimeAsync(value === "bad" && adapter.name === "resilient-fetch-client" ? 50 : 1);
          expect(result.outcome?.ok).toBe(true);
          if (result.outcome?.ok) expect(await readBody(result.outcome.value)).toBe("ready");
          expect(fixture.attempts).toBe(2);
        }
        expect(fixture.activeAttempts).toBe(0);
        expect(fixture.pendingTimers).toBe(0);
      }
    }
  });
});
