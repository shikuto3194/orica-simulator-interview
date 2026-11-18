import {
  applyLegalAction,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../../src";
import { generateActionInputChoices } from "../../src/action-input-choices";
import { finishCoreChoices } from "./core-choice-driver";

/** Explicit player input for clause tests. Stops at the optional tail when requested. */
export function finishPayloadInputs(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  choice: "execute" | "decline" | "stop" = "execute"
): GameState {
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  for (let n = 0; n < 80; n++) {
    state = finishCoreChoices(state, getCardDefinitionById, lookups);
    const all = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const optional =
      all.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === (choice === "decline" ? "decline" : "execute")
      ) ??
      all.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
    if (optional && choice === "stop") return state;
    const action =
      optional ??
      all.find((a) =>
        [
          "resolve_pending_core_split",
          "resolve_core_source_allocation",
          "resolve_pending_effect_target",
          "resolve_pending_step_optional_target_selection",
          "resolve_pending_zone_selection",
          "resolve_pending_core_shoot",
          "resolve_pending_step_choice",
          "resolve_borrowed_effect_choice",
          "resolve_borrowed_effect_target",
          "pass_stack",
          "pass_pre_declaration_stack",
        ].includes(a.kind)
      );
    if (!action) return state;
    const values = generateActionInputChoices(
      state,
      action,
      { getCardDefinitionById },
      256
    ).values;
    const score = (input: Record<string, unknown>) =>
      Object.values(input).reduce<number>(
        (n, v) => n + (Array.isArray(v) ? v.length : 0),
        0
      );
    const input = values.sort((a, b) => score(b) - score(a))[0] ?? {};
    state = applyLegalAction({ state, action, ...lookups, ...input }).state;
  }
  throw new Error("Payload input did not settle");
}
