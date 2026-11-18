import type { Action } from "../dsl-types";
import type {
  CardDefinition,
  EffectPreventionLevel,
  GameState,
} from "../model";
import { getCoreMoveChangedCoreAmount } from "../core/core-move-result";
import { convertCoreLocation } from "./native-action-shared";
import { executeCoreMove } from "./structured-core-move";
import { cloneStateForPendingSnapshot } from "./structured-effect-interpreter";
import type { TargetLockBypassProfile } from "./target-affect-gate";

/**
 * 確定的なコア移動を実行プリミティブで評価し、
 * 移動元・耐性・複数個・支払後の維持コアを宣言判定にも同じ意味で渡す。
 * 対象/参照/分配選択が必要な移動は、この確定的なプレビューでは扱わない。
 */
export function previewConditionalCoreCost(options: {
  state: GameState;
  action: Action;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourcePreventionLevel?: EffectPreventionLevel | undefined;
  sourceTargetLockBypass?: TargetLockBypassProfile | undefined;
  sourcePreventionBypass?: TargetLockBypassProfile | undefined;
  effectSourceInstanceId?: string | undefined;
  effectSourceDefinitionId?: string | undefined;
}): { state: GameState; paid: boolean } | undefined {
  const { action } = options;
  if (
    action.kind !== "core_move" ||
    action.to === undefined ||
    action.splitDestinations !== undefined ||
    action.target !== undefined ||
    (typeof action.amount !== "number" && action.amount !== "all") ||
    action.from.kind === "ref" ||
    action.from.kind === "target_card" ||
    action.to.kind === "ref" ||
    action.to.kind === "target_card" ||
    (action.effectKind !== "explicit_soul_core" &&
      (action.from.kind === "union" ||
        action.from.kind === "field" ||
        action.from.kind === "field_card")) ||
    action.to.kind === "field" ||
    action.to.kind === "field_card" ||
    action.to.kind === "union" ||
    action.from.kind === "outside_game"
  )
    return undefined;
  const amount = action.amount === "all" ? Infinity : action.amount;
  const state = executeCoreMove(
    cloneStateForPendingSnapshot(options.state),
    options.actingPlayerId,
    convertCoreLocation(action.from),
    convertCoreLocation(action.to),
    amount,
    options.sourceInstanceId,
    undefined,
    undefined,
    options.getCardDefinitionById,
    undefined,
    undefined,
    undefined,
    undefined,
    options.sourcePreventionLevel ?? "none",
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    options.sourceTargetLockBypass,
    undefined,
    undefined,
    action.effectKind,
    options.sourcePreventionBypass,
    options.effectSourceInstanceId,
    options.effectSourceDefinitionId,
    undefined,
    undefined,
    undefined,
    true
  );
  // 置換・迎撃の選択結果は宣言時に固定しない。保留中の盤面を後段の予算へ使わない。
  if (
    state.pendingLifeDamageDiscardChoice !==
      options.state.pendingLifeDamageDiscardChoice ||
    state.pendingLifeGainReplacementChoice !==
      options.state.pendingLifeGainReplacementChoice
  )
    return undefined;
  const moved = getCoreMoveChangedCoreAmount(options.state, state);
  return { state, paid: Number.isFinite(amount) ? moved >= amount : moved > 0 };
}
