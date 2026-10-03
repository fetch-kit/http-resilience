import { beforeEach, describe, expect, vi } from "vitest";
import { CircuitHalfOpenThrottledError } from "ts-retry-circuit";
import { circuitAdapter, circuitProfiles } from "../../src/adapters/circuits.js";
import { readBody } from "../../src/adapters/types.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { HttpError as ResilientHttpError } from "resilient-fetch-client";
import { HttpError as SmartHttpError } from "fetch-smartly";
import { HttpStatusError } from "../../src/adapters/competitors.js";
import type { ClientResult } from "../../src/adapters/types.js";
import type { Outcome } from "../helpers.js";
import { matrixIt } from "../matrix.js";

describe.each(circuitProfiles)("$name: half-open concurrency", profile => {
  beforeEach(fakeTime);
  matrixIt("circuit-half-open-concurrency", profile.name, async () => {
    function dependencyFailure(result: Outcome<ClientResult> | undefined) {
      expect(result).toBeDefined();
      if (profile.name === "@resili/fetch") {
        expect(result?.ok).toBe(true);
        if (result?.ok) expect(result.value.status).toBe(503);
        return;
      }
      expect(result?.ok).toBe(false);
      if (!result || result.ok) return;
      const error = result.error as Error;
      const constructor = profile.name === "ffetch" ? profile.error
        : profile.name === "resilient-fetch-client" ? ResilientHttpError
        : profile.name === "fetch-smartly" ? SmartHttpError
        : profile.name === "ts-retry-circuit" ? Error : HttpStatusError;
      expect(error.constructor).toBe(constructor);
      if (error.constructor === ResilientHttpError) expect(((error as ResilientHttpError).details as { status: number }).status).toBe(503);
      if (error.constructor === SmartHttpError) expect((error as SmartHttpError).status).toBe(503);
      if (error.constructor === HttpStatusError) expect((error as HttpStatusError).response.status).toBe(503);
      if (profile.name === "ts-retry-circuit") expect(error.message).toMatch(/^HTTP 503/);
    }
    const label = profile.name + "-circuit-half-open-concurrency";
    const probes = profile.probes === "unbounded" ? 3 : 1;
    const fixture = transport(label, [
      { type: "response", status: 503, body: "trip" },
      ...Array.from({ length: probes }, () => ({ type: "response" as const, status: 503, body: "probe failed", delayMs: 20 })),
      ...Array.from({ length: 4 }, () => ({ type: "response" as const, body: "healthy", delayMs: 20 })),
    ]);
    const client = await clientFor(circuitAdapter(profile.name, 1, 100), fixture.fetch, { retries: 0, delayMs: 20 });
    const trip = observe(client("https://example.test/trip"));
    await vi.advanceTimersByTimeAsync(0);
    dependencyFailure(trip.outcome);
    await vi.advanceTimersByTimeAsync(99);
    const early = observe(client("https://example.test/early"));
    await vi.advanceTimersByTimeAsync(0);
    expect(early.outcome?.ok).toBe(false);
    if (early.outcome && !early.outcome.ok) expect((early.outcome.error as Error).constructor).toBe(profile.error);
    expect(fixture.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    let primary = observe(client("https://example.test/probe"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(fixture.attempts, "admit at the exact reset deadline").toBe(2);
    if (fixture.attempts === 1) {
      await vi.advanceTimersByTimeAsync(1);
      primary = observe(client("https://example.test/probe-after-boundary"));
      await vi.advanceTimersByTimeAsync(0);
    }
    const followers = [observe(client("https://example.test/follower-1")), observe(client("https://example.test/follower-2"))];
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.attempts).toBe(1 + probes);
    expect(fixture.activeAttempts).toBe(probes);
    if (profile.probes === "queued") followers.forEach(result => expect(result.outcome).toBeUndefined());
    if (profile.probes === "one") followers.forEach(result => {
      expect(result.outcome?.ok).toBe(false);
      if (result.outcome && !result.outcome.ok) expect((result.outcome.error as Error).constructor)
        .toBe(profile.name === "ts-retry-circuit" ? CircuitHalfOpenThrottledError : profile.error);
    });
    await vi.advanceTimersByTimeAsync(20);
    dependencyFailure(primary.outcome);
    followers.forEach(result => expect(result.outcome?.ok).toBe(false));
    if (profile.probes === "unbounded") followers.forEach(result => dependencyFailure(result.outcome));
    if (profile.probes === "queued") followers.forEach(result => {
      if (result.outcome && !result.outcome.ok) expect((result.outcome.error as Error).constructor).toBe(profile.error);
    });
    await vi.advanceTimersByTimeAsync(99);
    const beforeRecovery = observe(client("https://example.test/early-recovery"));
    await vi.advanceTimersByTimeAsync(0);
    expect(beforeRecovery.outcome?.ok).toBe(false);
    expect(fixture.attempts).toBe(1 + probes);
    await vi.advanceTimersByTimeAsync(1);
    let recovery = observe(client("https://example.test/recovery"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(fixture.attempts, "new cooldown expires at its deadline").toBe(2 + probes);
    if (fixture.attempts === 1 + probes) {
      await vi.advanceTimersByTimeAsync(1);
      recovery = observe(client("https://example.test/recovery-after-boundary"));
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(recovery.outcome?.ok).toBe(true);
    if (recovery.outcome?.ok) expect(await readBody(recovery.outcome.value)).toBe("healthy");
    const followup = observe(client("https://example.test/after-recovery"));
    await vi.advanceTimersByTimeAsync(20);
    expect(followup.outcome?.ok).toBe(true);
    if (followup.outcome?.ok) expect(await readBody(followup.outcome.value)).toBe("healthy");
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.pendingTimers).toBe(0);

    // A call admitted while closed completes after a newer probe reopened the circuit.
    const stale = transport(label, [
      { type: "response", body: "old success", delayMs: 150 },
      { type: "response", status: 503, body: "trip" },
      { type: "response", status: 503, body: "failed probe", delayMs: 20 },
      { type: "response", body: "new recovery" },
    ]);
    const next = await clientFor(circuitAdapter(profile.name, 1, 100), stale.fetch, { retries: 0, delayMs: 20 });
    const started = Date.now();
    const old = observe(next("https://example.test/old"));
    const opening = observe(next("https://example.test/trip"));
    await vi.advanceTimersByTimeAsync(100);
    dependencyFailure(opening.outcome);
    let probe = observe(next("https://example.test/probe"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(stale.attempts, "stale variant reset boundary").toBe(3);
    if (stale.attempts === 2) {
      await vi.advanceTimersByTimeAsync(1);
      probe = observe(next("https://example.test/probe-after-boundary"));
    }
    await vi.advanceTimersByTimeAsync(20);
    dependencyFailure(probe.outcome);
    const deadline = Date.now() + 100;
    await vi.advanceTimersByTimeAsync(started + 150 - Date.now());
    expect(old.outcome?.ok).toBe(true);
    if (old.outcome?.ok) expect(await readBody(old.outcome.value)).toBe("old success");
    if (profile.name === "ffetch") expect.soft((next as typeof next & { circuitOpen: boolean }).circuitOpen,
      "late success must not close the newer open state").toBe(true);
    const blocked = observe(next("https://example.test/still-open"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(blocked.outcome?.ok, "late success must not admit during the new cooldown").toBe(false);
    if (blocked.outcome && !blocked.outcome.ok) expect((blocked.outcome.error as Error).constructor).toBe(profile.error);
    expect.soft(stale.attempts, "late success must not consume the recovery response").toBe(3);
    if (stale.attempts === 3) {
      await vi.advanceTimersByTimeAsync(deadline - Date.now() + 1);
      const healthy = observe(next("https://example.test/recovered"));
      await vi.advanceTimersByTimeAsync(0);
      expect(healthy.outcome?.ok).toBe(true);
      if (healthy.outcome?.ok) expect(await readBody(healthy.outcome.value)).toBe("new recovery");
    }
    expect(stale.activeAttempts).toBe(0);
    expect(stale.pendingTimers).toBe(0);
  });
});
