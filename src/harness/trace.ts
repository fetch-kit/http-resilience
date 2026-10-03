export interface TraceEvent {
  atMs: number;
  attempt: number;
  type: string;
  data: Record<string, unknown>;
}

export class Trace {
  readonly events: TraceEvent[] = [];
  private readonly startedAt: number;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  record(attempt: number, type: string, data: Record<string, unknown> = {}) {
    this.events.push({
      atMs: this.now() - this.startedAt,
      attempt,
      type,
      data,
    });
  }
}

export function errorDetails(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { constructor: error.constructor.name, name: error.name, message: error.message }
    : { value: String(error) };
}
