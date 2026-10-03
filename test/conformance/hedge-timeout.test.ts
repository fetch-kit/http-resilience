import { TimeoutError } from "@fetchkit/ffetch";
import { beforeEach, describe, expect, vi } from "vitest";
import { hedgeAdapters } from "../../src/adapters/hedging.js";
import { readBody } from "../../src/adapters/types.js";
import { expectTimeout } from "../contracts.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(hedgeAdapters)("$name: hedge deadline", adapter => {
  beforeEach(fakeTime);
  matrixIt("hedge-timeout", adapter.name, async () => {
    for (const timeoutMs of [5, 10, 11, 100]) {
      const expectedAttempts = timeoutMs > 10 ? 2 : 1;
      const fixture = transport(adapter.name + "-hedge-timeout", [
        { type: "hang" }, ...(expectedAttempts === 2 ? [{ type: "hang" as const }] : []),
        ...Array.from({ length: 3 }, () => ({ type: "response" as const, body: "healthy" })),
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20, timeoutMs });
      const result = observe(client("https://example.test/hedge-timeout"));
      await vi.advanceTimersByTimeAsync(timeoutMs - 1);
      expect.soft(result.outcome, "Timeout must not settle early").toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      const deadline = result.outcome;
      await vi.advanceTimersByTimeAsync(500);
      expect.soft(deadline, "Timeout must settle at deadline " + timeoutMs).toBeDefined();
      if (result.outcome) {
        expect(result.outcome.ok).toBe(false);
        if (!result.outcome.ok) {
          if (adapter.name === "ffetch") expect((result.outcome.error as Error).constructor).toBe(TimeoutError);
          else expectTimeout(adapter.name, result.outcome.error, timeoutMs);
        }
      }
      expect.soft(fixture.attempts, "No late hedge at deadline " + timeoutMs).toBe(expectedAttempts);
      const dispatches = fixture.trace.events.filter(event => event.type === "attempt:start");
      const startedAt = dispatches[0]!.atMs;
      expect.soft(dispatches.every(event => event.atMs - startedAt < timeoutMs)).toBe(true);
      expect.soft(fixture.activeAttempts, "All cooperative branches must stop").toBe(0);
      const next = observe(client("https://example.test/healthy"));
      await vi.advanceTimersByTimeAsync(0);
      expect.soft(next.outcome?.ok).toBe(true);
      if (next.outcome?.ok) expect(await readBody(next.outcome.value)).toBe("healthy");
      expect.soft(fixture.pendingTimers).toBe(0);
    }
  });
});
