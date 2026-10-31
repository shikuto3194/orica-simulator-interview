/**
 * P3-14 C-2 (effect_resisted): usageLimit.unlessAffectedByOpponent。
 *
 * BSTH01-C21「これらの効果が相手の効果を受けなかったとき、ゲーム中に1回ずつしか使えない」。
 * - 相手の restrict_end_* 妨害で終了効果が no-op になった
 *   使用は使用記録が払い戻され、制限を消費しない。
 * - 妨害なく解決した使用は記録が残る (ゲーム1回制限が立つ)。
 */
import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  ContinuousEffect,
  EffectUsageLimit,
  GameState,
  ActiveAttack,
} from "../src/model";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  finalizePendingAttackStepEndFinalizations,
  finalizePendingTurnEndFinalizations,
} from "../src/effect/structured-state-grants";
import { recordEffectUsageIfLimited } from "../src/legal/legal-actions-shared";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { Effect } from "../src/dsl-types";

const USAGE_LIMIT: EffectUsageLimit = {
  kind: "per_card_name",
  duration: "game",
  unlessAffectedByOpponent: true,
};

const FLASH_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  usageLimit: USAGE_LIMIT,
  steps: [{ action: { kind: "end_attack_step" } }],
} as Effect;

const END_TURN_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  usageLimit: USAGE_LIMIT,
  steps: [{ action: { kind: "end_turn" } }],
} as Effect;

const END_BATTLE_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  usageLimit: USAGE_LIMIT,
  steps: [{ action: { kind: "end_battle" } }],
} as Effect;

const END_SINGLE_BATTLE_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  usageLimit: USAGE_LIMIT,
  steps: [{ action: { kind: "end_single_battle" } }],
} as Effect;

function makeMagicDef(): CardDefinition {
  return {
    cardNo: "UL-MAGIC-01",
    name: "UL テストマジック",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      FLASH_EFFECT,
      END_TURN_EFFECT,
      END_BATTLE_EFFECT,
      END_SINGLE_BATTLE_EFFECT,
    ],
  } as CardDefinition;
}

function makeRestrictionCe(
  modifierTag: ContinuousEffect["modifierTag"] = "restrict_end_attack_step",
  actingPlayerId: string = "bob"
): ContinuousEffect {
  return {
    effectId: "test-restrict-1",
    sourceInstanceId: `${actingPlayerId}-nexus-1`,
    sourceDefinitionId: `${actingPlayerId.toUpperCase()}-NEXUS`,
    actingPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag,
    targetInstanceId: "alice",
  };
}

function buildState(
  withRestriction: boolean,
  modifierTag: ContinuousEffect["modifierTag"] = "restrict_end_attack_step"
): {
  state: GameState;
  def: CardDefinition;
} {
  const def = makeMagicDef();
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  });
  let state: GameState = {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 2,
    activeContinuousEffects: withRestriction
      ? [makeRestrictionCe(modifierTag)]
      : [],
  };
  // 使用宣言時の usageLimit 消費を再現
  state = recordEffectUsageIfLimited({
    state,
    sourceInstanceId: "magic-1",
    sourceDefinitionId: def.cardNo,
    playerId: "alice",
    effectLabel: "effect:0",
    usageLimit: USAGE_LIMIT,
  });
  expect(state.effectUsageRecords).toHaveLength(1);
  return { state, def };
}

function run(
  state: GameState,
  def: CardDefinition,
  effect: Effect = FLASH_EFFECT
): GameState {
  return executeEffect({
    chainId: "test:usage-limit-unless-affected:145",
    state,
    effect,
    sourceInstanceId: "magic-1",
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) =>
      id === def.cardNo ? def : undefined,
    getRegisteredTriggeredEffectActions: () => [],
    recordedUsage: {
      effectLabel: "effect:0",
      usageLimit: USAGE_LIMIT,
    },
  });
}

