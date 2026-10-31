import type { Effect, EffectStep } from "./dsl-types";
import type { AiSearchTurnSchedule } from "./ai-search-turn-schedule";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  GameState,
  KnownDeckCard,
  PlayerState,
  PublicDisclosure,
  SymbolColor,
  Zone,
} from "./model";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolBundles,
  resolveEffectiveIdentity,
  type SymbolBundle,
} from "./battle/battle-shared";
import { getPendingPromptResolverPlayerIds } from "./current-actor";
import { getCardDefinitionForEffectiveFieldCard } from "./legal/legal-actions-shared";
import { sanitizeStateForViewer } from "./state-sanitize";

// v1 masked the opponent's publicly presented contract as null. A saved v1
// observation cannot distinguish that loss from an actual non-presentation.
export const AI_OBSERVATION_SCHEMA_VERSION = 2;
export const AI_UNKNOWN_CARD = "UNK_CARD";

const HIDDEN_CARD_ID = "_hidden_card_";

export const AI_OBSERVATION_MODES = [
  "player",
  "spectator_full",
  "debug_perfect",
] as const;

export type AiObservationMode = (typeof AI_OBSERVATION_MODES)[number];
export type AiRelativePlayer = "me" | "opp";
export type AiCardIdentityVisibility = "known" | "unknown" | "public_memory";

export type AiObservationPendingFieldRole = "summary" | "engine_internal";

export const AI_OBSERVATION_PENDING_FIELD_ROLES = {
  pendingAccelCleanups: "summary",
  pendingAdditionalAttackGrants: "summary",
  pendingAdventSourceReplacement: "summary",
  pendingAfterTriggersContinuations: "engine_internal",
  pendingEffectCompletions: "engine_internal",
  pendingAttackStepEndFinalizations: "engine_internal",
  pendingBattleEndDeferrals: "summary",
  pendingBattleEndFinalizeAttackIds: "engine_internal",
  pendingBorrowedEffectChoice: "summary",
  pendingBorrowedEffectTargetSelection: "summary",
  pendingBraveAttackContinuation: "summary",
  pendingBraveCombineChoice: "summary",
  pendingBraveLeaveChoice: "summary",
  pendingBurstChecks: "summary",
  pendingChangeCleanupChoice: "summary",
  pendingConnectBattleDecision: "summary",
  pendingCoreCountSelection: "summary",
  pendingCoreDistribution: "summary",
  pendingCoreShootSelection: "summary",
  pendingCoreSourceAllocation: "summary",
  pendingLinkAidCostSourceChoice: "summary",
  pendingCoreSplitSelection: "summary",
  pendingCountSelection: "summary",
  pendingDeckReveal: "summary",
  pendingDeckRevealCountBoostChoice: "summary",
  pendingDeckRevealSwapChain: "summary",
  pendingDeferredTriggeredEffects: "summary",
  pendingDiscardSetBurstCountSelection: "summary",
  pendingDrawEvents: "engine_internal",
  pendingDrawStepCostChoice: "summary",
  pendingAsIfSoulCoreChoice: "summary",
  pendingEffectOptionalRepeatChoice: "summary",
  pendingEffectOptionalRepeatCountSelection: "summary",
  pendingEffectSummonCostPayment: "summary",
  pendingEffectTargetSelection: "summary",
  pendingEnterFieldPlacement: "summary",
  // Not an input prompt; its ordered public values are in global.stepProgression.
  pendingExtraSteps: "engine_internal",
  pendingExtraTurn: "engine_internal",
  pendingFieldHandSwapChoice: "summary",
  pendingFieldMagicPreCostTrigger: "summary",
  pendingGroupedSummonCostOverrideChoice: "summary",
  pendingHandTrashSwapChoice: "summary",
  pendingImmediateBattleEnds: "summary",
  pendingImmediateAttackJoins: "summary",
  pendingLeaveEntities: "summary",
  pendingLifeCoreSelection: "summary",
  pendingLifeDamageDiscardChoice: "summary",
  pendingLifeGainReplacementChoice: "summary",
  pendingMultiPlacement: "summary",
  pendingPayToActCoreGate: "summary",
  pendingPayToActHandDiscardGate: "summary",
  pendingPreDeclarationConfirmation: "summary",
  pendingPrivateDeclarations: "summary",
  pendingPromptLock: "engine_internal",
  pendingResolutionEndLogs: "engine_internal",
  pendingRetriggerContinuations: "engine_internal",
  pendingReverseRebirthSummon: "summary",
  pendingSetAsideExitReplacementChoice: "summary",
  pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds:
    "engine_internal",
  pendingSoulStateReplacement: "summary",
  pendingSplitSummonChoice: "summary",
  pendingStackCascade: "engine_internal",
  pendingStackCascadeFlushGuardStacks: "engine_internal",
  pendingStackNegateRequests: "engine_internal",
  pendingStepChoice: "summary",
  pendingStepOptionalChoice: "summary",
  pendingStepOptionalTargetSelection: "summary",
  pendingStoneFlipCombine: "summary",
  pendingSummonCostCoreMoveChoice: "summary",
  pendingSummonCostExcludeChoice: "summary",
  pendingTargetRedirects: "summary",
  pendingTargetedDisclosureContinuation: "summary",
  pendingTenshoSummon: "summary",
  pendingTrashOptionalAdds: "summary",
  pendingTriggeredEffects: "summary",
  pendingTurnEndExhaustDowngrades: "engine_internal",
  pendingTurnEndFinalizations: "engine_internal",
  pendingTurnSkips: "summary",
  pendingZoneSelection: "summary",
} as const satisfies Record<
  Extract<keyof GameState, `pending${string}`>,
  AiObservationPendingFieldRole
