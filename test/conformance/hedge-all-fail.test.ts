import { RetryLimitError } from "@fetchkit/ffetch";
import { beforeEach, describe, expect, vi } from "vitest";
import { hedgeAdapters } from "../../src/adapters/hedging.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(hedgeAdapters)("$name: all hedges fail", adapter => {
  beforeEach(fakeTime);
  matrixIt("hedge-all-fail", adapter.name, async () => {
    for (const primaryFirst of [true, false]) {
      const primary = new TypeError("primary failed");
      const hedge = new TypeError("hedge failed");
      const last = primaryFirst ? hedge : primary;
      const fixture = transport(adapter.name + "-hedge-all-fail", [
        { type: "error", error: primary, delayMs: primaryFirst ? 20 : 50 },
        { type: "error", error: hedge, delayMs: primaryFirst ? 50 : 20 },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20 });
      const result = observe(client("https://example.test/all-fail"));
      await vi.advanceTimersByTimeAsync(19);
      expect(result.outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(100);
      expect(result.outcome?.ok).toBe(false);
      if (result.outcome && !result.outcome.ok) {
        const error = result.outcome.error as Error;
        if (adapter.name === "ffetch") {
          expect(error.constructor).toBe(RetryLimitError);
          expect(error.cause).toBe(last);
        } else expect(error).toBe(adapter.name === "flowshield" ? primary : last);
      }
      await vi.advanceTimersByTimeAsync(500);
      expect(fixture.attempts).toBe(2);
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    }
  });
});
