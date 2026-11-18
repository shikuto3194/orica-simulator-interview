import { replaceCardInstances } from "../zone/card-instance-state";
import { isCombinedBrave } from "./virtual-combine";
import type { CardDefinition, CardInstance, GameState } from "../model";

/** 合体中の疲労状態はホストが正源。異魔神・単独時の疲労禁止もここで正規化する。 */
export function synchronizeBraveExhaustion(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (!getCardDefinitionById) return state;
  const cardsById = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  let changed = false;
  const cardInstances = state.cardInstances.map((card) => {
    if (card.zone !== "field") return card;
    const definition = getCardDefinitionById(card.definitionId);
    if (definition?.printedCategory !== "brave") return card;
    const host = card.attachedToInstanceId
      ? cardsById.get(card.attachedToInstanceId)
      : undefined;
    const forbidden = isCardExhaustionForbidden(card, definition);
    if (
      !forbidden &&
      (!isCombinedBrave(state, card, definition) || host?.zone !== "field")
    )
      return card;
    const exhaustState = forbidden ? "recovered" : host!.exhaustState;
    const exhaustedByUnpreventableEffect =
      exhaustState === "recovered"
        ? false
        : (host!.exhaustedByUnpreventableEffect ?? false);
    if (
      card.exhaustState === exhaustState &&
      (card.exhaustedByUnpreventableEffect ?? false) ===
        exhaustedByUnpreventableEffect
    )
      return card;
    changed = true;
    return { ...card, exhaustState, exhaustedByUnpreventableEffect };
  });
  return changed ? replaceCardInstances({ ...state }, cardInstances) : state;
}

/** ルール強度のスピリット状態ブレイヴは、効果の防止レベルにかかわらず疲労しない。 */
export function isCardExhaustionForbidden(
  card: CardInstance,
  definition: CardDefinition | undefined
): boolean {
  return (
    card.zone === "field" &&
    definition?.printedCategory === "brave" &&
    (definition.imaginBraveData !== undefined ||
      (card.attachedToInstanceId == null &&
        hasOpeningSpiritStateCannotExhaustText(definition)))
  );
}

export function hasOpeningSpiritStateCannotExhaustText(
  definition: CardDefinition | undefined
): boolean {
  if (!definition || definition.printedCategory !== "brave") return false;
  const openingLines = (definition.textLines ?? [])
    .map((line) => line.replace(/\s/g, ""))
    .filter((line) => line.length > 0)
    .slice(0, 3);
  const firstLine = openingLines.find(
    (line) =>
      line.includes("スピリット状態のこのブレイヴは") ||
      line.includes("このブレイヴは疲労せず、スピリット状態のとき")
  );
  if (!firstLine) return false;
  return (
    (firstLine.includes("疲労せず") || firstLine.includes("疲労しない")) &&
    firstLine.includes("アタック/ブロックでき")
  );
}

export function shouldRecoverSpiritStateBraveExhaustion(
  _brave: CardInstance,
  definition: CardDefinition | undefined
): boolean {
  return hasOpeningSpiritStateCannotExhaustText(definition);
}

export function resolveSeparatedBraveExhaustState(
  brave: CardInstance,
  definition: CardDefinition | undefined,
  hostBeforeSeparation?: CardInstance | undefined
): CardInstance["exhaustState"] {
  return isCardExhaustionForbidden(brave, definition) ||
    shouldRecoverSpiritStateBraveExhaustion(brave, definition)
    ? "recovered"
    : (hostBeforeSeparation?.exhaustState ?? brave.exhaustState);
}
