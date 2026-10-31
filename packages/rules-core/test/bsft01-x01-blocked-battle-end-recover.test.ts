/**
 * BSFT01-X01「星霊王」Lv4『このアルティメットのアタック時』の後続回復。
 * 「ブロックされたバトルの終了時、このアルティメットは回復できる。」
 *
 * 検証点:
 *  - deferredTo:"battle_end" で即時実行されず pendingBattleEndDeferrals へ予約される。
 *  - executeBattleResolution がブロックされたバトルを解決すると、ConditionClause
 *    kind:"battle_was_blocked"（fireBattleEndDeferrals が battleResolutionGroup の
 *    blockedBy から算出し triggerContext 経由で運ぶ）が成立し、execute/decline の
 *    executionMode:"optional" 選択を経て回復する。
 *  - ブロックされなかったバトルでは条件不成立で回復しない。
 * ルール正源: カード本文 [7,8]。バトル終了まで延期した手順も同じイベント文脈を使う。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState, ActiveAttack } from "../src/index";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
const star = cardNoMap.get("BSFT01-X01")!;
// アタック時効果の後半だけを開始し、ブロック有無が再開後にも保持されるか確認する。
const RECOVER_EFFECT_INDEX = 3;
const recoverEffect = star.effects[RECOVER_EFFECT_INDEX]!;

const ALICE = "alice";
const BOB = "bob";

function buildMidBattleState(blocked: boolean): GameState {
  const starInstance = createCardInstance(star, {
    instanceId: "star-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2, // Lv4 (requiredCores:2)
    exhaustState: "exhausted",
  });
  const blockerInstance = createCardInstance(
    getCardDefinitionById("BSDB01-C05")!,
    {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    }
  );
  const activeAttack: ActiveAttack = {
    attackId: "attack:be-star:1",
    primaryEntityId: "be-star",
    participantEntityIds: ["be-star"],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [
      {
        participantEntityId: "be-star",
        blockedByEntityIds: blocked ? ["be-blocker"] : [],
      },
    ],
    symbolResolutionOrder: ["be-star"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
  };
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: blocked ? [starInstance, blockerInstance] : [starInstance],
    }),
    turnNumber: 2,
    activePlayerId: ALICE,
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: blocked
      ? [
          {
            entityId: "be-star",
            resolvedBp: 30000,
            attackState: "attacking",
            resolvedSymbols: [],
            memberInstanceIds: ["star-1"],
          },
          {
            entityId: "be-blocker",
            resolvedBp: 2000,
            attackState: "blocking",
            resolvedSymbols: [],
            memberInstanceIds: ["blocker-1"],
          },
        ]
      : [
          {
            entityId: "be-star",
            resolvedBp: 30000,
            attackState: "attacking",
            resolvedSymbols: [],
            memberInstanceIds: ["star-1"],
          },
        ],
  };
}

function resolveOptionalRecoverChoices(state: GameState): GameState {
  let s = state;
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return s;
}

describe("BSFT01-X01（ブロックされたバトルの終了時、回復できる）", () => {
  it("ブロックされたバトル: battle_was_blocked 成立 → 回復する", () => {
    const queued = executeEffect({
      chainId: "test:bsft01-x01-blocked-battle-end-recover:139",
      state: buildMidBattleState(true),
      effect: recoverEffect,
      startFromStepIndex: 2,
      sourceInstanceId: "star-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: RECOVER_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const finalState = resolveOptionalRecoverChoices(resolved.state);

    const starCard = finalState.cardInstances.find(
      (c) => c.instanceId === "star-1"
    )!;
    expect(starCard.exhaustState).toBe("recovered");
    expect(finalState.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("ブロックされなかったバトル: battle_was_blocked 不成立 → 回復しない", () => {
    const queued = executeEffect({
      chainId: "test:bsft01-x01-blocked-battle-end-recover:167",
      state: buildMidBattleState(false),
      effect: recoverEffect,
      startFromStepIndex: 2,
      sourceInstanceId: "star-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: RECOVER_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const finalState = resolveOptionalRecoverChoices(resolved.state);

    const starCard = finalState.cardInstances.find(
      (c) => c.instanceId === "star-1"
    )!;
    expect(starCard.exhaustState).toBe("exhausted");
    expect(finalState.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("同時アタック (groupMode:simultaneous): 自分自身はブロックされず共同攻撃側だけブロックされた場合は回復しない (adversarial verifier round1 lens1 指摘の回帰)", () => {
    const starInstance = createCardInstance(star, {
      instanceId: "star-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv4
      exhaustState: "exhausted",
    });
    const allyInstance = createCardInstance(star, {
      instanceId: "ally-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const blockerInstance = createCardInstance(
      getCardDefinitionById("BSDB01-C05")!,
      {
        instanceId: "blocker-1",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }
    );
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-star:1",
      primaryEntityId: "be-star",
      participantEntityIds: ["be-star", "be-ally"],
      groupMode: "simultaneous",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        // 自分自身 (be-star) はブロックされていない。
        { participantEntityId: "be-star", blockedByEntityIds: [] },
        // 共同アタック側 (be-ally) だけブロックされている。
        { participantEntityId: "be-ally", blockedByEntityIds: ["be-blocker"] },
      ],
      symbolResolutionOrder: ["be-star", "be-ally"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [starInstance, allyInstance, blockerInstance],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-star",
          resolvedBp: 30000,
          attackState: "attacking",
          resolvedSymbols: [],
          memberInstanceIds: ["star-1"],
        },
        {
          entityId: "be-ally",
          resolvedBp: 30000,
          attackState: "attacking",
          resolvedSymbols: [],
          memberInstanceIds: ["ally-1"],
        },
        {
          entityId: "be-blocker",
          resolvedBp: 2000,
          attackState: "blocking",
          resolvedSymbols: [],
          memberInstanceIds: ["blocker-1"],
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bsft01-x01-blocked-battle-end-recover:269",
      state,
      effect: recoverEffect,
      startFromStepIndex: 2,
      sourceInstanceId: "star-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: RECOVER_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const finalState = resolveOptionalRecoverChoices(resolved.state);

    const starCard = finalState.cardInstances.find(
      (c) => c.instanceId === "star-1"
    )!;
    // be-star 自身はブロックされていないので回復しない (be-ally がブロックされただけでは不成立)。
    expect(starCard.exhaustState).toBe("exhausted");
    expect(finalState.pendingBattleEndDeferrals).toHaveLength(0);
  });
});
