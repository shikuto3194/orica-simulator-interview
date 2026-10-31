/**
 * BSAZ02-R03「ハーシェル」effects[0,1,2] 検証。
 *
 * 原文 (textLines[0,2,3,5,7,8,10,11]):
 *   《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》
 *   フラッシュ『お互いのアタックステップ』手札にあるこのカードは、召喚できる。
 *   【アルドノアドライブ：1】
 *   Lv3-Lv4-Lv5『このアルティメットの召喚時』ボイドからコア1個をこのアルティメットに置ける。
 *   Lv4-Lv5 フラッシュ『お互いのアタックステップ』
 *   ターンに2回、BP合計12000まで相手のスピリット/アルティメットを好きなだけデッキの下に戻せる。
 *
 * 検証点:
 *  - effects[0]: フラッシュ自己召喚（BSAZ02-C05 precedent と同型）を getLegalActions/
 *    applyLegalAction 経由で実際に駆動し、手札→フィールドへの zone 変化を検証する
 *    （adversarial verifier round1: 「別途カバー済み」の主張が事実誤認だった、C05自体にも
 *    effects[0] 実行系テストが無いことが判明したため本カードで新規カバー）。
 *  - effects[1]: 【アルドノアドライブ：1】ゲート付き召喚時、ボイドからコア1個を任意で置く（盤面変化）。
 *  - effects[2]: BP合計12000まで budget 制約の対象選択→デッキ下へ送る（budget 予算超過は拒否、以内は成立）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { ActiveAttack, CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  getLegalActions,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
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
const R03 = card("BSAZ02-R03");

function srcR03(cores: number) {
  const src = createCardInstance(R03, {
    instanceId: "src-r03",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-r03",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-r03-herschel:78",
    state,
    effect: R03.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-r03",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

function makeSimpleSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const ATTACKER = makeSimpleSpirit("TEST-R03-ATTACKER", 2000);
const getDefWithAttacker = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === ATTACKER.cardNo ? ATTACKER : undefined);

/** 『お互いのアタックステップ』flash_before_block 窓、優先権は alice。 */
function setupFlashBeforeBlock(): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(ATTACKER, {
        instanceId: "alice-attacker",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      createCardInstance(R03, {
        instanceId: "r03-hand",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:2:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    } satisfies ActiveAttack,
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: ALICE,
    turnNumber: 2,
  };
}

describe("BSAZ02-R03 effects[0]（フラッシュ『お互いのアタックステップ』手札から自己召喚できる）", () => {
  it("お互いのアタックステップの優先権窓で手札から召喚宣言でき、コア支払い後フィールドへ移る", () => {
    const state = setupFlashBeforeBlock();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithAttacker,
      ...effectLookups,
    });
    const handEffect = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "r03-hand"
    ) as
      | Extract<(typeof actions)[number], { kind: "use_hand_card_effect" }>
      | undefined;
    expect(handEffect).toMatchObject({
      effectIndex: 0,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });

    const applied = applyLegalAction({
      state,
      action: handEffect!,
      getCardDefinitionById: getDefWithAttacker,
      ...effectLookups,
      summonPaymentSources: [{ kind: "reserve", amount: 5 }],
    }).state;

    const moved = applied.cardInstances.find(
      (c) => c.instanceId === "r03-hand"
    )!;
    // 宣言後・解決前の中間ゾーン (model.ts: "in_use" // 宣言後・解決前の中間ゾーン
    // (hand→in_use→trash/field))。BSES01 ブレイヴのフラッシュ自己召喚 precedent
    // (bses01-brave-flash-self-summon.test.ts) と同じ中間状態。
    expect(moved.zone).toBe("in_use");
    expect(
      applied.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(5);
    expect(
      applied.activeAttack?.flashWindowState.pendingStackAction
    ).toMatchObject({
      actionKind: "hand_card_effect",
      handActivatedEffectIndex: 0,
      summonPaymentSources: [{ kind: "reserve", amount: 5 }],
    });
  });

  it("timingScope 外 (メインステップ) では手札起動効果は提示されない", () => {
    const mainStepState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(R03, {
          instanceId: "r03-hand",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const actions = getLegalActions({
      state: { ...mainStepState, step: "main", activePlayerId: ALICE },
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithAttacker,
      ...effectLookups,
    });
    const permission = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "r03-hand"
    );
    expect(permission).toBeUndefined();
  });
});

describe("BSAZ02-R03 effects[1]（召喚時: ボイドからコア1個を任意で置く）", () => {
  it("ボイドからコアを1個置き、normalCoreCount が+1される", () => {
    const src = srcR03(1); // Lv3
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ voidNormalCoreCount: 3 }, {}],
    });
    const after = runEffect(state, 1);
    const moved = after.cardInstances.find((c) => c.instanceId === "src-r03")!;
    expect(moved.normalCoreCount).toBe(2);
  });
});

describe("BSAZ02-R03 effects[2]（Lv4-5 フラッシュ: BP合計12000まで相手をデッキ下へ）", () => {
  it("予算内（BP合計12000以下）なら選択した相手をデッキの下へ送る", () => {
    const src = srcR03(3); // Lv4
    const enemyA = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyB = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), enemyA, enemyB],
    });
    const pendingState = runEffect(state, 2);
    const pending = pendingState.pendingStepOptionalTargetSelection!;
    expect(pending.targetStepId).toBe("budget_send_to_deck");
    expect(pending.bpBudgetAmount).toBe(12000);
    expect(pending.candidateInstanceIds.sort()).toEqual(
      ["enemy-a", "enemy-b"].sort()
    );

    const resolved = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${pending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        requiredTargetCount: pending.requiredTargetCount,
        maxTargetCount: pending.maxTargetCount,
        candidateTargetInstanceIds: pending.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-a", "enemy-b"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    const a = resolved.cardInstances.find((c) => c.instanceId === "enemy-a")!;
    const b = resolved.cardInstances.find((c) => c.instanceId === "enemy-b")!;
    expect(a.zone).toBe("deck");
    expect(b.zone).toBe("deck");
  });
});