>;

export type AiStaticCardFeatureFieldRole =
  | "feature"
  | "mechanic_feature"
  | "effect_feature"
  | "visual"
  | "metadata"
  | "external_id";

export const AI_STATIC_CARD_FEATURE_FIELD_ROLES = {
  accelData: "mechanic_feature",
  additionalBraveSlot: "mechanic_feature",
  adventData: "mechanic_feature",
  allowMainStepBraveCombine: "mechanic_feature",
  attackAlternativeFlip: "mechanic_feature",
  backFace: "mechanic_feature",
  braveCondition: "mechanic_feature",
  braveLimitExemption: "mechanic_feature",
  cardNo: "feature",
  changeData: "mechanic_feature",
  colors: "feature",
  combinedBoost: "mechanic_feature",
  continuousSummonCondition: "mechanic_feature",
  contractCombineData: "mechanic_feature",
  contractCombineProxyData: "mechanic_feature",
  cost: "feature",
  displayCostText: "feature",
  dualHostAdventData: "mechanic_feature",
  effects: "effect_feature",
  grandstoneData: "mechanic_feature",
  grandwalkerData: "mechanic_feature",
  hostDualAdventGrant: "mechanic_feature",
  trashAdventHostGrant: "mechanic_feature",
  image: "visual",
  imaginBraveData: "mechanic_feature",
  isDoubleSided: "mechanic_feature",
  keywordTags: "feature",
  levelDefs: "feature",
  linkAidData: "mechanic_feature",
  manifestData: "mechanic_feature",
  maxCombinedBraves: "mechanic_feature",
  maxDeckCount: "metadata",
  maxTokenDeckCount: "mechanic_feature",
  mirageData: "mechanic_feature",
  name: "feature",
  orikaId: "external_id",
  orikaIndex: "external_id",
  overCount: "mechanic_feature",
  pack: "metadata",
  printedCategory: "feature",
  printedOverCount: "visual",
  quartzData: "mechanic_feature",
  quartzHostData: "mechanic_feature",
  rarity: "metadata",
  reductionSymbols: "feature",
  relatedTokenCardNos: "mechanic_feature",
  sourceConfidence: "metadata",
  sourceUrls: "metadata",
  summonCondition: "mechanic_feature",
  symbolColors: "feature",
  symbolColorEntries: "feature",
  tenshoSummon: "mechanic_feature",
  textLines: "feature",
  tokenIndependentCoreManagement: "mechanic_feature",
  tribe: "feature",
  underCardSlots: "mechanic_feature",
  zeroCounterData: "mechanic_feature",
} as const satisfies Record<keyof CardDefinition, AiStaticCardFeatureFieldRole>;

export interface AiStaticCardFeatures {
  cardNo: string;
  name: string;
  category: CardDefinition["printedCategory"];
  colors: readonly string[];
  cost: number;
  displayCostText?: string;
  reductionSymbols: readonly string[];
  printedSymbols: readonly string[];
  printedSymbolEntries?: readonly (readonly string[])[];
  levelDefs: readonly CardDefinition["levelDefs"][number][];
  keywordTags: readonly string[];
  tribe?: string;
  mechanicTags: readonly string[];
  effectActionKinds: readonly string[];
}

