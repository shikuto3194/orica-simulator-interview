import { replaceCardInstances } from "./zone/card-instance-state";
import type {
  ActiveAttack,
  BattleEntity,
  CardDefinition,
  CardInstance,
  ExhaustState,
  GameState,
  PendingLeaveCause,
  PendingLeaveKind,
  PlayerState,
  Zone,
} from "./model";
import {
  describeMainDeckValidationIssue,
  isContractDefinition,
  validateMainDeckDefinitions,
} from "./card/card-filter";
import { executeEffect } from "./effect/effect-interpreter";
import { generateTriggeredEffectRegistrations } from "./effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
  useResolvePendingTriggeredEffectAsAction,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "./effect/trigger-system";
import { recomputeAndRebuildContinuousEffects } from "./effect/continuous-effect-rebuild";
import {
  clearKnownDeckCardsForPlayer,
  syncKnownDeckCardsForStateTransition,
} from "./known-deck";

let cardInstanceSequence = 1;

function nextCardInstanceId(cardNo: string): string {
  const sequence = cardInstanceSequence;
  cardInstanceSequence += 1;

  return `${cardNo.toLowerCase()}-${sequence}`;
}

export function getMinimumRequiredCoresFromDefinition(
  definition: CardDefinition
): number {
  if (definition.levelDefs.length === 0) {
    return 0;
  }

  return definition.levelDefs.reduce((minimum, levelDef) => {
    return Math.min(minimum, levelDef.requiredCores);
  }, Number.POSITIVE_INFINITY);
}

export function getDefaultZoneRoleName(
  definition: CardDefinition,
  zone: Zone
): string {
  if (zone !== "field") {
    return `${definition.printedCategory}-card`;
  }

  switch (definition.printedCategory) {
    case "spirit":
      return "spirit";
    case "ultimate":
      return "ultimate";
    case "brave":
      return "brave";
    case "nexus":
      return "nexus";
    case "magic":
      return "magic";
    default:
      return definition.printedCategory;
  }
}

export interface CreateCardInstanceOptions {
  instanceId?: string;
  ownerPlayerId: string;
  controllerPlayerId?: string;
  zone?: Zone;
  normalCoreCount?: number;
  cores?: number;
  soulCoreCount?: number;
  exhaustState?: ExhaustState;
  pendingLeaveKind?: PendingLeaveKind | null;
  pendingLeaveCause?: PendingLeaveCause | null;
  pendingLeaveChainId?: string | null;
  deferZoneMoveUntilChainEnd?: boolean;
  attachedToInstanceId?: string | null;
  attachedChildrenIds?: string[];
  imaginRightCombinedWith?: string | null;
  minimumRequiredCores?: number;
  zoneRoleName?: string;
  faceDown?: boolean;
  oraclePlacementSuppressed?: boolean;
  detachedUnderCardOrigin?: {
    hostCardNameEffective: string;
    roleTag: string;
  } | null;
  everHadCorePlaced?: boolean;
  pendingTriggerCorrelations?: Readonly<Record<string, readonly string[]>>;
  /** 省略時 0（ENGINE-accel-tribe-cost-override、実ゲームでは turnNumber は 1 開始のため非マッチ）。 */
  zoneEnteredAtTurn?: number;
}

