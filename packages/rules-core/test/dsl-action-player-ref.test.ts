import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { executeEffect } from "../src/effect/effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PlayerState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-DAPR-001",
    name: "DAPR Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set("TEST-DAPR-001", dummyDef());

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id) ?? dummyDef();
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function runEffect(
  state: GameState,
  effect: Effect,
  sourceId = "src"
): GameState {
  return executeEffect({
    chainId: "test:dsl-action-player-ref:55",
    state,
    effect,
    sourceInstanceId: sourceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

function resolveZoneSelection(
  state: GameState,
  selectedZoneCardIds: string[]
): GameState {
  const pending = state.pendingZoneSelection!;
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_zone_selection",
      actionId: `zs-${pending.actionKind}`,
      can: true,
      reason: "test",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      actionKind: pending.actionKind,
      candidateCardInstanceIds: pending.candidateCardInstanceIds,
      maxCount: pending.maxCount,
      canSkip: pending.canSkip ?? true,
    },
    selectedZoneCardIds,
    getCardDefinitionById: getCardDef,
    getRegisteredTriggeredEffectActions: () => [],
  }).state;
}

function handCard(id: string, owner: string): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

function deckCard(
  id: string,
  owner: string,
  def?: CardDefinition
): CardInstance {
  return createCardInstance(def ?? dummyDef(), {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "deck",
  });
}

// ── P3-17: DSL discard / deck_reveal の action.player 反映 ─────────────────

describe("P3-17: DSL discard action.player", () => {
  it("player=opponent で対戦相手の手札が破棄される", () => {
    const alice1 = handCard("alice-hand-1", ALICE);
    const bob1 = handCard("bob-hand-1", BOB);
    const bob2 = handCard("bob-hand-2", BOB);
    const state = createEmptyGameState({
      cardInstances: [alice1, bob1, bob2],
      playerOverrides: [{ handCount: 1 }, { handCount: 2 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: -1, player: "opponent" } }],
    };

    const result = runEffect(state, effect);

    expect(getCard(result, "alice-hand-1").zone).toBe("hand");
    expect(getCard(result, "bob-hand-1").zone).toBe("trash");
    expect(getCard(result, "bob-hand-2").zone).toBe("trash");
    expect(getPlayer(result, ALICE).handCount).toBe(1);
    expect(getPlayer(result, BOB).handCount).toBe(0);
    expect(
      result.log.some((l) => l.includes(`effect:discard_hand:${BOB}`))
    ).toBe(true);
  });

  it("player=opponent + 候補超過で pendingZoneSelection.actingPlayerId が対戦相手になる", () => {
    const bob1 = handCard("bob-h-1", BOB);
    const bob2 = handCard("bob-h-2", BOB);
    const bob3 = handCard("bob-h-3", BOB);
    const state = createEmptyGameState({
      cardInstances: [bob1, bob2, bob3],
      playerOverrides: [{}, { handCount: 3 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: 1, player: "opponent" } }],
    };

    const result = runEffect(state, effect);

    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection?.actingPlayerId).toBe(BOB);
    expect(
      result.pendingZoneSelection?.candidateCardInstanceIds.sort()
    ).toEqual(["bob-h-1", "bob-h-2", "bob-h-3"].sort());
    // 手札はまだ破棄されていない（pending 状態）
    expect(getPlayer(result, BOB).handCount).toBe(3);
  });

  it("player 未指定は actingPlayerId（self）の手札を破棄する（回帰防止）", () => {
    const alice1 = handCard("alice-regression", ALICE);
    const bob1 = handCard("bob-regression", BOB);
    const state = createEmptyGameState({
      cardInstances: [alice1, bob1],
      playerOverrides: [{ handCount: 1 }, { handCount: 1 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: -1 } }],
    };

    const result = runEffect(state, effect);

    expect(getCard(result, "alice-regression").zone).toBe("trash");
    expect(getCard(result, "bob-regression").zone).toBe("hand");
    expect(getPlayer(result, ALICE).handCount).toBe(0);
    expect(getPlayer(result, BOB).handCount).toBe(1);
  });

  it("player=self 明示指定でも actingPlayerId 側の手札が破棄される", () => {
    const alice1 = handCard("alice-self-1", ALICE);
    const bob1 = handCard("bob-self-1", BOB);
    const state = createEmptyGameState({
      cardInstances: [alice1, bob1],
      playerOverrides: [{ handCount: 1 }, { handCount: 1 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: -1, player: "self" } }],
    };

    const result = runEffect(state, effect);

    expect(getCard(result, "alice-self-1").zone).toBe("trash");
    expect(getCard(result, "bob-self-1").zone).toBe("hand");
  });
});

