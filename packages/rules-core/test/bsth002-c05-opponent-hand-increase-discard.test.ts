/**
 * BSTH002-C05「封魔録三面 固定砲台」effects[1] 検証。
 *
 * カード本文 (textLines[5,6]):
 * - Lv1『相手のターン』
 *   相手の効果によって相手の手札が増えたとき、増えたカード1枚につき、
 *   相手は相手の手札1枚を破棄する。この効果でこの手札は0にならない。
 *
 * 前例: BSLH01-C10 effects[1] (bslh01-cards.test.ts:4052-4075) と同型構成
 * (draw step 無し版)。game_event:increase_hand + cause:[self_effect] +
 * turn_player:opponent 条件、discard の count/capCount を event_amount 参照にする
 * ことで「増えた枚数分」「手札は0にならない」を同時に表す。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { GameState } from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const getRegisteredTriggeredEffectActions = () => [];
const getRegisteredFieldCardEffectActions = () => [];
const getRegisteredBurstActions = () => [];

const ALICE = "alice";
const BOB = "bob";

const C05 = ALL_CARDS.find((c) => c.cardNo === "BSTH002-C05")!;
const EFFECT = C05.effects![1]!;

function handCount(state: GameState, playerId: string): number {
  return state.cardInstances.filter(
    (c) => c.ownerPlayerId === playerId && c.zone === "hand"
  ).length;
}

function baseState(bobHandCount: number): GameState {
  const bobHandCards = Array.from({ length: bobHandCount }, (_, i) =>
    createCardInstance(C05, {
      instanceId: `bob-hand-${i}`,
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    })
  );
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(C05, {
          instanceId: "c05-source",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
        ...bobHandCards,
      ],
    }),
    activePlayerId: BOB,
    step: "main",
  };
}

describe("BSTH002-C05 effects[1] shape (相手ターン: 相手効果による相手手札増加→破棄)", () => {
  it("stub 解消済み、game_event:increase_hand(相手, cause:self_effect) + turn_player:opponent + mandatory", () => {
    expect(EFFECT.stub).toBeUndefined();
    expect(EFFECT.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "increase_hand",
      cause: ["self_effect"],
    });
    expect(EFFECT.condition).toEqual([
      { kind: "turn_player", player: "opponent" },
    ]);
    expect(EFFECT.executionMode).toBe("mandatory");
  });

  it("steps[0] = 相手が破棄。count/capCount ともに event_amount 参照 (増えた枚数分・0にならない)", () => {
    expect(EFFECT.steps).toHaveLength(1);
    expect(EFFECT.steps[0]!.action).toEqual({
      kind: "discard",
      player: "opponent",
      count: { source: { kind: "event_amount" } },
      targetHandSize: 1,
      capCount: { source: { kind: "event_amount" } },
    });
  });
});

describe("BSTH002-C05 effects[1] 盤面変化 (executeEffect 直接実行)", () => {
  it("相手の手札が2枚増えた (eventAmount=2) → 破棄候補5枚から相手(BOB)が2枚選んで破棄する", () => {
    const before = baseState(5);
    const afterEffect = executeEffect({
      chainId: "test:bsth002-c05-opponent-hand-increase-discard:100",
      state: before,
      effect: EFFECT,
      effectIndex: 1,
      sourceInstanceId: "c05-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      eventAmount: 2,
    });

    // 破棄枚数 (effectiveCount=2) が候補 (5枚) 未満のため、破棄対象カードは
    // discard される本人 (BOB) が pendingZoneSelection で選ぶ。
    expect(afterEffect.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(afterEffect.pendingZoneSelection?.maxCount).toBe(2);
    const pendingActor = afterEffect.pendingZoneSelection!.actingPlayerId;

    const resolveAction = getLegalActions({
      state: afterEffect,
      actingPlayerId: pendingActor,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(resolveAction).toBeDefined();

    const after = applyLegalAction({
      state: afterEffect,
      action: resolveAction!,
      selectedZoneCardIds: ["bob-hand-0", "bob-hand-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(after.pendingZoneSelection).toBeNull();
    expect(handCount(after, BOB)).toBe(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-hand-0")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-hand-1")?.zone
    ).toBe("trash");
  });

  it("targetHandSize:1 により、破棄対象は手札1枚を下限にキャップされる (0にならない・pending も出さない)", () => {
    // 手札1枚しかない状態で「2枚増えた」相当の event を受けても、
    // capCount/targetHandSize のガードにより effectiveCount=0 (no-op)。
    const before = baseState(1);
    const after = executeEffect({
      chainId: "test:bsth002-c05-opponent-hand-increase-discard:151",
      state: before,
      effect: EFFECT,
      effectIndex: 1,
      sourceInstanceId: "c05-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      eventAmount: 2,
    });

    expect(after.pendingZoneSelection).toBeNull();
    expect(handCount(after, BOB)).toBe(1);
  });
});