export interface AiPlayerFeatures {
  playerId: string;
  relative: AiRelativePlayer;
  isActivePlayer: boolean;
  isTurnOrderFirst: boolean;
  lifeNormalCoreCount: number;
  reserveNormalCoreCount: number;
  trashNormalCoreCount: number;
  voidNormalCoreCount: number;
  reserveSoulCoreCount: number;
  trashSoulCoreCount: number;
  lifeSoulCoreCount: number;
  soulCoreLocationKind: PlayerState["soulCoreLocation"] extends infer T
    ? T extends { kind: infer K }
      ? K
      : "none"
    : "none";
  /** Public physical field reference for the legacy ownership location. Missing
   * in older observations; null when no field reference can be observed.
   * Hidden-zone IDs must never enter this field.
   */
  soulCoreCardInstanceId?: string | null;
  countValue: number;
  /** Public count buckets. Missing in old observations; absence must not be
   * interpreted as unprotected when reconstructing an engine player.
   */
  protectedCounts?: Readonly<Record<string, number>>;
  deckCount: number;
  handCount: number;
  burstSetCount: number;
  mirageSetCount: number;
  quartzSetCount: number;
  /** Public action history, independent of current slot occupancy. Absent in
   * older snapshots; a search reconstruction must not treat absence as unused.
   * This excludes card/effect usage keys, which can contain secret identities. */
  setUsageThisTurn?: {
    burst: boolean;
    mirage: boolean;
    mirageCountExemptionCardNos: string[];
  };
  soulStateCount: number;
  /** Public face-up field membership only. Missing in older observations;
   * a filtered/missing reference must not be inferred from soulStateCount.
   */
  soulStateCardInstanceIds?: readonly string[];
  /** Public presentation, not the private pregame candidate or deck adoption. */
  contractCardNo: string | null;
  ownDeckCardNoCounts?: Readonly<Record<string, number>>;
}

export interface AiActiveAttackSummary {
  attackId: string;
  primaryEntityId: string;
  participantEntityIds: readonly string[];
  groupMode: ActiveAttack["groupMode"];
  target: ActiveAttack["target"];
  blockAssignments: ActiveAttack["blockAssignments"];
  symbolResolutionOrder: readonly string[];
  flashBeforeBlockCompleted: boolean;
  flashAfterBlockCompleted: boolean;
}

export interface AiGlobalFeatures {
  turnNumber: number;
  /** Public clock/seat order for partial search-world reconstruction. Missing
   * on older snapshots; the search component must reject that absence. */
  turnClock?: {
    stepSequence: number;
    turnNumberHighWaterMark: number;
    playerOrder: readonly AiRelativePlayer[];
  };
  /** Public ordered step reservations only, never an interrupted-turn snapshot.
   * Older observations omit this; search reconstruction must reject absence. */
  stepProgression?: {
    pendingExtraSteps: readonly GameState["step"][];
    stepContinuation: readonly GameState["step"][];
  };
  /** Public schedule; flags mark return snapshots that this partial component
   * cannot reconstruct. No returnContext or secret instance IDs are included. */
  turnSchedule?: AiSearchTurnSchedule;
  step: GameState["step"];
  window: GameState["window"];
  activePlayer: AiRelativePlayer;
  activePlayerId: string;
  priorityPlayer: AiRelativePlayer | null;
  priorityPlayerId: string | null;
  preGamePhase: GameState["preGame"] extends infer T
    ? T extends { phase: infer P }
      ? P
      : null
    : null;
  stackWindowOpen: boolean;
  preDeclarationWindowOpen: boolean;
  battleFlashWindowOpen: boolean;
  activeAttack: AiActiveAttackSummary | null;
  gameResultKind: GameState["gameResult"] extends infer T
    ? T extends { kind: infer K }
      ? K
      : null
    : null;
}

export interface AiCardToken {
  tokenId: number;
  instanceId?: string;
  owner: AiRelativePlayer;
  ownerPlayerId: string;
  controller: AiRelativePlayer;
  controllerPlayerId: string;
  zone: Zone;
  zoneRoleName: string;
  identityVisibility: AiCardIdentityVisibility;
  cardNoOrUnknown: string;
  /** Visible face-up field provenance only. Absent for concealed cards and old
   * observations; it must not be inferred from a historical disclosure. */
  originalCardNo?: string;
  faceDown: boolean;
  exhausted: boolean;
  exhaustState: CardInstance["exhaustState"];
  normalCoreCount: number;
  soulCoreCount: number;
  /** 0 is padding when identityVisibility is unknown, not a rule-level minimum. */
  minimumRequiredCores: number;
  pendingLeaveKind: CardInstance["pendingLeaveKind"];
  effectiveLevel?: number;
  effectiveBp?: number;
  effectiveSymbols: readonly SymbolColor[];
  effectiveSymbolBundles: readonly SymbolBundle[];
  effectiveColors: readonly string[];
  effectiveTribes: readonly string[];
  effectiveCategory?: CardDefinition["printedCategory"];
  combinedUnitBp?: number;
  combinedUnitSymbols?: readonly SymbolColor[];
  combinedUnitSymbolBundles?: readonly SymbolBundle[];
  attachedToInstanceId?: string;
  attachedChildrenIds: readonly string[];
  /** Explicit null distinguishes an observed empty right slot from old tokens
   * that did not project Imagin relationships. Only visible field cards carry it. */
  imaginRightCombinedWith?: string | null;
  underCardCount: number;
  deckIndexFromTop?: number;
  deckIndexFromBottom?: number;
}