// ── engine-drain 4: discard targetHandSize（手札がN枚になるように捨てる）───────
describe("engine-drain 4: discard targetHandSize (down-to-N)", () => {
  it("handCount 5 / targetHandSize 3 → 2 枚破棄（手札 owner が選択する pending）", () => {
    const cards = [
      handCard("a-h-1", ALICE),
      handCard("a-h-2", ALICE),
      handCard("a-h-3", ALICE),
      handCard("a-h-4", ALICE),
      handCard("a-h-5", ALICE),
    ];
    const state = createEmptyGameState({
      cardInstances: cards,
      playerOverrides: [{ handCount: 5 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: 0, targetHandSize: 3 } }],
    };

    const result = runEffect(state, effect);

    // 候補超過のため pending 化。捨てる枚数 (maxCount) は handCount-targetHandSize=2。
    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection?.maxCount).toBe(2);
    // 手札 owner（self=ALICE）が選択する。
    expect(result.pendingZoneSelection?.actingPlayerId).toBe(ALICE);
    expect(
      result.pendingZoneSelection?.candidateCardInstanceIds.sort()
    ).toEqual(["a-h-1", "a-h-2", "a-h-3", "a-h-4", "a-h-5"].sort());
    // pending 中なので handCount はまだ 5。
    expect(getPlayer(result, ALICE).handCount).toBe(5);
  });

  it("候補がちょうど破棄枚数なら選択なしで即破棄（handCount 5 / target 3, filter で候補2）", () => {
    // filter で primary 候補を 2 枚に絞ると effectiveCount(2) と一致 → 選択不要。
    const targetDef = dummyDef({ cardNo: "DAPR-PURPLE", colors: ["purple"] });
    defMap.set("DAPR-PURPLE", targetDef);
    const p1 = createCardInstance(targetDef, {
      instanceId: "a-purple-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const p2 = createCardInstance(targetDef, {
      instanceId: "a-purple-2",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      cardInstances: [
        p1,
        p2,
        handCard("a-red-1", ALICE),
        handCard("a-red-2", ALICE),
        handCard("a-red-3", ALICE),
      ],
      playerOverrides: [{ handCount: 5 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            count: 0,
            targetHandSize: 3,
            filter: { colors: ["purple"] },
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    // effectiveCount = 5-3 = 2、purple 候補も 2 枚 → 選択不要で両方破棄。
    expect(result.pendingZoneSelection ?? null).toBeNull();
    expect(getCard(result, "a-purple-1").zone).toBe("trash");
    expect(getCard(result, "a-purple-2").zone).toBe("trash");
    expect(getCard(result, "a-red-1").zone).toBe("hand");
    expect(getPlayer(result, ALICE).handCount).toBe(3);
  });

  it("handCount が既に targetHandSize 以下なら no-op（handCount 2 / target 3）", () => {
    const state = createEmptyGameState({
      cardInstances: [handCard("a-h-1", ALICE), handCard("a-h-2", ALICE)],
      playerOverrides: [{ handCount: 2 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: 0, targetHandSize: 3 } }],
    };

    const result = runEffect(state, effect);

    expect(result.pendingZoneSelection ?? null).toBeNull();
    expect(getCard(result, "a-h-1").zone).toBe("hand");
    expect(getCard(result, "a-h-2").zone).toBe("hand");
    expect(getPlayer(result, ALICE).handCount).toBe(2);
  });

  it("handCount == targetHandSize でも no-op（境界: 3 / 3）", () => {
    const state = createEmptyGameState({
      cardInstances: [
        handCard("a-h-1", ALICE),
        handCard("a-h-2", ALICE),
        handCard("a-h-3", ALICE),
      ],
      playerOverrides: [{ handCount: 3 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: 0, targetHandSize: 3 } }],
    };

    const result = runEffect(state, effect);

    expect(result.pendingZoneSelection ?? null).toBeNull();
    expect(getPlayer(result, ALICE).handCount).toBe(3);
  });

  it("targetHandSize 未指定の count ベース破棄は従来どおり（回帰防止）", () => {
    // count:1 / 手札3枚 → 候補超過で pending（maxCount=1, owner=self）。
    const state = createEmptyGameState({
      cardInstances: [
        handCard("a-h-1", ALICE),
        handCard("a-h-2", ALICE),
        handCard("a-h-3", ALICE),
      ],
      playerOverrides: [{ handCount: 3 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "discard", count: 1 } }],
    };

    const result = runEffect(state, effect);

    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection?.maxCount).toBe(1);
    expect(result.pendingZoneSelection?.actingPlayerId).toBe(ALICE);
    expect(getPlayer(result, ALICE).handCount).toBe(3);
  });

  it("targetHandSize + dynamic capCount は event_amount を上限にして手札を1枚残す", () => {
    const cards = [
      handCard("bob-h-1", BOB),
      handCard("bob-h-2", BOB),
      handCard("bob-h-3", BOB),
      handCard("bob-h-4", BOB),
    ];
    const state = createEmptyGameState({
      cardInstances: cards,
      playerOverrides: [{}, { handCount: 4 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        {
          action: {
            kind: "discard",
            count: { source: { kind: "event_amount" } },
            player: "opponent",
            targetHandSize: 1,
            capCount: { source: { kind: "event_amount" } },
          },
        },
      ],
    };

    const pendingState = executeEffect({
      chainId: "test:dsl-action-player-ref:379",
      state,
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      eventAmount: 3,
    });

    expect(pendingState.pendingZoneSelection).toMatchObject({
      actingPlayerId: BOB,
      actionKind: "discard_hand",
      maxCount: 3,
      canSkip: false,
    });

    const resolved = resolveZoneSelection(pendingState, [
      "bob-h-1",
      "bob-h-2",
      "bob-h-3",
    ]);

    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(getPlayer(resolved, BOB).handCount).toBe(1);
    expect(getCard(resolved, "bob-h-4").zone).toBe("hand");
    expect(getCard(resolved, "bob-h-1").zone).toBe("trash");
  });
});

describe("P3-17: DSL deck_reveal action.player", () => {
  it("player=opponent で対戦相手のデッキがオープンされ、handCount/deckCount も対戦相手のものが更新される", () => {
    const aliceDeck1 = deckCard("alice-d-1", ALICE);
    const aliceDeck2 = deckCard("alice-d-2", ALICE);
    const bobDeck1 = deckCard("bob-d-1", BOB);
    const bobDeck2 = deckCard("bob-d-2", BOB);
    const state = createEmptyGameState({
      cardInstances: [aliceDeck1, aliceDeck2, bobDeck1, bobDeck2],
      playerOverrides: [
        { handCount: 0, deckCount: 2 },
        { handCount: 0, deckCount: 2 },
      ],
    });

    // revealCount=2, picks=1 (全て hand 送り), remainder=trash
    // 全 pick が mandatory ではない（picks はオプション選択） → pending になる
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            player: "opponent",
            revealCount: 2,
            picks: [{ count: 2, destination: "hand" }],
            remainder: "trash",
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    // bob のデッキカードが revealed に移動（オープン中）
    expect(getCard(result, "bob-d-1").zone).toBe("revealed");
    expect(getCard(result, "bob-d-2").zone).toBe("revealed");
    // alice のデッキは無影響
    expect(getCard(result, "alice-d-1").zone).toBe("deck");
    expect(getCard(result, "alice-d-2").zone).toBe("deck");
    // pending が生成され、選択は実行者（alice）
    expect(result.pendingDeckReveal).not.toBeNull();
    expect(result.pendingDeckReveal?.actingPlayerId).toBe(ALICE);
    // ログは対戦相手のプレイヤー ID を含む（オープン対象）
    expect(
      result.log.some((l) => l.includes(`effect:deck_reveal:${BOB}`))
    ).toBe(true);
  });

  it("player=opponent かつ全 mandatory 消化時: 相手の deckCount が減り相手の handCount が増える", () => {
    const triggerDef = dummyDef({
      cardNo: "DAPR-TRIG",
      effects: [
        {
          timing: { kind: "card_event", event: "revealed" },
          cardEventDisposition: { kind: "move", destination: "hand" },
          executionMode: "mandatory",
          steps: [],
        },
      ] as CardDefinition["effects"],
    });
    defMap.set("DAPR-TRIG", triggerDef);

    const bobDeck1 = deckCard("bob-trig-1", BOB, triggerDef);
    const bobDeck2 = deckCard("bob-trig-2", BOB, triggerDef);
    const state = createEmptyGameState({
      cardInstances: [bobDeck1, bobDeck2],
      playerOverrides: [
        { handCount: 0, deckCount: 0 },
        { handCount: 0, deckCount: 2 },
      ],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            player: "opponent",
            revealCount: 2,
            picks: [],
            remainder: "trash",
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    // 両方 mandatory hand 送り
    expect(getCard(result, "bob-trig-1").zone).toBe("hand");
    expect(getCard(result, "bob-trig-2").zone).toBe("hand");
    // 相手側のカウントが更新される（alice は無影響）
    expect(getPlayer(result, BOB).handCount).toBe(2);
    expect(getPlayer(result, BOB).deckCount).toBe(0);
    expect(getPlayer(result, ALICE).handCount).toBe(0);
    expect(getPlayer(result, ALICE).deckCount).toBe(0);
    // mandatory 全消化で pending は生成されない
    expect(result.pendingDeckReveal).toBeNull();
  });

  it("player 未指定は actingPlayerId（self）のデッキをオープンする（回帰防止）", () => {
    const aliceDeck1 = deckCard("alice-r-1", ALICE);
    const aliceDeck2 = deckCard("alice-r-2", ALICE);
    const bobDeck1 = deckCard("bob-r-1", BOB);
    const state = createEmptyGameState({
      cardInstances: [aliceDeck1, aliceDeck2, bobDeck1],
      playerOverrides: [
        { handCount: 0, deckCount: 2 },
        { handCount: 0, deckCount: 1 },
      ],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 2,
            picks: [{ count: 1, destination: "hand" }],
            remainder: "trash",
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    expect(getCard(result, "alice-r-1").zone).toBe("revealed");
    expect(getCard(result, "alice-r-2").zone).toBe("revealed");
    expect(getCard(result, "bob-r-1").zone).toBe("deck");
    expect(result.pendingDeckReveal?.actingPlayerId).toBe(ALICE);
    expect(
      result.log.some((l) => l.includes(`effect:deck_reveal:${ALICE}`))
    ).toBe(true);
  });
});
