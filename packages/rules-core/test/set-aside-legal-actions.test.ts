/**
 * 手元 (set_aside) ゾーンからの召喚 / ネクサス配置 / マジック使用が
 * メインステップで legal action として列挙されることを検証する。
 *
 * 背景: アクセル効果発揮後にカードはオープンで手元に置かれる。
 *   - 手元からアクセル再使用は不可（手札からのみ）
 *   - 通常召喚 / ネクサス配置 / マジック通常使用は可
 *   ref: manual/ai-reference/10_rules/08b_accel-change-zero-counter.md
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  placeNexusAsAction,
  playSummonAsAction,
} from "../src";
import type { CardDefinition, GameState, RegisteredMagicAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

function magicDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
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
  };
}

function nexusDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function buildMainStepState(extraInstances: GameState["cardInstances"]): {
  state: GameState;
  defs: Map<string, CardDefinition>;
} {
  const defs = new Map<string, CardDefinition>();
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    step: "main",
    window: "main_step",
    activePlayerId: ALICE,
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, reserveNormalCoreCount: 5 } : p
    ),
    cardInstances: extraInstances,
  };
  return { state, defs };
}

describe("set_aside zone legal actions", () => {
  it("enumerates use_magic for a magic card sitting in set_aside", () => {
    const magic = magicDef("BS-MAGIC-SET-ASIDE-1");
    const { state } = buildMainStepState([
      createCardInstance(magic, {
        instanceId: "magic-set-aside-1",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);
    const magicLookup: (
      cardNo: string
    ) => RegisteredMagicAction[] | undefined = (cardNo) =>
      cardNo === magic.cardNo
        ? [{ timing: "main", reason: "test_main_magic" }]
        : undefined;

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => (id === magic.cardNo ? magic : undefined),
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: magicLookup,
    });

    const useMagic = actions.find(
      (a) =>
        a.kind === "use_magic" && a.sourceInstanceId === "magic-set-aside-1"
    );
    expect(useMagic).toBeDefined();
  });

  it("enumerates summon for a spirit card sitting in set_aside", () => {
    const spirit = spiritDef("BS-SPIRIT-SET-ASIDE-1");
    const { state } = buildMainStepState([
      createCardInstance(spirit, {
        instanceId: "spirit-set-aside-1",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === spirit.cardNo ? spirit : undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: () => undefined,
    });

    const summon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "spirit-set-aside-1"
    );
    expect(summon).toBeDefined();
  });

  it("enumerates place_nexus for a nexus card sitting in set_aside", () => {
    const nexus = nexusDef("BS-NEXUS-SET-ASIDE-1");
    const { state } = buildMainStepState([
      createCardInstance(nexus, {
        instanceId: "nexus-set-aside-1",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => (id === nexus.cardNo ? nexus : undefined),
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: () => undefined,
    });

    const place = actions.find(
      (a) =>
        a.kind === "place_nexus" && a.sourceInstanceId === "nexus-set-aside-1"
    );
    expect(place).toBeDefined();
  });

  it("does NOT enumerate use_accel for an accel card sitting in set_aside", () => {
    // アクセル再使用禁止: 手元のアクセル持ちカードはアクセル使用 legal に列挙されない
    const accelCard: CardDefinition = {
      ...magicDef("BS-ACCEL-SET-ASIDE-1"),
      accelData: {
        timing: "main",
        cost: 2,
        reduction: [],
      },
    };
    const { state } = buildMainStepState([
      createCardInstance(accelCard, {
        instanceId: "accel-set-aside-1",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === accelCard.cardNo ? accelCard : undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: () => undefined,
    });

    const useAccel = actions.find(
      (a) =>
        a.kind === "use_accel" && a.sourceInstanceId === "accel-set-aside-1"
    );
    expect(useAccel).toBeUndefined();
  });

  it("executes summon from set_aside (validation accepts set_aside zone)", () => {
    const spirit = spiritDef("BS-SPIRIT-SET-ASIDE-EXEC");
    const { state } = buildMainStepState([
      createCardInstance(spirit, {
        instanceId: "spirit-set-aside-exec",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);

    const result = playSummonAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "spirit-set-aside-exec",
      paymentSources: [{ kind: "reserve", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: (id) =>
        id === spirit.cardNo ? spirit : undefined,
    });

    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "spirit-set-aside-exec"
    );
    expect(summoned?.zone).toBe("field");
  });

  it("executes place_nexus from set_aside (validation accepts set_aside zone)", () => {
    const nexus = nexusDef("BS-NEXUS-SET-ASIDE-EXEC");
    const { state } = buildMainStepState([
      createCardInstance(nexus, {
        instanceId: "nexus-set-aside-exec",
        ownerPlayerId: ALICE,
        zone: "set_aside",
      }),
    ]);

    const result = placeNexusAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "nexus-set-aside-exec",
      paymentSources: [{ kind: "reserve", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: (id) => (id === nexus.cardNo ? nexus : undefined),
    });

    const placed = result.state.cardInstances.find(
      (c) => c.instanceId === "nexus-set-aside-exec"
    );
    expect(placed?.zone).toBe("field");
  });
});
