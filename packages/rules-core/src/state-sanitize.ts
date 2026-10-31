/**
 * viewer 視点の状態サニタイズ。非公開カードと private 宣言待ちを伏せる純粋関数。
 *
 * サーバ (PvP ルーム) の per-viewer 送信と、クライアント単独経路 (シナリオ /
 * スナップショット) の **表示用サニタイズ** の SSOT。pending prompt の解決者判定だけ
 * current-actor と共有し、game-api の動的 import 制約とも両立する。
 *
 * **可視性の原則 (2026-05-29 裁定: 表向きカードはすべて相手も閲覧可能)**:
 * - ゾーン非公開 (hand / deck): 中身を相手に見せない (face 不問)。※ life は instanceId を持たないので対象外。
 * - 裏向き: 未公開 burst (裏向きセット) / `field` の `faceDown=true` (P3-47 F-1) は伏せる。
 * - 表向き: field 表向き / trash / void / removed_from_game / set_aside / count_area / in_use に加え、
 *   mirage (08c:62「表向きでセット」) も相手可視。
 *   revealed は `revealedTo` 未設定または "both" のみ相手可視。「内容を見る」型の "self" は解決者だけに見せる。
 */
import { replaceCardInstances } from "./zone/card-instance-state";
import { projectTriggerConditionObservations } from "./effect/trigger-condition-observation";
import type {
  GameState,
  CardDefinition,
  CardInstance,
  PlayerState,
  PendingCountSelection,
  PendingCoreCountSelection,
  PendingDeckRevealCountBoostChoice,
  PendingDeckReveal,
  PendingCoreDistribution,
  PendingDiscardSetBurstCountSelection,
  PendingEnterFieldPlacement,
  PendingLinkAidCostSourceChoice,
  PendingMultiPlacement,
  PendingStepChoice,
  PendingStepOptionalChoice,
  PendingZoneSelection,
  PreGameState,
  PublicDisclosure,
  KnownDeckCard,
  TargetedDisclosureContinuation,
  ContinuousEffect,
} from "./model";
import { disclosureAudienceCanView } from "./public-disclosure";
import { getKnownDeckCards, normalizeLegacyDeckKnowledge } from "./known-deck";
import type {
  SerializedStepContext,
  StepResult,
} from "./step-execution-context";
import {
  getFaceUpDeckIds,
  hasPublicCardContentsRule,
} from "./effect/card-access-rules";
import {
  getCurrentActorPlayerIds,
  getPendingPromptResolverPlayerIds,
} from "./current-actor";

const HIDDEN = "_hidden_card_";

/** 合成Effectに埋めた公開継続も、通常pendingと同じ内部snapshot除去を通す。 */
function sanitizeEffectOverrideForDisplay(
  effect: import("./dsl-types").Effect
): import("./dsl-types").Effect {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const sanitized =
      record.kind === "resume_deck_reveal" && record.pending
        ? {
            ...record,
            pending: sanitizePendingDeckRevealForDisplay(
              record.pending as PendingDeckReveal
            ),
          }
        : record;
    return Object.fromEntries(
      Object.entries(sanitized).map(([key, child]) => [key, visit(child)])
    );
  };
  return visit(effect) as import("./dsl-types").Effect;
}

function sanitizeTargetedDisclosureContinuation(
  continuation: TargetedDisclosureContinuation
): TargetedDisclosureContinuation {
  const {
    effectResolutionBeforeState: _effectResolutionBeforeState,
    previousTargetedDisclosureContinuation,
    stepContext,
    coreDistributionPending,
    ...rest
  } = continuation;
  return {
    ...rest,
    stepContext: sanitizeSerializedStepContextForDisplay(stepContext),
    ...(coreDistributionPending !== undefined
      ? {
          coreDistributionPending: sanitizePendingCoreDistributionForDisplay(
            coreDistributionPending
          ),
        }
      : {}),
    ...(previousTargetedDisclosureContinuation !== undefined
      ? {
          previousTargetedDisclosureContinuation:
            previousTargetedDisclosureContinuation === null
              ? null
              : sanitizeTargetedDisclosureContinuation(
                  previousTargetedDisclosureContinuation
                ),
        }
      : {}),
  };
}

function sanitizeStepResultForDisplay(result: StepResult): StepResult {
  const { stateSnapshot: _stateSnapshot, ...rest } = result;
  return rest;
}

function sanitizeSerializedStepContextForDisplay(
  stepContext: SerializedStepContext
): SerializedStepContext {
  const {
    pendingConditionalCostRollback: _internalRollback,
    conditionalCostOriginalState: _conditionalCostOriginalState,
    resolutionSegmentBeforeState: _resolutionSegmentBeforeState,
    ...rest
  } = stepContext;
  return {
    ...rest,
    results: Object.fromEntries(
      Object.entries(rest.results).map(([stepId, result]) => [
        stepId,
        sanitizeStepResultForDisplay(result),
      ])
    ),
  };
}

function sanitizeContinuationForDisplay<
  T extends {
    stepContext: SerializedStepContext;
    targetedDisclosureContinuation?: TargetedDisclosureContinuation;
    resumeEffectOverride?: import("./dsl-types").Effect;
  },
>(continuation: T): T {
  return {
    ...continuation,
    ...(continuation.resumeEffectOverride !== undefined
      ? {
          resumeEffectOverride: sanitizeEffectOverrideForDisplay(
            continuation.resumeEffectOverride
          ),
        }
      : {}),
    stepContext: sanitizeSerializedStepContextForDisplay(
      continuation.stepContext
    ),
    ...(continuation.targetedDisclosureContinuation !== undefined
      ? {
          targetedDisclosureContinuation:
            sanitizeTargetedDisclosureContinuation(
              continuation.targetedDisclosureContinuation
            ),
        }
      : {}),
  };
}

function sanitizePendingWithContinuationForDisplay<
  T extends {
    priorStateSnapshot?: GameState;
    summonDeclaration?: unknown;
    deferredCoreMoveChoice?: unknown;
    lifeDamageInterception?: unknown;
    splitSummonChoice?: unknown;
    deckRevealResume?: unknown;
    remainingPlacements?: unknown;
    drawStepResume?: unknown;
    continuation?: {
      stepContext: SerializedStepContext;
      targetedDisclosureContinuation?: TargetedDisclosureContinuation;
    };
  },
