import { describe, it, expect } from "vitest";
import {
  collectGameStateInvariantIssues,
  createEmptyGameState,
  createCardInstance,
  getTotalCoresOnCardById,
  isSoulCoreOn,
  getPlayerLifeCoreCount,
  getPlayerReserveCoreCount,
  getPlayerTrashCoreCount,
  moveNormalCores,
  moveSoulCore,
  refreshTrashCoresToReserve,
  refreshExhaustStates,
  resolveLifeDamage,
  resolveCardLeavesFieldCores,
  moveLifeCoreByEffect,
  getAvailableLifeCoreMoveChoices,
} from "../src";
import type { CardDefinition, CardInstance, PlayerState } from "../src";

// ── ヘルパー ───────────────────────────────────────────

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

function getPlayer(
  state: ReturnType<typeof createEmptyGameState>,
  id: string
): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(
  state: ReturnType<typeof createEmptyGameState>,
  id: string
): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

// ── getTotalCoresOnCardById ─────────────────────────────

describe("getTotalCoresOnCardById", () => {
  it("returns normalCoreCount when no soul core", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
    });
    expect(getTotalCoresOnCardById(state, "s1")).toBe(3);
  });

  it("includes soul core via player.soulCoreLocation", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 2)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });
    expect(getTotalCoresOnCardById(state, "s1")).toBe(3);
  });

  it("returns 1 when only soul core", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });
    expect(getTotalCoresOnCardById(state, "s1")).toBe(1);
  });

  it("returns 0 when card not found", () => {
    const state = createEmptyGameState();
    expect(getTotalCoresOnCardById(state, "missing")).toBe(0);
  });
});

// ── getPlayerLifeCoreCount / Reserve / Trash ───────────

describe("getPlayerLifeCoreCount", () => {
  it("counts normal cores only", () => {
    const player: PlayerState = {
      id: ALICE,
      deckCount: 40,
      handCount: 4,
      lifeNormalCoreCount: 5,
      reserveNormalCoreCount: 4,
      trashNormalCoreCount: 0,
      voidNormalCoreCount: 0,
      soulCoreLocation: null,
      reserveSoulCoreCount: 0,
      trashSoulCoreCount: 0,
      lifeSoulCoreCount: 0,
    };
    expect(getPlayerLifeCoreCount(player)).toBe(5);
  });

  it("includes soul core on life", () => {
    const player: PlayerState = {
      id: ALICE,
      deckCount: 40,
      handCount: 4,
      lifeNormalCoreCount: 4,
      reserveNormalCoreCount: 4,
      trashNormalCoreCount: 0,
      voidNormalCoreCount: 0,
      soulCoreLocation: { kind: "life" },
      reserveSoulCoreCount: 0,
      trashSoulCoreCount: 0,
      lifeSoulCoreCount: 1,
    };
    expect(getPlayerLifeCoreCount(player)).toBe(5);
  });

  it("does not count soul core on reserve", () => {
    const player: PlayerState = {
      id: ALICE,
      deckCount: 40,
      handCount: 4,
      lifeNormalCoreCount: 5,
      reserveNormalCoreCount: 3,
      trashNormalCoreCount: 0,
      voidNormalCoreCount: 0,
      soulCoreLocation: { kind: "reserve" },
      reserveSoulCoreCount: 1,
      trashSoulCoreCount: 0,
      lifeSoulCoreCount: 0,
    };
    expect(getPlayerLifeCoreCount(player)).toBe(5);
  });
});

describe("getPlayerReserveCoreCount", () => {
  it("includes soul core on reserve", () => {
    const player: PlayerState = {
      id: ALICE,
      deckCount: 40,
      handCount: 4,
      lifeNormalCoreCount: 5,
      reserveNormalCoreCount: 3,
      trashNormalCoreCount: 0,
      voidNormalCoreCount: 0,
      soulCoreLocation: { kind: "reserve" },
      reserveSoulCoreCount: 1,
      trashSoulCoreCount: 0,
      lifeSoulCoreCount: 0,
    };
    expect(getPlayerReserveCoreCount(player)).toBe(4);
  });
});

describe("getPlayerTrashCoreCount", () => {
  it("includes soul core on trash", () => {
    const player: PlayerState = {
      id: ALICE,
      deckCount: 40,
      handCount: 4,
      lifeNormalCoreCount: 5,
      reserveNormalCoreCount: 4,
      trashNormalCoreCount: 2,
      voidNormalCoreCount: 0,
      soulCoreLocation: { kind: "trash" },
      reserveSoulCoreCount: 0,
      trashSoulCoreCount: 1,
      lifeSoulCoreCount: 0,
    };
    expect(getPlayerTrashCoreCount(player)).toBe(3);
  });
});

