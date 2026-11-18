import type { PendingTriggeredEffect } from "../model";

type PriorityCarrier = {
  activationPriority?: PendingTriggeredEffect["activationPriority"];
  dormantMechanic?: boolean | undefined;
};

/** Observation identity stays unchanged when qualification creates a child. */
export function getTriggerObservationId(
  pending: Pick<PendingTriggeredEffect, "pendingId" | "activationPriority">
): string {
  return pending.activationPriority?.originalPendingId ?? pending.pendingId;
}
export function getTriggerResolutionGroupId(
  pending: PriorityCarrier & { simultaneousGroupId?: string | undefined }
): string | undefined {
  return pending.dormantMechanic !== true && pending.activationPriority
    ? pending.activationPriority.simultaneousGroupId
    : pending.simultaneousGroupId;
}
export function getTriggerResolutionChainId(
  pending: PriorityCarrier & { chainId: string }
): string;
export function getTriggerResolutionChainId(
  pending: PriorityCarrier & { chainId: string | null }
): string | null;
export function getTriggerResolutionChainId(
  pending: PriorityCarrier & { chainId: string | null }
): string | null {
  // Insufficient resources must not block completion or outer peers.
  return pending.dormantMechanic !== true && pending.activationPriority
    ? pending.activationPriority.causedByChainId
    : pending.chainId;
}
