import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 実カードの合体操作とシンボル表示・軽減を同じ盤面で確認する。 */
export function buildCombinedSymbolsScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const kind = params?.get("kind") ?? "spirit";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const [hostNo, braveNo] =
    kind === "nexus"
      ? ["BSTH003-X01", "BSTH003-C31"]
      : kind === "ultimate"
        ? ["BSAZ02-C01", "BSAZ02-C12"]
        : ["BSTH01-X04", "BSTH01-X09"];
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const make = (no: string, id: string, cores: number) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone: "field",
      normalCoreCount: cores,
    });
  const host = make(hostNo!, "symbol-host", kind === "nexus" ? 2 : 1);
  const brave = make(braveNo!, "symbol-brave", 1);
  if (params?.get("combined") === "1") {
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    brave.normalCoreCount = 0;
  }
  const state = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: owner,
      turnNumber: 3,
      step: "main",
    },
    lookup
  );
  if (params?.has("token")) {
    const token = make(hostNo!, "symbol-token", 1);
    token.faceDown = true;
    if (params.get("token") === "hidden") token.definitionId = "_hidden_card_";
    state.cardInstances.push(token);
    state.activeContinuousEffects.push({
      effectId: "combined-symbol-token",
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: host.definitionId,
      actingPlayerId: owner,
      targetInstanceId: token.instanceId,
      modifierTag: "act_as_spirit",
      duration: { scope: "while_on_field" },
      createdAtTurn: 3,
      createdAtAttackId: null,
      metadata: {
        statBlueprint: {
          kind: "live_copy_from",
          sourceInstanceId: host.instanceId,
          aspects: ["symbolColors"],
        },
        overrides: {},
      },
    });
  }
  return state;
}
