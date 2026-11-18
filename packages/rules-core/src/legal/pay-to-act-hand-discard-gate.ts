// 発揮前提手札破棄ゲート (gate_flash_stack_hand_discard)。

import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  EffectActivationTiming,
  GameState,
  PendingPayToActHandDiscardGate,
  PendingPayToActHandDiscardSlot,
} from "../model";
import type { CountBound } from "../dsl-types";
import { getCardById, getStackSourceActivationZone } from "../card/card-lookup";
import { isCEActiveForScope } from "../card/ce-lookup";
import { resolveHandDiscardContainerAffect } from "../effect/effect-affect-adapter";
import { resolveCountBound } from "../effect/target-resolution";
import type { StepExecutionContext } from "../step-execution-context";
import {
  getStackActivationLabel,
  isGateCandidateProtected,
  PAY_TO_ACT_GATED_STACK_KINDS,
} from "./pay-to-act-core-gate";

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : undefined;
}

function makeGateStepContext(
  state: GameState,
  sourceInstanceId: string,
  activationLabel: EffectActivationTiming
): StepExecutionContext {
  return {
    results: new Map(),
    originalState: state,
    sourceInstanceId,
    effectActivationTiming: activationLabel,
  };
}

function resolveGateCount(
  state: GameState,
  ce: ContinuousEffect,
  activationLabel: EffectActivationTiming,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const raw = (ce.metadata?.["handDiscardCount"] ?? 1) as CountBound;
  if (typeof raw === "number") return Math.max(0, Math.floor(raw));
  if (!getCardDefinitionById) return 0;
  return Math.max(
    0,
    Math.floor(
      resolveCountBound(
        raw,
        state,
        ce.actingPlayerId,
        makeGateStepContext(state, ce.sourceInstanceId, activationLabel),
        getCardDefinitionById
      )
    )
  );
}

function gateMatchesStack(
  state: GameState,
  ce: ContinuousEffect,
  stack: ActiveStack,
  activationLabel: EffectActivationTiming
): boolean {
  const labels = toStringArray(ce.metadata?.["targetEffectLabels"]) ?? [
    "flash",
    "stack",
  ];
  if (!labels.includes(activationLabel)) return false;

  const zones = toStringArray(ce.metadata?.["sourceActivationZones"]);
  if (zones === undefined) return true;
  const activationZone = getStackSourceActivationZone(
    state,
    stack,
    ce.actingPlayerId
  );
  return activationZone !== undefined && zones.includes(activationZone);
}

function candidateCardsForGateSlot(
  state: GameState,
  gatedPlayerId: string,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): string[] {
  const handCards = state.cardInstances.filter(
    (card) => card.ownerPlayerId === gatedPlayerId && card.zone === "hand"
  );
  if (
    resolveHandDiscardContainerAffect(
      state,
      gatedPlayerId,
      ce.actingPlayerId,
      handCards.length,
      getCardDefinitionById
    ).kind !== "allowed"
  ) {
    return [];
  }

  // ②(破棄対象手札カード候補)の耐性判定は isGateCandidateProtected (SSOT) を必ず
  // 経由する。専用フィルタを個別実装しない (コア除去型 gate_flash_stack_core の②実装
  // 漏れの再発防止。pay-to-act-core-gate.ts の isGateCandidateProtected 参照)。
  return handCards
    .filter(
      (card) =>
        !isGateCandidateProtected(state, card, [ce], getCardDefinitionById)
    )
    .map((card) => card.instanceId);
}

export function findAtomicHandDiscardAssignment(
  slots: readonly PendingPayToActHandDiscardSlot[],
  selectedCardInstanceIds?: readonly string[]
): string[] | null {
  const allowedSelected =
    selectedCardInstanceIds !== undefined
      ? new Set(selectedCardInstanceIds)
      : undefined;
  const sorted = [...slots].sort(
    (a, b) =>
      a.candidateCardInstanceIds.length - b.candidateCardInstanceIds.length
  );
  const used = new Set<string>();
  const assignment: string[] = [];

  const search = (index: number): boolean => {
    if (index >= sorted.length) return true;
    for (const candidate of sorted[index]!.candidateCardInstanceIds) {
      if (used.has(candidate)) continue;
      if (allowedSelected !== undefined && !allowedSelected.has(candidate)) {
        continue;
      }
      used.add(candidate);
      assignment.push(candidate);
      if (search(index + 1)) return true;
      assignment.pop();
      used.delete(candidate);
    }
    return false;
  };

  return search(0) ? assignment : null;
}

