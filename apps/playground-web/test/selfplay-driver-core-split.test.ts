import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { applyChosenAction, type Engine } from "./selfplay-driver";

const ALICE = "alice";
const BOB = "bob";

const SPIRIT_DEF: CardDefinition = {
  cardNo: "SPCSPLIT-TARGET",
  name: "Selfplay Core Split Target",
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

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === SPIRIT_DEF.cardNo ? SPIRIT_DEF : undefined;

const engine: Engine = {
  cards: [SPIRIT_DEF],
  getCardDefinitionById,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

function coreSplitState(): GameState {
  const target = createCardInstance(SPIRIT_DEF, {
    instanceId: "core-split-target",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [target],
    playerOverrides: [{ voidNormalCoreCount: 2 }, {}],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    pendingCoreSplitSelection: {
      pendingId: "core-split-selfplay",
      actingPlayerId: ALICE,
      sourceInstanceId: "core-split-target",
      sourceDefinitionId: SPIRIT_DEF.cardNo,
      fromLocation: { kind: "void", player: "self" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "field", player: "self" }, cap: 1 },
        { location: { kind: "reserve", player: "self" }, cap: 2 },
      ],
      effectTiming: { kind: "phase", step: "main" },
    },
  };
}

describe("selfplay-driver: resolve_pending_core_split", () => {
  it("BSES01-C06 型の field/reserve 分配を cap を守って最後まで解決する", () => {
    const state = coreSplitState();
    const reserveBefore = state.players.find(
      (player) => player.id === ALICE
    )!.reserveNormalCoreCount;
    const split = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    if (!split) throw new Error("unreachable");

    const afterSplit = applyChosenAction(state, split, engine);
    expect(afterSplit.pendingCoreSplitSelection).toBeNull();
    expect(afterSplit.pendingCoreDistribution).toBeNull();
    expect(
      afterSplit.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(reserveBefore + 1);
    expect(
      afterSplit.cardInstances.find(
        (card) => card.instanceId === "core-split-target"
      )?.normalCoreCount
    ).toBe(2);
  });
});
