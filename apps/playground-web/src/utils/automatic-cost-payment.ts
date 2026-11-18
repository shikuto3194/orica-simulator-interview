import {
  getAutomaticNormalCorePaymentSources,
  isNormalCoreMovePrevented,
  type GameState,
} from "@orica/rules-core";

/** HUD候補をエンジンの自動支払い判定へ渡す。候補外のコアは数えない。 */
export function getAutomaticCostPaymentSources(
  state: GameState,
  playerId: string,
  amount: number,
  reserveAvailable: number,
  fieldSources: readonly {
    instanceId: string;
    maxAmount: number;
    soulCoreOnly: boolean;
    destination?: "trash" | "void";
  }[]
) {
  const player = state.players.find((p) => p.id === playerId);
  return getAutomaticNormalCorePaymentSources(amount, [
    {
      sourceId: "reserve",
      available: reserveAvailable,
      hasSoulCore: reserveAvailable > (player?.reserveNormalCoreCount ?? 0),
    },
    ...fieldSources.map((source) => ({
      sourceId: source.instanceId,
      available: source.maxAmount,
      hasSoulCore:
        source.soulCoreOnly ||
        source.maxAmount >
          (isNormalCoreMovePrevented(state, source.instanceId)
            ? 0
            : (state.cardInstances.find(
                (card) => card.instanceId === source.instanceId
              )?.normalCoreCount ?? 0)),
      ...(source.destination ? { destination: source.destination } : {}),
    })),
  ]);
}
