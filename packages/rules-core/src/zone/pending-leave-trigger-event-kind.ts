import type { CardInstance, GameState, TriggerEventKind } from "../model";

export function pendingLeaveKindToTriggerEventKind(
  kind: GameState["pendingLeaveEntities"][number]["kind"]
): TriggerEventKind | null {
  switch (kind) {
    case "destroy":
    case "vanish":
    case "bounce":
    case "remove_from_game":
      return kind;
    case "rule_cleanup":
      return null;
  }
}

/** Q2404/Q31800: 離脱待機中は、自身の現在の待機状態に関係する誘発だけ発揮できる。 */
export function canTriggerFromPendingLeaveSource(
  state: GameState,
  source: CardInstance,
  event: {
    eventKind: string;
    relatedInstanceId: string | null;
    relatedInstanceIds?: readonly string[];
  }
): boolean {
  if (source.zone !== "field") return true;
  const pending = state.pendingLeaveEntities.find(
    (leave) =>
      leave.instanceId === source.instanceId && !leave.blockedByResistance
  );
  const kind = source.pendingLeaveKind ?? pending?.kind;
  if (kind == null) return true;
  const leaveEventKind = pendingLeaveKindToTriggerEventKind(kind);
  return (
    leaveEventKind !== null &&
    (event.eventKind === leaveEventKind || event.eventKind === "leave_field") &&
    (event.relatedInstanceId === source.instanceId ||
      event.relatedInstanceIds?.includes(source.instanceId) === true)
  );
}
