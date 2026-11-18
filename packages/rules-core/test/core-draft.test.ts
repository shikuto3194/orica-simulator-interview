import { describe, it, expect } from "vitest";
import {
  applyDraftCoreMoves,
  createCardInstance,
  createEmptyGameState,
  findManualCoreMoveViolation,
  recomposeCoreSourceAllocationLegalAction,
  recomposeCoreSplitLegalAction,
} from "../src";
import type {
  CardDefinition,
  CardInstance,
  DraftCoreMove,
  GameState,
  PlayerState,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(cardNo = "TEST-001"): CardDefinition {
  return {
    cardNo,
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: [],
  } as CardDefinition;
}

function tokenManagedDef(cardNo = "TOKEN-001"): CardDefinition {
  return {
    ...dummyDef(cardNo),
    tokenIndependentCoreManagement: {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    },
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  owner = ALICE,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((player) => player.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((card) => card.instanceId === id)!;
}

describe("applyDraftCoreMoves", () => {
  // #1
  it("returns the same state reference for an empty draft list", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const next = applyDraftCoreMoves(state, []);

    expect(next).toBe(state);
  });

  // #2
  it("applies a single normal-core move (reserve → card)", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 2,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
    expect(getCard(next, "s1").normalCoreCount).toBe(3);
  });

  // #3
  it("applies normal-core moves to multiple targets (reserve → card A, reserve → card B)", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1), fieldCard("s2", ALICE, 1)],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s2" },
        amount: 2,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
    expect(getCard(next, "s1").normalCoreCount).toBe(2);
    expect(getCard(next, "s2").normalCoreCount).toBe(3);
  });

  // #4
  it("applies token forced-void redirects when a definition lookup is supplied", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "token-1" },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "core_move",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts, (id) =>
      id === token.cardNo ? token : undefined
    );

    expect(getCard(next, "token-1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(1);
  });

  it("keeps enter-field placement drafts exempt from token destination restrictions", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "token-1" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts, (id) =>
      id === token.cardNo ? token : undefined
    );

    expect(getCard(next, "token-1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
  });

  it("blocks non-placement soul drafts onto token enter-field-only destinations when lookup is supplied", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "token-1" },
        purpose: "core_move",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts, (id) =>
      id === token.cardNo ? token : undefined
    );

    expect(next).toBe(state);
    expect(getCard(next, "token-1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("keeps soul enter-field placement drafts exempt from token destination restrictions", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "token-1" },
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts, (id) =>
      id === token.cardNo ? token : undefined
    );

    expect(getCard(next, "token-1").soulCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "token-1",
    });
  });

  it("keeps token source redirects active for enter-field placement drafts", () => {
    const token = tokenManagedDef();
    const plain = dummyDef("PLAIN-001");
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(plain, {
          instanceId: "plain-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 0, voidNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "token-1" },
        to: { kind: "card", instanceId: "plain-1" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts, (id) =>
      id === token.cardNo ? token : id === plain.cardNo ? plain : undefined
    );

    expect(getCard(next, "token-1").normalCoreCount).toBe(0);
    expect(getCard(next, "plain-1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(1);
  });

  // #5
  it("decrements reserve correctly when same source is drained twice", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 5 }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
    expect(getCard(next, "s1").normalCoreCount).toBe(2);
  });

  // #5
  it("applies a soul-core-only move (reserve → card)", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s1",
    });
  });

  // #6
  it("mixes normal and soul core moves correctly", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [
        {
          reserveNormalCoreCount: 4,
          soulCoreLocation: { kind: "reserve" },
        },
      ],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 2,
        purpose: "placement",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s1",
    });
    expect(getCard(next, "s1").normalCoreCount).toBe(2);
  });

  // #7
  it("throws when amount exceeds available cores at source", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 2,
        purpose: "placement",
      },
    ];

    expect(() => applyDraftCoreMoves(state, drafts)).toThrow(
      /Not enough normal cores at source/
    );
  });

  // #8
  it("throws when soul core is not at the expected source", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [{ soulCoreLocation: { kind: "trash" } }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        purpose: "placement",
      },
    ];

    expect(() => applyDraftCoreMoves(state, drafts)).toThrow(
      /Soul core is not at the expected source/
    );
  });

  // #9
  it("does not mutate the original state", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        { reserveNormalCoreCount: 4, soulCoreLocation: { kind: "reserve" } },
      ],
    });

    const aliceBefore = getPlayer(state, ALICE);
    const cardBefore = getCard(state, "s1");
    const reserveBefore = aliceBefore.reserveNormalCoreCount;
    const soulLocBefore = aliceBefore.soulCoreLocation;
    const cardCountBefore = cardBefore.normalCoreCount;

    applyDraftCoreMoves(state, [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 2,
        purpose: "placement",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        purpose: "placement",
      },
    ]);

    expect(getPlayer(state, ALICE).reserveNormalCoreCount).toBe(reserveBefore);
    expect(getPlayer(state, ALICE).soulCoreLocation).toEqual(soulLocBefore);
    expect(getCard(state, "s1").normalCoreCount).toBe(cardCountBefore);
  });

  // #10
  it("treats from === to as a no-op (delegates to moveNormalCores noop path)", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "reserve", playerId: ALICE },
        amount: 2,
        purpose: "core_move",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(next).toBe(state);
  });

  // 追加: 複数プレイヤーをまたぐ場合 (片側 reserve → 自カード) でも他プレイヤーには影響しない
  it("does not affect the opposing player's resources", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { reserveNormalCoreCount: 3 },
      ],
    });

    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "s1" },
        amount: 2,
        purpose: "placement",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getPlayer(next, BOB).reserveNormalCoreCount).toBe(3);
  });

  it("skips core_split drafts because legal action payload owns the commit", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ voidNormalCoreCount: 2, reserveNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "void", playerId: ALICE },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "core_split",
        coreSplitDestinationIndex: 0,
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(next).toBe(state);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
  });

  it("applies core_source_allocation drafts as preview moves", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
      playerOverrides: [{ voidNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "s1" },
        to: { kind: "void", playerId: ALICE },
        amount: 2,
        purpose: "core_source_allocation",
      },
    ];

    const next = applyDraftCoreMoves(state, drafts);

    expect(getCard(next, "s1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(2);
  });
});

