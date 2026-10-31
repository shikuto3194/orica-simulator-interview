import {
  AI_OBSERVATION_SCHEMA_VERSION,
  AI_UNKNOWN_CARD,
  type AI_OBSERVATION_PENDING_FIELD_ROLES,
  type AiCardIdentityVisibility,
  type AiCardToken,
  type AiKnownDeckEntry,
  type AiObservation,
  type AiPlayerFeatures,
  type AiRelativePlayer,
} from "./ai-observation";
import {
  CARD_COLORS,
  type CardCategory,
  type ExhaustState,
  type GameResult,
  type PendingLeaveKind,
  type PreGamePhase,
  type PublicDisclosureAudience,
  type Step,
  type SymbolColor,
  type Window,
  type Zone,
} from "./model";

export const AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION = 1;
export const AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION = 2;
export const AI_OBSERVATION_ENCODER_SCHEMA_VERSION = 3;
export type AiObservationEncoderSchemaVersion =
  | typeof AI_OBSERVATION_ENCODER_LEGACY_SCHEMA_VERSION
  | typeof AI_OBSERVATION_ENCODER_DISCLOSURE_SCHEMA_VERSION
  | typeof AI_OBSERVATION_ENCODER_SCHEMA_VERSION;
export const AI_OBSERVATION_ENCODER_DEFAULT_MAX_CARDS = 160;
export const AI_OBSERVATION_ENCODER_DEFAULT_MAX_KNOWN_DECK_ENTRIES = 64;

export const AI_OBSERVATION_ENCODER_STEP_DOMAIN = [
  "start",
  "core",
  "draw",
  "refresh",
  "main",
  "attack",
  "end",
] as const satisfies readonly Step[];

export const AI_OBSERVATION_ENCODER_WINDOW_DOMAIN = [
  "none",
  "stack",
  "step_start",
  "declare_attack",
  "pre_declaration_stack",
  "flash_before_block",
  "stack_before_block",
  "declare_block",
  "flash_after_block",
  "stack_after_block",
  "battle_resolution",
  "step_end",
  "end_step_effects",
  "end_step_end_effects",
  "end_step_cleanup",
] as const satisfies readonly Window[];

export const AI_OBSERVATION_ENCODER_ZONE_DOMAIN = [
  "deck",
  "hand",
  "revealed",
  "set_aside",
  "burst",
  "field",
  "trash",
  "life",
  "reserve",
  "void",
  "removed_from_game",
  "in_use",
  "mirage",
  "count_area",
  "token_pool",
] as const satisfies readonly Zone[];

export const AI_OBSERVATION_ENCODER_EXHAUST_DOMAIN = [
  "recovered",
  "exhausted",
  "heavily_exhausted",
] as const satisfies readonly ExhaustState[];

export const AI_OBSERVATION_ENCODER_PENDING_LEAVE_DOMAIN = [
  "destroy",
  "vanish",
  "bounce",
  "remove_from_game",
  "rule_cleanup",
] as const satisfies readonly PendingLeaveKind[];

export const AI_OBSERVATION_ENCODER_PRE_GAME_PHASE_DOMAIN = [
  "waiting_contract",
  "contract_confirm",
  "waiting_janken",
  "janken_resolved",
  "waiting_order_pick",
  "order_decided",
  "waiting_mulligan_first",
  "waiting_mulligan_second",
  "pregame_complete",
] as const satisfies readonly PreGamePhase[];

export const AI_OBSERVATION_ENCODER_GAME_RESULT_KIND_DOMAIN = [
  "player_loss",
  "draw",
] as const satisfies readonly GameResult["kind"][];

export const AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN = [
  "me",
  "opp",
] as const satisfies readonly AiRelativePlayer[];

/** Schema v3 inserts this zone bit; v1/v2 checkpoints omit it. */
export const AI_OBSERVATION_CARD_TOKEN_POOL_ZONE_INDEX =
  2 * AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN.length +
  AI_OBSERVATION_ENCODER_ZONE_DOMAIN.indexOf("token_pool");

