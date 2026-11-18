import type { GameState } from "../model";
import type {
  GetLegalActionsOptions,
  LegalAction,
} from "./legal-actions-types";
import { getAvailableJoinActiveAttackLegalActions } from "./legal-actions-availability";
import { hasPendingEffectResolution } from "../effect/pending-resolution-policy";

/** 通常フラッシュに戻る直前の任意アタック。召喚原因・神託・派生誘発は先に完了する。 */
export function getImmediateAttackJoinDecisions(
  options: GetLegalActionsOptions
): LegalAction[] {
  const state = options.state;
  if (
    !state.pendingImmediateAttackJoins?.length ||
    !isImmediateAttackJoinReady(state)
  )
    return [];
  const joins = getAvailableJoinActiveAttackLegalActions({
    ...options,
    actingPlayerId: state.activePlayerId,
  });
  const seen = new Set<string>();
  const actions: LegalAction[] = [...joins];
  for (const join of joins) {
    if (seen.has(join.sourceInstanceId)) continue;
    seen.add(join.sourceInstanceId);
    actions.push({
      kind: "decline_immediate_attack_join",
      actionId: `legal:decline-immediate-attack-join:${join.attackId}:${join.sourceInstanceId}`,
      can: true,
      reason: "decline_immediate_attack_join",
      actingPlayerId: join.actingPlayerId,
      sourceInstanceId: join.sourceInstanceId,
      attackId: join.attackId,
    });
  }
  return actions;
}

export function isImmediateAttackJoinReady(state: GameState): boolean {
  return !(
    state.stackWindow ||
    state.preDeclarationStackWindow ||
    state.activeAttack?.flashWindowState?.pendingStackAction ||
    hasPendingEffectResolution(state, "all") ||
    state.pendingTriggeredEffects.length ||
    state.battleImmediateEffects.length ||
    state.pendingPrivateDeclarations.length ||
    state.pendingBurstChecks.length ||
    (state.pendingEffectCompletions ?? []).length
  );
}

export function consumeImmediateAttackJoin(
  state: GameState,
  sourceInstanceId: string
): GameState {
  return {
    ...state,
    pendingImmediateAttackJoins: (
      state.pendingImmediateAttackJoins ?? []
    ).filter((entry) => entry.sourceInstanceId !== sourceInstanceId),
  };
}

/** 安定点で不適格だった機会は失効する。後の回復・許可の再取得で復活させない。 */
export function pruneImmediateAttackJoins(
  options: GetLegalActionsOptions
): GameState {
  const state = options.state;
  if (
    !state.pendingImmediateAttackJoins?.length ||
    !isImmediateAttackJoinReady(state)
  )
    return state;
  const validIds = new Set(
    getAvailableJoinActiveAttackLegalActions({
      ...options,
      actingPlayerId: state.activePlayerId,
    }).map((action) => action.sourceInstanceId)
  );
  const pending = state.pendingImmediateAttackJoins.filter(
    (entry) =>
      entry.attackId === state.activeAttack?.attackId &&
      validIds.has(entry.sourceInstanceId)
  );
  return pending.length === state.pendingImmediateAttackJoins.length
    ? state
    : { ...state, pendingImmediateAttackJoins: pending };
}