>(pending: T): T {
  const {
    priorStateSnapshot: _priorStateSnapshot,
    summonDeclaration: _summonDeclaration,
    deferredCoreMoveChoice: _deferredCoreMoveChoice,
    lifeDamageInterception: _lifeDamageInterception,
    splitSummonChoice: _splitSummonChoice,
    deckRevealResume: _deckRevealResume,
    remainingPlacements: _remainingPlacements,
    drawStepResume: _drawStepResume,
    continuation,
    ...rest
  } = pending;
  return {
    ...rest,
    ...(continuation !== undefined
      ? { continuation: sanitizeContinuationForDisplay(continuation) }
      : {}),
  } as T;
}

/** 持ち主が必要とするのは対象と個数だけ。元効果の再開情報はサーバーに残す。 */
function sanitizeCoreShootOwnerChoiceForDisplay(
  pending: NonNullable<GameState["pendingCoreShootSelection"]>
): NonNullable<GameState["pendingCoreShootSelection"]> {
  if (!pending.ownerCoreChoice) return pending;
  const { continuation: _continuation, ownerCoreChoice, ...rest } = pending;
  return {
    ...rest,
    remainingActions: [],
    ownerCoreChoice: { soulSourceId: ownerCoreChoice.soulSourceId },
  };
}

function sanitizePendingZoneSelectionForDisplay(
  pending: PendingZoneSelection
): PendingZoneSelection {
  return sanitizePendingWithContinuationForDisplay(pending);
}

function sanitizePendingDeckRevealForDisplay(
  pending: PendingDeckReveal
): PendingDeckReveal {
  const {
    priorStateSnapshot: _priorStateSnapshot,
    continuation,
    pendingSwapOut,
    ...rest
  } = pending;
  return {
    ...rest,
    ...(continuation !== undefined
      ? { continuation: sanitizeContinuationForDisplay(continuation) }
      : {}),
    ...(pendingSwapOut !== undefined
      ? {
          pendingSwapOut:
            sanitizePendingZoneSelectionForDisplay(pendingSwapOut),
        }
      : {}),
  } as PendingDeckReveal;
}

function sanitizePendingCoreDistributionForDisplay(
  pending: PendingCoreDistribution
): PendingCoreDistribution {
  const {
    priorStateSnapshot: _priorStateSnapshot,
    supplementalTriggerEvents: _supplementalTriggerEvents,
    continuation,
    targetInterruption,
    ...rest
  } = pending;
  const sanitizedTargetInterruption =
    targetInterruption === undefined
      ? undefined
      : (({
          effectResolutionBeforeState: _effectResolutionBeforeState,
          stepContext,
          ...targetInterruptionRest
        }) => ({
          ...targetInterruptionRest,
          stepContext: sanitizeSerializedStepContextForDisplay(stepContext),
        }))(targetInterruption);
  return {
    ...rest,
    ...(continuation !== undefined
      ? {
          continuation: sanitizeContinuationForDisplay(continuation),
        }
      : {}),
    ...(targetInterruption !== undefined
      ? {
          targetInterruption: sanitizedTargetInterruption,
        }
      : {}),
  } as PendingCoreDistribution;
}

function sanitizePendingLinkAidCostSourceChoiceForDisplay(
  pending: PendingLinkAidCostSourceChoice
): PendingLinkAidCostSourceChoice {
  const { deferredStack: _deferredStack, ...rest } = pending;
  return rest as PendingLinkAidCostSourceChoice;
}

function sanitizeStepOptionalContinuationForDisplay<
  T extends {
    continuation: {
      stepContext: SerializedStepContext;
      targetedDisclosureContinuation?: TargetedDisclosureContinuation;
    };
  },
>(pending: T): T {
  return {
    ...pending,
    continuation: {
      ...sanitizeContinuationForDisplay(pending.continuation),
    },
  };
}

function sanitizeStepChoiceForDisplay(
  pending: PendingStepChoice
): PendingStepChoice {
  const { mirageSetChoice: _mirageSetChoice, ...visible } = pending;
  return sanitizeStepOptionalContinuationForDisplay(visible);
}

function sanitizePendingEnterFieldPlacementForDisplay(
  pending: PendingEnterFieldPlacement
): PendingEnterFieldPlacement {
  if (pending.effectBraveCombineAsSummon === undefined) return pending;
  const {
    effectResolutionBeforeState: _effectResolutionBeforeState,
    continuation,
    ...effectBraveCombineAsSummon
  } = pending.effectBraveCombineAsSummon;
  const sanitizedContinuation =
    continuation === undefined
      ? undefined
      : {
          ...continuation,
          stepContext: sanitizeSerializedStepContextForDisplay(
            continuation.stepContext
          ),
          ...(continuation.targetedDisclosureContinuation !== undefined
            ? {
                targetedDisclosureContinuation:
                  sanitizeTargetedDisclosureContinuation(
                    continuation.targetedDisclosureContinuation
                  ),
              }
            : {}),
        };
  return {
    ...pending,
    effectBraveCombineAsSummon: {
      ...effectBraveCombineAsSummon,
      ...(sanitizedContinuation !== undefined
        ? { continuation: sanitizedContinuation }
        : {}),
    },
  } as PendingEnterFieldPlacement;
}

function sanitizePreGameForViewer(
  preGame: PreGameState | null | undefined,
  viewerPlayerId: string | null
): PreGameState | null {
  if (!preGame) return null;

  const candidateCardNos = preGame.contractCandidateCardNos;
  const candidateInstanceIds = preGame.contractCandidateInstanceIds;
  if (!candidateCardNos && !candidateInstanceIds) return preGame;

  const revealPresentedOnly = preGame.phase !== "waiting_contract";
  const visibleCardNos: Record<string, string> = {};
  const visibleInstanceIds: Record<string, string> = {};
  for (const playerId of Object.keys(candidateCardNos ?? {})) {
    const isOwnCandidate = viewerPlayerId === playerId;
    const wasPresented =
      preGame.contractPresentationChoices?.[playerId] === true;
    if (!isOwnCandidate && (!revealPresentedOnly || !wasPresented)) continue;

    const cardNo = candidateCardNos?.[playerId];
    const instanceId = candidateInstanceIds?.[playerId];
    if (cardNo) visibleCardNos[playerId] = cardNo;
    if (instanceId && isOwnCandidate) visibleInstanceIds[playerId] = instanceId;
  }

  return {
    ...preGame,
    contractCandidateCardNos: visibleCardNos,
    contractCandidateInstanceIds: visibleInstanceIds,
  };
}