/**
 * The public-disclosure presence feature is retained at this fixed global
 * offset so a versioned legacy-checkpoint adapter can map it to schema v1's
 * disclosure-count ratio without changing the tensor width.
 */
export const AI_OBSERVATION_GLOBAL_PUBLIC_DISCLOSURE_HISTORY_INDEX =
  1 +
  AI_OBSERVATION_ENCODER_STEP_DOMAIN.length +
  AI_OBSERVATION_ENCODER_WINDOW_DOMAIN.length +
  AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN.length +
  (AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN.length + 1) +
  (AI_OBSERVATION_ENCODER_PRE_GAME_PHASE_DOMAIN.length + 1) +
  4 +
  4 +
  (AI_OBSERVATION_ENCODER_GAME_RESULT_KIND_DOMAIN.length + 1);

export const AI_OBSERVATION_ENCODER_SOUL_CORE_LOCATION_DOMAIN = [
  "none",
  "card",
  "reserve",
  "trash",
  "life",
  "removed_from_game",
] as const satisfies readonly AiPlayerFeatures["soulCoreLocationKind"][];

export const AI_OBSERVATION_ENCODER_IDENTITY_VISIBILITY_DOMAIN = [
  "known",
  "unknown",
  "public_memory",
] as const satisfies readonly AiCardIdentityVisibility[];

export const AI_OBSERVATION_ENCODER_CATEGORY_DOMAIN = [
  "spirit",
  "brave",
  "ultimate",
  "nexus",
  "magic",
] as const satisfies readonly CardCategory[];

export const AI_OBSERVATION_ENCODER_SYMBOL_DOMAIN = [
  ...CARD_COLORS,
  "god",
  "guide",
  "ultimate_symbol",
  "seven",
  "six",
] as const satisfies readonly SymbolColor[];

export const AI_OBSERVATION_ENCODER_DISCLOSURE_AUDIENCE_DOMAIN = [
  "both",
  "actor_only",
  "opponent_only",
] as const satisfies readonly PublicDisclosureAudience[];

export const AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN = [
  "pendingAccelCleanups",
  "pendingAdditionalAttackGrants",
  "pendingAdventSourceReplacement",
  "pendingBattleEndDeferrals",
  "pendingBorrowedEffectChoice",
  "pendingBorrowedEffectTargetSelection",
  "pendingBraveAttackContinuation",
  "pendingBraveCombineChoice",
  "pendingBraveLeaveChoice",
  "pendingBurstChecks",
  "pendingChangeCleanupChoice",
  "pendingConnectBattleDecision",
  "pendingCoreCountSelection",
  "pendingCoreDistribution",
  "pendingCoreShootSelection",
  "pendingCoreSourceAllocation",
  "pendingLinkAidCostSourceChoice",
  "pendingCoreSplitSelection",
  "pendingCountSelection",
  "pendingDeckReveal",
  "pendingDeckRevealCountBoostChoice",
  "pendingDeckRevealSwapChain",
  "pendingDeferredTriggeredEffects",
  "pendingDiscardSetBurstCountSelection",
  "pendingDrawStepCostChoice",
  "pendingAsIfSoulCoreChoice",
  "pendingEffectOptionalRepeatChoice",
  "pendingEffectOptionalRepeatCountSelection",
  "pendingEffectSummonCostPayment",
  "pendingEffectTargetSelection",
  "pendingEnterFieldPlacement",
  "pendingFieldHandSwapChoice",
  "pendingFieldMagicPreCostTrigger",
  "pendingGroupedSummonCostOverrideChoice",
  "pendingHandTrashSwapChoice",
  "pendingImmediateBattleEnds",
  "pendingLeaveEntities",
  "pendingLifeCoreSelection",
  "pendingLifeDamageDiscardChoice",
  "pendingLifeGainReplacementChoice",
  "pendingMultiPlacement",
  "pendingPayToActCoreGate",
  "pendingPayToActHandDiscardGate",
  "pendingPreDeclarationConfirmation",
  "pendingPrivateDeclarations",
  "pendingReverseRebirthSummon",
  "pendingSetAsideExitReplacementChoice",
  "pendingSoulStateReplacement",
  "pendingSplitSummonChoice",
  "pendingStepChoice",
  "pendingStepOptionalChoice",
  "pendingStepOptionalTargetSelection",
  "pendingStoneFlipCombine",
  "pendingSummonCostCoreMoveChoice",
  "pendingSummonCostExcludeChoice",
  "pendingTargetRedirects",
  "pendingTargetedDisclosureContinuation",
  "pendingTenshoSummon",
  "pendingTrashOptionalAdds",
  "pendingTriggeredEffects",
  "pendingTurnSkips",
  "pendingZoneSelection",
  "pendingImmediateAttackJoins",
] as const satisfies readonly (keyof typeof AI_OBSERVATION_PENDING_FIELD_ROLES)[];

