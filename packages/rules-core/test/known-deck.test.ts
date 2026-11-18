import { describe, expect, it } from "vitest";
import {
  appendPublicDisclosuresForStateTransition,
  backfillOptionalStateFields,
  createCardInstance,
  getKnownDeckCards,
  rememberKnownDeckCardsByInstanceIds,
  createEmptyGameState,
  executePeekDeck,
  executeEffect,
  mulliganHand,
  executeShuffleZone,
  sanitizeStateForViewer,
  syncKnownDeckCardsForStateTransition,
} from "../src";
import type { CardDefinition } from "../src";

const TEST_SPIRIT: CardDefinition = {
  cardNo: "KNOWN-DECK-SPIRIT",
  name: "既知デッキテストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const TEST_NEXUS: CardDefinition = {
  ...TEST_SPIRIT,
  cardNo: "KNOWN-DECK-NEXUS",
  name: "既知デッキテストネクサス",
  printedCategory: "nexus",
  levelDefs: [{ level: 1, requiredCores: 0 }],
};

const TEST_MAGIC: CardDefinition = {
  ...TEST_SPIRIT,
  cardNo: "KNOWN-DECK-MAGIC",
  name: "既知デッキテストマジック",
  printedCategory: "magic",
  levelDefs: [],
};

describe("known deck cards", () => {
  it("自分だけに公開されたカードをデッキへ戻すと、その既知位置も自分だけに残す", () => {
    const hiddenTop = createCardInstance(TEST_SPIRIT, {
      instanceId: "known-deck-hidden-top",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const hiddenBottom = createCardInstance(TEST_NEXUS, {
      instanceId: "known-deck-hidden-bottom",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const revealedA = createCardInstance(TEST_SPIRIT, {
      instanceId: "known-deck-revealed-a",
      ownerPlayerId: "alice",
      zone: "revealed",
    });
    const revealedB = createCardInstance(TEST_MAGIC, {
      instanceId: "known-deck-revealed-b",
      ownerPlayerId: "alice",
      zone: "revealed",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        hiddenTop,
        hiddenBottom,
        {
          ...revealedA,
          revealedTo: "self",
          revealedByPlayerId: "alice",
        },
        {
          ...revealedB,
          revealedTo: "self",
          revealedByPlayerId: "alice",
        },
      ],
      playerOverrides: [{ deckCount: 2 }, {}],
    });
    const after = {
      ...before,
      cardInstances: [
        hiddenTop,
        hiddenBottom,
        { ...revealedA, zone: "deck" as const },
        { ...revealedB, zone: "deck" as const },
      ],
      players: before.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 4 } : player
      ),
    };

    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });

    expect(sanitizeStateForViewer(result, "alice").knownDeckCards).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 0,
        definitionIdSnapshot: TEST_MAGIC.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
      {
        playerId: "alice",
        indexFromBottom: 1,
        definitionIdSnapshot: TEST_SPIRIT.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
    ]);
    expect(sanitizeStateForViewer(result, "bob").knownDeckCards).toEqual([]);
  });

  it("peek_deck は見えたデッキ上カードの既知位置を記録し、deck shuffle で消す", () => {
    const top = createCardInstance(TEST_SPIRIT, {
      instanceId: "peek-known-top",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const second = createCardInstance(TEST_NEXUS, {
      instanceId: "peek-known-second",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const bottom = createCardInstance(TEST_MAGIC, {
      instanceId: "peek-hidden-bottom",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [top, second, bottom],
      playerOverrides: [{ deckCount: 3 }, {}],
    });

    const peeked = executePeekDeck(state, "alice", {
      kind: "peek_deck",
      count: 2,
      revealTo: "self",
    });

    expect(sanitizeStateForViewer(peeked, "alice").knownDeckCards).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 1,
        definitionIdSnapshot: TEST_NEXUS.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
      {
        playerId: "alice",
        indexFromBottom: 2,
        definitionIdSnapshot: TEST_SPIRIT.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
    ]);
    expect(sanitizeStateForViewer(peeked, "bob").knownDeckCards).toEqual([]);

    const shuffled = executeShuffleZone(peeked, "alice", {
      kind: "shuffle_zone",
      zone: "deck",
    });
    expect(sanitizeStateForViewer(shuffled, "alice").knownDeckCards).toEqual(
      []
    );
  });

  it("既知デッキカードはドローやデッキ破棄でデッキ外へ出たら除去し、残る既知位置だけ再投影する", () => {
    const knownTop = createCardInstance(TEST_SPIRIT, {
      instanceId: "known-deck-draw-top",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const hiddenMiddle = createCardInstance(TEST_MAGIC, {
      instanceId: "known-deck-draw-hidden-middle",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const knownBottom = createCardInstance(TEST_NEXUS, {
      instanceId: "known-deck-draw-bottom",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [knownTop, hiddenMiddle, knownBottom],
      playerOverrides: [{ deckCount: 3 }, {}],
    });
    const withKnown = {
      ...before,
      knownDeckCards: [
        {
          playerId: "alice",
          indexFromBottom: 0,
          definitionIdSnapshot: TEST_NEXUS.cardNo,
          audience: "actor_only" as const,
          actorPlayerId: "alice",
        },
        {
          playerId: "alice",
          indexFromBottom: 2,
          definitionIdSnapshot: TEST_SPIRIT.cardNo,
          audience: "actor_only" as const,
          actorPlayerId: "alice",
        },
      ],
    };
    const afterDraw = {
      ...withKnown,
      cardInstances: withKnown.cardInstances.map((card) =>
        card.instanceId === knownTop.instanceId
          ? { ...card, zone: "hand" as const }
          : card
      ),
      players: withKnown.players.map((player) =>
        player.id === "alice"
          ? { ...player, deckCount: 2, handCount: player.handCount + 1 }
          : player
      ),
    };

    const syncedAfterDraw = syncKnownDeckCardsForStateTransition({
      before: withKnown,
      after: afterDraw,
      actorPlayerId: "alice",
    });
    expect(
      sanitizeStateForViewer(syncedAfterDraw, "alice").knownDeckCards
    ).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 0,
        definitionIdSnapshot: TEST_NEXUS.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
    ]);

    const afterDeckDiscard = {
      ...withKnown,
      cardInstances: withKnown.cardInstances.map((card) =>
        card.instanceId === knownTop.instanceId
          ? { ...card, zone: "trash" as const }
          : card
      ),
      players: withKnown.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 2 } : player
      ),
    };
    const syncedAfterDeckDiscard = syncKnownDeckCardsForStateTransition({
      before: withKnown,
      after: afterDeckDiscard,
      actorPlayerId: "alice",
    });
    expect(
      sanitizeStateForViewer(syncedAfterDeckDiscard, "alice").knownDeckCards
    ).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 0,
        definitionIdSnapshot: TEST_NEXUS.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
    ]);
  });

  it("順番変更後の再オープンは現在のデッキ順で既知位置を上書きし、公開範囲も更新する", () => {
    const top = createCardInstance(TEST_SPIRIT, {
      instanceId: "known-deck-reopen-top",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const second = createCardInstance(TEST_NEXUS, {
      instanceId: "known-deck-reopen-second",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const bottom = createCardInstance(TEST_MAGIC, {
      instanceId: "known-deck-reopen-bottom",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [top, second, bottom],
      playerOverrides: [{ deckCount: 3 }, {}],
    });
    const peekedSelf = executePeekDeck(state, "alice", {
      kind: "peek_deck",
      count: 2,
      revealTo: "self",
    });
    const reordered = {
      ...peekedSelf,
      cardInstances: [
        peekedSelf.cardInstances[1]!,
        peekedSelf.cardInstances[0]!,
        peekedSelf.cardInstances[2]!,
      ],
    };

    const syncedAfterOrderChange = syncKnownDeckCardsForStateTransition({
      before: peekedSelf,
      after: reordered,
      actorPlayerId: "alice",
    });
    expect(
      sanitizeStateForViewer(syncedAfterOrderChange, "alice").knownDeckCards
    ).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 1,
        definitionIdSnapshot: TEST_SPIRIT.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
      {
        playerId: "alice",
        indexFromBottom: 2,
        definitionIdSnapshot: TEST_NEXUS.cardNo,
        audience: "actor_only",
        actorPlayerId: "alice",
      },
    ]);
    expect(
      sanitizeStateForViewer(syncedAfterOrderChange, "bob").knownDeckCards
    ).toEqual([]);

    const reopenedBoth = executePeekDeck(syncedAfterOrderChange, "alice", {
      kind: "peek_deck",
      count: 2,
      revealTo: "both",
    });
    expect(sanitizeStateForViewer(reopenedBoth, "bob").knownDeckCards).toEqual([
      {
        playerId: "alice",
        indexFromBottom: 1,
        definitionIdSnapshot: TEST_SPIRIT.cardNo,
        audience: "both",
        actorPlayerId: "alice",
      },
      {
        playerId: "alice",
        indexFromBottom: 2,
        definitionIdSnapshot: TEST_NEXUS.cardNo,
        audience: "both",
        actorPlayerId: "alice",
      },
    ]);
  });
});

describe("deck knowledge lifecycle and privacy", () => {
  const make = () =>
    createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(TEST_SPIRIT, {
          instanceId: "visible",
          ownerPlayerId: "alice",
          zone: "revealed",
        }),
        createCardInstance(TEST_MAGIC, {
          instanceId: "hidden",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
      playerOverrides: [{ deckCount: 1 }, {}],
    });
  const returned = () => {
    const before = make();
    return syncKnownDeckCardsForStateTransition({
      before,
      after: {
        ...before,
        cardInstances: before.cardInstances.map((card) => ({
          ...card,
          zone: "deck" as const,
        })),
      },
      actorPlayerId: "alice",
    });
  };
  it("shuffle の後に外側の解決境界を通っても公開情報を再生成しない", () => {
    const before = make();
    const shuffled = executeShuffleZone(returned(), "alice", {
      kind: "shuffle_zone",
      zone: "deck",
    });
    const outer = syncKnownDeckCardsForStateTransition({
      before,
      after: shuffled,
      actorPlayerId: "alice",
    });
    expect(getKnownDeckCards(outer)).toEqual([]);
    expect(sanitizeStateForViewer(outer, "bob").knownDeckCards).toEqual([]);
  });
  it("下からの位置は移動通知なしでも現在の配列から導出し、追跡属性をviewerへ送らない", () => {
    const state = returned();
    const reordered = {
      ...state,
      cardInstances: [...state.cardInstances].reverse(),
    };
    expect(
      getKnownDeckCards(reordered).map((entry) => entry.indexFromBottom)
    ).toEqual([0]);
    expect(reordered.knownDeckCards).toBeUndefined();
    for (const viewer of ["alice", "bob"]) {
      const visible = sanitizeStateForViewer(reordered, viewer);
      expect(JSON.stringify(visible)).not.toContain("deckKnowledge");
      expect(visible.knownDeckCards).toEqual(getKnownDeckCards(reordered));
      expect(visible.knownDeckCards?.[0]).not.toHaveProperty("instanceId");
    }
  });
  it("デッキから手札へ出たカードの非公開戻しは本人だけ位置を知る", () => {
    const before = returned();
    const hand = syncKnownDeckCardsForStateTransition({
      before,
      after: {
        ...before,
        cardInstances: before.cardInstances.map((card) =>
          card.instanceId === "visible"
            ? { ...card, zone: "hand" as const }
            : card
        ),
      },
      actorPlayerId: "alice",
    });
    const deckAgain = syncKnownDeckCardsForStateTransition({
      before: hand,
      after: {
        ...hand,
        cardInstances: hand.cardInstances.map((card) => ({
          ...card,
          zone: "deck" as const,
        })),
      },
      actorPlayerId: "alice",
    });
    expect(
      sanitizeStateForViewer(deckAgain, "alice").knownDeckCards
    ).toHaveLength(1);
    expect(sanitizeStateForViewer(deckAgain, "bob").knownDeckCards).toEqual([]);
  });
  it("公開から手札を経て非公開で戻したカードを外側の境界で再発見しない", () => {
    const before = make();
    const hand = syncKnownDeckCardsForStateTransition({
      before,
      after: {
        ...before,
        cardInstances: before.cardInstances.map((card) =>
          card.instanceId === "visible"
            ? { ...card, zone: "hand" as const }
            : card
        ),
      },
      actorPlayerId: "alice",
    });
    const deck = syncKnownDeckCardsForStateTransition({
      before: hand,
      after: {
        ...hand,
        cardInstances: hand.cardInstances.map((card) =>
          card.instanceId === "visible"
            ? { ...card, zone: "deck" as const }
            : card
        ),
      },
      actorPlayerId: "alice",
    });
    expect(sanitizeStateForViewer(deck, "alice").knownDeckCards).toHaveLength(
      1
    );
    const outer = syncKnownDeckCardsForStateTransition({
      before,
      after: deck,
      actorPlayerId: "alice",
    });
    expect(getKnownDeckCards(outer)).toEqual(getKnownDeckCards(deck));
    expect(sanitizeStateForViewer(outer, "bob").knownDeckCards).toEqual([]);
  });
  it("2段のmove_cardの手札経由戻しは相手への既知情報を復活させない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(TEST_SPIRIT, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(TEST_SPIRIT, {
          instanceId: "target",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    });
    const inner = executeEffect({
      chainId: "test:known-deck:516",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        executionMode: "mandatory",
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "trash", player: "self" },
              to: { zone: "hand", player: "self" },
              count: 1,
            },
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "self" },
              to: { zone: "deck", player: "self", position: "bottom" },
              count: 1,
              unseen: true,
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: () => TEST_SPIRIT,
    });
    expect(
      inner.cardInstances.find((card) => card.instanceId === "target")?.zone
    ).toBe("deck");
    expect(sanitizeStateForViewer(inner, "alice").knownDeckCards).toHaveLength(
      1
    );
    const outer = appendPublicDisclosuresForStateTransition({
      before: state,
      after: inner,
      actorPlayerId: "alice",
    });
    expect(getKnownDeckCards(outer)).toEqual(getKnownDeckCards(inner));
    expect(sanitizeStateForViewer(outer, "bob").knownDeckCards).toEqual([]);
  });
  it("マリガンで引いた手札の非公開戻しは本人だけ新しい位置を知る", () => {
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: Array.from({ length: 9 }, (_, i) =>
        createCardInstance(TEST_SPIRIT, {
          instanceId: "mulligan-" + i,
          ownerPlayerId: "alice",
          zone: i === 0 ? "hand" : "deck",
        })
      ),
      playerOverrides: [{ handCount: 1, deckCount: 8 }, {}],
    });
    const known = rememberKnownDeckCardsByInstanceIds({
      state: initial,
      playerId: "alice",
      instanceIds: initial.cardInstances.map((card) => card.instanceId),
      audience: "both",
      actorPlayerId: "alice",
    });
    const shuffled = mulliganHand(known, "alice", () => TEST_SPIRIT);
    const hand = shuffled.cardInstances.filter((card) => card.zone === "hand");
    expect(hand).toHaveLength(4);
    for (const card of hand) expect(card).not.toHaveProperty("deckKnowledge");
    const returned = executeEffect({
      chainId: "test:known-deck:582",
      state: shuffled,
      effect: {
        timing: { kind: "activated", mode: "main" },
        executionMode: "mandatory",
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "self" },
              to: { zone: "deck", player: "self", position: "bottom" },
              count: 4,
              unseen: true,
            },
          },
        ],
      },
      sourceInstanceId: "mulligan-0",
      actingPlayerId: "alice",
      getCardDefinitionById: () => TEST_SPIRIT,
    });
    expect(
      returned.cardInstances.filter((card) => card.zone === "deck")
    ).toHaveLength(9);
    expect(
      sanitizeStateForViewer(returned, "alice").knownDeckCards
    ).toHaveLength(4);
    expect(sanitizeStateForViewer(returned, "bob").knownDeckCards).toEqual([]);
  });
  it("各viewerの確認を統合し、後から片方だけ確認しても既に公開した情報を隠さない", () => {
    let state = make();
    for (const audience of [
      "actor_only",
      "opponent_only",
      "actor_only",
    ] as const) {
      state = rememberKnownDeckCardsByInstanceIds({
        state,
        playerId: "alice",
        instanceIds: ["hidden"],
        audience,
        actorPlayerId: "alice",
      });
    }
    expect(getKnownDeckCards(state)).toMatchObject([{ audience: "both" }]);
    expect(sanitizeStateForViewer(state, "alice").knownDeckCards).toHaveLength(
      1
    );
    expect(sanitizeStateForViewer(state, "bob").knownDeckCards).toHaveLength(1);
  });
  it("旧完全snapshotは実体と一致するスロットだけを移行し、ずれた定義を別カードに貼らない", () => {
    const legacy = {
      ...make(),
      knownDeckCards: [
        {
          playerId: "alice",
          indexFromBottom: 0,
          definitionIdSnapshot: TEST_MAGIC.cardNo,
          audience: "both" as const,
          actorPlayerId: "alice",
        },
      ],
    };
    const normalized = backfillOptionalStateFields(legacy);
    expect(normalized.knownDeckCards).toBeUndefined();
    expect(getKnownDeckCards(normalized)).toEqual(legacy.knownDeckCards);
    const invalid = backfillOptionalStateFields({
      ...legacy,
      knownDeckCards: [
        {
          ...legacy.knownDeckCards[0]!,
          definitionIdSnapshot: TEST_SPIRIT.cardNo,
        },
      ],
    });
    expect(getKnownDeckCards(invalid)).toEqual([]);
    expect(getKnownDeckCards(JSON.parse(JSON.stringify(normalized)))).toEqual(
      getKnownDeckCards(normalized)
    );
  });
  it("1枚デッキのshuffleでも既知位置を忘れる", () => {
    const state = executePeekDeck(make(), "alice", {
      kind: "peek_deck",
      count: 1,
      revealTo: "both",
    });
    expect(getKnownDeckCards(state)).toHaveLength(1);
    expect(
      getKnownDeckCards(
        executeShuffleZone(state, "alice", {
          kind: "shuffle_zone",
          zone: "deck",
        })
      )
    ).toEqual([]);
  });
});
