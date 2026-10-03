import { beforeEach, describe, expect, vi } from "vitest";
import { dedupeAdapters } from "../../src/adapters/deduplication.js";
import { readBody } from "../../src/adapters/types.js";
import { capture, clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(dedupeAdapters)("$name: dedupe retry", adapter => {
  beforeEach(fakeTime);
  matrixIt("dedupe-retry", adapter.name, async () => {
    const fixture = transport(adapter.name + "-dedupe-retry", [
      { type: "response", status: 503, delayMs: 10 },
      { type: "response", status: 503, delayMs: 10 },
      { type: "response", body: [{ afterMs: 10, text: "rea" }, { afterMs: 10, text: "dy" }] },
      { type: "response", body: "fresh" },
    ]);
    const client = await clientFor(adapter, fixture.fetch, { retries: 2, delayMs: 20 });
    const callers = Array.from({ length: 4 }, () => observe(client("https://example.test/shared")));
    await vi.advanceTimersByTimeAsync(200);
    const bodies = callers.map(caller => {
      expect(caller.outcome?.ok).toBe(true);
      if (!caller.outcome?.ok) throw new Error("Shared retry caller did not succeed");
      expect(caller.outcome.value.status).toBe(200);
      return capture(readBody(caller.outcome.value));
    });
    await vi.advanceTimersByTimeAsync(100);
    for (const body of await Promise.all(bodies)) expect.soft(body).toEqual({ ok: true, value: "ready" });
    expect(fixture.attempts).toBe(3);
    const fresh = observe(client("https://example.test/shared"));
    await vi.advanceTimersByTimeAsync(100);
    expect(fresh.outcome?.ok).toBe(true);
    if (fresh.outcome?.ok) expect(await readBody(fresh.outcome.value)).toBe("fresh");
    expect(fixture.attempts).toBe(4);
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.activeBodies).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });
});
