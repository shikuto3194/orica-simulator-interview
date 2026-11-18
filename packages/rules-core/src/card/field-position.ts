import { replaceCardInstances } from "../zone/card-instance-state";
import type { CardInstance, GameState } from "../model";

/** 表示上の既定順（合体カードの優先等）の後に、効果が指定した隣接順を適用する。 */
export function applyFieldPositions(
  cards: readonly CardInstance[]
): CardInstance[] {
  const result = [...cards];
  for (const card of cards) {
    const position = card.fieldPosition;
    if (!position || position.anchorInstanceId === card.instanceId) continue;
    const anchor = result.find(
      (c) => c.instanceId === position.anchorInstanceId
    );
    if (!anchor || anchor.controllerPlayerId !== card.controllerPlayerId)
      continue;
    result.splice(result.indexOf(card), 1);
    result.splice(
      result.indexOf(anchor) + (position.side === "right" ? 1 : 0),
      0,
      card
    );
  }
  return result;
}

/** ゾーンは変更せず、同じフィールド内の位置を保存する。 */
export function placeFieldCardBeside(
  state: GameState,
  instanceId: string,
  anchorInstanceId: string,
  side: "left" | "right"
): GameState {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  const anchor = state.cardInstances.find(
    (c) => c.instanceId === anchorInstanceId
  );
  if (
    !card ||
    !anchor ||
    card === anchor ||
    card.zone !== "field" ||
    anchor.zone !== "field" ||
    card.controllerPlayerId !== anchor.controllerPlayerId
  )
    return state;
  return replaceCardInstances(
    {
      ...state,
      log: [
        ...state.log,
        `field-position:${instanceId}:${side}:${anchorInstanceId}`,
      ],
    },
    state.cardInstances.map((c) =>
      c.instanceId === instanceId
        ? { ...c, fieldPosition: { anchorInstanceId, side } }
        : c.fieldPosition?.anchorInstanceId === instanceId
          ? { ...c, fieldPosition: undefined }
          : c
    )
  );
}
