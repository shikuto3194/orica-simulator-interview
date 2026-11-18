import type { GameState } from "../model";

export function getCoreMoveChangedCardIds(
  beforeState: GameState,
  afterState: GameState
): string[] {
  const afterById = new Map(
    afterState.cardInstances.map((c) => [c.instanceId, c])
  );
  return beforeState.cardInstances
    .filter((beforeCard) => {
      const afterCard = afterById.get(beforeCard.instanceId);
      return (
        afterCard !== undefined &&
        (beforeCard.normalCoreCount !== afterCard.normalCoreCount ||
          beforeCard.soulCoreCount !== afterCard.soulCoreCount)
      );
    })
    .map((card) => card.instanceId);
}

export function getCoreMoveChangedCoreAmount(
  beforeState: GameState,
  afterState: GameState
): number {
  const afterPlayers = new Map(afterState.players.map((p) => [p.id, p]));
  let gained = 0;
  let lost = 0;
  const recordDelta = (before: number, after: number): void => {
    gained += Math.max(0, after - before);
    lost += Math.max(0, before - after);
  };
  for (const beforePlayer of beforeState.players) {
    const afterPlayer = afterPlayers.get(beforePlayer.id);
    if (!afterPlayer) continue;
    recordDelta(
      beforePlayer.reserveNormalCoreCount,
      afterPlayer.reserveNormalCoreCount
    );
    recordDelta(
      beforePlayer.reserveSoulCoreCount,
      afterPlayer.reserveSoulCoreCount
    );
    recordDelta(
      beforePlayer.voidNormalCoreCount,
      afterPlayer.voidNormalCoreCount
    );
    recordDelta(
      beforePlayer.lifeNormalCoreCount,
      afterPlayer.lifeNormalCoreCount
    );
    recordDelta(beforePlayer.lifeSoulCoreCount, afterPlayer.lifeSoulCoreCount);
    recordDelta(
      beforePlayer.trashNormalCoreCount,
      afterPlayer.trashNormalCoreCount
    );
    recordDelta(
      beforePlayer.trashSoulCoreCount,
      afterPlayer.trashSoulCoreCount
    );
  }
  const afterCards = new Map(
    afterState.cardInstances.map((c) => [c.instanceId, c])
  );
  for (const beforeCard of beforeState.cardInstances) {
    const afterCard = afterCards.get(beforeCard.instanceId);
    if (!afterCard) continue;
    recordDelta(beforeCard.normalCoreCount, afterCard.normalCoreCount);
    recordDelta(beforeCard.soulCoreCount, afterCard.soulCoreCount);
  }
  // ゲーム外への除外/ゲーム外からの追加は片側だけに個数が記録される。
  // 差分を2で割ると、ソウルコア1個の除外が0個になってしまう。
  return Math.max(gained, lost);
}
