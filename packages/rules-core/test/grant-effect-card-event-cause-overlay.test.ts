/**
 * ENGINE-grant-effect-leave-field-trigger (残スコープ, 2026-07-02 engine-claude lane):
 *
 * grantedEffectMatchesEvent の card_event 分岐が timing.cause を評価することを検証する。
 * 従来は eventKind umbrella (leave_field ⊇ destroy/vanish/bounce) のみで一致判定していたため、
 * BSFT01-TR05(A) 型「相手によってフィールドを離れるとき、残せる」を grant_effect+stay_on_field
 * へ変換すると『相手によって』以外 (自分の効果由来の離脱等) でも誤って発火する gap があった。
 * trigger-system.ts matchesTriggerEvent の matcher.cause と同じ集合包含 + fail-closed で
 * card_event の cause フィルタを付与検出側にも適用する。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe: "テスト種族",
    colors: ["red"],
  } as CardDefinition;
}

const SOURCE_DEF = spiritDef("GRANT-CAUSE-SOURCE");
const TARGET_DEF = spiritDef("GRANT-CAUSE-TARGET");
const DEFS: Record<string, CardDefinition> = {
  "GRANT-CAUSE-SOURCE": SOURCE_DEF,
  "GRANT-CAUSE-TARGET": TARGET_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/** BSFT01-TR05(A) 型: 相手によって離れるときのみ反応する stay_on_field 誘発。 */
const CAUSE_SCOPED_GRANTED_EFFECT: Effect = {
  timing: {
    kind: "card_event",
    event: "leave_field",
    cause: ["opponent_effect", "battle"],
  },
  executionMode: "optional",
  steps: [{ action: { kind: "stay_on_field", target: { kind: "self" } } }],
} as unknown as Effect;

const GRANT_ACTION: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "grant_effect",
        target: {
          kind: "filter",
          player: "self",
          count: "all",
          filter: { category: ["spirit"] },
        },
        grantedEffect: CAUSE_SCOPED_GRANTED_EFFECT,
      },
    },
  ],
} as unknown as Effect;

function registeredState(): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const target = createCardInstance(TARGET_DEF, {
    instanceId: "target-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    cardInstances: [source, target],
    activeContinuousEffects: [],
  };
  return executeEffect({
    chainId: "test:grant-effect-card-event-cause-overlay:96",
    state,
    effect: GRANT_ACTION,
    sourceInstanceId: "source-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

function pendingsFor(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (p) => p.mechanic?.kind === "granted_effect"
  );
}

describe("ENGINE-grant-effect-leave-field-trigger: card_event cause overlay", () => {
  it("timing.cause 集合に含まれる event.cause (opponent_effect) は一致する", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:117",
          eventKind: "destroy",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(1);
  });

  it("timing.cause 集合に含まれる event.cause (battle) は一致する", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:134",
          eventKind: "vanish",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "battle",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(1);
  });

  it("既存の『相手によって』cause ペアは opponent_bp_compare も一致する", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:151",
          eventKind: "destroy",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "opponent_bp_compare",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(1);
  });

  it("timing.cause 集合に含まれない event.cause (self_effect) は一致しない (誤発火防止)", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:168",
          eventKind: "destroy",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "self_effect",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(0);
  });

  it("event.cause 未設定は fail-closed で一致しない (cause 情報が無いイベントでは判定不能)", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:185",
          eventKind: "bounce",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(0);
  });

  it("timing.cause=[bp_compare] は opponent_bp_compare も一致する (BP比べ互換 cause)", () => {
    const bpCompareEffect: Effect = {
      timing: {
        kind: "card_event",
        event: "leave_field",
        cause: ["bp_compare"],
      },
      executionMode: "optional",
      steps: [{ action: { kind: "stay_on_field", target: { kind: "self" } } }],
    } as unknown as Effect;
    const grantAction: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["spirit"] },
            },
            grantedEffect: bpCompareEffect,
          },
        },
      ],
    } as unknown as Effect;

    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(TARGET_DEF, {
      instanceId: "target-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state = executeEffect({
      chainId: "test:grant-effect-card-event-cause-overlay:237",
      state: {
        ...base,
        activePlayerId: ALICE,
        cardInstances: [source, target],
        activeContinuousEffects: [],
      },
      effect: grantAction,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:253",
          eventKind: "destroy",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "opponent_bp_compare",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(1);
  });

  it("timing.cause 未指定の付与効果は cause を問わず一致する (後方互換)", () => {
    const noCauseEffect: Effect = {
      timing: { kind: "card_event", event: "leave_field" },
      executionMode: "optional",
      steps: [{ action: { kind: "stay_on_field", target: { kind: "self" } } }],
    } as unknown as Effect;
    const grantAction: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["spirit"] },
            },
            grantedEffect: noCauseEffect,
          },
        },
      ],
    } as unknown as Effect;

    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(TARGET_DEF, {
      instanceId: "target-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state = executeEffect({
      chainId: "test:grant-effect-card-event-cause-overlay:302",
      state: {
        ...base,
        activePlayerId: ALICE,
        cardInstances: [source, target],
        activeContinuousEffects: [],
      },
      effect: grantAction,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-card-event-cause-overlay:318",
          eventKind: "destroy",
          relatedInstanceId: "target-1",
          relatedPlayerId: ALICE,
          cause: "self_effect",
        },
      ],
      getDef
    );
    expect(pendingsFor(next)).toHaveLength(1);
  });
});