export function applyGameStartEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const registrationCache = new Map<
    string,
    ReturnType<typeof generateTriggeredEffectRegistrations>
  >();
  const getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup =
    (cardNo) => {
      const cached = registrationCache.get(cardNo);
      if (cached) return cached;
      const definition = getCardDefinitionById(cardNo);
      const registrations = definition
        ? generateTriggeredEffectRegistrations(definition)
        : [];
      registrationCache.set(cardNo, registrations);
      return registrations;
    };
  const getRegisteredBurstActions: BurstActionRegistrationLookup = () => [];

  let nextState = recomputeAndRebuildContinuousEffects(
    state,
    getCardDefinitionById
  );

  nextState = queuePendingReactionsFromTriggerEvents(
    nextState,
    nextState.playerOrder.map((playerId) => ({
      actingPlayerId: playerId,
      eventKind: "game_start" as const,
      source: "window_transition" as const,
      chainId: "game_start",
      attackId: null,
      relatedPlayerId: playerId,
      relatedInstanceId: null,
      amount: null,
      exactGameEventKind: true,
      suppressBurstCheck: true,
    })),
    "game_start",
    {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }
  );

  const resolvedGameStartSourceKeys = new Set<string>();
  for (let guard = 0; guard < 20; guard++) {
    const pending = nextState.pendingTriggeredEffects.find(
      (entry) => entry.eventKind === "game_start"
    );
    if (!pending) return nextState;

    const sourceChoices = getAvailableTriggeredEffectSourceChoices({
      state: nextState,
      pendingEffect: pending,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
    const sourceChoice = sourceChoices.find((choice) => {
      const sourceKey = [
        choice.sourceCard.controllerPlayerId,
        choice.sourceEffectDefinition.cardNo,
        choice.actionRegistration.effectIndex ?? "unknown",
      ].join(":");
      return !resolvedGameStartSourceKeys.has(sourceKey);
    });
    if (!sourceChoice) {
      nextState = {
        ...nextState,
        pendingTriggeredEffects: nextState.pendingTriggeredEffects.filter(
          (entry) => entry.pendingId !== pending.pendingId
        ),
      };
      continue;
    }

    const result = useResolvePendingTriggeredEffectAsAction({
      state: nextState,
      actingPlayerId: sourceChoice.sourceCard.controllerPlayerId,
      pendingId: pending.pendingId,
      resolveEffect: (currentState, { chainId }) => {
        const effectIndex = sourceChoice.actionRegistration.effectIndex;
        const effect =
          effectIndex !== undefined
            ? sourceChoice.sourceEffectDefinition.effects?.[effectIndex]
            : undefined;
        if (!effect) return currentState;
        return executeEffect({
          state: currentState,
          effect,
          ...(effectIndex !== undefined ? { effectIndex } : {}),
          sourceInstanceId: sourceChoice.sourceCard.instanceId,
          actingPlayerId: sourceChoice.sourceCard.controllerPlayerId,
          chainId,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
        });
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    resolvedGameStartSourceKeys.add(
      [
        sourceChoice.sourceCard.controllerPlayerId,
        sourceChoice.sourceEffectDefinition.cardNo,
        sourceChoice.actionRegistration.effectIndex ?? "unknown",
      ].join(":")
    );
    nextState = result.state;
  }

  throw new Error("game_start triggered effects did not drain");
}

export function createPlayerState(
  id: string,
  overrides: Partial<PlayerState> = {}
): PlayerState {
  return {
    id,
    deckCount: 40,
    handCount: 4,
    lifeNormalCoreCount: 5,
    reserveNormalCoreCount: 4,
    trashNormalCoreCount: 0,
    voidNormalCoreCount:
      CORES_PER_PLAYER - STARTING_LIFE_CORES - STARTING_RESERVE_CORES,
    soulCoreLocation: null,
    reserveSoulCoreCount: 0,
    trashSoulCoreCount: 0,
    lifeSoulCoreCount: 0,
    countValue: 0,
    soulStateInstanceIds: [],
    contractCardNo: null,
    ...overrides,
  };
}

export function createCardInstance(
  definition: CardDefinition,
  options: CreateCardInstanceOptions
): CardInstance {
  const zone = options.zone ?? "deck";

  return {
    instanceId: options.instanceId ?? nextCardInstanceId(definition.cardNo),
    definitionId: definition.cardNo,
    originalDefinitionId: definition.cardNo,
    ownerPlayerId: options.ownerPlayerId,
    controllerPlayerId: options.controllerPlayerId ?? options.ownerPlayerId,
    zone,
    zoneRoleName:
      options.zoneRoleName ?? getDefaultZoneRoleName(definition, zone),
    normalCoreCount: options.normalCoreCount ?? options.cores ?? 0,
    soulCoreCount: options.soulCoreCount ?? 0,
    minimumRequiredCores:
      options.minimumRequiredCores ??
      getMinimumRequiredCoresFromDefinition(definition),
    exhaustState: options.exhaustState ?? "recovered",
    pendingLeaveKind: options.pendingLeaveKind ?? null,
    pendingLeaveCause: options.pendingLeaveCause ?? null,
    pendingLeaveChainId: options.pendingLeaveChainId ?? null,
    deferZoneMoveUntilChainEnd: options.deferZoneMoveUntilChainEnd ?? false,
    attachedToInstanceId: options.attachedToInstanceId ?? null,
    attachedChildrenIds: options.attachedChildrenIds ?? [],
    imaginRightCombinedWith: options.imaginRightCombinedWith ?? null,
    pendingLeaveLvSnapshot: null,
    underCards: [],
    divineTransformState: null,
    faceDown: options.faceDown ?? false,
    oraclePlacementSuppressed: options.oraclePlacementSuppressed ?? false,
    detachedUnderCardOrigin: options.detachedUnderCardOrigin ?? null,
    everHadCorePlaced: options.everHadCorePlaced ?? false,
    zoneEnteredAtTurn: options.zoneEnteredAtTurn ?? 0,
    ...(options.pendingTriggerCorrelations !== undefined
      ? { pendingTriggerCorrelations: options.pendingTriggerCorrelations }
      : {}),
  };
}

/** 1人あたりの標準コア総数 */
export const CORES_PER_PLAYER = 200;
/** 初期ライフコア数 */
export const STARTING_LIFE_CORES = 5;
/** 初期リザーブコア数 */
export const STARTING_RESERVE_CORES = 4;
/** 初期手札枚数 */
export const STARTING_HAND_SIZE = 4;
/** デッキの最小枚数（ルール上の下限。これ以上なら何枚でも可） */
export const MIN_DECK_SIZE = 40;
/** ランダム生成時のデッキ枚数（下限ちょうど） */
export const RANDOM_DECK_SIZE = MIN_DECK_SIZE;

function assertInitialDeckCardsAvailable(
  decks: readonly [CardDefinition[], CardDefinition[]]
): void {
  const violations: string[] = [];
  decks.forEach((deck, playerIndex) => {
    const issues = validateMainDeckDefinitions(deck);
    issues.forEach((issue) => {
      violations.push(
        `player${playerIndex + 1}: ${describeMainDeckValidationIssue(issue)}`
      );
    });
  });

  if (violations.length === 0) return;
  throw new Error(
    "initializeGame received invalid main-deck card(s). " +
      "Use allowUnavailableDeckCards only for explicit test/scenario fixtures: " +
      violations.join(", ")
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function applyContractPresentationChoices(
  state: GameState,
  choices: Record<string, boolean>
): GameState {
  const preGame = state.preGame;
  const candidateInstanceIds = preGame?.contractCandidateInstanceIds ?? {};
  const candidateCardNos = preGame?.contractCandidateCardNos ?? {};
  const playerIds = new Set(state.players.map((p) => p.id));
  const cardSegmentsByPlayer = new Map<string, CardInstance[]>();
  const logAdditions: string[] = [];

  const nextPlayers = state.players.map((player) => {
    const deckCards = state.cardInstances.filter(
      (card) => card.ownerPlayerId === player.id && card.zone === "deck"
    );
    const candidateInstanceId = candidateInstanceIds[player.id];
    const candidateCardNo = candidateCardNos[player.id];
    const hasCandidate =
      candidateInstanceId !== undefined &&
      candidateCardNo !== undefined &&
      deckCards.some((card) => card.instanceId === candidateInstanceId);
    const present = hasCandidate && choices[player.id] === true;
    const workingDeck =
      hasCandidate && !present ? shuffle(deckCards) : deckCards;
    const candidateCard =
      hasCandidate && present
        ? workingDeck.find((card) => card.instanceId === candidateInstanceId)
        : undefined;
    const deckWithoutPresented =
      candidateCard !== undefined
        ? workingDeck.filter(
            (card) => card.instanceId !== candidateCard.instanceId
          )
        : workingDeck;
    const drawCount = present ? STARTING_HAND_SIZE - 1 : STARTING_HAND_SIZE;
    const drawnCards = deckWithoutPresented.slice(0, drawCount);
    const remainingDeck = deckWithoutPresented.slice(drawCount);
    const handCards =
      candidateCard !== undefined ? [...drawnCards, candidateCard] : drawnCards;

    cardSegmentsByPlayer.set(player.id, [
      ...handCards.map((card) => ({ ...card, zone: "hand" as const })),
      ...remainingDeck.map((card) => ({ ...card, zone: "deck" as const })),
    ]);

    if (hasCandidate) {
      logAdditions.push(
        present
          ? `contract:present:${player.id}:${candidateCardNo}`
          : `contract:skip:${player.id}`
      );
    }

    // 配布カードと枚数は、この関数の出口のreplaceCardInstancesが同時に確定する。
    return {
      ...player,
      contractCardNo: present ? candidateCardNo : null,
    };
  });

  const nonInitialDeckCards = state.cardInstances.filter(
    (card) => !(playerIds.has(card.ownerPlayerId) && card.zone === "deck")
  );
  const dealtCards = state.players.flatMap(
    (player) => cardSegmentsByPlayer.get(player.id) ?? []
  );

  return replaceCardInstances(
    {
      ...state,
      players: nextPlayers,
      log: [...state.log, ...logAdditions],
    },
    [...nonInitialDeckCards, ...dealtCards]
  );
}

/**
 * デッキ定義からゲームを初期化する。
 * デッキシャッフル → ライフ5コア → リザーブ4コア → 手札4枚ドロー → ボイド残コア設定。
 */
export function initializeGame(options: {
  playerIds?: readonly [string, string];
  decks: readonly [CardDefinition[], CardDefinition[]];
  /** 先攻プレイヤーのインデックス（0 or 1）。省略時は 0（じゃんけんで後から setFirstPlayer で確定） */
  firstPlayerIndex?: 0 | 1;
  /** true の場合 preGame を null にする（シナリオテスト等） */
  skipPreGame?: boolean;
  /**
   * true の場合、入力済みのデッキ順を保持する。既に決定的にランダム化した
   * training/debug deck の先頭カードを維持する用途に限る。
   */
  preserveDeckOrder?: boolean;
  /**
   * true の場合、初期デッキの通常構築ルール検証をスキップする。
   * 実ゲーム・AI 自己対戦では使わず、カード単体や GUI シナリオの明示 fixture 用。
   */
  allowUnavailableDeckCards?: boolean;
}): GameState {
  if (options.allowUnavailableDeckCards !== true) {
    assertInitialDeckCardsAvailable(options.decks);
  }

  const playerIds = options.playerIds ?? (["alice", "bob"] as const);
  const firstPlayerIndex = options.firstPlayerIndex ?? 0;
  const voidPerPlayer =
    CORES_PER_PLAYER - STARTING_LIFE_CORES - STARTING_RESERVE_CORES;

  let instanceCounter = 0;
  const allCardInstances: CardInstance[] = [];
  const waitForContractChoice =
    !options.skipPreGame &&
    options.decks.some((deck) => deck.some((def) => isContractDefinition(def)));
  const contractCandidateInstanceIds: Record<string, string> = {};
  const contractCandidateCardNos: Record<string, string> = {};

  const players: PlayerState[] = playerIds.map((id, playerIndex) => {
    const deckDefs =
      options.preserveDeckOrder === true
        ? [...options.decks[playerIndex]!]
        : shuffle(options.decks[playerIndex]!);

    // 契約カード検出: 印字カード種類を正規化した keywordTags:contract を探す (SSOT)
    const contractIndex = deckDefs.findIndex((def) =>
      isContractDefinition(def)
    );
    const hasContract = contractIndex >= 0;
    let contractDef: CardDefinition | null = null;

    if (waitForContractChoice) {
      for (const [index, def] of deckDefs.entries()) {
        const instanceId = `card-${++instanceCounter}`;
        allCardInstances.push(
          createCardInstance(def, {
            instanceId,
            ownerPlayerId: id,
            zone: "deck",
          })
        );
        if (index === contractIndex) {
          contractCandidateInstanceIds[id] = instanceId;
          contractCandidateCardNos[id] = def.cardNo;
        }
      }

      return createPlayerState(id, {
        lifeNormalCoreCount: STARTING_LIFE_CORES,
        reserveNormalCoreCount: STARTING_RESERVE_CORES - 1,
        voidNormalCoreCount: voidPerPlayer,
        soulCoreLocation: { kind: "reserve" },
        reserveSoulCoreCount: 1,
        contractCardNo: null,
      });
    }

    let drawDefs: CardDefinition[];
    let remainingDeckDefs: CardDefinition[];

    if (hasContract) {
      // 契約: シャッフル前に1枚抜き → 3枚ドロー → 契約カードを手札に追加して計4枚
      contractDef = deckDefs[contractIndex]!;
      const withoutContract = [
        ...deckDefs.slice(0, contractIndex),
        ...deckDefs.slice(contractIndex + 1),
      ];
      const contractHandSize = STARTING_HAND_SIZE - 1; // 3枚ドロー
      drawDefs = withoutContract.slice(0, contractHandSize);
      remainingDeckDefs = withoutContract.slice(contractHandSize);
    } else {
      drawDefs = deckDefs.slice(0, STARTING_HAND_SIZE);
      remainingDeckDefs = deckDefs.slice(STARTING_HAND_SIZE);
    }

    // 手札カード（ドロー分）
    for (const def of drawDefs) {
      allCardInstances.push(
        createCardInstance(def, {
          instanceId: `card-${++instanceCounter}`,
          ownerPlayerId: id,
          zone: "hand",
        })
      );
    }

    // 契約カードを手札に追加
    if (contractDef) {
      allCardInstances.push(
        createCardInstance(contractDef, {
          instanceId: `card-${++instanceCounter}`,
          ownerPlayerId: id,
          zone: "hand",
        })
      );
    }

    // デッキカード
    for (const def of remainingDeckDefs) {
      allCardInstances.push(
        createCardInstance(def, {
          instanceId: `card-${++instanceCounter}`,
          ownerPlayerId: id,
          zone: "deck",
        })
      );
    }

    // Ver.17.0: ソウルコア使用は強制。通常コア3個 + ソウルコア1個
    return createPlayerState(id, {
      lifeNormalCoreCount: STARTING_LIFE_CORES,
      reserveNormalCoreCount: STARTING_RESERVE_CORES - 1,
      voidNormalCoreCount: voidPerPlayer,
      soulCoreLocation: { kind: "reserve" },
      reserveSoulCoreCount: 1,
      contractCardNo: contractDef?.cardNo ?? null,
    });
  });

  const firstPlayerId = playerIds[firstPlayerIndex];
  const secondPlayerId = playerIds[firstPlayerIndex === 0 ? 1 : 0];
  const definitionById = new Map<string, CardDefinition>();
  for (const deck of options.decks) {
    for (const def of deck) {
      definitionById.set(def.cardNo, def);
    }
  }

  const initialState: GameState = {
    nextRootTriggerChainId: 0,
    turnNumber: 1,
    activePlayerId: firstPlayerId,
    playerOrder: [firstPlayerId, secondPlayerId],
    step: "start",
    window: "none",
    players,
    cardInstances: allCardInstances,
    battleEntities: [],
    activeAttack: null,
    stackWindow: null,
    battleResolutionGroup: null,
    battleImmediateEffects: [],
    burstSetPlayerIdsThisTurn: [],
    setBurstStates: [],
    revealedBurstStates: [],
    mirageSetStates: [],
    mirageSetPlayerIdsThisTurn: [],
    mirageSetCountExemptionsUsed: [],
    quartzSetStates: [],
    usedDivineSkillKeysThisTurn: [],
    usedTrashAdventKeysThisTurn: [],
    usedAlternateCostAdventKeysThisTurn: [],
    usedAdventDeclareKeysThisTurn: [],
    countGainModifierConsumedThisTurn: [],
    pendingAdditionalAttackGrants: [],
    usedTaplessBattleDeclareInstanceIdsThisTurn: [],
    turnSummonedCardRefs: [],
    pendingTriggeredEffects: [],
    pendingPrivateDeclarations: [],
    pendingDeferredTriggeredEffects: [],
    pendingBurstChecks: [],
    preDeclarationStackWindow: null,
    pendingPreDeclarationConfirmation: null,
    pendingLeaveEntities: [],
    pendingBraveLeaveChoice: null,
    pendingBraveAttackContinuation: null,
    pendingSoulStateReplacement: null,
    pendingAdventSourceReplacement: null,
    pendingSetAsideExitReplacementChoice: null,
    pendingStoneFlipCombine: null,
    pendingDeckReveal: null,
    pendingTrashOptionalAdds: [],
    pendingZoneSelection: null,
    pendingStepOptionalChoice: null,
    pendingStepChoice: null,
    pendingDeckRevealCountBoostChoice: null,
    pendingStepOptionalTargetSelection: null,
    pendingAfterTriggersContinuations: [],
    pendingEffectCompletions: [],
    pendingRetriggerContinuations: [],
    pendingDeckRevealSwapChain: [],
    pendingDrawStepCostChoice: null,
    pendingSummonCostExcludeChoice: null,
    pendingSummonCostCoreMoveChoice: null,
    pendingGroupedSummonCostOverrideChoice: null,
    pendingLifeDamageDiscardChoice: null,
    pendingLifeGainReplacementChoice: null,
    pendingCoreShootSelection: null,
    pendingEffectTargetSelection: null,
    pendingAsIfSoulCoreChoice: null,
    pendingEffectOptionalRepeatChoice: null,
    pendingEffectOptionalRepeatCountSelection: null,
    pendingBorrowedEffectChoice: null,
    pendingBorrowedEffectTargetSelection: null,
    pendingTargetedDisclosureContinuation: null,
    pendingPayToActCoreGate: null,
    pendingPayToActHandDiscardGate: null,
    pendingFieldMagicPreCostTrigger: null,
    pendingEnterFieldPlacement: null,
    pendingStackCascade: null,
    pendingStackNegateRequests: [],
    pendingBraveCombineChoice: null,
    pendingHandTrashSwapChoice: null,
    pendingFieldHandSwapChoice: null,
    pendingTenshoSummon: null,
    pendingReverseRebirthSummon: null,
    pendingCoreSplitSelection: null,
    pendingSplitSummonChoice: null,
    pendingCoreCountSelection: null,
    pendingCountSelection: null,
    pendingDiscardSetBurstCountSelection: null,
    pendingLifeCoreSelection: null,
    pendingCoreSourceAllocation: null,
    pendingLinkAidCostSourceChoice: null,
    pendingCoreDistribution: null,
    pendingEffectSummonCostPayment: null,
    pendingMultiPlacement: null,
    pendingTargetRedirects: [],
    pendingChangeCleanupChoice: null,
    pendingAccelCleanups: [],
    pendingBattleEndDeferrals: [],
    pendingTurnEndExhaustDowngrades: [],
    pendingImmediateBattleEnds: [],
    pendingConnectBattleDecision: null,
    pendingAttackStepEndFinalizations: [],
    pendingTurnEndFinalizations: [],
    pendingBattleEndFinalizeAttackIds: [],
    activeContinuousEffects: [],
    effectUsageRecords: [],
    effectOccurrenceRecords: [],
    effectQueueEntries: [],
    effectQueueSummary: [],
    publicDisclosures: [],
    illegalBurstRevealPlayerId: null,
    effectLifeReductionThisTurn: {},
    declarationCountThisTurn: {},
    lifeReductionCappedThisTurn: {},
    filteredLifeReductionCappedThisTurn: {},
    bpThresholdCappedLifeReductionThisTurn: {},
    declareGimmickGateUsedThisTurn: {},
    lifeDamageInterceptionUseCostGateUsedThisTurn: {},
    symbolAdditionRestrictedCountThisTurn: {},
    flashCardUsageLog: [],
    flashEffectActivationLog: [],
    attackDeclarationLog: [],
    mirageSetDrawLog: [],
    gameResult: null,
    log: [`game:initialized:first:${firstPlayerId}`],
    preGame: options.skipPreGame
      ? null
      : Object.keys(contractCandidateCardNos).length > 0
        ? {
            phase: "waiting_contract",
            contractCandidateInstanceIds,
            contractCandidateCardNos,
            contractPresentationChoices: {},
            contractConfirmed: {},
            firstPlayerId: null,
            jankenHands: {},
            jankenRound: 0,
            jankenWinner: null,
            mulliganDone: {},
          }
        : {
            phase: "waiting_janken",
            firstPlayerId: null,
            jankenHands: {},
            jankenRound: 0,
            jankenWinner: null,
            mulliganDone: {},
          },
  };

  const countedState = replaceCardInstances(initialState, allCardInstances);
  return waitForContractChoice
    ? countedState
    : applyGameStartEffects(countedState, (id) => definitionById.get(id));
}

/**
 * マリガン: 指定プレイヤーの手札をデッキに戻してシャッフルし、再度4枚引く。
 * 1回のみ使用可能（呼び出し側で制御）。
 */
export function mulliganHand(
  state: GameState,
  playerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  if (!getCardDefinitionById) {
    throw new Error(
      "mulliganHand requires getCardDefinitionById to rebuild continuous effects"
    );
  }
  const handCards = state.cardInstances.filter(
    (c) => c.ownerPlayerId === playerId && c.zone === "hand"
  );
  if (handCards.length === 0) return state;

  const handIds = new Set(handCards.map((c) => c.instanceId));

  // 手札をデッキに戻す
  let updatedCards = state.cardInstances.map((c) =>
    handIds.has(c.instanceId)
      ? {
          ...c,
          zone: "deck" as const,
          zoneRoleName: `${c.zoneRoleName.replace(/-card$/, "")}-card`,
        }
      : c
  );

  // デッキカードをシャッフル（新しい順序で並べ替え）
  const deckCards = updatedCards.filter(
    (c) => c.ownerPlayerId === playerId && c.zone === "deck"
  );
  const nonDeckCards = updatedCards.filter(
    (c) => !(c.ownerPlayerId === playerId && c.zone === "deck")
  );
  const shuffledDeck = shuffle(deckCards);

  // 上から4枚を手札に
  const newHandCards = shuffledDeck.slice(0, STARTING_HAND_SIZE).map((c) => ({
    ...c,
    zone: "hand" as const,
  }));
  const remainingDeck = shuffledDeck.slice(STARTING_HAND_SIZE);

  updatedCards = [...nonDeckCards, ...newHandCards, ...remainingDeck];

  state.log.push(`mulligan:${playerId}`);
  const nextState = clearKnownDeckCardsForPlayer(
    replaceCardInstances(state, updatedCards),
    playerId
  );
  return syncKnownDeckCardsForStateTransition({
    before: state,
    actorPlayerId: playerId,
    after: recomputeAndRebuildContinuousEffects(
      {
        ...nextState,
        activeContinuousEffects: Array.isArray(
          nextState.activeContinuousEffects
        )
          ? nextState.activeContinuousEffects
          : [],
      },
      getCardDefinitionById
    ),
  });
}

/**
 * 先攻プレイヤーを変更する。手札配布済み・ゲーム開始前に使用。
 * activePlayerId と playerOrder を入れ替える。
 */
export function setFirstPlayer(
  state: GameState,
  firstPlayerId: string
): GameState {
  const secondPlayerId =
    state.players.find((p) => p.id !== firstPlayerId)?.id ??
    state.playerOrder[1]!;
  state.log.push(`game:first_player_set:${firstPlayerId}`);
  return {
    ...state,
    activePlayerId: firstPlayerId,
    playerOrder: [firstPlayerId, secondPlayerId],
  };
}

/** 実体を省略できるfixture/CLI用の抽象盤面。実対戦はinitializeGameを使用する。 */
export function createEmptyGameState(options?: {
  playerIds?: readonly [string, string];
  startingLife?: number;
  startingDeckCount?: number;
  startingVoidNormalCoreCount?: number;
  cardInstances?: CardInstance[];
  battleEntities?: BattleEntity[];
  activeAttack?: ActiveAttack | null;
  battleResolutionGroup?: GameState["battleResolutionGroup"];
  battleImmediateEffects?: GameState["battleImmediateEffects"];
  burstSetPlayerIdsThisTurn?: GameState["burstSetPlayerIdsThisTurn"];
  setBurstStates?: GameState["setBurstStates"];
  revealedBurstStates?: GameState["revealedBurstStates"];
  mirageSetStates?: GameState["mirageSetStates"];
  mirageSetPlayerIdsThisTurn?: GameState["mirageSetPlayerIdsThisTurn"];
  mirageSetCountExemptionsUsed?: GameState["mirageSetCountExemptionsUsed"];
  quartzSetStates?: GameState["quartzSetStates"];
  turnSummonedCardRefs?: GameState["turnSummonedCardRefs"];
  pendingTriggeredEffects?: GameState["pendingTriggeredEffects"];
  pendingPrivateDeclarations?: GameState["pendingPrivateDeclarations"];
  pendingDeferredTriggeredEffects?: GameState["pendingDeferredTriggeredEffects"];
  pendingBurstChecks?: GameState["pendingBurstChecks"];
  pendingRetriggerContinuations?: GameState["pendingRetriggerContinuations"];
  playerOverrides?: Partial<PlayerState>[];
}): GameState {
  const playerIds = options?.playerIds ?? ["player-1", "player-2"];
  const startingLife = options?.startingLife ?? 5;
  const startingDeckCount = options?.startingDeckCount ?? 40;
  const playerOverrides = options?.playerOverrides ?? [];

  const players = playerIds.map((id, index) => {
    const override = playerOverrides[index] ?? {};
    const player = createPlayerState(id, {
      lifeNormalCoreCount: startingLife,
      deckCount: startingDeckCount,
      voidNormalCoreCount:
        options?.startingVoidNormalCoreCount ??
        CORES_PER_PLAYER - startingLife - STARTING_RESERVE_CORES,
      ...override,
    });

    // テストヘルパー互換 (P3-101 S2): override が soulCoreLocation のみを指定し、
    // 対応するロケーション別カウント (S1新設フィールド) を指定していない場合、
    // soulCoreLocation から自動導出する。指定しないと isSoulCoreOn/moveSoulCore 等の
    // 新 SSOT 読み取りが 0 のまま食い違い、既存テストの hand-built state が壊れるため。
    const overrideSpecifiesCounts =
      "reserveSoulCoreCount" in override ||
      "trashSoulCoreCount" in override ||
      "lifeSoulCoreCount" in override;

    if ("soulCoreLocation" in override && !overrideSpecifiesCounts) {
      return {
        ...player,
        reserveSoulCoreCount:
          player.soulCoreLocation?.kind === "reserve" ? 1 : 0,
        trashSoulCoreCount: player.soulCoreLocation?.kind === "trash" ? 1 : 0,
        lifeSoulCoreCount: player.soulCoreLocation?.kind === "life" ? 1 : 0,
      };
    }

    return player;
  });

  const soulCoreCardInstanceIds = new Set(
    players
      .map((player) => player.soulCoreLocation)
      .filter(
        (location): location is { kind: "card"; instanceId: string } =>
          location?.kind === "card"
      )
      .map((location) => location.instanceId)
  );

  const cardInstances = (options?.cardInstances ?? []).map((card) =>
    soulCoreCardInstanceIds.has(card.instanceId) && card.soulCoreCount === 0
      ? { ...card, soulCoreCount: 1 }
      : card
  );

  return {
    nextRootTriggerChainId: 0,
    turnNumber: 1,
    activePlayerId: playerIds[0],
    playerOrder: [...playerIds],
    step: "start",
    window: "none",
    players,
    cardInstances,
    battleEntities: options?.battleEntities ? [...options.battleEntities] : [],
    // initializeGame の実対戦盤面にはこのフラグを付けない。
    zoneCountMode: "abstract",
    activeAttack: options?.activeAttack ?? null,
    stackWindow: null,
    battleResolutionGroup: options?.battleResolutionGroup ?? null,
    battleImmediateEffects: options?.battleImmediateEffects
      ? [...options.battleImmediateEffects]
      : [],
    burstSetPlayerIdsThisTurn: options?.burstSetPlayerIdsThisTurn
      ? [...options.burstSetPlayerIdsThisTurn]
      : [],
    setBurstStates: options?.setBurstStates ? [...options.setBurstStates] : [],
    revealedBurstStates: options?.revealedBurstStates
      ? [...options.revealedBurstStates]
      : [],
    mirageSetStates: options?.mirageSetStates
      ? [...options.mirageSetStates]
      : [],
    mirageSetPlayerIdsThisTurn: options?.mirageSetPlayerIdsThisTurn
      ? [...options.mirageSetPlayerIdsThisTurn]
      : [],
    mirageSetCountExemptionsUsed: options?.mirageSetCountExemptionsUsed
      ? options.mirageSetCountExemptionsUsed.map((entry) => ({ ...entry }))
      : [],
    quartzSetStates: options?.quartzSetStates
      ? [...options.quartzSetStates]
      : [],
    usedDivineSkillKeysThisTurn: [],
    usedTrashAdventKeysThisTurn: [],
    usedAlternateCostAdventKeysThisTurn: [],
    usedAdventDeclareKeysThisTurn: [],
    countGainModifierConsumedThisTurn: [],
    pendingAdditionalAttackGrants: [],
    usedTaplessBattleDeclareInstanceIdsThisTurn: [],
    turnSummonedCardRefs: options?.turnSummonedCardRefs
      ? [...options.turnSummonedCardRefs]
      : [],
    pendingTriggeredEffects: options?.pendingTriggeredEffects
      ? [...options.pendingTriggeredEffects]
      : [],
    pendingPrivateDeclarations: options?.pendingPrivateDeclarations
      ? [...options.pendingPrivateDeclarations]
      : [],
    pendingDeferredTriggeredEffects: options?.pendingDeferredTriggeredEffects
      ? [...options.pendingDeferredTriggeredEffects]
      : [],
    pendingBurstChecks: options?.pendingBurstChecks
      ? [...options.pendingBurstChecks]
      : [],
    preDeclarationStackWindow: null,
    pendingPreDeclarationConfirmation: null,
    pendingLeaveEntities: [],
    pendingBraveLeaveChoice: null,
    pendingBraveAttackContinuation: null,
    pendingSoulStateReplacement: null,
    pendingAdventSourceReplacement: null,
    pendingSetAsideExitReplacementChoice: null,
    pendingStoneFlipCombine: null,
    pendingDeckReveal: null,
    pendingTrashOptionalAdds: [],
    pendingZoneSelection: null,
    pendingStepOptionalChoice: null,
    pendingStepChoice: null,
    pendingDeckRevealCountBoostChoice: null,
    pendingStepOptionalTargetSelection: null,
    pendingAfterTriggersContinuations: [],
    pendingEffectCompletions: [],
    pendingRetriggerContinuations: options?.pendingRetriggerContinuations
      ? [...options.pendingRetriggerContinuations]
      : [],
    pendingDeckRevealSwapChain: [],
    pendingDrawStepCostChoice: null,
    pendingSummonCostExcludeChoice: null,
    pendingSummonCostCoreMoveChoice: null,
    pendingGroupedSummonCostOverrideChoice: null,
    pendingLifeDamageDiscardChoice: null,
    pendingLifeGainReplacementChoice: null,
    pendingCoreShootSelection: null,
    pendingEffectTargetSelection: null,
    pendingAsIfSoulCoreChoice: null,
    pendingEffectOptionalRepeatChoice: null,
    pendingEffectOptionalRepeatCountSelection: null,
    pendingBorrowedEffectChoice: null,
    pendingBorrowedEffectTargetSelection: null,
    pendingTargetedDisclosureContinuation: null,
    pendingPayToActCoreGate: null,
    pendingPayToActHandDiscardGate: null,
    pendingFieldMagicPreCostTrigger: null,
    pendingEnterFieldPlacement: null,
    pendingStackCascade: null,
    pendingStackNegateRequests: [],
    pendingBraveCombineChoice: null,
    pendingHandTrashSwapChoice: null,
    pendingFieldHandSwapChoice: null,
    pendingTenshoSummon: null,
    pendingReverseRebirthSummon: null,
    pendingCoreSplitSelection: null,
    pendingSplitSummonChoice: null,
    pendingCoreCountSelection: null,
    pendingCountSelection: null,
    pendingDiscardSetBurstCountSelection: null,
    pendingLifeCoreSelection: null,
    pendingCoreSourceAllocation: null,
    pendingLinkAidCostSourceChoice: null,
    pendingCoreDistribution: null,
    pendingEffectSummonCostPayment: null,
    pendingMultiPlacement: null,
    pendingTargetRedirects: [],
    pendingChangeCleanupChoice: null,
    pendingAccelCleanups: [],
    pendingBattleEndDeferrals: [],
    pendingTurnEndExhaustDowngrades: [],
    pendingImmediateBattleEnds: [],
    pendingConnectBattleDecision: null,
    pendingAttackStepEndFinalizations: [],
    pendingTurnEndFinalizations: [],
    pendingBattleEndFinalizeAttackIds: [],
    activeContinuousEffects: [],
    effectUsageRecords: [],
    effectOccurrenceRecords: [],
    effectQueueEntries: [],
    effectQueueSummary: [],
    publicDisclosures: [],
    illegalBurstRevealPlayerId: null,
    effectLifeReductionThisTurn: {},
    declarationCountThisTurn: {},
    lifeReductionCappedThisTurn: {},
    filteredLifeReductionCappedThisTurn: {},
    bpThresholdCappedLifeReductionThisTurn: {},
    declareGimmickGateUsedThisTurn: {},
    lifeDamageInterceptionUseCostGateUsedThisTurn: {},
    symbolAdditionRestrictedCountThisTurn: {},
    flashCardUsageLog: [],
    flashEffectActivationLog: [],
    attackDeclarationLog: [],
    mirageSetDrawLog: [],
    gameResult: null,
    log: ["game:created"],
    preGame: null,
  };
}
