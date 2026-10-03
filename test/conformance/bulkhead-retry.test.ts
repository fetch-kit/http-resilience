import { beforeAll, beforeEach, describe, expect, vi } from "vitest";
import { createFfetchClient } from "../../src/adapters/ffetch.js";
import { bulkheadRetryAdapters } from "../../src/adapters/bulkhead-retry.js";
import { readBody } from "../../src/adapters/types.js";
import { expectHttpOutcome } from "../contracts.js";
import { capture, clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
// Load ffetch's lazily imported HTTP-error module before measuring fake-clock settlement.
beforeAll(async () => {
  const warmup = createFfetchClient(async () => new Response("busy", { status: 503 }), { throwOnHttpError: true });
  await capture(warmup("https://example.test/warmup"));
});
describe.each(bulkheadRetryAdapters)("$name: bulkhead retry", adapter => {
  beforeEach(fakeTime);
  matrixIt("bulkhead-retry", adapter.name, async () => {
    for (const exhaust of [false, true]) {
      const holds = adapter.name === "ffetch";
      const aResult = { type: "response" as const, delayMs: 20, status: exhaust ? 503 : 200, body: exhaust ? "busy" : "A-ready" };
      const bResult = { type: "response" as const, delayMs: 20, body: "B-ready" };
      const fixture = transport(adapter.name + "-bulkhead-retry", [
        { type: "response", status: 503, delayMs: 10, body: "busy" },
        holds ? aResult : bResult, holds ? bResult : aResult,
        { type: "response", body: "fresh" },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 1, delayMs: 100 });
      const a = observe(client("https://example.test/A"));
      await vi.advanceTimersByTimeAsync(1);
      const b = observe(client("https://example.test/B"));
      await vi.advanceTimersByTimeAsync(49);
      expect.soft(fixture.attempts, "Slot ownership during backoff").toBe(holds ? 1 : 2);
      expect.soft(b.outcome?.ok).toBe(holds ? undefined : true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a.outcome).toBeDefined(); expect(b.outcome?.ok).toBe(true);
      if (a.outcome) {
        if (exhaust) await expectHttpOutcome(adapter.name, a.outcome, 2, "busy");
        else {
          expect(a.outcome.ok).toBe(true);
          if (a.outcome.ok) expect(await readBody(a.outcome.value)).toBe("A-ready");
        }
      }
      if (b.outcome?.ok) expect(await readBody(b.outcome.value)).toBe("B-ready");
      const urls = fixture.trace.events.filter(event => event.type === "request").map(event => String(event.data.url).split("/").at(-1));
      expect(urls).toEqual(holds ? ["A", "A", "B"] : ["A", "B", "A"]);
      let active = 0, peak = 0;
      for (const event of fixture.trace.events) {
        if (event.type === "attempt:start") peak = Math.max(peak, ++active);
        if (event.type === "response:headers" || event.type === "attempt:reject") active--;
      }
      expect(peak).toBe(1); expect(active).toBe(0);
      const fresh = observe(client("https://example.test/C"));
      await vi.advanceTimersByTimeAsync(100);
      expect(fresh.outcome?.ok).toBe(true);
      if (fresh.outcome?.ok) expect(await readBody(fresh.outcome.value)).toBe("fresh");
      expect(fixture.attempts).toBe(4);
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    }
  });
});
