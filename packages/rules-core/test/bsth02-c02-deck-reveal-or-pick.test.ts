/**
 * BSTH02-C02「レティ・ホワイトロック」effects[1] (召喚時 deck_reveal) の 2 つ目の pick は
 * 「紫/白の幻想スピリットカード1枚」OR「幻想&冥主カード1枚(カテゴリ不問)」の二択。
 * card-data は既に `filter: { filterOr: [...] }` (matchesCardFilter が汎用対応済み、
 * BSDB01-C05/BSKB01/BSLH01 と同型の precedent) で表現していたが、stub 注記が stale なまま
 * 残っていた（feedback_fidelity_audit_stale_stub_notes）。本テストは両分岐が実際に候補として
 * 解決されることを盤面変化で検証し、stub 除去の裏付けとする。
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
const C02 = cardNoMap.get("BSTH02-C02")!;
const noTriggeredLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function fillerDef(
  cardNo: string,
  overrides: Partial<CardDefinition>
): CardDefinition {
  return {
    cardNo,
    name: `テスト用 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "妖精",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
    ...overrides,
  } as CardDefinition;
}

// pick[0] 候補: 紫/白の導界者ネクサス
const NEXUS_GUIDE = fillerDef("TEST-C02-NEXUS-GUIDE", {
  printedCategory: "nexus",
  colors: ["purple"],
  tribe: "導界者",
});
// pick[1] 分岐1 候補: 紫/白 幻想スピリット
const FANTASY_SPIRIT = fillerDef("TEST-C02-FANTASY-SPIRIT", {
  printedCategory: "spirit",
  colors: ["white"],
  tribe: "幻想",
});
// pick[1] 分岐2 候補: 幻想&冥主 (カテゴリ不問、ここではマジックにして分岐1と区別)
const FANTASY_MEINUSHI = fillerDef("TEST-C02-FANTASY-MEINUSHI", {
  printedCategory: "magic",
  colors: ["red"],
  tribe: "幻想・冥主",
});
// どちらの pick にも一致しない残りカード（remainder 1枚でデッキ下へ自動確定させる用）
const UNRELATED = fillerDef("TEST-C02-UNRELATED", {
  printedCategory: "magic",
  colors: ["red"],
  tribe: "不知火",
});

const testDefs = new Map<string, CardDefinition>(
  [NEXUS_GUIDE, FANTASY_SPIRIT, FANTASY_MEINUSHI, UNRELATED].map((d) => [
    d.cardNo,
    d,
  ])
);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.get(id);

function revealEffect() {
  return C02.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "deck_reveal")
  )!;
}

function baseState(pick1Card: CardDefinition): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const c02Instance = createCardInstance(C02, {
    instanceId: "c02",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const nexus = createCardInstance(NEXUS_GUIDE, {
    instanceId: "nexus-guide",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const pick1 = createCardInstance(pick1Card, {
    instanceId: "pick1-card",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const unrelated = createCardInstance(UNRELATED, {
    instanceId: "unrelated",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [c02Instance, nexus, pick1, unrelated],
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, deckCount: 3 } : p
    ),
  };
}

function revealAndPickBoth(state: GameState, pick1SelectedId: string) {
  const effect = revealEffect();
  const afterReveal = executeEffect({
    chainId: "test:bsth02-c02-deck-reveal-or-pick:132",
    state,
    effect,
    sourceInstanceId: "c02",
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
  expect(afterReveal.pendingDeckReveal).not.toBeNull();

  const pick0Action = getLegalActions({
    state: afterReveal,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  expect(pick0Action).toBeDefined();
  const afterPick0 = applyLegalAction({
    state: afterReveal,
    action: pick0Action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggeredLookup,
    selectedDeckRevealCardIds: ["nexus-guide"],
  }).state;
  expect(afterPick0.pendingDeckReveal).not.toBeNull();

  const pick1Action = getLegalActions({
    state: afterPick0,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  expect(pick1Action).toBeDefined();
  return applyLegalAction({
    state: afterPick0,
    action: pick1Action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggeredLookup,
    selectedDeckRevealCardIds: [pick1SelectedId],
  }).state;
}

describe("BSTH02-C02 effects[1] 2つ目の pick の filterOr (stub 解除)", () => {
  it("card-data: stub 除去済み、pick[1] は filterOr 2分岐", () => {
    const effect = revealEffect();
    expect(effect.stub).toBeUndefined();
    const reveal = effect.steps[0]!.action;
    if (reveal.kind !== "deck_reveal") throw new Error("unreachable");
    expect(reveal.picks).toHaveLength(2);
    const pick1 = reveal.picks[1]!;
    expect(pick1.filter?.filterOr).toEqual([
      {
        category: ["spirit"],
        colors: ["purple", "white"],
        tribes: ["幻想"],
      },
      { tribes: ["幻想", "冥主"], tribesLogic: "and" },
    ]);
  });

  it("分岐1: 紫/白幻想スピリットを手札に加えられる", () => {
    const state = baseState(FANTASY_SPIRIT);
    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const after = revealAndPickBoth(state, "pick1-card");
    expect(after.pendingDeckReveal).toBeNull();
    const picked = after.cardInstances.find(
      (c) => c.instanceId === "pick1-card"
    )!;
    expect(picked.zone).toBe("hand");
    // nexus-guide (pick0) も同時に手札に加わっているため +2
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before + 2
    );
  });

  it("分岐2: 幻想&冥主カード(カテゴリ不問)を手札に加えられる", () => {
    const state = baseState(FANTASY_MEINUSHI);
    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const after = revealAndPickBoth(state, "pick1-card");
    expect(after.pendingDeckReveal).toBeNull();
    const picked = after.cardInstances.find(
      (c) => c.instanceId === "pick1-card"
    )!;
    expect(picked.zone).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before + 2
    );
  });

  it("いずれの分岐にも一致しないカードは pick[1] 候補から除外される", () => {
    const state = baseState(UNRELATED);
    // pick1SelectedId として一致しない候補を選ぼうとすると invalid candidate エラー
    const effect = revealEffect();
    const afterReveal = executeEffect({
      chainId: "test:bsth02-c02-deck-reveal-or-pick:222",
      state,
      effect,
      sourceInstanceId: "c02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const pick0Action = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    const afterPick0 = applyLegalAction({
      state: afterReveal,
      action: pick0Action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: ["nexus-guide"],
    }).state;
    const pick1Action = getLegalActions({
      state: afterPick0,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(() =>
      applyLegalAction({
        state: afterPick0,
        action: pick1Action!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
        selectedDeckRevealCardIds: ["unrelated"],
      })
    ).toThrow(/Invalid deck reveal pick candidate/);
  });
});
