import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH03-M07 [永夜抄]西行寺 幽々子 effects[0] バースト（相手の効果によって相手の手札が増えた後）。
 *
 * 原文 (textLines[2,3]):
 *   【バースト：相手の効果によって相手の手札が増えた後】
 *   自分は、デッキの上か下だけから2枚ドローする。この効果で発動した相手のバースト効果は
 *   発揮されない。その後、このカードをコストを支払わずに召喚する。
 *
 * stub 監査で「上/下選択はDSL未対応」とされていたが、draw(position) + choice プリミティブは
 * BSTH003-C33/M01/R02 で既に実装済み (誤分類)。本 commit で適用する。
 * 「このカードをコストを支払わずに召喚する」= target:self + costModifier:"free" は
 * BSTH03-M05 effects[0] の同一文言と同型 (旧実装は target:from_zone(hand) count:1 で
 * 対象不特定・costModifier 欠落という別バグだったため、これも本 commit で修正)。
 * 「その後」= sequential connector（旧: simultaneous も誤り）。
 *
 * 「この効果で発動した相手のバースト効果は発揮されない」= needs-ruling.jsonl
 * (BSTH03-M07,BSTH02-M02, 裁定B確定 2026-07-26) により、対象は誘発原因の過去バースト本体
 * ではなく、このカード自身の解決(2枚ドロー+無償召喚)が原因で新たに発動する相手側バースト。
 * causedByThisEffect で直接誘発した反応だけを抑止する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const m07 = card("BSTH03-M07");
const burstEffect = m07.effects!.find(
  (e) => e.timing.kind === "burst" && e.timing.trigger.kind === "hand_increase"
)!;

function drawnIds(result: GameState): Set<string> {
  return new Set(
    result.cardInstances
      .filter((c) => c.zone === "hand" && c.instanceId !== "yuyuko")
      .map((c) => c.instanceId)
  );
}

describe("BSTH03-M07 effects[0] バースト構造", () => {
  it("draw position choice (top default / bottom choice[0]) + summon(self, free, sequential)", () => {
    expect(burstEffect.timing).toMatchObject({
      kind: "burst",
      trigger: { kind: "hand_increase", player: "opponent" },
      cause: ["self_effect"],
    });
    expect(burstEffect.steps).toHaveLength(3);
    const drawStep = burstEffect.steps[0]!;
    expect(drawStep.action.kind).toBe("draw");
    if (drawStep.action.kind === "draw") {
      expect(drawStep.action.count).toBe(2);
      expect(drawStep.action.position).toBe("top");
    }
    expect(drawStep.choice).toBeDefined();
    expect(drawStep.choice!.length).toBe(1);
    const altDraw = drawStep.choice![0]!.action;
    expect(altDraw.kind).toBe("draw");
    if (altDraw.kind === "draw") expect(altDraw.position).toBe("bottom");

    const negateStep = burstEffect.steps[1]!;
    expect(negateStep.action.kind).toBe("negate");
    if (negateStep.action.kind === "negate") {
      expect(negateStep.action.negateTarget).toBe("opponent_burst");
      expect(negateStep.action.causedByThisEffect).toBe(true);
    }

    const summonStep = burstEffect.steps[2]!;
    expect(summonStep.connector).toBe("sequential");
    expect(summonStep.action.kind).toBe("summon");
    if (summonStep.action.kind === "summon") {
      expect(summonStep.action.target).toEqual({ kind: "self" });
      expect(summonStep.action.costModifier).toBe("free");
    }

    expect(burstEffect.stub).toBeUndefined();
  });

  /** デッキ順 [top, mid, bottom] で 3 枚積む */
  function setupDeck() {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(m07, {
      instanceId: "yuyuko",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const mk = (id: string) =>
      createCardInstance(card("BSTH001-R01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      });
    const deck = [mk("top"), mk("mid"), mk("bottom")];
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    return state;
  }

  it("[board] choiceIndex=0: デッキ上から2枚ドロー + 自身を無償召喚 (field へ移動)", () => {
    const state = setupDeck();
    const reserveBefore = state.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    const result = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth03-m07-burst-draw-position:119",
      state,
      effect: burstEffect,
      sourceInstanceId: "yuyuko",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 0,
    });
    expect(drawnIds(result)).toEqual(new Set(["top", "mid"]));
    const self = result.cardInstances.find((c) => c.instanceId === "yuyuko")!;
    expect(self.zone).toBe("field");
    // costModifier:"free" が実際に無償で処理されたことを、reserve コア減少量が
    // Lv3 の維持コア(requiredCores=1) のみであること (印字コスト6分は追加消費されない) で立証。
    const reserveAfter = result.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;
    expect(reserveAfter).toBe(reserveBefore - 1);

    expect(result.pendingStackNegateRequests).toEqual([]);
  });

  it("[board] choiceIndex=1: デッキ下から2枚ドロー", () => {
    const state = setupDeck();
    const result = executeEffect({
      chainId: "test:bsth03-m07-burst-draw-position:143",
      state,
      effect: burstEffect,
      sourceInstanceId: "yuyuko",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
    });
    expect(drawnIds(result)).toEqual(new Set(["mid", "bottom"]));
    expect(
      result.cardInstances.find((c) => c.instanceId === "yuyuko")!.zone
    ).toBe("field");
  });
});