function withActiveBattle(state: GameState): GameState {
  const activeAttack: ActiveAttack = {
    attackId: "ul-attack-1",
    primaryEntityId: "ul-attacker-entity",
    participantEntityIds: ["ul-attacker-entity"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [
      {
        participantEntityId: "ul-attacker-entity",
        blockedByEntityIds: [],
      },
    ],
    symbolResolutionOrder: ["ul-attacker-entity"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...state,
    activeAttack,
    battleEntities: [
      {
        entityId: "ul-attacker-entity",
        memberInstanceIds: ["magic-1"],
        resolvedBp: 1000,
        resolvedSymbols: ["yellow"],
        attackState: "attacking",
      },
    ],
  };
}

describe("P3-14 C-2: usageLimit.unlessAffectedByOpponent (BSTH01-C21 型)", () => {
  it("相手の restrict_end_attack_step に妨害された使用は記録が払い戻される", () => {
    const { state, def } = buildState(true);
    const after = run(state, def);
    // 妨害により step は進まない
    expect(after.step).toBe("attack");
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_attack_step:blocked-by-restriction:")
      )
    ).toBe(true);
    // 使用記録は払い戻し → ゲーム1回制限を消費しない
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("妨害なく解決した使用は記録が残る (ゲーム1回制限が立つ)", () => {
    const { state, def } = buildState(false);
    const queued = run(state, def);
    expect(queued.pendingAttackStepEndFinalizations).toHaveLength(1);
    const after = finalizePendingAttackStepEndFinalizations(queued);
    expect(after.step).toBe("end");
    expect(after.effectUsageRecords).toHaveLength(1);
  });

  it("相手の restrict_end_turn に妨害された使用も記録が払い戻される", () => {
    const { state, def } = buildState(true, "restrict_end_turn");
    const after = run(state, def, END_TURN_EFFECT);
    expect(after.step).toBe("attack");
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_turn:blocked-by-restriction:")
      )
    ).toBe(true);
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("相手の restrict_end_battle に妨害された battle end 使用も記録が払い戻される", () => {
    const { state, def } = buildState(true, "restrict_end_battle");
    const after = run(withActiveBattle(state), def, END_BATTLE_EFFECT);
    expect(after.activeAttack?.attackId).toBe("ul-attack-1");
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_battle:blocked-by-restriction:")
      )
    ).toBe(true);
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("相手の restrict_end_battle に妨害された end_single_battle 使用も記録が払い戻される", () => {
    const { state, def } = buildState(true, "restrict_end_battle");
    const after = run(withActiveBattle(state), def, END_SINGLE_BATTLE_EFFECT);
    expect(after.activeAttack?.attackId).toBe("ul-attack-1");
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_single_battle:blocked-by-restriction:")
      )
    ).toBe(true);
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("実際のターン終了時に restrict_end_turn が成立した使用も記録が払い戻される", () => {
    const { state, def } = buildState(false, "restrict_end_turn");
    const queued = run(state, def, END_TURN_EFFECT);
    expect(queued.pendingTurnEndFinalizations).toHaveLength(1);
    expect(queued.effectUsageRecords).toHaveLength(1);

    const after = finalizePendingTurnEndFinalizations({
      ...queued,
      activeContinuousEffects: [makeRestrictionCe("restrict_end_turn")],
    });

    expect(after.step).toBe("attack");
    expect(after.pendingTurnEndFinalizations).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_turn:blocked-by-restriction:")
      )
    ).toBe(true);
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(true);
  });

  it("実際のターン終了時に自分由来の restrict_end_turn が成立しても記録は払い戻さない", () => {
    const { state, def } = buildState(false, "restrict_end_turn");
    const queued = run(state, def, END_TURN_EFFECT);
    expect(queued.pendingTurnEndFinalizations).toHaveLength(1);
    expect(queued.effectUsageRecords).toHaveLength(1);

    const after = finalizePendingTurnEndFinalizations({
      ...queued,
      activeContinuousEffects: [
        makeRestrictionCe("restrict_end_turn", "alice"),
      ],
    });

    expect(after.step).toBe("attack");
    expect(after.pendingTurnEndFinalizations).toHaveLength(0);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:end_turn:blocked-by-restriction:")
      )
    ).toBe(true);
    expect(after.effectUsageRecords).toHaveLength(1);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:usage-refund:affected-by-opponent:")
      )
    ).toBe(false);
  });
});
