import { beforeEach, describe, expect, vi } from "vitest";
import { hookClient, hookProfiles } from "../../src/adapters/retry-hooks.js";
import { readBody } from "../../src/adapters/types.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(hookProfiles)("$name: hook errors", profile => {
  beforeEach(fakeTime);
  matrixIt("retry-hook-error", profile.name, async () => {
    for (const variant of profile.variants) {
      const fixture = transport(profile.name + "-retry-hook-error", [
        { type: "response", status: 503 }, { type: "response", body: "healthy" },
      ]);
      const sentinel = new Error("sentinel-" + variant);
      const adapter = { name: profile.name, globalFetch: profile.globalFetch ?? false,
        create: () => hookClient(profile.name, fixture.fetch, variant, sentinel) };
      const client = await clientFor(adapter, fixture.fetch, { retries: 2, delayMs: 20 });
      const result = observe(client("https://example.test/hooks"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect.soft(result.outcome, variant + ": callback rejection must settle the caller").toBeDefined();
      if (result.outcome) expect(result.outcome.ok).toBe(false);
      if (result.outcome && !result.outcome.ok) expect(result.outcome.error).toBe(sentinel);
      expect(fixture.attempts).toBe(1);
      const next = observe(client("https://example.test/healthy"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(next.outcome?.ok).toBe(true);
      if (next.outcome?.ok) expect(await readBody(next.outcome.value)).toBe("healthy");
      expect(fixture.attempts).toBe(2);
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    }
  });
});
