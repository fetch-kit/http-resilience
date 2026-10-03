import type { RetryAdapter, RetryOptions, FetchImplementation, RequestClient } from "../src/adapters/types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, onTestFailed, vi } from "vitest";
import { scriptedFetch } from "../src/harness/scripted-fetch.js";
import type { Step } from "../src/harness/scripted-fetch.js";

const transports: ReturnType<typeof scriptedFetch>[] = [];
const traceGroups = new Map<string, ReturnType<typeof scriptedFetch>[]>();

export function transport(label: string, steps: readonly Step[]) {
  const fixture = scriptedFetch(steps);
  transports.push(fixture);
  let group = traceGroups.get(label);
  if (group) { group.push(fixture); return fixture; }
  group = [fixture];
  traceGroups.set(label, group);
  const captured = group;
  onTestFailed(() => {
    mkdirSync("results/traces", { recursive: true });
    const filename = label.replace(/[^a-z0-9_-]/gi, "-");
    const directory = process.env.RESILIENCY_TRACE_DIR ?? "results/traces";
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/${filename}.json`, JSON.stringify({
      scenario: label,
      ...(captured.length === 1
        ? { attempts: fixture.attempts, events: fixture.trace.events }
        : { transports: captured.map(item => ({ attempts: item.attempts, events: item.trace.events })) }),
    }, null, 2) + "\n");
  });
  return fixture;
}

export function fakeTime() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Deadline expired", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export function capture<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error: error as unknown }),
  );
}

afterEach(async () => {
  traceGroups.clear();
  transports.splice(0).forEach(fixture => fixture.dispose());
  for (const client of clients.splice(0)) await client.dispose?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const clients: RequestClient[] = [];
export async function clientFor(adapter: RetryAdapter, fetch: FetchImplementation, options: RetryOptions) {
  if (adapter.globalFetch) vi.stubGlobal("fetch", fetch);
  const client = adapter.create(fetch, options);
  clients.push(client);
  await client.ready;
  return client;
}
export function observe<T>(promise: Promise<T>) {
  const state: { outcome?: Outcome<T>; settled: Promise<Outcome<T>> } = { settled: capture(promise) };
  void state.settled.then(outcome => { state.outcome = outcome; });
  return state;
}