// ── moveNormalCores ────────────────────────────────────

describe("moveNormalCores", () => {
  it("moves cores from reserve to card", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "s1" },
      2
    );

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(2);
    expect(getCard(next, "s1").normalCoreCount).toBe(3);
  });

  it("moves cores from card to trash", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 5)],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "s1" },
      { kind: "trash", playerId: ALICE },
      3
    );

    expect(getCard(next, "s1").normalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(3);
  });

  it("moves cores between two cards", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 5), fieldCard("s2", ALICE, 1)],
    });

    const next = moveNormalCores(
      state,
      { kind: "card", instanceId: "s1" },
      { kind: "card", instanceId: "s2" },
      2
    );

    expect(getCard(next, "s1").normalCoreCount).toBe(3);
    expect(getCard(next, "s2").normalCoreCount).toBe(3);
  });

  it("is no-op when from and to are the same", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "reserve", playerId: ALICE },
      2
    );

    expect(next).toBe(state); // referential equality — no change
  });

  it("throws when not enough cores at source", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ reserveNormalCoreCount: 1 }],
    });

    expect(() =>
      moveNormalCores(
        state,
        { kind: "reserve", playerId: ALICE },
        { kind: "trash", playerId: ALICE },
        5
      )
    ).toThrow("Not enough normal cores");
  });

  it("throws on non-positive amount", () => {
    const state = createEmptyGameState();
    expect(() =>
      moveNormalCores(
        state,
        { kind: "reserve", playerId: ALICE },
        { kind: "trash", playerId: ALICE },
        0
      )
    ).toThrow("positive integer");
  });

  it("moves cores between players", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 3 },
      ],
    });

    const next = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "reserve", playerId: BOB },
      2
    );

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
    expect(getPlayer(next, BOB).reserveNormalCoreCount).toBe(5);
  });
});

// ── moveSoulCore ───────────────────────────────────────

describe("moveSoulCore", () => {
  it("moves soul core from reserve to card", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "s1" }
    );

    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s1",
    });
    expect(isSoulCoreOn(next, "s1")).toBe(true);
  });

  it("moves soul core from card to reserve", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "card", instanceId: "s1" },
      { kind: "reserve", playerId: ALICE }
    );

    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(isSoulCoreOn(next, "s1")).toBe(false);
  });

  it("moves soul core between cards", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1), fieldCard("s2", ALICE, 1)],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "card", instanceId: "s1" },
      { kind: "card", instanceId: "s2" }
    );

    expect(isSoulCoreOn(next, "s1")).toBe(false);
    expect(isSoulCoreOn(next, "s2")).toBe(true);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s2",
    });
  });

  it("is no-op when soul core source and destination are the same", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        { soulCoreLocation: { kind: "reserve" }, reserveSoulCoreCount: 1 },
      ],
    });

    const next = moveSoulCore(
      state,
      ALICE,
      { kind: "reserve", playerId: ALICE },
      { kind: "reserve", playerId: ALICE },
      2
    );

    expect(next).toBe(state);
  });

  it("throws when not enough soul cores at source", () => {
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard("s1", ALICE, 1, {
          soulCoreCount: 1,
        }),
      ],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
      ],
    });

    expect(() =>
      moveSoulCore(
        state,
        ALICE,
        { kind: "card", instanceId: "s1" },
        { kind: "reserve", playerId: ALICE },
        2
      )
    ).toThrow("Not enough soul cores");
  });

  it("throws when soul core is not at expected source", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }],
    });

    expect(() =>
      moveSoulCore(
        state,
        ALICE,
        { kind: "trash", playerId: ALICE },
        { kind: "reserve", playerId: ALICE }
      )
    ).toThrow("not at the expected source");
  });
});

// ── refreshTrashCoresToReserve ─────────────────────────

describe("refreshTrashCoresToReserve", () => {
  it("moves all trash cores to reserve", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ trashNormalCoreCount: 3, reserveNormalCoreCount: 2 }],
    });

    const next = refreshTrashCoresToReserve(state, ALICE);

    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(5);
  });

  it("moves soul core from trash to reserve", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        {
          trashNormalCoreCount: 1,
          reserveNormalCoreCount: 2,
          soulCoreLocation: { kind: "trash" },
        },
      ],
    });

    const next = refreshTrashCoresToReserve(state, ALICE);

    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("is no-op when trash is empty", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ trashNormalCoreCount: 0, reserveNormalCoreCount: 4 }],
    });

    const next = refreshTrashCoresToReserve(state, ALICE);

    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(4);
  });

  it("does not affect other player", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        { trashNormalCoreCount: 3 },
        { trashNormalCoreCount: 5 },
      ],
    });

    const next = refreshTrashCoresToReserve(state, ALICE);

    expect(getPlayer(next, BOB).trashNormalCoreCount).toBe(5);
  });
});

