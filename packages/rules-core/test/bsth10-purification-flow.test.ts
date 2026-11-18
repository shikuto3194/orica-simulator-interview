import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildKanjudenScenario } from "../../../apps/playground-web/src/scenario-kanjuden";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

const options = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
};
const actions = (state: GameState, player = "alice") =>
  getLegalActions({ state, actingPlayerId: player, ...options });
function find(state: GameState, kind: LegalAction["kind"], player = "alice") {
  const action = actions(state, player).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return action!;
}
function begin(mode = "pure-contract", skip = false, initial?: GameState) {
  let state =
    initial ?? buildKanjudenScenario(ALL_CARDS, new URLSearchParams({ mode }));
  state = applyLegalAction({
    state,
    action: find(state, "resolve_pending_triggered_effect"),
    skipOptionalEffect: skip,
    ...options,
  }).state;
  if (!skip)
    state = applyLegalAction({
      state,
      action: find(state, "pass_stack", "bob"),
      ...options,
    }).state;
  return state;
}
const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

describe("BSTH10-M01 純化の宣言から対象・持ち主選択まで", () => {
  it.each(["execute", "decline"] as const)(
    "煌臨元の契約カードも対象の持ち主が選び、ホストは離脱せず裏向きになる: %s",
    (choice) => {
      const initial = buildKanjudenScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "pure-contract" })
      );
      card(initial, "kanjuden-target").underCards = [
        { cardInstanceId: "kanjuden-contract", role: "advent_source" },
      ];
      card(initial, "kanjuden-contract").attachedToInstanceId =
        "kanjuden-target";
      card(initial, "kanjuden-contract").normalCoreCount = 0;
      let state = begin("pure-contract", false, initial);
      state = applyLegalAction({
        state,
        action: find(state, "resolve_pending_effect_target"),
        targetInstanceIds: ["kanjuden-target"],
        ...options,
      }).state;
      expect(state.pendingStepOptionalChoice?.prompt?.question).toBe(
        "「緋村 剣心」を魂状態にしますか？"
      );
      const ownerChoice = actions(state, "bob").find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === choice
      )!;
      state = applyLegalAction({
        state,
        action: ownerChoice,
        ...options,
      }).state;
      expect(card(state, "kanjuden-target")).toMatchObject({
        zone: "field",
        faceDown: true,
        underCards: [],
        normalCoreCount: 0,
      });
      expect(card(state, "kanjuden-contract")).toMatchObject({
        zone: "field",
        faceDown: choice === "decline",
        attachedToInstanceId: null,
      });
      expect(
        state.players[1]!.soulStateInstanceIds.includes("kanjuden-contract")
      ).toBe(choice === "execute");
      expect(state.pendingLeaveEntities).toEqual([]);
    }
  );

  it("発揮しない場合は対象・魂状態選択を出さず盤面を変えない", () => {
    const state = begin("pure-contract", true);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(card(state, "kanjuden-contract")).toMatchObject({
      faceDown: false,
      normalCoreCount: 3,
    });
  });

  it.each(["execute", "decline"] as const)(
    "発揮後は自分が対象を選び、選ばれた契約だけ相手が魂状態を選ぶ: %s",
    (choice) => {
      let state = begin();
      expect(state.pendingStepOptionalChoice).toBeNull();
      const targetAction = find(state, "resolve_pending_effect_target");
      expect(targetAction).toMatchObject({ requiredTargetCount: 1 });
      expect(card(state, "kanjuden-target").faceDown).toBe(false);
      state = applyLegalAction({
        state,
        action: targetAction,
        targetInstanceIds: ["kanjuden-contract"],
        ...options,
      }).state;
      expect(state.pendingStepOptionalChoice).toMatchObject({
        choosingPlayerId: "bob",
        prompt: {
          label: "魂状態にする",
          question: "「緋村 剣心」を魂状態にしますか？",
        },
      });
      expect(actions(state, "alice")).toEqual([]);
      const ownerChoice = actions(state, "bob").find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === choice
      )!;
      state = applyLegalAction({
        state,
        action: ownerChoice,
        ...options,
      }).state;
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(card(state, "kanjuden-target")).toMatchObject({
        faceDown: false,
        normalCoreCount: 3,
      });
      expect(card(state, "kanjuden-contract")).toMatchObject({
        zone: "field",
        faceDown: choice === "decline",
        normalCoreCount: 0,
      });
      expect(
        state.players[1]!.soulStateInstanceIds.includes("kanjuden-contract")
      ).toBe(choice === "execute");
      expect(state.pendingLeaveEntities).toEqual([]);
    }
  );
});
