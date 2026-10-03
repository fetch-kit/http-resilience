import type { FetchImplementation } from "../adapters/types.js";
import { Trace, errorDetails } from "./trace.js";

export interface Chunk {
  /** Delay from the preceding chunk (or response headers for the first). */
  afterMs: number;
  text: string;
}

export type Step =
  | {
      type: "response";
      status?: number;
      body?: string | readonly Chunk[];
      headers?: HeadersInit;
      delayMs?: number;
    }
  | { type: "error"; error: Error; delayMs?: number }
  | { type: "hang" };

export class ScriptExhaustedError extends Error {
  constructor(attempt: number) {
    super(`Unexpected transport attempt ${attempt}: script exhausted`);
    this.name = "ScriptExhaustedError";
  }
}

export function scriptedFetch(steps: readonly Step[], trace = new Trace()) {
  let attempts = 0;
  let activeAttempts = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const waits = new Set<() => void>();
  const bodies = new Set<() => void>();

  function schedule(callback: () => void, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function clear(timer: ReturnType<typeof setTimeout>) {
    clearTimeout(timer);
    timers.delete(timer);
  }

  function reason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  function wait(ms: number, signal: AbortSignal, attempt: number): Promise<void> {
    if (signal.aborted) return Promise.reject(reason(signal));
    if (ms === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clear(timer);
        signal.removeEventListener("abort", abort);
        waits.delete(dispose);
      };
      const abort = () => {
        trace.record(attempt, "attempt:abort", errorDetails(reason(signal)));
        cleanup();
        reject(reason(signal));
      };
      const dispose = () => {
        cleanup();
        reject(new Error("Scripted fetch disposed"));
      };
      waits.add(dispose);
      signal.addEventListener("abort", abort, { once: true });
      if (Number.isFinite(ms)) {
        timer = schedule(() => {
          cleanup();
          resolve();
        }, ms);
      }
    });
  }

  function stream(
    chunks: readonly Chunk[],
    signal: AbortSignal,
    attempt: number,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const chunkTimers: ReturnType<typeof setTimeout>[] = [];
        let ended = false;
        cleanup = () => {
          if (ended) return;
          ended = true;
          chunkTimers.forEach(clear);
          signal.removeEventListener("abort", abort);
          bodies.delete(dispose);
        };
        const abort = () => {
          if (ended) return;
          trace.record(attempt, "response:abort", errorDetails(reason(signal)));
          cleanup();
          controller.error(reason(signal));
        };
        const dispose = () => {
          if (ended) return;
          cleanup();
          controller.error(new Error("Scripted response disposed"));
        };
        bodies.add(dispose);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        if (chunks.length === 0) {
          cleanup();
          controller.close();
          return;
        }
        let elapsed = 0;
        chunks.forEach((chunk, index) => {
          elapsed += chunk.afterMs;
          chunkTimers.push(schedule(() => {
            if (ended) return;
            const bytes = encoder.encode(chunk.text);
            trace.record(attempt, "response:chunk", { bytes: bytes.length });
            controller.enqueue(bytes);
            if (index === chunks.length - 1) {
              trace.record(attempt, "response:end");
              cleanup();
              controller.close();
            }
          }, elapsed));
        });
      },
      cancel() {
        trace.record(attempt, "response:cancel");
        cleanup();
      },
    });
  }

  const fetch: FetchImplementation = async (input, init) => {
    const attempt = ++attempts;
    activeAttempts++;
    trace.record(attempt, "attempt:start");
    try {
      const request = new Request(input, init);
      trace.record(attempt, "request", { method: request.method, url: request.url });
      const step = steps[attempt - 1];
      if (!step) throw new ScriptExhaustedError(attempt);
      if (request.signal.aborted) throw reason(request.signal);
      if (request.body !== null) {
        const bytes = new Uint8Array(await request.arrayBuffer());
        trace.record(attempt, "request:body", {
          bytes: [...bytes],
        });
      }
      await wait(step.type === "hang" ? Infinity : (step.delayMs ?? 0), request.signal, attempt);
      if (request.signal.aborted) throw reason(request.signal);
      if (step.type === "error") throw step.error;
      if (step.type === "hang") throw new Error("Hanging step unexpectedly resumed");
      const status = step.status ?? 200;
      const body = typeof step.body === "string" || step.body === undefined
        ? step.body
        : stream(step.body, request.signal, attempt);
      const response = new Response(body, {
        status,
        ...(step.headers === undefined ? {} : { headers: step.headers }),
      });
      trace.record(attempt, "response:headers", { status });
      return response;
    } catch (error) {
      trace.record(attempt, "attempt:reject", errorDetails(error));
      throw error;
    } finally {
      activeAttempts--;
    }
  };

  return {
    fetch,
    trace,
    get attempts() { return attempts; },
    get activeAttempts() { return activeAttempts; },
    get activeBodies() { return bodies.size; },
    get pendingTimers() { return timers.size; },
    dispose() {
      [...waits].forEach(dispose => dispose());
      [...bodies].forEach(dispose => dispose());
      [...timers].forEach(clear);
    },
  };
}