// ── refreshExhaustStates ──────────────────────────────

describe("refreshExhaustStates", () => {
  it("recovers exhausted → ready", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1, { exhaustState: "exhausted" })],
    });

    const next = refreshExhaustStates(state, ALICE);

    expect(getCard(next, "s1").exhaustState).toBe("recovered");
  });

  it("recovers heavily_exhausted → exhausted (one step)", () => {
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard("s1", ALICE, 1, { exhaustState: "heavily_exhausted" }),
      ],
    });

    const next = refreshExhaustStates(state, ALICE);

    expect(getCard(next, "s1").exhaustState).toBe("exhausted");
  });

  it("does not touch ready cards", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1, { exhaustState: "recovered" })],
    });

    const next = refreshExhaustStates(state, ALICE);

    expect(getCard(next, "s1").exhaustState).toBe("recovered");
  });

  it("only affects specified player's cards", () => {
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard("s1", ALICE, 1, { exhaustState: "exhausted" }),
        fieldCard("s2", BOB, 1, { exhaustState: "exhausted" }),
      ],
    });

    const next = refreshExhaustStates(state, ALICE);

    expect(getCard(next, "s1").exhaustState).toBe("recovered");
    expect(getCard(next, "s2").exhaustState).toBe("exhausted");
  });

  it("only affects field cards", () => {
    const card = createCardInstance(dummyDef(), {
      instanceId: "h1",
      ownerPlayerId: ALICE,
      zone: "hand",
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({ cardInstances: [card] });

    const next = refreshExhaustStates(state, ALICE);

    expect(getCard(next, "h1").exhaustState).toBe("exhausted");
  });
});

// ── resolveLifeDamage ──────────────────────────────────

describe("resolveLifeDamage", () => {
  it("moves 1 life core to reserve", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 5, reserveNormalCoreCount: 4 }],
    });

    const next = resolveLifeDamage(state, ALICE, 1);

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(4);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(5);
  });

  it("moves multiple life cores to reserve", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 }],
    });

    const next = resolveLifeDamage(state, ALICE, 3);

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(2);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
  });

  it("prefers normal cores by default (soul core stays on life)", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        {
          lifeNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "life" },
        },
      ],
    });

    const next = resolveLifeDamage(state, ALICE, 2);

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({ kind: "life" });
  });

  it("can choose soul core when specified", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        {
          lifeNormalCoreCount: 3,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "life" },
        },
      ],
    });

    const next = resolveLifeDamage(state, ALICE, 1, ["soul"]);

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(3);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("throws when not enough life cores (no context = low-level primitive)", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 2 }],
    });

    expect(() => resolveLifeDamage(state, ALICE, 5)).toThrow(
      "Not enough life cores"
    );
  });

  it("clamps damage to remaining life when context is present (life→0, no throw)", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 1, reserveNormalCoreCount: 0 }],
    });

    // バトルで 2 ダメージだがライフは 1 → ライフ 0 まで頭打ち（敗北は後段で処理）
    const next = resolveLifeDamage(state, ALICE, 2, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
  });

  it("returns state unchanged when life is already 0 and context is present", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 }],
    });

    const next = resolveLifeDamage(state, ALICE, 2, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
  });
});

// ── resolveCardLeavesFieldCores ────────────────────────