export interface AiKnownDeckEntry extends Pick<
  KnownDeckCard,
  | "playerId"
  | "indexFromBottom"
  | "definitionIdSnapshot"
  | "audience"
  | "actorPlayerId"
> {
  owner: AiRelativePlayer;
}

export interface AiPublicMemory {
  disclosures: readonly PublicDisclosure[];
}

export interface AiPendingSummary {
  activeKinds: readonly (keyof typeof AI_OBSERVATION_PENDING_FIELD_ROLES)[];
  resolverPlayerIds: readonly string[] | null;
  resolverPlayers: readonly AiRelativePlayer[] | null;
}

export interface AiObservation {
  schemaVersion: typeof AI_OBSERVATION_SCHEMA_VERSION;
  mode: AiObservationMode;
  viewpointPlayerId: string;
  global: AiGlobalFeatures;
  players: readonly AiPlayerFeatures[];
  cards: readonly AiCardToken[];
  publicMemory: AiPublicMemory;
  knownDeck: readonly AiKnownDeckEntry[];
  pending: AiPendingSummary;
}

export interface BuildAiObservationOptions {
  state: GameState;
  viewpointPlayerId: string;
  mode?: AiObservationMode;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}

export function buildStaticCardFeatures(
  definition: CardDefinition
): AiStaticCardFeatures {
  return {
    cardNo: definition.cardNo,
    name: definition.name,
    category: definition.printedCategory,
    colors: [...definition.colors],
    cost: definition.cost,
    ...(definition.displayCostText !== undefined
      ? { displayCostText: definition.displayCostText }
      : {}),
    reductionSymbols: [...definition.reductionSymbols],
    printedSymbols: [...definition.symbolColors],
    ...(definition.symbolColorEntries
      ? {
          printedSymbolEntries: definition.symbolColorEntries.map((entry) => [
            ...entry,
          ]),
        }
      : {}),
    levelDefs: definition.levelDefs.map((level) => ({ ...level })),
    keywordTags: [...(definition.keywordTags ?? [])],
    ...(definition.tribe !== undefined ? { tribe: definition.tribe } : {}),
    mechanicTags: collectMechanicTags(definition),
    effectActionKinds: collectEffectActionKinds(definition),
  };
}

export function buildAiObservation(
  options: BuildAiObservationOptions
): AiObservation {
  const mode = options.mode ?? "player";
  const visibleState =
    mode === "player"
      ? sanitizeStateForViewer(options.state, options.viewpointPlayerId)
      : options.state;
  const deckPositions = buildDeckPositions(options.state);
  const priorityPlayerId = getPriorityPlayerId(visibleState);
  const resolverPlayerIds = getPendingPromptResolverPlayerIds(visibleState);

  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    mode,
    viewpointPlayerId: options.viewpointPlayerId,
    global: buildGlobalFeatures(
      visibleState,
      options.viewpointPlayerId,
      priorityPlayerId
    ),
    players: visibleState.players.map((player) =>
      buildPlayerFeatures({
        visibleState,
        rawState: options.state,
        player,
        viewpointPlayerId: options.viewpointPlayerId,
        mode,
      })
    ),
    cards: buildCardTokens({
      visibleState,
      rawState: options.state,
      viewpointPlayerId: options.viewpointPlayerId,
      mode,
      getCardDefinitionById: options.getCardDefinitionById,
      deckPositions,
    }),
    publicMemory: {
      disclosures: [...(visibleState.publicDisclosures ?? [])],
    },
    knownDeck: (visibleState.knownDeckCards ?? []).map((entry) => ({
      ...entry,
      owner: relativePlayer(entry.playerId, options.viewpointPlayerId),
    })),
    pending: {
      activeKinds: collectActivePendingKinds(visibleState),
      resolverPlayerIds:
        resolverPlayerIds === null ? null : [...resolverPlayerIds].sort(),
      resolverPlayers:
        resolverPlayerIds === null
          ? null
          : [...resolverPlayerIds]
              .sort()
              .map((playerId) =>
                relativePlayer(playerId, options.viewpointPlayerId)
              ),
    },
  };
}