function continuousEffectReferencesHiddenSource(
  effect: ContinuousEffect,
  hiddenCardInstanceIds: ReadonlySet<string>
): boolean {
  if (hiddenCardInstanceIds.has(effect.sourceInstanceId)) return true;
  const effectSourceInstanceId = effect.provenance?.effectSourceInstanceId;
  return (
    typeof effectSourceInstanceId === "string" &&
    hiddenCardInstanceIds.has(effectSourceInstanceId)
  );
}

/**
 * 後方互換: GameState に後から追加された nullable / 配列フィールドの既定値。
 *
 * 新フィールドを schemaVersion を上げずに追加した場合、それ以前に保存された state
 * (スナップショット JSON / ルーム DB の rooms.state) には当該キーが存在しない
 * (= `undefined`)。新コードが `state.foo !== null` のような厳密判定をしていると
 * `undefined !== null` が真となり、例えば `pendingEffectTargetSelection` 欠落時に
 * 「効果対象選択待ち」と誤認して合法手が空になり進行不能になる / カスケード解決時に
 * `undefined` を展開して TypeError になる。これを防ぐため復元時に欠落キーを既定値で
 * 補完する。
 *
 * このモジュールは型のみ import で engine 非ロードのため、スナップショット復元
 * (snapshot.ts) と PvP ルームの DB 復元 (game-api getRoom) の双方から共有できる。
 */
const OPTIONAL_STATE_FIELD_DEFAULTS = {
  nextRootTriggerChainId: 0,
  stackWindow: null,
  activeAttack: null,
  battleResolutionGroup: null,
  preDeclarationStackWindow: null,
  pendingPreDeclarationConfirmation: null,
  pendingBraveLeaveChoice: null,
  pendingBraveAttackContinuation: null,
  pendingSoulStateReplacement: null,
  pendingAdventSourceReplacement: null,
  pendingSetAsideExitReplacementChoice: null,
  pendingDeckReveal: null,
  pendingZoneSelection: null,
  pendingStepOptionalChoice: null,
  pendingStepChoice: null,
  pendingDeckRevealCountBoostChoice: null,
  pendingStepOptionalTargetSelection: null,
  pendingAfterTriggersContinuations: [],
  pendingEffectCompletions: [],
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
  pendingEffectSummonCostPayment: null,
  pendingCoreDistribution: null,
  pendingChangeCleanupChoice: null,
  pendingMultiPlacement: null,
  illegalBurstRevealPlayerId: null,
  gameResult: null,
  battleEntities: [],
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
  summonedDuringAttackStepInstanceIds: [],
  pendingImmediateAttackJoins: [],
  turnSummonedCardRefs: [],
  pendingTriggeredEffects: [],
  pendingPrivateDeclarations: [],
  pendingDeferredTriggeredEffects: [],
  pendingBurstChecks: [],
  pendingLeaveEntities: [],
  pendingStoneFlipCombine: null,
  pendingTrashOptionalAdds: [],
  pendingTargetRedirects: [],
  pendingBattleEndDeferrals: [],
  pendingTurnEndExhaustDowngrades: [],
  pendingImmediateBattleEnds: [],
  pendingConnectBattleDecision: null,
  pendingAttackStepEndFinalizations: [],
  pendingTurnEndFinalizations: [],
  pendingBattleEndFinalizeAttackIds: [],
  effectUsageRecords: [],
  effectOccurrenceRecords: [],
  effectQueueEntries: [],
  effectQueueSummary: [],
  publicDisclosures: [],
  flashCardUsageLog: [],
  flashEffectActivationLog: [],
  attackDeclarationLog: [],
  mirageSetDrawLog: [],
  log: [],
  effectLifeReductionThisTurn: {},
  declarationCountThisTurn: {},
  lifeReductionCappedThisTurn: {},
  filteredLifeReductionCappedThisTurn: {},
  bpThresholdCappedLifeReductionThisTurn: {},
  declareGimmickGateUsedThisTurn: {},
  lifeDamageInterceptionUseCostGateUsedThisTurn: {},
  symbolAdditionRestrictedCountThisTurn: {},
} satisfies Partial<GameState>;

/**
 * 旧セーブ healing: フラッシュ本体 (pendingStackAction === null) では
 * stackResponseSourcePlayerId は現優先権者に追従する不変条件
 * (transferResponseWindowPriority / 08_stack-window-and-priority-loop.md §4)。
 *
 * 旧バグ期に保存された state では優先権移譲時に source が更新されず非アクティブ側の
 * まま残り、復元すると優先権を得たアクティブプレイヤーが自分の『お互いのアタックステップ』
 * flash 効果 (getResponseWindowActionTimings が "stack" を返し timing:"flash" 効果が除外)
 * を起動できない。優先権者へ揃えて修復する。冪等 (修正後に保存された state は素通り)。
 */
function healStaleFlashWindowSource(state: GameState): GameState {
  const fws = state.activeAttack?.flashWindowState;
  if (
    !state.activeAttack ||
    !fws ||
    fws.pendingStackAction !== null ||
    fws.stackResponseSourcePlayerId === fws.priorityPlayerId
  ) {
    return state;
  }
  return {
    ...state,
    activeAttack: {
      ...state.activeAttack,
      flashWindowState: {
        ...fws,
        stackResponseSourcePlayerId: fws.priorityPlayerId,
      },
    },
  };
}

/**
 * ソウルコア複数個対応 S1 (P3-101) の移行アダプタ。
 *
 * 新フィールド (`PlayerState.reserveSoulCoreCount` 等 + `CardInstance.soulCoreCount`)
 * 追加前に保存された state には存在しないため、旧 SSOT `soulCoreLocation`
 * (単一ロケーション、常に1個前提) から導出して補完する。新フィールドが既に
 * 存在するプレイヤー/カードはそのまま保持する (冪等)。
 *
 * S1 の間は `soulCoreLocation` が引き続き実際の移動/判定ロジックの SSOT のため、
 * ここでの導出はスナップショット復元直後の一時点のみを揃える。ライブプレイ中の
 * 継続同期は S2 (soulCoreLocation 読み取り経路の移行) で行う。
 */