describe("resolveCardLeavesFieldCores", () => {
  it("moves normal cores to controller's reserve", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });

    const next = resolveCardLeavesFieldCores(state, "s1");

    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(5);
  });

  it("moves soul core to controller's reserve", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          soulCoreLocation: { kind: "card", instanceId: "s1" },
        },
      ],
    });

    const next = resolveCardLeavesFieldCores(state, "s1");

    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(isSoulCoreOn(next, "s1")).toBe(false);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(3);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("moves card soul cores tracked by another player's primary pointer back to that owner", () => {
    const state = createEmptyGameState({
      cardInstances: [
        fieldCard("s1", ALICE, 1, {
          controllerPlayerId: ALICE,
          soulCoreCount: 2,
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 },
        {
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "s1" },
        },
      ],
    });

    const next = resolveCardLeavesFieldCores(state, "s1");

    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(getCard(next, "s1").soulCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).reserveSoulCoreCount).toBe(1);
    expect(getPlayer(next, BOB).reserveSoulCoreCount).toBe(1);
    expect(getPlayer(next, BOB).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("uses override destination for normal cores", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 3)],
      playerOverrides: [{ trashNormalCoreCount: 0, reserveNormalCoreCount: 0 }],
    });

    const next = resolveCardLeavesFieldCores(state, "s1", {
      normalCoreDestination: { kind: "trash", playerId: ALICE },
      soulCoreDestination: { kind: "trash", playerId: ALICE },
    });

    expect(getCard(next, "s1").normalCoreCount).toBe(0);
    expect(getPlayer(next, ALICE).trashNormalCoreCount).toBe(3);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(0);
  });

  it("is no-op when card has no cores", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 0)],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });

    const next = resolveCardLeavesFieldCores(state, "s1");

    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(4);
  });
});

// ── getAvailableLifeCoreMoveChoices ────────────────────

describe("getAvailableLifeCoreMoveChoices", () => {
  it("returns normal choice when life has normal cores", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ lifeNormalCoreCount: 3 }],
    });

    const choices = getAvailableLifeCoreMoveChoices({
      state,
      playerId: ALICE,
      destination: { kind: "card", instanceId: "s1" },
    });

    expect(choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ coreKind: "normal" })])
    );
  });

  it("returns both normal and soul choices when soul core is on life", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        { lifeNormalCoreCount: 3, soulCoreLocation: { kind: "life" } },
      ],
    });

    const choices = getAvailableLifeCoreMoveChoices({
      state,
      playerId: ALICE,
      destination: { kind: "card", instanceId: "s1" },
    });

    expect(choices).toHaveLength(2);
    expect(choices.map((c) => c.coreKind).sort()).toEqual(["normal", "soul"]);
  });

  it("returns empty when life has no cores", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ lifeNormalCoreCount: 0 }],
    });

    const choices = getAvailableLifeCoreMoveChoices({
      state,
      playerId: ALICE,
      destination: { kind: "reserve", playerId: ALICE },
    });

    expect(choices).toHaveLength(0);
  });

  it("excludes soul core for normal_only effect kind", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        { lifeNormalCoreCount: 3, soulCoreLocation: { kind: "life" } },
      ],
    });

    const choices = getAvailableLifeCoreMoveChoices({
      state,
      playerId: ALICE,
      destination: { kind: "reserve", playerId: ALICE },
      effectKind: "normal_only",
    });

    expect(choices).toHaveLength(1);
    expect(choices[0]!.coreKind).toBe("normal");
  });
});

// ── moveLifeCoreByEffect ──────────────────────────────

describe("moveLifeCoreByEffect", () => {
  it("moves normal core from life to card", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ lifeNormalCoreCount: 5 }],
    });

    const next = moveLifeCoreByEffect({
      state,
      playerId: ALICE,
      destination: { kind: "card", instanceId: "s1" },
      chosenCoreKind: "normal",
    });

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(4);
    expect(getCard(next, "s1").normalCoreCount).toBe(2);
  });

  it("moves soul core from life to card", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [
        { lifeNormalCoreCount: 3, soulCoreLocation: { kind: "life" } },
      ],
    });

    const next = moveLifeCoreByEffect({
      state,
      playerId: ALICE,
      destination: { kind: "card", instanceId: "s1" },
      chosenCoreKind: "soul",
    });

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(3);
    expect(isSoulCoreOn(next, "s1")).toBe(true);
    expect(getPlayer(next, ALICE).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "s1",
    });
  });

  it("auto-selects when only one choice", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ lifeNormalCoreCount: 3 }],
    });

    // No soul core on life, only normal available → auto-select
    const next = moveLifeCoreByEffect({
      state,
      playerId: ALICE,
      destination: { kind: "card", instanceId: "s1" },
    });

    expect(getPlayer(next, ALICE).lifeNormalCoreCount).toBe(2);
    expect(getCard(next, "s1").normalCoreCount).toBe(2);
  });

  it("throws when no life core available", () => {
    const state = createEmptyGameState({
      cardInstances: [fieldCard("s1", ALICE, 1)],
      playerOverrides: [{ lifeNormalCoreCount: 0 }],
    });

    expect(() =>
      moveLifeCoreByEffect({
        state,
        playerId: ALICE,
        destination: { kind: "card", instanceId: "s1" },
      })
    ).toThrow("No life core can move");
  });
});

// reconcileSoulCoreFlags は P3-66 で SSOT 化に伴い削除済み
