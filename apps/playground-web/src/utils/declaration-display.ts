import type { GameState } from "@orica/rules-core";

/** 応答窓が閉じても、対象選択・派生効果後の宣言確定までは参加体を保持する。 */
export function getDeclaringCardIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const declaration of [
    state.preDeclarationStackWindow,
    state.pendingPreDeclarationConfirmation,
  ]) {
    if (!declaration) continue;
    ids.add(declaration.sourceInstanceId);
    for (const id of declaration.additionalSourceInstanceIds ?? []) ids.add(id);
  }
  return new Set(
    state.cardInstances
      .filter(
        (card) =>
          ids.has(card.instanceId) &&
          card.zone === "field" &&
          card.exhaustState === "recovered"
      )
      .map((card) => card.instanceId)
  );
}
