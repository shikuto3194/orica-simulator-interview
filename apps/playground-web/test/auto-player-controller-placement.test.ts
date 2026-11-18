import { describe, expect, it, vi } from "vitest";
import {
  getLegalActions,
  initializeGame,
  applyLegalAction,
  type GameState,
} from "@orica/rules-core";
import { SCENARIOS } from "../src/scenarios";
import {
  advanceSimpleAi,
  createSimpleAiProgress,
} from "../src/utils/simple-ai";
import { buildEngine, mulberry32, randomDeck } from "./selfplay-driver";

const engine = buildEngine();
const context = {
  getCardDefinitionById: engine.getCardDefinitionById,
  ...engine.lookups,
};
const legal = (state: GameState, playerId: string) =>
  getLegalActions({ ...context, state, actingPlayerId: playerId });

function play(initial: GameState, limit = 600): GameState {
  let state = initial;
  const progress = Object.fromEntries(
    state.playerOrder.map((id) => [id, createSimpleAiProgress()])
  );
  for (let i = 0; i < limit && !state.gameResult; i++) {
    const allActions = state.playerOrder.map((id) => ({
      id,
      actions: legal(state, id),
    }));
    let next: ReturnType<typeof advanceSimpleAi> = null;
    for (const { id, actions } of allActions) {
      next = advanceSimpleAi({
        state,
        actions,
        playerId: id,
        canAdvance: allActions.every(
          (entry) => entry.id === id || entry.actions.length === 0
        ),
        engine: context,
        progress: progress[id]!,
      });
      if (next) break;
    }
    expect(
      next,
      `turn ${state.turnNumber} ${state.step}/${state.window}: ${allActions.map((entry) => `${entry.id}: ${entry.actions.map((a) => a.kind)}`).join("; ")}`
    ).not.toBeNull();
    state = next!.state;
  }
  expect(
    state.gameResult,
    `turn ${state.turnNumber} ${state.step}/${state.window}`
  ).not.toBeNull();
  return state;
}

describe("簡易AIの進行", () => {
  it("有料召喚の支払い→相手の応答→維持コア配置まで完了する", () => {
    let state = SCENARIOS.summon!.build(engine.cards);
    const progress = createSimpleAiProgress();
    const summon = legal(state, "alice").find(
      (a) => a.kind === "summon" && a.finalCost > 0
    )!;
    expect(summon).toBeDefined();
    const declared = advanceSimpleAi({
      state,
      actions: [summon],
      playerId: "alice",
      canAdvance: false,
      engine: context,
      progress,
    })!;
    expect(declared.inputs?.paymentSources?.length).toBeGreaterThan(0);
    state = declared.state;
    const pass = legal(state, "bob").find((a) => a.kind.startsWith("pass_"))!;
    expect(pass).toBeDefined();
    state = applyLegalAction({ ...context, state, action: pass }).state;
    expect(state.pendingEnterFieldPlacement).not.toBeNull();
    const placement = advanceSimpleAi({
      state,
      actions: legal(state, "alice"),
      playerId: "alice",
      canAdvance: false,
      engine: context,
      progress,
    })!;
    expect(placement.state.pendingEnterFieldPlacement).toBeNull();
    expect(
      placement.state.cardInstances.find(
        (c) =>
          c.instanceId ===
          (summon as { sourceInstanceId: string }).sourceInstanceId
      )?.zone
    ).toBe("field");
  });

  it("手動コントローラーのnullは、合法手の有無にかかわらず待機する", () => {
    const state = SCENARIOS.summon!.build(engine.cards);
    for (const actions of [[], legal(state, "alice")]) {
      expect(
        advanceSimpleAi({
          state,
          actions,
          playerId: "alice",
          canAdvance: true,
          engine: context,
          progress: createSimpleAiProgress(),
          controller: () => null,
        })
      ).toBeNull();
    }
  });

  for (const scenario of [
    "summon",
    "nexus",
    "mid-battle",
    "attack",
    "defense",
    "brave",
    "choice",
    "rumia-lv2-symbol-add",
    "vwal-library-lv2-main",
    "vwal-library-draw-step-inline",
    "p3-30-pay-cost-sources",
    "core-count-select",
    "p3-46-core-shoot",
    "core-shoot-up-to",
    "trash-selection",
    "moved-to-trash-optional-choice",
    "brave-leave-choice",
    "burst-activation",
    "p3-36-mixed-owner-pending",
    "p3-36-same-owner-chain",
    "step-optional-prompt-bssa01-c02",
    "step-choice-prompt-bslh01-r03",
    "bssl01-x01-split-summon-choice",
    "patchouli-trash-distribute",
    "draw-step-cost-choice",
    "hand-gain-cost",
  ]) {
    it(`${scenario}: 選択待ち・反復起動で止まらず終局する`, () => {
      play(SCENARIOS[scenario]!.build(engine.cards));
    });
  }

  for (const seed of [
    ...Array.from({ length: 120 }, (_, i) => i + 1),
    125,
    144,
    188,
    225,
    226,
    249,
  ]) {
    it(`seed ${seed}: ランダムデッキを簡易AI同士で完走する`, async () => {
      // Let Vitest deliver progress between synchronous games.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const rng = mulberry32(seed);
      const random = vi.spyOn(Math, "random").mockImplementation(rng);
      try {
        play(
          initializeGame({
            decks: [
              randomDeck(engine.cards, 40, rng),
              randomDeck(engine.cards, 40, rng),
            ],
            skipPreGame: true,
          }),
          1600
        );
      } finally {
        random.mockRestore();
      }
    });
  }
});