describe("core pending legal action recomposition", () => {
  it("recomposes core_split drafts into a destination-ordered distribution", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "void", playerId: ALICE },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "core_split",
        coreSplitDestinationIndex: 0,
      },
      {
        kind: "normal",
        from: { kind: "void", playerId: ALICE },
        to: { kind: "void", playerId: ALICE },
        amount: 2,
        purpose: "core_split",
        coreSplitDestinationIndex: 1,
      },
    ];

    expect(
      recomposeCoreSplitLegalAction(drafts, [
        { kind: "reserve", playerId: ALICE },
        { kind: "void", playerId: ALICE },
      ]).coreSplitDistribution
    ).toEqual([1, 2]);
  });

  it("recomposes core_source_allocation drafts into source allocations", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "s1" },
        to: { kind: "void", playerId: ALICE },
        amount: 1,
        purpose: "core_source_allocation",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "s1" },
        to: { kind: "void", playerId: ALICE },
        amount: 1,
        purpose: "core_source_allocation",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "s2" },
        to: { kind: "void", playerId: ALICE },
        amount: 1,
        purpose: "core_source_allocation",
      },
    ];

    expect(recomposeCoreSourceAllocationLegalAction(drafts)).toEqual({
      coreSourceAllocations: { s1: 2, s2: 1 },
    });
  });
});