export type AiObservationCardVocabulary =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

export interface EncodeAiObservationOptions {
  observation: AiObservation;
  cardVocabulary?: AiObservationCardVocabulary;
  maxCards?: number;
  maxKnownDeckEntries?: number;
}

export interface EncodedAiCardToken {
  embIndex: number;
  features: number[];
  mask: 0 | 1;
  instanceId?: string;
}

export interface EncodedAiKnownDeckEntry {
  embIndex: number;
  features: number[];
  mask: 0 | 1;
  ownerPlayerId?: string;
  indexFromBottom?: number;
}

export interface EncodedAiObservation {
  schemaVersion: AiObservationEncoderSchemaVersion;
  observationSchemaVersion: typeof AI_OBSERVATION_SCHEMA_VERSION;
  global: number[];
  cards: EncodedAiCardToken[];
  cardMask: number[];
  cardInstanceIds: (string | null)[];
  knownDeck: EncodedAiKnownDeckEntry[];
  knownDeckMask: number[];
  metadata: {
    globalDim: number;
    cardFeatureDim: number;
    knownDeckFeatureDim: number;
    maxCards: number;
    cardCount: number;
    truncatedCardCount: number;
    maxKnownDeckEntries: number;
    knownDeckCount: number;
    truncatedKnownDeckCount: number;
    cardVocabSize: number;
    /** Raw count retained only to adapt schema-v2 frames for legacy models. */
    publicDisclosureHistoryCount: number;
  };
}

const ZERO_CARD_FEATURES = encodeCardFeatures(undefined);
const ZERO_KNOWN_DECK_FEATURES = encodeKnownDeckFeatures(undefined, undefined);

export const AI_OBSERVATION_GLOBAL_FEATURE_DIM = encodeGlobalFeatures(
  emptyObservationForDims()
).length;
export const AI_OBSERVATION_CARD_FEATURE_DIM = ZERO_CARD_FEATURES.length;
export const AI_OBSERVATION_KNOWN_DECK_FEATURE_DIM =
  ZERO_KNOWN_DECK_FEATURES.length;

export function buildAiObservationCardVocabulary(
  cardNos: Iterable<string>
): Map<string, number> {
  const ordered = [...new Set(cardNos)]
    .filter((cardNo) => cardNo !== AI_UNKNOWN_CARD)
    .sort();
  return new Map(ordered.map((cardNo, index) => [cardNo, index + 1]));
}

export function collectKnownCardNosFromAiObservation(
  observation: AiObservation
): string[] {
  const cardNos = new Set<string>();
  for (const card of observation.cards) {
    if (card.cardNoOrUnknown !== AI_UNKNOWN_CARD) {
      cardNos.add(card.cardNoOrUnknown);
    }
  }
  for (const entry of observation.knownDeck) {
    cardNos.add(entry.definitionIdSnapshot);
  }
  for (const player of observation.players) {
    if (player.contractCardNo !== null) cardNos.add(player.contractCardNo);
    for (const cardNo of Object.keys(player.ownDeckCardNoCounts ?? {})) {
      cardNos.add(cardNo);
    }
  }
  return [...cardNos].sort();
}

