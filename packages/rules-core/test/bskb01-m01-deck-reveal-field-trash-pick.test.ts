import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSKB01-M01「[銀河に願いを]メタナイト」Lv1-Lv2『煌臨/アタック時』:
 * 「自分のデッキを上から3枚オープンできる。その中の、系統：「鋼騎士」を持つカード1枚を
 * 1コスト支払って召喚/配置でき、カード1枚をトラッシュに置ける。残ったカードはデッキの下に戻す。」
 *
 * engine-drain cluster deck-reveal-trash-destination: DeckRevealPick.destination に
 * "trash" を新設し、他 pick と独立に1枚だけを選んでトラッシュへ送れるようにした
 * (remainder の一律 trash 化とは別)。あわせて「1コスト支払って召喚/配置」は
 * costGate 付き pick を単独メンバーの exclusiveGroup にすることで、
 * getDeckRevealExclusiveGroupBranches の affordability フィルタ
 * (支払い不能なら候補0枚) を平場 pick でも効かせる (BSTH08.5-C23 costGate 経路の再利用)。
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
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M01 = cardNoMap.get("BSKB01-M01")!;
// 系統:「鋼騎士」 spirit、Lv1 requiredCores:1（維持コア自動補填の検証用）。
const KOUKISHI = cardNoMap.get("BSKB01-C02")!;
// 「鋼騎士」を持たないフィラー2枚。
const FILLER: CardDefinition = {
  cardNo: "TEST-BSKB01-M01-FILLER",
  name: "無関係テストカード",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  tribe: "無関係",
  sourceUrls: [],
  sourceConfidence: "C",
};
const testCardNoMap = new Map<string, CardDefinition>([
  [FILLER.cardNo, FILLER],
]);
const getCardDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? testCardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function baseState(deckCards: CardDefinition[], aliceReserve: number) {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ reserveNormalCoreCount: aliceReserve }],
  });
  const m01Instance = createCardInstance(M01, {
    instanceId: "m01",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const deckInstances = deckCards.map((def, i) =>
    createCardInstance(def, {
      instanceId: `deck-${i + 1}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  return {
    ...base,
    activePlayerId: ALICE,
    step: "attack",
    cardInstances: [m01Instance, ...deckInstances],
  };
}

function revealEffect() {
  return M01.effects![0]!;
}

function getPickAction(state: GameState) {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
    getRegisteredFieldCardEffectActions: () => [],
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const pick = actions.find(
    (a) => a.kind === "resolve_pending_deck_reveal_pick"
  );
  if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
    throw new Error("resolve_pending_deck_reveal_pick action not found");
  }
  return pick;
}

describe("BSKB01-M01 デッキ3オープン: 鋼騎士1枚を1コストで召喚/配置 + 独立に1枚をトラッシュ", () => {
  it("鋼騎士を選んで場に出し(コスト1+維持コア1消費)、フィラー1枚をトラッシュへ送り、残り1枚はデッキ下へ", () => {
    const afterReveal = executeEffect({
      chainId: "test:bskb01-m01-deck-reveal-field-trash-pick:104",
      state: baseState([KOUKISHI, FILLER, FILLER], 3),
      effect: revealEffect(),
      sourceInstanceId: "m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();

    // pick[0]: 鋼騎士 exclusiveGroup(単独) + costGate:1。
    const fieldPick = getPickAction(afterReveal);
    expect(fieldPick.exclusiveGroupBranches).toEqual([
      { count: 1, candidateCardInstanceIds: ["deck-1"], costGate: 1 },
    ]);
    const afterFieldPick = applyLegalAction({
      state: afterReveal,
      action: fieldPick,
      selectedDeckRevealCardIds: ["deck-1"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    expect(afterFieldPick.state.pendingDeckReveal).not.toBeNull();
    const aliceAfterCostGate = afterFieldPick.state.players.find(
      (p) => p.id === ALICE
    )!;
    expect(aliceAfterCostGate.reserveNormalCoreCount).toBe(2); // costGate 1 支払済み

    // pick[1]: 平場 pick、destination:"trash"。候補は残り2枚 (鋼騎士は除外済み)。
    const trashPick = getPickAction(afterFieldPick.state);
    expect(trashPick.candidateCardInstanceIds.sort()).toEqual([
      "deck-2",
      "deck-3",
    ]);
    const resolved = applyLegalAction({
      state: afterFieldPick.state,
      action: trashPick,
      selectedDeckRevealCardIds: ["deck-2"],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };

    // 残り1枚 (deck-3) は remainder:"bottom" 固定のため自動 finalize。
    expect(resolved.state.pendingDeckReveal).toBeNull();

    expect(resolved.state.pendingMultiPlacement?.targets[0]?.instanceId).toBe(
      "deck-1"
    );
    resolved.state = finishCoreChoices(resolved.state, getCardDef);
    const koukishiCard = resolved.state.cardInstances.find(
      (c) => c.instanceId === "deck-1"
    )!;
    expect(koukishiCard.zone).toBe("field");
    expect(koukishiCard.normalCoreCount).toBe(1); // 維持コア自動補填 (levelDefs[0].requiredCores)

    const trashedCard = resolved.state.cardInstances.find(
      (c) => c.instanceId === "deck-2"
    )!;
    expect(trashedCard.zone).toBe("trash");

    const bottomCard = resolved.state.cardInstances.find(
      (c) => c.instanceId === "deck-3"
    )!;
    expect(bottomCard.zone).toBe("deck");

    const aliceFinal = resolved.state.players.find((p) => p.id === ALICE)!;
    // costGate(1) + 維持コア自動補填(1) = 合計2消費。
    expect(aliceFinal.reserveNormalCoreCount).toBe(1);
  });

  it("鋼騎士が無いとき、鋼騎士 pick は候補0枚で自動スキップされ、トラッシュ pick のみ選べる", () => {
    const afterReveal = executeEffect({
      chainId: "test:bskb01-m01-deck-reveal-field-trash-pick:172",
      state: baseState([FILLER, FILLER, FILLER], 3),
      effect: revealEffect(),
      sourceInstanceId: "m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    const pick = getPickAction(afterReveal);
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 1, candidateCardInstanceIds: [], costGate: 1 },
    ]);
    const afterSkip = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: [],
      getCardDefinitionById: getCardDef,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    const aliceUnchanged = afterSkip.state.players.find((p) => p.id === ALICE)!;
    expect(aliceUnchanged.reserveNormalCoreCount).toBe(3); // コスト未消費

    const trashPick = getPickAction(afterSkip.state);
    expect(trashPick.candidateCardInstanceIds.sort()).toEqual([
      "deck-1",
      "deck-2",
      "deck-3",
    ]);
  });

  it("リザーブ不足だと鋼騎士 pick の候補が0枚になる(1コスト支払い不能)", () => {
    const afterReveal = executeEffect({
      chainId: "test:bskb01-m01-deck-reveal-field-trash-pick:204",
      state: baseState([KOUKISHI, FILLER, FILLER], 0),
      effect: revealEffect(),
      sourceInstanceId: "m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    const pick = getPickAction(afterReveal);
    expect(pick.exclusiveGroupBranches).toEqual([
      { count: 1, candidateCardInstanceIds: [], costGate: 1 },
    ]);
    expect(pick.canSkip).toBe(true);
  });
});