// P3-90: 独立コア管理カード（創界神/導界者/創界石）への手動コア移動禁止
describe("findManualCoreMoveViolation", () => {
  // grandwalkerData を持つだけで判定するため、forbidden タグは付けない
  // （SSOT 述語 hasIndependentCoreManagement が tag 非依存であることを兼ねて確認）。
  function grandwalkerDef(cardNo = "GW-001"): CardDefinition {
    return {
      ...dummyDef(cardNo),
      name: "テスト創界神",
      printedCategory: "nexus",
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    } as CardDefinition;
  }

  function grandwalkerCard(instanceId: string, owner = ALICE): CardInstance {
    return createCardInstance(grandwalkerDef(), {
      instanceId,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: 2,
    });
  }

  const defLookup = (id: string): CardDefinition | undefined => {
    if (id === "GW-001") return grandwalkerDef();
    if (id === "TOKEN-001") return tokenManagedDef();
    if (id === "TEST-001") return dummyDef();
    return undefined;
  };

  it("rejects placing cores onto a grandwalker nexus (reserve → grandwalker)", () => {
    const state = createEmptyGameState({
      cardInstances: [grandwalkerCard("gw1")],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "gw1" },
        amount: 1,
        purpose: "core_move",
      },
    ];

    const violation = findManualCoreMoveViolation(state, drafts, defLookup);

    expect(violation).not.toBeNull();
    expect(violation?.side).toBe("to");
    expect(violation?.instanceId).toBe("gw1");
  });

  it("rejects removing cores from a grandwalker nexus (grandwalker → reserve)", () => {
    const state = createEmptyGameState({
      cardInstances: [grandwalkerCard("gw1")],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "gw1" },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "core_move",
      },
    ];

    const violation = findManualCoreMoveViolation(state, drafts, defLookup);

    expect(violation?.side).toBe("from");
    expect(violation?.instanceId).toBe("gw1");
  });

  it("rejects moving the soul core onto a grandwalker nexus", () => {
    const state = createEmptyGameState({
      cardInstances: [grandwalkerCard("gw1")],
      playerOverrides: [{ reserveSoulCoreCount: 1 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "gw1" },
        purpose: "core_move",
      },
    ];

    const violation = findManualCoreMoveViolation(state, drafts, defLookup);

    expect(violation?.side).toBe("to");
  });

  it("rejects placing cores onto a token that only accepts enter-field placement", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "token-1" },
        amount: 1,
        purpose: "core_move",
      },
    ];

    const violation = findManualCoreMoveViolation(state, drafts, defLookup);

    expect(violation?.side).toBe("to");
    expect(violation?.instanceId).toBe("token-1");
  });

  it("does not reject moving cores off a token; the projection redirects them to void", () => {
    const token = tokenManagedDef();
    const state = createEmptyGameState({
      cardInstances: [
        createCardInstance(token, {
          instanceId: "token-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "token-1" },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "core_move",
      },
    ];

    expect(findManualCoreMoveViolation(state, drafts, defLookup)).toBeNull();
  });

  it("allows manual core moves between normal spirits", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 2), fieldCard("s2", ALICE, 1)],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "s1" },
        to: { kind: "card", instanceId: "s2" },
        amount: 1,
        purpose: "core_move",
      },
    ];

    expect(findManualCoreMoveViolation(state, drafts, defLookup)).toBeNull();
  });

  it("allows reserve ↔ reserve / non-card moves regardless of board", () => {
    const state = createEmptyGameState({
      cardInstances: [grandwalkerCard("gw1")],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "core_move",
      },
    ];

    expect(findManualCoreMoveViolation(state, drafts, defLookup)).toBeNull();
  });

  // 06_core-system.md:69「ボイドは常に不可。explicit 指定があってもソウルコアを
  // ボイドに置くことはできない」。手動コア移動は generic なので常に拒否する。
  it("rejects moving the soul core to void (06:69 hard constraint)", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "void", playerId: ALICE },
        purpose: "core_move",
      },
    ];

    const violation = findManualCoreMoveViolation(state, drafts, defLookup);

    expect(violation).not.toBeNull();
    expect(violation?.side).toBe("to");
    expect(violation?.instanceId).toBeUndefined();
  });

  // ライフ可否は裁定が分かれる（[[project_soul_core_movement_generic]]）ため、
  // 本ガードはボイドのみを硬制約として扱い、ソウルコア→ライフは拒否しない。
  it("does not reject soul core → life via the void guard", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "life", playerId: ALICE },
        purpose: "core_move",
      },
    ];

    expect(findManualCoreMoveViolation(state, drafts, defLookup)).toBeNull();
  });

  // 通常コアはボイドに存在し得る正規ゾーンなので、normal→void は本ガードでは拒否しない。
  it("does not reject normal core → void via the soul void guard", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "void", playerId: ALICE },
        amount: 1,
        purpose: "core_move",
      },
    ];

    expect(findManualCoreMoveViolation(state, drafts, defLookup)).toBeNull();
  });
});
