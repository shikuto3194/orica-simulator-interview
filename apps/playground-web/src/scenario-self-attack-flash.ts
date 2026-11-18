import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 自分の別個体がアタック中でも、本人限定フラッシュを選べないことを確認する盤面。 */
export function buildSelfAttackFlashScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const defs = expandCardDefinitionsWithBackFaces(allCards);
  const cardNo = params?.get("card") ?? "BSGE01-TX01(B)";
  const source = defs.find((d) => d.cardNo === cardNo);
  if (!source)
    throw new Error(`Self attack flash scenario: unknown card ${cardNo}`);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const role = params?.get("role") ?? "idle";
  const blocking = role === "blocking";
  const attacking = role === "attacking";
  const brave = source.printedCategory === "brave";
  const host = brave
    ? defs.find(
        (d) =>
          d.cardNo ===
          (cardNo === "BSTH05.5-M01"
            ? "BSTH05.5-X01"
            : cardNo === "BSGE01-TX02(B)"
              ? "BSGE01-CX02"
              : "BSGE01-CX01")
      )!
    : source;
  const other = defs.find((d) => d.cardNo === "BSGE01-R01")!;
  const companionName = cardNo === "BSSG01-M04" ? "暁 切歌" : "月読 調";
  const companion = cardNo.startsWith("BSSG01-")
    ? defs.find((d) => d.name === companionName)
    : undefined;
  const nexus = defs.find(
    (d) => d.printedCategory === "nexus" && !d.grandwalkerData
  )!;
  const grandwalker = defs.find((d) => d.grandwalkerData)!;
  const attackingId = blocking
    ? "self-flash-enemy"
    : attacking
      ? "self-flash-host"
      : "self-flash-other";
  const blockingId = blocking ? "self-flash-host" : "self-flash-enemy";
  const entityId = (id: string) => `battle:${id}`;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { countValue: 3, reserveNormalCoreCount: 6 },
      { countValue: 3, reserveNormalCoreCount: 6 },
    ],
    cardInstances: [
      createCardInstance(host, {
        instanceId: "self-flash-host",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: Math.max(
          ...host.levelDefs.map((l) => l.requiredCores)
        ),
        exhaustState: "exhausted",
        attachedChildrenIds: brave ? ["self-flash-brave"] : [],
      }),
      ...(brave
        ? [
            createCardInstance(source, {
              instanceId: "self-flash-brave",
              ownerPlayerId: owner,
              zone: "field",
              attachedToInstanceId: "self-flash-host",
            }),
          ]
        : []),
      createCardInstance(other, {
        instanceId: "self-flash-other",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 2,
        exhaustState: "exhausted",
      }),
      createCardInstance(other, {
        instanceId: "self-flash-enemy",
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 2,
        exhaustState: "exhausted",
      }),
      createCardInstance(nexus, {
        instanceId: "self-flash-nexus",
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 3,
      }),
      createCardInstance(grandwalker, {
        instanceId: "self-flash-grandwalker",
        ownerPlayerId: opponent,
        zone: "field",
        normalCoreCount: 3,
      }),
      ...(companion
        ? [
            createCardInstance(companion, {
              instanceId: "self-flash-companion",
              ownerPlayerId: owner,
              zone: "field",
              normalCoreCount: 2,
            }),
          ]
        : []),
    ],
  });
  const combinedSource = state.cardInstances.find(
    (card) => card.instanceId === "self-flash-brave"
  );
  if (combinedSource)
    combinedSource.originalDefinitionId = source.cardNo.replace("(B)", "(A)");
  const window =
    params?.get("window") === "before"
      ? "flash_before_block"
      : "flash_after_block";
  return {
    ...state,
    turnNumber: 3,
    activePlayerId: blocking ? opponent : owner,
    step: "attack",
    window,
    battleEntities: [
      "self-flash-host",
      "self-flash-other",
      "self-flash-enemy",
    ].map((id) => ({
      entityId: entityId(id),
      memberInstanceIds:
        id === "self-flash-host" && brave ? [id, "self-flash-brave"] : [id],
      attackState:
        id === attackingId
          ? "attacking"
          : id === blockingId && window === "flash_after_block"
            ? "blocking"
            : "idle",
      resolvedBp: id === "self-flash-host" ? 20000 : 5000,
      resolvedSymbols: ["red"],
    })),
    activeAttack: {
      attackId: "attack:self-flash",
      primaryEntityId: entityId(attackingId),
      participantEntityIds: [entityId(attackingId)],
      groupMode: "single",
      target: { kind: "player", playerId: blocking ? owner : opponent },
      blockAssignments: [
        {
          participantEntityId: entityId(attackingId),
          blockedByEntityIds:
            window === "flash_after_block" ? [entityId(blockingId)] : [],
        },
      ],
      symbolResolutionOrder: [entityId(attackingId)],
      flashBeforeBlockCompleted: window === "flash_after_block",
      flashAfterBlockCompleted: false,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
      flashWindowState: {
        kind: window === "flash_after_block" ? "after_block" : "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
    },
  };
}
