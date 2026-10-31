/**
 * BSTH02.7-X02 上海人形 [3,4] Lv2-Lv3『このスピリットのアタック/ブロック時』
 *   「ターンに1回、ボイド/自分の導界者ネクサスのコア1個を自分のライフに置ける。
 *    そうしたとき、自分のデッキを2枚破棄する。」
 *
 * effects[3] は attack/block 両方を 1 effect に統合 (event:["attack","block"])。
 * step0 = core_move source union (void / 導界者ネクサス→life)、
 * step1 = conditional_result true deck discard (`move_card.deckDiscard: true`) count:2。
 * 「そうしたとき」= 前段の core_move が実 commit したときのみ後段が実行される
 * (BSTH02.7-TR02(A) [3,4] 同型 SSOT)。
 * 移動元は共通コア選択で決定する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

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

const ALICE = "player-1";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH02.7-X02 上海人形 — アタック/ブロック時 void→ライフ + そうしたとき deck 2 破棄", () => {
  const c = card("BSTH02.7-X02");
  // effects[0]=Lv1 自己召喚許可, [1]=継続 cost_modify(exclude), [2]=card_event:summon
  // prevent_battle (ENGINE-summon-variable-trash-exclude-discount で新設・挿入),
  // [3]=Lv2-Lv3 本体。
  const effect = c.effects![3]!;

  it("構造: timing event=['attack','block'], step0=core_move union, step1=conditional_result true deck discard count:2", () => {
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });

    const step0 = effect.steps[0]!;
    expect(step0.choice).toBeUndefined();
    expect(step0.action).toMatchObject({
      kind: "core_move",
      from: { kind: "union" },
      to: { kind: "life", player: "self" },
      amount: 1,
    });

    const deckStep = effect.steps[1]!;
    expect(deckStep.connector).toBe("conditional_result");
    const mc = deckStep.action;
    expect(mc.kind).toBe("move_card");
    if (mc.kind === "move_card") {
      expect(mc.from).toEqual({
        zone: "deck",
        player: "self",
        position: "top",
      });
      expect(mc.to).toEqual({ zone: "trash" });
      expect(mc.count).toBe(2);
      expect(mc.deckDiscard).toBe(true);
    }
  });

  it("[board] void にコアあり: void→ライフ +1、デッキ上 2 枚がトラッシュへ", () => {
    const src = createCardInstance(c, {
      instanceId: "shanghai",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level:2)
    });
    const deckTop1 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const deckTop2 = createCardInstance(card("BSTH001-R02"), {
      instanceId: "alice-deck-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, deckTop1, deckTop2],
      playerOverrides: [
        {
          deckCount: 2,
          voidNormalCoreCount: 3,
          lifeNormalCoreCount: 3,
        },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-x02-attack-block-void-life-deck:128",
        state: before,
        effect,
        sourceInstanceId: "shanghai",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // void→ライフ: void 3→2, life 3→4
    expect(alice(after).voidNormalCoreCount).toBe(2);
    expect(alice(after).lifeNormalCoreCount).toBe(4);

    // そうしたとき: デッキ上 2 枚がトラッシュへ
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-2")!.zone
    ).toBe("trash");
    expect(alice(after).deckCount).toBe(0);
  });

  it("[board] void に コア無し + 導界者 nexus 不在: optional 全 skip → ライフ/デッキ不変", () => {
    const src = createCardInstance(c, {
      instanceId: "shanghai",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const deckTop1 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, deckTop1],
      playerOverrides: [
        {
          deckCount: 1,
          voidNormalCoreCount: 0,
          lifeNormalCoreCount: 3,
        },
        {},
      ],
    });
    // optional の pendingStepOptionalChoice が来なければそのまま no-op で返る。
    // 来るなら decline で answer して全 skip 経路を取る。
    let s: GameState = executeEffect({
      chainId: "test:bsth02-7-x02-attack-block-void-life-deck:178",
      state: before,
      effect,
      sourceInstanceId: "shanghai",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    while (s.pendingStepOptionalChoice !== null) {
      const psoc = s.pendingStepOptionalChoice;
      s = applyLegalAction({
        state: s,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${psoc.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: psoc.actingPlayerId,
          pendingId: psoc.pendingId,
          sourceInstanceId: psoc.sourceInstanceId,
          effectIndex: psoc.effectIndex,
          stepIndex: psoc.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }

    expect(alice(s).lifeNormalCoreCount).toBe(3);
    // デッキは破棄されない (conditional_result が前段の core_move 失敗で skip)
    expect(
      s.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("deck");
    expect(alice(s).deckCount).toBe(1);
  });

  it("[board] void は空だが自分の導界者ネクサスにコアあり: field_card→ライフ +1、デッキ上2枚がトラッシュへ", () => {
    const src = createCardInstance(c, {
      instanceId: "shanghai",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level:2)
    });
    const guidedNexus = createCardInstance(card("BSTH01-XX01"), {
      instanceId: "alice-guided-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deckTop1 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const deckTop2 = createCardInstance(card("BSTH001-R02"), {
      instanceId: "alice-deck-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, guidedNexus, deckTop1, deckTop2],
      playerOverrides: [
        {
          deckCount: 2,
          voidNormalCoreCount: 0,
          lifeNormalCoreCount: 3,
        },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-x02-attack-block-void-life-deck:250",
        state: before,
        effect,
        sourceInstanceId: "shanghai",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // field_card(導界者ネクサス)→ライフ: nexus のコア 1→0, life 3→4。void は不変 (0のまま)。
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-guided-nexus")!
        .normalCoreCount
    ).toBe(0);
    expect(alice(after).lifeNormalCoreCount).toBe(4);
    expect(alice(after).voidNormalCoreCount).toBe(0);

    // そうしたとき: デッキ上 2 枚がトラッシュへ
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-2")!.zone
    ).toBe("trash");
    expect(alice(after).deckCount).toBe(0);
  });
});
