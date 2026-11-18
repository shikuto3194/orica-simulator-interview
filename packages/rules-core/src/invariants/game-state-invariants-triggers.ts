import {
  appendDuplicateIssue,
  appendMissingReferenceIssue,
  appendNonNegativeIntegerIssue,
  appendPositiveIntegerIssue,
} from "./game-state-invariant-helpers";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { CardInstance, GameState, TriggerPriority } from "../model";
import { isPendingPrivateDeclarationsSortedByTurnPriority } from "../effect/trigger-system";
import { assertTriggerChainId, pendingTriggerChainEntries } from "../chain-id";

function getTriggerPriority(value: {
  triggerPriority?: TriggerPriority;
}): TriggerPriority {
  return value.triggerPriority ?? "normal";
}

export function collectTriggeredQueueInvariantIssues(options: {
  state: GameState;
  issues: GameStateInvariantIssue[];
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
}): void {
  for (const entry of pendingTriggerChainEntries(options.state)) {
    try {
      assertTriggerChainId(entry.chainId);
    } catch {
      options.issues.push({
        code: "invalid_trigger_chain_id",
        path: entry.path,
        message:
          "Trigger chainId must be a non-empty string; missing causality cannot be reconstructed.",
      });
    }
  }
  const seenPendingIds = new Set<string>();
  const seenBurstCheckIds = new Set<string>();

  for (const [
    index,
    pendingTriggeredEffect,
  ] of options.state.pendingTriggeredEffects.entries()) {
    if (seenPendingIds.has(pendingTriggeredEffect.pendingId)) {
      appendDuplicateIssue(
        options.issues,
        `pendingTriggeredEffects[${index}].pendingId`,
        "duplicate_pending_triggered_effect_id",
        pendingTriggeredEffect.pendingId
      );
    }

    seenPendingIds.add(pendingTriggeredEffect.pendingId);

    if (!options.playerIds.has(pendingTriggeredEffect.actingPlayerId)) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingTriggeredEffects[${index}].actingPlayerId`,
        "missing_pending_triggered_effect_player",
        pendingTriggeredEffect.actingPlayerId
      );
    }

    // 注: 「source 無し pending」はリスナー無しイベントの leak 兆候だが、
    // legacy 経路（options 部分提供のテスト fixture など）では正当に発生しうるため
    // ここでは invariant 違反としては扱わない。
    // 防止は trigger-system.ts の queuePendingReactionsFromTriggerEvents
    // (options 提供時に sourceChoices=0 を捨てる) で実施する。

    if (
      pendingTriggeredEffect.relatedPlayerId !== null &&
      !options.playerIds.has(pendingTriggeredEffect.relatedPlayerId)
    ) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingTriggeredEffects[${index}].relatedPlayerId`,
        "missing_pending_triggered_effect_related_player",
        pendingTriggeredEffect.relatedPlayerId
      );
    }

    if (
      pendingTriggeredEffect.relatedInstanceId !== null &&
      !options.cardById.has(pendingTriggeredEffect.relatedInstanceId)
    ) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingTriggeredEffects[${index}].relatedInstanceId`,
        "missing_pending_triggered_effect_related_instance",
        pendingTriggeredEffect.relatedInstanceId
      );
    }

    if (pendingTriggeredEffect.amount !== null) {
      // `amount` is an event payload, not a required payment/count.  In
      // particular, an unblocked `battle_end` legitimately carries 0 so a
      // DynamicCount.event_amount effect can resolve as a no-op.
      appendNonNegativeIntegerIssue(
        options.issues,
        pendingTriggeredEffect.amount,
        `pendingTriggeredEffects[${index}].amount`,
        "invalid_pending_triggered_effect_amount"
      );
    }

    const seenResolvedSourceInstanceIds = new Set<string>();

    for (const [
      resolvedSourceIndex,
      resolvedSourceInstanceId,
    ] of pendingTriggeredEffect.resolvedSourceInstanceIds.entries()) {
      if (seenResolvedSourceInstanceIds.has(resolvedSourceInstanceId)) {
        appendDuplicateIssue(
          options.issues,
          `pendingTriggeredEffects[${index}].resolvedSourceInstanceIds[${resolvedSourceIndex}]`,
          "duplicate_pending_triggered_effect_resolved_source_instance_id",
          resolvedSourceInstanceId
        );
      }

      seenResolvedSourceInstanceIds.add(resolvedSourceInstanceId);

      if (!options.cardById.has(resolvedSourceInstanceId)) {
        appendMissingReferenceIssue(
          options.issues,
          `pendingTriggeredEffects[${index}].resolvedSourceInstanceIds[${resolvedSourceIndex}]`,
          "missing_pending_triggered_effect_resolved_source_instance",
          resolvedSourceInstanceId
        );
      }
    }
  }

  // P3-36 Phase A: pendingPrivateDeclarations は非ターンプレイヤー先頭の sort 順を保つ。
  // sort を破る経路（state migration / fixture など）が混入したら不変条件違反として記録する。
  if (
    !isPendingPrivateDeclarationsSortedByTurnPriority(
      options.state.pendingPrivateDeclarations,
      options.state.activePlayerId
    )
  ) {
    options.issues.push({
      code: "pending_private_declarations_unsorted",
      path: "pendingPrivateDeclarations",
      message:
        "pendingPrivateDeclarations must be ordered with non-turn-player declarations first (P3-36 Phase A).",
    });
  }

  // 同時誘発「全宣言完了まで保留」: pendingDeferredTriggeredEffects の各 entry は
  // simultaneousGroupId を持ち、かつ同 groupId + 同 triggerPriority の private declaration が
  // pendingPrivateDeclarations に少なくとも1件残っているはず。
  // どちらかが破れたら orphan = invariant 違反。
  for (const [
    index,
    deferred,
  ] of options.state.pendingDeferredTriggeredEffects.entries()) {
    if (deferred.simultaneousGroupId === undefined) {
      options.issues.push({
        code: "deferred_triggered_effect_missing_group_id",
        path: `pendingDeferredTriggeredEffects[${index}].simultaneousGroupId`,
        message:
          "pendingDeferredTriggeredEffects entries must carry a simultaneousGroupId (single declarations should never be deferred).",
      });
      continue;
    }
    const hasSibling = options.state.pendingPrivateDeclarations.some(
      (decl) =>
        decl.simultaneousGroupId === deferred.simultaneousGroupId &&
        getTriggerPriority(decl) === getTriggerPriority(deferred)
    );
    if (!hasSibling) {
      options.issues.push({
        code: "deferred_triggered_effect_orphaned",
        path: `pendingDeferredTriggeredEffects[${index}]`,
        message: `pendingDeferredTriggeredEffects[${index}] (group=${deferred.simultaneousGroupId}) has no matching pendingPrivateDeclarations entry — should have been flushed.`,
      });
    }
  }

  for (const [
    index,
    pendingBurstCheck,
  ] of options.state.pendingBurstChecks.entries()) {
    if (seenBurstCheckIds.has(pendingBurstCheck.checkId)) {
      appendDuplicateIssue(
        options.issues,
        `pendingBurstChecks[${index}].checkId`,
        "duplicate_pending_burst_check_id",
        pendingBurstCheck.checkId
      );
    }

    seenBurstCheckIds.add(pendingBurstCheck.checkId);

    if (!options.playerIds.has(pendingBurstCheck.actingPlayerId)) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingBurstChecks[${index}].actingPlayerId`,
        "missing_pending_burst_check_player",
        pendingBurstCheck.actingPlayerId
      );
    }

    if (!options.playerIds.has(pendingBurstCheck.relatedPlayerId)) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingBurstChecks[${index}].relatedPlayerId`,
        "missing_pending_burst_check_related_player",
        pendingBurstCheck.relatedPlayerId
      );
    }

    if (
      pendingBurstCheck.relatedInstanceId != null &&
      !options.cardById.has(pendingBurstCheck.relatedInstanceId)
    ) {
      appendMissingReferenceIssue(
        options.issues,
        `pendingBurstChecks[${index}].relatedInstanceId`,
        "missing_pending_burst_check_related_instance",
        pendingBurstCheck.relatedInstanceId
      );
    }

    appendPositiveIntegerIssue(
      options.issues,
      pendingBurstCheck.amount,
      `pendingBurstChecks[${index}].amount`,
      "invalid_pending_burst_check_amount"
    );

    const seenResolvedBurstCardInstanceIds = new Set<string>();

    for (const [
      resolvedBurstIndex,
      resolvedBurstCardInstanceId,
    ] of pendingBurstCheck.resolvedBurstCardInstanceIds.entries()) {
      if (seenResolvedBurstCardInstanceIds.has(resolvedBurstCardInstanceId)) {
        appendDuplicateIssue(
          options.issues,
          `pendingBurstChecks[${index}].resolvedBurstCardInstanceIds[${resolvedBurstIndex}]`,
          "duplicate_pending_burst_check_resolved_source_instance_id",
          resolvedBurstCardInstanceId
        );
      }

      seenResolvedBurstCardInstanceIds.add(resolvedBurstCardInstanceId);

      if (!options.cardById.has(resolvedBurstCardInstanceId)) {
        appendMissingReferenceIssue(
          options.issues,
          `pendingBurstChecks[${index}].resolvedBurstCardInstanceIds[${resolvedBurstIndex}]`,
          "missing_pending_burst_check_resolved_source_instance",
          resolvedBurstCardInstanceId
        );
      }
    }
  }
}
