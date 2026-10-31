import {
  createCardInstance,
  createActiveAttack,
  createEmptyGameState,
  executeEffect,
  queuePendingLeave,
  flushPendingLeaves,
  rebuildContinuousEffectsFromField,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  playSummonAsAction,
  sanitizeStateForViewer,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";

function buildAldnoahSummonScenario(
  cards: CardDefinition[],
  owner: string,
  params?: URLSearchParams
): GameState {
  const driveZone = params?.get("drive") === "hand" ? "hand" : "field";
  const withOracle = params?.get("oracle") === "1";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const make = (
    no: string,
    id: string,
    zone: CardInstance["zone"],
    cores = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("BSAZ02-C03", "kanjuden-target", "hand"),
        make(
          "BSAZ02-C10",
          "kanjuden-source",
          driveZone,
          driveZone === "field" ? 1 : 0
        ),
        ...(withOracle
          ? [
              make("BSAZ02-X04", "kanjuden-domain", "field", 2),
              make("BSAZ02-C10", "kanjuden-drive-1", driveZone),
              make("BSAZ02-C10", "kanjuden-drive-2", driveZone),
            ]
          : []),
        make("BSAZ02-C01", "kanjuden-deck-0", "deck"),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: 8,
        reserveSoulCoreCount: 0,
        deckCount: id === owner ? 1 : 0,
      })),
    }),
    step: "main",
    activePlayerId: owner,
    turnNumber: 3,
  };
  return playSummonAsAction({
    state,
    actingPlayerId: owner,
    cardInstanceId: "kanjuden-target",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBurstActions: buildBurstEffectLookup(cards),
    paymentSources: [{ kind: "reserve", amount: driveZone === "hand" ? 4 : 3 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
  }).state;
}

/** 紺珠伝の共通操作: 純化・私的閲覧・神域からの通常使用・無料配置。 */
export function buildKanjudenScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const mode = params?.get("mode") ?? "pure";
  if (mode === "hand-selection")
    return buildHandRevealSelectionScenario(cards, owner, params);
  if (mode === "junko-resummon")
    return buildJunkoResummonScenario(cards, owner);
  if (mode === "card-state-battle")
    return buildCardStateBattleScenario(cards, owner);
  if (mode === "aldnoah-summon")
    return buildAldnoahSummonScenario(cards, owner, params);
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const make = (
    no: string,
    id: string,
    zone: CardInstance["zone"],
    cores = 0,
    player = owner
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  const sourceNo =
    mode === "r03"
      ? "BSTH10-R03"
      : mode === "swap"
        ? "BSTH10-X04"
        : mode === "look"
          ? "BSTH10-C04"
          : mode === "deck"
            ? "BSTH10-X01"
            : "BSTH10-M01";
  const instances = [
    make(
      sourceNo,
      "kanjuden-source",
      mode === "r03" ? "in_use" : "field",
      mode === "deck" ? 3 : 4
    ),
    make(
      mode.startsWith("pure-aldnoah") ? "BSAZ02-C03" : "BSTH10-C04",
      "kanjuden-target",
      "field",
      3,
      opponent
    ),
    ...(mode === "pure-contract" || mode === "pure-brave"
      ? [
          make(
            mode === "pure-brave" ? "BSGE01-CX01" : "BSRK01-CX01",
            "kanjuden-contract",
            "field",
            3,
            opponent
          ),
          ...(mode === "pure-brave"
            ? [
                {
                  ...make(
                    "BSGE01-TX01(A)",
                    "kanjuden-brave",
                    "field",
                    0,
                    opponent
                  ),
                  attachedToInstanceId: "kanjuden-contract",
                },
              ]
            : []),
        ]
      : []),
    make("BSTH10-X03", "kanjuden-sagume", "trash"),
    make(
      "BSTH10-C03",
      "kanjuden-hand",
      mode === "cost" ? "field" : "hand",
      mode === "cost" ? 1 : 0
    ),
    ...(mode === "cost"
      ? [make("BSTH10-C04", "kanjuden-payment", "field", 1)]
      : []),
    ...[
      "BSTH10-C04",
      "BSTH10-X03",
      "BSTH10-X02",
      "BSTH10-C01",
      "BSTH10-C02",
    ].map((no, i) => make(no, `kanjuden-deck-${i}`, "deck")),
  ];
  if (mode === "pure-brave") {
    instances.find(
      (c) => c.instanceId === "kanjuden-contract"
    )!.attachedChildrenIds = ["kanjuden-brave"];
  }
  if (mode.startsWith("pure-aldnoah")) {
    const host = instances.find((c) => c.instanceId === "kanjuden-target")!;
    host.underCards = [
      {
        cardInstanceId: "kanjuden-drive",
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ];
    instances.push({
      ...make("BSAZ02-C10", "kanjuden-drive", "field", 0, opponent),
      attachedToInstanceId: host.instanceId,
      zoneRoleName: "aldnoah-drive",
      faceDown: mode === "pure-aldnoah-facedown",
    });
  }
  if (mode === "pure") {
    instances.find((c) => c.instanceId === "kanjuden-target")!.exhaustState =
      "exhausted";
    instances.push(
      make("BSTH10-C03", "kanjuden-set-aside", "set_aside", 0, opponent)
    );
  }
  const state = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: instances,
        playerOverrides: ["alice", "bob"].map((player) => ({
          reserveNormalCoreCount: 20,
          reserveSoulCoreCount: 0,
          handCount: player === owner ? 1 : 0,
          deckCount: player === owner ? 5 : 0,
        })),
      }),
      activePlayerId: owner,
      step: mode === "r03" || mode === "cost" ? "attack" : "main",
      turnNumber: 3,
    },
    lookup
  );
  if (mode === "deck") return state;
  // 任意の召喚時効果は宣言前から始める。executeEffect の直呼びは発揮選択を飛ばす。
  if (mode.startsWith("pure") || mode === "look")
    return {
      ...state,
      pendingTriggeredEffects: [
        {
          pendingId: "kanjuden-summon",
          eventKind: "summon",
          actingPlayerId: owner,
          source: "action_resolution",
          chainId: "scenario:scenario-kanjuden.ts:133",
          attackId: null,
          relatedPlayerId: owner,
          relatedInstanceId: "kanjuden-source",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
  if (mode === "cost")
    return {
      ...state,
      players: state.players.map((p) => ({ ...p, handCount: 0 })),
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        ...(["destroy", "deck_bottom"] as const).map((destination) => ({
          effectId: `cost-${destination}`,
          sourceInstanceId: "kanjuden-target",
          sourceDefinitionId: "BSTH10-C04",
          actingPlayerId: opponent,
          modifierTag: "battle_destroy_cost_gate_both" as const,
          targetFilter: { player: "opponent" as const },
          duration: { scope: "turn" as const },
          createdAtTurn: 3,
          createdAtAttackId: null,
          metadata: {
            costTargetCategory: ["spirit", "ultimate"],
            ...(destination === "deck_bottom"
              ? { costDestination: destination }
              : {}),
          },
        })),
      ],
    };
  const source = lookup(sourceNo)!;
  const effect =
    mode === "swap"
      ? source.grandwalkerData!.divineSkills![0]!.effects![0]!
      : source.effects![mode === "r03" ? 1 : 0]!;
  return executeEffect({
    chainId: "scenario:scenario-kanjuden.ts:179",
    state,
    effect,
    effectIndex: mode === "r03" ? 1 : 0,
    ...(mode === "swap" ? { divineSkillIndex: 0 } : {}),
    sourceInstanceId: "kanjuden-source",
    actingPlayerId: owner,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    promptUnresolvedChoice: true,
  });
}

/** 実カードの閲覧→破棄選択。配送済み状態だけでも候補画像を復元できる。 */
function buildHandRevealSelectionScenario(
  cards: CardDefinition[],
  owner: string,
  params?: URLSearchParams
): GameState {
  const opponent = owner === "alice" ? "bob" : "alice";
  const sourceNo =
    params?.get("card") === "BSTH10-C01" ? "BSTH10-C01" : "BSTH10-C02";
  const targets =
    sourceNo === "BSTH10-C01"
      ? ["BSTH10-C03", "BSTH10-C04"]
      : ["BSTH10-R01", "BSTH10-M01"];
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(lookup(sourceNo)!, {
          instanceId: "hand-reveal-source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        ...targets.map((no, i) =>
          createCardInstance(lookup(no)!, {
            instanceId: `hand-reveal-${i}`,
            ownerPlayerId: opponent,
            zone: "hand",
          })
        ),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === opponent ? 2 : 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
  };
  const pending = executeEffect({
    state,
    actingPlayerId: owner,
    sourceInstanceId: "hand-reveal-source",
    effect: lookup(sourceNo)!.effects![0]!,
    effectIndex: 0,
    chainId: "scenario:hand-reveal-selection",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    promptUnresolvedChoice: true,
  });
  return params?.get("delivered") === "1"
    ? sanitizeStateForViewer(pending, owner)
    : pending;
}

/** 疲労していた純狐を手札へ戻し、次の自分のメインステップから通常召喚する。 */
function buildJunkoResummonScenario(
  cards: CardDefinition[],
  owner: string
): GameState {
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map(() => ({
        reserveNormalCoreCount: 20,
        reserveSoulCoreCount: 0,
        soulCoreLocation: { kind: "reserve" },
        handCount: 0,
      })),
      cardInstances: [
        {
          ...createCardInstance(lookup("BSTH10-X02")!, {
            instanceId: "junko-returned",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 2,
          }),
          exhaustState: "exhausted",
          skipNextRefreshRecovery: true,
        },
      ],
    }),
    turnNumber: 8,
    activePlayerId: owner,
    step: "main",
  };
  const returned = flushPendingLeaves(
    queuePendingLeave({
      state,
      instanceId: "junko-returned",
      kind: "bounce",
      cause: "effect_resolution",
      chainId: "scenario:junko-resummon",
      leaveDestination: { zone: "hand" },
    }),
    lookup
  );
  return { ...returned, turnNumber: 10 };
}