function backfillPlayerSoulCoreCounts(state: GameState): GameState {
  const needsBackfill = state.players.some(
    (player) =>
      typeof (player as Partial<PlayerState>).reserveSoulCoreCount !== "number"
  );
  if (!needsBackfill) return state;

  const soulCoreCountByCardId = new Map<string, number>();
  for (const player of state.players) {
    const location = player.soulCoreLocation;
    if (location?.kind === "card") {
      soulCoreCountByCardId.set(
        location.instanceId,
        (soulCoreCountByCardId.get(location.instanceId) ?? 0) + 1
      );
    }
  }

  return replaceCardInstances(
    {
      ...state,
      players: state.players.map((player): PlayerState => {
        if (
          typeof (player as Partial<PlayerState>).reserveSoulCoreCount ===
          "number"
        ) {
          return player;
        }
        const location = player.soulCoreLocation;
        return {
          ...player,
          reserveSoulCoreCount: location?.kind === "reserve" ? 1 : 0,
          trashSoulCoreCount: location?.kind === "trash" ? 1 : 0,
          lifeSoulCoreCount: location?.kind === "life" ? 1 : 0,
        };
      }),
    },
    state.cardInstances.map((card): CardInstance => {
      if (typeof (card as Partial<CardInstance>).soulCoreCount === "number") {
        return card;
      }
      return {
        ...card,
        soulCoreCount: soulCoreCountByCardId.get(card.instanceId) ?? 0,
      };
    })
  );
}

function getPrintedMinimumRequiredCores(definition: CardDefinition): number {
  if (definition.levelDefs.length === 0) return 0;
  return definition.levelDefs.reduce(
    (minimum, levelDef) => Math.min(minimum, levelDef.requiredCores),
    Number.POSITIVE_INFINITY
  );
}

export interface MinimumRequiredCoresSyncResult {
  state: GameState;
  updatedInstanceIds: string[];
}

/**
 * 旧 state healing: カードデータ修正後も、保存済み CardInstance には当時の
 * minimumRequiredCores が残る。フィールド分離や維持コア HUD は CardInstance を
 * 正源にするため、復元時に現行定義の印字最低 Lv コストへ再同期する。
 */
export function syncMinimumRequiredCoresFromCurrentDefinitions(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): MinimumRequiredCoresSyncResult {
  const updatedInstanceIds: string[] = [];
  const cardInstances = state.cardInstances.map((card): CardInstance => {
    if (card.definitionId === HIDDEN) return card;
    const definition = getCardDefinitionById(card.definitionId);
    if (!definition) return card;
    const expected = getPrintedMinimumRequiredCores(definition);
    if (card.minimumRequiredCores === expected) return card;
    updatedInstanceIds.push(card.instanceId);
    return { ...card, minimumRequiredCores: expected };
  });

  let nextState =
    updatedInstanceIds.length > 0
      ? replaceCardInstances({ ...state }, cardInstances)
      : state;

  const pending = nextState.pendingCoreDistribution;
  const braveSeparation = pending?.stateBasedBraveSeparation;
  if (pending && braveSeparation) {
    const brave = nextState.cardInstances.find(
      (card) => card.instanceId === braveSeparation.braveInstanceId
    );
    if (brave) {
      const currentTotalCores = brave.normalCoreCount + brave.soulCoreCount;
      const needed = Math.max(
        0,
        brave.minimumRequiredCores - currentTotalCores
      );
      if ((pending.minTotal ?? 0) !== needed) {
        nextState = {
          ...nextState,
          pendingCoreDistribution: {
            ...pending,
            minTotal: needed,
          },
        };
      }
    }
  }

  return { state: nextState, updatedInstanceIds };
}

/**
 * 復元する state に欠落している後方互換フィールドを既定値で補完する。
 * 既存キー (null 含む) は保持し、欠落キーだけ既定値を充てる (`...state` を後にスプレッド)。
 * 冪等。構造必須フィールド (players / cardInstances / turnNumber 等) は呼び出し側が検証する前提。
 *
 * スナップショット復元 (snapshot.ts parseGameSnapshot) と PvP ルームの DB 復元
 * (game-api getRoom) の双方が通る単一経路。後方互換の不変条件 healing
 * (`healStaleFlashWindowSource` 等) もここに集約する。
 */
export function backfillOptionalStateFields(
  state: Partial<GameState>
): GameState {
  const { mirageSetCountExemptionUsedPlayerIds: legacyExemptions, ...current } =
    state as Partial<GameState> & {
      mirageSetCountExemptionUsedPlayerIds?: unknown;
    };
  const merged = { ...OPTIONAL_STATE_FIELD_DEFAULTS, ...current } as GameState;
  if (
    !Object.hasOwn(current, "mirageSetCountExemptionsUsed") &&
    Array.isArray(legacyExemptions)
  ) {
    // 旧版には同名の識別子が無い。使用済みを失って追加行動を許可しないよう、
    // 旧版のプレイヤー単位制限を公開の互換キーでターン終了まで保持する。
    merged.mirageSetCountExemptionsUsed = [
      ...new Set(
        legacyExemptions.filter((id): id is string => typeof id === "string")
      ),
    ].map((playerId) => ({ playerId, cardNo: "*" }));
  }
  return normalizeLegacyDeckKnowledge(
    backfillPlayerSoulCoreCounts(healStaleFlashWindowSource(merged))
  );
}

/**
 * viewer 視点で GameState の非公開カードと private 宣言待ちを sanitize する。
 *
 * - viewerPlayerId が owner と一致する手札・裏向きカードは見せる（デッキは owner にも伏せる）
 * - viewerPlayerId が null の観戦者、または相手には伏せる
 * - pendingPrivateDeclarations / pendingDeferredTriggeredEffects は owner 本人にだけ返す
 */
