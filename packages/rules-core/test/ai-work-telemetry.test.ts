import { describe, expect, it } from "vitest";
import { AiWorkTelemetry, measureAiWork } from "../src/ai-work-telemetry";
import {
  createCardInstance,
  type CardDefinition,
  createEmptyGameState,
  mulberry32,
  playTrainingTraceSmoke,
  type Engine,
} from "../src";

describe("AI work telemetry", () => {
  it("separates units, nested inclusive/exclusive wall time and window throughput", () => {
    let now = 0;
    const telemetry = new AiWorkTelemetry(() => now);
    telemetry.measure("decision", () => {
      now = 2;
      telemetry.measure("simulation", () => {
        now = 3;
        telemetry.measure("state_copy", () => {
          now = 5;
        });
        now = 8;
      });
      now = 10;
    });
    now = 20;
    const rows = telemetry.snapshot().measurements;
    expect(rows.find((r) => r.operation === "decision")).toMatchObject({
      unit: "decision",
      attempted: 1,
      returned: 1,
      threw: 0,
      inclusiveMs: 10,
      exclusiveMs: 4,
      maxMs: 10,
      returnedPerSecond: 50,
    });
    expect(rows.find((r) => r.operation === "simulation")).toMatchObject({
      unit: "simulation",
      inclusiveMs: 6,
      exclusiveMs: 4,
    });
    expect(rows.find((r) => r.operation === "state_copy")).toMatchObject({
      unit: "copy",
      inclusiveMs: 2,
      exclusiveMs: 2,
    });
    expect(rows.find((r) => r.operation === "nn_training")).toMatchObject({
      observed: false,
      returned: 0,
      maxMs: null,
      returnedPerSecond: null,
    });
    expect(rows.reduce((sum, r) => sum + r.exclusiveMs, 0)).toBe(10);
  });

  it("retains thrown work without serializing results or exception payloads", () => {
    let now = 0;
    const telemetry = new AiWorkTelemetry(() => now++);
    const secret = {
      toJSON() {
        throw new Error("secret serialization");
      },
    };
    expect(telemetry.measure("state_copy", () => secret)).toBe(secret);
    expect(() =>
      telemetry.measure("engine_transition", () => {
        throw secret;
      })
    ).toThrow();
    const snapshot = telemetry.snapshot();
    expect(
      snapshot.measurements.find((r) => r.operation === "engine_transition")
    ).toMatchObject({
      attempted: 1,
      returned: 0,
      threw: 1,
      inclusiveMs: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    snapshot.measurements[0]!.attempted = 999;
    expect(telemetry.snapshot().measurements[0]!.attempted).toBe(1);
  });

  it("counts reentrant operation scopes once and rejects open snapshots", () => {
    let now = 0;
    const telemetry = new AiWorkTelemetry(() => now++);
    telemetry.measure("input_generation", () => {
      expect(() => telemetry.snapshot()).toThrow(/incomplete/);
      telemetry.measure("input_generation", () => 1);
    });
    expect(
      telemetry
        .snapshot()
        .measurements.find((r) => r.operation === "input_generation")!.attempted
    ).toBe(1);
  });

  it("distinguishes observed zero duration from missing work and rejects broken clocks", () => {
    const telemetry = new AiWorkTelemetry(() => 0);
    telemetry.measure("nn_inference", () => 7);
    expect(
      telemetry
        .snapshot()
        .measurements.find((r) => r.operation === "nn_inference")
    ).toMatchObject({
      observed: true,
      returned: 1,
      maxMs: 0,
      returnedPerSecond: null,
    });
    for (const broken of [NaN, Infinity, -1]) {
      let now = 0;
      const invalid = new AiWorkTelemetry(() => now);
      now = broken;
      expect(() => invalid.measure("simulation", () => 7)).toThrow(/clock/);
      now = 10;
      expect(() => invalid.snapshot()).toThrow(/invalid/);
    }
    let tick = 0;
    const tinyWindow = new AiWorkTelemetry(() => tick);
    tinyWindow.measure("decision", () => 1);
    tick = Number.MIN_VALUE;
    expect(() => tinyWindow.snapshot()).toThrow(/non-finite/);
    expect(measureAiWork(undefined, "decision", () => 42)).toBe(42);
  });

  it("rejects asynchronous work and unavailable clocks instead of publishing early completion", () => {
    const telemetry = new AiWorkTelemetry();
    expect(() => telemetry.measure("game", () => Promise.resolve(1))).toThrow(
      /synchronous/
    );
    expect(() => telemetry.snapshot()).toThrow(/invalid/);
    let getterCalls = 0;
    const nested = new AiWorkTelemetry();
    expect(() =>
      nested.measure("decision", () =>
        nested.measure("decision", () => ({
          get then() {
            getterCalls++;
            return () => {};
          },
        }))
      )
    ).toThrow(/synchronous/);
    expect(getterCalls).toBe(0);
    expect(() => nested.snapshot()).toThrow(/invalid/);
    let fail = false;
    const broken = new AiWorkTelemetry(() => {
      if (fail) throw new Error("private");
      return 0;
    });
    fail = true;
    expect(() => broken.snapshot()).toThrow(/unavailable/);
    fail = false;
    expect(() => broken.snapshot()).toThrow(/invalid/);
  });

  it("measures a bounded real engine game without changing its capped result or emitting state", () => {
    const card: CardDefinition = {
      cardNo: "TEST-TELEMETRY",
      name: "Telemetry fixture",
      colors: ["red"],
      symbolColors: ["red"],
      cost: 1,
      reduction: [],
      reductionSymbols: [],
      category: "spirit",
      printedCategory: "spirit",
      bp: 1000,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      keywordTags: [],
      effects: [],
    };
    const engine: Engine = {
      cards: [card],
      getCardDefinitionById: (id) => (id === card.cardNo ? card : undefined),
      lookups: {
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
        getRegisteredBattleImmediateEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredHandActivatedEffectActions: () => [],
        getRegisteredMagicActions: () => [],
      },
    };
    const initialState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "telemetry-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [
        { id: "alice", handCount: 1, reserveNormalCoreCount: 3 },
        { id: "bob" },
      ],
    });
    initialState.turnNumber = 2;
    initialState.step = "main";
    initialState.window = "none";
    const options = {
      engine,
      initialState,
      maxSteps: 1,
      now: () => 0,
      maxGeneratedChoices: 8,
      recording: { retainFrames: false, retainReplay: false },
    };
    const plain = playTrainingTraceSmoke({ ...options, rng: mulberry32(71) });
    const telemetry = new AiWorkTelemetry();
    const measured = playTrainingTraceSmoke({
      ...options,
      telemetry,
      rng: mulberry32(71),
    });
    expect(measured).toEqual(plain);
    expect(measured.outcome).toBe("capped");
    const snapshot = telemetry.snapshot();
    const rows = snapshot.measurements;
    expect(rows.find((r) => r.operation === "game")!.returned).toBe(1);
    for (const operation of [
      "state_copy",
      "legal_generation",
      "decision",
      "engine_transition",
    ])
      expect(
        rows.find((r) => r.operation === operation)!.returned
      ).toBeGreaterThan(0);
    expect(rows.find((r) => r.operation === "simulation")!.observed).toBe(
      false
    );
    // Retained by the existing Vitest/harness output; this is a tiny regression
    // fixture, never production calibration or evidence of natural completion.
    console.info("AI_TELEMETRY_BOUNDED_FIXTURE", JSON.stringify(snapshot));
  });
});
