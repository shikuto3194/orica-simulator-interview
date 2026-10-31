/**
 * P3-63 残留懸念 #3: 追加ターン中の step skip が trigger event 発火に与える影響の検証。
 *
 * BSTH02-M01 のように `extraTurnState.skipSteps = ["core", "attack"]` を持つ
 * 追加ターン中、`advanceStep` の skip loop で nextStep が "core" を飛ばして
 * "draw" に到達する。このとき:
 *
 *  - skipped step の `start_step` イベントは発火しない (phase timing で step=core を
 *    listen する効果には pending が積まれない)。
 *  - 実際に入った step (draw) の `start_step` イベントは発火する (phase timing で
 *    step=draw を listen する効果には通常通り pending が積まれる)。
 *
 * 「コアステップ開始時に発揮」効果が追加ターンで誤発火しないことを担保する。
 */
import { describe, expect, it } from "vitest";
import { advanceStep, createCardInstance, createEmptyGameState } from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src";

function makePhaseStartListener(
  cardNo: string,
  step: "core" | "draw"
): CardDefinition {
  return {
    cardNo,
    name: `phase-start listener ${step}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step, subPhase: "start", whose: "self" },
        applicability: { zone: "field" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

const coreListenerCard = makePhaseStartListener(
  "P3-63-STEP-SKIP-CORE-LISTENER",
  "core"
);
const drawListenerCard = makePhaseStartListener(
  "P3-63-STEP-SKIP-DRAW-LISTENER",
  "draw"
);

const cardNoMap = new Map<string, CardDefinition>([
  [coreListenerCard.cardNo, coreListenerCard],
  [drawListenerCard.cardNo, drawListenerCard],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup([
  coreListenerCard,
  drawListenerCard,
]);

function buildAliceExtraTurnState(
  skipSteps: readonly ("core" | "attack")[]
): GameState {
  const coreInst = createCardInstance(coreListenerCard, {
    instanceId: "core-listener-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const drawInst = createCardInstance(drawListenerCard, {
    instanceId: "draw-listener-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    turnNumber: 6,
    activePlayerId: "alice",
    step: "start",
    window: "none",
    cardInstances: [coreInst, drawInst],
    extraTurnState: {
      ownerPlayerId: "alice",
      skipSteps,
      returnContext: null,
    },
  };
}

describe("P3-63 残留懸念 #3: step skip 時の trigger event 発火", () => {
  it("skipSteps=[core]: core 開始時 listener は発火しない / draw 開始時 listener は発火する", () => {
    const initial = buildAliceExtraTurnState(["core"]);
    expect(initial.pendingTriggeredEffects).toHaveLength(0);

    // start → (core skip) → draw
    const after = advanceStep(initial, getCardDefinitionById, triggeredLookup);
    expect(after.step).toBe("draw");

    // step=core を listen する pending が存在しないことを確認
    const coreStepPending = after.pendingTriggeredEffects.filter(
      (p) => p.event?.step === "core"
    );
    const drawStepPending = after.pendingTriggeredEffects.filter(
      (p) => p.event?.step === "draw"
    );

    expect(coreStepPending).toHaveLength(0);
    expect(drawStepPending.length).toBeGreaterThan(0);

    // skip log の存在も再確認 (extra-turn-skip:6:alice:core)
    expect(
      after.log.some((l) => l.startsWith("step:extra-turn-skip:6:alice:core"))
    ).toBe(true);
    // 通常遷移ログは start->draw (start->core ではない)
    expect(
      after.log.some((l) => l.startsWith("step:6:alice:start->draw"))
    ).toBe(true);
    expect(
      after.log.some((l) => l.startsWith("step:6:alice:start->core"))
    ).toBe(false);
  });

  it("skipSteps なし (通常進行): core 開始時 listener は通常通り発火する (対照群)", () => {
    // alice の追加ターンではない通常ターン: extraTurnState なし、step=start から
    // advanceStep で start → core へ。core listener が発火することを確認。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const coreInst = createCardInstance(coreListenerCard, {
      instanceId: "core-listener-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const normalState: GameState = {
      ...base,
      turnNumber: 3, // 1st-turn skip も避ける
      activePlayerId: "alice",
      step: "start",
      window: "none",
      cardInstances: [coreInst],
    };

    const after = advanceStep(
      normalState,
      getCardDefinitionById,
      triggeredLookup
    );
    expect(after.step).toBe("core");

    const coreStepPending = after.pendingTriggeredEffects.filter(
      (p) => p.event?.step === "core"
    );
    expect(coreStepPending.length).toBeGreaterThan(0);
  });
});
