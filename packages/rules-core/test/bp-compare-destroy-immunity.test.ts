/**
 * 「BP比べでは破壊されない」(cannot_be_destroyed_by_bp_compare) 耐性の検証。
 *
 * ルール正源: 10_rules/04_state-based-rules.md §BP比べ破壊の cause 分類。
 * バトルの BP比べ (queueBattleResolutionDestroys) と効果の bp_compare_destroy の
 * 両 BP比較破壊サイトで本耐性を参照して破壊を阻止する。通常の効果破壊・離脱
 * (cannot_be_destroyed 等) には影響しない別軸の耐性。
 *
 * 着地カード: BSTH09.2-転醒R01(B)「[ディスガイザー]二ツ岩 マミゾウ」[5,6]
 *   Lv2-Lv3 このスピリットは、BP比べでは破壊されない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createEmptyGameState,
  createCardInstance,
  executeBattleResolution,
} from "../src";
import type {
  CardDefinition,
  GameState,
  Effect,
  ContinuousEffect,
  ActiveAttack,
  BattleEntity,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isImmuneToBpCompareDestroy } from "../src/effect/effect-resistance-check";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";

/** per-target snapshot 形の cannot_be_destroyed_by_bp_compare CE を作る。 */
function bpcImmunityCE(
  targetInstanceId: string,
  ownerPlayerId: string,
  source: "all" | "opponent_effect" = "all"
): ContinuousEffect {
  return {
    effectId: `ce-bpc-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "test-def",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed_by_bp_compare",
    targetInstanceId,
    metadata: { source },
  };
}

function cannotLeaveFieldCE(
  targetInstanceId: string,
  ownerPlayerId: string,
  source: "all" | "opponent" | "opponent_effect"
): ContinuousEffect {
  return {
    effectId: `ce-cannot-leave-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "test-def",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_leave_field",
    targetInstanceId,
    metadata: { source },
  };
}

// ============================================================
// 1. ヘルパ isImmuneToBpCompareDestroy の意味論
// ============================================================
describe("isImmuneToBpCompareDestroy（耐性判定ヘルパ）", () => {
  function stateWithCard(ce?: ContinuousEffect): {
    state: GameState;
    cardInstanceId: string;
  } {
    const c = createCardInstance(card("BSDB01-C05"), {
      instanceId: "krillin",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ cardInstances: [c] });
    const state = ce ? { ...base, activeContinuousEffects: [ce] } : base;
    return { state, cardInstanceId: "krillin" };
  }

  it("CE 無し: 免疫なし (false)", () => {
    const { state } = stateWithCard();
    const c = state.cardInstances[0]!;
    expect(isImmuneToBpCompareDestroy(state, c, BOB, getDef)).toBe(false);
  });

  it("source:'all': 破壊元に関わらず免疫 (true)", () => {
    const { state } = stateWithCard(bpcImmunityCE("krillin", ALICE, "all"));
    const c = state.cardInstances[0]!;
    expect(isImmuneToBpCompareDestroy(state, c, BOB, getDef)).toBe(true);
    expect(isImmuneToBpCompareDestroy(state, c, ALICE, getDef)).toBe(true);
  });

  it("source:'opponent_effect': 対戦相手起因のときのみ免疫", () => {
    const { state } = stateWithCard(
      bpcImmunityCE("krillin", ALICE, "opponent_effect")
    );
    const c = state.cardInstances[0]!;
    // 破壊元が対戦相手 (BOB) → 免疫
    expect(isImmuneToBpCompareDestroy(state, c, BOB, getDef)).toBe(true);
    // 破壊元が自分 (ALICE = controller) → 免疫しない
    expect(isImmuneToBpCompareDestroy(state, c, ALICE, getDef)).toBe(false);
  });

  it("『防げない』(unpreventable) は耐性を貫通する (false)", () => {
    const { state } = stateWithCard(bpcImmunityCE("krillin", ALICE, "all"));
    const c = state.cardInstances[0]!;
    expect(
      isImmuneToBpCompareDestroy(state, c, BOB, getDef, "unpreventable")
    ).toBe(false);
  });
});

// ============================================================
// 2. 効果の bp_compare_destroy 経路での免疫
// ============================================================
const compareEffect: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "bp_compare_destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 1,
        },
      },
    },
  ],
};

