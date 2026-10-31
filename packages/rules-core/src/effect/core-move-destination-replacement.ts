import { convertCoreLocation } from "./native-action-shared";
import { resolveLocationPlayer } from "./structured-effect-interpreter";
import type { Effect, EffectStep, Action } from "../dsl-types";
import type {
  CoreMoveDestinationReplacementAction,
  EffectCoreLocation,
  GameState,
} from "../model";
import { getGlobalCEs } from "../card/ce-lookup";
import { isSameCombinedEffectSource } from "./effect-source-identity";

type Replacement = Pick<
  CoreMoveDestinationReplacementAction,
  | "fromOwner"
  | "fromZone"
  | "matchCausingSourceOnly"
  | "matchToZone"
  | "toZone"
  | "optional"
>;

/** 強制置換と任意選択の対象照合を共有する。「このスピリット」は合体中効果を含む。 */
export function getCoreMoveDestinationReplacement(
  state: GameState,
  sourceInstanceId: string,
  fromPlayerId: string,
  fromZone: EffectCoreLocation["kind"],
  toZone: EffectCoreLocation["kind"],
  optional = false
): Replacement | undefined {
  for (const ce of getGlobalCEs(state)) {
    if (ce.modifierTag !== "core_move_destination_replacement") continue;
    const meta = ce.metadata as Replacement | undefined;
    if (!meta || (meta.optional === true) !== optional) continue;
    if (
      meta.fromOwner !== "either" &&
      (fromPlayerId === ce.actingPlayerId) !== (meta.fromOwner === "self")
    )
      continue;
    if (meta.fromZone && meta.fromZone !== fromZone) continue;
    if (meta.matchToZone && meta.matchToZone !== toZone) continue;
    if (
      meta.matchCausingSourceOnly &&
      !isSameCombinedEffectSource(state, ce.sourceInstanceId, sourceInstanceId)
    )
      continue;
    return meta;
  }
  return undefined;
}

/** 既存の choice/continuation を使い、宣言後のコア移動に任意の移動先を追加する。 */
export function withCoreMoveDestinationChoices(
  effect: Effect,
  state: GameState,
  sourceInstanceId: string,
  actingPlayerId: string
): Effect {
  if (
    !getGlobalCEs(state).some(
      (ce) =>
        ce.modifierTag === "core_move_destination_replacement" &&
        ce.metadata?.optional === true
    )
  )
    return effect;
  function replaced(action: Action): Action | undefined {
    if (action.kind !== "core_move" || !action.to) return undefined;
    const from = convertCoreLocation(action.from);
    const to = convertCoreLocation(action.to);
    const fromPlayerId = resolveLocationPlayer(actingPlayerId, from, state);
    const replacement = getCoreMoveDestinationReplacement(
      state,
      sourceInstanceId,
      fromPlayerId,
      from.kind,
      to.kind,
      true
    );
    if (!replacement) return undefined;
    return {
      ...action,
      to: {
        kind: replacement.toZone,
        player: "player" in action.to ? action.to.player : "self",
      },
    };
  }
  let changed = false;
  const steps = effect.steps.map((step): EffectStep => {
    const variants = [step, ...(step.choice ?? [])];
    const additions: EffectStep[] = [];
    for (const variant of variants) {
      const action = replaced(variant.action);
      if (
        !action ||
        variants.some(
          (v) => JSON.stringify(v.action) === JSON.stringify(action)
        )
      )
        continue;
      const added = {
        ...variant,
        label:
          action.kind === "core_move" && action.to?.kind === "void"
            ? "ボイドへ置く"
            : "トラッシュへ置く",
        action,
      };
      delete added.choice;
      additions.push(added);
    }
    if (!additions.length) return step;
    changed = true;
    return {
      ...step,
      label: step.label ?? "リザーブへ置く",
      choice: [...(step.choice ?? []), ...additions],
    };
  });
  return changed ? { ...effect, steps } : effect;
}
