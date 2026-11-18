import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildFlashEffectCategoryScenario } from "./scenario-flash-effect-category";

/** 実在カードの宣言と窓後解決から HUD pending を作る（owner=bob で対称検証）。 */
export function buildCoreHudAuditScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const kind = params?.get("kind") ?? "link";
  const definitions = new Map(allCards.map((d) => [d.cardNo, d]));
  const def = (no: string) => definitions.get(no)!;
  const card = (
    no: string,
    id: string,
    zone: "hand" | "field" | "deck",
    cores = 0,
    player = owner
  ) =>
    createCardInstance(def(no), {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      cores,
    });
  if (
    kind === "pre-cost-token" ||
    kind === "pre-cost-token-api" ||
    kind === "deck-placement" ||
    kind === "deck-cost"
  ) {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances:
          kind === "pre-cost-token-api"
            ? [
                card("BSES01-C02", "hud-brave", "hand"),
                card("BSES01-CX01", "hud-nexus", "field", 2),
              ]
            : kind === "pre-cost-token"
              ? [card("BSES01-R03", "hud-brave", "hand")]
              : kind === "deck-cost"
                ? [
                    card("BSTH08.5-C23", "hud-source", "hand"),
                    ...[1, 2, 3].map((n) =>
                      card("BSTH08.5-C23", "hud-paid-" + n, "deck")
                    ),
                    card("BSTH01-C22", "hud-filler", "deck"),
                    card("BSTH01-C22", "hud-remainder", "deck"),
                  ]
                : [
                    card("BSKB01-M01", "hud-source", "field", 1),
                    card("BSKB01-C02", "hud-entrant", "deck"),
                    card("BSTH01-C22", "hud-filler", "deck"),
                    card("BSTH01-C22", "hud-remainder", "deck"),
                  ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          reserveNormalCoreCount:
            id === owner ? (kind === "pre-cost-token-api" ? 3 : 8) : 0,
          reserveSoulCoreCount: id === owner ? 1 : 0,
          soulCoreLocation: id === owner ? { kind: "reserve" as const } : null,
          trashNormalCoreCount: id === owner ? 1 : 0,
        })),
      }),
      step: "main",
      activePlayerId: owner,
      turnNumber: 3,
    };
    if (kind === "pre-cost-token" || kind === "pre-cost-token-api")
      return state;
    const lookups = {
      getRegisteredFieldCardEffectActions: () => [],
      getCardDefinitionById: (id: string) => definitions.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    };
    if (kind === "deck-cost")
      return executeEffect({
        state,
        chainId: "scenario:deck-cost",
        sourceInstanceId: "hud-source",
        actingPlayerId: owner,
        effect: def("BSTH08.5-C23").accelData!.effects![0]!,
        effectIndex: 0,
        ...lookups,
      });
    state = executeEffect({
      state,
      chainId: "scenario:deck-placement",
      sourceInstanceId: "hud-source",
      actingPlayerId: owner,
      effect: def("BSKB01-M01").effects![0]!,
      effectIndex: 0,
      ...lookups,
    });
    for (const selectedDeckRevealCardIds of [["hud-entrant"], ["hud-filler"]]) {
      const action = getLegalActions({
        state,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      state = applyLegalAction({
        state,
        action,
        selectedDeckRevealCardIds,
        ...lookups,
        paymentSources: [
          { kind: "reserve", amount: 1, includeSoulCore: false },
        ],
      }).state;
    }
    return state;
  }
  if (kind === "gate") {
    let gateState = buildFlashEffectCategoryScenario(
      allCards,
      new URLSearchParams({ owner, gate: "core" })
    );
    gateState = {
      ...gateState,
      players: gateState.players.map((p) =>
        p.id === owner
          ? {
              ...p,
              reserveNormalCoreCount: params?.get("normal") === "0" ? 0 : 5,
              reserveSoulCoreCount: 1,
              soulCoreLocation: { kind: "reserve" as const },
            }
          : p
      ),
    };
    const options = {
      getCardDefinitionById: (id: string) => definitions.get(id),
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(allCards),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    };
    const use = getLegalActions({
      state: gateState,
      actingPlayerId: owner,
      ...options,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "category-summon"
    )!;
    gateState = applyLegalAction({
      state: gateState,
      action: use,
      ...options,
    }).state;
    const pass = getLegalActions({
      state: gateState,
      actingPlayerId: opponent,
      ...options,
    }).find((a) => a.kind === "pass_battle_flash")!;
    return applyLegalAction({ state: gateState, action: pass, ...options })
      .state;
  }
  if (kind === "repeat-payment") {
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSTH01-C22", "hud-magic", "hand"),
          card("BSAZ01-C01", "hud-target", "hand"),
          ...Array.from({ length: 6 }, (_, i) =>
            card("BSAZ01-C01", `hud-deck-${i}`, "deck")
          ),
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          id,
          reserveNormalCoreCount: id === owner ? 12 : 0,
          reserveSoulCoreCount: id === owner ? 1 : 0,
          soulCoreLocation: id === owner ? { kind: "reserve" as const } : null,
        })),
      }),
      step: "main",
      turnNumber: 3,
      activePlayerId: owner,
    };
  }
  if (
    [
      "mixed-free",
      "mixed-separate",
      "mixed-shoot",
      "mixed-cost",
      "mixed-distribute",
    ].includes(kind)
  ) {
    const source = params?.get("source") ?? "reserve";
    const sourceOwner = kind === "mixed-shoot" ? opponent : owner;
    const normal = params?.get("normal") === "0" ? 0 : 1;
    const target =
      kind === "mixed-cost"
        ? card("BSAZ01-C01", "hud-target", "hand")
        : card("BSTH01-X04", "hud-target", "field", 4);
    const brave = card("BSTH01-X09", "hud-brave", "field");
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        {
          ...target,
          ...(kind === "mixed-separate"
            ? { attachedChildrenIds: [brave.instanceId] }
            : {}),
        },
        ...(kind === "mixed-separate"
          ? [
              {
                ...brave,
                attachedToInstanceId: target.instanceId,
                zoneRoleName: "brave" as const,
              },
            ]
          : []),
        ...(source === "field"
          ? [
              {
                ...card(
                  "BSAZ01-C01",
                  "hud-source",
                  "field",
                  normal,
                  sourceOwner
                ),
                soulCoreCount: 1,
              },
            ]
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        reserveNormalCoreCount:
          id === sourceOwner
            ? kind === "mixed-cost"
              ? params?.get("normalBlocked") === "1"
                ? 2
                : 1
              : source === "reserve"
                ? normal
                : 0
            : 0,
        reserveSoulCoreCount:
          id === sourceOwner && source === "reserve" ? 1 : 0,
        soulCoreLocation:
          id !== sourceOwner
            ? null
            : source === "field"
              ? { kind: "card" as const, instanceId: "hud-source" }
              : { kind: "reserve" as const },
      })),
    });
    if (params?.get("normalBlocked") === "1" && source === "field")
      base.activeContinuousEffects.push({
        effectId: "hud-protect-normal",
        sourceInstanceId: "hud-source",
        sourceDefinitionId: "BSAZ01-C01",
        actingPlayerId: sourceOwner,
        targetInstanceId: "hud-source",
        modifierTag: "prevent_normal_core_move",
        duration: { scope: "turn" },
        createdAtTurn: 3,
        createdAtAttackId: null,
      });
    let mixed: GameState = {
      ...base,
      step: "main",
      turnNumber: 3,
      activePlayerId: owner,
      ...(kind === "mixed-distribute"
        ? {
            pendingCoreDistribution: {
              pendingId: "hud-mixed-distribute",
              actingPlayerId: owner,
              sourceInstanceId: target.instanceId,
              sourceDefinitionId: target.definitionId,
              candidates: [
                {
                  instanceId: target.instanceId,
                  definitionId: target.definitionId,
                },
              ],
              totalNormalCores: normal,
              hasSoulCore: true,
              totalSoulCores: 1,
              fromKind: "any_movable" as const,
              allowedSources:
                source === "field"
                  ? [{ kind: "field" as const, instanceId: "hud-source" }]
                  : [{ kind: "reserve" as const }],
              sourceAvailable: {
                [source === "field" ? "field:hud-source" : "reserve"]: normal,
              },
              soulSourceAvailable: {
                [source === "field" ? "field:hud-source" : "reserve"]: 1,
              },
              minTotal: 0,
              maxTotal: normal + 1,
              fromPlayerId: owner,
              toPlayerId: owner,
              effectTiming: { kind: "continuous" as const },
            },
          }
        : {}),
      ...(kind === "mixed-shoot"
        ? {
            pendingCoreShootSelection: {
              pendingId: "hud-mixed-shoot",
              actingPlayerId: owner,
              sourceInstanceId: target.instanceId,
              sourceDefinitionId: target.definitionId,
              candidates: [
                {
                  instanceId:
                    source === "reserve" ? `reserve:${opponent}` : "hud-source",
                  definitionId: "BSAZ01-C01",
                  availableCores: normal + 1,
                  ...(source === "reserve" ? { isReserve: true } : {}),
                },
              ],
              totalAmount: normal + 1,
              minTotal: 0,
              toKind: "trash" as const,
              toPlayerId: opponent,
              fromPlayerId: opponent,
              remainingActions: [],
              effectTiming: {
                kind: "activated" as const,
                mode: "main" as const,
              },
            },
          }
        : {}),
    };
    if (kind === "mixed-shoot" && params?.get("choice") === "1") {
      const options = {
        getCardDefinitionById: (id: string) => definitions.get(id),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      };
      const action = getLegalActions({
        state: mixed,
        actingPlayerId: owner,
        ...options,
      }).find((a) => a.kind === "resolve_pending_core_shoot")!;
      mixed = applyLegalAction({
        state: mixed,
        action,
        coreShootDistribution: {
          [source === "reserve" ? `reserve:${opponent}` : "hud-source"]: 1,
        },
        ...options,
      }).state;
    }
    return mixed;
  }
  if (kind === "mixed-placement" || kind === "mixed-multi") {
    const source = params?.get("source") ?? "reserve";
    const target = card(
      "BSAZ01-C01",
      "hud-target",
      kind === "mixed-placement" ? "hand" : "field"
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        target,
        ...(source === "field"
          ? [
              {
                ...card("BSAZ01-C01", "hud-source", "field", 1),
                soulCoreCount: 1,
              },
            ]
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        reserveNormalCoreCount:
          id === owner
            ? (source === "reserve" ? 1 : 0) +
              (kind === "mixed-placement" ? 3 : 0)
            : 0,
        reserveSoulCoreCount: id === owner && source === "reserve" ? 1 : 0,
        trashNormalCoreCount: id === owner && source === "trash" ? 1 : 0,
        trashSoulCoreCount: id === owner && source === "trash" ? 1 : 0,
        soulCoreLocation:
          id !== owner
            ? null
            : source === "field"
              ? { kind: "card" as const, instanceId: "hud-source" }
              : {
                  kind:
                    source === "trash"
                      ? ("trash" as const)
                      : ("reserve" as const),
                },
      })),
    });
    let mixed: GameState = {
      ...base,
      step: "main",
      turnNumber: 3,
      activePlayerId: owner,
      ...(kind === "mixed-placement"
        ? {
            pendingEnterFieldPlacement: {
              pendingId: "hud-mixed",
              actingPlayerId: owner,
              sourceInstanceId: target.instanceId,
              sourceDefinitionId: target.definitionId,
              remainingStacks: [],
              minimumCoreCount: 1,
              maximumCoreCount: null,
            },
          }
        : {
            pendingMultiPlacement: {
              pendingId: "hud-mixed",
              actingPlayerId: owner,
              sourceInstanceId: target.instanceId,
              sourceDefinitionId: target.definitionId,
              sourceEffectIndex: 0,
              effectTiming: { kind: "continuous" as const },
              ...(source === "trash" ? { trashCoreMax: 2 } : {}),
              targets: [
                {
                  instanceId: target.instanceId,
                  definitionId: target.definitionId,
                  minimumCoreCount: 1,
                  maximumCoreCount: null,
                  enterFieldEventKind: "summon" as const,
                },
              ],
            },
          }),
    };
    if (kind === "mixed-placement") {
      mixed = { ...mixed, pendingEnterFieldPlacement: null };
      const options = {
        getCardDefinitionById: (id: string) => definitions.get(id),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      };
      const summon = getLegalActions({
        state: mixed,
        actingPlayerId: owner,
        ...options,
      }).find(
        (a) => a.kind === "summon" && a.sourceInstanceId === target.instanceId
      )!;
      mixed = applyLegalAction({
        state: mixed,
        action: summon,
        ...options,
        paymentSources: [
          { kind: "reserve", amount: source === "field" ? 2 : 3 },
        ],
      }).state;
      for (let i = 0; i < 10 && !mixed.pendingEnterFieldPlacement; i++) {
        const pass = mixed.players
          .flatMap((p) =>
            getLegalActions({ state: mixed, actingPlayerId: p.id, ...options })
          )
          .find((a) => a.kind === "pass_stack");
        if (!pass) throw new Error("Mixed placement response missing");
        mixed = applyLegalAction({
          state: mixed,
          action: pass,
          ...options,
        }).state;
      }
    }
    return mixed;
  }
  // 2026-09-08 snapshot: BSSA01-X02 の2体召喚後、カーディナル6コアを誤って掴めた盤面。
  if (kind === "night-rust") {
    const targets = [
      card("BSSA01-C02", "hud-target-a", "field"),
      card("BSSA01-X01", "hud-target-b", "field"),
    ];
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          card("BSSA01-X02", "hud-summoner", "field", 3),
          card("BSSA01-XX01", "hud-cardinal", "field", 6),
          ...targets,
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          id,
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 0,
          soulCoreLocation: null,
        })),
      }),
      activePlayerId: owner,
      turnNumber: 7,
      step: "main",
      pendingMultiPlacement: {
        pendingId: "hud-night-rust",
        actingPlayerId: owner,
        sourceInstanceId: targets[0]!.instanceId,
        sourceDefinitionId: targets[0]!.definitionId,
        sourceEffectIndex: 1,
        effectTiming: { kind: "activated", mode: "main" },
        targets: targets.map((target) => ({
          instanceId: target.instanceId,
          definitionId: target.definitionId,
          minimumCoreCount: 1,
          maximumCoreCount: null,
          enterFieldEventKind: "summon",
        })),
      },
    };
  }
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      card("BSGE01-R01", "hud-target", kind === "link" ? "field" : "hand"),
      ...(params?.get("brave") === "1"
        ? [card("BSGE01-TR01(A)", "hud-brave", "field")]
        : []),
      card("BSGE01-CX01", "hud-source-a", "field", 2),
      card("BSGE01-R02", "hud-source-b", "field", 2),
      card("BSGE01-R03", "hud-attacker", "field", 2, opponent),
      ...Array.from({ length: 5 }, (_, i) =>
        card("BSGE01-R03", "hud-deck-" + i, "deck")
      ),
    ],
    playerOverrides: [
      {
        id: "alice",
        reserveNormalCoreCount: 4,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      },
      {
        id: "bob",
        reserveNormalCoreCount: 4,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      },
    ],
  });
  state = {
    ...state,
    turnNumber: 4,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: opponent,
    players: state.players.map((p) =>
      p.id === owner
        ? { ...p, soulStateInstanceIds: kind === "link" ? ["hud-target"] : [] }
        : p
    ),
  };
  if (kind === "bell") {
    const jinwoo = allCards.find((def) => def.name === "水篠 旬")!;
    state = {
      ...state,
      cardInstances: [
        card("BSSL01-M02", "hud-target", "hand"),
        {
          ...card(jinwoo.cardNo, "hud-source-a", "field", 1),
          underCards: [
            { cardInstanceId: "hud-advent-source", role: "advent_source" },
          ],
        },
        {
          ...card(jinwoo.cardNo, "hud-advent-source", "field"),
          attachedToInstanceId: "hud-source-a",
        },
        card("BSAZ01-C01", "hud-source-b", "field", 1),
        card("BSGE01-R03", "hud-attacker", "field", 2, opponent),
        ...(params?.get("tax") === "1"
          ? [card("BSTH02-C02", "hud-tax", "field", 3, opponent)]
          : []),
      ],
      players: state.players.map((p) =>
        p.id === owner
          ? {
              ...p,
              trashNormalCoreCount: 5,
              trashSoulCoreCount: 1,
              reserveNormalCoreCount: 0,
              countValue: 5,
              soulCoreLocation: { kind: "trash" },
            }
          : p
      ),
    };
  }
  state = recomputeAndRebuildContinuousEffects(state, (id) =>
    definitions.get(id)
  );
  const attacker = {
    entityId: "hud-attacker-entity",
    memberInstanceIds: ["hud-attacker"],
    resolvedBp: 5000,
    resolvedSymbols: ["red" as const],
    attackState: "attacking" as const,
  };
  state = { ...state, battleEntities: [attacker] };
  state = {
    ...state,
    activeAttack: {
      attackId: "hud-attack",
      primaryEntityId: attacker.entityId,
      participantEntityIds: [attacker.entityId],
      groupMode: "single",
      target: { kind: "player", playerId: owner },
      blockAssignments: [
        { participantEntityId: attacker.entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [attacker.entityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
        consecutiveActiveUseCount: 0,
      },
    },
  };
  if (kind === "life")
    return {
      ...state,
      players: state.players.map((p) =>
        p.id === owner
          ? {
              ...p,
              lifeNormalCoreCount: 2,
              lifeSoulCoreCount: 1,
              soulCoreLocation: { kind: "life" as const },
            }
          : p
      ),
      pendingLifeCoreSelection: {
        pendingId: "hud-life",
        actingPlayerId: owner,
        effectSourcePlayerId: opponent,
        sourceInstanceId: "hud-attacker",
        sourceDefinitionId: "BSGE01-R03",
        fromLocation: { kind: "life", player: "opponent" },
        toLocation: { kind: "reserve", player: "opponent" },
        normalAvailable: 2,
        soulAvailable: 1,
        totalAmount: 2,
        effectTiming: { kind: "continuous" },
      },
    };
  const options = {
    getCardDefinitionById: (id: string) => definitions.get(id),
    getRegisteredHandActivatedEffectActions:
      buildHandActivatedEffectLookup(allCards),
    getRegisteredTriggeredEffectActions:
      params?.get("brave") === "1"
        ? buildTriggeredEffectLookup(allCards)
        : () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  };
  const actions = (playerId: string) =>
    getLegalActions({ state, actingPlayerId: playerId, ...options });
  const apply = (action: LegalAction, extra = {}) => {
    state = applyLegalAction({ state, action, ...options, ...extra }).state;
  };
  const declaration = actions(owner).find((a) =>
    kind === "link"
      ? a.kind === "link_aid"
      : a.kind === "use_hand_card_effect" && a.sourceInstanceId === "hud-target"
  );
  if (!declaration)
    throw new Error("HUD scenario declaration missing: " + kind);
  apply(declaration, { deferPayCostSourceSelection: true });
  for (let i = 0; i < 10; i++) {
    const pass = state.players
      .flatMap((p) => actions(p.id))
      .find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    if (
      !state.stackWindow &&
      !state.activeAttack?.flashWindowState?.pendingStackAction
    )
      break;
    if (!pass) throw new Error("HUD scenario response missing");
    apply(pass);
  }
  if (kind !== "link" && kind !== "bell" && params?.get("stage") !== "cost") {
    const cost = actions(owner).find(
      (a) => a.kind === "resolve_pending_effect_summon_cost_payment"
    );
    if (!cost) throw new Error("HUD scenario summon cost missing");
    apply(cost, { summonPaymentSources: [{ kind: "reserve", amount: 1 }] });
  }
  return state;
}
