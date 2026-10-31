import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  executeAdvent,
  matchesAdventCondition,
  hasSoulCoreAvailable,
  getAdventTargets,
  getContractAdventTargets,
  getFContractAdventTargets,
} from "../src/mechanics/advent-system";
import type {
  AdventCondition,
  AdventData,
  CardDefinition,
  CardInstance,
  GameState,
  PlayerState,
} from "../src/model";
import { adventSourceIdsOf } from "../src/model";
import { flushPendingLeaves } from "../src/state-based-actions";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-SPIRIT",
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A" as const,
    ...overrides,
  } as CardDefinition;
}

function adventDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return spiritDef({
    cardNo: "TEST-ADVENT",
    name: "Advent Spirit",
    cost: 6,
    keywordTags: ["advent"],
    adventData: {
      adventCondition: {
        colors: ["red"],
        minCost: 3,
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    ...overrides,
  });
}

function ultimateDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return spiritDef({
    cardNo: "TEST-ULTIMATE",
    name: "Test Ultimate",
    printedCategory: "ultimate",
    ...overrides,
  });
}

function nexusDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-NEXUS",
    name: "Test Nexus",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A" as const,
    ...overrides,
  } as CardDefinition;
}

const allDefs = new Map<string, CardDefinition>();
allDefs.set("TEST-SPIRIT", spiritDef());
allDefs.set("TEST-ADVENT", adventDef());
allDefs.set("TEST-ULTIMATE", ultimateDef());
allDefs.set("TEST-NEXUS", nexusDef());
allDefs.set(
  "TEST-BRAVE",
  spiritDef({
    cardNo: "TEST-BRAVE",
    name: "Test Brave",
    printedCategory: "brave",
    colors: ["red"],
    cost: 3,
    braveCondition: { categories: ["spirit"] },
  })
);
allDefs.set(
  "TEST-ADVENT-ULT",
  adventDef({
    cardNo: "TEST-ADVENT-ULT",
    name: "Advent Ultimate",
    printedCategory: "ultimate",
    adventData: {
      adventCondition: { minCost: 3, targetCategory: ["ultimate"] },
      adventTiming: "both_attack_step",
      soulCoreDest: "removed_from_game",
    },
  })
);

function getDef(id: string): CardDefinition | undefined {
  return allDefs.get(id);
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function makeFieldCard(
  instanceId: string,
  defId: string,
  owner = ALICE,
  cores = 3
): CardInstance {
  const def = getDef(defId)!;
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
}

function makeHandCard(
  instanceId: string,
  defId: string,
  owner = ALICE
): CardInstance {
  const def = getDef(defId)!;
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

// ── C-1: 煌臨条件判定 ──────────────────────────────────

describe("C-1: 煌臨条件判定 (matchesAdventCondition)", () => {
  const condition: AdventCondition = {
    colors: ["red"],
    minCost: 3,
    targetCategory: ["spirit"],
  };

  it("should match spirit with correct color and cost", () => {
    const card = makeFieldCard("s1", "TEST-SPIRIT");
    const def = getDef("TEST-SPIRIT")!;
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(matchesAdventCondition(card, def, condition, getDef, state)).toBe(
      true
    );
  });

  it("should reject wrong color", () => {
    const blueDef = spiritDef({ cardNo: "BLUE", colors: ["blue"], cost: 4 });
    allDefs.set("BLUE", blueDef);
    const card = makeFieldCard("s1", "BLUE");
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(
      matchesAdventCondition(card, blueDef, condition, getDef, state)
    ).toBe(false);
  });

  it("should reject too low cost", () => {
    const lowDef = spiritDef({ cardNo: "LOW", cost: 2 });
    allDefs.set("LOW", lowDef);
    const card = makeFieldCard("s1", "LOW");
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(matchesAdventCondition(card, lowDef, condition, getDef, state)).toBe(
      false
    );
  });

  it("should reject wrong category (nexus vs spirit)", () => {
    const card = makeFieldCard("n1", "TEST-NEXUS");
    const def = getDef("TEST-NEXUS")!;
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(matchesAdventCondition(card, def, condition, getDef, state)).toBe(
      false
    );
  });

  it("should match with tribe condition", () => {
    const tribeDef = spiritDef({
      cardNo: "TRIBE",
      tribe: "武装・機獣",
      colors: ["red"],
      cost: 4,
    });
    allDefs.set("TRIBE", tribeDef);
    const card = makeFieldCard("s1", "TRIBE");
    const state = createEmptyGameState({ cardInstances: [card] });
    const tribeCondition: AdventCondition = {
      tribes: ["武装"],
      targetCategory: ["spirit"],
    };
    expect(
      matchesAdventCondition(card, tribeDef, tribeCondition, getDef, state)
    ).toBe(true);
  });
});

// ── C-1: ソウルコア確認 ──────────────────────────────────

describe("C-1: ソウルコア確認 (hasSoulCoreAvailable)", () => {
  it("should return true when soul core is in reserve", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
    });
    expect(hasSoulCoreAvailable(state, ALICE)).toBe(true);
  });

  it("should return true when soul core is on a card", () => {
    const state = createEmptyGameState({
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
        {},
      ],
    });
    expect(hasSoulCoreAvailable(state, ALICE)).toBe(true);
  });

  it("should return true when soul core is in life", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "life" } }, {}],
    });
    expect(hasSoulCoreAvailable(state, ALICE)).toBe(true);
  });

  it("should return false when soul core is in trash", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: { kind: "trash" } }, {}],
    });
    expect(hasSoulCoreAvailable(state, ALICE)).toBe(false);
  });

  it("should return false when no soul core", () => {
    const state = createEmptyGameState({
      playerOverrides: [{ soulCoreLocation: null }, {}],
    });
    expect(hasSoulCoreAvailable(state, ALICE)).toBe(false);
  });
});

