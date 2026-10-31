// Both supported runtimes provide the monotonic Performance clock.
declare const performance: { now(): number };

/** Synchronous, opt-in wall-time measurements. No state, IDs or payloads enter the log. */
export const AI_WORK_UNITS = Object.freeze({
  state_copy: "copy",
  hidden_zone_sampling: "population",
  legal_generation: "call",
  input_generation: "call",
  engine_transition: "transition",
  heuristic_inference: "inference",
  nn_inference: "inference",
  nn_training: "batch",
  training_update: "update",
  decision: "decision",
  simulation: "simulation",
  game: "game",
} as const);

export type AiWorkOperation = keyof typeof AI_WORK_UNITS;

export interface AiWorkMeasurement {
  operation: AiWorkOperation;
  unit: (typeof AI_WORK_UNITS)[AiWorkOperation];
  observed: boolean;
  attempted: number;
  returned: number;
  threw: number;
  inclusiveMs: number;
  exclusiveMs: number;
  maxMs: number | null;
  returnedPerSecond: number | null;
}

export interface AiWorkTelemetrySnapshot {
  schemaVersion: 1;
  kind: "ai-work-telemetry";
  clock: "monotonic-wall-ms";
  elapsedMs: number;
  measurements: AiWorkMeasurement[];
}

type Frame = { operation: AiWorkOperation; start: number; childrenMs: number };
type Totals = Omit<
  AiWorkMeasurement,
  "operation" | "unit" | "observed" | "returnedPerSecond"
>;

/**
 * One collector per synchronous workload. Nested durations are inclusive;
 * exclusive time subtracts measured children. Reentrant scopes of the same
 * operation are counted once. A returned game can still be capped/stuck/error;
 * semantic outcomes remain in the game ledger. This is not CPU accounting.
 */
export class AiWorkTelemetry {
  private readonly started: number;
  private last: number = -Infinity;
  private invalid = false;
  private readonly stack: Frame[] = [];
  private readonly totals = new Map<AiWorkOperation, Totals>();

  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = this.readClock();
  }

  private readClock(): number {
    let value: number;
    try {
      value = this.now();
    } catch {
      this.invalid = true;
      throw new Error("unavailable AI telemetry clock");
    }
    if (!Number.isFinite(value) || value < 0 || value < this.last) {
      this.invalid = true;
      throw new Error("invalid AI telemetry clock");
    }
    this.last = value;
    return value;
  }

  private runSync<T>(work: () => T): T {
    const result = work();
    if (
      (typeof result === "object" && result !== null) ||
      typeof result === "function"
    ) {
      // Inspect descriptors without invoking a result's getters. This also
      // recognizes promises from another realm and custom thenables.
      let current: object | null = result;
      while (current) {
        const then = Object.getOwnPropertyDescriptor(current, "then");
        if (then) {
          if (
            !Object.hasOwn(then, "value") ||
            typeof then.value === "function"
          ) {
            this.invalid = true;
            throw new Error("AI work telemetry requires synchronous work");
          }
          break;
        }
        current = Object.getPrototypeOf(current) as object | null;
      }
    }
    return result;
  }

  measure<T>(operation: AiWorkOperation, work: () => T): T {
    if (this.invalid || !Object.hasOwn(AI_WORK_UNITS, operation))
      throw new Error("invalid AI telemetry operation or collector");
    if (this.stack.some((frame) => frame.operation === operation))
      return this.runSync(work);
    const frame: Frame = { operation, start: this.readClock(), childrenMs: 0 };
    const total = this.totals.get(operation) ?? {
      attempted: 0,
      returned: 0,
      threw: 0,
      inclusiveMs: 0,
      exclusiveMs: 0,
      maxMs: null,
    };
    this.totals.set(operation, total);
    total.attempted++;
    this.stack.push(frame);
    let returned = false;
    try {
      const result = this.runSync(work);
      returned = true;
      return result;
    } finally {
      this.stack.pop();
      const duration = this.readClock() - frame.start;
      total.inclusiveMs += duration;
      total.exclusiveMs += Math.max(0, duration - frame.childrenMs);
      total.maxMs = Math.max(total.maxMs ?? 0, duration);
      if (returned) total.returned++;
      else total.threw++;
      const parent = this.stack.at(-1);
      if (parent) parent.childrenMs += duration;
    }
  }

  snapshot(): AiWorkTelemetrySnapshot {
    if (this.invalid || this.stack.length)
      throw new Error("incomplete or invalid AI telemetry");
    const elapsedMs = this.readClock() - this.started;
    return {
      schemaVersion: 1,
      kind: "ai-work-telemetry",
      clock: "monotonic-wall-ms",
      elapsedMs,
      measurements: (Object.keys(AI_WORK_UNITS) as AiWorkOperation[]).map(
        (operation) => {
          const total = this.totals.get(operation);
          const rate =
            total && elapsedMs > 0 ? (total.returned * 1000) / elapsedMs : null;
          if (rate !== null && !Number.isFinite(rate)) {
            this.invalid = true;
            throw new Error("non-finite AI telemetry rate");
          }
          return {
            operation,
            unit: AI_WORK_UNITS[operation],
            observed: total !== undefined,
            attempted: total?.attempted ?? 0,
            returned: total?.returned ?? 0,
            threw: total?.threw ?? 0,
            inclusiveMs: total?.inclusiveMs ?? 0,
            exclusiveMs: total?.exclusiveMs ?? 0,
            maxMs: total?.maxMs ?? null,
            returnedPerSecond: rate,
          };
        }
      ),
    };
  }
}

/** Without a collector the work runs directly, with no clock reads. */
export function measureAiWork<T>(
  telemetry: AiWorkTelemetry | undefined,
  operation: AiWorkOperation,
  work: () => T
): T {
  return telemetry ? telemetry.measure(operation, work) : work();
}
