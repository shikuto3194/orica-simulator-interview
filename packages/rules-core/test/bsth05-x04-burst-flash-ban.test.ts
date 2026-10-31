/**
 * BSTH05-X04 御社宮神 effects[1]
 *   Lv2-Lv3『このスピリットのアタック時』
 *   系統：「アシハラ」を持つ自分の創界神ネクサスが2つ以上あるとき、
 *   相手はバースト/フラッシュ効果を発揮できない。
 *
 * 表現:
 *   - condition: field_has(category:nexus, tribes:アシハラ, grandwalkerKind:grandwalker,
 *     minCount:2) で創界神ネクサス≧2 を要求。
 *   - step0: restrict_flash(opponent, battle) でフラッシュ抑止。
 *   - step1: negate(opponent_burst, burstSuppressKind:cannot_activate, battle) で
 *     バースト効果発揮抑止（P3-77 Step B/C）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  isFlashRestricted,
  isBurstEffectNullifiedByOpponent,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ojiya = ALL_CARDS.find((c) => c.cardNo === "BSTH05-X04");
if (!ojiya) {
  throw new Error("BSTH05-X04 not found in ALL_CARDS");
}
const OJIYA = ojiya;

const ASHIHARA_NEXUS: CardDefinition = {
  cardNo: "TEST-ASHIHARA-NEXUS",
  name: "テスト創界神ネクサス",
  printedCategory: "nexus",
  colors: ["green"],
  cost: 4,
  reductionSymbols: ["green", "green"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  tribe: "創界神・アシハラ",
  sourceUrls: [],
  sourceConfidence: "C",
  grandwalkerData: { kind: "grandwalker" },
  effects: [],
};

const ASHIHARA_REGULAR_NEXUS: CardDefinition = {
  cardNo: "TEST-ASHIHARA-PLAIN-NEXUS",
  name: "テスト通常ネクサス",
  printedCategory: "nexus",
  colors: ["green"],
  cost: 3,
  reductionSymbols: ["green"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  tribe: "アシハラ",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const lookup = (id: string): CardDefinition | undefined => {
  if (id === OJIYA.cardNo) return OJIYA;
  if (id === ASHIHARA_NEXUS.cardNo) return ASHIHARA_NEXUS;
  if (id === ASHIHARA_REGULAR_NEXUS.cardNo) return ASHIHARA_REGULAR_NEXUS;
  return undefined;
};

function makeScenario(nexusCount: number, useGrandwalker = true): GameState {
  const sourceCard: CardInstance = createCardInstance(OJIYA, {
    instanceId: "ojiya-source",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    cores: 2,
  });
  const nexusDef = useGrandwalker ? ASHIHARA_NEXUS : ASHIHARA_REGULAR_NEXUS;
  const nexuses: CardInstance[] = Array.from({ length: nexusCount }, (_, i) =>
    createCardInstance(nexusDef, {
      instanceId: `ashihara-nexus-${i}`,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    })
  );
  const base = createEmptyGameState({
    playerIds: ["bob", "alice"],
    cardInstances: [sourceCard, ...nexuses],
  });
  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
  };
}

describe("BSTH05-X04 effects[1] アシハラ創界神≧2 で相手バースト/フラッシュ抑止", () => {
  const eff = OJIYA.effects?.[1];
  if (!eff) {
    throw new Error("BSTH05-X04 effects[1] missing");
  }

  it("stub が外れている / textRef [3,4]", () => {
    expect(eff.stub).toBeUndefined();
    expect(eff.textRef).toEqual([3, 4]);
  });

  it("DSL shape: field_has(grandwalker, minCount:2) + restrict_flash + negate(opponent_burst,cannot_activate)", () => {
    expect(eff.timing).toMatchObject({ kind: "card_event", event: "attack" });
    const hasFH = (eff.condition ?? []).some(
      (c) =>
        c.kind === "field_has" &&
        c.player === "self" &&
        Array.isArray(c.category) &&
        c.category.includes("nexus") &&
        Array.isArray(c.tribes) &&
        c.tribes.includes("アシハラ") &&
        c.grandwalkerKind === "grandwalker" &&
        c.minCount === 2
    );
    expect(hasFH).toBe(true);
    expect(eff.steps).toHaveLength(2);
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "restrict_flash",
      player: "opponent",
      duration: { scope: "battle" },
    });
    expect(eff.steps[1]!.action).toMatchObject({
      kind: "negate",
      negateTarget: "opponent_burst",
      burstSuppressKind: "cannot_activate",
      duration: { scope: "battle" },
    });
  });

  it("アシハラ創界神ネクサス2つ → restrict_flash + negate_opponent_burst CE が登録される", () => {
    const state = makeScenario(2);
    const result = executeEffect({
      chainId: "test:bsth05-x04-burst-flash-ban:141",
      state,
      effect: eff,
      sourceInstanceId: "ojiya-source",
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });
    const tags = new Set(
      result.activeContinuousEffects.map((ce) => ce.modifierTag as string)
    );
    expect([...tags].some((t) => t.startsWith("restrict_flash"))).toBe(true);
    // negate(opponent_burst) は modifierTag=negate_opponent_burst、
    // burstSuppressKind="cannot_activate" は metadata に保持される。
    const negateCe = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "negate_opponent_burst"
    );
    expect(negateCe).toBeDefined();
    expect(
      (negateCe?.metadata as { burstSuppressKind?: string } | undefined)
        ?.burstSuppressKind
    ).toBe("cannot_activate");
    // alice (opponent) は flash 制限 + burst 抑制
    expect(isFlashRestricted(result, "alice")).toBe(true);
    expect(
      isBurstEffectNullifiedByOpponent(result, "alice-burst-any", "alice")
    ).toBe(true);
  });

  it("アシハラ創界神ネクサス1つ → condition 不成立で CE 未登録", () => {
    const state = makeScenario(1);
    const result = executeEffect({
      chainId: "test:bsth05-x04-burst-flash-ban:171",
      state,
      effect: eff,
      sourceInstanceId: "ojiya-source",
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });
    expect(isFlashRestricted(result, "alice")).toBe(false);
    expect(
      isBurstEffectNullifiedByOpponent(result, "alice-burst-any", "alice")
    ).toBe(false);
  });

  it("アシハラの通常ネクサス2つ (grandwalker でない) → condition 不成立で CE 未登録", () => {
    const state = makeScenario(2, /* useGrandwalker */ false);
    const result = executeEffect({
      chainId: "test:bsth05-x04-burst-flash-ban:186",
      state,
      effect: eff,
      sourceInstanceId: "ojiya-source",
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });
    expect(isFlashRestricted(result, "alice")).toBe(false);
    expect(
      isBurstEffectNullifiedByOpponent(result, "alice-burst-any", "alice")
    ).toBe(false);
  });
});
