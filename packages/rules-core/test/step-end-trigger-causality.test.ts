import { describe, expect, it } from "vitest";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";

const base: CardDefinition = {
  cardNo: "STEP-END",
  name: "終了時の原因",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const ending: CardDefinition = {
  ...base,
  effects: [
    {
      timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};
const inner: CardDefinition = {
  ...base,
  cardNo: "STEP-INNER",
  effects: [
    {
      timing: { kind: "game_event", player: "self", event: "count_increase" },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const starting: CardDefinition = {
  ...base,
  cardNo: "STEP-START",
  effects: [
    {
      timing: {
        kind: "phase",
        step: "attack",
        whose: "self",
        subPhase: "start",
      },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const defs = [ending, inner, starting];
const lookups = {
  getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
const actions = (state: GameState, player = state.activePlayerId) =>
  getLegalActions({ state, actingPlayerId: player, ...lookups });

describe("次のステップへの要求と実移動を区別する (02_turn-flow-and-timing)", () => {
  it.each(["alice", "bob"])(
    "%s: 終了時→内側の誘発→残りの終了時→実移動→開始時",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            ...[
              [ending, "end-a"],
              [ending, "end-b"],
              [inner, "inner"],
              [starting, "start"],
            ].map(([def, id]) =>
              createCardInstance(def as CardDefinition, {
                instanceId: id as string,
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              })
            ),
            createCardInstance(base, {
              instanceId: "deck",
              ownerPlayerId: owner,
              zone: "deck",
            }),
          ],
        }),
        activePlayerId: owner,
        step: "main",
        turnNumber: 2,
      };
      const advance = () =>
        advanceStep(
          state,
          lookups.getCardDefinitionById,
          lookups.getRegisteredTriggeredEffectActions,
          lookups.getRegisteredBurstActions
        );
      const apply = (action: LegalAction, skipOptionalEffect = false) => {
        state = applyLegalAction({
          state,
          action,
          ...lookups,
          skipOptionalEffect,
        }).state;
      };
      const replayed = advanceStep(
        JSON.parse(JSON.stringify(state)) as GameState,
        lookups.getCardDefinitionById,
        lookups.getRegisteredTriggeredEffectActions,
        lookups.getRegisteredBurstActions
      );
      state = advance();
      expect(actions(state)).toEqual(actions(replayed));
      const endChainId = state.pendingTriggeredEffects[0]!.chainId;
      expect(state.step).toBe("main");
      expect(state.window).toBe("step_end");
      expect(
        state.pendingTriggeredEffects.every((p) => p.chainId.trim().length > 0)
      ).toBe(true);
      expect(
        state.pendingTriggeredEffects.some((p) => p.step === "attack")
      ).toBe(false);
      const available = actions(state);
      const first =
        available.find(
          (a) => "sourceInstanceId" in a && a.sourceInstanceId === "end-a"
        ) ?? available[0]!;
      apply(first);
      const resolve = actions(state).find(
        (a) => a.kind === "resolve_pending_triggered_effect"
      );
      if (resolve) apply(resolve);
      apply(actions(state, opponent).find((a) => a.kind === "pass_stack")!);
      expect(state.step).toBe("main");
      expect(actions(state)).toEqual([
        expect.objectContaining({ eventKind: "count_increase" }),
      ]);
      expect(() => advance()).toThrow(/blocked/);
      apply(actions(state)[0]!, true);
      expect(state.step).toBe("main");
      expect(state.pendingTriggeredEffects).toHaveLength(1);
      apply(actions(state)[0]!, true);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      state = JSON.parse(JSON.stringify(state)) as GameState;
      state = advance();
      expect(state.step).toBe("attack");
      expect(state.pendingTriggeredEffects).toEqual([
        expect.objectContaining({ step: "attack" }),
      ]);
      expect(state.pendingTriggeredEffects[0]!.chainId.trim()).not.toBe("");
      expect(state.pendingTriggeredEffects[0]!.chainId).not.toBe(endChainId);
    }
  );
});