export function encodeAiObservation(
  options: EncodeAiObservationOptions
): EncodedAiObservation {
  const { observation } = options;
  if (observation.schemaVersion !== AI_OBSERVATION_SCHEMA_VERSION) {
    throw new Error(
      `unsupported AiObservation schemaVersion: ${observation.schemaVersion}`
    );
  }

  const maxCards = normalizeMax(
    "maxCards",
    options.maxCards,
    AI_OBSERVATION_ENCODER_DEFAULT_MAX_CARDS
  );
  const maxKnownDeckEntries = normalizeMax(
    "maxKnownDeckEntries",
    options.maxKnownDeckEntries,
    AI_OBSERVATION_ENCODER_DEFAULT_MAX_KNOWN_DECK_ENTRIES
  );
  const cardVocabulary =
    options.cardVocabulary ??
    buildAiObservationCardVocabulary(
      collectKnownCardNosFromAiObservation(observation)
    );
  const global = encodeGlobalFeatures(observation);
  assertFiniteVector("global", global);

  const cards = observation.cards.slice(0, maxCards).map((card) => {
    const encoded = encodeCardToken(card, cardVocabulary);
    assertFiniteVector(
      `card:${card.instanceId ?? card.tokenId}`,
      encoded.features
    );
    return encoded;
  });
  while (cards.length < maxCards) cards.push(paddedCardToken());

  const knownDeck = observation.knownDeck
    .slice(0, maxKnownDeckEntries)
    .map((entry) => {
      const encoded = encodeKnownDeckEntry(observation, entry, cardVocabulary);
      assertFiniteVector(
        `knownDeck:${entry.playerId}:${entry.indexFromBottom}`,
        encoded.features
      );
      return encoded;
    });
  while (knownDeck.length < maxKnownDeckEntries) {
    knownDeck.push(paddedKnownDeckEntry());
  }

  return {
    schemaVersion: AI_OBSERVATION_ENCODER_SCHEMA_VERSION,
    observationSchemaVersion: observation.schemaVersion,
    global,
    cards,
    cardMask: cards.map((card) => card.mask),
    cardInstanceIds: cards.map((card) => card.instanceId ?? null),
    knownDeck,
    knownDeckMask: knownDeck.map((entry) => entry.mask),
    metadata: {
      globalDim: global.length,
      cardFeatureDim: AI_OBSERVATION_CARD_FEATURE_DIM,
      knownDeckFeatureDim: AI_OBSERVATION_KNOWN_DECK_FEATURE_DIM,
      maxCards,
      cardCount: observation.cards.length,
      truncatedCardCount: Math.max(0, observation.cards.length - maxCards),
      maxKnownDeckEntries,
      knownDeckCount: observation.knownDeck.length,
      truncatedKnownDeckCount: Math.max(
        0,
        observation.knownDeck.length - maxKnownDeckEntries
      ),
      cardVocabSize: vocabularySize(cardVocabulary),
      publicDisclosureHistoryCount: observation.publicMemory.disclosures.length,
    },
  };
}

