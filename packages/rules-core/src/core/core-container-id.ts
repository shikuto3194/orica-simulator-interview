import type { NormalCoreContainer } from "../model";

/** Shared identity for card and player-zone core containers. */
export function coreContainerId(container: NormalCoreContainer): string {
  return container.kind === "card"
    ? container.instanceId
    : `${container.kind}:${container.playerId}`;
}

/** Decode player-zone IDs; callers resolve observed card IDs before this codec. */
export function coreContainerFromId(id: string): NormalCoreContainer {
  const separator = id.indexOf(":");
  const kind = id.slice(0, separator);
  if (
    separator >= 0 &&
    (kind === "reserve" ||
      kind === "trash" ||
      kind === "life" ||
      kind === "void")
  ) {
    return { kind, playerId: id.slice(separator + 1) };
  }
  return { kind: "card", instanceId: id };
}
