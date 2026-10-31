import { replaceCardInstances } from "../zone/card-instance-state";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import type { CardDefinition, GameState } from "../model";

/** 実離脱時だけ個体の世代を進める。魂状態化・合体などフィールド内の変化では維持する。 */
export function advanceDepartedFieldInstanceGeneration(
  before: GameState,
  after: GameState
): GameState {
  const beforeCards = new Map(
    before.cardInstances.map((c) => [c.instanceId, c])
  );
  const remainingFieldIds = new Set(
    after.cardInstances
      .filter((c) => c.zone === "field")
      .map((c) => c.instanceId)
  );
  let changed = false;
  const cardInstances = after.cardInstances.map((card) => {
    if (
      card.fieldPosition &&
      (card.zone !== "field" ||
        !remainingFieldIds.has(card.fieldPosition.anchorInstanceId))
    ) {
      card = { ...card, fieldPosition: undefined };
      changed = true;
    }
    const previous = beforeCards.get(card.instanceId);
    if (previous?.zone !== "field" || card.zone === "field") return card;
    changed = true;
    return {
      ...card,
      fieldInstanceGeneration: (previous.fieldInstanceGeneration ?? 0) + 1,
    };
  });
  return changed ? replaceCardInstances({ ...after }, cardInstances) : after;
}

/** 魂状態になったカードだけ世代を進める。実離脱の世代と分け、魂状態を含む効果は継続させる。 */
export function advanceSoulStateGeneration(
  before: GameState,
  after: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const getIds = (state: GameState) =>
    getCardDefinitionById
      ? getEffectiveSoulStateIds(state, getCardDefinitionById)
      : new Set(state.players.flatMap((p) => p.soulStateInstanceIds));
  const beforeIds = getIds(before);
  const afterIds = getIds(after);
  const enteredIds = new Set([...afterIds].filter((id) => !beforeIds.has(id)));
  if (enteredIds.size === 0) return after;
  return replaceCardInstances(
    {
      ...after,
    },
    after.cardInstances.map((card) =>
      enteredIds.has(card.instanceId)
        ? { ...card, soulStateGeneration: (card.soulStateGeneration ?? 0) + 1 }
        : card
    )
  );
}
