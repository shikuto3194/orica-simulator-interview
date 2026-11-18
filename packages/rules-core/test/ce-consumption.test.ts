import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  getEffectiveBp,
  getEffectiveSymbols,
  getEffectiveTribes,
  getOverriddenProperties,
  isCardUseRestricted,
  isCardManifestRestricted,
} from "../src";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
} from "../src";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(
  cardNo = "TEST-S01",
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    symbolColors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
      { level: 3, requiredCores: 5, bp: 8000 },
    ],
    textLines: [],
    keywordTags: [],
    tribe: "武装",
    ...overrides,
  } as CardDefinition;
}

function magicDef(cardNo = "TEST-M01"): CardDefinition {
  return spiritDef(cardNo, {
    printedCategory: "magic",
    symbolColors: [],
    levelDefs: [],
  });
}

function fieldCard(
  instanceId: string,
  def: CardDefinition,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function handCard(
  instanceId: string,
  def: CardDefinition,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "hand",
    normalCoreCount: 0,
    ...opts,
  });
}

function overridePropertiesCE(
  targetInstanceId: string,
  properties: Record<string, unknown>,
  opts: Partial<ContinuousEffect> = {}
): ContinuousEffect {
  return {
    effectId: `ce-override-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { properties },
    ...opts,
  };
}

function restrictUseCE(
  targetPlayerId: string,
  filter: Record<string, unknown>,
  opts: Partial<ContinuousEffect> = {}
): ContinuousEffect {
  return {
    effectId: `ce-restrict-use-${targetPlayerId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: BOB,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "restrict_use" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    metadata: { filter },
    ...opts,
  };
}

function restrictManifestCE(
  targetPlayerId: string,
  filter: Record<string, unknown>,
  opts: Partial<ContinuousEffect> = {}
): ContinuousEffect {
  return {
    effectId: `ce-restrict-manifest-${targetPlayerId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: BOB,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "restrict_manifest" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    metadata: { filter },
    ...opts,
  };
}

// ── override_properties ──────────────────────────────────

describe("override_properties CE consumption", () => {
  it("returns null when no override CE exists", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(getOverriddenProperties(state, "s1")).toBeNull();
  });

  it("returns overridden BP from CE metadata", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      overridePropertiesCE("s1", { bp: { lv1: 10000, lv2: 15000 } }),
    ];
    const result = getOverriddenProperties(state, "s1");
    expect(result).not.toBeNull();
    expect(result!.bp).toEqual({ lv1: 10000, lv2: 15000 });
  });

  it("returns overridden symbols from CE metadata", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      overridePropertiesCE("s1", { symbols: ["blue", "white"] }),
    ];
    const result = getOverriddenProperties(state, "s1");
    expect(result!.symbols).toEqual(["blue", "white"]);
  });

  it("applies overridden BP to getEffectiveBp", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });

    // base BP at Lv1 (1 core) = 3000
    expect(getEffectiveBp(state, card, def)).toBe(3000);

    // override BP to 10000 at Lv1
    state.activeContinuousEffects = [
      overridePropertiesCE("s1", { bp: { lv1: 10000 } }),
    ];
    expect(getEffectiveBp(state, card, def)).toBe(10000);
  });

  it("applies overridden symbols to getEffectiveSymbols", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });

    // base symbols = ["red"]
    expect(getEffectiveSymbols(state, card, def)).toEqual(["red"]);

    // override symbols to ["blue", "white"]
    state.activeContinuousEffects = [
      overridePropertiesCE("s1", { symbols: ["blue", "white"] }),
    ];
    expect(getEffectiveSymbols(state, card, def)).toEqual(["blue", "white"]);
  });

  it("resolves copy_self for cardName", () => {
    const sourceDef = spiritDef("SRC-001", { name: "Source Spirit" });
    const targetDef = spiritDef("TGT-001", { name: "Target Spirit" });
    const card = fieldCard("t1", targetDef, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    const defMap = new Map<string, CardDefinition>([
      ["SRC-001", sourceDef],
      ["TGT-001", targetDef],
    ]);
    state.activeContinuousEffects = [
      overridePropertiesCE("t1", { cardName: "copy_self" }),
    ];
    const result = getOverriddenProperties(state, "t1", (id) => defMap.get(id));
    expect(result!.cardName).toBe("Source Spirit");
  });

  it("last CE wins for same property", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      overridePropertiesCE("s1", { cost: 5 }, { effectId: "ce-1" }),
      overridePropertiesCE("s1", { cost: 10 }, { effectId: "ce-2" }),
    ];
    const result = getOverriddenProperties(state, "s1");
    expect(result!.cost).toBe(10);
  });

  it("global override_properties targetFilter uses local effective tribes", () => {
    const def = spiritDef("NO-TRIBE", { tribe: "" });
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      overridePropertiesCE(
        "s1",
        { addTribes: ["導魔"] },
        { effectId: "ce-local" }
      ),
      {
        effectId: "ce-global",
        sourceInstanceId: "source-2",
        sourceDefinitionId: "SRC-002",
        actingPlayerId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties" as ContinuousEffectTag,
        targetFilter: {
          player: "self",
          category: ["spirit"],
          tribes: ["導魔"],
        },
        metadata: { properties: { addTribes: ["対象"] } },
      },
    ];
    const getDef = (id: string): CardDefinition | undefined =>
      id === def.cardNo ? def : undefined;
    expect(getEffectiveTribes(state, card, def, getDef)).toEqual([
      "導魔",
      "対象",
    ]);
  });

  it("global override_properties noTribes rejects local effective tribes", () => {
    const def = spiritDef("NO-TRIBE", { tribe: "" });
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      overridePropertiesCE(
        "s1",
        { addTribes: ["導魔"] },
        { effectId: "ce-local" }
      ),
      {
        effectId: "ce-global-no-tribes",
        sourceInstanceId: "source-2",
        sourceDefinitionId: "SRC-002",
        actingPlayerId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties" as ContinuousEffectTag,
        targetFilter: {
          player: "self",
          category: ["spirit"],
          noTribes: true,
        },
        metadata: { properties: { addTribes: ["対象"] } },
      },
    ];
    const getDef = (id: string): CardDefinition | undefined =>
      id === def.cardNo ? def : undefined;
    expect(getEffectiveTribes(state, card, def, getDef)).toEqual(["導魔"]);
  });
});

// ── restrict_use ─────────────────────────────────────────

describe("restrict_use CE consumption", () => {
  it("returns false when no restrict_use CE exists", () => {
    const def = spiritDef();
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("returns true when restrict_use CE matches card category", () => {
    const def = spiritDef();
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictUseCE(ALICE, { category: ["spirit"] }),
    ];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(true);
  });

  it("returns false when restrict_use CE targets different category", () => {
    const def = spiritDef();
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictUseCE(ALICE, { category: ["magic"] }),
    ];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("returns true when restrict_use CE matches card color", () => {
    const def = spiritDef();
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [restrictUseCE(ALICE, { colors: ["red"] })];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(true);
  });

  it("returns false when restrict_use CE targets different player", () => {
    const def = spiritDef();
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    // CE targets BOB, not ALICE
    state.activeContinuousEffects = [
      restrictUseCE(BOB, { category: ["spirit"] }),
    ];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("restricts magic cards", () => {
    const def = magicDef();
    const card = handCard("m1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictUseCE(ALICE, { category: ["magic"] }),
    ];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(true);
  });

  it("matches by cost filter", () => {
    const def = spiritDef("TEST-S01", { cost: 5 });
    const card = handCard("s1", def);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [restrictUseCE(ALICE, { minCost: 4 })];
    expect(isCardUseRestricted(state, ALICE, card, def)).toBe(true);
  });

  it("card-scoped restrict_use matches by owner zone without targeting the player", () => {
    const def = magicDef();
    const bobTrash = createCardInstance(def, {
      instanceId: "bob-trash",
      ownerPlayerId: BOB,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const bobHand = createCardInstance(def, {
      instanceId: "bob-hand",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const aliceTrash = createCardInstance(def, {
      instanceId: "alice-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: BOB,
      zone: "trash",
    });
    const state = createEmptyGameState({
      cardInstances: [bobTrash, bobHand, aliceTrash],
    });
    state.activeContinuousEffects = [
      {
        effectId: "ce-restrict-use-trash-card",
        sourceInstanceId: "source-1",
        sourceDefinitionId: "SRC-001",
        actingPlayerId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "restrict_use" as ContinuousEffectTag,
        targetFilter: { player: "opponent", zone: ["trash"] },
        metadata: { filter: { zone: ["trash"] }, targetScope: "card" },
      },
    ];
    const getDef = (id: string): CardDefinition | undefined =>
      id === def.cardNo ? def : undefined;

    expect(isCardUseRestricted(state, BOB, bobTrash, def, getDef)).toBe(true);
    expect(isCardUseRestricted(state, BOB, bobHand, def, getDef)).toBe(false);
    expect(isCardUseRestricted(state, ALICE, aliceTrash, def, getDef)).toBe(
      false
    );
  });
});

// ── restrict_manifest ────────────────────────────────────

describe("restrict_manifest CE consumption", () => {
  it("returns false when no restrict_manifest CE exists", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(isCardManifestRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("returns true when restrict_manifest CE matches card category", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictManifestCE(ALICE, { category: ["spirit"] }),
    ];
    expect(isCardManifestRestricted(state, ALICE, card, def)).toBe(true);
  });

  it("returns false when restrict_manifest CE targets different category", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictManifestCE(ALICE, { category: ["nexus"] }),
    ];
    expect(isCardManifestRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("returns false when restrict_manifest CE targets different player", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictManifestCE(BOB, { category: ["spirit"] }),
    ];
    expect(isCardManifestRestricted(state, ALICE, card, def)).toBe(false);
  });

  it("matches by color filter", () => {
    const def = spiritDef();
    const card = fieldCard("s1", def, 1);
    const state = createEmptyGameState({ cardInstances: [card] });
    state.activeContinuousEffects = [
      restrictManifestCE(ALICE, { colors: ["red"] }),
    ];
    expect(isCardManifestRestricted(state, ALICE, card, def)).toBe(true);
  });
});
