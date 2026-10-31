import { expect, it } from "vitest";
import { getLegalActions, type PreGameState } from "@orica/rules-core";
import { buildPregameOrderScenario } from "../src/scenario-pregame-order";
import {
  advanceSimpleAi,
  createSimpleAiProgress,
} from "../src/utils/simple-ai";
import { buildEngine } from "./selfplay-driver";

const engine = buildEngine();
const context = {
  getCardDefinitionById: engine.getCardDefinitionById,
  ...engine.lookups,
};
const phases: PreGameState["phase"][] = [
  "waiting_contract",
  "contract_confirm",
  "waiting_janken",
  "janken_resolved",
  "waiting_order_pick",
  "order_decided",
  "waiting_mulligan_first",
  "waiting_mulligan_second",
  "pregame_complete",
];

it.each(phases)(
  "%s 中はCPUが行動やステップ送りをせず開始状態を保持する",
  (phase) => {
    const state = buildPregameOrderScenario(engine.cards);
    state.activePlayerId = "bob";
    state.playerOrder = ["bob", "alice"];
    state.preGame = { ...state.preGame!, phase, firstPlayerId: "bob" };
    const before = structuredClone(state);
    const progress = createSimpleAiProgress();
    const result = advanceSimpleAi({
      state,
      actions: [],
      playerId: "bob",
      canAdvance: true,
      engine: context,
      progress,
    });
    expect(result).toBeNull();
    expect(state).toEqual(before);
    expect(progress).toEqual(createSimpleAiProgress());
  }
);

it("開始完了後はパチュリーの1コスト召喚をCPUが実行できる", () => {
  const state = buildPregameOrderScenario(engine.cards);
  state.activePlayerId = "bob";
  state.playerOrder = ["bob", "alice"];
  state.preGame = null;
  const summon = getLegalActions({
    ...context,
    state,
    actingPlayerId: "bob",
  }).find(
    (action) => action.kind === "summon" && action.sourceCardNo === "BSTH01-M01"
  );
  expect(summon).toBeDefined();
  const result = advanceSimpleAi({
    state,
    actions: [summon!],
    playerId: "bob",
    canAdvance: true,
    engine: context,
    progress: createSimpleAiProgress(),
  });
  expect(result?.state.window).toBe("stack");
  expect(
    result?.state.cardInstances.find(
      (card) => card.instanceId === "pregame-bob-0"
    )?.zone
  ).toBe("in_use");
  expect(
    result?.state.players.find((player) => player.id === "bob")
      ?.reserveNormalCoreCount
  ).toBe(3);
});