function runCompare(state: GameState, sourceInstanceId: string): GameState {
  return executeEffect({
    chainId: "test:bp-compare-destroy-immunity:157",
    state,
    effect: compareEffect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function srcGoku() {
  // BSDB01-C01 Lv1 = BP 4000
  return createCardInstance(card("BSDB01-C01"), {
    instanceId: "src-goku",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
}

describe("効果 bp_compare_destroy: BP比べ免疫", () => {
  it("免疫を持つ低 BP 相手 (2000 ≤ 4000) は破壊されない", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const base = createEmptyGameState({ cardInstances: [src, opp] });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [bpcImmunityCE("opp-krillin", BOB, "all")],
    };
    const after = runCompare(state, "src-goku");
    // 免疫により相手は残る。源 (4000 > 2000) も残る。
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-krillin")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
  });

  it("免疫を持つ源は不利な比較 (4000 ≤ 5000) でも破壊されない", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C02"), {
      instanceId: "opp-vegeta",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 5000
    });
    const base = createEmptyGameState({ cardInstances: [src, opp] });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [bpcImmunityCE("src-goku", ALICE, "all")],
    };
    const after = runCompare(state, "src-goku");
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-vegeta")!
        .pendingLeaveKind
    ).toBeNull();
  });

  it("免疫が無ければ従来どおり破壊される (回帰ベースライン)", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const after = runCompare(
      createEmptyGameState({ cardInstances: [src, opp] }),
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-krillin")!
        .pendingLeaveKind
    ).toBe("destroy");
  });
});

// ============================================================
// 3. バトル解決 (queueBattleResolutionDestroys) での免疫
// ============================================================
describe("バトル解決: BP比べ免疫", () => {
  function buildBlockedBattle(
    withImmunity: boolean,
    leaveResistanceSource?: "opponent" | "opponent_effect"
  ): GameState {
    // 同値 (4000=4000) ブロック → 通常は両方破壊。
    const attacker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "attacker-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // BP 4000
    });
    const blocker = createCardInstance(card("BSDB01-C01"), {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 4000
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: ["be-2"] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const battleEntities: BattleEntity[] = [
      {
        entityId: "be-1",
        resolvedBp: 4000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["attacker-1"],
      },
      {
        entityId: "be-2",
        resolvedBp: 4000,
        attackState: "blocking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["blocker-1"],
      },
    ];
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [attacker, blocker],
    });
    const activeContinuousEffects: ContinuousEffect[] = [];
    if (withImmunity) {
      activeContinuousEffects.push(bpcImmunityCE("attacker-1", ALICE, "all"));
    }
    if (leaveResistanceSource) {
      activeContinuousEffects.push(
        cannotLeaveFieldCE("attacker-1", ALICE, leaveResistanceSource)
      );
    }

    return {
      ...base,
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities,
      ...(activeContinuousEffects.length > 0
        ? { activeContinuousEffects }
        : {}),
    };
  }

  // executeBattleResolution は末尾で flushPendingLeaves を呼ぶため、破壊された
  // カードは trash ゾーンへ移動する。生存判定は zone === "field" で行う。
  function zonesAfterResolution(state: GameState): {
    attacker: string;
    blocker: string;
  } {
    const resolved = executeBattleResolution({
      state,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
    });
    const find = (id: string) =>
      resolved.state.cardInstances.find((x) => x.instanceId === id)!.zone;
    return { attacker: find("attacker-1"), blocker: find("blocker-1") };
  }

  it("免疫が無ければ同値で両方破壊 (回帰ベースライン)", () => {
    const r = zonesAfterResolution(buildBlockedBattle(false));
    expect(r.attacker).toBe("trash");
    expect(r.blocker).toBe("trash");
  });

  it("免疫アタッカーはバトルの BP比べで破壊されず、ブロッカーだけ破壊される", () => {
    const r = zonesAfterResolution(buildBlockedBattle(true));
    expect(r.attacker).toBe("field");
    expect(r.blocker).toBe("trash");
  });

  it("source:opponent の離脱耐性はバトルの BP比べ破壊を止め、source:opponent_effect は止めない", () => {
    const opponent = zonesAfterResolution(
      buildBlockedBattle(false, "opponent")
    );
    expect(opponent.attacker).toBe("field");
    expect(opponent.blocker).toBe("trash");

    const opponentEffect = zonesAfterResolution(
      buildBlockedBattle(false, "opponent_effect")
    );
    expect(opponentEffect.attacker).toBe("trash");
    expect(opponentEffect.blocker).toBe("trash");
  });
});

// ============================================================
// 4. カードデータ統合: BSTH09.2-転醒R01(B) [5,6]
// ============================================================
describe("BSTH09.2-転醒R01(B) [5,6] カード配線", () => {
  it("Lv2-Lv3 効果が cannot_be_destroyed_by_bp_compare CE を登録する", () => {
    const def = card("BSTH09.2-転醒R01(B)");
    const bpcEffect = (def.effects ?? []).find(
      (e) => JSON.stringify(e.textRef) === JSON.stringify([5, 6])
    );
    expect(bpcEffect).toBeDefined();
    expect((bpcEffect as { stub?: string }).stub).toBeUndefined();

    // Lv2 (normalCoreCount 3) の自身を場に出して効果を実行 → CE 登録を確認。
    const self = createCardInstance(def, {
      instanceId: "mamizou",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2 (requiredCores 3)
    });
    const state = createEmptyGameState({ cardInstances: [self] });
    const after = executeEffect({
      chainId: "test:bp-compare-destroy-immunity:389",
      state,
      effect: bpcEffect!,
      sourceInstanceId: "mamizou",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const ce = after.activeContinuousEffects.find(
      (e) => e.modifierTag === "cannot_be_destroyed_by_bp_compare"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("mamizou");
  });
});
