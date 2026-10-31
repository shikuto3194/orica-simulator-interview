import type { DSL, Effect } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";
import type { CardDefinition, GameState } from "../model";
import { resolvePlayerRef } from "./structured-effect-interpreter";
import { resolveCountBound } from "./target-resolution";

let actionCountSelectionSequence = 0;

/** カードの内容を選ばず、上から処理する枚数だけを決める。 */
export function queueActionCountSelection(options: {
  state: GameState;
  action: DSL.DrawAction | DSL.MoveCardAction;
  actingPlayerId: string;
  sourceInstanceId: string;
  stepCtx: StepExecutionContext;
  effect: Effect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState | null {
  const {
    state,
    action,
    actingPlayerId,
    sourceInstanceId,
    stepCtx,
    effect,
    getCardDefinitionById,
  } = options;
  if (typeof action.count !== "object" || !("min" in action.count)) return null;
  // 明示対象や条件付きの移動は対象選択側で枚数を決める。
  if (
    action.kind === "move_card" &&
    (action.target ||
      action.from.zone !== "deck" ||
      action.from.filter ||
      action.from.hostFilter ||
      action.from.sourceUnderCardRole)
  )
    return null;
  if (action.kind === "draw" && action.targetHandSize !== undefined)
    return null;
  const playerRef =
    action.kind === "draw" ? (action.player ?? "self") : action.from.player;
  const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);
  const cap =
    action.kind === "draw" || action.from.zone === "deck"
      ? (state.players.find((p) => p.id === targetPlayerId)?.deckCount ?? 0)
      : state.cardInstances.filter(
          (c) =>
            c.ownerPlayerId === targetPlayerId &&
            (Array.isArray(action.from.zone)
              ? action.from.zone.includes(c.zone)
              : c.zone === action.from.zone)
        ).length;
  const max = Math.max(
    0,
    Math.min(
      cap,
      action.count.max === undefined
        ? cap
        : resolveCountBound(
            action.count.max,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById
          )
    )
  );
  const min = Math.max(
    0,
    Math.min(
      max,
      resolveCountBound(
        action.count.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      )
    )
  );
  return {
    ...state,
    pendingCountSelection: {
      pendingId: `action-count-${actionCountSelectionSequence++}`,
      actingPlayerId,
      sourceInstanceId,
      sourceDefinitionId:
        state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
          ?.definitionId ?? "dsl-unknown",
      targetPlayerId,
      playerRef,
      sourceTribes: [],
      min,
      max,
      effectTiming: effect.timing,
      selectionAction: action,
      priorStateSnapshot: state,
    },
  };
}
