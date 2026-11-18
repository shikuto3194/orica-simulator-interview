import {
  coreLocationDisplayLabel,
  type PendingCoreDistribution,
  type GameState,
} from "@orica/rules-core";

/** 単一/複数ソースを同じゾーン名の正源から表示する。ボイド/ゲーム外は共有領域。 */
export function coreDistributionRouteLabel(
  pending: PendingCoreDistribution,
  viewingPlayer: string,
  state: Pick<GameState, "cardInstances">
): string {
  const area = (kind: string, playerId: string) =>
    (kind === "void" || kind === "outside_game"
      ? ""
      : playerId === viewingPlayer
        ? "自分の"
        : "相手の") + coreLocationDisplayLabel(kind);
  const source =
    pending.fromKind === "any_movable"
      ? [
          ...new Set(
            (pending.allowedSources ?? []).map((s) =>
              area(s.kind, pending.fromPlayerId)
            )
          ),
        ].join("・") || "移動可能な場所"
      : area(pending.fromKind, pending.fromPlayerId);
  const destinationPlayers = new Set(
    pending.candidates.map(
      (candidate) =>
        state.cardInstances.find(
          (card) => card.instanceId === candidate.instanceId
        )?.controllerPlayerId ?? pending.toPlayerId
    )
  );
  const destination = [...destinationPlayers]
    .map((player) => area("field", player))
    .join("・");
  return `${source}→${destination || area("field", pending.toPlayerId)}`;
}

/** 通常/ソウルは交換可能な選択肢なので、物理個数と本文の合計上限の小さい方を表示。 */
export function coreDistributionAvailableTotal(
  pending: PendingCoreDistribution
): number {
  return Math.min(
    pending.maxTotal ?? Infinity,
    pending.totalNormalCores +
      (pending.totalSoulCores ?? (pending.hasSoulCore ? 1 : 0))
  );
}
