import {
  getDeckRevealExclusiveGroupBranches,
  resolveDeckRevealCostGateToApply,
} from "./deck-reveal-pick-candidates";
import type { CardCostPaymentSource } from "../core/payment-system";
import {
  getHandGainCostPaymentSources,
  getOwnEffectHandGainCost,
  payHandGainCost,
} from "../effect/hand-gain-cost";
import type { CardDefinition, GameState, PendingDeckReveal } from "../model";

/** 本文の複数回収枠は1イベント。公開されたカード自身の回収効果とは共有しない。 */
export function getDeckRevealHandGainCost(
  state: GameState,
  pending: PendingDeckReveal
): number {
  if (
    pending.phase !== "revealed_choice" &&
    pending.handGainCostDecision === "paid"
  )
    return 0;
  return getOwnEffectHandGainCost(
    state,
    pending.targetPlayerId ?? pending.actingPlayerId,
    pending.actingPlayerId
  );
}

export function revealedChoiceIncreasesHand(
  pending: PendingDeckReveal,
  id: string
): boolean {
  const disposition = pending.revealedDispositionMap?.[id];
  if (!disposition) return true;
  if (disposition.kind === "move") return disposition.destination === "hand";
  return disposition.kind === "summon" || disposition.kind === "steps_only";
}

/** 支払い元の列挙は通常のコスト支払いと共通。要求額そのものは軽減しない。 */
export function getDeckRevealCostPaymentSources(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
) {
  const card = getDeckRevealPaymentDefinition(
    state,
    pending,
    getCardDefinitionById
  );
  if (!card)
    throw new Error(
      `Missing deck reveal source: ${pending.sourceDefinitionId}`
    );
  return getHandGainCostPaymentSources(
    state,
    { ...pending, sourceDefinitionId: card.cardNo },
    getCardDefinitionById
  );
}

function getDeckRevealPaymentDefinition(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
) {
  return (
    getCardDefinitionById(pending.sourceDefinitionId) ??
    getCardDefinitionById(
      state.cardInstances.find((c) =>
        pending.revealedCardInstanceIds.includes(c.instanceId)
      )?.definitionId ?? ""
    )
  );
}

export function getDeckRevealSelectedHandGainCost(
  state: GameState,
  pending: PendingDeckReveal,
  selectedIds: readonly string[],
  destination: "hand" | "set_aside" | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const amount = getDeckRevealHandGainCost(state, pending);
  if (pending.phase === "revealed_choice") {
    return (
      amount *
      selectedIds.filter((id) => revealedChoiceIncreasesHand(pending, id))
        .length
    );
  }
  if (selectedIds.length === 0) return 0;
  const currentPick = pending.picks[pending.currentPickIndex];
  const pick = currentPick?.exclusiveGroup
    ? getDeckRevealExclusiveGroupBranches(
        state,
        pending,
        pending.currentPickIndex,
        getCardDefinitionById
      ).find(
        (branch) =>
          branch.candidateIds.length > 0 &&
          selectedIds.length === branch.requiredCount &&
          selectedIds.every((id) => branch.candidateIds.includes(id))
      )?.pick
    : currentPick;
  if (!pick) return 0;
  return (
    resolveDeckRevealCostGateToApply(state, pending, {
      ...pick,
      destination: destination ?? pick.destination ?? "hand",
    }) ?? 0
  );
}

export function payDeckRevealHandGainCost(
  state: GameState,
  pending: PendingDeckReveal,
  amount: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  selectedSources?: readonly CardCostPaymentSource[]
): GameState {
  if (amount <= 0) return state;
  const card = getDeckRevealPaymentDefinition(
    state,
    pending,
    getCardDefinitionById
  )!;
  const payment = payHandGainCost(
    state,
    { ...pending, sourceDefinitionId: card.cardNo },
    amount,
    getCardDefinitionById,
    selectedSources
  );
  // 公開回収の拒否は空の回収選択で処理し、未払いの選択カードは決して移動しない。
  if (!payment.canGain)
    throw new Error(
      "Deck reveal blocked by hand_gain_cost_gate: payment declined"
    );
  const next = payment.state;
  return {
    ...next,
    log: [
      ...next.log,
      `deck_reveal:cost_gate_paid:${pending.actingPlayerId}:${amount}`,
    ],
  };
}