function buildGlobalFeatures(
  state: GameState,
  viewpointPlayerId: string,
  priorityPlayerId: string | null
): AiGlobalFeatures {
  const battleFlashWindowOpen =
    state.activeAttack?.flashWindowState !== undefined &&
    state.activeAttack.flashWindowState !== null;
  const schedulePlayer = (id: string): AiRelativePlayer => {
    if (!state.players.some((p) => p.id === id))
      throw new Error("unknown observed turn schedule player");
    return relativePlayer(id, viewpointPlayerId);
  };
  return {
    turnNumber: state.turnNumber,
    turnClock: {
      stepSequence: state.stepSequence ?? 0,
      turnNumberHighWaterMark: Math.max(
        state.turnNumber,
        state.turnNumberHighWaterMark ?? 0
      ),
      playerOrder: state.playerOrder.map((id) =>
        relativePlayer(id, viewpointPlayerId)
      ),
    },
    stepProgression: {
      pendingExtraSteps: [...(state.pendingExtraSteps ?? [])],
      stepContinuation: [...(state.stepContinuation ?? [])],
    },
    turnSchedule: {
      pendingExtraTurn: state.pendingExtraTurn
        ? {
            owner: schedulePlayer(state.pendingExtraTurn.ownerPlayerId),
            skipSteps: [...state.pendingExtraTurn.skipSteps],
          }
        : null,
      extraTurn: state.extraTurnState
        ? {
            owner: schedulePlayer(state.extraTurnState.ownerPlayerId),
            skipSteps: [...state.extraTurnState.skipSteps],
            nextPlayer:
              state.extraTurnState.nextPlayerId === undefined
                ? null
                : schedulePlayer(state.extraTurnState.nextPlayerId),
            hasReturnContext: state.extraTurnState.returnContext !== null,
            deferredStart: state.extraTurnState.deferredStart === true,
          }
        : null,
      pendingTurnSkips: (state.pendingTurnSkips ?? []).map(schedulePlayer),
    },
    step: state.step,
    window: state.window,
    activePlayer: relativePlayer(state.activePlayerId, viewpointPlayerId),
    activePlayerId: state.activePlayerId,
    priorityPlayer:
      priorityPlayerId === null
        ? null
        : relativePlayer(priorityPlayerId, viewpointPlayerId),
    priorityPlayerId,
    preGamePhase: state.preGame?.phase ?? null,
    stackWindowOpen: state.stackWindow !== null,
    preDeclarationWindowOpen: state.preDeclarationStackWindow !== null,
    battleFlashWindowOpen,
    activeAttack: state.activeAttack
      ? {
          attackId: state.activeAttack.attackId,
          primaryEntityId: state.activeAttack.primaryEntityId,
          participantEntityIds: [...state.activeAttack.participantEntityIds],
          groupMode: state.activeAttack.groupMode,
          target: state.activeAttack.target,
          blockAssignments: state.activeAttack.blockAssignments.map(
            (assignment) => ({
              ...assignment,
              blockedByEntityIds: [...assignment.blockedByEntityIds],
            })
          ),
          symbolResolutionOrder: [...state.activeAttack.symbolResolutionOrder],
          flashBeforeBlockCompleted:
            state.activeAttack.flashBeforeBlockCompleted,
          flashAfterBlockCompleted: state.activeAttack.flashAfterBlockCompleted,
        }
      : null,
    gameResultKind: state.gameResult?.kind ?? null,
  };
}