/** 提供 snapshot の「純化前の疲労ブロック付与」を含む実体/カード状態の比較盤面。 */
function buildCardStateBattleScenario(
  cards: CardDefinition[],
  owner: string
): GameState {
  const attacker = owner === "alice" ? "bob" : "alice";
  const def = cards.find((c) => c.cardNo === "BSRK01-C04")!;
  const make = (
    id: string,
    player: string,
    extra: Partial<CardInstance> = {}
  ) => ({
    ...createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      cores: 1,
    }),
    ...extra,
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("battle-attacker", attacker, { exhaustState: "exhausted" }),
        make("battle-face-up-card", owner, { zoneRoleName: "card" }),
        make("battle-purified", owner, {
          faceDown: true,
          faceDownContentsPublic: true,
          exhaustState: "exhausted",
          normalCoreCount: 0,
        }),
        make("battle-clone", owner, { zoneRoleName: "card", faceDown: true }),
      ],
    }),
    activePlayerId: attacker,
    step: "attack",
    window: "declare_block",
    battleEntities: [
      {
        entityId: "battle-entity:battle-attacker",
        memberInstanceIds: ["battle-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeContinuousEffects: [
      {
        effectId: "snapshot-exhausted-block",
        modifierTag: "allow_block_while_exhausted",
        sourceInstanceId: "battle-attacker",
        sourceDefinitionId: def.cardNo,
        targetInstanceId: "battle-purified",
        actingPlayerId: owner,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
      },
      {
        effectId: "clone-status",
        modifierTag: "act_as_spirit",
        sourceInstanceId: "battle-attacker",
        sourceDefinitionId: def.cardNo,
        targetInstanceId: "battle-clone",
        actingPlayerId: owner,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        metadata: {
          statBlueprint: {
            kind: "static_copy",
            snapshot: {
              cost: 4,
              tribes: [],
              symbolColors: ["red"],
              reductionSymbols: [],
              levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
            },
          },
          overrides: { cardName: "分身" },
        },
      },
    ],
  };
  return {
    ...state,
    activeAttack: {
      ...createActiveAttack(state, "battle-entity:battle-attacker", attacker),
      flashBeforeBlockCompleted: true,
      flashWindowState: null,
    },
  };
}
