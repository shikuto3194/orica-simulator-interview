import {
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 保存盤面のユージオ＋青薔薇の剣を重疲労にして通常回復を再現する。 */
export function buildRecoveryDegreeScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definition = (id: string) => cards.find((card) => card.cardNo === id)!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definition("BSSA01-転醒X03(A)"), {
        instanceId: "recovery-host",
        ownerPlayerId: owner,
        zone: "field",
        cores: 4,
        exhaustState: "heavily_exhausted",
        attachedChildrenIds: ["recovery-brave"],
      }),
      createCardInstance(definition("BSSA01-転醒X02(A)"), {
        instanceId: "recovery-brave",
        ownerPlayerId: owner,
        zone: "field",
        exhaustState: "heavily_exhausted",
        attachedToInstanceId: "recovery-host",
      }),
      createCardInstance(definition("BSTH01-C01"), {
        instanceId: "recovery-attacker",
        ownerPlayerId: opponent,
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
    ],
  });
  state.step = "attack";
  state.window = "flash_before_block";
  state.turnNumber = 7;
  state.activePlayerId = opponent;
  state.battleEntities = [
    {
      entityId: "battle-entity:recovery-attacker",
      memberInstanceIds: ["recovery-attacker"],
      resolvedBp: 1000,
      resolvedSymbols: ["red"],
      attackState: "attacking",
    },
  ];
  state.activeAttack = createActiveAttack(
    state,
    "battle-entity:recovery-attacker",
    owner
  );
  state.activeAttack.flashWindowState = {
    kind: "before_block",
    priorityPlayerId: owner,
    consecutivePassCount: 0,
    stackResponseSourcePlayerId: owner,
    pendingStackAction: null,
  };
  return state;
}