function encodeGlobalFeatures(observation: AiObservation): number[] {
  const activeAttack = observation.global.activeAttack;
  return [
    ratio(observation.global.turnNumber, 20),
    ...oneHot(observation.global.step, AI_OBSERVATION_ENCODER_STEP_DOMAIN),
    ...oneHot(observation.global.window, AI_OBSERVATION_ENCODER_WINDOW_DOMAIN),
    ...oneHot(
      observation.global.activePlayer,
      AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN
    ),
    ...oneHotNullable(
      observation.global.priorityPlayer,
      AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN
    ),
    ...oneHotNullable(
      observation.global.preGamePhase,
      AI_OBSERVATION_ENCODER_PRE_GAME_PHASE_DOMAIN
    ),
    flag(observation.global.stackWindowOpen),
    flag(observation.global.preDeclarationWindowOpen),
    flag(observation.global.battleFlashWindowOpen),
    flag(activeAttack !== null),
    ratio(activeAttack?.participantEntityIds.length ?? 0, 8),
    ratio(activeAttack?.blockAssignments.length ?? 0, 8),
    flag(activeAttack?.flashBeforeBlockCompleted === true),
    flag(activeAttack?.flashAfterBlockCompleted === true),
    ...oneHotNullable(
      observation.global.gameResultKind,
      AI_OBSERVATION_ENCODER_GAME_RESULT_KIND_DOMAIN
    ),
    // Preserve the global-vector width used by existing checkpoints without
    // leaking an ever-increasing disclosure-history count into policy input.
    // This slot represents only whether a history exists, so it cannot become
    // an append-only time feature.
    flag(observation.publicMemory.disclosures.length > 0),
    ratio(observation.knownDeck.length, 64),
    ...encodePlayerSlot(observation, "me"),
    ...encodePlayerSlot(observation, "opp"),
    ...multiHot(
      observation.pending.activeKinds,
      AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN
    ),
    flag(observation.pending.resolverPlayers !== null),
    flag(observation.pending.resolverPlayers?.includes("me") === true),
    flag(observation.pending.resolverPlayers?.includes("opp") === true),
    ratio(observation.pending.resolverPlayers?.length ?? 0, 2),
  ];
}

function encodePlayerSlot(
  observation: AiObservation,
  relative: AiRelativePlayer
): number[] {
  const player = observation.players.find((candidate) => {
    return candidate.relative === relative;
  });
  if (!player) return zeroes(playerFeatureDim());

  const ownDeckCounts = player.ownDeckCardNoCounts;
  const ownDeckTotal = Object.values(ownDeckCounts ?? {}).reduce(
    (sum, count) => sum + count,
    0
  );
  const ownDeckDistinct = Object.keys(ownDeckCounts ?? {}).length;
  return [
    flag(player.isActivePlayer),
    flag(player.isTurnOrderFirst),
    ratio(player.lifeNormalCoreCount, 8),
    ratio(player.reserveNormalCoreCount, 20),
    ratio(player.trashNormalCoreCount, 20),
    ratio(player.voidNormalCoreCount, 20),
    ratio(player.reserveSoulCoreCount, 1),
    ratio(player.trashSoulCoreCount, 1),
    ratio(player.lifeSoulCoreCount, 1),
    ...oneHot(
      player.soulCoreLocationKind,
      AI_OBSERVATION_ENCODER_SOUL_CORE_LOCATION_DOMAIN
    ),
    ratio(player.countValue, 10),
    ratio(player.deckCount, 60),
    ratio(player.handCount, 20),
    ratio(player.burstSetCount, 4),
    ratio(player.mirageSetCount, 4),
    ratio(player.quartzSetCount, 4),
    ratio(player.soulStateCount, 8),
    flag(player.contractCardNo !== null),
    flag(ownDeckCounts !== undefined),
    ratio(ownDeckTotal, 60),
    ratio(ownDeckDistinct, 60),
  ];
}

function playerFeatureDim(): number {
  return (
    2 + 7 + AI_OBSERVATION_ENCODER_SOUL_CORE_LOCATION_DOMAIN.length + 7 + 1 + 3
  );
}

function encodeCardToken(
  card: AiCardToken,
  cardVocabulary: AiObservationCardVocabulary
): EncodedAiCardToken {
  const base = {
    embIndex: vocabularyIndex(cardVocabulary, card.cardNoOrUnknown),
    features: encodeCardFeatures(card),
    mask: 1 as const,
  };
  return card.instanceId === undefined
    ? base
    : { ...base, instanceId: card.instanceId };
}

