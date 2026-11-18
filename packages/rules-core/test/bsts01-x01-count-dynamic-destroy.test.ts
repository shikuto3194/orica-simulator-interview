/**
 * BSTS01-X01 ［神之怒］リムル=テンペスト [3,4]『召喚/煌臨時』
 *   〔ターンに1回:同名〕「自分のカウント2につき、本来のコスト8以下の相手のスピリット/
 *   アルティメット1体までを破壊できる。破壊した対象1体につき、ボイドからコア1個までを
 *   リザーブに置き、デッキの上から1枚までドローできる。」
 *
 * 「カウント2につき1体まで」= 対象選択数の動的*上限* count:{min:0, max:{count_value/2}}。
 * 窓クローズ後の deferred 対象選択で resolveCountBound 数値化（正源 test:
 * target-count-dynamic-max）。「本来のコスト8以下」= filter.maxCost（印字コスト）。
 * per-target 報酬「破壊1体につき…」= 破壊 step id:"destroyed" → core_move / draw 量を
 * cards_from_ref(destroyed) で連動（正源 BSSL01-C01 discard→draw）。
 *
 * ここでは executeEffect 直接呼び出しで「破壊した対象数ぶんのコア移動＋ドロー」を盤面で
 * 検証する（動的上限の数値化自体は target-count-dynamic-max が窓クローズ経路で網羅）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined
): GameState {
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
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

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
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

function cannotLeaveCE(
  targetInstanceId: string,
  tag: ContinuousEffectTag,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `test-${tag}-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: tag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

describe("BSTS01-X01 ［神之怒］リムル=テンペスト — カウント連動 動的上限破壊 + per-target 報酬", () => {
  const c = card("BSTS01-X01");
  const trig = c.effects![0]!;

  it("構造: [3,4] は動的上限破壊 (count.max=count_value/2, maxCost:8) + cards_from_ref 連動報酬。stub 解消", () => {
    expect(trig.stub).toBeUndefined();
    expect(trig.timing).toEqual({
      kind: "card_event",
      event: ["summon", "advent"],
    });
    expect(trig.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const destroy = trig.steps[0]!;
    expect(destroy.id).toBe("destroyed");
    expect(destroy.action.kind).toBe("destroy");
    if (
      destroy.action.kind === "destroy" &&
      destroy.action.target.kind === "filter"
    ) {
      const t = destroy.action.target;
      expect(t.player).toBe("opponent");
      expect(t.filter?.category).toEqual(["spirit", "ultimate"]);
      expect(t.filter?.maxCost).toBe(8);
      expect(t.count).toEqual({
        min: 0,
        max: { source: { kind: "count_value", player: "self" }, divisor: 2 },
      });
    }
    const coreMove = trig.steps[1]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.from).toEqual({ kind: "void", player: "self" });
      expect(coreMove.to).toEqual({ kind: "reserve", player: "self" });
      expect(coreMove.amount).toEqual({
        source: { kind: "cards_from_ref", stepId: "destroyed" },
      });
    }
    const draw = trig.steps[2]!.action;
    expect(draw).toEqual({
      kind: "draw",
      count: { source: { kind: "cards_from_ref", stepId: "destroyed" } },
    });
  });

  it("[board] 2体破壊 → ボイドから2コアをリザーブへ + 2枚ドロー", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手スピリット2体（コスト8以下）。
    const enemyDef = card("BSSL01-C02"); // 影・甲獣 スピリット（コスト低）
    const e1 = createCardInstance(enemyDef, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const e2 = createCardInstance(enemyDef, {
      instanceId: "enemy-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C06"), {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, e1, e2, ...deck],
      playerOverrides: [
        {
          countValue: 5,
          voidNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          deckCount: 5,
          handCount: 0,
        },
        {},
      ],
    });

    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsts01-x01-count-dynamic-destroy:180",
        state: before,
        effect: trig,
        sourceInstanceId: "rimuru",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        targetInstanceIds: ["enemy-1", "enemy-2"],
      }),
      getDef
    );

    // optional-step drain は finalizeEffectResolution を経由し pendingLeave を自動 flush する
    // (ZoneSelection precedent と同じ post-resolve 完了動作)。よって after は既に flush 後状態。
    expect(after.pendingLeaveEntities.length).toBe(0);
    const onField = after.cardInstances.filter(
      (x) => x.ownerPlayerId === BOB && x.zone === "field"
    );
    expect(onField.length).toBe(0);
    const inTrash = after.cardInstances.filter(
      (x) => x.ownerPlayerId === BOB && x.zone === "trash"
    );
    expect(inTrash.length).toBe(2);
    // ボイド3 → 1（2個リザーブへ）。per-target 報酬は破壊数 (cards_from_ref) 連動。
    expect(alice(after).voidNormalCoreCount).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(2);
    // デッキ5 → 3（2枚ドロー）。
    expect(alice(after).deckCount).toBe(3);
    expect(alice(after).handCount).toBe(2);
  });

  it("[board] 2体破壊後、per-target 報酬は 0..N の中間量を選べる", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyDef = card("BSSL01-C02");
    const e1 = createCardInstance(enemyDef, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const e2 = createCardInstance(enemyDef, {
      instanceId: "enemy-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C06"), {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, e1, e2, ...deck],
      playerOverrides: [
        {
          countValue: 5,
          voidNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          deckCount: 5,
          handCount: 0,
        },
        {},
      ],
    });

    const afterDestroy = executeEffect({
      chainId: "test:bsts01-x01-count-dynamic-destroy:252",
      state: before,
      effect: trig,
      sourceInstanceId: "rimuru",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["enemy-1", "enemy-2"],
    });
    expect(afterDestroy.pendingStepOptionalChoice?.optionalQuantity).toEqual({
      kind: "core_move",
      min: 0,
      max: 2,
    });
    const coreActions = getLegalActions({
      state: afterDestroy,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).filter((a) => a.kind === "resolve_pending_step_optional_choice");
    expect(
      coreActions.map((a) =>
        a.choice === "decline" ? 0 : (a.selectedAmount ?? -1)
      )
    ).toEqual([1, 2, 0]);
    const coreOne = coreActions.find(
      (a) => a.choice === "execute" && a.selectedAmount === 1
    );
    expect(coreOne).toBeDefined();
    const afterCoreOne = applyLegalAction({
      state: afterDestroy,
      action: coreOne!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(alice(afterCoreOne).voidNormalCoreCount).toBe(2);
    expect(alice(afterCoreOne).reserveNormalCoreCount).toBe(1);
    expect(afterCoreOne.pendingStepOptionalChoice?.optionalQuantity).toEqual({
      kind: "draw",
      min: 0,
      max: 2,
    });

    const drawOne = getLegalActions({
      state: afterCoreOne,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute" &&
        a.selectedAmount === 1
    );
    expect(drawOne).toBeDefined();
    const afterDrawOne = applyLegalAction({
      state: afterCoreOne,
      action: drawOne!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(afterDrawOne.pendingStepOptionalChoice).toBeNull();
    expect(alice(afterDrawOne).voidNormalCoreCount).toBe(2);
    expect(alice(afterDrawOne).reserveNormalCoreCount).toBe(1);
    expect(alice(afterDrawOne).deckCount).toBe(4);
    expect(alice(afterDrawOne).handCount).toBe(1);
    expect(afterDrawOne.pendingLeaveEntities.length).toBe(0);
  });

  it("[board] 2体選択しても片方が破壊耐性で残るなら、per-target 報酬上限は実破壊1体ぶん", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyDef = card("BSSL01-C02");
    const e1 = createCardInstance(enemyDef, {
      instanceId: "enemy-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const e2 = createCardInstance(enemyDef, {
      instanceId: "enemy-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C06"), {
        instanceId: `resist-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const beforeBase = createEmptyGameState({
      cardInstances: [src, e1, e2, ...deck],
      playerOverrides: [
        {
          countValue: 5,
          voidNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          deckCount: 5,
          handCount: 0,
        },
        {},
      ],
    });
    const before: GameState = {
      ...beforeBase,
      activeContinuousEffects: [
        cannotLeaveCE("enemy-2", "cannot_be_destroyed", BOB),
      ],
    };

    const afterDestroy = executeEffect({
      chainId: "test:bsts01-x01-count-dynamic-destroy:369",
      state: before,
      effect: trig,
      sourceInstanceId: "rimuru",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["enemy-1", "enemy-2"],
    });

    expect(
      afterDestroy.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && !e.blockedByResistance
      )
    ).toBe(true);
    expect(
      afterDestroy.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-2" && e.blockedByResistance === true
      )
    ).toBe(true);
    // 実破壊数が 1 なら既存互換の execute/decline 二択で 0/1 を表現でき、
    // selectedAmount:2 は提示されない。
    expect(
      afterDestroy.pendingStepOptionalChoice?.optionalQuantity
    ).toBeUndefined();
    const coreActions = getLegalActions({
      state: afterDestroy,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).filter((a) => a.kind === "resolve_pending_step_optional_choice");
    expect(coreActions).toHaveLength(2);
    expect(coreActions.some((a) => a.selectedAmount === 2)).toBe(false);

    const after = drainOptionalStepsWithExecute(afterDestroy, getDef);
    expect(alice(after).voidNormalCoreCount).toBe(2);
    expect(alice(after).reserveNormalCoreCount).toBe(1);
    expect(alice(after).deckCount).toBe(4);
    expect(alice(after).handCount).toBe(1);
    expect(
      after.cardInstances.find((x) => x.instanceId === "enemy-1")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "enemy-2")?.zone
    ).toBe("field");
  });

  it("BSTS01-C01 の固定2枚 optional draw は step optional choice を出さず2枚引く", () => {
    const c01 = card("BSTS01-C01");
    const src = createCardInstance(c01, {
      instanceId: "c01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C06"), {
        instanceId: `fixed-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [
        {
          deckCount: 5,
          handCount: 0,
        },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsts01-x01-count-dynamic-destroy:441",
      state: before,
      effect: c01.effects![0]!,
      sourceInstanceId: "c01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(alice(after).deckCount).toBe(3);
    expect(alice(after).handCount).toBe(2);
    const actions = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).filter((a) => a.kind === "resolve_pending_step_optional_choice");
    expect(actions).toHaveLength(0);
  });

  it("[board] 0体破壊（対象を渡さない）→ コア移動・ドローは発生しない（per-target 報酬は破壊数連動）", () => {
    const src = createCardInstance(c, {
      instanceId: "rimuru",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTS01-C06"), {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      cardInstances: [src, ...deck],
      playerOverrides: [
        {
          countValue: 5,
          voidNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          deckCount: 5,
          handCount: 0,
        },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:bsts01-x01-count-dynamic-destroy:489",
      state: before,
      effect: trig,
      sourceInstanceId: "rimuru",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [],
    });

    expect(alice(after).voidNormalCoreCount).toBe(3);
    expect(alice(after).reserveNormalCoreCount).toBe(0);
    expect(alice(after).deckCount).toBe(5);
    expect(alice(after).handCount).toBe(0);
    expect(after.pendingStepOptionalChoice).toBeNull();
  });
});