function buildPlayerFeatures(args: {
  visibleState: GameState;
  rawState: GameState;
  player: PlayerState;
  viewpointPlayerId: string;
  mode: AiObservationMode;
}): AiPlayerFeatures {
  const { visibleState, rawState, player, viewpointPlayerId, mode } = args;
  const playerId = player.id;
  // Player observations have no registered-list / movement-belief input yet.
  // Raw remaining deck identities are not a substitute for that knowledge.
  // Use only viewer-sanitized slots when they cover the entire own deck.
  const ownDeckCardNoCounts =
    mode !== "player"
      ? collectDeckCardNoCounts(rawState, playerId)
      : playerId === viewpointPlayerId
        ? collectFullyKnownDeckCardNoCounts(visibleState, player)
        : undefined;
  const soulCoreCardInstanceId =
    player.soulCoreLocation?.kind === "card"
      ? player.soulCoreLocation.instanceId
      : null;
  return {
    playerId,
    relative: relativePlayer(playerId, viewpointPlayerId),
    isActivePlayer: visibleState.activePlayerId === playerId,
    isTurnOrderFirst: visibleState.playerOrder[0] === playerId,
    lifeNormalCoreCount: player.lifeNormalCoreCount,
    reserveNormalCoreCount: player.reserveNormalCoreCount,
    trashNormalCoreCount: player.trashNormalCoreCount,
    voidNormalCoreCount: player.voidNormalCoreCount,
    reserveSoulCoreCount: player.reserveSoulCoreCount,
    trashSoulCoreCount: player.trashSoulCoreCount,
    lifeSoulCoreCount: player.lifeSoulCoreCount,
    soulCoreLocationKind: player.soulCoreLocation?.kind ?? "none",
    soulCoreCardInstanceId:
      soulCoreCardInstanceId !== null &&
      visibleState.cardInstances.some(
        (card) =>
          card.instanceId === soulCoreCardInstanceId && card.zone === "field"
      )
        ? soulCoreCardInstanceId
        : null,
    countValue: player.countValue,
    protectedCounts: { ...player.protectedCounts },
    deckCount: player.deckCount,
    handCount: player.handCount,
    burstSetCount: (visibleState.setBurstStates ?? []).filter(
      (entry) => entry.playerId === playerId
    ).length,
    mirageSetCount: (visibleState.mirageSetStates ?? []).filter(
      (entry) => entry.playerId === playerId
    ).length,
    quartzSetCount: (visibleState.quartzSetStates ?? []).filter(
      (entry) => entry.ownerPlayerId === playerId
    ).length,
    setUsageThisTurn: {
      burst: visibleState.burstSetPlayerIdsThisTurn.includes(playerId),
      mirage: visibleState.mirageSetPlayerIdsThisTurn.includes(playerId),
      mirageCountExemptionCardNos: visibleState.mirageSetCountExemptionsUsed
        .filter((entry) => entry.playerId === playerId)
        .map((entry) => entry.cardNo)
        .sort(),
    },
    soulStateCount: player.soulStateInstanceIds.length,
    soulStateCardInstanceIds: player.soulStateInstanceIds.filter((id) =>
      visibleState.cardInstances.some(
        (card) =>
          card.instanceId === id &&
          card.zone === "field" &&
          !card.faceDown &&
          card.definitionId !== HIDDEN_CARD_ID
      )
    ),
    // The sanitized player retains presentation after the card enters hand.
    // Never derive it from a private pregame candidate or current card location.
    contractCardNo: player.contractCardNo,
    ...(ownDeckCardNoCounts !== undefined ? { ownDeckCardNoCounts } : {}),
  };
}

function buildCardTokens(args: {
  visibleState: GameState;
  rawState: GameState;
  viewpointPlayerId: string;
  mode: AiObservationMode;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  deckPositions: ReadonlyMap<
    string,
    { deckIndexFromTop: number; deckIndexFromBottom: number }
  >;
}): AiCardToken[] {
  const tokens: AiCardToken[] = [];
  for (const card of args.visibleState.cardInstances) {
    const hidden = card.definitionId === HIDDEN_CARD_ID;
    if (!shouldIncludeCardToken(card, hidden, args.mode)) continue;

    const definition = hidden
      ? undefined
      : args.getCardDefinitionById(card.definitionId);
    const deckPosition = args.deckPositions.get(card.instanceId);
    const token = buildCardToken({
      tokenId: tokens.length,
      state: args.visibleState,
      card,
      definition,
      hidden,
      viewpointPlayerId: args.viewpointPlayerId,
      mode: args.mode,
      getCardDefinitionById: args.getCardDefinitionById,
      ...(deckPosition !== undefined ? { deckPosition } : {}),
    });
    tokens.push(token);
  }
  return tokens;
}

