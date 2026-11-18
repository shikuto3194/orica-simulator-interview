import { replaceCardInstances } from "../zone/card-instance-state";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import type { CardDefinition, GameState } from "../model";
import { collectUnderCardScopeIds } from "../model";

/**
 * 魂状態・煌臨元からの召喚は、内部zoneがfieldのままでも以前の事象を観測しない。
 * 実離脱ではないため、fieldInstanceGeneration が持つ既存の使用会計は維持する。
 * 召喚準備のstateに適用し、選択取消時は呼出側のpriorStateSnapshotへ戻す。
 * 同一操作の記録を繰り返してもbeforeの世代+1までしか進めない。
 */
export function advanceSummonedTriggerPresenceGeneration(
  before: GameState,
  after: GameState,
  instanceId: string
): GameState {
  const previous = before.cardInstances.find(
    (card) => card.instanceId === instanceId
  );
  const current = after.cardInstances.find(
    (card) => card.instanceId === instanceId
  );
  if (previous?.zone !== "field" || current?.zone !== "field") return after;
  const wasSoul = before.players.some((player) =>
    player.soulStateInstanceIds.includes(instanceId)
  );
  const wasAdventSource =
    collectUnderCardScopeIds(before).adventSource.has(instanceId);
  if (!wasSoul && !wasAdventSource) return after;
  if (
    after.players.some((player) =>
      player.soulStateInstanceIds.includes(instanceId)
    ) ||
    collectUnderCardScopeIds(after).adventSource.has(instanceId)
  )
    return after;
  const generation = (previous.triggerPresenceGeneration ?? 0) + 1;
  if ((current.triggerPresenceGeneration ?? 0) >= generation) return after;
  return replaceCardInstances(
    after,
    after.cardInstances.map((card) =>
      card.instanceId === instanceId
        ? { ...card, triggerPresenceGeneration: generation }
        : card
    )
  );
}

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
        ? {
            ...card,
            soulStateGeneration: (card.soulStateGeneration ?? 0) + 1,
            // Q31576旧snapshot互換: 場/魂世代がunknownの待機にも失効を残す。
            // 先行する回復更新が既に進めていれば二重には進めない。
            exhaustTriggerGeneration: Math.max(
              card.exhaustTriggerGeneration ?? 0,
              (before.cardInstances.find(
                (previous) => previous.instanceId === card.instanceId
              )?.exhaustTriggerGeneration ?? 0) + 1
            ),
          }
        : card
    )
  );
}