// ── C-1: 煌臨ターゲット取得 ────────────────────────────────

describe("C-1: 煌臨ターゲット取得 (getAdventTargets)", () => {
  const advData: AdventData = {
    adventCondition: {
      colors: ["red"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "both_attack_step",
    soulCoreDest: "trash",
  };

  it("should find valid targets on field", () => {
    const s1 = makeFieldCard("s1", "TEST-SPIRIT");
    const state = createEmptyGameState({ cardInstances: [s1] });
    const targets = getAdventTargets(state, ALICE, advData, getDef);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.instanceId).toBe("s1");
  });

  it("should exclude soul-core-only spirits", () => {
    const s1 = makeFieldCard("s1", "TEST-SPIRIT", ALICE, 0);
    const state = createEmptyGameState({
      cardInstances: [s1],
      playerOverrides: [
        { soulCoreLocation: { kind: "card", instanceId: "s1" } },
        {},
      ],
    });
    const targets = getAdventTargets(state, ALICE, advData, getDef);
    expect(targets).toHaveLength(0);
  });

  it("should exclude soul state cards", () => {
    const s1 = makeFieldCard("s1", "TEST-SPIRIT");
    const state = createEmptyGameState({
      cardInstances: [s1],
      playerOverrides: [{ soulStateInstanceIds: ["s1"] }, {}],
    });
    const targets = getAdventTargets(state, ALICE, advData, getDef);
    expect(targets).toHaveLength(0);
  });

  it("should exclude opponent cards", () => {
    const s1 = makeFieldCard("s1", "TEST-SPIRIT", BOB);
    const state = createEmptyGameState({ cardInstances: [s1] });
    const targets = getAdventTargets(state, ALICE, advData, getDef);
    expect(targets).toHaveLength(0);
  });
});

// ── C-1: 煌臨実行 ──────────────────────────────────────

describe("C-1: 煌臨実行 (executeAdvent)", () => {
  function setupAdventState(
    opts: {
      targetCores?: number;
      soulCoreLoc?: PlayerState["soulCoreLocation"] | "none";
    } = {}
  ): GameState {
    const target = makeFieldCard(
      "target-1",
      "TEST-SPIRIT",
      ALICE,
      opts.targetCores ?? 3
    );
    const adventCard = makeHandCard("advent-1", "TEST-ADVENT");
    const soulCoreLocation =
      opts.soulCoreLoc === "none"
        ? null
        : (opts.soulCoreLoc ?? ({ kind: "reserve" } as const));
    return createEmptyGameState({
      cardInstances: [target, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation,
        },
        {},
      ],
    });
  }

  it("should move advent card from hand to field", () => {
    const state = setupAdventState();
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const advCard = getCard(result, "advent-1");
    expect(advCard.zone).toBe("field");
  });

  it("should inherit cores from target", () => {
    const state = setupAdventState({ targetCores: 5 });
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const advCard = getCard(result, "advent-1");
    expect(advCard.normalCoreCount).toBe(5);
  });

  it("should consume soul core to trash", () => {
    const state = setupAdventState({ soulCoreLoc: { kind: "reserve" } });
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const player = getPlayer(result, ALICE);
    expect(player.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("should consume soul core to removed_from_game for ultimate", () => {
    const ultTarget = makeFieldCard("ult-1", "TEST-ULTIMATE", ALICE, 3);
    const adventUlt = makeHandCard("adv-ult-1", "TEST-ADVENT-ULT");
    const state = createEmptyGameState({
      cardInstances: [ultTarget, adventUlt],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "adv-ult-1",
        targetInstanceId: "ult-1",
        adventData: getDef("TEST-ADVENT-ULT")!.adventData!,
      },
      getDef
    );

    const player = getPlayer(result, ALICE);
    expect(player.soulCoreLocation).toEqual({ kind: "removed_from_game" });
    expect(hasSoulCoreAvailable(result, ALICE)).toBe(false);
  });

  it("should decrement hand count", () => {
    const state = setupAdventState();
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    expect(getPlayer(result, ALICE).handCount).toBe(0);
  });

  it("should set adventSourceCardIds on advent card", () => {
    const state = setupAdventState();
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const advCard = getCard(result, "advent-1");
    expect(adventSourceIdsOf(advCard)).toEqual(["target-1"]);
  });

  it("should clear target card state (becomes advent source)", () => {
    const state = setupAdventState();
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const targetCard = getCard(result, "target-1");
    expect(targetCard.normalCoreCount).toBe(0);
    expect(targetCard.zoneRoleName).toBe("advent-source");
  });

  it("should fail when no soul core available", () => {
    const state = setupAdventState({ soulCoreLoc: "none" });
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    // Should not change state
    expect(getCard(result, "advent-1").zone).toBe("hand");
  });

  it("should fail when target only has soul core (would vanish)", () => {
    const target = makeFieldCard("target-1", "TEST-SPIRIT", ALICE, 0);
    const adventCard = makeHandCard("advent-1", "TEST-ADVENT");
    const state = createEmptyGameState({
      cardInstances: [target, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "card", instanceId: "target-1" },
        },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    expect(getCard(result, "advent-1").zone).toBe("hand");
  });

  it("should inherit exhausted state from target", () => {
    const target = makeFieldCard("target-1", "TEST-SPIRIT");
    target.exhaustState = "exhausted";
    const adventCard = makeHandCard("advent-1", "TEST-ADVENT");
    const state = createEmptyGameState({
      cardInstances: [target, adventCard],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    expect(getCard(result, "advent-1").exhaustState).toBe("exhausted");
  });

  it("should log advent execution", () => {
    const state = setupAdventState();
    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "target-1",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    expect(
      result.log.some((l) => l.startsWith("advent:advent-1:on:target-1"))
    ).toBe(true);
  });
});

// ── C-3: 多重煌臨 ──────────────────────────────────────

describe("C-3: 多重煌臨", () => {
  it("should stack advent source cards from existing advent", () => {
    // 既に煌臨中のカードの上にさらに煌臨
    const baseCard = makeFieldCard("base-1", "TEST-SPIRIT");
    const firstAdvent = makeFieldCard("first-advent", "TEST-ADVENT", ALICE, 3);
    firstAdvent.underCards = [
      { cardInstanceId: "base-1", role: "advent_source" },
    ];

    const secondAdventCard = makeHandCard("second-advent", "TEST-ADVENT");
    const state = createEmptyGameState({
      cardInstances: [baseCard, firstAdvent, secondAdventCard],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "second-advent",
        targetInstanceId: "first-advent",
        adventData: adventDef().adventData!,
      },
      getDef
    );

    const advCard = getCard(result, "second-advent");
    // スタック: first-advent + base-1 (元のスタック)
    expect(adventSourceIdsOf(advCard)).toEqual(["first-advent", "base-1"]);
  });
});

// ── C-3: フィールド離脱時の煌臨元一括移動 ──────────────────

describe("C-3: フィールド離脱時の煌臨元一括移動", () => {
  it("should move advent source cards to trash when host is destroyed", () => {
    const baseCard = makeFieldCard("base-1", "TEST-SPIRIT");
    baseCard.zoneRoleName = "advent-source";
    const adventCard = makeFieldCard("advent-1", "TEST-ADVENT", ALICE, 3);
    adventCard.underCards = [
      { cardInstanceId: "base-1", role: "advent_source" },
    ];
    adventCard.pendingLeaveKind = "destroy";
    adventCard.pendingLeaveCause = "effect_resolution";
    adventCard.pendingLeaveChainId = "chain-1";

    const state = createEmptyGameState({
      cardInstances: [baseCard, adventCard],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "advent-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const result = flushPendingLeaves(state);

    expect(getCard(result, "advent-1").zone).toBe("trash");
    expect(getCard(result, "base-1").zone).toBe("trash");
    expect(adventSourceIdsOf(getCard(result, "base-1"))).toEqual([]);
  });

  it("should clear adventSourceCardIds on destroyed host", () => {
    const baseCard = makeFieldCard("base-1", "TEST-SPIRIT");
    baseCard.zoneRoleName = "advent-source";
    const adventCard = makeFieldCard("advent-1", "TEST-ADVENT", ALICE, 3);
    adventCard.underCards = [
      { cardInstanceId: "base-1", role: "advent_source" },
    ];
    adventCard.pendingLeaveKind = "destroy";
    adventCard.pendingLeaveCause = "battle";
    adventCard.pendingLeaveChainId = "chain-1";

    const state = createEmptyGameState({
      cardInstances: [baseCard, adventCard],
    });
    state.pendingLeaveEntities = [
      {
        instanceId: "advent-1",
        kind: "destroy",
        cause: "battle",
        causePlayerId: BOB,
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const result = flushPendingLeaves(state);
    expect(adventSourceIdsOf(getCard(result, "advent-1"))).toEqual([]);
  });
});

// ── C-4: 契約煌臨 ──────────────────────────────────────

describe("C-4: 契約煌臨 (getContractAdventTargets)", () => {
  const advData: AdventData = {
    adventCondition: {
      colors: ["red"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "both_attack_step",
    soulCoreDest: "trash",
  };

  it("should include soul state contract cards", () => {
    const contractCard = makeFieldCard("contract-1", "TEST-SPIRIT");
    const state = createEmptyGameState({
      cardInstances: [contractCard],
      playerOverrides: [
        {
          soulStateInstanceIds: ["contract-1"],
          contractCardNo: "TEST-SPIRIT",
        },
        {},
      ],
    });

    const targets = getContractAdventTargets(state, ALICE, advData, getDef);
    expect(targets.some((t) => t.instanceId === "contract-1")).toBe(true);
  });

  it("should not include non-contract soul state cards", () => {
    const nonContract = makeFieldCard("non-contract-1", "TEST-SPIRIT");
    const state = createEmptyGameState({
      cardInstances: [nonContract],
      playerOverrides: [
        {
          soulStateInstanceIds: ["non-contract-1"],
          contractCardNo: "OTHER-CARD",
        },
        {},
      ],
    });

    const targets = getContractAdventTargets(state, ALICE, advData, getDef);
    expect(targets).toHaveLength(0);
  });
});

describe("C-4: 契約煌臨実行 (executeAdvent with isContractAdvent)", () => {
  it("should allow advent onto soul state contract card", () => {
    const contractCard = makeFieldCard("contract-1", "TEST-SPIRIT");
    const adventCard = makeHandCard("advent-1", "TEST-ADVENT");
    const state = createEmptyGameState({
      cardInstances: [contractCard, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          soulStateInstanceIds: ["contract-1"],
          contractCardNo: "TEST-SPIRIT",
        },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "contract-1",
        adventData: adventDef().adventData!,
        isContractAdvent: true,
      },
      getDef
    );

    expect(getCard(result, "advent-1").zone).toBe("field");
    // 魂状態が解除される
    expect(getPlayer(result, ALICE).soulStateInstanceIds).not.toContain(
      "contract-1"
    );
  });

  it("should not inherit cores from soul state target", () => {
    const contractCard = makeFieldCard("contract-1", "TEST-SPIRIT", ALICE, 0);
    const adventCard = makeHandCard("advent-1", "TEST-ADVENT");
    const state = createEmptyGameState({
      cardInstances: [contractCard, adventCard],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          soulStateInstanceIds: ["contract-1"],
          contractCardNo: "TEST-SPIRIT",
        },
        {},
      ],
    });

    const result = executeAdvent(
      state,
      ALICE,
      {
        adventCardInstanceId: "advent-1",
        targetInstanceId: "contract-1",
        adventData: adventDef().adventData!,
        isContractAdvent: true,
      },
      getDef
    );

    expect(getCard(result, "advent-1").normalCoreCount).toBe(0);
  });
});

describe("C-4: F契約煌臨 (getFContractAdventTargets)", () => {
  const advData: AdventData = {
    adventCondition: {
      colors: ["red"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "both_attack_step",
    soulCoreDest: "trash",
  };

  it("should include nexus targets", () => {
    const spirit = makeFieldCard("s1", "TEST-SPIRIT");
    const nexus = makeFieldCard("n1", "TEST-NEXUS");
    const state = createEmptyGameState({
      cardInstances: [spirit, nexus],
    });

    const targets = getFContractAdventTargets(state, ALICE, advData, getDef);
    expect(targets.some((t) => t.instanceId === "s1")).toBe(true);
    expect(targets.some((t) => t.instanceId === "n1")).toBe(true);
  });
});
