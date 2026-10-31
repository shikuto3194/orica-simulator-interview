import { ALL_CARDS } from "../../../../packages/card-data/src";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../../../../packages/rules-core/src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
export const getCloneDefinition = (id: string) => definitions.get(id);
export const getCloneTriggeredEffects = buildTriggeredEffectLookup(ALL_CARDS);

export const cloneEffects = ALL_CARDS.flatMap((definition) =>
  (definition.effects ?? []).flatMap((effect, effectIndex) =>
    effect.steps.some((step) => step.action.kind === "register_act_as_spirit")
      ? [{ definition, effect, effectIndex }]
      : []
  )
);

/** 実カードの効果を実行し、配分待ち（自動配置なら生成済み）の盤面を作る。 */
export function createClonePlacement(cardNo: string, owner = "alice") {
  const entry = cloneEffects.find((e) => e.definition.cardNo === cardNo)!;
  const host = createCardInstance(entry.definition, {
    instanceId: "clone-host",
    ownerPlayerId: owner,
    zone: entry.definition.printedCategory === "magic" ? "in_use" : "field",
    cores: entry.definition.printedCategory === "magic" ? 0 : 3,
  });
  const drive = createCardInstance(definitions.get("BSAZ02-C10")!, {
    instanceId: "clone-drive",
    ownerPlayerId: owner,
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  const slot = entry.definition.underCardSlots?.[0];
  if (slot) {
    host.underCards = [
      {
        cardInstanceId: drive.instanceId,
        role: "text_role",
        roleTag: slot.roleTag,
      },
    ];
  }
  const deck = ["BSTH01-X09", "BSTH01-C12", "BSAZ01-C12"].map((id, i) =>
    createCardInstance(definitions.get(id)!, {
      instanceId: `clone-deck-${i}`,
      ownerPlayerId: owner,
      zone: "deck",
    })
  );
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    activePlayerId: owner,
    cardInstances: [host, ...(slot ? [drive] : []), ...deck],
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 6,
      reserveSoulCoreCount: 0,
      soulCoreLocation: { kind: "trash" as const },
      trashSoulCoreCount: 1,
      deckCount: id === owner ? deck.length : 0,
    })),
  });
  state = executeEffect({
    chainId: `test:clone-placement:${cardNo}`,
    state,
    sourceInstanceId: host.instanceId,
    actingPlayerId: owner,
    effect: entry.effect,
    effectIndex: entry.effectIndex,
    getCardDefinitionById: getCloneDefinition,
    getRegisteredTriggeredEffectActions: getCloneTriggeredEffects,
  });
  if (state.pendingCountSelection) {
    const action = getLegalActions({
      state,
      actingPlayerId: owner,
      getCardDefinitionById: getCloneDefinition,
    }).find((a) => a.kind === "resolve_pending_count_decrease")!;
    state = applyLegalAction({
      state,
      action,
      countDecreaseSelection: state.pendingCountSelection.max,
      getCardDefinitionById: getCloneDefinition,
      getRegisteredTriggeredEffectActions: getCloneTriggeredEffects,
    }).state;
  }
  return state;
}
