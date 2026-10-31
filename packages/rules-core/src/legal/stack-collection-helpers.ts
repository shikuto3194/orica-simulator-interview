// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).

import type {
  ActiveStack,
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../model";
import { isPendingStackNegateRequestExpired } from "../model";

import { stackMatchesNegateAction } from "../stack/stack-negate";

export function collectActiveStackChainForCardInstance(
  stack: ActiveStack | null | undefined,
  cardInstanceId: string,
  out: ActiveStack[]
): void {
  if (!stack) return;
  if (stack.cardInstanceId === cardInstanceId) {
    out.push(stack);
  }
  collectActiveStackChainForCardInstance(
    stack.previousPendingStackAction,
    cardInstanceId,
    out
  );
}

/** 全ての宣言中スタック（応答元・中断中の cascade を含む）。 */
export function collectPendingStacks(
  state: GameState,
  options: { includeFlushGuards?: boolean } = {}
): ActiveStack[] {
  const stacks = new Set<ActiveStack>();
  const collect = (stack: ActiveStack | null | undefined): void => {
    if (!stack || stacks.has(stack)) return;
    stacks.add(stack);
    collect(stack.previousPendingStackAction);
  };
  collect(state.stackWindow?.pendingStackAction);
  collect(state.preDeclarationStackWindow?.pendingStackAction);
  collect(state.activeAttack?.flashWindowState?.pendingStackAction);
  for (const stack of state.pendingStackCascade?.remainingStacks ?? [])
    collect(stack);
  if (options.includeFlushGuards !== false)
    for (const stack of state.pendingStackCascadeFlushGuardStacks ?? [])
      collect(stack);
  return [...stacks];
}

export function collectPendingStacksForCardInstance(
  state: GameState,
  cardInstanceId: string
): ActiveStack[] {
  return collectPendingStacks(state).filter(
    (stack) => stack.cardInstanceId === cardInstanceId
  );
}

export function hasPendingNegateRequestForEffectDeclarationTarget(
  state: GameState,
  pendingEffect: PendingTriggeredEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    pendingEffect.eventKind !== "effect_declaration" ||
    pendingEffect.relatedInstanceId === null
  ) {
    return false;
  }
  const targetStacks = collectPendingStacksForCardInstance(
    state,
    pendingEffect.relatedInstanceId
  );
  return state.pendingStackNegateRequests
    .filter((request) => !isPendingStackNegateRequestExpired(request, state))
    .some((request) =>
      targetStacks.some(
        (stack) =>
          stack.isNullified !== true &&
          stackMatchesNegateAction({
            state,
            stack,
            request,
            actingPlayerId: request.actingPlayerId,
            getCardDefinitionById,
          })
      )
    );
}
