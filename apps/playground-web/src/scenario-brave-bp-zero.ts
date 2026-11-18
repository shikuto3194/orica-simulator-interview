import { recordSemanticTriggerEvent } from "../../../packages/rules-core/src/effect/semantic-trigger-events";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  rebuildContinuousEffectsFromField,
  getCombinedUnitBp,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { buildBattleImmediateEffectLookup } from "../../../packages/rules-core/src/effect/structured-effect-registrations";
import { queueRegisteredBattleImmediateEffects } from "../../../packages/rules-core/src/battle/battle-immediate-effect-system";

import { collectAndQueueTriggerReactions } from "../../../packages/rules-core/src/effect/trigger-system";

/** モルター+モウスィブロウのBP-80000を、合体3体と非合体1体へ分配する再現盤面。 */
export function buildBraveBpZeroScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const defs = expandCardDefinitionsWithBackFaces(allCards);
  const getDef = (id: string) => defs.find((d) => d.cardNo === id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const rebornTargets = params?.get("targets") === "reborn";
  const make = (
    cardNo: string,
    instanceId: string,
    player: string,
    cores: number
  ) =>
    createCardInstance(getDef(cardNo)!, {
      instanceId,
      ownerPlayerId: player,
      zone: "field",
      normalCoreCount: cores,
    });
  const host = make("BSGE01-CX01", "bp-source", owner, 2);
  host.attachedChildrenIds = ["bp-source-brave"];
  host.exhaustState = "exhausted";
  host.underCards = [
    {
      cardInstanceId: "bp-mortar",
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  const sourceBrave = {
    ...make("BSGE01-C08", "bp-source-brave", owner, 0),
    attachedToInstanceId: host.instanceId,
  };
  const mortar = {
    ...make("BSGE01-R04", "bp-mortar", owner, 0),
    attachedToInstanceId: host.instanceId,
    zoneRoleName: "bullet-edit",
  };
  const targetSpecs = [
    ["BSSA01-X02", "bp-alice-gold", 1, "BSSA01-転醒X04(B)"],
    ["BSSA01-X02", "bp-alice-night", 2, "BSSA01-転醒X01(B)"],
    [
      rebornTargets ? "BSSA01-転醒X03(B)" : "BSSA01-転醒X03(A)",
      "bp-eugeo",
      rebornTargets ? 3 : 2,
      rebornTargets ? null : "BSSA01-転醒X02(A)",
    ],
    [
      rebornTargets ? "BSSA01-転醒X03(B)" : "BSSA01-X01",
      "bp-kirito",
      rebornTargets ? 3 : 2,
      null,
    ],
  ] as const;
  const targets = targetSpecs.flatMap(([cardNo, id, cores, braveNo]) => {
    const target = make(cardNo, id, opponent, cores);
    if (cardNo.endsWith("(B)"))
      target.originalDefinitionId = cardNo.replace("(B)", "(A)");
    if (!braveNo) return [target];
    const brave = {
      ...make(braveNo, id + "-brave", opponent, 0),
      attachedToInstanceId: id,
    };
    // 転醒後の面を初期配置する。離脱後のA面復帰用の原カードを保持する。
    if (braveNo.endsWith("(B)"))
      brave.originalDefinitionId = braveNo.replace("(B)", "(A)");
    target.attachedChildrenIds = [brave.instanceId];
    return [target, brave];
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [host, sourceBrave, mortar, ...targets],
    playerOverrides: ["alice", "bob"].map((id) => ({
      countValue: id === owner ? 9 : 4,
      reserveNormalCoreCount: 4,
    })),
  });
  const entityId = "battle:bp-source";
  if (rebornTargets) {
    // 添付snapshotと同じ、転醒前からBP-20000を引き継いだLv2のB面。
    base.activeContinuousEffects.push({
      effectId: "bp-before-rebirth",
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: host.definitionId,
      actingPlayerId: owner,
      targetInstanceId: "bp-kirito",
      modifierTag: "bp_modifier",
      modifierAmount: -20000,
      duration: { scope: "turn" },
      createdAtTurn: 9,
      createdAtAttackId: null,
    });
  }
  const state: GameState = {
    ...rebuildContinuousEffectsFromField(
      {
        ...base,
        turnNumber: 9,
        activePlayerId: owner,
        step: "attack",
        window: "declare_attack",
      },
      getDef
    ),
    battleEntities: [
      {
        entityId,
        memberInstanceIds: [host.instanceId, sourceBrave.instanceId],
        attackState: "attacking",
        resolvedBp: getCombinedUnitBp(
          base,
          host,
          getDef(host.definitionId),
          getDef
        ),
        resolvedSymbols: ["red", "yellow"],
      },
    ],
    activeAttack: {
      attackId: "attack:bp-zero",
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
      flashWindowState: null,
    },
  };
  if (params?.get("event") === "contract") {
    // The fixture explicitly supplies the contract-combine operation fact.
    return collectAndQueueTriggerReactions({
      beforeState: {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === host.instanceId
            ? { ...c, attachedChildrenIds: [] }
            : c.instanceId === sourceBrave.instanceId
              ? { ...c, zone: "hand", attachedToInstanceId: null }
              : c
        ),
      },
      afterState: recordSemanticTriggerEvent(state, {
        eventKind: "brave_combined",
        relatedInstanceId: sourceBrave.instanceId,
        triggerRelatedCombinedHostInstanceId: host.instanceId,
        cause: "contract_combine",
      }),
      source: "action_resolution",
      chainId: "scenario:contract-combine",
      causedByPlayerId: owner,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: undefined,
    });
  }
  return queueRegisteredBattleImmediateEffects({
    state,
    attackId: "attack:bp-zero",
    participantEntityId: entityId,
    actingPlayerId: owner,
    sourceCard: host,
    sourceDefinition: getDef(host.definitionId)!,
    timing: "attack",
    getCardDefinitionById: getDef,
    getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup(
      [getDef("BSGE01-C08")!]
    ),
  });
}
