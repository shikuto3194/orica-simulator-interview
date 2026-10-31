import {
  createCardInstance,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
} from "@orica/rules-core";
import { buildFieldCardStateScenario } from "./scenario-field-card-state";

/** C04の手札使用と場使用を、実カードの支払い・解決まで通す。 */
export function buildSelfMagicReductionScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
) {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const field = params?.get("useFrom") === "field";
  const state = buildFieldCardStateScenario(
    allCards,
    new URLSearchParams({ owner, ...(field ? { flash: "1" } : {}) })
  );
  const add = (
    cardNo: string,
    id: string,
    zone: "hand" | "field",
    player = owner
  ) => {
    const definition = allCards.find((card) => card.cardNo === cardNo)!;
    state.cardInstances.push(
      createCardInstance(definition, {
        instanceId: id,
        ownerPlayerId: player,
        zone,
      })
    );
  };
  state.cardInstances = state.cardInstances.filter(
    (card) =>
      /^(alice|bob)-deck-/.test(card.instanceId) ||
      card.instanceId === "field-card-attacker"
  );
  add("BSAZ01-C04", "paying", field ? "field" : "hand");
  if (field) {
    add("BSAZ01-CX01", "inaho", "field");
    state.cardInstances = state.cardInstances.map((card) =>
      card.instanceId === "field-card-attacker"
        ? createCardInstance(
            allCards.find((definition) => definition.cardNo === "BSDB01-C01")!,
            {
              instanceId: card.instanceId,
              ownerPlayerId: owner,
              zone: "field",
              normalCoreCount: 1,
            }
          )
        : card
    );
    state.battleEntities[0]!.resolvedBp = 4000;
    state.battleEntities[0]!.resolvedSymbols = ["red"];
    add(
      "BSAZ01-C17",
      "target-nexus",
      "field",
      owner === "alice" ? "bob" : "alice"
    );
  } else {
    add("BSAZ01-C04", "other-copy", "field");
    add("BSDB01-C01", "payment-source", "field");
    state.cardInstances.find(
      (card) => card.instanceId === "payment-source"
    )!.normalCoreCount = 1;
  }
  for (const player of state.players) {
    player.handCount = state.cardInstances.filter(
      (c) => c.ownerPlayerId === player.id && c.zone === "hand"
    ).length;
    player.deckCount = state.cardInstances.filter(
      (c) => c.ownerPlayerId === player.id && c.zone === "deck"
    ).length;
    player.reserveNormalCoreCount = 8;
    player.reserveSoulCoreCount = 0;
    player.soulCoreLocation = null;
  }
  // 戦闘中フィクスチャも、初期盤面の常時使用許可を通常のリビルダで確定する。
  return {
    ...rebuildContinuousEffectsFromField(
      { ...state, activeAttack: null },
      (id) => allCards.find((card) => card.cardNo === id)
    ),
    activeAttack: state.activeAttack,
  };
}