export function computePayToActHandDiscardGate(
  state: GameState,
  resolvedStack: ActiveStack,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): PendingPayToActHandDiscardGate | null {
  if (!PAY_TO_ACT_GATED_STACK_KINDS.has(resolvedStack.actionKind)) {
    return null;
  }
  const activationLabel = getStackActivationLabel(resolvedStack);
  if (activationLabel !== "flash" && activationLabel !== "stack") return null;

  const gatedPlayerId = resolvedStack.actingPlayerId;
  const holderCard = getCardById(state, resolvedStack.cardInstanceId);
  const sourceDefinitionsApplied = new Set<string>();
  const slots: PendingPayToActHandDiscardSlot[] = [];
  const appliedCEs: ContinuousEffect[] = [];

  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "gate_flash_stack_hand_discard") continue;
    if (ce.targetInstanceId !== gatedPlayerId) continue;
    if (!isCEActiveForScope(ce, state.step, state.activePlayerId)) continue;
    if (!gateMatchesStack(state, ce, resolvedStack, activationLabel)) continue;

    // 耐性①(発揮するカード自身)は不発の要否だけを左右する (10_rules/03d.md)。
    // 「破棄しなければ発揮できない」の要求自体は耐性の有無を問わず変わらず提示するため、
    // ここでは continue せず holderImmune フラグとしてスロットに残す。
    // ②(破棄対象手札カード候補)と同じ isGateCandidateProtected (SSOT) を使う
    // (①-a: defense_immune 等の CE ベース耐性、①-b: 創界神/魂状態/ミラージュ等
    // 「○○を含む」opt-in が無い限り対象外の構造的除外、を内包する)。
    const holderImmune =
      !!holderCard &&
      isGateCandidateProtected(state, holderCard, [ce], getCardDefinitionById);

    const noDuplicate = ce.metadata?.["noDuplicate"] === true;
    if (noDuplicate && sourceDefinitionsApplied.has(ce.sourceDefinitionId)) {
      continue;
    }
    if (noDuplicate) sourceDefinitionsApplied.add(ce.sourceDefinitionId);

    const required = resolveGateCount(
      state,
      ce,
      activationLabel,
      getCardDefinitionById
    );
    if (required <= 0) continue;

    const candidates = candidateCardsForGateSlot(
      state,
      gatedPlayerId,
      ce,
      getCardDefinitionById
    );
    for (let i = 0; i < required; i += 1) {
      slots.push({
        gateSourceInstanceId: ce.sourceInstanceId,
        gateSourceDefinitionId: ce.sourceDefinitionId,
        candidateCardInstanceIds: candidates,
        holderImmune,
      });
    }
    appliedCEs.push(ce);
  }

  if (slots.length === 0) return null;
  const first = appliedCEs[0]!;
  const hasBindingSlot = slots.some((slot) => !slot.holderImmune);
  const assignment = findAtomicHandDiscardAssignment(slots);
  const candidateCardInstanceIds =
    assignment === null
      ? []
      : [...new Set(slots.flatMap((slot) => slot.candidateCardInstanceIds))];

  if (!hasBindingSlot && candidateCardInstanceIds.length === 0) {
    // 全スロットが holder 耐性による非拘束かつ破棄候補も無い: 提示すべき選択肢が無く、
    // 拘束も無いのでゲート不成立として扱い、そのまま解決へ進む(不発にしない)。
    return null;
  }

  return {
    pendingId: `pay-to-act-hand-discard-gate:${resolvedStack.chainId}`,
    actingPlayerId: gatedPlayerId,
    gateSourceInstanceId: first.sourceInstanceId,
    gateSourceDefinitionId: first.sourceDefinitionId,
    deferredStack: resolvedStack,
    remainingStacks: [],
    requiredCount: slots.length,
    candidateCardInstanceIds,
    candidateSlots: slots,
    declineFizzles: hasBindingSlot,
  };
}