export function sanitizeStateForViewer(
  state: GameState,
  viewerPlayerId: string | null,
  currentActorPlayerIds?: ReadonlySet<string>
): GameState {
  const faceUpDeckIds = new Set(
    state.playerOrder.flatMap((id) => getFaceUpDeckIds(state, id))
  );
  const revealedBurstInstanceIds = new Set(
    (state.revealedBurstStates ?? []).map((r) => r.cardInstanceId)
  );
  const shouldHideCard = (card: CardInstance): boolean => {
    if (hasPublicCardContentsRule(state, card, faceUpDeckIds)) return false;
    if (card.zone === "revealed") {
      const revealTo = card.revealedTo ?? "both";
      if (revealTo === "both") return false;
      if (!viewerPlayerId) return true;
      const revealer = card.revealedByPlayerId ?? card.ownerPlayerId;
      if (revealTo === "self") return viewerPlayerId !== revealer;
      if (revealTo === "opponent") return viewerPlayerId === revealer;
    }
    // デッキの内容と順序は owner にとっても非公開。
    if (card.zone === "deck") return true;
    if (viewerPlayerId && card.ownerPlayerId === viewerPlayerId) return false;
    return (
      card.zone === "hand" ||
      (card.zone === "burst" &&
        !revealedBurstInstanceIds.has(card.instanceId)) ||
      (card.zone === "field" && card.faceDown === true)
    );
  };
  const visibleRawDisclosures = (state.publicDisclosures ?? []).flatMap(
    (disclosure): PublicDisclosure[] => {
      if (
        disclosureAudienceCanView(
          disclosure.audience,
          disclosure.actorPlayerId,
          viewerPlayerId
        )
      )
        return [disclosure];
      // 内容を見る権利と移動の事実は別。履歴の素性・source・live ID は持ち出さない。
      const results: PublicDisclosure["results"] = disclosure.results.flatMap(
        (result) =>
          result.kind === "card_move" && result.from && result.to
            ? [
                {
                  kind: "hidden_card_move" as const,
                  from: result.from,
                  to: result.to,
                  count: result.count ?? 1,
                  actionLabel: result.actionLabel,
                  hiddenReason: "without_showing_contents" as const,
                  ...(result.playerId ? { playerId: result.playerId } : {}),
                },
              ]
            : []
      );
      return results.length
        ? [
            {
              id: disclosure.id,
              sequence: disclosure.sequence,
              turnNumber: disclosure.turnNumber,
              step: disclosure.step,
              actorPlayerId: disclosure.actorPlayerId,
              audience: "both",
              kind: "hidden_card_action",
              targets: [],
              results,
            },
          ]
        : [];
    }
  );
  const cardByInstanceId = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  const trackingEndsAtByInstanceId = new Map<string, number>();
  const hiddenCardInstanceIds = new Set<string>();
  const destinationEndsTracking = (
    card: CardInstance,
    destination: PublicDisclosure["results"][number]["to"]
  ): boolean => {
    if (destination === "deck") return true;
    if (viewerPlayerId && card.ownerPlayerId === viewerPlayerId) return false;
    return destination === "hand" || destination === "burst";
  };
  for (const disclosure of visibleRawDisclosures) {
    for (const result of disclosure.results) {
      if (result.kind !== "card_move" || !result.instanceId || !result.to) {
        continue;
      }
      const card = cardByInstanceId.get(result.instanceId);
      if (!card || !destinationEndsTracking(card, result.to)) continue;
      trackingEndsAtByInstanceId.set(
        result.instanceId,
        Math.max(
          trackingEndsAtByInstanceId.get(result.instanceId) ?? 0,
          disclosure.sequence
        )
      );
    }
  }
  for (const card of state.cardInstances) {
    if (shouldHideCard(card)) {
      hiddenCardInstanceIds.add(card.instanceId);
      trackingEndsAtByInstanceId.set(card.instanceId, Number.POSITIVE_INFINITY);
    }
  }
  const sanitizePublicCardReference = <
    T extends { instanceId?: string; definitionIdSnapshot?: string },
  >(
    reference: T,
    disclosureSequence: number
  ): T => {
    if (!reference.instanceId) return reference;
    const card = cardByInstanceId.get(reference.instanceId);
    const withSnapshot =
      reference.definitionIdSnapshot || !card || card.definitionId === HIDDEN
        ? reference
        : { ...reference, definitionIdSnapshot: card.definitionId };
    if (
      (trackingEndsAtByInstanceId.get(reference.instanceId) ?? 0) <
      disclosureSequence
    ) {
      return withSnapshot;
    }
    const { instanceId: _privateLiveReference, ...historicalSnapshot } =
      withSnapshot;
    return historicalSnapshot as T;
  };
  const visiblePublicDisclosures = visibleRawDisclosures.map(
    (disclosure): PublicDisclosure => ({
      ...disclosure,
      ...(disclosure.source
        ? {
            source: sanitizePublicCardReference(
              disclosure.source,
              disclosure.sequence
            ),
          }
        : {}),
      targets: disclosure.targets.map((target) =>
        target.kind === "card"
          ? sanitizePublicCardReference(target, disclosure.sequence)
          : target
      ),
      results: disclosure.results.map((result) =>
        result.kind === "hidden_card_move"
          ? result
          : sanitizePublicCardReference(result, disclosure.sequence)
      ),
    })
  );
  const deckCountByPlayerId = new Map<string, number>();
  for (const card of state.cardInstances) {
    if (card.zone !== "deck") continue;
    deckCountByPlayerId.set(
      card.ownerPlayerId,
      (deckCountByPlayerId.get(card.ownerPlayerId) ?? 0) + 1
    );
  }
  const visibleKnownDeckCards = getKnownDeckCards(state).filter(
    (entry): entry is KnownDeckCard => {
      const deckCount = deckCountByPlayerId.get(entry.playerId) ?? 0;
      return (
        entry.indexFromBottom >= 0 &&
        entry.indexFromBottom < deckCount &&
        disclosureAudienceCanView(
          entry.audience,
          entry.actorPlayerId,
          viewerPlayerId
        )
      );
    }
  );
  // Operation receipts belong to the authoritative game/snapshot only. A
  // viewer does not need allocator IDs or references to past hidden cards.
  const {
    semanticTriggerEvents: _semanticEvents,
    semanticTriggerSequence: _semanticSequence,
    viewerLegalActions: _viewerLegalActions,
    ...viewerState
  } = state;
  void _semanticEvents;
  void _semanticSequence;
  void _viewerLegalActions;
  const sanitized = replaceCardInstances(
    {
      ...viewerState,
      preGame: sanitizePreGameForViewer(state.preGame, viewerPlayerId),
      publicDisclosures: visiblePublicDisclosures,
      knownDeckCards: visibleKnownDeckCards,
      activeContinuousEffects: (state.activeContinuousEffects ?? []).filter(
        (effect) =>
          !continuousEffectReferencesHiddenSource(effect, hiddenCardInstanceIds)
      ),
      // デバッグ文字列は公開情報の正源ではない。未知の log 記法から非公開情報が
      // 漏れる経路を閉じ、GUI は publicDisclosures だけを読む。
      log: [],
      pendingPrivateDeclarations: (
        state.pendingPrivateDeclarations ?? []
      ).filter((declaration) => declaration.ownerPlayerId === viewerPlayerId),
      pendingDeferredTriggeredEffects: (
        state.pendingDeferredTriggeredEffects ?? []
      ).filter((effect) => effect.actingPlayerId === viewerPlayerId),
      pendingStepOptionalChoice: state.pendingStepOptionalChoice
        ? sanitizeStepOptionalContinuationForDisplay<PendingStepOptionalChoice>(
            state.pendingStepOptionalChoice
          )
        : null,
      pendingStepChoice: state.pendingStepChoice
        ? sanitizeStepChoiceForDisplay(state.pendingStepChoice)
        : null,
      pendingDeckRevealCountBoostChoice: state.pendingDeckRevealCountBoostChoice
        ? sanitizeStepOptionalContinuationForDisplay<PendingDeckRevealCountBoostChoice>(
            state.pendingDeckRevealCountBoostChoice
          )
        : null,
      pendingTargetedDisclosureContinuation:
        state.pendingTargetedDisclosureContinuation
          ? sanitizeTargetedDisclosureContinuation(
              state.pendingTargetedDisclosureContinuation
            )
          : null,
      pendingEnterFieldPlacement: state.pendingEnterFieldPlacement
        ? sanitizePendingEnterFieldPlacementForDisplay(
            state.pendingEnterFieldPlacement
          )
        : null,
      pendingCoreDistribution: state.pendingCoreDistribution
        ? sanitizePendingCoreDistributionForDisplay(
            state.pendingCoreDistribution
          )
        : null,
      pendingBattleEndDeferrals: (state.pendingBattleEndDeferrals ?? []).map(
        (deferral) => ({
          ...deferral,
          ...(deferral.restoredStepContext !== undefined
            ? {
                restoredStepContext: sanitizeSerializedStepContextForDisplay(
                  deferral.restoredStepContext
                ),
              }
            : {}),
          ...(deferral.resumeEffectOverride !== undefined
            ? {
                resumeEffectOverride: sanitizeEffectOverrideForDisplay(
                  deferral.resumeEffectOverride
                ),
              }
            : {}),
        })
      ),
      pendingChangeCleanupChoice: state.pendingChangeCleanupChoice,
    },
    state.cardInstances.map((c) => {
      const { deckKnowledge: _privateDeckKnowledge, ...visibleCard } = c;
      if (!shouldHideCard(c)) return visibleCard;
      return {
        ...visibleCard,
        definitionId: HIDDEN,
        originalDefinitionId: HIDDEN,
      };
    })
  );
  // 秘匿・表示マスク前に解決者を確定する。相手の private 宣言を消しても、
  // その選択待ちまで消すと相手GUIが open_battle_flash 等を自動送信してしまう。
  // 配送済みstateを表示用に再sanitizeする場合も、元のロックを保持する。
  const pendingPromptResolvers = state.pendingPromptLock
    ? new Set(state.pendingPromptLock.resolverPlayerIds)
    : (getPendingPromptResolverPlayerIds(state) ??
      (sanitized.pendingPrivateDeclarations.length <
      state.pendingPrivateDeclarations.length
        ? (currentActorPlayerIds ?? getCurrentActorPlayerIds(state))
        : null));
  const masked = maskPendingPromptsForViewer(sanitized, viewerPlayerId);
  return {
    ...masked,
    pendingPromptLock:
      pendingPromptResolvers === null
        ? null
        : { resolverPlayerIds: [...pendingPromptResolvers] },
  };
}