function buildCardToken(args: {
  tokenId: number;
  state: GameState;
  card: CardInstance;
  definition: CardDefinition | undefined;
  hidden: boolean;
  viewpointPlayerId: string;
  mode: AiObservationMode;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  deckPosition?: { deckIndexFromTop: number; deckIndexFromBottom: number };
}): AiCardToken {
  const {
    tokenId,
    state,
    card,
    definition,
    hidden,
    viewpointPlayerId,
    mode,
    getCardDefinitionById,
    deckPosition,
  } = args;
  // A concealed face-down field card has no printed identity, but public grants
  // remain meaningful (04c). Resolve them from the sanitized state using the
  // same null-identity definition as legal targeting; never recover its real def.
  const identityDefinition =
    definition ??
    (hidden && card.faceDown && card.zone === "field"
      ? getCardDefinitionForEffectiveFieldCard(card, getCardDefinitionById)
      : undefined);
  const identity = identityDefinition
    ? resolveEffectiveIdentity(
        state,
        card,
        identityDefinition,
        getCardDefinitionById
      )
    : undefined;
  const combined =
    definition && card.zone === "field" && card.attachedToInstanceId === null
      ? resolveCombinedUnitFeatures(
          state,
          card,
          definition,
          getCardDefinitionById
        )
      : undefined;
  const definitionId = definition?.cardNo ?? card.definitionId;

  return {
    tokenId,
    instanceId: card.instanceId,
    owner: relativePlayer(card.ownerPlayerId, viewpointPlayerId),
    ownerPlayerId: card.ownerPlayerId,
    controller: relativePlayer(card.controllerPlayerId, viewpointPlayerId),
    controllerPlayerId: card.controllerPlayerId,
    zone: card.zone,
    // These mechanical fields retain printed identity even after the common
    // sanitizer masks definitionId. Unknown tokens must not expose that data.
    zoneRoleName: hidden ? card.zone : card.zoneRoleName,
    identityVisibility: hidden ? "unknown" : "known",
    cardNoOrUnknown: hidden ? AI_UNKNOWN_CARD : definitionId,
    faceDown: card.faceDown === true,
    exhausted: card.exhaustState !== "recovered",
    exhaustState: card.exhaustState,
    normalCoreCount: card.normalCoreCount,
    soulCoreCount: card.soulCoreCount,
    minimumRequiredCores: hidden ? 0 : card.minimumRequiredCores,
    pendingLeaveKind: card.pendingLeaveKind,
    ...(identity !== undefined
      ? {
          effectiveLevel: identity.level,
          effectiveBp: identity.bp,
          effectiveSymbols: [...identity.symbols],
          effectiveSymbolBundles: cloneSymbolBundles(identity.symbolBundles),
          effectiveColors: [...identity.colors],
          effectiveTribes: [...identity.tribes],
          ...(identity.category !== undefined
            ? { effectiveCategory: identity.category }
            : {}),
        }
      : {
          effectiveSymbols: [],
          effectiveSymbolBundles: [],
          effectiveColors: [],
          effectiveTribes: [],
        }),
    ...(combined !== undefined ? combined : {}),
    ...(card.attachedToInstanceId !== null
      ? { attachedToInstanceId: card.attachedToInstanceId }
      : {}),
    attachedChildrenIds: [...card.attachedChildrenIds],
    ...(card.zone === "field" && !hidden && !card.faceDown
      ? {
          imaginRightCombinedWith: card.imaginRightCombinedWith,
          originalCardNo: card.originalDefinitionId,
        }
      : {}),
    underCardCount: card.underCards?.length ?? 0,
    ...(mode !== "player" && deckPosition !== undefined ? deckPosition : {}),
  };
}

function resolveCombinedUnitFeatures(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): Pick<
  AiCardToken,
  "combinedUnitBp" | "combinedUnitSymbols" | "combinedUnitSymbolBundles"
> {
  const bundles = getCombinedUnitSymbolBundles(
    state,
    card,
    definition,
    getCardDefinitionById
  );
  return {
    combinedUnitBp: getCombinedUnitBp(
      state,
      card,
      definition,
      getCardDefinitionById
    ),
    combinedUnitSymbols: flattenSymbolBundles(bundles),
    combinedUnitSymbolBundles: cloneSymbolBundles(bundles),
  };
}

function shouldIncludeCardToken(
  card: CardInstance,
  hidden: boolean,
  mode: AiObservationMode
): boolean {
  if (mode !== "player") return true;
  if (!hidden) return card.zone !== "deck";
  return (
    card.zone === "field" ||
    card.zone === "burst" ||
    card.zone === "mirage" ||
    card.zone === "set_aside" ||
    card.zone === "count_area"
  );
}

function collectActivePendingKinds(
  state: GameState
): (keyof typeof AI_OBSERVATION_PENDING_FIELD_ROLES)[] {
  return (
    Object.entries(AI_OBSERVATION_PENDING_FIELD_ROLES) as [
      keyof typeof AI_OBSERVATION_PENDING_FIELD_ROLES,
      AiObservationPendingFieldRole,
    ][]
  )
    .filter(([, role]) => role === "summary")
    .filter(([field]) => isActivePendingValue(state[field]))
    .map(([field]) => field)
    .sort();
}

function isActivePendingValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function getPriorityPlayerId(state: GameState): string | null {
  return (
    state.stackWindow?.priorityPlayerId ??
    state.preDeclarationStackWindow?.priorityPlayerId ??
    state.activeAttack?.flashWindowState?.priorityPlayerId ??
    null
  );
}

