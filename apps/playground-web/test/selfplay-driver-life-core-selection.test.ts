/**
 * fuzz seed 1558645697 の selfplay 回帰: rules-core はライフの通常/ソウルコアを
 * 選ぶ `resolve_pending_life_core_selection` を公開するが、selfplay-driver が
 * `lifeCorePartitionChoice` を渡さないと pending が残り、ゲームが maxSteps まで
 * 停止する。通常コア優先の決定的入力で、選択を解決し切ることを確認する。
 */
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

const SOURCE_DEF: CardDefinition = {
  cardNo: "SPLIFECHOICE-SOURCE",
  name: "Selfplay Life Core Choice Source",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === SOURCE_DEF.cardNo ? SOURCE_DEF : undefined;

const engine: Engine = {
  cards: [SOURCE_DEF],
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

function lifeCoreChoiceState(): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "life-choice-source",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [source],
    playerOverrides: [
      {
        lifeNormalCoreCount: 1,
        soulCoreLocation: { kind: "life" },
      },
      {},
    ],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    pendingLifeCoreSelection: {
      pendingId: "life-core-selfplay",
      actingPlayerId: ALICE,
      effectSourcePlayerId: ALICE,
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      fromLocation: { kind: "life", player: "self" },
      toLocation: { kind: "reserve", player: "self" },
      normalAvailable: 1,
      soulAvailable: 1,
      totalAmount: 1,
      effectTiming: { kind: "activated", mode: "main" },
    },
  };
}

describe("selfplay-driver: resolve_pending_life_core_selection", () => {
  it("通常/ソウルの真の選択肢へ通常優先の内訳を渡して pending を解決する", () => {
    const state = lifeCoreChoiceState();
    const reserveBefore = state.players.find(
      (player) => player.id === ALICE
    )!.reserveNormalCoreCount;
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();
    if (!action) throw new Error("unreachable");

    const result = applyChosenAction(state, action, engine);

    expect(result.pendingLifeCoreSelection).toBeNull();
    expect(result.players.find((player) => player.id === ALICE)).toMatchObject({
      lifeNormalCoreCount: 0,
      reserveNormalCoreCount: reserveBefore + 1,
      soulCoreLocation: { kind: "life" },
    });
  });
});
