import { beforeEach, describe, expect, vi } from "vitest";
import { dedupeAdapters } from "../../src/adapters/deduplication.js";
import { readBody } from "../../src/adapters/types.js";
import { expectAbort } from "../contracts.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(dedupeAdapters)("$name: dedupe ownership", adapter => {
  beforeEach(fakeTime);
  matrixIt("dedupe-caller-abort", adapter.name, async () => {
    for (const role of ["follower", "owner", "all"]) {
      const fixture = transport(adapter.name + "-dedupe-caller-abort", [
        { type: "response", delayMs: 100, body: "healthy" },
        { type: "response", body: "fresh" },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20 });
      const controllers = [new AbortController(), new AbortController()];
      const owner = observe(client("https://example.test/shared", { signal: controllers[0]!.signal }));
      await vi.advanceTimersByTimeAsync(0);
      const follower = observe(client("https://example.test/shared", { signal: controllers[1]!.signal }));
      await vi.advanceTimersByTimeAsync(20);
      if (role !== "follower") controllers[0]!.abort();
      if (role !== "owner") controllers[1]!.abort();
      await vi.advanceTimersByTimeAsync(0);
      const prompt = [owner.outcome, follower.outcome];
      await vi.advanceTimersByTimeAsync(200);
      const independent = adapter.name === "@resili/fetch";
      const detachableFollower = independent || adapter.name === "ffetch";
      const rejected = role === "all" ? [true, true]
        : role === "owner" ? [true, !independent] : [false, detachableFollower];
      for (const [index, caller] of [owner, follower].entries()) {
        expect.soft(caller.outcome, role + ": no stranded caller").toBeDefined();
        if (rejected[index]) {
          expect.soft(prompt[index], role + ": cancellation must settle promptly").toBeDefined();
          expect(caller.outcome?.ok).toBe(false);
          if (caller.outcome && !caller.outcome.ok) {
            expectAbort(adapter.name, caller.outcome.error, !independent && controllers[0]!.signal.aborted
              ? controllers[0]!.signal.reason : controllers[index]!.signal.reason);
          }
        } else expect(caller.outcome?.ok).toBe(true);
      }
      expect(fixture.attempts).toBe(1);
      const fresh = observe(client("https://example.test/shared"));
      await vi.advanceTimersByTimeAsync(100);
      expect(fresh.outcome?.ok).toBe(true);
      if (fresh.outcome?.ok) expect(await readBody(fresh.outcome.value)).toBe("fresh");
      expect(fixture.attempts).toBe(2);
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    }
  });
});
