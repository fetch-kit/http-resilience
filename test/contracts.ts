import wretch from "wretch";
import { expect } from "vitest";
import { HttpError as FfetchHttpError, AbortError as FfetchAbortError } from "@fetchkit/ffetch";
import { HTTPError, TimeoutError as KyTimeoutError } from "ky";
import { FetchError } from "ofetch";
import { HttpError as ResilientHttpError } from "resilient-fetch-client";
import { TaskCancelledError } from "cockatiel";
import { HttpError as SmartHttpError, TimeoutError as SmartTimeoutError } from "fetch-smartly";
import { RetryExceededError, TimeoutError as ResiliTimeoutError, CircuitOpenError as ResiliCircuitError } from "@resili/core";
import { TimeoutError as ResilienceTimeoutError } from "fetch-resilience";
import { RetryExhaustedError, TimeoutError as FlowTimeoutError, CircuitOpenError as FlowCircuitError } from "flowshield";
import { CircuitAbortedError, CircuitTimeoutError } from "ts-retry-circuit";
import { HttpStatusError } from "../src/adapters/competitors.js";
import { readBody } from "../src/adapters/types.js";
import type { ClientResult } from "../src/adapters/types.js";
import type { Outcome } from "./helpers.js";

function exact(error: unknown, constructor: Function): asserts error is Error {
  expect(error).toBeInstanceOf(constructor);
  expect((error as Error).constructor).toBe(constructor);
}
export async function expectHttpOutcome(name: string, outcome: Outcome<ClientResult>, attempts: number, body: string) {
  if (["fetch-retry", "fetch-resilience"].includes(name)) {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    expect(outcome.value.status).toBe(503);
    expect(await readBody(outcome.value)).toBe(body);
    return;
  }
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected HTTP failure");
  const error = outcome.error;
  switch (name) {
    case "ffetch":
      exact(error, FfetchHttpError);
      expect(error.cause).toBeInstanceOf(Response);
      expect((error.cause as Response).status).toBe(503);
      expect(await (error.cause as Response).text()).toBe(body);
      break;
    case "ky":
      exact(error, HTTPError); expect((error as HTTPError).response.status).toBe(503); break;
    case "ofetch":
      exact(error, FetchError); expect((error as FetchError).status).toBe(503); break;
    case "wretch":
      exact(error, wretch.WretchError);
      expect((error as Error & { status: number }).status).toBe(503);
      break;
    case "resilient-fetch-client":
      exact(error, ResilientHttpError);
      expect((error as ResilientHttpError).details).toMatchObject({ status: 503 });
      expect(error.cause).toBe("responseStatus");
      break;
    case "fetch-smartly":
      exact(error, SmartHttpError); expect((error as SmartHttpError).status).toBe(503);
      expect((error as SmartHttpError).body).toBe(body); break;
    case "@resili/fetch":
      exact(error, RetryExceededError);
      expect((error as RetryExceededError).code).toBe("ERR_RETRY_EXCEEDED");
      expect((error as RetryExceededError).attempts).toBe(attempts);
      expect(error.cause).toBe((error as RetryExceededError).lastError);
      expect(error.cause).toBeInstanceOf(Error);
      break;
    case "flowshield": {
      const cause = attempts > 1 ? (error as Error).cause : error;
      if (attempts > 1) {
        exact(error, RetryExhaustedError);
        expect((error as RetryExhaustedError).attempts).toBe(attempts);
      }
      exact(cause, HttpStatusError);
      expect((cause as HttpStatusError).response.status).toBe(503);
      expect(await (cause as HttpStatusError).response.text()).toBe(body);
      break;
    }
    case "ts-retry-circuit":
      exact(error, Error); expect(error.message).toMatch(/^HTTP 503/); break;
    default: throw new Error("Missing HTTP contract for " + name);
  }
}
export function expectAbort(name: string, error: unknown, reason: unknown) {
  if (name === "ffetch") { exact(error, FfetchAbortError); return; }
  if (name === "ofetch") { exact(error, FetchError); expect((error as Error).cause).toBe(reason); return; }
  if (name === "ts-retry-circuit") {
    exact(error, CircuitAbortedError);
    expect((error as CircuitAbortedError).code).toBe("CIRCUIT_ABORTED"); return;
  }
  exact(error, DOMException);
  expect(error).toBe(reason);
}
export function expectTimeout(name: string, error: unknown, timeoutMs = 100) {
  switch (name) {
    case "ky": exact(error, KyTimeoutError); break;
    case "ofetch": {
      exact(error, FetchError);
      const cause = error.cause as Error & { code: number };
      exact(cause, Error); expect(cause.name).toBe("TimeoutError"); expect(cause.code).toBe(23);
      break;
    }
    case "wretch": exact(error, DOMException); expect(error.name).toBe("AbortError"); break;
    case "resilient-fetch-client": exact(error, TaskCancelledError); expect(error.message).toContain("timed out"); break;
    case "fetch-smartly": exact(error, SmartTimeoutError); expect((error as SmartTimeoutError).timeout).toBe(timeoutMs); break;
    case "@resili/fetch": {
      exact(error, RetryExceededError);
      expect((error as RetryExceededError).attempts).toBe(1);
      const cause = error.cause;
      exact(cause, ResiliTimeoutError);
      expect((cause as ResiliTimeoutError).code).toBe("ERR_TIMEOUT");
      expect((cause as ResiliTimeoutError).timeoutMs).toBe(timeoutMs);
      break;
    }
    case "fetch-resilience": exact(error, ResilienceTimeoutError); break;
    case "flowshield": exact(error, FlowTimeoutError); break;
    case "ts-retry-circuit": exact(error, CircuitTimeoutError); expect((error as CircuitTimeoutError).code).toBe("CIRCUIT_TIMEOUT"); expect((error as CircuitTimeoutError).timeoutMs).toBe(100); break;
    default: throw new Error("Missing timeout contract for " + name);
  }
}
export function expectCircuit(name: string, error: unknown) {
  exact(error, name === "@resili/fetch" ? ResiliCircuitError : FlowCircuitError);
  if (name === "@resili/fetch") expect((error as ResiliCircuitError).code).toBe("ERR_CIRCUIT_OPEN");
}