function buildDeckPositions(
  state: GameState
): Map<string, { deckIndexFromTop: number; deckIndexFromBottom: number }> {
  const byPlayer = new Map<string, CardInstance[]>();
  for (const card of state.cardInstances) {
    if (card.zone !== "deck") continue;
    const cards = byPlayer.get(card.ownerPlayerId) ?? [];
    cards.push(card);
    byPlayer.set(card.ownerPlayerId, cards);
  }

  const positions = new Map<
    string,
    { deckIndexFromTop: number; deckIndexFromBottom: number }
  >();
  for (const cards of byPlayer.values()) {
    cards.forEach((card, deckIndexFromTop) => {
      positions.set(card.instanceId, {
        deckIndexFromTop,
        deckIndexFromBottom: cards.length - 1 - deckIndexFromTop,
      });
    });
  }
  return positions;
}

function collectFullyKnownDeckCardNoCounts(
  visibleState: GameState,
  player: PlayerState
): Readonly<Record<string, number>> | undefined {
  const entries = (visibleState.knownDeckCards ?? []).filter(
    (entry) => entry.playerId === player.id
  );
  // Never represent partial knowledge as an exact remaining multiset. The
  // individual known positions still leave through observation.knownDeck.
  if (
    !Number.isSafeInteger(player.deckCount) ||
    player.deckCount < 0 ||
    entries.length !== player.deckCount ||
    new Set(entries.map((entry) => entry.indexFromBottom)).size !==
      player.deckCount ||
    entries.some(
      (entry) =>
        !Number.isSafeInteger(entry.indexFromBottom) ||
        entry.indexFromBottom < 0 ||
        entry.indexFromBottom >= player.deckCount
    )
  )
    return undefined;
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(
      entry.definitionIdSnapshot,
      (counts.get(entry.definitionIdSnapshot) ?? 0) + 1
    );
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

// Full-information/debug modes only. Player mode never calls this raw scan.
function collectDeckCardNoCounts(
  state: GameState,
  playerId: string
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const card of state.cardInstances) {
    if (card.ownerPlayerId !== playerId || card.zone !== "deck") continue;
    if (card.definitionId === HIDDEN_CARD_ID) continue;
    counts[card.definitionId] = (counts[card.definitionId] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  );
}

function relativePlayer(
  playerId: string,
  viewpointPlayerId: string
): AiRelativePlayer {
  return playerId === viewpointPlayerId ? "me" : "opp";
}

function cloneSymbolBundles(bundles: readonly SymbolBundle[]): SymbolBundle[] {
  return bundles.map((bundle) => ({
    colors: [...bundle.colors],
    count: bundle.count,
  }));
}

function flattenSymbolBundles(bundles: readonly SymbolBundle[]): SymbolColor[] {
  return bundles.flatMap((bundle) =>
    Array.from({ length: bundle.count }, () => bundle.colors).flat()
  );
}

function collectMechanicTags(definition: CardDefinition): string[] {
  const tags = new Set<string>();
  if (definition.isDoubleSided || definition.backFace) tags.add("double_sided");
  if (
    definition.braveCondition ||
    definition.combinedBoost !== undefined ||
    definition.maxCombinedBraves !== undefined ||
    definition.additionalBraveSlot
  ) {
    tags.add("brave");
  }
  if (definition.adventData || definition.dualHostAdventData) {
    tags.add("advent");
  }
  if (definition.contractCombineData || definition.contractCombineProxyData) {
    tags.add("contract_combine");
  }
  if (definition.linkAidData) tags.add("link_aid");
  if (definition.manifestData) tags.add("manifest");
  if (definition.accelData) tags.add("accel");
  if (definition.changeData) tags.add("change");
  if (definition.mirageData) tags.add("mirage");
  if (definition.grandwalkerData) tags.add("grandwalker");
  if (definition.grandstoneData) tags.add("grandstone");
  if (definition.zeroCounterData) tags.add("zero_counter");
  if (definition.imaginBraveData) tags.add("imagin_brave");
  if (definition.quartzData || definition.quartzHostData) tags.add("quartz");
  if (definition.tenshoSummon) tags.add("tensho");
  if (definition.summonCondition) tags.add("summon_condition");
  return [...tags].sort();
}

function collectEffectActionKinds(definition: CardDefinition): string[] {
  const kinds = new Set<string>();
  const visitStep = (step: EffectStep): void => {
    kinds.add(step.action.kind);
    for (const choice of step.choice ?? []) visitStep(choice);
  };
  const visitEffect = (effect: Effect): void => {
    for (const step of effect.steps) visitStep(step);
  };
  for (const effect of definition.effects ?? []) visitEffect(effect);
  for (const effect of definition.backFace?.effects ?? []) visitEffect(effect);
  for (const skill of definition.grandwalkerData?.divineSkills ?? []) {
    for (const effect of skill.effects ?? []) visitEffect(effect);
  }
  return [...kinds].sort();
}
