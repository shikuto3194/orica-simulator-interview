/**
 * BSRK01-X02 [京都動乱編]緋村 剣心 effects[1]
 *   「さらに、バトル終了時、Lv2以上なら、手札/トラッシュのマジックカード1枚を除外することで
 *   このスピリットは回復する。」(10_rules/02 形式5、自分参加バトル限定の battle_end 観測)
 *
 * cost が remove_from_game (手札/トラッシュから1枚選択必須) な点が BSTH03-転醒X01(B) の
 * count_decrease (対象選択不要) と異なる。宣言時 (battle-immediate legal action の
 * targetInstanceIds) に選択済みの対象を PendingBattleEndDeferral が保持せず、
 * fireBattleEndDeferrals 再発火時に対象0件で不発になっていたギャップ
 * (ENGINE-battle-end-deferral-target-carry) の回帰テスト。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X02 = cardNoMap.get("BSRK01-X02")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noLookup = () => [];
const battleImmediateLookup = buildBattleImmediateEffectLookup(ALL_CARDS);

const ALICE = "alice";
const BOB = "bob";

const TEST_MAGIC_DEF: CardDefinition = {
  cardNo: "TEST-RK01-X02-MAGIC",
  name: "テストマジック",
  printedCategory: "magic",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

function recoverEffect() {
  return X02.effects!.find(
    (e) =>
      "deferredTo" in e.timing &&
      (e.timing as { deferredTo?: string }).deferredTo === "battle_end"
  )!;
}

function makeMidBattleState(instanceId: string, magicHandCardId: string) {
  const attackId = `attack-${instanceId}`;
  const entityId = `battle-entity:${instanceId}`;
  const spirit: CardInstance = {
    ...createCardInstance(X02, {
      instanceId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2 (requiredCores:3)
      exhaustState: "exhausted",
    }),
    // 【煌臨中】= 表向き煌臨元≧1 (10_rules/08a L34)
    underCards: [{ cardInstanceId: "kenshin-src", role: "advent_source" }],
  };
  const magicCard: CardInstance = createCardInstance(TEST_MAGIC_DEF, {
    instanceId: magicHandCardId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const activeAttack: ActiveAttack = {
    attackId,
    primaryEntityId: entityId,
    participantEntityIds: [entityId],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [
      { participantEntityId: entityId, blockedByEntityIds: [] },
    ],
    symbolResolutionOrder: [entityId],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [spirit, magicCard],
      playerOverrides: [{ countValue: 8 }, {}],
    }),
    activePlayerId: ALICE,
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: [
      {
        entityId,
        memberInstanceIds: [instanceId],
        resolvedBp: 20000,
        resolvedSymbols: [],
        attackState: "attacking",
      },
    ],
  };
  return { state, attackId, entityId, spirit };
}

const legalOptions = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: noLookup,
  getRegisteredBurstActions: undefined,
  getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  getRegisteredFieldCardEffectActions: noLookup,
};

function finishBattle(state: GameState): GameState {
  return executeBattleResolution({
    state,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions: undefined,
  }).state;
}

/** registrationIndex 1 (recover effect) の non-skip 宣言アクションを選ぶ。 */
function findRecoverDeclareAction(
  state: GameState,
  instanceId: string,
  actingPlayerId: string
) {
  return getLegalActions({ state, actingPlayerId, ...legalOptions }).find(
    (a) =>
      a.kind === "resolve_battle_immediate_effect" &&
      a.sourceInstanceId === instanceId &&
      a.skipOnly !== true &&
      a.promptId.endsWith(":1")
  );
}

describe("BSRK01-X02 effects[1] card-data shape", () => {
  it("card_event:attack+deferredTo:battle_end / executionMode:optional / OC+advented+min_level2 / remove_from_game→recover(conditional_cost)", () => {
    const eff = recoverEffect();
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: "attack",
      deferredTo: "battle_end",
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "count_value", player: "self", min: 8 },
      { kind: "self_state", state: "advented" },
      { kind: "min_level", value: 2 },
    ]);
    expect(eff.steps[0]!.action).toMatchObject({ kind: "remove_from_game" });
    expect(eff.steps[1]).toMatchObject({
      connector: "conditional_cost",
      action: { kind: "recover", target: { kind: "self" } },
    });
  });
});

describe("BSRK01-X02 effects[1] battle_end deferral 実行", () => {
  it("宣言時に選んだ手札のマジック1枚を、バトル終了時に除外して回復する", () => {
    const instanceId = "kenshin-battle-end-recover";
    const magicHandCardId = "magic-hand-1";
    const { state, attackId, entityId, spirit } = makeMidBattleState(
      instanceId,
      magicHandCardId
    );
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: ALICE,
      sourceCard: spirit,
      sourceDefinition: X02,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    const action = findRecoverDeclareAction(queued, instanceId, ALICE);
    expect(action).toMatchObject({
      executionMode: "optional",
      targetMode: "manual",
      requiredTargetCount: 1,
      candidateTargetInstanceIds: [magicHandCardId],
      candidateTargetZones: ["hand", "trash"],
    });

    const declared = applyLegalAction({
      state: queued,
      action: action!,
      targetInstanceIds: [magicHandCardId],
      ...legalOptions,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      ...legalOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const reserved = applyLegalAction({
      state: declared,
      action: pass!,
      ...legalOptions,
    }).state;

    // 宣言時点では対象選択済みの deferral が予約されるだけで、手札のカードはまだ動かない。
    expect(reserved.pendingBattleEndDeferrals).toEqual([
      expect.objectContaining({
        attackId,
        sourceInstanceId: instanceId,
        effectIndex: 1,
        targetInstanceIds: [magicHandCardId],
      }),
    ]);
    expect(
      reserved.cardInstances.find((c) => c.instanceId === magicHandCardId)!.zone
    ).toBe("hand");
    expect(
      reserved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("exhausted");

    const resolved = finishBattle(reserved);

    expect(
      resolved.log.some((l) =>
        l.includes(`battle:end-deferral:fire:${attackId}:${instanceId}:1`)
      )
    ).toBe(true);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === magicHandCardId)!.zone
    ).toBe("removed_from_game");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("recovered");
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
  });

  it("skip 宣言なら deferral は予約されず、バトル終了後も回復しない", () => {
    const instanceId = "kenshin-battle-end-skip";
    const magicHandCardId = "magic-hand-skip";
    const { state, attackId, entityId, spirit } = makeMidBattleState(
      instanceId,
      magicHandCardId
    );
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: ALICE,
      sourceCard: spirit,
      sourceDefinition: X02,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    const skip = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === instanceId &&
        a.promptId.endsWith(":1") &&
        a.skipOnly === true
    );
    expect(skip).toBeDefined();

    const declined = applyLegalAction({
      state: queued,
      action: skip!,
      ...legalOptions,
    }).state;

    expect(declined.pendingBattleEndDeferrals).toEqual([]);
    const resolved = finishBattle(declined);

    expect(
      resolved.cardInstances.find((c) => c.instanceId === magicHandCardId)!.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("exhausted");
  });
});