function encodeCardFeatures(card: AiCardToken | undefined): number[] {
  return [
    ...oneHot(card?.owner, AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN),
    ...oneHot(card?.controller, AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN),
    ...oneHot(card?.zone, AI_OBSERVATION_ENCODER_ZONE_DOMAIN),
    ...oneHot(
      card?.identityVisibility,
      AI_OBSERVATION_ENCODER_IDENTITY_VISIBILITY_DOMAIN
    ),
    flag(card?.faceDown === true),
    flag(card?.exhausted === true),
    ...oneHot(card?.exhaustState, AI_OBSERVATION_ENCODER_EXHAUST_DOMAIN),
    ratio(card?.normalCoreCount ?? 0, 10),
    ratio(card?.soulCoreCount ?? 0, 2),
    ratio(card?.minimumRequiredCores ?? 0, 8),
    ...oneHotNullable(
      card?.pendingLeaveKind ?? null,
      AI_OBSERVATION_ENCODER_PENDING_LEAVE_DOMAIN
    ),
    ratio(card?.effectiveLevel ?? 0, 6),
    ratio(card?.effectiveBp ?? 0, 20000),
    ...multiHot(
      card?.effectiveSymbols ?? [],
      AI_OBSERVATION_ENCODER_SYMBOL_DOMAIN
    ),
    ratio(card?.effectiveSymbols.length ?? 0, 6),
    ratio(symbolBundleCount(card?.effectiveSymbolBundles), 6),
    ...multiHot(card?.effectiveColors ?? [], CARD_COLORS),
    ratio(card?.effectiveColors.length ?? 0, CARD_COLORS.length),
    ratio(card?.effectiveTribes.length ?? 0, 6),
    ...oneHotNullable(
      card?.effectiveCategory ?? null,
      AI_OBSERVATION_ENCODER_CATEGORY_DOMAIN
    ),
    flag(card?.combinedUnitBp !== undefined),
    ratio(card?.combinedUnitBp ?? 0, 30000),
    ...multiHot(
      card?.combinedUnitSymbols ?? [],
      AI_OBSERVATION_ENCODER_SYMBOL_DOMAIN
    ),
    ratio(card?.combinedUnitSymbols?.length ?? 0, 8),
    ratio(symbolBundleCount(card?.combinedUnitSymbolBundles), 8),
    flag(card?.attachedToInstanceId !== undefined),
    ratio(card?.attachedChildrenIds.length ?? 0, 4),
    ratio(card?.underCardCount ?? 0, 10),
    flag(card?.deckIndexFromTop !== undefined),
    ratio(card?.deckIndexFromTop ?? 0, 60),
    flag(card?.deckIndexFromBottom !== undefined),
    ratio(card?.deckIndexFromBottom ?? 0, 60),
    flag(card?.identityVisibility === "known"),
    flag((card?.soulCoreCount ?? 0) > 0),
  ];
}

function encodeKnownDeckEntry(
  observation: AiObservation,
  entry: AiKnownDeckEntry,
  cardVocabulary: AiObservationCardVocabulary
): EncodedAiKnownDeckEntry {
  const base = {
    embIndex: vocabularyIndex(cardVocabulary, entry.definitionIdSnapshot),
    features: encodeKnownDeckFeatures(observation, entry),
    mask: 1 as const,
    ownerPlayerId: entry.playerId,
    indexFromBottom: entry.indexFromBottom,
  };
  return base;
}

function encodeKnownDeckFeatures(
  observation: AiObservation | undefined,
  entry: AiKnownDeckEntry | undefined
): number[] {
  const ownerDeckCount =
    observation?.players.find((player) => player.playerId === entry?.playerId)
      ?.deckCount ?? 0;
  const indexFromTop =
    entry === undefined
      ? undefined
      : ownerDeckCount - 1 - entry.indexFromBottom;
  return [
    ...oneHot(entry?.owner, AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN),
    ratio(entry?.indexFromBottom ?? 0, 60),
    ratio(indexFromTop ?? 0, 60),
    ...oneHot(
      entry?.audience,
      AI_OBSERVATION_ENCODER_DISCLOSURE_AUDIENCE_DOMAIN
    ),
    ...oneHot(
      observation === undefined || entry === undefined
        ? undefined
        : relativeToViewpoint(
            entry.actorPlayerId,
            observation.viewpointPlayerId
          ),
      AI_OBSERVATION_ENCODER_RELATIVE_PLAYER_DOMAIN
    ),
  ];
}

