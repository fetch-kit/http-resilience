import { TimeoutError as FfetchTimeoutError } from "@fetchkit/ffetch";
import { beforeEach, describe, expect, vi } from "vitest";
import { deadlineAdapters } from "../../src/adapters/deadline.js";
import { readBody } from "../../src/adapters/types.js";
import { expectTimeout } from "../contracts.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(deadlineAdapters)("$name: total deadline", adapter => {
  beforeEach(fakeTime);
  matrixIt("retry-total-timeout", adapter.name, async () => {
    for (const duringAttempt of [false, true]) {
      const fixture = transport(adapter.name + "-retry-total-timeout", [
        { type: "response", status: 503 },
        ...(duringAttempt ? [{ type: "hang" as const }] : []),
        ...Array.from({ length: 3 }, () => ({ type: "response" as const, body: "healthy" })),
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 1, delayMs: duringAttempt ? 80 : 300 });
      const result = observe(client("https://example.test/deadline"));
      await vi.advanceTimersByTimeAsync(99);
      expect.soft(result.outcome, "Deadline must not fire early").toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      const atDeadline = result.outcome;
      await vi.advanceTimersByTimeAsync(1_000);
      expect.soft(atDeadline, "Deadline must cover backoff and subsequent attempts").toBeDefined();
      const final = result.outcome;
      expect(final).toBeDefined();
      if (!final) throw new Error("Deadline never settled");
      expect(final.ok).toBe(false);
      if (!final.ok) {
        if (adapter.name === "ffetch") expect((final.error as Error).constructor).toBe(FfetchTimeoutError);
        else expectTimeout(adapter.name, final.error);
      }
      expect.soft(fixture.attempts, "No dispatch after original deadline").toBe(duringAttempt ? 2 : 1);
      expect.soft(fixture.activeAttempts, "Cooperative work must stop").toBe(0);
      const followup = observe(client("https://example.test/healthy"));
      await vi.advanceTimersByTimeAsync(0);
      expect(followup.outcome?.ok).toBe(true);
      if (followup.outcome?.ok) expect(await readBody(followup.outcome.value)).toBe("healthy");
      expect.soft(fixture.pendingTimers).toBe(0);
    }
  });
});