/** 観戦者向け互換 wrapper。全プレイヤーの非公開カードと private 宣言を伏せる。 */
export function sanitizeStateForSpectator(state: GameState): GameState {
  return sanitizeStateForViewer(state, null);
}

/**
 * viewer 視点の **UI 表示用** マスク。解決者本人でない pending UI prompt (対象選択系) を
 * null 化 / フィルタした state を返す。
 *
 * 目的: 「相手の対象選択中に、非解決者クライアントの UI が連動して反応する」
 * (自分の手札が自動展開する / 勝手にコア配分・配置・コアシュートモードに入る等) のを
 * 一元的に防ぐ。GUI は UI 反応判定 (hasUiPending / coreSelection 起動 / モーダル表示等) を
 * すべてこのマスク済み state 経由で行う。
 *
 * **重要**: これは表示専用。engine / legal-action / 解決ロジックが読む state には適用しない
 * こと (pending を消すと解決が壊れる)。秘匿カードの sanitizeStateForViewer とは別レイヤ。
 *
 * 各 pending の「解決者」フィールドは current-actor.ts / legal-actions.ts の
 * pendingPromptResolverIds と一致させている。
 */
export function maskPendingPromptsForViewer(
  state: GameState,
  viewerPlayerId: string | null
): GameState {
  state = projectTriggerConditionObservations(state).value;
  const mine = (resolver: string): boolean => resolver === viewerPlayerId;
  const pendingTargetRedirects = state.pendingTargetRedirects ?? [];
  const pendingTrashOptionalAdds = state.pendingTrashOptionalAdds ?? [];
  const pendingDeckRevealSwapChain = state.pendingDeckRevealSwapChain ?? [];
  const firstTargetRedirect = pendingTargetRedirects[0];
  const firstTargetRedirectResolver =
    firstTargetRedirect === undefined
      ? null
      : firstTargetRedirect.decisionConfirmed === true
        ? (firstTargetRedirect.candidateChooserPlayerId ??
          firstTargetRedirect.promptedPlayerId)
        : firstTargetRedirect.promptedPlayerId;

  return {
    ...state,
    pendingBraveLeaveChoice:
      state.pendingBraveLeaveChoice &&
      mine(state.pendingBraveLeaveChoice.choosingPlayerId)
        ? state.pendingBraveLeaveChoice
        : null,
    pendingBraveAttackContinuation:
      state.pendingBraveAttackContinuation &&
      mine(state.pendingBraveAttackContinuation.choosingPlayerId)
        ? state.pendingBraveAttackContinuation
        : null,
    pendingSoulStateReplacement:
      state.pendingSoulStateReplacement &&
      mine(state.pendingSoulStateReplacement.choosingPlayerId)
        ? state.pendingSoulStateReplacement
        : null,
    pendingAdventSourceReplacement:
      state.pendingAdventSourceReplacement &&
      mine(state.pendingAdventSourceReplacement.choosingPlayerId)
        ? state.pendingAdventSourceReplacement
        : null,
    pendingSetAsideExitReplacementChoice:
      state.pendingSetAsideExitReplacementChoice &&
      mine(state.pendingSetAsideExitReplacementChoice.choosingPlayerId)
        ? {
            choosingPlayerId:
              state.pendingSetAsideExitReplacementChoice.choosingPlayerId,
            cardInstanceId:
              state.pendingSetAsideExitReplacementChoice.cardInstanceId,
            replacement: state.pendingSetAsideExitReplacementChoice.replacement,
          }
        : null,
    pendingDeckReveal:
      state.pendingDeckReveal && mine(state.pendingDeckReveal.actingPlayerId)
        ? sanitizePendingDeckRevealForDisplay(state.pendingDeckReveal)
        : null,
    // 任意手札追加の発火待ちは選択者本人にだけ見せる（相手クライアントには露出しない）。
    pendingTrashOptionalAdds: pendingTrashOptionalAdds.filter((e) =>
      mine(e.actingPlayerId)
    ),
    pendingZoneSelection:
      state.pendingZoneSelection &&
      mine(state.pendingZoneSelection.actingPlayerId)
        ? sanitizePendingZoneSelectionForDisplay(state.pendingZoneSelection)
        : null,
    // step.executionMode='optional' の execute/decline 選択待ちは解決者 (choosingPlayerId) にのみ
    // 開示する。chooser='opponent' のときは相手プレイヤー側に開示し effect 発動者側からは隠す
    // (PendingStepOptionalTargetSelection と同 SSOT)。
    pendingStepOptionalChoice:
      state.pendingStepOptionalChoice &&
      mine(state.pendingStepOptionalChoice.choosingPlayerId)
        ? sanitizeStepOptionalContinuationForDisplay<PendingStepOptionalChoice>(
            state.pendingStepOptionalChoice
          )
        : null,
    pendingStepChoice:
      state.pendingStepChoice && mine(state.pendingStepChoice.choosingPlayerId)
        ? sanitizeStepChoiceForDisplay(state.pendingStepChoice)
        : null,
    // deck_reveal 枚数+1 選択待ちは CE 所有者 (actingPlayerId=解決者) にのみ開示する。
    pendingDeckRevealCountBoostChoice:
      state.pendingDeckRevealCountBoostChoice &&
      mine(state.pendingDeckRevealCountBoostChoice.actingPlayerId)
        ? sanitizeStepOptionalContinuationForDisplay<PendingDeckRevealCountBoostChoice>(
            state.pendingDeckRevealCountBoostChoice
          )
        : null,
    // optional step 自身の対象選択も解決者 (choosingPlayerId) にのみ開示する。
    // chooser='opponent' のときは相手プレイヤー側に開示し effect 発動者側からは隠す。
    pendingStepOptionalTargetSelection:
      state.pendingStepOptionalTargetSelection &&
      mine(state.pendingStepOptionalTargetSelection.choosingPlayerId)
        ? sanitizeStepOptionalContinuationForDisplay(
            state.pendingStepOptionalTargetSelection
          )
        : null,
    // deck_reveal の per-pick swap 待機列は選択者本人にだけ見せる (相手クライアントには露出しない)。
    pendingDeckRevealSwapChain: pendingDeckRevealSwapChain
      .filter((e) => mine(e.actingPlayerId))
      .map((e) => sanitizePendingZoneSelectionForDisplay(e)),
    // コスト先払い型ドロー枚数修正の任意コスト判断は支払い側 (= 解決者) にのみ開示する。
    pendingDrawStepCostChoice:
      state.pendingDrawStepCostChoice &&
      mine(state.pendingDrawStepCostChoice.actingPlayerId)
        ? state.pendingDrawStepCostChoice
        : null,
    // 召喚コスト・トラッシュ除外選択は召喚側 (= 解決者) にのみ開示する。
    pendingSummonCostExcludeChoice:
      state.pendingSummonCostExcludeChoice &&
      mine(state.pendingSummonCostExcludeChoice.actingPlayerId)
        ? state.pendingSummonCostExcludeChoice
        : null,
    // 召喚コスト・トラッシュコア移動選択は召喚側 (= 解決者) にのみ開示する。
    pendingSummonCostCoreMoveChoice:
      state.pendingSummonCostCoreMoveChoice &&
      mine(state.pendingSummonCostCoreMoveChoice.actingPlayerId)
        ? state.pendingSummonCostCoreMoveChoice
        : null,
    // 複数対象召喚のグループ化コストオーバーライド選択は解決者 (= 発動元プレイヤー) にのみ開示する。
    pendingGroupedSummonCostOverrideChoice:
      state.pendingGroupedSummonCostOverrideChoice &&
      mine(state.pendingGroupedSummonCostOverrideChoice.actingPlayerId)
        ? state.pendingGroupedSummonCostOverrideChoice
        : null,
    // ライフダメージ破棄コストゲート選択は解決者 (decidingPlayerId = ライフが減る側) にのみ開示する。
    pendingLifeDamageDiscardChoice:
      state.pendingLifeDamageDiscardChoice &&
      mine(state.pendingLifeDamageDiscardChoice.decidingPlayerId)
        ? state.pendingLifeDamageDiscardChoice
        : null,
    // ライフゲイン置換選択は解決者 (decidingPlayerId = ライフが増える側) にのみ開示する。
    pendingLifeGainReplacementChoice:
      state.pendingLifeGainReplacementChoice &&
      mine(state.pendingLifeGainReplacementChoice.decidingPlayerId)
        ? state.pendingLifeGainReplacementChoice
        : null,
    pendingCoreShootSelection:
      state.pendingCoreShootSelection &&
      mine(state.pendingCoreShootSelection.actingPlayerId)
        ? sanitizeCoreShootOwnerChoiceForDisplay(
            state.pendingCoreShootSelection
          )
        : null,
    pendingEffectTargetSelection:
      state.pendingEffectTargetSelection &&
      mine(state.pendingEffectTargetSelection.actingPlayerId)
        ? state.pendingEffectTargetSelection
        : null,
    pendingAsIfSoulCoreChoice:
      state.pendingAsIfSoulCoreChoice &&
      mine(state.pendingAsIfSoulCoreChoice.actingPlayerId)
        ? state.pendingAsIfSoulCoreChoice
        : null,
    pendingEffectOptionalRepeatChoice:
      state.pendingEffectOptionalRepeatChoice &&
      mine(state.pendingEffectOptionalRepeatChoice.actingPlayerId)
        ? state.pendingEffectOptionalRepeatChoice
        : null,
    pendingEffectOptionalRepeatCountSelection:
      state.pendingEffectOptionalRepeatCountSelection &&
      mine(state.pendingEffectOptionalRepeatCountSelection.actingPlayerId)
        ? state.pendingEffectOptionalRepeatCountSelection
        : null,
    pendingBorrowedEffectChoice:
      state.pendingBorrowedEffectChoice &&
      mine(state.pendingBorrowedEffectChoice.actingPlayerId)
        ? state.pendingBorrowedEffectChoice
        : null,
    pendingBorrowedEffectTargetSelection:
      state.pendingBorrowedEffectTargetSelection &&
      mine(state.pendingBorrowedEffectTargetSelection.choosingPlayerId)
        ? sanitizeContinuationForDisplay(
            state.pendingBorrowedEffectTargetSelection
          )
        : null,
    pendingPayToActCoreGate:
      state.pendingPayToActCoreGate &&
      mine(state.pendingPayToActCoreGate.actingPlayerId)
        ? state.pendingPayToActCoreGate
        : null,
    pendingPayToActHandDiscardGate:
      state.pendingPayToActHandDiscardGate &&
      mine(state.pendingPayToActHandDiscardGate.actingPlayerId)
        ? state.pendingPayToActHandDiscardGate
        : null,
    pendingFieldMagicPreCostTrigger:
      state.pendingFieldMagicPreCostTrigger &&
      mine(state.pendingFieldMagicPreCostTrigger.actingPlayerId)
        ? state.pendingFieldMagicPreCostTrigger
        : null,
    pendingTargetedDisclosureContinuation:
      state.pendingTargetedDisclosureContinuation &&
      mine(state.pendingTargetedDisclosureContinuation.actingPlayerId)
        ? sanitizeTargetedDisclosureContinuation(
            state.pendingTargetedDisclosureContinuation
          )
        : null,
    pendingAfterTriggersContinuations: [],
    pendingEffectCompletions: [],
    pendingEnterFieldPlacement:
      state.pendingEnterFieldPlacement &&
      mine(state.pendingEnterFieldPlacement.actingPlayerId)
        ? sanitizePendingEnterFieldPlacementForDisplay(
            state.pendingEnterFieldPlacement
          )
        : null,
    pendingBraveCombineChoice:
      state.pendingBraveCombineChoice &&
      mine(state.pendingBraveCombineChoice.actingPlayerId)
        ? state.pendingBraveCombineChoice
        : null,
    pendingTenshoSummon:
      state.pendingTenshoSummon &&
      mine(state.pendingTenshoSummon.actingPlayerId)
        ? state.pendingTenshoSummon
        : null,
    pendingReverseRebirthSummon:
      state.pendingReverseRebirthSummon &&
      mine(state.pendingReverseRebirthSummon.actingPlayerId)
        ? state.pendingReverseRebirthSummon
        : null,
    pendingCoreSplitSelection:
      state.pendingCoreSplitSelection &&
      mine(state.pendingCoreSplitSelection.actingPlayerId)
        ? state.pendingCoreSplitSelection
        : null,
    pendingSplitSummonChoice:
      state.pendingSplitSummonChoice &&
      mine(state.pendingSplitSummonChoice.actingPlayerId)
        ? state.pendingSplitSummonChoice
        : null,
    pendingCoreCountSelection:
      state.pendingCoreCountSelection &&
      mine(state.pendingCoreCountSelection.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay<PendingCoreCountSelection>(
            state.pendingCoreCountSelection
          )
        : null,
    pendingCountSelection:
      state.pendingCountSelection &&
      mine(state.pendingCountSelection.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay<PendingCountSelection>(
            state.pendingCountSelection
          )
        : null,
    pendingDiscardSetBurstCountSelection:
      state.pendingDiscardSetBurstCountSelection &&
      mine(state.pendingDiscardSetBurstCountSelection.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay<PendingDiscardSetBurstCountSelection>(
            state.pendingDiscardSetBurstCountSelection
          )
        : null,
    pendingHandTrashSwapChoice:
      state.pendingHandTrashSwapChoice &&
      mine(state.pendingHandTrashSwapChoice.actingPlayerId)
        ? state.pendingHandTrashSwapChoice
        : null,
    pendingFieldHandSwapChoice:
      state.pendingFieldHandSwapChoice &&
      mine(state.pendingFieldHandSwapChoice.actingPlayerId)
        ? state.pendingFieldHandSwapChoice
        : null,
    pendingLifeCoreSelection:
      state.pendingLifeCoreSelection &&
      mine(state.pendingLifeCoreSelection.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay(
            state.pendingLifeCoreSelection
          )
        : null,
    pendingCoreSourceAllocation:
      state.pendingCoreSourceAllocation &&
      mine(state.pendingCoreSourceAllocation.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay(
            state.pendingCoreSourceAllocation
          )
        : null,
    pendingLinkAidCostSourceChoice:
      state.pendingLinkAidCostSourceChoice &&
      mine(state.pendingLinkAidCostSourceChoice.actingPlayerId)
        ? sanitizePendingLinkAidCostSourceChoiceForDisplay(
            state.pendingLinkAidCostSourceChoice
          )
        : null,
    pendingEffectSummonCostPayment:
      state.pendingEffectSummonCostPayment &&
      mine(state.pendingEffectSummonCostPayment.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay(
            state.pendingEffectSummonCostPayment
          )
        : null,
    pendingChangeCleanupChoice:
      firstTargetRedirect === undefined &&
      state.pendingChangeCleanupChoice &&
      mine(state.pendingChangeCleanupChoice.actingPlayerId)
        ? state.pendingChangeCleanupChoice
        : null,
    pendingCoreDistribution:
      firstTargetRedirect === undefined &&
      state.pendingCoreDistribution &&
      mine(state.pendingCoreDistribution.actingPlayerId)
        ? sanitizePendingCoreDistributionForDisplay(
            state.pendingCoreDistribution
          )
        : null,
    pendingMultiPlacement:
      firstTargetRedirect === undefined &&
      state.pendingMultiPlacement &&
      mine(state.pendingMultiPlacement.actingPlayerId)
        ? sanitizePendingWithContinuationForDisplay<PendingMultiPlacement>(
            state.pendingMultiPlacement
          )
        : null,
    pendingConnectBattleDecision:
      state.pendingConnectBattleDecision &&
      mine(state.pendingConnectBattleDecision.actingPlayerId)
        ? state.pendingConnectBattleDecision
        : null,
    pendingTargetRedirects:
      firstTargetRedirect !== undefined &&
      firstTargetRedirectResolver !== null &&
      mine(firstTargetRedirectResolver)
        ? [sanitizePendingWithContinuationForDisplay(firstTargetRedirect)]
        : [],
    pendingStoneFlipCombine:
      state.pendingStoneFlipCombine &&
      mine(state.pendingStoneFlipCombine.actingPlayerId)
        ? state.pendingStoneFlipCombine
        : null,
  };
}
