import type { GameState, PendingLeaveKind } from "../model";

/** 結果の成立と物理移動を分離する（独自Q&A qa016/qa017、公式Q26421）。 */
export function collectEstablishedLeaveOutcomes(
  before: GameState,
  after: GameState
): Record<string, PendingLeaveKind> {
  const previous = new Map(
    before.pendingLeaveEntities
      .filter((p) => !p.blockedByResistance || p.outcomeEstablished === true)
      .map((p) => [p.instanceId, p])
  );
  const outcomes: Record<string, PendingLeaveKind> = {};
  for (const pending of after.pendingLeaveEntities) {
    if (pending.blockedByResistance && pending.outcomeEstablished !== true)
      continue;
    const prior = previous.get(pending.instanceId);
    // 待機中の同じ事実は再加算しない。「離れない」対象への新たな直接処理は
    // 新しい成立マーカーを作るため、同種でも今回の結果として記録する。
    if (
      prior?.kind === pending.kind &&
      (!pending.blockedByResistance || prior === pending)
    )
      continue;
    outcomes[pending.instanceId] = pending.kind;
  }
  return outcomes;
}