function paddedCardToken(): EncodedAiCardToken {
  return {
    embIndex: 0,
    features: [...ZERO_CARD_FEATURES],
    mask: 0,
  };
}

function paddedKnownDeckEntry(): EncodedAiKnownDeckEntry {
  return {
    embIndex: 0,
    features: [...ZERO_KNOWN_DECK_FEATURES],
    mask: 0,
  };
}

function emptyObservationForDims(): AiObservation {
  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    mode: "player",
    viewpointPlayerId: "",
    global: {
      turnNumber: 0,
      step: "start",
      window: "none",
      activePlayer: "me",
      activePlayerId: "",
      priorityPlayer: null,
      priorityPlayerId: null,
      preGamePhase: null,
      stackWindowOpen: false,
      preDeclarationWindowOpen: false,
      battleFlashWindowOpen: false,
      activeAttack: null,
      gameResultKind: null,
    },
    players: [],
    cards: [],
    publicMemory: { disclosures: [] },
    knownDeck: [],
    pending: {
      activeKinds: [],
      resolverPlayerIds: null,
      resolverPlayers: null,
    },
  };
}

function oneHot<T extends string>(
  value: T | undefined,
  domain: readonly T[]
): number[] {
  return domain.map((domainValue) => flag(value === domainValue));
}

function oneHotNullable<T extends string>(
  value: T | null | undefined,
  domain: readonly T[]
): number[] {
  if (value === null || value === undefined) {
    return [1, ...zeroes(domain.length)];
  }
  return [0, ...oneHot(value, domain)];
}

function multiHot<T extends string>(
  values: readonly T[],
  domain: readonly T[]
): number[] {
  const valueSet = new Set(values);
  return domain.map((domainValue) => flag(valueSet.has(domainValue)));
}

function symbolBundleCount(
  bundles: readonly { count: number }[] | undefined
): number {
  return (bundles ?? []).reduce((sum, bundle) => sum + bundle.count, 0);
}

function ratio(value: number, denominator: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(1, value / denominator));
}

function flag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function zeroes(length: number): number[] {
  return Array.from({ length }, () => 0);
}

function normalizeMax(
  name: string,
  value: number | undefined,
  fallback: number
): number {
  const actual = value ?? fallback;
  if (!Number.isInteger(actual) || actual < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return actual;
}

function vocabularyIndex(
  vocabulary: AiObservationCardVocabulary,
  cardNo: string
): number {
  if (cardNo === AI_UNKNOWN_CARD) return 0;
  const value = isMapVocabulary(vocabulary)
    ? vocabulary.get(cardNo)
    : vocabulary[cardNo];
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : 0;
}

function vocabularySize(vocabulary: AiObservationCardVocabulary): number {
  const values = isMapVocabulary(vocabulary)
    ? [...vocabulary.values()]
    : Object.values(vocabulary);
  const maxIndex = values.reduce(
    (max, value) =>
      Number.isInteger(value) && value > max ? Math.trunc(value) : max,
    0
  );
  return maxIndex + 1;
}

function isMapVocabulary(
  vocabulary: AiObservationCardVocabulary
): vocabulary is ReadonlyMap<string, number> {
  return typeof (vocabulary as { get?: unknown }).get === "function";
}

function relativeToViewpoint(
  playerId: string,
  viewpointPlayerId: string
): AiRelativePlayer {
  return playerId === viewpointPlayerId ? "me" : "opp";
}

function assertFiniteVector(name: string, values: readonly number[]): void {
  const badIndex = values.findIndex((value) => !Number.isFinite(value));
  if (badIndex >= 0) {
    throw new Error(`${name} contains non-finite value at index ${badIndex}`);
  }
}
