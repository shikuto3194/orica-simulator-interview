import { QuartzPlacementHud } from "./QuartzPlacementHud";
import {
  getFieldSymbolSources,
  findTokenPoolPreCostForcedCombineTrigger,
} from "@orica/rules-core";
import {
  coreDistributionRouteLabel,
  coreDistributionAvailableTotal,
} from "../utils/core-distribution-labels";
import { apiUrl } from "../apiUrl";
import { getAutomaticCostPaymentSources } from "../utils/automatic-cost-payment";
import {
  canAddCoreDistributionCore,
  getOwnHandCards,
  isInHandForOwnEffect,
} from "@orica/rules-core";
import {
  advanceSimpleAi,
  autoPlayerController,
  createSimpleAiProgress,
  type PlayerController,
} from "../utils/simple-ai";
export {
  autoPlayerController,
  type PlayerController,
} from "../utils/simple-ai";
import {
  initialPreGameUiPhase,
  type JankenHand,
  type PreGameUiPhase as UIPhase,
} from "../preGamePresentation";
import { BattleReplayRecorder, downloadReplay } from "../battleReplay";
import { IS_INTERVIEW_BUILD } from "../interview-mode";
import { notifyRoomLeave } from "../roomLeave";
import {
  getCoreShootSoulSourceId,
  coreShootSoulDestinationAllowed,
  isNormalCoreMovePrevented,
  isSoulStateCard,
} from "@orica/rules-core";
import { satisfiesCoreSourceGroupMinimums } from "@orica/rules-core";
import { projectRebirthCorePlacementPreview } from "../utils/rebirth-core-placement-preview";
import { getEffectSourceDisplay } from "../utils/effect-source-display";
import { EffectSourceScope } from "./EffectSourceScope";
import { getTurnFaceDownChoice } from "../utils/turn-face-down-choice";
import {
  getDeckRevealSelectedHandGainCost,
  getZoneSelectionHandGainCost,
  getHandGainCostPaymentSources,
} from "@orica/rules-core";
import {
  buildPendingCoreHud,
  effectCoreLocationToNormalContainer,
} from "../utils/core-hud-pending";
import { usePendingCoreHud } from "../hooks/usePendingCoreHud";
import { usePendingCardSelection } from "../hooks/usePendingCardSelection";
import { PendingCardSelectionControls } from "./PendingCardSelectionControls";
import { userFacingError } from "../utils/user-facing-error";
import { applyBraveSeparationWithCores } from "../utils/brave-separation";
import { zoneDisplayLabel, stepDisplayLabel } from "@orica/rules-core";
import { localizeEffectLabel } from "@orica/rules-core";
import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  AttackLegalAction,
  CardDefinition,
  GameState,
  LegalAction,
  SummonLegalAction,
  PlaceNexusLegalAction,
  UseMagicLegalAction,
  UseAccelLegalAction,
  SetMirageLegalAction,
  ResolvePendingSummonCostExcludeChoiceLegalAction,
  FieldCardEffectLegalAction,
  CardCostPaymentSource,
  EffectCoreLocation,
  NormalCoreContainer,
  PendingZoneSelection,
  PreGamePhase,
  ConfirmTargetRedirectLegalAction,
  DeclineTargetRedirectLegalAction,
  ResolvePendingZoneSelectionLegalAction,
  ResolveBraveLeaveChoiceLegalAction,
  ResolveBraveAttackContinuationLegalAction,
} from "@orica/rules-core";
import {
  initializeGame,
  getLegalActions,
  applyLegalAction,
  advanceStep,
  playSummonAsAction,
  placeNexusAsAction,
  getPlayerReserveCoreCount,
  getNormalCoreCountAtLocation,
  coreContainerId,
  getTotalCoresOnCardById,
  moveNormalCores,
  moveSoulCore,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildBurstEffectLookup,
  runStateBasedActions,
  flushPendingLeaves,
  setFirstPlayer,
  mulliganHand,
  applyContractPresentationChoices,
  applyGameStartEffects,
  queueInitialStartStepTrigger,
  createGameSnapshot,
  recomputeAndRebuildContinuousEffects,
  sanitizeStateForViewer,
  maskPendingPromptsForViewer,
  expandCardDefinitionsWithBackFaces,
  isLegalActionTargetGroupSelectionSatisfied,
  matchesCardFilter,
  resolvePlayerRef,
  getGameProgressBlockerReason,
  hasEligibleMainStepEndMagicActivation,
  canMoveCoresFrom,
  randomDeck,
  sanitizeMainDeckDefinitions,
  previewBurstEffectSuppression,
} from "@orica/rules-core";
import type { CoreShootCandidate } from "@orica/rules-core";

import type { CardInstance } from "@orica/rules-core";
import { FieldArea } from "./FieldArea";
import { StepChoiceRevealedCards } from "./StepChoiceRevealedCards";
import { BurstActivationConfirmation } from "./BurstActivationConfirmation";
import { BATTLE_PAIR_COLORS } from "./CardView";
import { HandArea } from "./HandArea";
import { GameHud } from "./GameHud";
import {
  ACTION_UI_ROUTES,
  attackCostGroupKey,
  getActionLabel,
  tapTargetInstanceIds,
} from "./action-ui";
import { ImmediateAttackJoinPrompt } from "./ImmediateAttackJoinPrompt";
import { ActionBar } from "./ActionBar";
import { PublicDisclosurePanel } from "./PublicDisclosurePanel";
import { CardDetailModal } from "./CardDetailModal";
import { GameResultOverlay } from "./GameResultOverlay";
import { RoomResetNotice } from "./RoomResetNotice";
import {
  EffectQueueOverlay,
  buildEffectQueue,
  isActionForEffectQueueFront,
  isAutomaticEffectQueueDrain,
  isSelectedTriggeredQueueItem,
  extractEffectTextByRegistrationIndex,
} from "./EffectQueueOverlay";
import { DeckRevealModal, DeckRevealTargetModal } from "./DeckRevealModal";
import {
  revealedTargetCardIds,
  visibleRevealedCardIds,
  confirmedRevealedTargetIds,
} from "../utils/revealed-target-presentation";
import { ZoneSelectionModal, zoneSelectionLabel } from "./ZoneSelectionModal";
import { PendingCountSelectionModal } from "./PendingCountSelectionModal";
import { PendingDiscardSetBurstCountSelectionModal } from "./PendingDiscardSetBurstCountSelectionModal";
import { LifeDamageDiscardChoiceModal } from "./LifeDamageDiscardChoiceModal";
import { LifeGainReplacementChoiceModal } from "./LifeGainReplacementChoiceModal";
import { ZoneBrowseModal } from "./ZoneBrowseModal";
import { collectUnderCardScopeIds } from "@orica/rules-core";
import { buildFieldStackBrowseByCard } from "../utils/field-under-card-visual";
import { describeCardFilter } from "../utils/describe-card-filter";
import { sortCardActionsForModal } from "../utils/card-action-modal-order";
import { ActionButtonChoices } from "./ActionButtonChoices";
import {
  distinguishActionButtonChoices,
  groupActionButtonChoices,
  type ActionButtonChoice,
} from "../utils/action-button-choices";
import {
  getFieldTapTargetIdsForCardClick,
  getSelectableFieldTapIds,
  getCardActionModalSourceInstanceId,
  groupCardActionsForModal,
} from "../utils/card-action-modal-groups";
import {
  compactEffectChoiceText,
  dedupeFieldEffectChoiceActions,
  divineSkillChoiceText,
  extractEffectChoiceTextByEffectIndex,
  fieldEffectChoiceActionKey,
  getFieldEffectActionDefinitionId,
} from "../utils/field-effect-choice";
import {
  TargetToast,
  TargetFooterActions,
  type TargetActionButton,
} from "./TargetSelectionController";
import { CoreSelectionHud } from "./CoreSelectionHud";
import { SoulCoreConfirmation } from "./SoulCoreConfirmation";
import { requiresCoreDistributionTargetTotals } from "../utils/core-distribution-selection";
import { computeManualCoreMoveBlockedLocationIds } from "../coreMoveGuard";
import {
  buildPlacementFieldSources,
  type PlacementFieldSource,
} from "../placementFieldSources";
import {
  applyDraftCoreMoves,
  findManualCoreMoveViolation,
  recomposeSummonLegalAction,
  recomposeMagicLegalAction,
  recomposeBraveSeparationLegalAction,
  recomposeCoreShootLegalAction,
  recomposeCoreSplitLegalAction,
  recomposeTrashDistributionLegalAction,
  recomposeMultiPlacement,
} from "@orica/rules-core";
import type { DraftCoreMove } from "@orica/rules-core";
import {
  useCoreSelection,
  locationIdToNormalContainer,
  locationIdToSoulContainer,
} from "../coreSelectionFacade";
import {
  coreContainerDisplayKey,
  computeCoreDisplayOverrides,
  computeSoulCoreDisplayOverrides,
} from "../coreDisplayOverrides";
import { useRoomSync } from "../hooks/useRoomSync";
import { useLongPress } from "../hooks/useLongPress";
import { useAuth } from "../AuthContext";
import { supabase } from "../supabaseClient";
import {
  avatarSrc,
  DEFAULT_OPPONENT_AVATAR_ID,
  DEFAULT_SELF_AVATAR_ID,
} from "../avatars";
import { useBgm } from "../bgm/BgmContext";
import {
  drainRoomDispatchQueue,
  isDuplicateRoomDispatchSignature,
  runTrackedRoomDispatch,
  type RoomDispatchTask,
} from "../utils/room-dispatch-queue";

function roomDispatchSignature(
  syncAction: LegalAction | "step",
  dispatchPayload?: Record<string, unknown>
): string {
  return syncAction === "step"
    ? "step:{}"
    : `${syncAction.kind}:${syncAction.actionId}:${JSON.stringify(dispatchPayload ?? {})}`;
}

function roomSpecialDispatchSignature(
  endpoint: string,
  payload: Record<string, unknown>
): string {
  return `special:${endpoint}:${JSON.stringify(payload)}`;
}

/**
 * スタック窓を開いて遅延解決する種別。ルール上スタック窓はコスト支払い後・対象選択前に
 * 開くため、宣言時には対象を選ばず、窓クローズ後の pendingEffectTargetSelection で選ぶ。
 * これらは宣言時の対象選択ブロックから除外する (engine 側が窓後に対象 pending を立てる)。
 */
const DEFERRED_TARGET_ACTION_KINDS = new Set<string>([
  "use_magic",
  "use_field_card_effect",
  "use_hand_card_effect",
  "resolve_pending_triggered_effect",
  "resolve_battle_immediate_effect",
  "resolve_pending_burst_check",
  "declare_advent",
  "declare_host_dual_advent",
  "declare_dual_host_advent",
  "contract_combine",
]);

/** 弧型ミニ手札では枚数が読み取りにくくなるため、 この枚数以上でアバター縁外周に
 *  「n枚」バッジを表示する。 自分・相手共通。 */
const HAND_COUNT_BADGE_THRESHOLD = 9;

/**
 * P3-48: HUD 表示用の通常 / ソウル コア数を draft 配列から派生する。
 * `kind === "normal"` は `amount` 加算、`kind === "soul"` は 1 件 1 個と数える。
 */
function countNormalSoulCores(drafts: readonly DraftCoreMove[]): {
  normal: number;
  soul: number;
} {
  let normal = 0;
  let soul = 0;
  for (const d of drafts) {
    if (d.kind === "normal") normal += d.amount;
    else soul += 1;
  }
  return { normal, soul };
}

function coreSplitDestinationIsField(location: EffectCoreLocation): boolean {
  return (
    location.kind === "field" ||
    location.kind === "field_card" ||
    location.kind === "target_card"
  );
}

function normalContainerBaseCount(
  state: GameState,
  container: NormalCoreContainer
): number {
  if (container.kind === "card") {
    return (
      state.cardInstances.find(
        (card) => card.instanceId === container.instanceId
      )?.normalCoreCount ?? 0
    );
  }
  const player = state.players.find((p) => p.id === container.playerId);
  if (!player) return 0;
  switch (container.kind) {
    case "reserve":
      return player.reserveNormalCoreCount;
    case "trash":
      return player.trashNormalCoreCount;
    case "life":
      return player.lifeNormalCoreCount;
    case "void":
      return player.voidNormalCoreCount;
  }
}

interface BattleScreenProps {
  cardDefs: CardDefinition[];
  aliceDeck?: CardDefinition[];
  bobDeck?: CardDefinition[];
  firstPlayerIndex?: 0 | 1;
  initialState?: GameState;
  /** Read-only replay state; retaining the board allows its existing animations to run. */
  replayState?: GameState;
  /** Recorded input presentation only; never dispatches a game action. */
  replayPresentation?: {
    action?: LegalAction | undefined;
    preGamePhase?: UIPhase | undefined;
  };
  /** initialState を取得したときの room state_version。room optimistic lock の初期値。 */
  initialVersion?: number;
  opponentController?: PlayerController;
  /** 操作するプレイヤー ID ("alice" | "bob")。未指定なら "alice" */
  viewingPlayerId?: string;
  /** ルームID（対人対戦時）。指定するとルーム API 経由で同期 */
  roomId?: string | null;
  /** Supabase ユーザーID（ルーム退出通知用） */
  userId?: string | null;
  /** P3-17 観戦専用モード: 入力を無効化、状態 push を無効化、退出/heartbeat を行わない */
  readOnly?: boolean;
  /** 棋譜/デバッグ観戦用: 両プレイヤーの非公開カード情報を表示層でも公開する */
  revealHiddenInfo?: boolean;
  /** readOnly でもカード詳細などの参照操作だけ許可する */
  allowReadOnlyInspection?: boolean;
  /** 棋譜再生: 左下の進行操作を置き換え、詳細は既存メニューに収める。 */
  replayControls?: {
    controls: React.ReactNode;
    details: React.ReactNode;
    onOpenMenu: () => void;
  };
  onExit?: () => void;
  /** ホーム画面（デッキビルダー）へ戻る。勝敗オーバーレイの「ホームに戻る」で使用。 */
  onHome?: (() => void) | undefined;
}

function buildDefinitionLookup(
  defs: CardDefinition[]
): (id: string) => CardDefinition | undefined {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id) => map.get(id);
}

function buildDeck(
  allCards: CardDefinition[],
  requestedDeck?: CardDefinition[]
): CardDefinition[] {
  const sanitizedRequested = requestedDeck
    ? sanitizeMainDeckDefinitions(requestedDeck)
    : undefined;
  if (sanitizedRequested && sanitizedRequested.length >= 40)
    return sanitizedRequested;
  // デッキ未指定 or 枚数不足 → 全カードからランダム40枚
  return randomDeck(allCards, 40);
}

/**
 * P3-105後判定 P3-99 系ではなく ENGINE-paid-prevention-immunity-card-cost Step3:
 * `payPreventionImmunityCost` variant で候補カード数が amount を超える (player が
 * 部分集合を選ぶ必要がある) ケースは GUI に候補ピッカーが未実装。この variant を
 * クリックすると `applyLegalAction` が `paidPreventionImmunityCardSelection` 未指定で
 * "explicit ... is required" を throw する (rules-core は候補数===amount の自動確定と
 * REST 経由の明示選択には対応済み — 未対応なのは GUI 側のみ)。ピッカー実装までは
 * この variant を選択肢から除外し、対価を払わない base action のみ提示する
 * (過小 offer だが安全。候補数===amount のときはこの関数は false を返し従来通り提示する)。
 */
export function isUnsupportedPaidPreventionImmunityCardVariant(
  action: LegalAction
): boolean {
  const a = action as {
    paidPreventionImmunityCardCostCandidateInstanceIds?: string[];
    paidPreventionImmunityCardCostAmount?: number;
  };
  const candidates = a.paidPreventionImmunityCardCostCandidateInstanceIds;
  const amount = a.paidPreventionImmunityCardCostAmount;
  return (
    candidates !== undefined &&
    amount !== undefined &&
    candidates.length > amount
  );
}

function createDemoGameState(
  defs: CardDefinition[],
  aliceDeck?: CardDefinition[],
  bobDeck?: CardDefinition[],
  firstPlayerIndex?: 0 | 1
): GameState {
  return initializeGame({
    playerIds: ["alice", "bob"],
    decks: [buildDeck(defs, aliceDeck), buildDeck(defs, bobDeck)],
    ...(firstPlayerIndex != null ? { firstPlayerIndex } : {}),
  });
}

/** コスト支払いUIで使うフィールドカード情報 */
interface CostPaymentFieldSource {
  instanceId: string;
  definitionId: string;
  maxAmount: number;
  soulCoreOnly: boolean;
  destination?: "trash" | "void";
}

/**
 * P3-48: コスト支払い stage の React state 型。
 * placement キャンセル時に cost stage へ戻すために `pendingPlacement.priorCostPayment`
 * へ snapshot として保持する用途で named type 化した。
 */
interface PendingCostPaymentState {
  action: LegalAction;
  def: CardDefinition;
  finalCost: number;
  reserveAvailable: number;
  reserveNormal: number;
  fieldSources: CostPaymentFieldSource[];
  minCoresForPlacement: number; // 0 for magic
  /**
   * P3-30/P3-34 B: 支払いの種別。
   * - "card_cost" (default): カード使用コスト (summon / magic / accel / change)。
   *   payment は applyLegalAction.paymentSources に渡る。
   * - "summon_in_trigger": 逆転醒など、すでに専用 pending に入った効果起点 summon。
   *   payment 後に applyLegalAction.summonPaymentSources へ流す。維持コア配置は
   *   発揮応答窓後の pendingMultiPlacement に委ねる。
   */
  mode?: "card_cost" | "summon_in_trigger" | "field_magic_pre_cost";
  handGainPayload?: {
    selectedDeckRevealCardIds?: string[];
    deckRevealPickFreeDestination?: "hand" | "set_aside";
    selectedZoneCardIds?: string[];
    zoneSelectionDestinationByCardId?: Record<string, "hand" | "set_aside">;
  };
  /**
   * BSAZ01-C12「戦力投入」: resolve_field_magic_pre_cost_trigger を通じて
   * ネストした通常 use_magic の使用コストを支払う。支払い確定時には top-level の
   * resolver action とこの decision を同時に dispatch する。
   */
  fieldMagicPreCostTriggerDecision?: "trigger";
  /** zone_discount magic: 使用時コストとして戻すカード。順序は [deck top, deck bottom]。 */
  selectedZoneCardIds?: string[];
  /**
   * SummonCostExcludeChoice (BSTH02.7-M01 effects[0] 等): resolve_pending_summon_cost_exclude_choice
   * action と一緒に送る除外対象トラッシュカード instanceId 群 (SummonCostExcludeChoiceModal で確定済み)。
   */
  summonCostExcludeSelectedCardInstanceIds?: string[];
  /** 効果内召喚の対象選択を経由したアクションの targetInstanceIds */
  payCostTargetInstanceIds?: string[];
  /** P3-34 B summon_in_trigger mode: 召喚対象カードの definitionId と instanceId */
  summonTargetInstanceId?: string;
  /**
   * ブレイヴ召喚 (`summon` を入口にしたフロー) かどうかの目印。合体する/スピリット状態の
   * 選択はスタック窓クローズ後の engine `pendingBraveCombineChoice` で行う。
   */
  braveSummon?: boolean;
}

/**
 * P2-08 10-2: 戦闘マーク ⚔（プレイマット仕切り線上に絶対配置）
 *
 * 戦闘成立後、アタッカー／ブロッカーの中心 x の平均を battle-center 内の
 * 相対 x（%）として CSS 変数 `--ac-duel-x` に書き込み、⚔ マークを追従させる。
 * アタッカーのみ／ブロッカーのみの場合はその片方に寄せる。
 *
 * P2-05: 同時アタックでは participant (= blockAssignments のペア) ごとに
 * ⚔ を 1 つずつ描画し、2ペア以上のときはペア色 (1ペア目=赤、2ペア目=青、…)
 * でマークを着色して「誰が誰とバトルしているか」を区別する。
 */
function DuelMarkSingle({
  attackerId,
  blockerId,
  tintColor,
}: {
  attackerId: string | null;
  blockerId: string | null;
  tintColor: string | null;
}) {
  const markRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const mark = markRef.current;
    if (!mark) return;
    const center = mark.parentElement;
    if (!center) return;

    const compute = () => {
      const field = center.closest(".battle-field") as HTMLElement | null;
      const attackerEl =
        attackerId && field
          ? (field.querySelector(
              `[data-testid="card-${attackerId}"]`
            ) as HTMLElement | null)
          : null;
      const blockerEl =
        blockerId && field
          ? (field.querySelector(
              `[data-testid="card-${blockerId}"]`
            ) as HTMLElement | null)
          : null;
      if (!attackerEl && !blockerEl) {
        mark.style.removeProperty("--ac-duel-x");
        return;
      }
      const cR = center.getBoundingClientRect();
      const xs: number[] = [];
      if (attackerEl) {
        const aR = attackerEl.getBoundingClientRect();
        xs.push((aR.left + aR.right) / 2);
      }
      if (blockerEl) {
        const bR = blockerEl.getBoundingClientRect();
        xs.push((bR.left + bR.right) / 2);
      }
      const targetAbsX = xs.reduce((s, v) => s + v, 0) / xs.length;
      const relPct = ((targetAbsX - cR.left) / cR.width) * 100;
      const clamped = Math.max(0, Math.min(100, relPct));
      mark.style.setProperty("--ac-duel-x", `${clamped.toFixed(2)}%`);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(center);
    const field = center.closest(".battle-field");
    if (field) ro.observe(field as Element);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [attackerId, blockerId]);

  return (
    <div
      ref={markRef}
      className="ac-duel-mark ac-duel-mark-center"
      aria-label="戦闘中"
      style={
        tintColor
          ? {
              color: tintColor,
              textShadow: `0 0 4px ${tintColor}, 0 0 12px ${tintColor}`,
            }
          : undefined
      }
    >
      ⚔
    </div>
  );
}

function DuelMark({ state }: { state: GameState }) {
  const attack = state.activeAttack;

  const pairs = useMemo(() => {
    if (!attack || !state.battleEntities) return [];
    const result: {
      attackerId: string | null;
      blockerId: string | null;
      pairIndex: number;
    }[] = [];
    const assignments = attack.blockAssignments ?? [];
    assignments.forEach((assignment, pairIndex) => {
      const attackerEntity = state.battleEntities.find(
        (e) => e.entityId === assignment.participantEntityId
      );
      const attackerId = attackerEntity?.memberInstanceIds[0] ?? null;
      // P2-05 Phase 5: 1 participant に複数ブロッカーが付く場合、同じ攻撃体との
      // ペアとして同一 pairIndex (同色) の ⚔ マークを複数描画する。
      const blockerIds = assignment.blockedByEntityIds
        .map(
          (blockerEntityId) =>
            state.battleEntities.find((e) => e.entityId === blockerEntityId)
              ?.memberInstanceIds[0] ?? null
        )
        .filter((id): id is string => id !== null);
      if (attackerId !== null || blockerIds.length > 0) {
        if (blockerIds.length > 0) {
          for (const blockerId of blockerIds) {
            result.push({ attackerId, blockerId, pairIndex });
          }
        } else {
          result.push({ attackerId, blockerId: null, pairIndex });
        }
      }
    });
    // blockAssignments 未生成 (指定アタック保留等) は primary の単独マーク
    if (result.length === 0) {
      const attackerEntity = state.battleEntities.find(
        (e) => e.entityId === attack.primaryEntityId
      );
      const attackerId = attackerEntity?.memberInstanceIds[0] ?? null;
      if (attackerId !== null) {
        result.push({ attackerId, blockerId: null, pairIndex: 0 });
      }
    }
    return result;
  }, [attack, state.battleEntities]);

  if (!attack) return null;
  return (
    <>
      {pairs.map((pair) => (
        <DuelMarkSingle
          key={`${pair.pairIndex}:${pair.blockerId ?? "none"}`}
          attackerId={pair.attackerId}
          blockerId={pair.blockerId}
          tintColor={
            pairs.length >= 2
              ? (BATTLE_PAIR_COLORS[
                  pair.pairIndex % BATTLE_PAIR_COLORS.length
                ] ?? null)
              : null
          }
        />
      ))}
    </>
  );
}

type SelectionTargetGroup = {
  requiredTargetCount: number;
  candidateTargetInstanceIds: string[];
};

type TargetGroupAwareAction = LegalAction & {
  targetGroups?: readonly SelectionTargetGroup[];
};

type AsIfSoulCoreAction = Extract<
  LegalAction,
  { kind: "resolve_pending_as_if_soul_core_choice" }
>;

type AsIfSoulCoreChoice = {
  pendingId: string;
  actionKind:
    | "contract_combine"
    | "declare_advent"
    | "declare_host_dual_advent";
  title: string;
  prompt: string;
  visualInstanceId: string;
  options: { action: AsIfSoulCoreAction; label: string; sourceName?: string }[];
};

function getSelectionTargetGroups(
  action: LegalAction | null
): readonly SelectionTargetGroup[] {
  if (!action || !("targetGroups" in action)) return [];
  return (action as TargetGroupAwareAction).targetGroups ?? [];
}

function satisfiesSelectionTargetGroups(
  targetIds: readonly string[],
  groups: readonly SelectionTargetGroup[],
  allowDuplicateTargets = false
): boolean {
  return isLegalActionTargetGroupSelectionSatisfied({
    targetInstanceIds: targetIds,
    targetGroups: groups,
    allowDuplicateTargets,
  });
}

function removeTargetAt(
  selectedTargets: readonly string[],
  removeIndex: number
): string[] {
  return selectedTargets.filter((_, index) => index !== removeIndex);
}

function replaceWithinFilledTargetGroup(
  selectedTargets: readonly string[],
  instanceId: string,
  groups: readonly SelectionTargetGroup[]
): string[] | null {
  for (const group of groups) {
    if (!group.candidateTargetInstanceIds.includes(instanceId)) continue;
    const selectedInGroup = selectedTargets.filter((id) =>
      group.candidateTargetInstanceIds.includes(id)
    );
    if (selectedInGroup.length < group.requiredTargetCount) continue;
    const removeId = selectedInGroup[0];
    return [...selectedTargets.filter((id) => id !== removeId), instanceId];
  }
  return null;
}

function rebalanceTargetGroupsWithCandidate(
  selectedTargets: readonly string[],
  instanceId: string,
  groups: readonly SelectionTargetGroup[]
): string[] | null {
  const withCandidate = [...selectedTargets, instanceId];
  for (let i = 0; i < selectedTargets.length; i++) {
    const candidate = removeTargetAt(withCandidate, i);
    if (satisfiesSelectionTargetGroups(candidate, groups)) {
      return candidate;
    }
  }
  return replaceWithinFilledTargetGroup(selectedTargets, instanceId, groups);
}

export function BattleScreen(props: BattleScreenProps) {
  const [session, setSession] = useState(0);
  const [decks] = useState(() => {
    if (props.roomId || props.readOnly) return {};
    const restoredDeck = (player: string) =>
      props.initialState?.cardInstances
        .filter((card) => card.ownerPlayerId === player)
        .map((card) =>
          props.cardDefs.find(
            (def) =>
              def.cardNo === (card.originalDefinitionId ?? card.definitionId)
          )
        )
        .filter((card): card is CardDefinition => card !== undefined);
    return {
      aliceDeck: buildDeck(
        props.cardDefs,
        props.aliceDeck ?? restoredDeck("alice")
      ),
      bobDeck: buildDeck(props.cardDefs, props.bobDeck ?? restoredDeck("bob")),
    };
  });
  const { initialState, ...rest } = props;
  return (
    <BattleSession
      {...rest}
      {...(session === 0 && initialState ? { initialState } : {})}
      {...decks}
      key={
        props.roomId
          ? JSON.stringify([
              session,
              props.roomId,
              props.userId,
              props.viewingPlayerId,
              props.readOnly,
            ])
          : session
      }
      onLocalRematch={() => setSession((value) => value + 1)}
    />
  );
}

function BattleSession({
  cardDefs,
  aliceDeck,
  bobDeck,
  firstPlayerIndex,
  initialState,
  replayState,
  replayPresentation,
  initialVersion = 0,
  opponentController = autoPlayerController,
  viewingPlayerId = "alice",
  roomId = null,
  userId = null,
  readOnly = false,
  revealHiddenInfo = false,
  allowReadOnlyInspection = false,
  replayControls,
  onExit,
  onHome,
  onLocalRematch,
}: BattleScreenProps & { onLocalRematch: () => void }) {
  // ダブルフェイス B 面の合成定義を加えた展開プール（サーバ game-api と同じ SSOT 関数）。
  // これが無いと転醒後の B 面 cardNo が定義解決できず、表示が "?" になり
  // B 面の『転醒時』効果もクライアント側でレジストリ登録されない。
  const expandedDefs = useMemo(
    () => expandCardDefinitionsWithBackFaces(cardDefs),
    [cardDefs]
  );

  const getDefinition = useMemo(
    () => buildDefinitionLookup(expandedDefs),
    [expandedDefs]
  );

  // effects → 各種登録を自動生成
  const effectLookups = useMemo(
    () => ({
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(expandedDefs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(expandedDefs),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(expandedDefs),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(expandedDefs),
      getRegisteredMagicActions: buildMagicLookup(expandedDefs),
      getRegisteredBurstActions: buildBurstEffectLookup(expandedDefs),
    }),
    [expandedDefs]
  );

  // GUI-API 状態同期: ルームIDがあればルーム API、なければレガシー API
  const { getAccessToken, getCachedAccessToken, refreshAccessToken, profile } =
    useAuth();
  const {
    pushState: rawPushState,
    dispatchAction: rawDispatchAction,
    dispatchStep: rawDispatchStep,
    dispatchClaimVictory: rawDispatchClaimVictory,
    dispatchCoreMove: rawDispatchCoreMove,
    dispatchBraveSeparation: rawDispatchBraveSeparation,
    dispatchPregameUpdate: rawDispatchPregameUpdate,
    dispatchRematch: rawDispatchRematch,
    dispatchReset: rawDispatchReset,
    pollForChanges,
    heartbeat,
    roomStateVersion,
    syncError,
    resetPolling,
    sseStatus,
    setOnSSEStateUpdate,
    lastPushedVersion,
    fetchLatestState,
    getConfirmedState,
  } = useRoomSync(
    roomId,
    readOnly ? undefined : getAccessToken,
    !readOnly,
    initialVersion,
    initialState ?? null,
    !readOnly && userId ? refreshAccessToken : undefined,
    readOnly ? null : userId,
    viewingPlayerId
  );
  // room: dispatch 送信中フラグ (server-authoritative reconcile 中の pending 表示用)。
  const [dispatchPending, setDispatchPending] = useState(false);
  // 公開情報の persistent 表示を、viewer が実際に LegalAction を送った時点で解除する。
  const [
    publicDisclosureViewerActionSequence,
    setPublicDisclosureViewerActionSequence,
  ] = useState(0);
  // 非冪等な専用 endpoint (core-move / brave-separation) を dispatchSpecial で直接
  // 送信するハンドラ用の同期的再入ガード。これらは setStateAndSync を経由せず
  // dispatchPending を立てないため、連打/ダブルクリックでの二重送信を ref で防ぐ。
  const specialDispatchInFlightRef = useRef(false);
  // room の action/step dispatch (setStateAndSync 経由) 用の同期的再入ガード。
  // dispatchPending は state 更新が次レンダーまで反映されず同フレーム多重クリックを
  // 同期的に弾けないため、ref で「dispatch in-flight」を即時判定する。
  const roomDispatchInFlightRef = useRef(false);
  const activeRoomDispatchSignatureRef = useRef<string | null>(null);
  const roomDispatchQueueRef = useRef<RoomDispatchTask<GameState>[]>([]);
  const roomSpecialDispatchCountRef = useRef(0);
  const flushDeferredRoomStateRef = useRef<
    (fetchWhenMissing?: boolean) => Promise<void>
  >(async () => {});
  const trackRoomSpecialDispatch = useCallback(
    <T,>(dispatch: () => Promise<T>): Promise<T> => {
      roomSpecialDispatchCountRef.current += 1;
      return runTrackedRoomDispatch(dispatch, async () => {
        roomSpecialDispatchCountRef.current = Math.max(
          0,
          roomSpecialDispatchCountRef.current - 1
        );
        if (roomSpecialDispatchCountRef.current === 0) {
          await flushDeferredRoomStateRef.current(false);
        }
      });
    },
    []
  );
  // 観戦専用モードでは push / dispatch を no-op に置き換えて意図しない書き込みを防ぐ
  const pushState = useMemo(
    () => (readOnly ? async () => {} : rawPushState),
    [readOnly, rawPushState]
  );
  const dispatchAction = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : rawDispatchAction,
    [readOnly, rawDispatchAction]
  );
  const dispatchStep = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : rawDispatchStep,
    [readOnly, rawDispatchStep]
  );
  const dispatchClaimVictory = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : (...args: Parameters<typeof rawDispatchClaimVictory>) =>
            trackRoomSpecialDispatch(() => rawDispatchClaimVictory(...args)),
    [readOnly, rawDispatchClaimVictory, trackRoomSpecialDispatch]
  );
  const dispatchCoreMove = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : (...args: Parameters<typeof rawDispatchCoreMove>) =>
            trackRoomSpecialDispatch(() => rawDispatchCoreMove(...args)),
    [readOnly, rawDispatchCoreMove, trackRoomSpecialDispatch]
  );
  const dispatchBraveSeparation = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : (...args: Parameters<typeof rawDispatchBraveSeparation>) =>
            trackRoomSpecialDispatch(() => rawDispatchBraveSeparation(...args)),
    [readOnly, rawDispatchBraveSeparation, trackRoomSpecialDispatch]
  );
  const dispatchPregameUpdate = useMemo(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : (...args: Parameters<typeof rawDispatchPregameUpdate>) =>
            trackRoomSpecialDispatch(() => rawDispatchPregameUpdate(...args)),
    [readOnly, rawDispatchPregameUpdate, trackRoomSpecialDispatch]
  );
  const dispatchRematch = useMemo<typeof rawDispatchRematch>(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : () => trackRoomSpecialDispatch(rawDispatchRematch),
    [readOnly, rawDispatchRematch, trackRoomSpecialDispatch]
  );
  const dispatchReset = useMemo<typeof rawDispatchReset>(
    () =>
      readOnly
        ? async () => ({ ok: false as const, error: "readOnly" })
        : (approve) =>
            trackRoomSpecialDispatch(() => rawDispatchReset(approve)),
    [readOnly, rawDispatchReset, trackRoomSpecialDispatch]
  );

  const [recording] = useState(() => new BattleReplayRecorder());
  const [internalState, setInternalState] = useState<GameState>(() => {
    const first =
      initialState ??
      createDemoGameState(cardDefs, aliceDeck, bobDeck, firstPlayerIndex);
    if (!readOnly) recording.append(first);
    return first;
  });
  const state = readOnly && replayState ? replayState : internalState;
  const setState = useCallback(
    (next: GameState) => {
      if (!readOnly && !roomId) recording.append(next);
      setInternalState(next);
    },
    [readOnly, roomId, recording]
  );
  // 通知の既読番号は確定した履歴だけで進める。楽観stateは拒否で巻き戻り、
  // 同じdisclosure sequenceが次の正常操作に再利用されるため分離する。
  const [roomPublicDisclosureState, setRoomPublicDisclosureState] =
    useState(internalState);
  const viewingPlayer = viewingPlayerId;
  // Only suppress duplicate idle recordings; the hook remains the source of
  // confirmed state and recovery may still replace a preview with this object.
  const lastAppliedRoomStateRef = useRef<GameState | null>(
    roomId ? (initialState ?? null) : null
  );

  const applyRoomAuthoritativeState = useCallback(
    (nextState: GameState) => {
      // The hook owns the versioned server snapshot. An older awaited HTTP
      // result must not replace a newer SSE/poll snapshot (or a different room).
      const confirmed = getConfirmedState();
      if (!confirmed) return false;
      nextState = confirmed;
      if (!readOnly && nextState !== lastAppliedRoomStateRef.current)
        recording.append(nextState);
      lastAppliedRoomStateRef.current = nextState;
      setRoomPublicDisclosureState(nextState);
      setState(nextState);
      return true;
    },
    [getConfirmedState, readOnly, recording, setState]
  );

  const flushDeferredRoomAuthoritativeState = useCallback(
    async (fetchWhenMissing = false) => {
      if (
        roomDispatchInFlightRef.current ||
        roomDispatchQueueRef.current.length > 0 ||
        roomSpecialDispatchCountRef.current > 0
      ) {
        return;
      }
      const authoritative =
        getConfirmedState() ??
        (fetchWhenMissing ? await fetchLatestState() : null);
      if (authoritative) applyRoomAuthoritativeState(authoritative);
    },
    [applyRoomAuthoritativeState, fetchLatestState, getConfirmedState]
  );
  flushDeferredRoomStateRef.current = flushDeferredRoomAuthoritativeState;

  const reconcileRoomDispatchResult = useCallback(
    async (result: {
      ok: boolean;
      state?: GameState;
      stateRecoveryAttempted?: boolean;
      pending?: boolean;
    }) => {
      if (result.state) {
        applyRoomAuthoritativeState(result.state);
        return;
      }
      const checkpoint = getConfirmedState();
      if (checkpoint) applyRoomAuthoritativeState(checkpoint);
      // Recovery already ran, or settlement owns the uncertain operation.
      // Keep the last confirmed board and let polling/reconnect finish recovery.
      if (result.stateRecoveryAttempted || result.pending) return;
      const authoritative = await fetchLatestState();
      if (authoritative) applyRoomAuthoritativeState(authoritative);
    },
    [applyRoomAuthoritativeState, fetchLatestState, getConfirmedState]
  );

  const isDuplicateRoomDispatchTask = useCallback((signature: string) => {
    if (!roomDispatchInFlightRef.current) return false;
    const lastQueued =
      roomDispatchQueueRef.current[roomDispatchQueueRef.current.length - 1];
    return isDuplicateRoomDispatchSignature(
      signature,
      activeRoomDispatchSignatureRef.current,
      lastQueued?.signature ?? null
    );
  }, []);

  const runRoomDispatchQueue = useCallback(
    async (firstTask: RoomDispatchTask<GameState>) => {
      roomDispatchInFlightRef.current = true;
      setDispatchPending(true);
      try {
        await drainRoomDispatchQueue({
          firstTask,
          queue: roomDispatchQueueRef.current,
          onActiveTask: (task) => {
            activeRoomDispatchSignatureRef.current = task.signature;
          },
          checkpointSuccessfulState: applyRoomAuthoritativeState,
          reconcile: reconcileRoomDispatchResult,
        });
      } finally {
        activeRoomDispatchSignatureRef.current = null;
        roomDispatchInFlightRef.current = false;
        setDispatchPending(false);
        await flushDeferredRoomAuthoritativeState(true);
      }
    },
    [
      flushDeferredRoomAuthoritativeState,
      reconcileRoomDispatchResult,
      applyRoomAuthoritativeState,
    ]
  );

  const queueRoomSpecialMutation = useCallback(
    (
      signature: string,
      dispatch: RoomDispatchTask<GameState>["dispatch"],
      onDiscard?: () => void
    ): boolean => {
      if (isDuplicateRoomDispatchTask(signature)) return false;
      const task: RoomDispatchTask<GameState> = {
        signature,
        dispatch,
        ...(onDiscard ? { onDiscard } : {}),
      };
      if (roomDispatchInFlightRef.current) {
        roomDispatchQueueRef.current.push(task);
      } else {
        void runRoomDispatchQueue(task);
      }
      return true;
    },
    [isDuplicateRoomDispatchTask, runRoomDispatchQueue]
  );

  // 表示用サニタイズ状態。シナリオ / スナップショット経路はサーバ sanitize を
  // 通らず full state をクライアントが保持するため、viewer 視点で相手の非公開
  // カード (裏向きフィールド / 手札 / デッキ等) の正体が CardView / 詳細モーダル
  // から漏れる。表示層 (FieldArea / CardDetailModal) には sanitize 済み
  // cardInstances を渡し、engine / legal-action / 相手 auto-play は full `state`
  // を使い続ける (sanitize すると相手手札が隠れて auto-play が壊れるため)。
  //
  // さらに maskPendingPromptsForViewer で「解決者でない pending UI prompt」を null 化する。
  // これにより GUI の UI 反応判定 (hasUiPending / coreSelection 起動 / モーダル表示) を
  // displayState 経由に一元化でき、「相手の対象選択中に自分の UI が連動する」連動バグを
  // 個別 gate なしで防げる。engine は引き続き full `state` を使う。
  //
  // 棋譜/デバッグ観戦だけは hidden info も検証対象なので、カード可視性の
  // sanitize を外した full state を表示層へ渡す。
  const displayState = useMemo(() => {
    const visibleState = revealHiddenInfo
      ? state
      : sanitizeStateForViewer(state, viewingPlayer);
    return maskPendingPromptsForViewer(visibleState, viewingPlayer);
  }, [state, viewingPlayer, revealHiddenInfo]);
  const publicDisclosureDisplayState = useMemo(() => {
    if (!roomId) return displayState;
    const visibleState = revealHiddenInfo
      ? roomPublicDisclosureState
      : sanitizeStateForViewer(roomPublicDisclosureState, viewingPlayer);
    return maskPendingPromptsForViewer(visibleState, viewingPlayer);
  }, [
    roomId,
    displayState,
    roomPublicDisclosureState,
    viewingPlayer,
    revealHiddenInfo,
  ]);
  const fieldDisplayState = useMemo(
    () => projectRebirthCorePlacementPreview(displayState, getDefinition),
    [displayState, getDefinition]
  );
  const sanitizedCardById = useMemo(() => {
    const m = new Map<string, CardInstance>();
    for (const c of displayState.cardInstances) m.set(c.instanceId, c);
    return m;
  }, [displayState]);

  // ----- プレイヤーアバター解決 -----
  // self  : 自分視点で下に表示するアバター
  // opp   : 相手視点で上に表示するアバター
  // ソロモード: self = 自分の profile.avatar_id / opp = デフォルト
  // ルーム / 観戦: room.players の userId から profiles を fetch
  const [selfAvatarId, setSelfAvatarId] = useState<string | null>(null);
  const [opponentAvatarId, setOpponentAvatarId] = useState<string | null>(null);

  useEffect(() => {
    // ソロモード (roomId なし): profile から自分、相手はデフォルト
    if (!roomId) {
      setSelfAvatarId(profile?.avatar_id ?? null);
      setOpponentAvatarId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        const token = readOnly ? null : await getAccessToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(apiUrl(`/api/room/${roomId}`), { headers });
        if (!res.ok) return;
        const data = (await res.json()) as {
          players?: Array<{ role: string; userId: string }>;
        };
        const players = data.players ?? [];
        const userIds = players.map((p) => p.userId).filter(Boolean);
        if (userIds.length === 0) return;
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, avatar_id")
          .in("user_id", userIds);
        if (cancelled) return;
        const profMap = new Map<string, string | null>(
          (profs ?? []).map((p) => [
            p.user_id as string,
            p.avatar_id as string | null,
          ])
        );
        const findFor = (role: string): string | null => {
          const pl = players.find((p) => p.role === role);
          return pl ? (profMap.get(pl.userId) ?? null) : null;
        };
        const oppRole = viewingPlayer === "alice" ? "bob" : "alice";
        // 対戦参加 (readOnly=false): 自分は profile を優先（保存後の即時反映用）
        // 観戦 (readOnly=true): 両者とも room から取得
        if (!readOnly && profile?.avatar_id) {
          setSelfAvatarId(profile.avatar_id);
        } else {
          setSelfAvatarId(findFor(viewingPlayer));
        }
        setOpponentAvatarId(findFor(oppRole));
      } catch {
        /* network / supabase エラーは無視してフォールバック表示 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, viewingPlayer, readOnly, profile?.avatar_id, getAccessToken]);

  // じゃんけん+マリガンフェーズ: preGame が存在する場合にオーバーレイ表示
  const jankenDone = !state?.preGame;

  // pre-game 中に janken が確定した瞬間に HUD だけ即時更新するための override。
  // 親 state は伝播させずに済むので、マリガン中のゲーム自動進行を引き起こさない。
  // pre-game 終了 (state.preGame === null) で自動的にクリアされる。
  const [pregameFirstPlayerOverride, setPregameFirstPlayerOverride] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (jankenDone && pregameFirstPlayerOverride !== null) {
      setPregameFirstPlayerOverride(null);
    }
  }, [jankenDone, pregameFirstPlayerOverride]);

  const handlePreGameComplete = useCallback(
    (updatedState: GameState) => {
      if (roomId) {
        // room preGame completion waits for server-authoritative state.
        // The local preGame state may only contain the mulligan choice; the
        // actual shuffle/draw happens in /pregame-update on the server.
        void flushDeferredRoomAuthoritativeState(true);
        return;
      }
      const withTrigger = queueInitialStartStepTrigger(
        updatedState,
        getDefinition,
        effectLookups.getRegisteredTriggeredEffectActions
      );
      setState(withTrigger);
    },
    [
      effectLookups,
      flushDeferredRoomAuthoritativeState,
      getDefinition,
      roomId,
      setState,
    ]
  );

  // ルーム退出処理。JWT付き keepalive fetch、未達時は既存 heartbeat timeout で検出。
  // 観戦モード時は room.players ではないため leave/heartbeat の対象外
  const handleExit = useCallback(() => {
    if (roomId && userId && !readOnly) {
      void getAccessToken().then((token) =>
        notifyRoomLeave(roomId, userId, token)
      );
    }
    (onHome ?? onExit)?.();
  }, [roomId, userId, readOnly, onHome, onExit, getAccessToken]);

  const handleExportSnapshot = useCallback(() => {
    if (IS_INTERVIEW_BUILD) return;
    const snap = createGameSnapshot(state, {
      origin: roomId
        ? { sourceKind: "room", sourceId: roomId }
        : { sourceKind: "manual" },
    });
    const json = JSON.stringify(snap, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const ts = snap.savedAt.replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `orica-snapshot-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state, roomId]);

  // pagehide 時はキャッシュ済みJWTを使い、非同期のセッション取得を待たない。
  useEffect(() => {
    if (!roomId || !userId || readOnly) return;

    const onPageHide = () => {
      void notifyRoomLeave(roomId, userId, getCachedAccessToken());
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [roomId, userId, readOnly, getCachedAccessToken]);

  // 相手の切断状態
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  // 切断検知開始タイムスタンプ（60秒タイムアウト用）
  const disconnectStartRef = useRef<number | null>(null);
  const [canClaimVictory, setCanClaimVictory] = useState(false);

  // 切断 → 60秒経過で勝利宣言可能に
  useEffect(() => {
    if (opponentDisconnected) {
      if (!disconnectStartRef.current) {
        disconnectStartRef.current = Date.now();
      }
      const timer = setInterval(() => {
        if (
          disconnectStartRef.current &&
          Date.now() - disconnectStartRef.current >= 60_000
        ) {
          setCanClaimVictory(true);
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    } else {
      // 再接続 → リセット
      disconnectStartRef.current = null;
      setCanClaimVictory(false);
    }
  }, [opponentDisconnected]);

  // 勝利宣言ハンドラ
  // P3-64 Phase B-5: room モードでは専用 endpoint dispatchClaimVictory 経由で server 確定。
  // single-player (roomId === null) では legacy pushState fallback。
  const handleClaimVictory = useCallback(() => {
    if (!state || state.gameResult) return;
    const winnerPlayerId = viewingPlayer;
    const loser = state.players.find((p) => p.id !== winnerPlayerId);
    if (!loser) throw new Error("opponent player not found");
    const updatedState = {
      ...state,
      gameResult: {
        kind: "player_loss" as const,
        losingPlayerId: loser.id,
        reason: "opponent_disconnect_timeout",
      },
    };
    setState(updatedState);
    if (roomId) {
      queueRoomSpecialMutation(
        roomSpecialDispatchSignature("claim-victory", {
          reason: "opponent_disconnect_timeout",
        }),
        () => dispatchClaimVictory("opponent_disconnect_timeout")
      );
    } else {
      pushState(updatedState);
    }
  }, [
    state,
    viewingPlayer,
    pushState,
    dispatchClaimVictory,
    roomId,
    queueRoomSpecialMutation,
    setState,
  ]);

  // Heartbeat: 10秒間隔で送信、hidden 時は 30秒間隔
  useEffect(() => {
    if (!roomId || !userId || readOnly) return;

    let intervalMs = 10_000;
    let timerId: ReturnType<typeof setInterval>;

    const sendHeartbeat = async () => {
      try {
        const res = await heartbeat(userId);
        if (res.ok) {
          const data = await res.json();
          // 相手の切断状態を更新
          if (data.opponentDisconnected) {
            const disconnected = Object.values(
              data.opponentDisconnected as Record<string, boolean>
            ).some((v) => v);
            setOpponentDisconnected(disconnected);
          }
        }
      } catch {
        /* ignore */
      }
    };

    const startInterval = () => {
      clearInterval(timerId);
      timerId = setInterval(sendHeartbeat, intervalMs);
    };

    const onVisibilityChange = () => {
      intervalMs = document.hidden ? 30_000 : 10_000;
      startInterval();
      if (!document.hidden) sendHeartbeat(); // 復帰時に即送信
    };

    sendHeartbeat(); // 初回即送信
    startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [roomId, userId, readOnly, heartbeat]);

  /**
   * P3-64 Phase B-3/B-5: setState + API 同期のラッパー。
   *
   * 同期モードは syncAction で指定する:
   * - `LegalAction` を渡す: server へ `POST /api/room/:id/action` で actionId + payload を送信
   *   (server 側 engine が再実行 → SSE で broadcast)。ローカル engine の result.state は optimistic
   *   表示用に setState される。
   * - `"step"`: server へ `POST /api/room/:id/step` (engine.advanceStep) を送信。
   * - `"skip-sync"`: setState のみ (UI ローカル状態の preview / draft 更新用)。
   * - 省略 (旧経路): single-player legacy /api/game/state PUT のみで動作。room モード時は
   *   Phase B-5 で PUT /api/room/:id/state を削除済みなので 404 になる (= dispatch 化忘れ
   *   の早期検知ガードレール)。room の状態変更は dispatchAction / dispatchStep / 専用
   *   endpoint 経由を強制する。
   */
  const setStateAndSync = useCallback(
    (
      newState: GameState,
      syncAction?: LegalAction | "step" | "skip-sync",
      dispatchPayload?: Record<string, unknown>
    ) => {
      // room の action/step dispatch は server-authoritative。同一 input の再入は除外し、
      // 別の後続 input は queue して optimistic UI を保ったまま順番に送る。
      const isRoomMutation =
        !!roomId &&
        (syncAction === "step" ||
          (syncAction != null && typeof syncAction === "object"));
      const roomDispatchTask: RoomDispatchTask<GameState> | null =
        isRoomMutation
          ? {
              signature: roomDispatchSignature(
                syncAction as LegalAction | "step",
                dispatchPayload
              ),
              dispatch:
                syncAction === "step"
                  ? () => dispatchStep()
                  : () =>
                      dispatchAction(
                        (syncAction as LegalAction).actionId,
                        dispatchPayload
                      ),
            }
          : null;
      if (
        roomDispatchTask &&
        isDuplicateRoomDispatchTask(roomDispatchTask.signature)
      ) {
        return;
      }

      if (
        syncAction !== undefined &&
        typeof syncAction === "object" &&
        syncAction.actingPlayerId === viewingPlayer
      ) {
        setPublicDisclosureViewerActionSequence((sequence) => sequence + 1);
      }
      setState(newState);
      if (syncAction === "skip-sync") return;
      if (!roomId) {
        // single-player legacy: dispatch は使えないので pushState (PUT /api/game/state) へ
        pushState(newState);
        return;
      }
      // room モード = サーバ権威 (server-authoritative)。
      // setState(newState) は即時反映の楽観 preview。送信中に発生した後続 input は
      // 捨てずに queue し、直前 dispatch の version 確定後に順番通り送る。
      if (roomDispatchTask) {
        if (roomDispatchInFlightRef.current) {
          roomDispatchQueueRef.current.push(roomDispatchTask);
        } else {
          void runRoomDispatchQueue(roomDispatchTask);
        }
        return;
      }
      // syncAction 省略 = dispatch 化忘れ。room では送る先が無い (PUT /state は Phase B-5
      // で削除済み)。404 で「同期失敗」を出すと無害な操作まで失敗扱いになるため、dev 警告
      // だけ出して no-op にする (楽観 setState は済んでおり、次の poll/SSE で権威に収束)。
      if (import.meta.env.DEV) {
        console.warn(
          "[setStateAndSync] room モードで syncAction 未指定の呼び出し (dispatch 化忘れの可能性)"
        );
      }
    },
    [
      pushState,
      dispatchAction,
      dispatchStep,
      isDuplicateRoomDispatchTask,
      roomId,
      runRoomDispatchQueue,
      viewingPlayer,
      setState,
    ]
  );

  // 初回マウント時に API に state を push (single-player legacy のみ)。
  // room モードはサーバが state を保持 (PUT /state は削除済み→404 になる) ため
  // 初回 push しない。サーバ state は initialState / poll / SSE で受け取る。
  const initSyncDone = useRef(false);
  useEffect(() => {
    if (initSyncDone.current) return;
    initSyncDone.current = true;
    if (state && !roomId) {
      pushState(state);
    }
    // roomId あり → サーバ authoritative。push せず polling/SSE で同期する
  }, [pushState, state, roomId]);

  // SSE state_update コールバック登録（version ベースの echo 防止）
  useEffect(() => {
    setOnSSEStateUpdate((newState: GameState, version: number) => {
      // 自分が push した version 以下は echo → スキップ
      if (version <= lastPushedVersion.current) return;
      applyRoomAuthoritativeState(newState);
    });
    return () => setOnSSEStateUpdate(null);
  }, [applyRoomAuthoritativeState, setOnSSEStateUpdate, lastPushedVersion]);

  // フォールバックポーリング: SSE が新鮮な connected 中は watchdog として 60 秒だけ確認し、
  // 未接続・接続中・stale 時は 500ms ポーリングで追随する。
  // version ベースの echo 防止は pollForChanges 内の version 比較で対応済み
  // 単独プレイ (roomId なし) では他プレイヤー同期が不要なため polling 自体をスキップ
  // → pushState の非同期完了前に古い state で rollback されるバグを防ぐ
  useEffect(() => {
    if (!roomId) return;
    const intervalMs =
      sseStatus === "connected" && syncError?.type !== "recovering"
        ? 60_000
        : 500;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const newState = await pollForChanges();
      if (cancelled) return;
      // A restarted polling effect can recover an already received snapshot.
      // Do not record/apply the same authoritative object on every idle poll.
      if (newState && newState !== lastAppliedRoomStateRef.current) {
        applyRoomAuthoritativeState(newState);
      }
      timer = setTimeout(poll, intervalMs);
    };
    timer = setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    applyRoomAuthoritativeState,
    pollForChanges,
    sseStatus,
    roomId,
    syncError?.type,
  ]);

  // 診断: 同期エラーの詳細 (type / retry / HTTP status / サーバ engine エラー文) を
  // コンソールに残す。バナーは一時表示で消えるため、devtools で履歴を追えるようにする。
  useEffect(() => {
    if (syncError) {
      console.error(
        `[sync] ${syncError.type} (retry ${syncError.retryCount}): ${syncError.lastError}`
      );
    }
  }, [syncError]);
  const [message, setMessage] = useState<string | null>(null);
  const [stepAnnounce, setStepAnnounce] = useState<string | null>(null);
  useEffect(() => {
    // preGame 中はステップアニメーションを出さない
    if (state.preGame) {
      setStepAnnounce(null);
      return;
    }
    // Every setup needs its own expiry, including StrictMode's cleanup/setup.
    setStepAnnounce(stepDisplayLabel(state.step));
    const timer = setTimeout(() => setStepAnnounce(null), 1000);
    return () => clearTimeout(timer);
  }, [state.step, state.preGame]);
  const [detailCard, setDetailCard] = useState<CardInstance | null>(null);
  const [zoneBrowse, setZoneBrowse] = useState<{
    zone:
      | "trash"
      | "void"
      | "removed_from_game"
      | "set_aside"
      | "burst"
      | "deck"
      | "field";
    playerId: string;
    label: string;
  } | null>(null);
  // フィールド上の重なり閲覧 (右クリック/長押し → ZoneBrowseModal 流用)。
  const [fieldStackBrowse, setFieldStackBrowse] = useState<{
    instanceIds: string[];
    title: string;
  } | null>(null);
  const fieldStackBrowseByCard = useMemo(
    () =>
      buildFieldStackBrowseByCard(displayState.cardInstances, getDefinition),
    [displayState.cardInstances, getDefinition]
  );
  // 長押し/右クリックの詳細表示。重なりカードはスタックをモーダル展開し、
  // それ以外は単体の CardDetailModal を開く。左クリック (効果発揮) は別経路。
  const openCardDetail = (id: string) => {
    const c = displayState.cardInstances.find((ci) => ci.instanceId === id);
    if (!c) return;
    const browse = fieldStackBrowseByCard.get(c.instanceId);
    if (browse) {
      setFieldStackBrowse({
        instanceIds: [...browse.instanceIds],
        title: browse.title,
      });
      return;
    }
    setDetailCard(c);
  };
  const [pendingAction, setPendingAction] = useState<LegalAction | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [targetBrowseOpen, setTargetBrowseOpen] = useState(false);
  // P3-46 Phase 2: コア移動 draft / preview state を facade に統合。
  // coreMoveMode / coreMoveTransfers は読み取り側互換のため facade から派生する。
  const coreSelection = useCoreSelection(state, getDefinition);
  const coreMoveMode = coreSelection.mode === "core_move";
  // P3-90 + token: 手動コア移動は source / destination で拒否条件が異なる。
  // 独立コア管理カードは両側不可、token の「出すとき以外で置けず」は destination のみ不可。
  const coreMoveBlockedLocationIds = useMemo(
    () => computeManualCoreMoveBlockedLocationIds(state, getDefinition),
    [state, getDefinition]
  );
  const coreMoveBlockedIds =
    coreSelection.phase === 2
      ? coreMoveBlockedLocationIds.destinationBlockedIds
      : coreMoveBlockedLocationIds.sourceBlockedIds;
  // P3-49: 単一「現在 grab 中のソース」表現は held buffer に置換 (Phase 1 で複数積める)。
  // `coreMoveFrom` は FieldArea の選択中ハイライト用に残している (常に null 動作)。
  const [coreMoveFrom, setCoreMoveFrom] = useState<string | null>(null);
  // P3-47 F-5: any_movable_self distribution 用の「アクティブソース」キー。
  // null = 未選択。ユーザーが reserve / trash / life / 自分 field カードを tap して選ぶ。
  // recipient タップ時はこのソースから 1 コアを引いて draft に追加する (コア移動 UX 流用)。
  const [multiSourceActiveKey, setMultiSourceActiveKey] = useState<
    string | null
  >(null);
  // legacy view: { from: string; to: string; soul: boolean }[] へ射影。
  // facade.draftMoves を読み取り側コードから直接使える形に整形する。
  const coreMoveTransfers = useMemo(() => {
    if (coreSelection.mode !== "core_move") return [];
    return coreSelection.draftMoves
      .filter((m) => m.purpose === "core_move")
      .map((m) => {
        const fromId =
          m.from.kind === "reserve"
            ? "reserve"
            : m.from.kind === "card"
              ? m.from.instanceId
              : "";
        const toId =
          m.to.kind === "reserve"
            ? "reserve"
            : m.to.kind === "card"
              ? m.to.instanceId
              : "";
        return { from: fromId, to: toId, soul: m.kind === "soul" };
      });
  }, [coreSelection.mode, coreSelection.draftMoves]);
  const [soulCoreConfirm, setSoulCoreConfirm] = useState<string | null>(null); // ソウルコア確認待ちの移動元
  // ブレイヴ分離: コア移動UI
  // P3-46 sub-step 4: `coreDistribution` / `separationSoulCoreSource` を撤去し、
  // facade `coreSelection.draftMoves` (purpose === "separation") に集約。
  const [pendingSeparation, setPendingSeparation] = useState<{
    action: LegalAction;
    braveInstanceId: string;
    minCores: number;
  } | null>(null);
  // facade.draftMoves から separation 進捗を派生する。
  const separationDrafts = useMemo<readonly DraftCoreMove[]>(
    () => coreSelection.draftMoves.filter((d) => d.purpose === "separation"),
    [coreSelection.draftMoves]
  );
  const separationTotal = useMemo(() => {
    let total = 0;
    for (const d of separationDrafts) {
      total += d.kind === "normal" ? d.amount : 1;
    }
    return total;
  }, [separationDrafts]);
  /** ソウルコア確認ダイアログのコンテキスト: どのモードから呼ばれたか */
  const [soulCoreConfirmMode, setSoulCoreConfirmMode] = useState<
    | "core_move"
    | "cost_payment"
    | "placement"
    | "core_shoot"
    | "core_distribute"
  >("core_move");
  // ドラッグ&ドロップによるカードプレイ選択
  const [droppedCardChoice, setDroppedCardChoice] = useState<{
    instanceId: string;
    actions: LegalAction[];
  } | null>(null);
  const [fieldCardChoice, setFieldCardChoice] = useState<{
    instanceId: string;
    actions: LegalAction[];
  } | null>(null);
  // マジック使用のコストモード選択（タイミング決定後に paid/free 両方ある場合に開く）
  // P2-05 Phase 4a: paid / free に加え override (上書きコスト、XX01「相手は
  // マジックカードを1コストで使用できる」) の3モードに対応。2モード以上が
  // legal のときのみこのモーダルで分岐する。
  const [magicEffectChoice, setMagicEffectChoice] = useState<{
    actions: UseMagicLegalAction[];
    instanceId: string;
  } | null>(null);
  const [magicCostModeChoice, setMagicCostModeChoice] = useState<{
    paidAction?: UseMagicLegalAction;
    freeAction?: UseMagicLegalAction;
    overrideAction?: UseMagicLegalAction;
    zoneDiscountAction?: UseMagicLegalAction;
    /** 無料化 CE のソースカード名 (GUI 表示用、未取得なら undefined) */
    freeSourceCardName?: string;
    /** 上書きコスト CE のソースカード名 (GUI 表示用、未取得なら undefined) */
    overrideSourceCardName?: string;
  } | null>(null);
  // アクセル使用のコストモード選択（paid/free 両方が legal のときのみ開く。
  // magicCostModeChoice の簡略版。ENGINE-accel-tribe-cost-override, BSTH08.5-R12）
  const [accelCostModeChoice, setAccelCostModeChoice] = useState<{
    paidAction?: UseAccelLegalAction;
    freeAction?: UseAccelLegalAction;
    /** 無料化 CE のソースカード名 (GUI 表示用、未取得なら undefined) */
    freeSourceCardName?: string;
  } | null>(null);
  const [asIfSoulCoreChoice, setAsIfSoulCoreChoice] =
    useState<AsIfSoulCoreChoice | null>(null);
  // フィールド/手札起動効果が同一カードに複数ある場合の「どの効果を発揮するか」選択。
  // 「効果発揮」クリック → 効果選択 → (handleAction で) 宣言 → スタック窓、という 2 段フロー。
  const [fieldEffectChoice, setFieldEffectChoice] = useState<{
    actions: FieldCardEffectLegalAction[];
    instanceId: string;
  } | null>(null);
  // P3-127: attack/join_active_attack のコスト源 (破壊/重疲労させるカード) 候補が
  // 複数あるとき、どのカードを消費するか選ばせる候補選択モーダル。
  // 候補が1件のみのときはこのモーダルを経由せず即時発火する。
  const [quartzPlacementSource, setQuartzPlacementSource] = useState<
    string | null
  >(null);
  const [attackCostSourceChoice, setAttackCostSourceChoice] = useState<{
    actions: Extract<
      LegalAction,
      { kind: "attack" | "join_active_attack" | "block" }
    >[];
    field:
      | "battleDestroyCostSourceInstanceId"
      | "attackExhaustCostSourceInstanceId";
  } | null>(null);
  // choice ステップ選択モーダル
  const [pendingEffectChoice, setPendingEffectChoice] = useState<{
    choices: LegalAction[];
    sourceCardNo: string;
    sourceDefinitionId: string;
  } | null>(null);
  const [burstConfirmationActionId, setBurstConfirmationActionId] = useState<
    string | null
  >(null);
  const [fieldDragOver, setFieldDragOver] = useState(false);
  // 召喚/配置時のコア配置選択
  // 注意: P3-46 sub-step 2 で `reserveTaken` / `fieldTaken` を廃止。
  // 配置進捗は `coreSelection.draftMoves.filter(d => d.purpose === "placement")`
  // から派生 (placementTotal / placementReserveNormalTaken / placementFieldNormalTaken)。
  // sub-step 3 で `priorCostOverrides` / `priorSoulCoreSource` を撤去
  // (コスト支払いも `coreSelection` の `card_cost` draft に集約され、
  //  preview overrides は draft から派生する)。
  // Phase 4 で `paymentSources` を撤去 (`confirmPlacement` 内の
  // `recomposeSummonLegalAction` が cost+placement の双方を draft から構築する)。
  const [pendingPlacement, setPendingPlacement] = useState<{
    action: LegalAction;
    def: CardDefinition;
    finalCost: number;
    minCores: number;
    /** リザーブから配置可能な最大数 */
    maxReserveCores: number;
    /** フィールドカードからも配置可能（instanceId→利用可能コア数） */
    fieldSources: PlacementFieldSource[];
    hasSoulInReserve: boolean;
    /**
     * 配置先カードの instanceId。
     * - summon / place_nexus: action.sourceInstanceId
     * - resolve_pending_triggered_effect: 召喚対象 (cost 支払い段階で確定)
     */
    destinationInstanceId: string;
    /**
     * P3-48: コスト支払い stage から遷移してきた場合に元の `pendingCostPayment` を
     * snapshot として保持する。placement キャンセル時に cost stage へ戻すために使う
     * (cost = 0 経由で直接 placement に入った場合は null)。
     */
    priorCostPayment?: PendingCostPaymentState | null;
  } | null>(null);

  // 直接合体召喚の統合フロー: ブレイヴ召喚のコスト支払い後に「直接合体しますか？」を尋ね、
  // はい → 合体先選択 (支払い後に生存している host のみ) → 維持コア配置、
  // いいえ → スピリット状態召喚 (ブレイヴに Lv1 コア配置)。
  // phase: "choice" = はい/いいえモーダル表示中 / "host" = 合体先選択モード中。
  // facade.draftMoves から placement 進捗を派生する。
  const placementDrafts = useMemo<readonly DraftCoreMove[]>(
    () => coreSelection.draftMoves.filter((d) => d.purpose === "placement"),
    [coreSelection.draftMoves]
  );
  // maxReserveCores は通常コアの上限。ソウル配置で通常枠を消費しない。
  const placementReserveNormalTaken = useMemo(() => {
    let total = 0;
    for (const d of placementDrafts) {
      if (d.from.kind !== "reserve" || d.kind !== "normal") continue;
      total += d.amount;
    }
    return total;
  }, [placementDrafts]);
  // フィールドソースから取った「通常コアのみ」の数 (ソウルコアを除外)。
  // maxAmount は通常コア数なので、タップ可否はソウルとは独立に通常コア数だけで
  // 判定する。ソウルコアは soulCoreConfirm ダイアログが live state を基に別枠で
  // 処理するため、通常コアを全て取った上でさらにソウルコアも取れる
  // (例: 通常コア1 + ソウルコア1 を持つスピリットから「すべてのコア」を配置)。
  const placementFieldNormalTaken = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of placementDrafts) {
      if (d.from.kind !== "card" || d.kind !== "normal") continue;
      out[d.from.instanceId] = (out[d.from.instanceId] ?? 0) + d.amount;
    }
    return out;
  }, [placementDrafts]);
  const placementTotal = useMemo(() => {
    let total = 0;
    for (const d of placementDrafts) {
      total += d.kind === "normal" ? d.amount : 1;
    }
    return total;
  }, [placementDrafts]);
  // placement 中にユーザーがソウルコアを使うと kind: "soul" の draft が付与される。
  const summonUseSoul = useMemo(
    () => placementDrafts.some((d) => d.kind === "soul"),
    [placementDrafts]
  );
  // 通常召喚と同じ配置元SSOTを、候補表示・grabの両方で使う。
  const multiPlacementFieldSources = useMemo(() => {
    const pending = displayState.pendingMultiPlacement;
    if (!pending) return [];
    return buildPlacementFieldSources({
      state,
      actingPlayerId: pending.actingPlayerId,
      getDefinition,
      excludeInstanceIds: new Set(
        pending.excludedFieldSourceIds ??
          pending.targets.map((t) => t.instanceId)
      ),
    });
  }, [state, displayState.pendingMultiPlacement, getDefinition]);
  // P3-49 placement_multi: per-target 配置進捗 (target instanceId → 置いたコア数)
  const multiPlacementPerTargetTotal = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of placementDrafts) {
      if (d.to.kind !== "card") continue;
      const id = d.to.instanceId;
      out[id] = (out[id] ?? 0) + (d.kind === "normal" ? d.amount : 1);
    }
    return out;
  }, [placementDrafts]);
  const multiPlacementVoidNormalTotal = useMemo(() => {
    let total = 0;
    for (const d of placementDrafts) {
      if (d.kind !== "normal" || d.from.kind !== "void") continue;
      total += d.amount;
    }
    return total;
  }, [placementDrafts]);
  const multiPlacementTrashNormalTotal = useMemo(() => {
    let total = 0;
    for (const d of placementDrafts) {
      if (d.kind !== "normal" || d.from.kind !== "trash") continue;
      total += d.amount;
    }
    return total;
  }, [placementDrafts]);
  const multiPlacementTrashSoulTotal = useMemo(() => {
    let total = 0;
    for (const d of placementDrafts) {
      if (d.kind !== "soul" || d.from.kind !== "trash") continue;
      total += 1;
    }
    return total;
  }, [placementDrafts]);
  const multiPlacementVoidNormalByTarget = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of placementDrafts) {
      if (
        d.kind !== "normal" ||
        d.from.kind !== "void" ||
        d.to.kind !== "card"
      ) {
        continue;
      }
      out[d.to.instanceId] = (out[d.to.instanceId] ?? 0) + d.amount;
    }
    return out;
  }, [placementDrafts]);
  // ソウルコア確認で「いいえ」を選んだ場所（再度確認しない）
  const [declinedSoulLocations, setDeclinedSoulLocations] = useState<
    Set<string>
  >(new Set());
  // draft は preview に反映済み。未配置の held だけ追加で差し引く。
  const remainingNormalAt = useCallback(
    (locationId: string) => {
      const from = locationIdToNormalContainer(locationId, viewingPlayer);
      const id = coreContainerId(from);
      if (
        from.kind === "card" &&
        isNormalCoreMovePrevented(state, from.instanceId)
      )
        return 0;
      return Math.max(
        0,
        getNormalCoreCountAtLocation(
          coreSelection.previewState ?? state,
          from
        ) -
          coreSelection.heldCores.filter(
            (h) =>
              h.kind === "normal" &&
              h.from.kind !== "removed_from_game" &&
              coreContainerId(h.from) === id
          ).length
      );
    },
    [coreSelection.previewState, coreSelection.heldCores, state, viewingPlayer]
  );
  // 合法な通常コアが残らない移動元は、種類を確認せずソウルを取得する。
  const grabSoulOrConfirm = useCallback(
    (
      locationId: string,
      mode: "placement" | "core_move" | "core_distribute",
      normalAvailable = remainingNormalAt(locationId)
    ) => {
      if (normalAvailable > 0) {
        setSoulCoreConfirm(locationId);
        setSoulCoreConfirmMode(mode);
      } else {
        coreSelection.addHeldCore({
          kind: "soul",
          from: locationIdToSoulContainer(locationId, viewingPlayer),
          playerId: viewingPlayer,
        });
      }
    },
    [remainingNormalAt, coreSelection, viewingPlayer]
  );
  // コスト支払い元選択
  // P3-46 sub-step 3: `cardAmounts` を撤去し `coreSelection.draftMoves`
  // (purpose === "card_cost") に集約。tap 進捗 / soul 利用情報は draft から派生。
  const [pendingCostPayment, setPendingCostPayment] =
    useState<PendingCostPaymentState | null>(null);
  // 辞退はこの支払いだけに属する。マジック/アクセル/ミラージュ等の出口や
  // 次の入口ごとのreset漏れで、次回の初回タップを通常コアに固定しない。
  useLayoutEffect(() => {
    setSoulCoreConfirm(null);
    setDeclinedSoulLocations(new Set());
  }, [pendingCostPayment]);
  const [pendingMagicZoneCostSelection, setPendingMagicZoneCostSelection] =
    useState<{
      action: UseMagicLegalAction;
      def: CardDefinition;
    } | null>(null);

  /* ---------- card_cost draft 派生 (sub-step 3) ----------
   * cost payment stage の tap / soul 利用情報を `coreSelection.draftMoves` から派生する。
   * stage 1 (cost) で append された `purpose: "card_cost"` の draft は、
   * stage 2 (placement) に `transitionMode("placement")` で遷移しても保持され、
   * confirmPlacement 時の `recomposeSummonLegalAction` で payment portion が再構築される。
   */
  const costPaymentDrafts = useMemo<readonly DraftCoreMove[]>(
    () => coreSelection.draftMoves.filter((d) => d.purpose === "card_cost"),
    [coreSelection.draftMoves]
  );
  /** 既存 cardAmounts と同形 (key: "reserve" or instanceId, value: 通常コア数 + フィールドソウル分) */
  const costPaymentCardAmounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of costPaymentDrafts) {
      if (d.kind === "soul") {
        // フィールドカードのソウルは cardAmounts 内に 1 単位含める (旧仕様維持)。
        // リザーブのソウルは soulFromReserve フラグで別管理するため除外。
        if (d.from.kind === "card") {
          out[d.from.instanceId] = (out[d.from.instanceId] ?? 0) + 1;
        }
      } else {
        if (d.from.kind === "reserve") {
          out["reserve"] = (out["reserve"] ?? 0) + d.amount;
        } else if (d.from.kind === "card") {
          out[d.from.instanceId] = (out[d.from.instanceId] ?? 0) + d.amount;
        }
      }
    }
    return out;
  }, [costPaymentDrafts]);
  const costPayUseSoul = useMemo(
    () => costPaymentDrafts.some((d) => d.kind === "soul"),
    [costPaymentDrafts]
  );
  const costPaySoulSource = useMemo<string>(() => {
    const soul = costPaymentDrafts.find((d) => d.kind === "soul");
    if (!soul) return "reserve";
    if (soul.from.kind === "reserve") return "reserve";
    if (soul.from.kind === "card") return soul.from.instanceId;
    return "reserve";
  }, [costPaymentDrafts]);

  // コアシュート対象選択
  // P3-46 sub-step 5: `cardAmounts` / `soulCoreInstanceId` を撤去し、
  // facade `coreSelection.draftMoves` (purpose === "shoot") に集約。
  const [pendingCoreShoot, setPendingCoreShoot] = useState<{
    magicDef: CardDefinition;
    candidates: CoreShootCandidate[];
    totalAmount: number;
    /** P3-88: 「コアN個まで」最低取得数。省略時は totalAmount ちょうど。 */
    minTotal?: number;
    gameStatePendingId: string;
    sourceGroupMinimums?: import("@orica/rules-core").CoreSourceGroupMinimum[];
  } | null>(null);
  const coreShootDrafts = useMemo<readonly DraftCoreMove[]>(
    () => coreSelection.draftMoves.filter((d) => d.purpose === "shoot"),
    [coreSelection.draftMoves]
  );
  const coreShootPayload = useMemo(
    () => recomposeCoreShootLegalAction(coreShootDrafts),
    [coreShootDrafts]
  );
  const coreShootCardAmounts = coreShootPayload.coreShootDistribution;
  const coreShootSoulInstanceId = coreShootPayload.coreShootSoulCoreInstanceId;
  const coreShootTotal = useMemo(() => {
    let total = 0;
    for (const d of coreShootDrafts) {
      total += d.kind === "normal" ? d.amount : 1;
    }
    return total;
  }, [coreShootDrafts]);
  // P3-88: minTotal 指定時は minTotal〜totalAmount の under-selection（「コアN個まで」）。
  // 省略時は従来どおり totalAmount ちょうど。
  const coreShootValid =
    pendingCoreShoot !== null &&
    coreShootTotal >=
      (pendingCoreShoot.minTotal ?? pendingCoreShoot.totalAmount) &&
    coreShootTotal <= pendingCoreShoot.totalAmount &&
    satisfiesCoreSourceGroupMinimums(
      pendingCoreShoot.sourceGroupMinimums,
      coreShootCardAmounts,
      coreShootSoulInstanceId
    );

  const optionalRepeatCountDrafts = useMemo<readonly DraftCoreMove[]>(
    () =>
      coreSelection.draftMoves.filter((d) => d.purpose === "count_decrease"),
    [coreSelection.draftMoves]
  );
  const optionalRepeatCountDraftTotal = useMemo(() => {
    let total = 0;
    for (const d of optionalRepeatCountDrafts) {
      if (d.kind === "normal") total += d.amount;
      else total += 1;
    }
    return total;
  }, [optionalRepeatCountDrafts]);
  const optionalRepeatCountPending =
    displayState.pendingEffectOptionalRepeatCountSelection;
  const pendingCoreSplit = displayState.pendingCoreSplitSelection;
  const pendingLinkAidCostSourceChoice =
    displayState.pendingLinkAidCostSourceChoice;
  const pendingEffectSummonCostPayment =
    displayState.pendingEffectSummonCostPayment;
  const coreSplitDrafts = useMemo<readonly DraftCoreMove[]>(
    () => coreSelection.draftMoves.filter((d) => d.purpose === "core_split"),
    [coreSelection.draftMoves]
  );
  const coreSplitDestinationContainers = useMemo<
    readonly NormalCoreContainer[]
  >(
    () =>
      pendingCoreSplit
        ? pendingCoreSplit.destinations.map(
            (dest) =>
              effectCoreLocationToNormalContainer(
                dest.location,
                state,
                pendingCoreSplit.actingPlayerId,
                pendingCoreSplit.sourceInstanceId
              ) ?? { kind: "void", playerId: pendingCoreSplit.actingPlayerId }
          )
        : [],
    [pendingCoreSplit, state]
  );
  const coreSplitDistribution = useMemo(
    () =>
      recomposeCoreSplitLegalAction(
        coreSplitDrafts,
        coreSplitDestinationContainers
      ).coreSplitDistribution,
    [coreSplitDrafts, coreSplitDestinationContainers]
  );
  const coreSplitSelectedTotal = useMemo(
    () => coreSplitDistribution.reduce((sum, value) => sum + value, 0),
    [coreSplitDistribution]
  );
  const coreSplitValid =
    pendingCoreSplit !== null &&
    coreSplitSelectedTotal === pendingCoreSplit.totalAmount &&
    coreSplitDistribution.every((amount, index) => {
      const cap = pendingCoreSplit.destinations[index]?.cap;
      return amount >= 0 && (cap === undefined || amount <= cap);
    });
  useEffect(() => {
    if (optionalRepeatCountPending?.selectionMode === "count_decrease") {
      if (coreSelection.mode !== "count_decrease") {
        coreSelection.start("count_decrease");
      }
      return;
    }
    if (coreSelection.mode === "count_decrease") {
      coreSelection.end();
    }
  }, [
    optionalRepeatCountPending,
    optionalRepeatCountPending?.pendingId,
    coreSelection.mode,
    coreSelection,
  ]);

  useEffect(() => {
    if (pendingCoreSplit) {
      if (coreSelection.mode !== "core_split") {
        coreSelection.start("core_split");
      }
      return;
    }
    if (coreSelection.mode === "core_split") {
      coreSelection.end();
    }
  }, [pendingCoreSplit, pendingCoreSplit?.pendingId, coreSelection]);

  useEffect(() => {
    const pending = pendingEffectSummonCostPayment;
    if (!pending) {
      if (
        pendingCostPayment?.action.kind ===
        "resolve_pending_effect_summon_cost_payment"
      ) {
        setPendingCostPayment(null);
        if (coreSelection.mode === "card_cost") coreSelection.end();
        setDeclinedSoulLocations(new Set());
      }
      return;
    }

    if (
      pendingCostPayment?.action.kind ===
        "resolve_pending_effect_summon_cost_payment" &&
      "pendingId" in pendingCostPayment.action &&
      pendingCostPayment.action.pendingId === pending.pendingId
    ) {
      return;
    }

    const action = actions.find(
      (
        a
      ): a is Extract<
        LegalAction,
        { kind: "resolve_pending_effect_summon_cost_payment" }
      > =>
        a.kind === "resolve_pending_effect_summon_cost_payment" &&
        a.pendingId === pending.pendingId
    );
    const def =
      getDefinition(pending.summonTargetDefinitionId) ??
      getDefinition(pending.sourceDefinitionId);
    if (!action || !def) return;

    const fieldSources: CostPaymentFieldSource[] = [
      ...pending.availableOnBoardCoreSources.map((source) => ({
        instanceId: source.instanceId,
        definitionId: source.definitionId,
        maxAmount: source.availableCoreAmount,
        soulCoreOnly: false,
        ...(source.destination ? { destination: source.destination } : {}),
      })),
      ...pending.availableSoulCoreOnlySources.map((source) => ({
        instanceId: source.instanceId,
        definitionId: source.definitionId,
        maxAmount: source.availableSoulCoreAmount,
        soulCoreOnly: true,
      })),
    ];

    coreSelection.start("card_cost");
    setDeclinedSoulLocations(new Set());
    setPendingCostPayment({
      action,
      def,
      finalCost: pending.requiredCost,
      reserveAvailable: pending.availableReserveCoreAmount,
      reserveNormal: pending.availableReserveNormalCoreAmount,
      fieldSources,
      minCoresForPlacement: 0,
      mode: "summon_in_trigger",
      summonTargetInstanceId: pending.summonTargetInstanceId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId または棋譜盤面の切替時に再初期化
  }, [pendingEffectSummonCostPayment?.pendingId, replayState]);

  // トラッシュ→フィールド コア配分 (BSTH01-M01 等)
  // 既存のコア配置 UI と同じ「フィールドカードを直接タップ」操作で割り当てる。
  // P3-46 sub-step 6: `trashDistAllocations` / soul allocation を
  // facade `coreSelection.draftMoves` (purpose === "trash_distribution") に集約。
  // `trashDistSoulMode` (UI のソウル選択モード) のみ残す。
  const [trashDistSoulMode, setTrashDistSoulMode] = useState<boolean>(false);
  const trashDistDrafts = useMemo<readonly DraftCoreMove[]>(
    () =>
      coreSelection.draftMoves.filter(
        (d) => d.purpose === "trash_distribution"
      ),
    [coreSelection.draftMoves]
  );
  /** 旧 `trashDistAllocations` と同形 (key: 配分先 instanceId, value: 通常コア配分量) */
  const trashDistAllocations = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of trashDistDrafts) {
      if (d.kind !== "normal" || d.to.kind !== "card") continue;
      out[d.to.instanceId] = (out[d.to.instanceId] ?? 0) + d.amount;
    }
    return out;
  }, [trashDistDrafts]);
  /** ソウル配置量 (key: 配分先 instanceId, value: ソウルコア配分量) */
  const trashDistSoulAllocations = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of trashDistDrafts) {
      if (d.kind !== "soul" || d.to.kind !== "card") continue;
      out[d.to.instanceId] = (out[d.to.instanceId] ?? 0) + 1;
    }
    return out;
  }, [trashDistDrafts]);
  const trashDistSoulTotal = useMemo(
    () => Object.values(trashDistSoulAllocations).reduce((s, n) => s + n, 0),
    [trashDistSoulAllocations]
  );
  const trashDistTotal = useMemo(
    () => Object.values(trashDistAllocations).reduce((s, n) => s + n, 0),
    [trashDistAllocations]
  );
  // pendingId が変わるたびに状態をリセット (新 pending 発生 → start, 解消 → end)
  useEffect(() => {
    // displayState (解決者でない pending は null 化済み) で判定。相手の pending では
    // 起動しないので、相手が勝手にコア配分モードに入る連動バグを防げる。
    if (displayState.pendingCoreDistribution) {
      const dist = displayState.pendingCoreDistribution;
      coreSelection.start(
        "trash_distribution",
        dist.rebirthCompletion?.deferredAction?.separatesFromHost
          ? dist.candidates.map((candidate) => ({
              kind: "card" as const,
              instanceId: candidate.instanceId,
            }))
          : []
      );
    } else {
      // 解消時: trash_distribution mode のみクリア (他モードは残す)
      if (coreSelection.mode === "trash_distribution") {
        coreSelection.end();
      }
    }
    setTrashDistSoulMode(false);
    setMultiSourceActiveKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId または棋譜盤面の切替時に再初期化
  }, [displayState.pendingCoreDistribution?.pendingId, replayState]);

  // P3-49 placement_multi: pendingMultiPlacement が立つたびに facade を placement モードで起動。
  // Phase 1 で held buffer に grab、Phase 2 で per-target に place する。
  useEffect(() => {
    if (displayState.pendingMultiPlacement) {
      coreSelection.start(
        "placement",
        displayState.pendingMultiPlacement.targets.map((t) => ({
          kind: "card",
          instanceId: t.instanceId,
        }))
      );
    } else {
      // 解消時: placement mode かつ pendingPlacement (single-summon) も無いなら end
      if (coreSelection.mode === "placement" && pendingPlacement === null) {
        coreSelection.end();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId または棋譜盤面の切替時に再初期化
  }, [displayState.pendingMultiPlacement?.pendingId, replayState]);

  useEffect(() => {
    const pending = displayState.pendingEnterFieldPlacement;
    if (!pending) {
      if (
        pendingPlacement?.action.kind ===
        "resolve_pending_enter_field_placement"
      ) {
        setPendingPlacement(null);
        if (coreSelection.mode === "placement") coreSelection.end();
        setDeclinedSoulLocations(new Set());
      }
      return;
    }

    if (
      pendingPlacement?.action.kind ===
        "resolve_pending_enter_field_placement" &&
      "pendingId" in pendingPlacement.action &&
      pendingPlacement.action.pendingId === pending.pendingId
    ) {
      return;
    }

    const action = actions.find(
      (a) =>
        a.kind === "resolve_pending_enter_field_placement" &&
        a.pendingId === pending.pendingId
    );
    const def = getDefinition(pending.sourceDefinitionId);
    const player = state.players.find((p) => p.id === pending.actingPlayerId);
    if (!action || !def || !player) return;

    const fieldSourcesForPlacement = buildPlacementFieldSources({
      state,
      actingPlayerId: pending.actingPlayerId,
      getDefinition,
    });

    coreSelection.start("placement");
    setDeclinedSoulLocations(new Set());
    setPendingPlacement({
      action,
      def,
      finalCost: 0,
      minCores: pending.minimumCoreCount,
      maxReserveCores: player.reserveNormalCoreCount,
      fieldSources: fieldSourcesForPlacement,
      hasSoulInReserve: player.soulCoreLocation?.kind === "reserve",
      destinationInstanceId: pending.sourceInstanceId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId または棋譜盤面の切替時に再初期化
  }, [displayState.pendingEnterFieldPlacement?.pendingId, replayState]);

  useEffect(() => {
    const pending = displayState.pendingReverseRebirthSummon;
    if (!pending) {
      if (pendingPlacement?.action.kind === "resolve_reverse_rebirth_summon") {
        setPendingPlacement(null);
        if (coreSelection.mode === "placement") coreSelection.end();
        setDeclinedSoulLocations(new Set());
      }
      if (
        pendingCostPayment?.action.kind === "resolve_reverse_rebirth_summon"
      ) {
        setPendingCostPayment(null);
        if (coreSelection.mode === "card_cost") coreSelection.end();
        setDeclinedSoulLocations(new Set());
      }
      return;
    }

    if (
      (pendingPlacement?.action.kind === "resolve_reverse_rebirth_summon" &&
        "pendingId" in pendingPlacement.action &&
        pendingPlacement.action.pendingId === pending.pendingId) ||
      (pendingCostPayment?.action.kind === "resolve_reverse_rebirth_summon" &&
        "pendingId" in pendingCostPayment.action &&
        pendingCostPayment.action.pendingId === pending.pendingId)
    ) {
      return;
    }

    const action = actions.find(
      (
        a
      ): a is Extract<
        LegalAction,
        { kind: "resolve_reverse_rebirth_summon" }
      > =>
        a.kind === "resolve_reverse_rebirth_summon" &&
        a.pendingId === pending.pendingId
    );
    const def = getDefinition(pending.frontDefinitionId);
    const player = state.players.find((p) => p.id === pending.actingPlayerId);
    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === pending.sourceInstanceId && c.zone === "field"
    );
    if (!action || !def || !player || !sourceCard) return;

    const soulOnCard = (instanceId: string) =>
      player.soulCoreLocation?.kind === "card" &&
      player.soulCoreLocation.instanceId === instanceId;
    const returnedNormalCores = sourceCard.normalCoreCount;
    const sourceHasSoulCore = soulOnCard(pending.sourceInstanceId);
    const reserveNormalAfterReturn =
      player.reserveNormalCoreCount + returnedNormalCores;
    const reserveAvailableAfterReturn =
      getPlayerReserveCoreCount(player) +
      returnedNormalCores +
      (sourceHasSoulCore ? 1 : 0);
    const fieldSourcesForPayment: CostPaymentFieldSource[] = state.cardInstances
      .filter(
        (c) =>
          c.controllerPlayerId === pending.actingPlayerId &&
          c.zone === "field" &&
          c.instanceId !== pending.sourceInstanceId &&
          c.pendingLeaveKind === null &&
          getTotalCoresOnCardById(state, c.instanceId) > 0 &&
          canMoveCoresFrom(state, c, getDefinition(c.definitionId))
      )
      .map((c) => ({
        instanceId: c.instanceId,
        definitionId: c.definitionId,
        maxAmount: getTotalCoresOnCardById(state, c.instanceId),
        soulCoreOnly: false,
      }));

    if (pending.costToPay > 0) {
      const totalAvailable =
        reserveAvailableAfterReturn +
        fieldSourcesForPayment.reduce(
          (sum, source) => sum + source.maxAmount,
          0
        );
      if (totalAvailable < pending.costToPay + pending.minimumCoreCount) {
        showMessage(
          `コア不足: 必要 ${pending.costToPay + pending.minimumCoreCount}, 利用可能 ${totalAvailable}`
        );
        return;
      }
      coreSelection.start("card_cost");
      setDeclinedSoulLocations(new Set());
      setPendingCostPayment({
        action,
        def,
        finalCost: pending.costToPay,
        reserveAvailable: reserveAvailableAfterReturn,
        reserveNormal: reserveNormalAfterReturn,
        fieldSources: fieldSourcesForPayment,
        minCoresForPlacement: pending.minimumCoreCount,
        mode: "summon_in_trigger",
        summonTargetInstanceId: pending.sourceInstanceId,
      });
      return;
    }

    const fieldSourcesForPlacement = buildPlacementFieldSources({
      state,
      actingPlayerId: pending.actingPlayerId,
      getDefinition,
      excludeInstanceIds: new Set([pending.sourceInstanceId]),
    });

    coreSelection.start("placement");
    setDeclinedSoulLocations(new Set());
    setPendingPlacement({
      action,
      def,
      finalCost: 0,
      minCores: pending.minimumCoreCount,
      maxReserveCores: reserveNormalAfterReturn,
      fieldSources: fieldSourcesForPlacement,
      hasSoulInReserve:
        player.soulCoreLocation?.kind === "reserve" || sourceHasSoulCore,
      destinationInstanceId: pending.sourceInstanceId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId または棋譜盤面の切替時に再初期化
  }, [displayState.pendingReverseRebirthSummon?.pendingId, replayState]);

  // コスト支払い派生値（draft から直接合算: normal は amount, soul は 1 単位）
  const costPaymentTappedTotal = useMemo(() => {
    let total = 0;
    for (const d of costPaymentDrafts) {
      total += d.kind === "normal" ? d.amount : 1;
    }
    return total;
  }, [costPaymentDrafts]);
  const _costPaymentRemaining = pendingCostPayment
    ? pendingCostPayment.finalCost - costPaymentTappedTotal
    : 0;
  const costPaymentValid =
    pendingCostPayment !== null &&
    costPaymentTappedTotal >= pendingCostPayment.finalCost;

  // 相手ターン自動進行の判定に使う: これらのみなら「意味のある選択肢なし」と判定
  // P3-55 Phase B: 旧 start_battle_resolution は廃止。defender 側の decline_block は
  // 防御側の意思表示なので「意味のある選択肢」として扱う (auto-pass しない)。
  const AUTO_PASS_KINDS = new Set([
    "pass_battle_flash",
    "pass_pre_declaration_stack",
    "pass_stack",
    "resolve_pending_triggered_effect",
    "resolve_pending_burst_check",
  ]);

  // 自分の合法手を先に計算（相手の自動実行判定にも使う）
  const myActions = useMemo(
    () =>
      state.gameResult
        ? []
        : (roomId && state.viewerLegalActions
            ? state.viewerLegalActions.actingPlayerId === viewingPlayer
              ? [...state.viewerLegalActions.actions]
              : []
            : getLegalActions({
                state,
                actingPlayerId: viewingPlayer,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              })
          ).filter((a) => !isUnsupportedPaidPreventionImmunityCardVariant(a)),
    [state, viewingPlayer, getDefinition, effectLookups, roomId]
  );
  const optionalRepeatCountAction = useMemo(
    () =>
      myActions.find(
        (a) => a.kind === "resolve_pending_effect_optional_repeat_count"
      ),
    [myActions]
  );
  const coreSplitAction = useMemo(
    () => myActions.find((a) => a.kind === "resolve_pending_core_split"),
    [myActions]
  );
  // こちらにブロック/フラッシュ使用など意味のある選択肢があるか
  const playerHasMeaningfulActions = useMemo(
    () => myActions.some((a) => !AUTO_PASS_KINDS.has(a.kind)),
    [myActions] // eslint-disable-line react-hooks/exhaustive-deps -- AUTO_PASS_KINDS is module constant
  );

  const simpleAiProgress = useRef(createSimpleAiProgress());
  // 相手の手番を PlayerController に委譲
  // 対人モード（roomId あり）では相手の自動処理を完全にスキップ（polling で state を受け取る）
  useEffect(() => {
    if (roomId) return; // 対人モード: 相手の操作は相手のタブで行われる
    if (readOnly) return;
    if (state.preGame) return;
    if (state.gameResult) return;
    if (playerHasMeaningfulActions) return; // こちらの行動が先

    const isOpponentTurn = state.activePlayerId !== viewingPlayer;
    const opponentId = state.players.find((p) => p.id !== viewingPlayer)?.id;
    if (!opponentId) return;

    const opponentActions = getLegalActions({
      state,
      actingPlayerId: opponentId,
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    }).filter((a) => !isUnsupportedPaidPreventionImmunityCardVariant(a));

    // 相手ターンはディレイを入れてステップアニメーションを見せる
    const delay = isOpponentTurn ? 400 : 0;

    if (
      opponentActions.length > 0 ||
      (isOpponentTurn && myActions.length === 0)
    ) {
      const timer = setTimeout(() => {
        try {
          const next = advanceSimpleAi({
            state,
            actions: opponentActions,
            playerId: opponentId,
            canAdvance: isOpponentTurn && myActions.length === 0,
            engine: { getCardDefinitionById: getDefinition, ...effectLookups },
            progress: simpleAiProgress.current,
            controller: opponentController,
          });
          if (next) setStateAndSync(next.state, next.action, next.inputs);
        } catch (error) {
          console.error("[simple-ai]", error);
          setMessage(
            "簡易AIの処理に失敗しました。スナップショットを保存して状況をご報告ください。"
          );
        }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [
    state,
    viewingPlayer,
    getDefinition,
    opponentController,
    playerHasMeaningfulActions,
    myActions,
    roomId,
    readOnly,
    effectLookups,
    setStateAndSync,
  ]);

  // 自分側の自動実行
  useEffect(() => {
    if (state.gameResult) return;
    // room: dispatch/reconcile 進行中は楽観 (optimistic) state 上で auto-exec しない。
    // 楽観 state はローカル engine が sanitize 済みカード (相手の伏せカード=_hidden_card_)
    // で算出したもので、サーバの実カード engine と pending (誘発効果/バーストチェック) が
    // 乖離しうる。reconcile 前にこの state を元に auto-exec すると、サーバに存在しない
    // アクション (例: 相手の伏せカード誘発でゲートされる「バースト空解決」) を投機 dispatch
    // してしまい「操作の同期に失敗しました」になる。権威 state へ収束してから再評価する。
    if (dispatchPending) return;
    if (myActions.length === 0) return;

    // 発揮不能のdrain・画像のない順序選択は先行整理する。
    // 保存済み状態でも、ボタンを隠したままキューを滞留させない。
    const queueItems = buildEffectQueue(
      state,
      getDefinition,
      effectLookups.getRegisteredTriggeredEffectActions,
      viewingPlayer,
      myActions
    );
    const isEmptyTriggeredFallback = (a: LegalAction) =>
      isAutomaticEffectQueueDrain(a, queueItems);

    const emptyFallbacks = myActions.filter(isEmptyTriggeredFallback);
    if (
      emptyFallbacks.length > 0 &&
      myActions.some((a) => !isEmptyTriggeredFallback(a))
    ) {
      const fallback = emptyFallbacks[0]!;
      try {
        const result = applyLegalAction({
          state,
          action: fallback,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, fallback);
      } catch {
        /* ignore */
      }
      return;
    }

    // 選択の余地がないアクション → 常に自動実行
    // P3-55 Phase B: defender が他にブロック候補を持たないとき (myActions が
    // [decline_block] のみ) は自動でバトル解決を進める。block 候補がある場合は
    // myActions に block も含まれるので auto-exec は発火しない。
    // P3-71: resolve_pending_burst_check はここに含めない。発動可能なバースト
    //   (source-backed) は発動/不発をプレイヤーに選ばせる必要があるため、
    //   isAutoExec 内で「source の無い空解決のみ自動実行」と個別判定する。
    const autoExecKinds = new Set(["decline_block", "open_battle_flash"]);

    // resolve_pending_triggered_effect は mandatory のみ自動実行（optional はプレイヤー選択）
    // choice 付き（choiceIndex !== undefined）は選択が必要なので自動実行しない
    // P3-34 B: 効果内 summon (target:"self") を含む場合は player input (paymentSources / placement)
    // が必要なので、たとえ mandatory でも自動実行しない。
    const isAutoExec = (a: LegalAction) => {
      if ("canSkipDuplicate" in a && a.canSkipDuplicate) return false;
      if (isEmptyTriggeredFallback(a)) return true;
      if (
        "choiceIndex" in a &&
        (a as { choiceIndex?: number }).choiceIndex !== undefined
      )
        return false;
      if (autoExecKinds.has(a.kind)) return true;
      // P3-71: 発動可能なバースト (source-backed) はプレイヤーに発動/不発を
      //   選ばせる。発動できるバーストが無い空解決 (sourceInstanceId 無し) のみ
      //   自動実行する。
      if (a.kind === "resolve_pending_burst_check") {
        return (
          (a as { sourceInstanceId?: string }).sourceInstanceId === undefined
        );
      }
      // 「発動しない」は明示的な意思表示。自動実行しない。
      if (a.kind === "decline_pending_burst_check") return false;
      // P3-53: resolve_battle_immediate_effect は target 不要 + mandatory のみ自動実行。
      // requiredTargetCount > 0 や optional では EffectQueueOverlay 上で user に明示的に問う。
      if (a.kind === "resolve_battle_immediate_effect") {
        const required = (a as { requiredTargetCount?: number })
          .requiredTargetCount;
        if (required !== undefined && required > 0) return false;
        const max = (a as { maxTargetCount?: number }).maxTargetCount;
        if (max !== undefined && max > 0) return false;
        const requiredPayCostAmount = (a as { requiredPayCostAmount?: number })
          .requiredPayCostAmount;
        if (requiredPayCostAmount !== undefined && requiredPayCostAmount > 0)
          return false;
        if (
          "executionMode" in a &&
          (a as { executionMode?: string }).executionMode === "optional"
        ) {
          return false;
        }
        return true;
      }
      if (a.kind === "resolve_pending_triggered_effect") {
        if (
          "executionMode" in a &&
          (a as { executionMode?: string }).executionMode === "optional"
        ) {
          return false;
        }
        // ENGINE-step-optional-zero-to-n-target-selection: count {min:0,max:N}
        // (require=0/max>0 可変選択) は target ピッカーが要るため自動実行しない。
        const required = (a as { requiredTargetCount?: number })
          .requiredTargetCount;
        const max = (a as { maxTargetCount?: number }).maxTargetCount;
        if (required !== undefined && required > 0) return false;
        if (max !== undefined && max > 0) return false;
        // P3-34 B: 効果内に self-summon が含まれる場合 interactive 化必須 → 自動実行しない
        const srcId = (a as { sourceInstanceId?: string }).sourceInstanceId;
        const srcCard = srcId
          ? state.cardInstances.find((c) => c.instanceId === srcId)
          : undefined;
        const srcDef = srcCard
          ? getDefinition(srcCard.definitionId)
          : undefined;
        if (srcDef?.effects) {
          for (const eff of srcDef.effects) {
            if (eff.timing.kind === "activated") continue;
            for (const step of eff.steps) {
              if (
                step.action.kind === "summon" &&
                step.action.target.kind === "self"
              ) {
                return false;
              }
            }
          }
        }
        return true;
      }
      return false;
    };

    // P3-35 Phase 2-C: スタック窓 / フラッシュ窓の pass 系は responder に常時手動クリックさせる。
    // 自動 pass すると PvP で responder の応答時間が即時化 → 「能動スタック手段が無かった」ことが
    // timing tell でバレる。pass_stack / pass_pre_declaration_stack / pass_battle_flash は
    // 必ず下部 pass ボタン経由でユーザーに発火させる。
    //
    // 現在進められる項目が1件なら自動実行する。後続の通常誘発など、今は合法手を
    // 持たない項目は順序選択に数えない。進められる項目が複数なら手動で順序を選ぶ。
    if (myActions.every(isAutoExec)) {
      const action = myActions[0];
      if (action) {
        const actionIsClaimedByQueue = queueItems.some((item) =>
          (item.actions ?? []).includes(action)
        );
        const actionableQueueItems = queueItems.filter(
          (item) => (item.actions?.length ?? 0) > 0
        );
        if (actionIsClaimedByQueue && actionableQueueItems.length > 1) return;
        try {
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
          });

          setStateAndSync(result.state, action);
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectLookups/setStateAndSync are stable refs
  }, [state, viewingPlayer, getDefinition, myActions, dispatchPending]);

  // 終了時効果をすべて解決したら、中断していたステップ進行を再開する (10_rules/02:19)。
  useEffect(() => {
    if (state.gameResult) return;
    // room: reconcile 進行中は楽観 state 上で step を投機 dispatch しない (上記 auto-exec と同様)。
    if (dispatchPending) return;
    const isStepEnd = state.window === "step_end";
    const isEndStepEffects =
      state.step === "end" &&
      (state.window === "end_step_effects" ||
        state.window === "end_step_end_effects");
    if (!isStepEnd && !isEndStepEffects) return;
    if (state.activePlayerId !== viewingPlayer) return;
    if (getGameProgressBlockerReason(state) !== null) return;
    if (isStepEnd) {
      // 終了時限定マジックの使用機会は advanceStep と同じ正源で判定する。
      // main の通常召喚等は終了宣言済みの進行を止める理由にはしない。
      if (
        hasEligibleMainStepEndMagicActivation({
          state,
          actingPlayerId: viewingPlayer,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        })
      )
        return;
    } else if (myActions.length > 0) return;
    try {
      setStateAndSync(
        advanceStep(
          state,
          getDefinition,
          effectLookups.getRegisteredTriggeredEffectActions,
          effectLookups.getRegisteredBurstActions,
          effectLookups.getRegisteredMagicActions
        ),
        "step"
      );
    } catch {
      /* ignore */
    }
  }, [
    state,
    viewingPlayer,
    myActions,
    getDefinition,
    effectLookups,
    setStateAndSync,
    dispatchPending,
  ]);

  // GameState の pendingCoreShootSelection が発生したら自動的にコアシュートモードに入る。
  // displayState (解決者でない pending は null 化済み) で判定するため、相手の pending では
  // 起動しない (相手が勝手にコアシュートモードに入る連動バグを防ぐ)。
  useEffect(() => {
    const gsPending = displayState.pendingCoreShootSelection;
    if (gsPending?.ownerCoreChoice) {
      // 内訳選択は共通HUDが担当し、そこで開始済みの選択は消さない。
      if (pendingCoreShoot) setPendingCoreShoot(null);
      return;
    }
    if (!gsPending) {
      // pending が無い / 自分宛でないならローカルの gameStatePendingId 付きステートをクリア
      if (pendingCoreShoot?.gameStatePendingId) {
        setPendingCoreShoot(null);
        coreSelection.end();
        setDeclinedSoulLocations(new Set());
      }
      return;
    }
    // 既にこの pending に対応するローカルステートがあればスキップ
    if (pendingCoreShoot?.gameStatePendingId === gsPending.pendingId) return;

    const srcCard = state.cardInstances.find(
      (c) => c.instanceId === gsPending.sourceInstanceId
    );
    const srcDef = srcCard ? getDefinition(srcCard.definitionId) : undefined;
    coreSelection.start("shoot");
    setPendingCoreShoot({
      magicDef:
        srcDef ??
        ({
          definitionId: gsPending.sourceDefinitionId,
          name: "効果",
        } as unknown as CardDefinition),
      candidates: gsPending.candidates,
      ...(gsPending.sourceGroupMinimums
        ? { sourceGroupMinimums: gsPending.sourceGroupMinimums }
        : {}),
      totalAmount: gsPending.totalAmount,
      ...(gsPending.minTotal !== undefined
        ? { minTotal: gsPending.minTotal }
        : {}),
      gameStatePendingId: gsPending.pendingId,
    });
    setDeclinedSoulLocations(new Set());
  }, [
    displayState.pendingCoreShootSelection,
    pendingCoreShoot,
    state.cardInstances,
    getDefinition,
    coreSelection,
  ]);

  const actions = myActions;
  const burstConfirmation = useMemo(() => {
    const action = actions.find(
      (a) => a.actionId === burstConfirmationActionId
    );
    if (action?.kind !== "resolve_pending_burst_check") return null;
    const warning = previewBurstEffectSuppression({
      state,
      action,
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    });
    return warning ? { action, warning } : null;
  }, [actions, burstConfirmationActionId, state, getDefinition, effectLookups]);
  useEffect(() => {
    if (!burstConfirmation) setBurstConfirmationActionId(null);
  }, [burstConfirmation]);

  const changeCleanupChoice = useMemo(() => {
    const pending = displayState.pendingChangeCleanupChoice;
    if (!pending) return null;
    const choiceActions = actions.filter(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_change_cleanup_choice" }
      > =>
        action.kind === "resolve_pending_change_cleanup_choice" &&
        action.pendingId === pending.pendingId
    );
    return {
      pending,
      actions: choiceActions,
      trashAction:
        choiceActions.find((action) => action.outcome === "trash") ?? null,
    };
  }, [actions, displayState.pendingChangeCleanupChoice]);
  const braveCombineChoicePending =
    displayState.pendingBraveCombineChoice ??
    displayState.pendingStoneFlipCombine;
  const isBraveCombineChoiceHostSelection =
    pendingAction?.kind === "resolve_brave_combine_choice" &&
    braveCombineChoicePending?.pendingId === pendingAction.pendingId;
  // 支払い前使用の carrier は元マジックの再選択・支払いまで残る。
  // carrier の有無ではなく、実際に選択を求める legal action でモーダル待ちを判定する。
  const hasFieldMagicPreCostChoice =
    displayState.pendingFieldMagicPreCostTrigger !== null &&
    actions.some(
      (action) => action.kind === "resolve_field_magic_pre_cost_trigger"
    );

  // UI 選択中フラグ: 選択中は手札/フィールドのカード操作を無効化
  // モーダル系 pending (deck reveal / zone selection / core split) も含める。
  // 通常はモーダルが画面を覆ってカード操作を物理的にブロックするが、
  // 「盤面確認」で一時非表示にした際もカード操作を流入させないため明示する。
  // 共有 pending は displayState (解決者でない pending を null 化済み) 経由で読むことで、
  // 相手の対象選択中に自分の UI が反応しない (個別 gate 不要)。
  const hasUiPending =
    burstConfirmation !== null ||
    pendingCostPayment !== null ||
    pendingPlacement !== null ||
    pendingCoreShoot !== null ||
    pendingSeparation !== null ||
    pendingAction !== null ||
    quartzPlacementSource !== null ||
    pendingEffectChoice !== null ||
    pendingMagicZoneCostSelection !== null ||
    changeCleanupChoice !== null ||
    magicEffectChoice !== null ||
    magicCostModeChoice !== null ||
    accelCostModeChoice !== null ||
    asIfSoulCoreChoice !== null ||
    fieldEffectChoice !== null ||
    attackCostSourceChoice !== null ||
    displayState.pendingBraveLeaveChoice !== null ||
    displayState.pendingBraveAttackContinuation !== null ||
    displayState.pendingSoulStateReplacement !== null ||
    displayState.pendingAdventSourceReplacement !== null ||
    displayState.pendingSetAsideExitReplacementChoice !== null ||
    displayState.pendingDeckReveal !== null ||
    displayState.pendingZoneSelection !== null ||
    displayState.pendingStepOptionalChoice !== null ||
    displayState.pendingStepChoice !== null ||
    displayState.pendingDeckRevealCountBoostChoice !== null ||
    displayState.pendingStepOptionalTargetSelection !== null ||
    displayState.pendingDrawStepCostChoice !== null ||
    displayState.pendingSummonCostExcludeChoice !== null ||
    displayState.pendingSummonCostCoreMoveChoice !== null ||
    displayState.pendingGroupedSummonCostOverrideChoice !== null ||
    displayState.pendingLifeDamageDiscardChoice !== null ||
    displayState.pendingLifeGainReplacementChoice !== null ||
    displayState.pendingCoreShootSelection !== null ||
    displayState.pendingAsIfSoulCoreChoice !== null ||
    displayState.pendingBorrowedEffectChoice !== null ||
    displayState.pendingBorrowedEffectTargetSelection !== null ||
    displayState.pendingPayToActCoreGate !== null ||
    hasFieldMagicPreCostChoice ||
    displayState.pendingCoreSplitSelection !== null ||
    displayState.pendingBraveCombineChoice !== null ||
    displayState.pendingStoneFlipCombine !== null ||
    displayState.pendingHandTrashSwapChoice !== null ||
    displayState.pendingFieldHandSwapChoice !== null ||
    displayState.pendingTenshoSummon !== null ||
    displayState.pendingReverseRebirthSummon !== null ||
    displayState.pendingSplitSummonChoice !== null ||
    displayState.pendingCoreCountSelection !== null ||
    displayState.pendingCountSelection !== null ||
    displayState.pendingDiscardSetBurstCountSelection !== null ||
    displayState.pendingLifeCoreSelection !== null ||
    displayState.pendingCoreSourceAllocation !== null ||
    displayState.pendingLinkAidCostSourceChoice !== null ||
    displayState.pendingEffectSummonCostPayment !== null ||
    displayState.pendingCoreDistribution !== null ||
    displayState.pendingChangeCleanupChoice !== null ||
    displayState.pendingEffectTargetSelection !== null ||
    displayState.pendingEffectOptionalRepeatChoice !== null ||
    displayState.pendingEffectOptionalRepeatCountSelection !== null ||
    displayState.pendingPayToActHandDiscardGate !== null ||
    displayState.pendingEnterFieldPlacement !== null ||
    displayState.pendingMultiPlacement !== null ||
    displayState.pendingTargetRedirects.length > 0 ||
    displayState.pendingConnectBattleDecision !== null;

  const cardSelection = usePendingCardSelection(
    displayState,
    pendingCostPayment || pendingPlacement ? [] : actions,
    getDefinition,
    viewingPlayer,
    attackCostSourceChoice?.actions
  );
  const revealedTargetIds = useMemo(
    () => revealedTargetCardIds(displayState, pendingAction),
    [displayState, pendingAction]
  );
  const publicRevealedIds = visibleRevealedCardIds(displayState);
  const confirmedRevealedIds = confirmedRevealedTargetIds(displayState);
  const pendingHasRevealedCandidates =
    pendingAction !== null &&
    "candidateTargetInstanceIds" in pendingAction &&
    pendingAction.candidateTargetInstanceIds.some((id) =>
      publicRevealedIds.includes(id)
    );
  const [revealBrowseOpen, setRevealBrowseOpen] = useState(false);
  const publicRevealKey = publicRevealedIds.join("|");
  useEffect(() => setRevealBrowseOpen(false), [publicRevealKey]);

  // 効果解決キュー (EffectQueueOverlay) の表示状態。
  // 親で持つことで、対象選択 / コスト支払い等に入った時点でキューを隠し、
  // pending 解決に集中できるようにする。
  // ゾーン選択（手札）のインライン化: 自分の手札から選ぶ pendingZoneSelection だけ
  // HandArea でトグル操作する。相手の手札を内容確認して選ぶ効果は ZoneSelectionModal
  // のブラウズ表示を維持する。
  const inlineHandSelection = useMemo(() => {
    // displayState は解決者でない pending を null 化済みなので actingPlayer 判定は不要。
    const pzs = displayState.pendingZoneSelection;
    if (!pzs) return null;
    if (pzs.sourceZone !== "hand") return null;
    const zsAction = actions.find(
      (a) => a.kind === "resolve_pending_zone_selection"
    );
    if (!zsAction || zsAction.kind !== "resolve_pending_zone_selection")
      return null;

    const candidateIds = new Set<string>(zsAction.candidateCardInstanceIds);
    for (const alt of zsAction.alternateSelections ?? []) {
      for (const id of alt.candidateInstanceIds) candidateIds.add(id);
    }
    if (candidateIds.size === 0) return null;

    for (const id of candidateIds) {
      const card = state.cardInstances.find((c) => c.instanceId === id);
      if (
        !card ||
        !isInHandForOwnEffect(state, card, viewingPlayer, getDefinition) ||
        card.controllerPlayerId !== viewingPlayer
      ) {
        return null;
      }
    }

    return { pending: pzs, action: zsAction };
  }, [
    displayState.pendingZoneSelection,
    actions,
    state,
    getDefinition,
    viewingPlayer,
  ]);

  // 対象・手札・コア・コスト等、選択 UI の共通判定に追随する。
  // 独自の pending 列挙やインライン選択の例外は、追加時の隠し忘れを生む。
  // 手動トグルは次の選択フェーズ遷移までの一時上書き。
  const queueAutoHide = hasUiPending;
  const [effectQueueVisible, setEffectQueueVisible] = useState(true);
  useEffect(() => {
    setEffectQueueVisible(!queueAutoHide);
  }, [queueAutoHide]);
  // EffectQueueOverlay が表示している前面カードの id。1 pending に複数 responder が
  // 乗る triggered で、ActionBar の resolve action を「表示中カード 1 件」に絞るため
  // overlay と共有する (EffectQueueOverlay.onActiveItemChange)。
  const [activeQueueItemId, setActiveQueueItemId] = useState<string | null>(
    null
  );
  const queueItems = useMemo(
    () =>
      buildEffectQueue(
        state,
        getDefinition,
        effectLookups.getRegisteredTriggeredEffectActions,
        viewingPlayer,
        actions
      ),
    [
      state,
      getDefinition,
      effectLookups.getRegisteredTriggeredEffectActions,
      viewingPlayer,
      actions,
    ]
  );
  const frontQueueItem =
    queueItems.find((item) => item.id === activeQueueItemId) ??
    queueItems.find(isSelectedTriggeredQueueItem) ??
    queueItems[queueItems.length - 1];
  const toggleEffectQueueVisible = useCallback(
    () => setEffectQueueVisible((v) => !v),
    []
  );

  const payToActHandDiscardSelection = useMemo(() => {
    const pending = displayState.pendingPayToActHandDiscardGate;
    if (!pending) return null;
    const action = actions.find(
      (a) => a.kind === "resolve_pay_to_act_hand_discard_gate"
    );
    if (!action || action.kind !== "resolve_pay_to_act_hand_discard_gate") {
      return null;
    }
    return { pending, action };
  }, [displayState.pendingPayToActHandDiscardGate, actions]);

  const pendingActionHandTargetCandidateIds = useMemo(() => {
    if (!pendingAction || !("candidateTargetInstanceIds" in pendingAction)) {
      return new Set<string>();
    }
    const candidates = new Set(
      (
        pendingAction as {
          candidateTargetInstanceIds: readonly string[];
        }
      ).candidateTargetInstanceIds
    );
    const ids = new Set<string>();
    for (const card of state.cardInstances) {
      if (
        candidates.has(card.instanceId) &&
        isInHandForOwnEffect(state, card, viewingPlayer, getDefinition) &&
        card.controllerPlayerId === viewingPlayer
      ) {
        ids.add(card.instanceId);
      }
    }
    return ids;
  }, [pendingAction, state, getDefinition, viewingPlayer]);
  const hasInlineHandTargetSelection =
    pendingActionHandTargetCandidateIds.size > 0;

  const [handPendingSelectedIds, setHandPendingSelectedIds] = useState<
    string[]
  >([]);
  const [handDiscardGateSelectedIds, setHandDiscardGateSelectedIds] = useState<
    string[]
  >([]);

  // pending が消えたら選択をクリア
  useEffect(() => {
    if (!inlineHandSelection) {
      if (handPendingSelectedIds.length > 0) setHandPendingSelectedIds([]);
    }
  }, [inlineHandSelection, handPendingSelectedIds.length]);
  useEffect(() => {
    setHandDiscardGateSelectedIds([]);
  }, [payToActHandDiscardSelection?.pending.pendingId]);

  // 手札ゾーン選択モード突入時: 通常の行動モーダル (召喚/セット/発揮等) をクリア
  useEffect(() => {
    if (
      cardSelection.choice ||
      inlineHandSelection ||
      payToActHandDiscardSelection ||
      hasInlineHandTargetSelection
    ) {
      setDroppedCardChoice(null);
      setFieldCardChoice(null);
      setMagicCostModeChoice(null);
      setAccelCostModeChoice(null);
      setAsIfSoulCoreChoice(null);
    }
  }, [
    cardSelection.choice,
    inlineHandSelection,
    payToActHandDiscardSelection,
    hasInlineHandTargetSelection,
  ]);

  // 手札ドロワー化（PC / mobile 共通仕様）
  // - handOverride: ユーザーがアバター/mini-hand クリックで明示指定する開閉状態 (null = 自動)
  // - handAutoExpand: 手札を強制表示すべき状況（漏れ防止のため広めに）
  //   - bjk-active (じゃんけん/マリガン)
  //   - hasUiPending (cost payment / placement / coreshoot / separation / action / change)
  //   - inlineHandSelection (選択者自身の手札を選ぶ pendingZoneSelection)
  //   - pendingAction の自分手札 target 候補 (効果対象選択のゾーン候補)
  //   - pendingEffectChoice (誘発効果の選択肢)
  //   - handDragging (D&D 中: dragstart で立ち上げ、 dragend で消す)
  //
  // CSS 側で `.battle-screen.hand-expanded .hand-area` を表示、 `.battle-screen:not(.hand-expanded) .hand-area`
  // を scaleX(0) + opacity 0 で隠す (PC / mobile 共通)。
  // 自動展開中でもユーザーがボタンで閉じられるよう、手動指定 (handOverride) は常に優先する。
  // handAutoExpand の状態が切り替わる毎に override をクリアし、次の自動展開セッションでは
  // 既定動作 (auto-expand) に戻る。
  const [handOverride, setHandOverride] = useState<boolean | null>(null);
  const [handDragging, setHandDragging] = useState(false);
  // dragend をグローバル listener で捕捉 (CardView の onDragStart は HandArea 経由で
  // 別途 setHandDragging(true) するが、 onDragEnd は CardView に prop が無いので document 経由)
  useEffect(() => {
    const onDocDragEnd = () => setHandDragging(false);
    document.addEventListener("dragend", onDocDragEnd);
    return () => document.removeEventListener("dragend", onDocDragEnd);
  }, []);
  const handAutoExpand =
    !jankenDone ||
    hasUiPending ||
    inlineHandSelection !== null ||
    quartzPlacementSource !== null ||
    pendingEffectChoice !== null ||
    handDragging;
  useEffect(() => {
    setHandOverride(null);
  }, [handAutoExpand]);
  // 手札ドロワーを強制クローズすべき pending state 群:
  //
  // (A) action コミット後のフィールド・リザーブ操作:
  //   - pendingCostPayment / pendingPlacement / pendingCoreShoot / pendingSeparation
  //
  // (B) 対象選択モード (選択対象が手札以外を含む):
  //   - pendingAction (brave_combine / brave_swap などの合体・交換先スピリット選択)
  //     ただし自分の手札 target 候補を HandArea で選ぶ pendingAction は除外
  //   - pendingChangeCleanupChoice (チェンジ後処理の入れ替え先選択)
  //   - pendingZoneSelection がインライン手札選択でない
  //     (フィールド/トラッシュ/デッキ/相手手札等)
  //   - simple pending decision overlay 群 (入替 / 置換 / 借用選択など)
  //   - pendingCoreSplitSelection (旧コア分配)
  //   - pendingCoreDistribution (P3-47 新コア分配 — トラッシュ→フィールド等)
  //   - pendingMultiPlacement (P3-49 複数体同時召喚の per-target 配置)
  //   - pendingDeckReveal (デッキ公開モーダル)
  //
  // 召喚/使用 action 選択モーダル (droppedCardChoice / fieldCardChoice) と
  // magicCostModeChoice はキャンセルして別カードを選び直す可能性が高いため、
  // 手札展開を維持する。
  //
  // 上の useEffect が handAutoExpand 変化で setHandOverride(null) するのを、
  // この useEffect が後段で false に上書きすることで auto-expand 経路に勝つ。
  // handAutoExpand を依存に含めることで、 action 選択 → cost_payment や
  // action 選択 → pendingAction (brave_combine の合体先選択) のように
  // handForceClosed が false → true に立ち上がる遷移と同時に hasUiPending 経由で
  // handAutoExpand も true に立ち上がるケース（既存 useEffect が override をクリア
  // して再展開する）にも追従する。
  const handForceClosed =
    (cardSelection.choice !== null && cardSelection.handIds.size === 0) ||
    burstConfirmation !== null ||
    pendingCostPayment !== null ||
    pendingPlacement !== null ||
    pendingCoreShoot !== null ||
    pendingSeparation !== null ||
    (pendingAction !== null && !hasInlineHandTargetSelection) ||
    changeCleanupChoice !== null ||
    displayState.pendingBraveLeaveChoice !== null ||
    displayState.pendingBraveAttackContinuation !== null ||
    displayState.pendingSoulStateReplacement !== null ||
    displayState.pendingAdventSourceReplacement !== null ||
    displayState.pendingSetAsideExitReplacementChoice !== null ||
    displayState.pendingStepOptionalChoice !== null ||
    displayState.pendingStepChoice !== null ||
    displayState.pendingDeckRevealCountBoostChoice !== null ||
    displayState.pendingStepOptionalTargetSelection !== null ||
    displayState.pendingSummonCostCoreMoveChoice !== null ||
    displayState.pendingLifeDamageDiscardChoice !== null ||
    displayState.pendingLifeGainReplacementChoice !== null ||
    displayState.pendingBorrowedEffectChoice !== null ||
    displayState.pendingBorrowedEffectTargetSelection !== null ||
    displayState.pendingAsIfSoulCoreChoice !== null ||
    displayState.pendingPayToActCoreGate !== null ||
    hasFieldMagicPreCostChoice ||
    displayState.pendingCoreSplitSelection !== null ||
    displayState.pendingBraveCombineChoice !== null ||
    displayState.pendingStoneFlipCombine !== null ||
    (displayState.pendingHandTrashSwapChoice !== null &&
      !cardSelection.choice) ||
    (displayState.pendingFieldHandSwapChoice !== null &&
      !cardSelection.choice) ||
    displayState.pendingTenshoSummon !== null ||
    displayState.pendingReverseRebirthSummon !== null ||
    displayState.pendingCoreCountSelection !== null ||
    displayState.pendingCountSelection !== null ||
    displayState.pendingDiscardSetBurstCountSelection !== null ||
    displayState.pendingLifeCoreSelection !== null ||
    displayState.pendingCoreSourceAllocation !== null ||
    pendingLinkAidCostSourceChoice !== null ||
    displayState.pendingEffectSummonCostPayment !== null ||
    displayState.pendingCoreDistribution !== null ||
    displayState.pendingChangeCleanupChoice !== null ||
    displayState.pendingEffectOptionalRepeatChoice !== null ||
    displayState.pendingEffectOptionalRepeatCountSelection !== null ||
    displayState.pendingEnterFieldPlacement !== null ||
    displayState.pendingMultiPlacement !== null ||
    displayState.pendingConnectBattleDecision !== null ||
    displayState.pendingDeckReveal !== null ||
    (displayState.pendingZoneSelection !== null &&
      inlineHandSelection === null);
  useEffect(() => {
    if (handForceClosed) setHandOverride(false);
    else if (cardSelection.handIds.size > 0) setHandOverride(null);
  }, [
    handForceClosed,
    handAutoExpand,
    cardSelection.choice?.key,
    cardSelection.handIds.size,
  ]);
  const handExpanded = handOverride !== null ? handOverride : handAutoExpand;

  // 「シンボル表示」モード: トグル ON で全フィールドカード (spirit + nexus、両プレイヤー)
  // をグレーアウトし、効果適用後シンボルラベルをカード上にオーバーレイ表示する。
  const [symbolOverlayMode, setSymbolOverlayMode] = useState(false);

  // 「・・・」メニュー: BGM 操作 / リセット / ホームへ / スナップショット保存 を 1 ボタンに集約。
  // 手札ボタンの右隣に置き、クリックで上方にポップアップ。外側クリック・ESC で閉じる。
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [publicDisclosureLogOpen, setPublicDisclosureLogOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuPanelRef = useRef<HTMLDivElement>(null);
  const publicDisclosureDropPulseTimeoutRef = useRef<number | null>(null);
  const [publicDisclosureDropPulse, setPublicDisclosureDropPulse] =
    useState(false);
  const [moreMenuPanelPosition, setMoreMenuPanelPosition] = useState<{
    right: number;
    bottom: number;
  } | null>(null);
  const getPublicDisclosureExitAnchor = useCallback(() => {
    if (typeof window === "undefined") return null;
    const button =
      moreMenuRef.current?.querySelector<HTMLElement>(
        '[data-testid="btn-more-menu"]'
      ) ?? null;
    const element = button ?? moreMenuRef.current;
    const rect = element?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);
  const pulsePublicDisclosureExitAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    if (publicDisclosureDropPulseTimeoutRef.current !== null) {
      window.clearTimeout(publicDisclosureDropPulseTimeoutRef.current);
    }
    setPublicDisclosureDropPulse(true);
    publicDisclosureDropPulseTimeoutRef.current = window.setTimeout(() => {
      setPublicDisclosureDropPulse(false);
      publicDisclosureDropPulseTimeoutRef.current = null;
    }, 260);
  }, []);
  const updateMoreMenuPanelPosition = useCallback(() => {
    const rect = moreMenuRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") return;
    setMoreMenuPanelPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
    });
  }, []);
  // BGM (ゲーム内画面ではフローティングコントロールを表示せず、ここに統合する)
  const {
    works: bgmWorks,
    currentWorkIndex: bgmWorkIndex,
    currentSongName: bgmSongName,
    volume: bgmVolume,
    muted: bgmMuted,
    setVolume: setBgmVolume,
    toggleMute: toggleBgmMute,
    skipTrack: skipBgmTrack,
    transitionToEnding: bgmTransitionToEnding,
    resumeFromEnding: bgmResumeFromEnding,
  } = useBgm();
  const bgmCurrentWork = bgmWorks[bgmWorkIndex];
  const bgmNowPlaying = `${bgmCurrentWork?.work.label ?? "—"}・${
    bgmSongName ?? "—"
  }`;

  // 勝敗決定時の演出: バトル BGM をフェードアウト → エンディング曲の再生開始と
  // 同時に勝敗オーバーレイを表示する (transitionToEnding はエンディング曲が
  // 鳴り始めた時点で resolve。再生不可でもタイムアウトで resolve し表示は止めない)。
  // 「もう一度プレイ」で gameResult が消えたら通常 BGM プールに戻す。
  const gameEnded = state.gameResult != null;
  const [resultOverlayVisible, setResultOverlayVisible] = useState(false);
  useEffect(() => {
    if (!gameEnded) {
      setResultOverlayVisible(false);
      bgmResumeFromEnding();
      return undefined;
    }
    let cancelled = false;
    void bgmTransitionToEnding().then(() => {
      if (!cancelled) setResultOverlayVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [gameEnded, bgmTransitionToEnding, bgmResumeFromEnding]);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideButton = moreMenuRef.current?.contains(target) ?? false;
      const insidePanel = moreMenuPanelRef.current?.contains(target) ?? false;
      if (!insideButton && !insidePanel) setMoreMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreMenuOpen]);
  useLayoutEffect(() => {
    if (!moreMenuOpen) {
      setMoreMenuPanelPosition(null);
      return undefined;
    }

    updateMoreMenuPanelPosition();
    const onUpdate = () => updateMoreMenuPanelPosition();
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [moreMenuOpen, updateMoreMenuPanelPosition]);
  useEffect(
    () => () => {
      if (publicDisclosureDropPulseTimeoutRef.current !== null) {
        window.clearTimeout(publicDisclosureDropPulseTimeoutRef.current);
      }
    },
    []
  );
  const hasAnyFieldSymbolSource = useMemo(
    () =>
      state.cardInstances.some((c) => c.zone === "field") ||
      state.players.some(
        (player) =>
          getFieldSymbolSources({
            state,
            actingPlayerId: player.id,
            getCardDefinitionById: getDefinition,
          }).length > 0
      ),
    [state, getDefinition]
  );

  // 対象選択モーダルの一時非表示: 盤面確認のためのトグル。
  // 非表示中は modal が render されず、フローティングの「対象選択に戻る」ボタンを表示。
  // ゲーム進行操作 (次のステップ / コア移動 / カード操作 / 下部 pass 操作) はいずれにせよ
  // hasUiPending / hasPending によってブロックされている前提。
  const [modalsHidden, setModalsHidden] = useState(false);
  // 残す選択はコア配置の確定までエンジン側に保持するが、配置中は盤面を操作できるようにする。
  const braveLeaveChoicePending = pendingSeparation
    ? null
    : displayState.pendingBraveLeaveChoice;
  // displayState は解決者でない pending を null 化済みなので、present なら自分が解決者。
  // インライン手札選択のみ full-screen モーダルから除外する。
  const hasFullScreenModalPending =
    revealedTargetIds !== null ||
    burstConfirmation !== null ||
    braveLeaveChoicePending !== null ||
    displayState.pendingBraveAttackContinuation !== null ||
    displayState.pendingSoulStateReplacement !== null ||
    displayState.pendingAdventSourceReplacement !== null ||
    displayState.pendingSetAsideExitReplacementChoice !== null ||
    displayState.pendingDeckReveal !== null ||
    displayState.pendingStepOptionalChoice !== null ||
    displayState.pendingStepChoice !== null ||
    displayState.pendingDeckRevealCountBoostChoice !== null ||
    displayState.pendingSummonCostCoreMoveChoice !== null ||
    displayState.pendingLifeDamageDiscardChoice !== null ||
    displayState.pendingLifeGainReplacementChoice !== null ||
    displayState.pendingBorrowedEffectChoice !== null ||
    displayState.pendingPayToActCoreGate !== null ||
    hasFieldMagicPreCostChoice ||
    displayState.pendingAsIfSoulCoreChoice !== null ||
    displayState.pendingEffectOptionalRepeatChoice !== null ||
    (displayState.pendingZoneSelection !== null &&
      inlineHandSelection === null) ||
    displayState.pendingCoreSplitSelection !== null ||
    (braveCombineChoicePending !== null &&
      !isBraveCombineChoiceHostSelection) ||
    displayState.pendingHandTrashSwapChoice !== null ||
    displayState.pendingFieldHandSwapChoice !== null ||
    displayState.pendingTenshoSummon !== null ||
    displayState.pendingReverseRebirthSummon !== null ||
    displayState.pendingCoreCountSelection !== null ||
    displayState.pendingCountSelection !== null ||
    displayState.pendingDiscardSetBurstCountSelection !== null ||
    displayState.pendingLifeCoreSelection !== null ||
    displayState.pendingCoreSourceAllocation !== null ||
    pendingLinkAidCostSourceChoice !== null ||
    displayState.pendingConnectBattleDecision !== null;
  const modalPeekReturnLabel =
    burstConfirmation !== null
      ? "発動確認に戻る"
      : displayState.pendingStepChoice !== null ||
          displayState.pendingEffectOptionalRepeatChoice !== null
        ? "効果選択に戻る"
        : "対象選択に戻る";
  // モーダルの対象が変わったら自動で再表示 (誤って前モーダルの hidden 状態を持ち越さない)
  const modalKey = useMemo(() => {
    if (revealedTargetIds) return `revealed-target:${pendingAction?.actionId}`;
    if (burstConfirmation)
      return `burst-confirmation:${burstConfirmation.action.actionId}`;
    if (braveLeaveChoicePending)
      return `brave-leave:${braveLeaveChoicePending.hostInstanceId}:${braveLeaveChoicePending.braveInstanceIds.join(",")}`;
    if (displayState.pendingBraveAttackContinuation)
      return `brave-attack:${displayState.pendingBraveAttackContinuation.entityId}`;
    if (displayState.pendingSoulStateReplacement)
      return `soul-state:${displayState.pendingSoulStateReplacement.cardInstanceId}`;
    if (displayState.pendingAdventSourceReplacement)
      return `advent-source:${displayState.pendingAdventSourceReplacement.cardInstanceId}`;
    if (displayState.pendingSetAsideExitReplacementChoice)
      return `set-aside-exit:${displayState.pendingSetAsideExitReplacementChoice.cardInstanceId}`;
    if (displayState.pendingDeckReveal)
      return `dr:${displayState.pendingDeckReveal.currentPickIndex}:${displayState.pendingDeckReveal.phase}`;
    if (displayState.pendingStepOptionalChoice)
      return `step-optional:${displayState.pendingStepOptionalChoice.pendingId}`;
    if (displayState.pendingStepChoice)
      return `step-choice:${displayState.pendingStepChoice.pendingId}`;
    if (displayState.pendingDeckRevealCountBoostChoice)
      return `deck-boost:${displayState.pendingDeckRevealCountBoostChoice.pendingId}`;
    if (displayState.pendingDrawStepCostChoice)
      return `draw-cost:${displayState.pendingDrawStepCostChoice.pendingId}`;
    if (displayState.pendingSummonCostExcludeChoice)
      return `summon-exclude:${displayState.pendingSummonCostExcludeChoice.pendingId}`;
    if (displayState.pendingSummonCostCoreMoveChoice)
      return `summon-core-move:${displayState.pendingSummonCostCoreMoveChoice.pendingId}`;
    if (displayState.pendingGroupedSummonCostOverrideChoice)
      return `summon-grouped:${displayState.pendingGroupedSummonCostOverrideChoice.pendingId}`;
    if (displayState.pendingLifeDamageDiscardChoice)
      return `life-damage-discard:${displayState.pendingLifeDamageDiscardChoice.pendingId}`;
    if (displayState.pendingLifeGainReplacementChoice)
      return `life-gain:${displayState.pendingLifeGainReplacementChoice.pendingId}`;
    if (displayState.pendingBorrowedEffectChoice)
      return `borrowed-choice:${displayState.pendingBorrowedEffectChoice.pendingId}`;
    if (displayState.pendingPayToActCoreGate)
      return `pay-core:${displayState.pendingPayToActCoreGate.pendingId}`;
    if (displayState.pendingFieldMagicPreCostTrigger)
      return `field-magic-pre:${displayState.pendingFieldMagicPreCostTrigger.pendingId}`;
    if (displayState.pendingAsIfSoulCoreChoice)
      return `as-if-soul-core:${displayState.pendingAsIfSoulCoreChoice.pendingId}`;
    if (displayState.pendingEffectOptionalRepeatChoice)
      return `effect-optional-repeat:${displayState.pendingEffectOptionalRepeatChoice.pendingId}`;
    if (displayState.pendingZoneSelection && inlineHandSelection === null)
      return `zs:${displayState.pendingZoneSelection.actionKind}:${displayState.pendingZoneSelection.sourceZone}`;
    if (displayState.pendingCoreSplitSelection) return `cs`;
    if (displayState.pendingBraveCombineChoice)
      return `brave-combine:${displayState.pendingBraveCombineChoice.pendingId}`;
    if (displayState.pendingStoneFlipCombine)
      return `stone-flip-combine:${displayState.pendingStoneFlipCombine.pendingId}`;
    if (displayState.pendingHandTrashSwapChoice)
      return `hand-trash:${displayState.pendingHandTrashSwapChoice.pendingId}`;
    if (displayState.pendingFieldHandSwapChoice)
      return `field-hand:${displayState.pendingFieldHandSwapChoice.pendingId}`;
    if (displayState.pendingTenshoSummon)
      return `tensho:${displayState.pendingTenshoSummon.pendingId}`;
    if (displayState.pendingReverseRebirthSummon)
      return `reverse-rebirth:${displayState.pendingReverseRebirthSummon.pendingId}`;
    if (displayState.pendingSplitSummonChoice)
      return `ssc:${displayState.pendingSplitSummonChoice.pendingId}`;
    if (displayState.pendingCoreCountSelection) return `cc`;
    if (displayState.pendingCountSelection)
      return `pcs:${displayState.pendingCountSelection.pendingId}`;
    if (displayState.pendingDiscardSetBurstCountSelection)
      return `dsbcs:${displayState.pendingDiscardSetBurstCountSelection.pendingId}`;
    if (displayState.pendingLifeCoreSelection)
      return `lcs:${displayState.pendingLifeCoreSelection.pendingId}`;
    if (displayState.pendingCoreSourceAllocation)
      return `csa:${displayState.pendingCoreSourceAllocation.pendingId}`;
    if (pendingLinkAidCostSourceChoice)
      return `lac:${pendingLinkAidCostSourceChoice.pendingId}`;
    if (displayState.pendingConnectBattleDecision)
      return `connect-battle:${displayState.pendingConnectBattleDecision.pendingId}`;
    return null;
  }, [
    pendingAction?.actionId,
    revealedTargetIds,
    braveLeaveChoicePending,
    burstConfirmation,
    displayState.pendingBraveAttackContinuation,
    displayState.pendingSoulStateReplacement,
    displayState.pendingAdventSourceReplacement,
    displayState.pendingSetAsideExitReplacementChoice,
    displayState.pendingDeckReveal,
    displayState.pendingStepOptionalChoice,
    displayState.pendingStepChoice,
    displayState.pendingDeckRevealCountBoostChoice,
    displayState.pendingDrawStepCostChoice,
    displayState.pendingSummonCostExcludeChoice,
    displayState.pendingSummonCostCoreMoveChoice,
    displayState.pendingGroupedSummonCostOverrideChoice,
    displayState.pendingLifeDamageDiscardChoice,
    displayState.pendingLifeGainReplacementChoice,
    displayState.pendingBorrowedEffectChoice,
    displayState.pendingPayToActCoreGate,
    displayState.pendingFieldMagicPreCostTrigger,
    displayState.pendingAsIfSoulCoreChoice,
    displayState.pendingEffectOptionalRepeatChoice,
    displayState.pendingZoneSelection,
    displayState.pendingCoreSplitSelection,
    displayState.pendingBraveCombineChoice,
    displayState.pendingStoneFlipCombine,
    displayState.pendingHandTrashSwapChoice,
    displayState.pendingFieldHandSwapChoice,
    displayState.pendingTenshoSummon,
    displayState.pendingReverseRebirthSummon,
    displayState.pendingSplitSummonChoice,
    displayState.pendingCoreCountSelection,
    displayState.pendingCountSelection,
    displayState.pendingDiscardSetBurstCountSelection,
    displayState.pendingLifeCoreSelection,
    displayState.pendingCoreSourceAllocation,
    pendingLinkAidCostSourceChoice,
    displayState.pendingConnectBattleDecision,
    inlineHandSelection,
  ]);
  useEffect(() => {
    setModalsHidden(false);
  }, [modalKey]);

  const selectableHandIds = useMemo(() => {
    if (cardSelection.choice) return cardSelection.handIds;
    // インライン手札選択中は候補カード（primary + alt）をハイライト
    if (inlineHandSelection) {
      const set = new Set<string>(
        inlineHandSelection.action.candidateCardInstanceIds
      );
      for (const alt of inlineHandSelection.action.alternateSelections ?? []) {
        for (const id of alt.candidateInstanceIds) set.add(id);
      }
      return set;
    }
    if (payToActHandDiscardSelection) {
      return new Set<string>(
        payToActHandDiscardSelection.action.candidateCardInstanceIds
      );
    }
    if (hasInlineHandTargetSelection) {
      return new Set(pendingActionHandTargetCandidateIds);
    }
    if (hasUiPending) return new Set<string>();
    const ids = new Set<string>();
    for (const a of actions) {
      if (ACTION_UI_ROUTES[a.kind] === "hand-tap") {
        for (const id of tapTargetInstanceIds(a)) ids.add(id);
      }
    }
    return ids;
  }, [
    cardSelection.choice,
    cardSelection.handIds,
    actions,
    hasUiPending,
    hasInlineHandTargetSelection,
    inlineHandSelection,
    pendingActionHandTargetCandidateIds,
    payToActHandDiscardSelection,
  ]);

  // インライン手札選択 / 手札破棄gate / 効果対象手札候補:
  // 候補外の手札カード（グレーアウト対象）。
  const nonCandidateHandIds = useMemo(() => {
    if (cardSelection.choice)
      return new Set(
        getOwnHandCards(state, viewingPlayer, getDefinition)
          .map((card) => card.instanceId)
          .filter((id) => !cardSelection.handIds.has(id))
      );
    if (
      !inlineHandSelection &&
      !payToActHandDiscardSelection &&
      !hasInlineHandTargetSelection
    ) {
      return undefined;
    }
    const candidates = new Set<string>();
    if (inlineHandSelection) {
      for (const id of inlineHandSelection.action.candidateCardInstanceIds) {
        candidates.add(id);
      }
      for (const alt of inlineHandSelection.action.alternateSelections ?? []) {
        for (const id of alt.candidateInstanceIds) candidates.add(id);
      }
    }
    if (payToActHandDiscardSelection) {
      for (const id of payToActHandDiscardSelection.action
        .candidateCardInstanceIds) {
        candidates.add(id);
      }
    }
    if (hasInlineHandTargetSelection) {
      for (const id of pendingActionHandTargetCandidateIds) candidates.add(id);
    }
    const ids = new Set<string>();
    for (const c of state.cardInstances) {
      if (
        c.controllerPlayerId === viewingPlayer &&
        isInHandForOwnEffect(state, c, viewingPlayer, getDefinition) &&
        !candidates.has(c.instanceId)
      ) {
        ids.add(c.instanceId);
      }
    }
    return ids;
  }, [
    cardSelection.choice,
    cardSelection.handIds,
    hasInlineHandTargetSelection,
    inlineHandSelection,
    pendingActionHandTargetCandidateIds,
    payToActHandDiscardSelection,
    state,
    getDefinition,
    viewingPlayer,
  ]);

  const selectableFieldIds = useMemo(() => {
    if (hasUiPending) return new Set<string>();
    const ids = new Set<string>();
    for (const a of actions) {
      if (ACTION_UI_ROUTES[a.kind] === "field-tap") {
        for (const id of tapTargetInstanceIds(a)) ids.add(id);
      }
    }
    return getSelectableFieldTapIds(state, ids);
  }, [actions, hasUiPending, state]);

  // ブロック可能な状態か（ブロック辞退ボタン表示用）
  const hasBlockActions = useMemo(
    () => actions.some((a) => a.kind === "block"),
    [actions]
  );

  // 対象選択モード中のハイライト候補
  const targetCandidateIds = useMemo(() => {
    if (cardSelection.choice) return cardSelection.candidateIds;
    // P3-47 F-4 / P3-76: 効果対象リダイレクト (持続効果の対象変更介入) は候補を
    // candidateTokenInstanceIds に持つ。field-tap 流用のため候補集合として返す。
    if (pendingAction?.kind === "confirm_target_redirect") {
      return new Set<string>(
        (pendingAction as ConfirmTargetRedirectLegalAction)
          .candidateTokenInstanceIds
      );
    }
    if (pendingAction?.kind === "resolve_brave_combine_choice") {
      return new Set<string>(
        actions
          .filter(
            (
              a
            ): a is Extract<
              LegalAction,
              { kind: "resolve_brave_combine_choice" }
            > =>
              a.kind === "resolve_brave_combine_choice" &&
              a.pendingId === pendingAction.pendingId &&
              a.chosenHostInstanceId !== null
          )
          .map((a) => a.chosenHostInstanceId!)
      );
    }
    if (!pendingAction || !("candidateTargetInstanceIds" in pendingAction))
      return null;
    return new Set<string>(
      (pendingAction as { candidateTargetInstanceIds: string[] })
        .candidateTargetInstanceIds
    );
  }, [
    pendingAction,
    actions,
    cardSelection.choice,
    cardSelection.candidateIds,
  ]);
  const browsedTargetCandidateIds = useMemo(() => {
    if (!targetCandidateIds) return [];
    const underCards = collectUnderCardScopeIds(displayState);
    return displayState.cardInstances
      .filter(
        (c) =>
          targetCandidateIds.has(c.instanceId) &&
          (c.zone !== "field" ||
            isSoulStateCard(displayState, c.instanceId) ||
            underCards.adventSource.has(c.instanceId) ||
            underCards.textRole.has(c.instanceId))
      )
      .map((c) => c.instanceId);
  }, [displayState, targetCandidateIds]);
  const suppressTargetDeclaredPresentation =
    pendingAction !== null && targetCandidateIds !== null;

  const pendingRequiredCount =
    pendingAction && "requiredTargetCount" in pendingAction
      ? (pendingAction as { requiredTargetCount: number }).requiredTargetCount
      : 0;
  // D-2 Phase 2: 可変選択時の上限。省略時は requiredTargetCount と同じ (固定数選択)。
  const pendingMaxCount =
    pendingAction && "maxTargetCount" in pendingAction
      ? ((pendingAction as { maxTargetCount?: number }).maxTargetCount ??
        pendingRequiredCount)
      : pendingRequiredCount;
  const pendingAllowsDuplicateTargets =
    pendingAction && "allowDuplicateTargets" in pendingAction
      ? (pendingAction as { allowDuplicateTargets?: boolean })
          .allowDuplicateTargets === true
      : false;
  const pendingTargetGroups = useMemo(
    () => getSelectionTargetGroups(pendingAction),
    [pendingAction]
  );
  // 可変選択 (max > required) のとき true。「N 体まで」「0 体可」のような明示確定が必要。
  const pendingIsVariableSelect = pendingMaxCount > pendingRequiredCount;

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 2000);
  };

  const getCardDisplayNameByInstanceId = useCallback(
    (instanceId: string): string | undefined => {
      const card = state.cardInstances.find((c) => c.instanceId === instanceId);
      return card ? getDefinition(card.definitionId)?.name : undefined;
    },
    [getDefinition, state.cardInstances]
  );

  const applyAsIfSoulCoreAction = useCallback(
    (action: AsIfSoulCoreAction) => {
      try {
        const result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, action, {});
        showMessage(asIfSoulCoreDoneMessage(action));
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
      setAsIfSoulCoreChoice(null);
      setPendingAction(null);
      setSelectedTargets([]);
    },
    [effectLookups, getDefinition, setStateAndSync, state]
  );

  useEffect(() => {
    const p = displayState.pendingAsIfSoulCoreChoice;
    if (!p || p.actingPlayerId !== viewingPlayer) {
      if (asIfSoulCoreChoice !== null) setAsIfSoulCoreChoice(null);
      return;
    }
    if (asIfSoulCoreChoice?.pendingId === p.pendingId) return;

    const resolveActions = actions.filter(
      (a): a is AsIfSoulCoreAction =>
        a.kind === "resolve_pending_as_if_soul_core_choice" &&
        a.pendingId === p.pendingId
    );
    if (resolveActions.length === 0) return;

    const optionById = new Map(
      p.options.map((option) => [option.choiceId, option] as const)
    );
    const sourceDefinition = getDefinition(p.sourceDefinitionId);
    const keyword = asIfSoulCoreKeywordLabel(p.actionKind, sourceDefinition);
    const sourceName = getCardDisplayNameByInstanceId(p.sourceInstanceId);
    const choiceOptions = resolveActions.map((action) => {
      const pendingOption = optionById.get(action.choiceId);
      const proxySourceName = pendingOption?.proxySourceInstanceId
        ? getCardDisplayNameByInstanceId(pendingOption.proxySourceInstanceId)
        : undefined;
      return {
        action,
        label: localizeEffectLabel(action.choiceLabel),
        ...(proxySourceName ? { sourceName: proxySourceName } : {}),
      };
    });
    setAsIfSoulCoreChoice({
      pendingId: p.pendingId,
      actionKind: p.actionKind,
      title: keyword,
      prompt:
        p.actionKind === "contract_combine"
          ? "どの方法で【契約合体】しますか?"
          : `${sourceName ?? "このカード"}の効果で、どの方法で【${keyword}】しますか?`,
      visualInstanceId: p.sourceInstanceId,
      options: choiceOptions,
    });
  }, [
    displayState.pendingAsIfSoulCoreChoice,
    actions,
    viewingPlayer,
    asIfSoulCoreChoice,
    getDefinition,
    getCardDisplayNameByInstanceId,
  ]);

  useEffect(() => {
    if (!pendingAction && !cardSelection.choice) {
      setTargetBrowseOpen(false);
      setFieldStackBrowse(null);
    }
  }, [pendingAction, cardSelection.choice]);

  // 効果の対象選択 pending (コスト支払い + スタック窓クローズ後の解決時、種別非依存)。
  // ルール正源: 03a 標準パイプライン (2.コスト支払い → 3.対象の選択)。displayState 経由で
  // 自分宛のときのみ resolve_pending_effect_target を既存の対象選択 UI に載せる。
  useEffect(() => {
    const p = displayState.pendingEffectTargetSelection;
    if (!p || p.actingPlayerId !== viewingPlayer) return;
    if (
      pendingAction?.kind === "resolve_pending_effect_target" &&
      pendingAction.pendingId === p.pendingId
    )
      return;
    const resolveAction = actions.find(
      (a) => a.kind === "resolve_pending_effect_target"
    );
    if (resolveAction) {
      setPendingAction(resolveAction);
      setSelectedTargets([]);
      showMessage("効果の対象を選択してください");
    }
  }, [
    displayState.pendingEffectTargetSelection,
    actions,
    viewingPlayer,
    pendingAction,
  ]);

  // optional step 自身の対象選択 pending (execute resume 後の独自 target 1 体選択)。
  // pendingEffectTargetSelection と同型 (displayState 経由で自分宛のときのみ起動)。
  // 正源: ENGINE-step-optional-target-step-pending-selection (audit) + 03c §可能形語尾。
  useEffect(() => {
    const p = displayState.pendingStepOptionalTargetSelection;
    // step.chooser='opponent' のときは効果オーナーでなく対象選択者 (choosingPlayerId) 側に
    // ピッカーを開く。viewingPlayer マッチは choosingPlayerId 基準。
    if (!p || p.choosingPlayerId !== viewingPlayer) {
      // RESTや別画面で解決した場合も、終了した任意stepの選択を残さない。
      if (
        pendingAction?.kind === "resolve_pending_step_optional_target_selection"
      ) {
        setPendingAction(null);
        setSelectedTargets([]);
      }
      return;
    }
    if (
      pendingAction?.kind ===
        "resolve_pending_step_optional_target_selection" &&
      pendingAction.pendingId === p.pendingId
    )
      return;
    const resolveAction = actions.find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    if (resolveAction) {
      setPendingAction(resolveAction);
      setSelectedTargets([]);
      showMessage("任意ステップの対象を選択してください");
    }
  }, [
    displayState.pendingStepOptionalTargetSelection,
    actions,
    viewingPlayer,
    pendingAction,
  ]);

  // card_event 効果借用の対象選択 pending。通常の効果対象選択と同じ target picker に載せる。
  useEffect(() => {
    const p = displayState.pendingBorrowedEffectTargetSelection;
    if (!p || p.choosingPlayerId !== viewingPlayer) return;
    if (
      pendingAction?.kind === "resolve_borrowed_effect_target" &&
      pendingAction.pendingId === p.pendingId
    )
      return;
    const resolveAction = actions.find(
      (a) => a.kind === "resolve_borrowed_effect_target"
    );
    if (resolveAction) {
      setPendingAction(resolveAction);
      setSelectedTargets([]);
      showMessage("借用効果の対象を選択してください");
    }
  }, [
    displayState.pendingBorrowedEffectTargetSelection,
    actions,
    viewingPlayer,
    pendingAction,
  ]);

  // P3-47 F-4 / P3-76: 効果対象リダイレクト (持続効果の対象変更介入)。
  // 誘発キュー・スタック窓を経由しない解決時の割り込みで、自分宛のとき既存の対象選択モード
  // (field-tap) を流用して「変更先の分身」をフィールドから選ばせる。confirm_target_redirect を
  // pendingAction に載せると targetCandidateIds が candidateTokenInstanceIds を候補化する。
  useEffect(() => {
    // P3-79: displayState (解決者でない pending は filter 済み) で判定。
    const pr = displayState.pendingTargetRedirects[0];
    if (!pr) return;
    if (pendingAction?.kind === "confirm_target_redirect") return;
    const confirmAction = actions.find(
      (a): a is ConfirmTargetRedirectLegalAction =>
        a.kind === "confirm_target_redirect" && a.pendingId === pr.pendingId
    );
    if (confirmAction) {
      setPendingAction(confirmAction);
      setSelectedTargets([]);
      showMessage(
        confirmAction.replacementSelectionRequired === false
          ? "対象変更を承諾してください"
          : "対象を変更する分身をタップ"
      );
    }
  }, [
    displayState.pendingTargetRedirects,
    actions,
    viewingPlayer,
    pendingAction,
  ]);

  const applyTargetSelection = useCallback(
    (targetIds: string[]) => {
      if (!pendingAction) return;

      if (pendingAction.kind === "confirm_target_redirect") {
        const redirectAction =
          pendingAction as ConfirmTargetRedirectLegalAction;
        const replacementMode = redirectAction.replacementMode ?? "collapse";
        const replacementTargetCount =
          redirectAction.replacementTargetCount ??
          (replacementMode === "reselect"
            ? (redirectAction.redirectableInstanceIds?.length ?? 1)
            : 1);
        if (targetIds.length !== replacementTargetCount) {
          showMessage(`変更先は ${replacementTargetCount} 体選択してください`);
          return;
        }
        try {
          const redirectOptions =
            replacementMode === "reselect"
              ? { redirectTargetReplacementInstanceIds: targetIds }
              : { redirectTargetReplacementInstanceId: targetIds[0]! };
          const result = applyLegalAction({
            state,
            action: redirectAction,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            ...redirectOptions,
          });
          setStateAndSync(result.state, redirectAction, redirectOptions);
          showMessage("対象を変更");
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      if (
        !satisfiesSelectionTargetGroups(
          targetIds,
          pendingTargetGroups,
          pendingAllowsDuplicateTargets
        )
      ) {
        showMessage("対象種別ごとに必要数を選択してください");
        return;
      }

      // P2-05: 同時アタック宣言 — 「複数でアタック」で選んだ追加参加体を
      // additionalSourceInstanceIds として attack action に渡す
      // (対象選択モードの流用。targetInstanceIds ではない点に注意)。
      if (pendingAction.kind === "attack") {
        const attackAction = pendingAction as AttackLegalAction;
        try {
          const result = applyLegalAction({
            state,
            action: attackAction,
            additionalSourceInstanceIds: targetIds,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
          });
          setStateAndSync(result.state, attackAction, {
            additionalSourceInstanceIds: targetIds,
          });
          showMessage(`同時アタック宣言（${targetIds.length + 1} 体）`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      try {
        const result = applyLegalAction({
          state,
          action: pendingAction,
          targetInstanceIds: targetIds,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, pendingAction, {
          targetInstanceIds: targetIds,
        });
        showMessage("対象選択完了");
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
      setPendingAction(null);
      setSelectedTargets([]);
    },

    [
      pendingAction,
      state,
      getDefinition,
      effectLookups,
      setStateAndSync,
      pendingTargetGroups,
      pendingAllowsDuplicateTargets,
    ]
  );

  const handleTargetClick = useCallback(
    (instanceId: string) => {
      if (cardSelection.choice) {
        cardSelection.toggle(instanceId);
        return;
      }
      if (!pendingAction) return;

      // P3-47 F-4 / P3-76: 効果対象リダイレクトの変更先分身を field-tap で選択 → 即確定。
      // (持続効果の対象変更介入。スタック/キュー UI とは無関係な解決時の差し替え。)
      if (pendingAction.kind === "confirm_target_redirect") {
        const confirmAction = pendingAction as ConfirmTargetRedirectLegalAction;
        const replacementMode = confirmAction.replacementMode ?? "collapse";
        const replacementTargetCount =
          confirmAction.replacementTargetCount ??
          (replacementMode === "reselect"
            ? (confirmAction.redirectableInstanceIds?.length ?? 1)
            : 1);
        if (replacementTargetCount > 1) {
          if (!confirmAction.candidateTokenInstanceIds.includes(instanceId)) {
            return;
          }
          const isSelected = selectedTargets.includes(instanceId);
          if (!isSelected && selectedTargets.length >= replacementTargetCount) {
            showMessage(`変更先は最大 ${replacementTargetCount} 体までです`);
            return;
          }
          setSelectedTargets(
            isSelected
              ? selectedTargets.filter((id) => id !== instanceId)
              : [...selectedTargets, instanceId]
          );
          return;
        }
        try {
          const result = applyLegalAction({
            state,
            action: confirmAction,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            redirectTargetReplacementInstanceId: instanceId,
          });
          setStateAndSync(result.state, confirmAction, {
            redirectTargetReplacementInstanceId: instanceId,
          });
          showMessage("対象を変更");
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      // brave_combine: 選択された合体先と一致するアクションを実行
      if (pendingAction.kind === "brave_combine") {
        const combineAction = actions.find(
          (a) =>
            a.kind === "brave_combine" &&
            a.braveInstanceId === pendingAction.braveInstanceId &&
            a.targetInstanceId === instanceId
        );
        if (combineAction) {
          try {
            const result = applyLegalAction({
              state,
              action: combineAction,
              getCardDefinitionById: getDefinition,
              ...effectLookups,
            });
            setStateAndSync(result.state, combineAction);
            showMessage("合体完了");
          } catch (e) {
            showMessage(`エラー: ${userFacingError(e)}`);
          }
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      // 召喚/転醒後ブレイヴの「合体する」分岐: 既存の対象選択 HUD で host をタップ。
      if (pendingAction.kind === "resolve_brave_combine_choice") {
        const combineChoiceAction = actions.find(
          (
            a
          ): a is Extract<
            LegalAction,
            { kind: "resolve_brave_combine_choice" }
          > =>
            a.kind === "resolve_brave_combine_choice" &&
            a.pendingId === pendingAction.pendingId &&
            a.chosenHostInstanceId === instanceId
        );
        if (combineChoiceAction) {
          try {
            const result = applyLegalAction({
              state,
              action: combineChoiceAction,
              getCardDefinitionById: getDefinition,
              ...effectLookups,
            });
            setStateAndSync(result.state, combineChoiceAction);
            showMessage("合体完了");
          } catch (e) {
            showMessage(`エラー: ${userFacingError(e)}`);
          }
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      // brave_swap: 選択された交換先と一致するアクションを実行
      if (pendingAction.kind === "brave_swap") {
        const swapAction = actions.find(
          (a) =>
            a.kind === "brave_swap" &&
            a.braveInstanceId === pendingAction.braveInstanceId &&
            a.toHostInstanceId === instanceId
        );
        if (swapAction) {
          try {
            const result = applyLegalAction({
              state,
              action: swapAction,
              getCardDefinitionById: getDefinition,
              ...effectLookups,
            });
            setStateAndSync(result.state, swapAction);
            showMessage("交換完了");
          } catch (e) {
            showMessage(`エラー: ${userFacingError(e)}`);
          }
        }
        setPendingAction(null);
        setSelectedTargets([]);
        return;
      }

      const isAlreadySelected = selectedTargets.includes(instanceId);
      const newTargets = pendingAllowsDuplicateTargets
        ? [...selectedTargets, instanceId]
        : isAlreadySelected
          ? selectedTargets.filter((id) => id !== instanceId)
          : selectedTargets.length >= pendingMaxCount &&
              pendingTargetGroups.length > 0
            ? (rebalanceTargetGroupsWithCandidate(
                selectedTargets,
                instanceId,
                pendingTargetGroups
              ) ?? [...selectedTargets, instanceId])
            : [...selectedTargets, instanceId];

      // 上限超過チェック (max を超える追加は弾く)
      if (
        (pendingAllowsDuplicateTargets || !isAlreadySelected) &&
        newTargets.length > pendingMaxCount
      ) {
        showMessage(`対象は最大 ${pendingMaxCount} 体までです`);
        return;
      }

      setSelectedTargets(newTargets);

      // 固定数選択 (max == required): 必要数到達で自動確定 (既存挙動維持)
      // 可変選択 (max > required): 「確定」ボタン押下を待つ
      if (
        !pendingIsVariableSelect &&
        !pendingHasRevealedCandidates &&
        newTargets.length >= pendingRequiredCount &&
        satisfiesSelectionTargetGroups(
          newTargets,
          pendingTargetGroups,
          pendingAllowsDuplicateTargets
        )
      ) {
        applyTargetSelection(newTargets);
      }
    },
    [
      pendingAction,
      selectedTargets,
      pendingRequiredCount,
      cardSelection,
      pendingMaxCount,
      pendingAllowsDuplicateTargets,
      pendingIsVariableSelect,
      pendingHasRevealedCandidates,
      pendingTargetGroups,
      state,
      getDefinition,
      actions,
      effectLookups,
      setStateAndSync,
      applyTargetSelection,
    ]
  );

  const cancelTargetSelection = useCallback(() => {
    setPendingAction(null);
    setSelectedTargets([]);
    showMessage("対象選択キャンセル");
  }, []);

  // コア移動モード — P3-49 explicit 2-phase grab→place UX。
  // Phase 1: 移動元を tap して `coreSelection.heldCores` に積む (同一ソース複数 grab 可)。
  // Phase 1 主ボタン「コアを置く」→ `enterPlacePhase()` で Phase 2 へ遷移。
  // Phase 2: 移動先を tap して held buffer から 1 件 pop + DraftCoreMove を追加。
  // Phase 2 で全 held を置き切ると主ボタン「完了」が enabled。
  const handleCoreMoveClick = useCallback(
    (locationId: string) => {
      // locationId = instanceId or "reserve"
      // P3-90: 独立コア管理カードは手動コア移動の source / destination 不可。
      // 視覚的にも `.ac-selectable` を外しているが、誤タップ時の二重ガードとして
      // ここでも no-op にして不正 draft（from / to 違反）の生成を防ぐ。
      if (coreMoveBlockedIds.has(locationId)) return;
      if (coreSelection.phase === 1) {
        // ── Phase 1: grab from source ─────────────────────
        // ソウルコアがある場所なら確認ダイアログを出す (held / draft 両方を考慮)。
        const player = state.players.find((p) => p.id === viewingPlayer);
        // held buffer に既に含まれていれば「持ち上げ済み」扱い (二重 grab 防止)。
        const soulHeld = coreSelection.heldCores.some(
          (h) =>
            h.kind === "soul" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "trash" && locationId === "trash") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        );
        const soulMovedAway = coreMoveTransfers.some(
          (t) => t.soul && t.from === locationId
        );
        const soulMovedHere = coreMoveTransfers.some(
          (t) => t.soul && t.to === locationId
        );
        const realSoulHere =
          (locationId === "reserve" &&
            player?.soulCoreLocation?.kind === "reserve") ||
          (locationId !== "reserve" &&
            player?.soulCoreLocation?.kind === "card" &&
            player.soulCoreLocation.instanceId === locationId);
        const hasSoulHere =
          (realSoulHere && !soulMovedAway && !soulHeld) || soulMovedHere;
        if (hasSoulHere) {
          grabSoulOrConfirm(locationId, "core_move");
          return;
        }
        // Normal core grab — same source can be tapped multiple times until source is empty.
        const heldFromHere = coreSelection.heldCores.filter(
          (h) =>
            h.kind === "normal" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        ).length;
        const sourceNormal =
          locationId === "reserve"
            ? (player?.reserveNormalCoreCount ?? 0)
            : (state.cardInstances.find((c) => c.instanceId === locationId)
                ?.normalCoreCount ?? 0);
        if (heldFromHere >= sourceNormal) {
          // すでに上限まで grab 済 — silent no-op で誤連打吸収。
          return;
        }
        coreSelection.addHeldCore({
          kind: "normal",
          from: locationIdToNormalContainer(locationId, viewingPlayer),
        });
        return;
      }

      // ── Phase 2: place onto destination ────────────────
      if (coreSelection.heldCores.length === 0) return;
      const popped = coreSelection.takeHeldCore();
      if (!popped) return;
      if (popped.kind === "soul") {
        coreSelection.addMove({
          kind: "soul",
          playerId: viewingPlayer,
          from: popped.from as ReturnType<typeof locationIdToSoulContainer>,
          to: locationIdToSoulContainer(locationId, viewingPlayer),
          purpose: "core_move",
        });
      } else {
        coreSelection.addMove({
          kind: "normal",
          from: popped.from as ReturnType<typeof locationIdToNormalContainer>,
          to: locationIdToNormalContainer(locationId, viewingPlayer),
          amount: 1,
          purpose: "core_move",
        });
      }
    },
    [
      coreSelection,
      coreMoveTransfers,
      state,
      viewingPlayer,
      coreMoveBlockedIds,
      grabSoulOrConfirm,
    ]
  );

  const exitCoreMoveMode = useCallback(() => {
    // 仮想移動を一括反映 (facade.draftMoves から applyDraftCoreMoves で再生)
    const drafts = coreSelection.draftMoves;
    if (drafts.length > 0) {
      // 二重送信ガード: 既に core-move dispatch が in-flight なら無視 (連打防止)。
      if (specialDispatchInFlightRef.current) return;
      try {
        const violation = findManualCoreMoveViolation(
          state,
          drafts,
          getDefinition
        );
        if (violation) {
          showMessage(
            `コア移動不可: ${userFacingError(violation.reason, "このコアは移動できません")}`
          );
          return;
        }
        let newState = applyDraftCoreMoves(state, drafts, getDefinition);
        // state-based action: 維持コア不足 → 消滅
        const sbaResult = runStateBasedActions(newState, getDefinition);
        if (sbaResult.checks.length > 0) {
          newState = flushPendingLeaves(sbaResult.state, getDefinition);
        }
        // コア移動でレベル/盤面状態が変わると continuous 効果の applicability /
        // condition が変化しうるため、CE を動的再評価する。
        // 例: ルーミア BSTH01-C04 を Lv1 召喚 → コア追加で Lv2 になると
        // applicability.level={min:2} を新たに満たし symbol_addition CE が登録される。
        newState = recomputeAndRebuildContinuousEffects(
          newState,
          getDefinition
        );
        // P3-64 Phase B-5: room モードでは drafts を server に送信し、server-side で
        // applyDraftCoreMoves + SBA + recompute CE を再実行。ローカル newState は
        // optimistic UI 更新用 (SSE で確定値が echo される)。
        setState(newState);
        if (roomId) {
          specialDispatchInFlightRef.current = true;
          const queued = queueRoomSpecialMutation(
            roomSpecialDispatchSignature("core-move", {
              coreMoveDrafts: drafts,
            }),
            async () => {
              try {
                return await dispatchCoreMove(drafts);
              } finally {
                specialDispatchInFlightRef.current = false;
              }
            },
            () => {
              specialDispatchInFlightRef.current = false;
            }
          );
          if (!queued) {
            specialDispatchInFlightRef.current = false;
          }
        } else {
          pushState(newState);
        }
      } catch (e) {
        console.error("コア移動反映エラー:", e);
      }
    }

    setCoreMoveFrom(null);
    setSoulCoreConfirm(null);
    coreSelection.end();
  }, [
    state,
    getDefinition,
    coreSelection,
    roomId,
    dispatchCoreMove,
    queueRoomSpecialMutation,
    pushState,
    setState,
  ]);

  // P3-46 sub-step 3: cost payment 1 個追加 / soul 追加を facade.addMove に集約。
  // - kind === "normal": 通常コア 1 個 → trash
  // - kind === "soul" + reserve: リザーブからソウル → trash
  // - kind === "soul" + card: 場のカードからソウル → trash
  const addCardCostMove = useCallback(
    (kind: "normal" | "soul", from: "reserve" | string /* instanceId */) => {
      const destination =
        from === "reserve"
          ? "trash"
          : (pendingCostPayment?.fieldSources.find(
              (source) => source.instanceId === from && !source.soulCoreOnly
            )?.destination ??
            pendingCostPayment?.fieldSources.find(
              (source) => source.instanceId === from
            )?.destination ??
            "trash");
      if (kind === "normal") {
        if (remainingNormalAt(from) <= 0) return;
        coreSelection.addMove({
          kind: "normal",
          purpose: "card_cost",
          from: locationIdToNormalContainer(from, viewingPlayer),
          to: { kind: destination, playerId: viewingPlayer },
          amount: 1,
        });
      } else {
        coreSelection.addMove({
          kind: "soul",
          purpose: "card_cost",
          playerId: viewingPlayer,
          from: locationIdToSoulContainer(from, viewingPlayer),
          to: { kind: destination, playerId: viewingPlayer },
        });
      }
    },
    [coreSelection, pendingCostPayment, viewingPlayer, remainingNormalAt]
  );

  // タップ式コア操作ハンドラ: コスト支払い / コア配置 / コアシュート
  // any_movable コア配分 (フランドール【フォーオブアカインド】等) で grab 可能な
  // ソウルコア source location。複数ソウル環境では source ごとの残数を見る。
  // Phase 1 grab のソウル確認ダイアログ判定と、ソース tappable 判定の両方で使う。
  const anyMovableSoulSourceIds = useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    const dist = displayState.pendingCoreDistribution;
    if (!dist || dist.fromKind !== "any_movable" || !dist.hasSoulCore)
      return ids;
    if (requiresCoreDistributionTargetTotals(dist)) return ids;
    const heldBySource = new Map<string, number>();
    for (const h of coreSelection.grabbedCores) {
      if (h.kind !== "soul") continue;
      const key =
        h.from.kind === "reserve" ||
        h.from.kind === "trash" ||
        h.from.kind === "life"
          ? h.from.kind
          : h.from.kind === "card"
            ? `field:${h.from.instanceId}`
            : null;
      if (!key) continue;
      heldBySource.set(key, (heldBySource.get(key) ?? 0) + 1);
    }
    if (dist.soulSourceAvailable) {
      for (const [key, count] of Object.entries(dist.soulSourceAvailable)) {
        if (count - (heldBySource.get(key) ?? 0) <= 0) continue;
        ids.add(key.startsWith("field:") ? key.slice("field:".length) : key);
      }
      return ids;
    }
    if (coreSelection.grabbedCores.some((h) => h.kind === "soul")) return ids;
    const soulLoc = state.players.find(
      (p) => p.id === viewingPlayer
    )?.soulCoreLocation;
    switch (soulLoc?.kind) {
      case "reserve":
        ids.add("reserve");
        return ids;
      case "trash":
        ids.add("trash");
        return ids;
      case "life":
        ids.add("life");
        return ids;
      case "card":
        ids.add(soulLoc.instanceId);
        return ids;
      default:
        return ids;
    }
  }, [
    displayState.pendingCoreDistribution,
    state.players,
    viewingPlayer,
    coreSelection.grabbedCores,
  ]);

  const confirmOptionalRepeatCountSelection = useCallback(
    (value?: number) => {
      const pending = displayState.pendingEffectOptionalRepeatCountSelection;
      const action = optionalRepeatCountAction;
      if (!pending || !action) return;
      const selectedCount =
        typeof value === "number" ? value : optionalRepeatCountDraftTotal;
      if (selectedCount < pending.min || selectedCount > pending.max) {
        showMessage(
          `追加回数は ${pending.min}〜${pending.max} 回で選択してください`
        );
        return;
      }
      try {
        const payload = { countDecreaseSelection: selectedCount };
        const result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          ...payload,
        });
        if (pending.selectionMode === "count_decrease") {
          coreSelection.end();
        }
        setStateAndSync(result.state, action, payload);
        showMessage(
          pending.selectionMode === "count_decrease"
            ? `追加カウント ${selectedCount}`
            : `追加発揮 ${selectedCount}回`
        );
      } catch (e) {
        console.error("Optional repeat count selection failed:", e);
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    },
    [
      displayState.pendingEffectOptionalRepeatCountSelection,
      optionalRepeatCountAction,
      optionalRepeatCountDraftTotal,
      state,
      getDefinition,
      effectLookups,
      coreSelection,
      setStateAndSync,
    ]
  );

  const getCoreSplitDestinationIndexForTap = useCallback(
    (locationId: string): number | null => {
      const pending = displayState.pendingCoreSplitSelection;
      if (!pending) return null;
      for (let index = 0; index < pending.destinations.length; index++) {
        const dest = pending.destinations[index]!;
        const selected = coreSplitDistribution[index] ?? 0;
        if (selected >= (dest.cap ?? pending.totalAmount)) continue;
        const location = dest.location;
        switch (location.kind) {
          case "reserve":
          case "trash":
          case "life":
          case "void":
            if (locationId !== location.kind) break;
            if (
              resolvePlayerRef(
                pending.actingPlayerId,
                location.player,
                state
              ) !== viewingPlayer
            )
              break;
            return index;
          case "card_instance":
            if (locationId === location.instanceId) return index;
            break;
          case "this_card":
            if (locationId === pending.sourceInstanceId) return index;
            break;
          case "field":
          case "field_card": {
            const card = state.cardInstances.find(
              (candidate) => candidate.instanceId === locationId
            );
            if (!card || card.zone !== "field") break;
            const playerId = resolvePlayerRef(
              pending.actingPlayerId,
              location.player,
              state
            );
            if (card.controllerPlayerId !== playerId) break;
            const def = getDefinition(card.definitionId);
            if (!def) break;
            const filter =
              location.kind === "field_card"
                ? location.filter
                : (location.filter ?? {});
            if (matchesCardFilter(card, def, filter, { state })) return index;
            break;
          }
          default:
            break;
        }
      }
      return null;
    },
    [
      displayState.pendingCoreSplitSelection,
      coreSplitDistribution,
      state,
      viewingPlayer,
      getDefinition,
    ]
  );

  const confirmCoreSplitSelection = useCallback(() => {
    const pending = displayState.pendingCoreSplitSelection;
    const action = coreSplitAction;
    if (!pending || !action) return;
    if (!coreSplitValid) {
      showMessage(`コアを${pending.totalAmount}個配分してください`);
      return;
    }
    const payload = {
      coreSplitDistribution: Array.from(coreSplitDistribution),
    };
    try {
      const result = applyLegalAction({
        state,
        action,
        getCardDefinitionById: getDefinition,
        ...effectLookups,
        ...payload,
      });
      coreSelection.end();
      setStateAndSync(result.state, action, payload);
      showMessage("コア配分を確定");
    } catch (e) {
      console.error("CoreSplit action failed:", e);
      showMessage(`エラー: ${userFacingError(e)}`);
    }
  }, [
    displayState.pendingCoreSplitSelection,
    coreSplitAction,
    coreSplitValid,
    coreSplitDistribution,
    state,
    getDefinition,
    effectLookups,
    coreSelection,
    setStateAndSync,
  ]);

  const pendingCoreHud = buildPendingCoreHud(displayState, myActions);
  const pendingCoreControls = usePendingCoreHud(
    pendingCoreHud,
    coreSelection,
    ({ action, payload }) => {
      try {
        // ルーム表示のpendingは非公開の継続情報を含まないため、サーバーで確定する。
        if (roomId) {
          coreSelection.end();
          setStateAndSync(state, action, payload);
          return;
        }
        const result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          ...payload,
        });
        coreSelection.end();
        setStateAndSync(result.state, action, payload);
      } catch (error) {
        showMessage("コア選択失敗: " + userFacingError(error));
      }
    },
    replayState
  );

  const handleCoreTapClick = useCallback(
    (locationId: string) => {
      if (pendingCoreHud) {
        pendingCoreControls.tap(locationId);
        return;
      }
      const player = state.players.find((p) => p.id === viewingPlayer);

      if (
        displayState.pendingEffectOptionalRepeatCountSelection
          ?.selectionMode === "count_decrease"
      ) {
        const pending = displayState.pendingEffectOptionalRepeatCountSelection;
        if (locationId !== "count_area") return;
        if (optionalRepeatCountDraftTotal >= pending.max) return;
        coreSelection.addMove({
          kind: "normal",
          purpose: "count_decrease",
          from: { kind: "void", playerId: viewingPlayer },
          to: { kind: "void", playerId: viewingPlayer },
          amount: 1,
        });
        return;
      }

      if (displayState.pendingCoreSplitSelection) {
        const pending = displayState.pendingCoreSplitSelection;
        const destinationIndex = getCoreSplitDestinationIndexForTap(locationId);
        if (destinationIndex === null) return;
        if (coreSplitSelectedTotal >= pending.totalAmount) return;
        const dest = pending.destinations[destinationIndex]!;
        if (
          (coreSplitDistribution[destinationIndex] ?? 0) >=
          (dest.cap ?? pending.totalAmount)
        )
          return;
        const from = effectCoreLocationToNormalContainer(
          pending.fromLocation,
          state,
          pending.actingPlayerId,
          pending.sourceInstanceId
        ) ?? { kind: "void", playerId: pending.actingPlayerId };
        const to =
          effectCoreLocationToNormalContainer(
            dest.location,
            state,
            pending.actingPlayerId,
            pending.sourceInstanceId
          ) ??
          (coreSplitDestinationIsField(dest.location)
            ? { kind: "card", instanceId: locationId }
            : { kind: "void", playerId: pending.actingPlayerId });
        coreSelection.addMove({
          kind: "normal",
          purpose: "core_split",
          from,
          to,
          amount: 1,
          coreSplitDestinationIndex: destinationIndex,
        });
        return;
      }

      // --- コスト支払いモード ---
      if (pendingCostPayment) {
        if (costPaymentTappedTotal >= pendingCostPayment.finalCost) return;
        if (locationId === "reserve") {
          // ソウルコアチェック
          const hasSoulInReserve = player?.soulCoreLocation?.kind === "reserve";
          if (
            hasSoulInReserve &&
            !costPayUseSoul &&
            !declinedSoulLocations.has("reserve")
          ) {
            if (remainingNormalAt("reserve") <= 0)
              addCardCostMove("soul", "reserve");
            else {
              setSoulCoreConfirm("reserve");
              setSoulCoreConfirmMode("cost_payment");
            }
            return;
          }
          // リザーブから通常コア 1 個 → trash
          addCardCostMove("normal", "reserve");
          return;
        }
        // フィールドカードからコスト支払い
        const source = pendingCostPayment.fieldSources.find(
          (s) => s.instanceId === locationId
        );
        if (!source) return;
        // 既に上限まで取得済みなら無視
        const currentAmount = costPaymentCardAmounts[locationId] ?? 0;
        const otherFieldTotal = Object.entries(costPaymentCardAmounts)
          .filter(([id]) => id !== locationId && id !== "reserve")
          .reduce((s, [, a]) => s + a, 0);
        const reserveAmount = costPaymentCardAmounts["reserve"] ?? 0;
        const maxForThis = Math.min(
          source.maxAmount,
          pendingCostPayment.finalCost - otherFieldTotal - reserveAmount
        );
        if (currentAmount >= maxForThis) return;
        // ソウルコアチェック
        const hasSoulHere =
          player?.soulCoreLocation?.kind === "card" &&
          player.soulCoreLocation.instanceId === locationId;
        // ソウルコアがある場所 → 確認（まだ選択/辞退していなければ）
        if (
          hasSoulHere &&
          !costPayUseSoul &&
          !declinedSoulLocations.has(locationId)
        ) {
          // 通常コアが無いソウル専用カードは「いいえ」を選ぶ余地が無いため
          // ダイアログを出さず自動的に「はい」相当として処理する
          if (remainingNormalAt(locationId) <= 0) {
            addCardCostMove("soul", locationId);
            return;
          }
          setSoulCoreConfirm(locationId);
          setSoulCoreConfirmMode("cost_payment");
          return;
        }
        addCardCostMove("normal", locationId);
        return;
      }

      // --- コア配置モード ---
      if (pendingPlacement) {
        const destId = pendingPlacement.destinationInstanceId;
        if (locationId === "reserve") {
          // ソウルコアチェック（コスト支払いでソウルコアを使った場合は hasSoulInReserve=false）
          // ソウルコアがある → 確認（まだ選択/辞退していなければ）
          if (
            pendingPlacement.hasSoulInReserve &&
            !summonUseSoul &&
            !declinedSoulLocations.has("reserve")
          ) {
            if (remainingNormalAt("reserve") <= 0) {
              coreSelection.addMove({
                kind: "soul",
                purpose: "placement",
                playerId: viewingPlayer,
                from: locationIdToSoulContainer("reserve", viewingPlayer),
                to: { kind: "card", instanceId: destId },
              });
            } else {
              setSoulCoreConfirm("reserve");
              setSoulCoreConfirmMode("placement");
            }
            return;
          }
          if (placementReserveNormalTaken >= pendingPlacement.maxReserveCores)
            return;
          coreSelection.addMove({
            kind: "normal",
            purpose: "placement",
            from: { kind: "reserve", playerId: viewingPlayer },
            to: { kind: "card", instanceId: destId },
            amount: 1,
          });
          return;
        }
        // フィールドカードからコア配置
        const source = pendingPlacement.fieldSources.find(
          (s) => s.instanceId === locationId
        );
        if (!source) return;
        const sourceSelected =
          (placementFieldNormalTaken[locationId] ?? 0) +
          placementDrafts.filter(
            (d) =>
              d.kind === "soul" &&
              d.from.kind === "card" &&
              d.from.instanceId === locationId
          ).length;
        if (sourceSelected >= source.maxTotalAmount) return;
        // ソウルコアチェック
        // コスト支払いで既にこのカードのソウルを使っている場合は仮想的に消費済み
        // （rules-core への適用はまだだが UI 上はソウルが居ない前提で扱う）
        // sub-step 3: priorSoulCoreSource を card_cost soul draft から派生
        const soulAlreadyUsedFromHere =
          costPayUseSoul && costPaySoulSource === locationId;
        const hasSoulHere =
          source.hasSoul &&
          !soulAlreadyUsedFromHere &&
          player?.soulCoreLocation?.kind === "card" &&
          player.soulCoreLocation.instanceId === locationId;
        // ソウルコアがある → 確認（まだ選択/辞退していなければ）
        if (
          hasSoulHere &&
          !summonUseSoul &&
          !declinedSoulLocations.has(locationId)
        ) {
          if (remainingNormalAt(locationId) <= 0) {
            coreSelection.addMove({
              kind: "soul",
              purpose: "placement",
              playerId: viewingPlayer,
              from: locationIdToSoulContainer(locationId, viewingPlayer),
              to: { kind: "card", instanceId: destId },
            });
          } else {
            setSoulCoreConfirm(locationId);
            setSoulCoreConfirmMode("placement");
          }
          return;
        }
        // 通常コアは maxAmount (通常コア数) を超えない範囲でのみ配置可能。
        // ソウルコアは上の確認ダイアログで別枠処理されるため maxAmount に含めない。
        if ((placementFieldNormalTaken[locationId] ?? 0) >= source.maxAmount)
          return;
        coreSelection.addMove({
          kind: "normal",
          purpose: "placement",
          from: { kind: "card", instanceId: locationId },
          to: { kind: "card", instanceId: destId },
          amount: 1,
        });
        return;
      }

      // --- コアシュートモード ---
      if (pendingCoreShoot) {
        const candidate = pendingCoreShoot.candidates.find(
          (c) => c.instanceId === locationId
        );
        if (!candidate) return;
        const taken = coreShootCardAmounts[locationId] ?? 0;
        const remaining = candidate.availableCores - taken;
        if (remaining <= 0 || coreShootTotal >= pendingCoreShoot.totalAmount)
          return;

        const shootPending = displayState.pendingCoreShootSelection;
        const canChooseKind = shootPending?.fromPlayerId === viewingPlayer;
        const soulAllowed =
          (!shootPending ||
            shootPending.fromPlayerId === shootPending.toPlayerId) &&
          coreShootSoulDestinationAllowed(shootPending?.toKind ?? "reserve");
        // フィールド/リザーブ横断 (BSTH001-X01): reserve sentinel 候補は
        // リザーブ通常コア1個を shoot draft に積む (ソウルは対象外: to=void)。
        if (candidate.isReserve) {
          const reservePlayerId = locationId.slice("reserve:".length);
          const sourcePlayer = state.players.find(
            (p) => p.id === reservePlayerId
          );
          if (
            canChooseKind &&
            soulAllowed &&
            taken < (sourcePlayer?.reserveNormalCoreCount ?? 0) &&
            getCoreShootSoulSourceId(sourcePlayer) === locationId &&
            !coreShootSoulInstanceId &&
            !declinedSoulLocations.has(locationId)
          ) {
            setSoulCoreConfirm(locationId);
            setSoulCoreConfirmMode("core_shoot");
            return;
          }
          if (taken >= (sourcePlayer?.reserveNormalCoreCount ?? 0)) {
            if (
              getCoreShootSoulSourceId(sourcePlayer) === locationId &&
              !coreShootSoulInstanceId &&
              soulAllowed
            ) {
              coreSelection.addMove({
                kind: "soul",
                playerId: reservePlayerId,
                from: { kind: "reserve", playerId: reservePlayerId },
                to: { kind: "void", playerId: viewingPlayer },
                purpose: "shoot",
              });
            }
            return;
          }
          coreSelection.addMove({
            kind: "normal",
            from: { kind: "reserve", playerId: reservePlayerId },
            to: { kind: "void", playerId: viewingPlayer },
            amount: 1,
            purpose: "shoot",
          });
          return;
        }

        // ソウルコアチェック（相手のカード上のソウルコア）
        const opponentId = state.players.find(
          (p) => p.id !== viewingPlayer
        )?.id;
        const sourcePlayer = state.players.find(
          (p) => p.id === (shootPending?.fromPlayerId ?? opponentId)
        );
        const hasSoulHere =
          getCoreShootSoulSourceId(sourcePlayer) === locationId;
        const card = state.cardInstances.find(
          (c) => c.instanceId === locationId
        );
        const normalCores = isNormalCoreMovePrevented(state, locationId)
          ? 0
          : (card?.normalCoreCount ?? 0);

        // 効果側は個数だけを指定する。内訳の選択肢があれば、確定後に持ち主へ渡す。
        // ただし移動先がボイドなどソウル不可の場合はスキップ
        // P3-79: displayState 経由 (相手の pending では UI 反応しない)。
        if (
          canChooseKind &&
          soulAllowed &&
          hasSoulHere &&
          normalCores > taken &&
          !coreShootSoulInstanceId &&
          !declinedSoulLocations.has(locationId)
        ) {
          setSoulCoreConfirm(locationId);
          setSoulCoreConfirmMode("core_shoot");
          return;
        }
        const soulDestBlocked = !soulAllowed;
        if (normalCores <= taken) {
          if (
            hasSoulHere &&
            !coreShootSoulInstanceId &&
            !declinedSoulLocations.has(locationId) &&
            !soulDestBlocked
          ) {
            coreSelection.addMove({
              kind: "soul",
              playerId: sourcePlayer!.id,
              from: { kind: "card", instanceId: locationId },
              to: { kind: "void", playerId: viewingPlayer },
              purpose: "shoot",
            });
          }
          return;
        }

        // shoot draft の `to` は recompose では参照されない (engine 側 pending の
        // toKind で実際の destination が決まる)。preview 用に `void` を仮置き。
        coreSelection.addMove({
          kind: "normal",
          from: { kind: "card", instanceId: locationId },
          to: { kind: "void", playerId: viewingPlayer },
          amount: 1,
          purpose: "shoot",
        });
        return;
      }

      // --- 分離コア移動モード — P3-49 explicit 2-phase grab→place UX ---
      // Phase 1: 自分 field カード / reserve を tap → held buffer に積む。
      //          ソウルコアが居る場所はまず soulCoreConfirm dialog を経由。
      // Phase 2: ブレイヴ本体 (braveInstanceId) を tap → held から 1 件 pop して
      //          `purpose: "separation"` の DraftCoreMove を生成。
      if (pendingSeparation) {
        const braveInstanceId = pendingSeparation.braveInstanceId;

        if (coreSelection.phase === 2) {
          // Phase 2: place onto brave host
          if (locationId !== braveInstanceId) return;
          if (coreSelection.heldCores.length === 0) return;
          const popped = coreSelection.takeHeldCore();
          if (!popped) return;
          if (popped.kind === "soul") {
            coreSelection.addMove({
              kind: "soul",
              playerId: viewingPlayer,
              from: popped.from as ReturnType<typeof locationIdToSoulContainer>,
              to: { kind: "card", instanceId: braveInstanceId },
              purpose: "separation",
            });
          } else {
            coreSelection.addMove({
              kind: "normal",
              from: popped.from as ReturnType<
                typeof locationIdToNormalContainer
              >,
              to: { kind: "card", instanceId: braveInstanceId },
              amount: 1,
              purpose: "separation",
            });
          }
          return;
        }

        // Phase 1: grab from source — held buffer 経由
        if (locationId === braveInstanceId) return;
        const soulHeld = coreSelection.grabbedCores.some(
          (h) =>
            h.kind === "soul" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "trash" && locationId === "trash") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        );
        const heldNormalFromHere = coreSelection.grabbedCores.filter(
          (h) =>
            h.kind === "normal" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        ).length;

        if (locationId === "reserve") {
          const normalReserve = player?.reserveNormalCoreCount ?? 0;
          const hasSoulInReserve = player?.soulCoreLocation?.kind === "reserve";
          if (heldNormalFromHere >= normalReserve) {
            // 通常コアが尽きた → ソウルコア確認 (まだ辞退・grab 済みでなければ)
            if (
              hasSoulInReserve &&
              !soulHeld &&
              !declinedSoulLocations.has("reserve")
            ) {
              grabSoulOrConfirm("reserve", "placement");
              return;
            }
            return;
          }
          // ソウルコアがある → 確認 (未辞退 / 未 grab のみ)
          if (
            hasSoulInReserve &&
            !soulHeld &&
            !declinedSoulLocations.has("reserve")
          ) {
            grabSoulOrConfirm("reserve", "placement");
            return;
          }
          coreSelection.addHeldCore({
            kind: "normal",
            from: { kind: "reserve", playerId: viewingPlayer },
          });
          return;
        }
        // フィールドカードからコア
        const card = state.cardInstances.find(
          (c) => c.instanceId === locationId
        );
        if (
          !card ||
          card.controllerPlayerId !== viewingPlayer ||
          card.zone !== "field" ||
          card.instanceId === braveInstanceId ||
          !canMoveCoresFrom(state, card, getDefinition(card.definitionId))
        ) {
          return;
        }
        const hasSoulHere =
          player?.soulCoreLocation?.kind === "card" &&
          player.soulCoreLocation.instanceId === locationId;
        if (
          hasSoulHere &&
          !soulHeld &&
          !declinedSoulLocations.has(locationId)
        ) {
          grabSoulOrConfirm(locationId, "placement");
          return;
        }
        if (heldNormalFromHere >= card.normalCoreCount) return;
        coreSelection.addHeldCore({
          kind: "normal",
          from: { kind: "card", instanceId: locationId },
        });
        return;
      }

      // --- P3-49 placement_multi: 複数体同時召喚 per-target 配置 ---
      // Phase 1: 自分 field カード / reserve を tap → held buffer に積む。
      // Phase 2: pending.targets[].instanceId のいずれかを tap → held から 1 件 pop して
      //          `purpose: "placement"` の DraftCoreMove (to=target) を生成。
      // P3-79: displayState 経由 (相手の pending では UI 反応しない)。
      if (displayState.pendingMultiPlacement) {
        const mp = displayState.pendingMultiPlacement;
        const fixedTarget = coreSelection.fixedDestination
          ? mp.targets[0]
          : undefined;
        if (
          fixedTarget?.maximumCoreCount != null &&
          (multiPlacementPerTargetTotal[fixedTarget.instanceId] ?? 0) >=
            fixedTarget.maximumCoreCount
        )
          return;
        const targetIds = new Set(mp.targets.map((t) => t.instanceId));

        if (coreSelection.phase === 2) {
          // Phase 2: place onto target — held から FIFO pop
          if (!targetIds.has(locationId)) return;
          // target 単位の max は maximumCoreCount で制限
          const target = mp.targets.find((t) => t.instanceId === locationId)!;
          const placedHere = multiPlacementPerTargetTotal[locationId] ?? 0;
          if (
            target.maximumCoreCount !== null &&
            placedHere >= target.maximumCoreCount
          ) {
            return;
          }
          if (coreSelection.heldCores.length === 0) return;
          const nextHeld = coreSelection.heldCores[0];
          if (nextHeld?.kind === "normal" && nextHeld.from.kind === "void") {
            const placedVoidHere =
              multiPlacementVoidNormalByTarget[locationId] ?? 0;
            if (placedVoidHere >= (target.voidNormalCoreMax ?? 0)) {
              return;
            }
          }
          const popped = coreSelection.takeHeldCore();
          if (!popped) return;
          if (popped.kind === "soul") {
            coreSelection.addMove({
              kind: "soul",
              playerId: viewingPlayer,
              from: popped.from as ReturnType<typeof locationIdToSoulContainer>,
              to: { kind: "card", instanceId: locationId },
              purpose: "placement",
            });
          } else {
            coreSelection.addMove({
              kind: "normal",
              from: popped.from as ReturnType<
                typeof locationIdToNormalContainer
              >,
              to: { kind: "card", instanceId: locationId },
              amount: 1,
              purpose: "placement",
            });
          }
          return;
        }

        // Phase 1: grab from source — target 自身は tap しない
        if (targetIds.has(locationId)) return;
        const soulHeld = coreSelection.grabbedCores.some(
          (h) =>
            h.kind === "soul" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "trash" && locationId === "trash") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        );
        const heldNormalFromHere = coreSelection.heldCores.filter(
          (h) =>
            h.kind === "normal" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "trash" && locationId === "trash") ||
              (h.from.kind === "void" && locationId === "void") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        ).length;

        const selectedNormalFromHere = coreSelection.grabbedCores.filter(
          (h) =>
            h.kind === "normal" &&
            ((h.from.kind === "reserve" && locationId === "reserve") ||
              (h.from.kind === "card" && h.from.instanceId === locationId))
        ).length;

        if (locationId === "trash") {
          const trashNormalCoreMax = mp.trashNormalCoreMax ?? 0;
          const trashCoreMax = mp.trashCoreMax ?? 0;
          const availableTrash = player?.trashNormalCoreCount ?? 0;
          const heldTrashSoul = coreSelection.heldCores.filter(
            (h) => h.kind === "soul" && h.from.kind === "trash"
          ).length;
          const trashCoreUsed =
            multiPlacementTrashNormalTotal +
            multiPlacementTrashSoulTotal +
            heldNormalFromHere +
            heldTrashSoul;
          const trashCoreLimit = trashNormalCoreMax + trashCoreMax;
          const hasSoulInTrash = (player?.trashSoulCoreCount ?? 0) > 0;
          if (
            trashCoreMax > 0 &&
            hasSoulInTrash &&
            !soulHeld &&
            !declinedSoulLocations.has("trash") &&
            trashCoreUsed < trashCoreLimit
          ) {
            grabSoulOrConfirm("trash", "placement");
            return;
          }
          const selectableTrash = Math.min(
            trashNormalCoreMax + trashCoreMax,
            availableTrash
          );
          if (
            trashCoreLimit <= 0 ||
            trashCoreUsed >= trashCoreLimit ||
            multiPlacementTrashNormalTotal + heldNormalFromHere >=
              selectableTrash
          ) {
            return;
          }
          coreSelection.addHeldCore({
            kind: "normal",
            from: { kind: "trash", playerId: viewingPlayer },
          });
          return;
        }

        if (locationId === "void") {
          const voidNormalCoreMax = mp.targets.reduce(
            (sum, target) => sum + (target.voidNormalCoreMax ?? 0),
            0
          );
          const availableVoid = player?.voidNormalCoreCount ?? 0;
          const selectableVoid = Math.min(voidNormalCoreMax, availableVoid);
          if (
            voidNormalCoreMax <= 0 ||
            multiPlacementVoidNormalTotal + heldNormalFromHere >= selectableVoid
          ) {
            return;
          }
          coreSelection.addHeldCore({
            kind: "normal",
            from: { kind: "void", playerId: viewingPlayer },
          });
          return;
        }

        if (locationId === "reserve") {
          const normalReserve = player?.reserveNormalCoreCount ?? 0;
          const hasSoulInReserve = player?.soulCoreLocation?.kind === "reserve";
          if (selectedNormalFromHere >= normalReserve) {
            if (
              hasSoulInReserve &&
              !soulHeld &&
              !declinedSoulLocations.has("reserve")
            ) {
              grabSoulOrConfirm("reserve", "placement");
              return;
            }
            return;
          }
          if (
            hasSoulInReserve &&
            !soulHeld &&
            !declinedSoulLocations.has("reserve")
          ) {
            grabSoulOrConfirm("reserve", "placement");
            return;
          }
          coreSelection.addHeldCore({
            kind: "normal",
            from: { kind: "reserve", playerId: viewingPlayer },
          });
          return;
        }
        const source = multiPlacementFieldSources.find(
          (candidate) => candidate.instanceId === locationId
        );
        if (!source) return;
        const selectedSoulFromHere = coreSelection.grabbedCores.filter(
          (entry) =>
            entry.kind === "soul" &&
            entry.from.kind === "card" &&
            entry.from.instanceId === locationId
        ).length;
        if (
          selectedNormalFromHere + selectedSoulFromHere >=
          source.maxTotalAmount
        )
          return;
        const hasSoulHere = source.hasSoul;
        if (selectedNormalFromHere >= source.maxAmount) {
          if (
            hasSoulHere &&
            !soulHeld &&
            !declinedSoulLocations.has(locationId)
          ) {
            grabSoulOrConfirm(locationId, "placement");
          }
          return;
        }
        if (
          hasSoulHere &&
          !soulHeld &&
          !declinedSoulLocations.has(locationId)
        ) {
          grabSoulOrConfirm(locationId, "placement");
          return;
        }
        coreSelection.addHeldCore({
          kind: "normal",
          from: { kind: "card", instanceId: locationId },
        });
        return;
      }

      // --- トラッシュ→フィールド コア配分モード ---
      // P3-79: displayState 経由 (相手の pending では UI 反応しない)。
      if (displayState.pendingCoreDistribution) {
        const dist = displayState.pendingCoreDistribution;
        const isTargetTotalSelection =
          requiresCoreDistributionTargetTotals(dist);

        // P3-49: any_movable_self (multi-source / multi-dest) を explicit 2-phase
        // grab→place UX に統一。
        // Phase 1: ソース (reserve / trash / life / 自分 field カード) を tap →
        //          held buffer に積む。同一ソースを連打して複数 grab 可能。
        // Phase 2: recipient (face-down candidate) を tap → held から FIFO で
        //          1 件 pop して `purpose: "trash_distribution"` の DraftCoreMove を生成。
        // ソースと recipient の対応は FIFO (任意の組合せでも盤面結果は同じため許容)。
        if (dist.fromKind === "any_movable" && !isTargetTotalSelection) {
          // ソウル確認ダイアログ表示中はカードタップを無視 (はい/いいえ で解決する)。
          if (soulCoreConfirm && soulCoreConfirmMode === "core_distribute")
            return;
          const sourceAvailable = dist.sourceAvailable ?? {};
          const allowedSources = dist.allowedSources ?? [];
          const candidate = dist.candidates.find(
            (c) => c.instanceId === locationId
          );

          if (coreSelection.phase === 2) {
            // Phase 2: tap recipient candidate → pop held + addMove。
            // soul も normal も held buffer から FIFO で pop して配置する (core_move 準拠)。
            if (!candidate) return;
            if (coreSelection.heldCores.length === 0) return;
            if (
              !canAddCoreDistributionCore(
                dist,
                trashDistAllocations,
                trashDistSoulAllocations,
                locationId
              )
            )
              return;
            const popped = coreSelection.takeHeldCore();
            if (!popped) return;
            if (popped.kind === "soul") {
              coreSelection.addMove({
                kind: "soul",
                playerId: viewingPlayer,
                from: popped.from as ReturnType<
                  typeof locationIdToSoulContainer
                >,
                to: { kind: "card", instanceId: locationId },
                purpose: "trash_distribution",
              });
            } else {
              coreSelection.addMove({
                kind: "normal",
                from: popped.from as ReturnType<
                  typeof locationIdToNormalContainer
                >,
                to: { kind: "card", instanceId: locationId },
                amount: 1,
                purpose: "trash_distribution",
              });
            }
            return;
          }

          // Phase 1: tap source → held buffer に積む。recipient タップは無視。
          if (candidate) return;
          // ソウルコアがこのソースにあり未 grab なら確認ダイアログ (core_move 準拠)。
          // soul-only ソース (通常コア 0 で allowedSources に無い) でも grab できるよう、
          // 通常ソース判定より先に評価する。
          if (anyMovableSoulSourceIds.has(locationId)) {
            const sourceKey = ["reserve", "trash", "life"].includes(locationId)
              ? locationId
              : "field:" + locationId;
            const selectedNormal = coreSelection.grabbedCores.filter(
              (h) =>
                h.kind === "normal" &&
                coreContainerId(h.from as NormalCoreContainer) ===
                  coreContainerId(
                    locationIdToNormalContainer(locationId, viewingPlayer)
                  )
            ).length;
            const totalNormal = coreSelection.grabbedCores.filter(
              (h) => h.kind === "normal"
            ).length;
            grabSoulOrConfirm(
              locationId,
              "core_distribute",
              Math.min(
                (dist.sourceAvailable?.[sourceKey] ?? 0) - selectedNormal,
                dist.totalNormalCores - totalNormal
              )
            );
            return;
          }
          const isZoneSource =
            (locationId === "reserve" ||
              locationId === "trash" ||
              locationId === "life") &&
            allowedSources.some((s) => s.kind === locationId);
          const isFieldSource =
            !candidate &&
            allowedSources.some(
              (s) => s.kind === "field" && s.instanceId === locationId
            );
          if (!isZoneSource && !isFieldSource) return;

          // 全 held 合計が dist.totalNormalCores 以上なら no-op (上限到達)
          const totalHeldNormal = coreSelection.grabbedCores.filter(
            (h) => h.kind === "normal"
          ).length;
          if (totalHeldNormal >= dist.totalNormalCores) return;

          // ソース別の held 残量チェック
          const activeKey = isZoneSource ? locationId : `field:${locationId}`;
          const heldFromHere = coreSelection.grabbedCores.filter((h) => {
            if (h.kind !== "normal") return false;
            switch (h.from.kind) {
              case "reserve":
                return activeKey === "reserve";
              case "trash":
                return activeKey === "trash";
              case "life":
                return activeKey === "life";
              case "card":
                return activeKey === `field:${h.from.instanceId}`;
              default:
                return false;
            }
          }).length;
          const availFromActive = sourceAvailable[activeKey] ?? 0;
          if (heldFromHere >= availFromActive) return;

          let chosenFrom:
            | { kind: "reserve"; playerId: string }
            | { kind: "trash"; playerId: string }
            | { kind: "life"; playerId: string }
            | { kind: "card"; instanceId: string };
          if (activeKey === "reserve") {
            chosenFrom = { kind: "reserve", playerId: viewingPlayer };
          } else if (activeKey === "trash") {
            chosenFrom = { kind: "trash", playerId: viewingPlayer };
          } else if (activeKey === "life") {
            chosenFrom = { kind: "life", playerId: viewingPlayer };
          } else {
            chosenFrom = { kind: "card", instanceId: locationId };
          }
          coreSelection.addHeldCore({
            kind: "normal",
            from: chosenFrom,
          });
          return;
        }

        const cand = dist.candidates.find((c) => c.instanceId === locationId);
        if (!cand) return;
        if (
          !isTargetTotalSelection &&
          !canAddCoreDistributionCore(
            dist,
            trashDistAllocations,
            trashDistSoulAllocations,
            locationId
          )
        )
          return;

        if (locationId === "reserve") return;
        const sourceLocationId =
          dist.fromKind === "reserve" ||
          dist.fromKind === "trash" ||
          dist.fromKind === "life" ||
          dist.fromKind === "void"
            ? dist.fromKind
            : "trash";
        // ソウル選択モード: タップで対象へソウルコア 1 個を追加。
        if (trashDistSoulMode && !isTargetTotalSelection) {
          const totalSoulCores =
            dist.totalSoulCores ?? (dist.hasSoulCore ? 1 : 0);
          if (trashDistSoulTotal >= totalSoulCores) {
            setTrashDistSoulMode(false);
            return;
          }
          const soulSource =
            sourceLocationId === "void"
              ? ({ kind: "void", playerId: viewingPlayer } as const)
              : locationIdToSoulContainer(sourceLocationId, viewingPlayer);
          coreSelection.addMove({
            kind: "soul",
            playerId: viewingPlayer,
            from: soulSource,
            to: { kind: "card", instanceId: locationId },
            purpose: "trash_distribution",
          });
          if (trashDistSoulTotal + 1 >= totalSoulCores) {
            setTrashDistSoulMode(false);
          }
          return;
        }
        // 通常モード: 通常コアを 1 個追加 (single-source: trash / reserve / void / life)
        const totalSoulCores =
          dist.totalSoulCores ?? (dist.hasSoulCore ? 1 : 0);
        const currentTargetTotal = isTargetTotalSelection
          ? dist.candidates.reduce((sum, candidate) => {
              const card = state.cardInstances.find(
                (c) => c.instanceId === candidate.instanceId
              );
              return (
                sum + (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0)
              );
            }, 0)
          : 0;
        const distributionLimit = isTargetTotalSelection
          ? currentTargetTotal +
            (dist.maxTotal ?? dist.totalNormalCores + totalSoulCores)
          : dist.totalNormalCores;
        const remaining = distributionLimit - trashDistTotal;
        if (remaining <= 0) return;
        coreSelection.addMove({
          kind: "normal",
          from: isTargetTotalSelection
            ? { kind: "card", instanceId: locationId }
            : locationIdToNormalContainer(sourceLocationId, viewingPlayer),
          to: { kind: "card", instanceId: locationId },
          amount: 1,
          purpose: "trash_distribution",
        });
        return;
      }
    },
    [
      state,
      displayState.pendingEffectOptionalRepeatCountSelection,
      displayState.pendingCoreSplitSelection,
      displayState.pendingCoreDistribution,
      displayState.pendingCoreShootSelection,
      displayState.pendingMultiPlacement,
      viewingPlayer,
      pendingCostPayment,
      pendingPlacement,
      pendingCoreShoot,
      pendingSeparation,
      trashDistSoulMode,
      trashDistTotal,
      trashDistSoulTotal,
      trashDistAllocations,
      trashDistSoulAllocations,
      summonUseSoul,
      costPayUseSoul,
      costPaySoulSource,
      coreShootTotal,
      coreShootCardAmounts,
      coreShootSoulInstanceId,
      addCardCostMove,
      remainingNormalAt,
      grabSoulOrConfirm,
      costPaymentCardAmounts,
      costPaymentTappedTotal,
      declinedSoulLocations,
      placementReserveNormalTaken,
      placementFieldNormalTaken,
      placementDrafts,
      multiPlacementFieldSources,
      multiPlacementPerTargetTotal,
      multiPlacementTrashNormalTotal,
      multiPlacementTrashSoulTotal,
      multiPlacementVoidNormalTotal,
      multiPlacementVoidNormalByTarget,
      coreSelection,
      pendingCoreHud,
      pendingCoreControls,
      optionalRepeatCountDraftTotal,
      coreSplitDistribution,
      coreSplitSelectedTotal,
      getCoreSplitDestinationIndexForTap,
      anyMovableSoulSourceIds,
      soulCoreConfirm,
      soulCoreConfirmMode,
      getDefinition,
    ]
  );

  // タップ式コア操作: タップ可能なカード ID セットとリザーブ可否を計算
  const coreTapMode = pendingCoreHud
    ? ("core_source_allocation" as const)
    : pendingCostPayment
      ? ("cost_payment" as const)
      : pendingPlacement
        ? ("placement" as const)
        : pendingCoreShoot
          ? ("core_shoot" as const)
          : pendingSeparation
            ? ("placement" as const) // 分離もコア配置と同じUI
            : displayState.pendingMultiPlacement
              ? ("placement" as const) // P3-49 multi placement もコア配置と同じUI
              : displayState.pendingCoreDistribution
                ? ("placement" as const) // トラッシュ→フィールド配分もコア配置と同じUI
                : displayState.pendingCoreSplitSelection
                  ? ("core_split" as const)
                  : displayState.pendingEffectOptionalRepeatCountSelection
                        ?.selectionMode === "count_decrease"
                    ? ("count_decrease" as const)
                    : null;

  const coreTapTargetIds = useMemo(() => {
    if (pendingCoreHud) return pendingCoreControls.targetIds;
    const ids = new Set<string>();
    if (pendingCostPayment) {
      for (const source of pendingCostPayment.fieldSources) {
        const currentAmount = costPaymentCardAmounts[source.instanceId] ?? 0;
        if (currentAmount < source.maxAmount) {
          // 全体のフィールド支払い合計が finalCost 未満の場合のみタップ可能
          // (リザーブ分を除外して field 合計のみ評価)
          const totalFieldPaid = Object.entries(costPaymentCardAmounts)
            .filter(([id]) => id !== "reserve")
            .reduce((s, [, a]) => s + a, 0);
          if (totalFieldPaid < pendingCostPayment.finalCost) {
            ids.add(source.instanceId);
          }
        }
      }
    } else if (pendingPlacement) {
      for (const source of pendingPlacement.fieldSources) {
        // 通常コアの残数で判定 (ソウルコアは確認ダイアログが別枠処理)。
        const normalTaken = placementFieldNormalTaken[source.instanceId] ?? 0;
        // ソウルコアのみのスピリット (maxAmount=0) も、ソウル未取得・未辞退なら
        // ソウル目的でタップ可能にする。ソウル取得後 (summonUseSoul) や辞退後は除外。
        const soulGrabbable =
          source.hasSoul &&
          !summonUseSoul &&
          !declinedSoulLocations.has(source.instanceId);
        if (normalTaken < source.maxAmount || soulGrabbable)
          ids.add(source.instanceId);
      }
    } else if (pendingCoreShoot) {
      for (const candidate of pendingCoreShoot.candidates) {
        const taken = coreShootCardAmounts[candidate.instanceId] ?? 0;
        if (
          taken < candidate.availableCores &&
          coreShootTotal < pendingCoreShoot.totalAmount
        ) {
          ids.add(candidate.instanceId);
        }
      }
    } else if (displayState.pendingCoreSplitSelection) {
      for (const card of state.cardInstances) {
        if (getCoreSplitDestinationIndexForTap(card.instanceId) !== null) {
          ids.add(card.instanceId);
        }
      }
    } else if (pendingSeparation) {
      // P3-49: 2-phase 分離 — Phase 1 は source、Phase 2 はブレイヴ本体のみ tappable。
      if (coreSelection.phase === 2) {
        ids.add(pendingSeparation.braveInstanceId);
      } else {
        // Phase 1: 自分のフィールドカード (コア残あり) — held buffer 分も控除。
        for (const c of state.cardInstances) {
          if (
            c.controllerPlayerId === viewingPlayer &&
            c.zone === "field" &&
            c.instanceId !== pendingSeparation.braveInstanceId &&
            canMoveCoresFrom(state, c, getDefinition(c.definitionId))
          ) {
            const heldFromHere = coreSelection.grabbedCores.filter(
              (h) =>
                h.kind === "normal" &&
                h.from.kind === "card" &&
                h.from.instanceId === c.instanceId
            ).length;
            const hasSoul = state.players.find(
              (p) => p.id === viewingPlayer
            )?.soulCoreLocation;
            const soulAvailable =
              hasSoul?.kind === "card" &&
              hasSoul.instanceId === c.instanceId &&
              !declinedSoulLocations.has(c.instanceId) &&
              !coreSelection.grabbedCores.some(
                (h) =>
                  h.kind === "soul" &&
                  h.from.kind === "card" &&
                  h.from.instanceId === c.instanceId
              );
            if (heldFromHere < c.normalCoreCount || soulAvailable)
              ids.add(c.instanceId);
          }
        }
      }
    } else if (displayState.pendingMultiPlacement) {
      // P3-49: 2-phase placement_multi — Phase 1 は source、Phase 2 は target のみ tappable。
      // P3-79: displayState 経由 (相手の pending では tap target を提示しない)。
      const mp = displayState.pendingMultiPlacement;
      if (coreSelection.phase === 2) {
        const nextHeld = coreSelection.heldCores[0];
        for (const t of mp.targets) {
          const placedHere = multiPlacementPerTargetTotal[t.instanceId] ?? 0;
          if (t.maximumCoreCount !== null && placedHere >= t.maximumCoreCount) {
            continue;
          }
          if (nextHeld?.kind === "normal" && nextHeld.from.kind === "void") {
            const placedVoidHere =
              multiPlacementVoidNormalByTarget[t.instanceId] ?? 0;
            if (placedVoidHere >= (t.voidNormalCoreMax ?? 0)) continue;
          }
          ids.add(t.instanceId);
        }
      } else {
        // Phase 1: 自分のフィールドカード (target 以外、通常またはソウル残あり) — held buffer 分も控除。
        const voidNormalCoreMax = mp.targets.reduce(
          (sum, target) => sum + (target.voidNormalCoreMax ?? 0),
          0
        );
        const heldVoid = coreSelection.heldCores.filter(
          (h) => h.kind === "normal" && h.from.kind === "void"
        ).length;
        const availableVoid =
          state.players.find((p) => p.id === viewingPlayer)
            ?.voidNormalCoreCount ?? 0;
        const trashNormalCoreMax = mp.trashNormalCoreMax ?? 0;
        const trashCoreMax = mp.trashCoreMax ?? 0;
        const heldTrash = coreSelection.heldCores.filter(
          (h) => h.kind === "normal" && h.from.kind === "trash"
        ).length;
        const heldTrashSoul = coreSelection.heldCores.filter(
          (h) => h.kind === "soul" && h.from.kind === "trash"
        ).length;
        const availableTrash =
          state.players.find((p) => p.id === viewingPlayer)
            ?.trashNormalCoreCount ?? 0;
        const hasTrashSoul =
          (state.players.find((p) => p.id === viewingPlayer)
            ?.trashSoulCoreCount ?? 0) > 0;
        const trashCoreLimit = trashNormalCoreMax + trashCoreMax;
        const trashCoreUsed =
          multiPlacementTrashNormalTotal +
          multiPlacementTrashSoulTotal +
          heldTrash +
          heldTrashSoul;
        if (
          trashCoreLimit > 0 &&
          trashCoreUsed < trashCoreLimit &&
          (multiPlacementTrashNormalTotal + heldTrash <
            Math.min(trashNormalCoreMax + trashCoreMax, availableTrash) ||
            (trashCoreMax > 0 &&
              hasTrashSoul &&
              heldTrashSoul === 0 &&
              multiPlacementTrashSoulTotal === 0 &&
              !declinedSoulLocations.has("trash")))
        ) {
          ids.add("trash");
        }
        if (
          voidNormalCoreMax > 0 &&
          multiPlacementVoidNormalTotal + heldVoid <
            Math.min(voidNormalCoreMax, availableVoid)
        ) {
          ids.add("void");
        }
        for (const source of multiPlacementFieldSources) {
          const heldTotalFromHere = coreSelection.grabbedCores.filter(
            (entry) =>
              entry.from.kind === "card" &&
              entry.from.instanceId === source.instanceId
          ).length;
          if (heldTotalFromHere >= source.maxTotalAmount) continue;
          const heldFromHere = coreSelection.grabbedCores.filter(
            (h) =>
              h.kind === "normal" &&
              h.from.kind === "card" &&
              h.from.instanceId === source.instanceId
          ).length;
          const heldSoulFromHere = coreSelection.grabbedCores.some(
            (h) =>
              h.kind === "soul" &&
              h.from.kind === "card" &&
              h.from.instanceId === source.instanceId
          );
          if (
            heldFromHere < source.maxAmount ||
            (source.hasSoul &&
              !heldSoulFromHere &&
              !declinedSoulLocations.has(source.instanceId))
          ) {
            ids.add(source.instanceId);
          }
        }
      }
    } else if (displayState.pendingCoreDistribution) {
      const dist = displayState.pendingCoreDistribution;
      const isTargetTotalSelection = requiresCoreDistributionTargetTotals(dist);
      // トラッシュ→フィールド配分: 候補カードがタップ可能
      // ソウル選択モードでは残量に関係なく候補すべてが対象、通常モードでは残量 > 0 のときのみ
      // P3-79: displayState 経由 (相手の pending では tap target を提示しない)。
      const totalSoulCores = dist.totalSoulCores ?? (dist.hasSoulCore ? 1 : 0);
      const currentTargetTotal = isTargetTotalSelection
        ? dist.candidates.reduce((sum, candidate) => {
            const card = state.cardInstances.find(
              (c) => c.instanceId === candidate.instanceId
            );
            return (
              sum + (card?.normalCoreCount ?? 0) + (card?.soulCoreCount ?? 0)
            );
          }, 0)
        : 0;
      const distributionLimit = isTargetTotalSelection
        ? currentTargetTotal +
          (dist.maxTotal ?? dist.totalNormalCores + totalSoulCores)
        : dist.totalNormalCores;
      const remaining = distributionLimit - trashDistTotal;
      const remainingSoul = Math.max(0, totalSoulCores - trashDistSoulTotal);
      const canTap = (trashDistSoulMode && remainingSoul > 0) || remaining > 0;
      if (canTap) {
        for (const cand of dist.candidates) {
          if (
            isTargetTotalSelection ||
            canAddCoreDistributionCore(
              dist,
              trashDistAllocations,
              trashDistSoulAllocations,
              cand.instanceId
            )
          )
            ids.add(cand.instanceId);
        }
      }
      // P3-47 F-5: any_movable_self では allowedSources に含まれる自分 field カード
      // もタップ可能 (ソース選択用)
      if (dist.fromKind === "any_movable" && !isTargetTotalSelection) {
        for (const src of dist.allowedSources ?? []) {
          if (src.kind === "field") ids.add(src.instanceId);
        }
        // soul-only field カード (通常コア 0 で allowedSources に無い) も
        // ソウル grab のため tappable にする。
        for (const soulSourceId of anyMovableSoulSourceIds) {
          if (
            soulSourceId !== "reserve" &&
            soulSourceId !== "trash" &&
            soulSourceId !== "life"
          ) {
            ids.add(soulSourceId);
          }
        }
      }
    }
    return ids;
  }, [
    pendingCostPayment,
    pendingCoreHud,
    pendingCoreControls,
    pendingPlacement,
    pendingCoreShoot,
    coreShootCardAmounts,
    pendingSeparation,
    coreShootTotal,
    displayState.pendingCoreSplitSelection,
    displayState.pendingCoreDistribution,
    displayState.pendingMultiPlacement,
    trashDistTotal,
    trashDistSoulTotal,
    trashDistSoulMode,
    trashDistAllocations,
    trashDistSoulAllocations,
    viewingPlayer,
    placementFieldNormalTaken,
    summonUseSoul,
    declinedSoulLocations,
    multiPlacementFieldSources,
    multiPlacementPerTargetTotal,
    multiPlacementTrashNormalTotal,
    multiPlacementTrashSoulTotal,
    multiPlacementVoidNormalTotal,
    multiPlacementVoidNormalByTarget,
    costPaymentCardAmounts,
    coreSelection.phase,
    coreSelection.grabbedCores,
    coreSelection.heldCores,
    state,
    getDefinition,
    getCoreSplitDestinationIndexForTap,
    anyMovableSoulSourceIds,
  ]);

  const coreTapReserve = useMemo(() => {
    if (pendingCostPayment) return true;
    if (pendingPlacement) {
      // 通常コアが残っている、またはソウルコアが配置可能（未使用）ならリザーブ tappable
      const hasNormalSlot =
        placementReserveNormalTaken < pendingPlacement.maxReserveCores;
      const hasSoulSlot = pendingPlacement.hasSoulInReserve && !summonUseSoul;
      return hasNormalSlot || hasSoulSlot;
    }
    if (displayState.pendingCoreSplitSelection) {
      return getCoreSplitDestinationIndexForTap("reserve") !== null;
    }
    // P3-49: 分離 Phase 1 でのみ reserve tappable (Phase 2 はブレイヴ本体のみ)
    if (pendingSeparation) return coreSelection.phase === 1;
    // P3-49: placement_multi Phase 1 のみ reserve tappable
    // P3-79: displayState 経由 (相手の pending では reserve tap させない)。
    if (displayState.pendingMultiPlacement) return coreSelection.phase === 1;
    // P3-47 F-5: any_movable で reserve が allowedSources に含まれる場合
    if (
      displayState.pendingCoreDistribution?.fromKind === "any_movable" &&
      !requiresCoreDistributionTargetTotals(
        displayState.pendingCoreDistribution
      ) &&
      displayState.pendingCoreDistribution.allowedSources?.some(
        (s) => s.kind === "reserve"
      )
    )
      return true;
    // soul-only reserve (通常コア 0) でもソウル grab のため tappable。
    if (anyMovableSoulSourceIds.has("reserve")) return true;
    return false;
  }, [
    pendingCostPayment,
    pendingPlacement,
    pendingSeparation,
    placementReserveNormalTaken,
    summonUseSoul,
    displayState.pendingCoreSplitSelection,
    displayState.pendingCoreDistribution,
    displayState.pendingMultiPlacement,
    coreSelection.phase,
    getCoreSplitDestinationIndexForTap,
    anyMovableSoulSourceIds,
  ]);

  // P3-47 F-5: any_movable_self で trash / life ゾーンを source としてタップ可能か
  // P3-79: displayState 経由 (相手の pending ではゾーン tap させない)。
  const coreTapZones = useMemo(() => {
    const set = new Set<"trash" | "life" | "count_area">();
    if (
      displayState.pendingEffectOptionalRepeatCountSelection?.selectionMode ===
      "count_decrease"
    ) {
      set.add("count_area");
    }
    if (displayState.pendingCoreSplitSelection) {
      if (getCoreSplitDestinationIndexForTap("trash") !== null) {
        set.add("trash");
      }
      if (getCoreSplitDestinationIndexForTap("life") !== null) {
        set.add("life");
      }
    }
    if (
      displayState.pendingCoreDistribution?.fromKind === "any_movable" &&
      !requiresCoreDistributionTargetTotals(
        displayState.pendingCoreDistribution
      )
    ) {
      for (const src of displayState.pendingCoreDistribution.allowedSources ??
        []) {
        if (src.kind === "trash") set.add("trash");
        if (src.kind === "life") set.add("life");
      }
    }
    if (
      (displayState.pendingMultiPlacement?.trashNormalCoreMax ?? 0) > 0 ||
      (displayState.pendingMultiPlacement?.trashCoreMax ?? 0) > 0
    ) {
      const player = state.players.find((p) => p.id === viewingPlayer);
      const heldTrash = coreSelection.heldCores.filter(
        (h) => h.kind === "normal" && h.from.kind === "trash"
      ).length;
      const heldTrashSoul = coreSelection.heldCores.filter(
        (h) => h.kind === "soul" && h.from.kind === "trash"
      ).length;
      const trashNormalCoreMax =
        displayState.pendingMultiPlacement?.trashNormalCoreMax ?? 0;
      const trashCoreMax =
        displayState.pendingMultiPlacement?.trashCoreMax ?? 0;
      const trashCoreLimit = trashNormalCoreMax + trashCoreMax;
      const trashCoreUsed =
        multiPlacementTrashNormalTotal +
        multiPlacementTrashSoulTotal +
        heldTrash +
        heldTrashSoul;
      const selectableTrash = Math.min(
        trashNormalCoreMax + trashCoreMax,
        player?.trashNormalCoreCount ?? 0
      );
      const soulSelectable =
        trashCoreMax > 0 &&
        (player?.trashSoulCoreCount ?? 0) > 0 &&
        heldTrashSoul === 0 &&
        multiPlacementTrashSoulTotal === 0 &&
        !declinedSoulLocations.has("trash");
      if (
        trashCoreUsed < trashCoreLimit &&
        (multiPlacementTrashNormalTotal + heldTrash < selectableTrash ||
          soulSelectable)
      ) {
        set.add("trash");
      }
    }
    // soul-only trash / life (通常コア 0) でもソウル grab のため tappable。
    if (anyMovableSoulSourceIds.has("trash")) set.add("trash");
    if (anyMovableSoulSourceIds.has("life")) set.add("life");
    return set;
  }, [
    displayState.pendingEffectOptionalRepeatCountSelection,
    displayState.pendingCoreSplitSelection,
    displayState.pendingCoreDistribution,
    displayState.pendingMultiPlacement,
    state.players,
    viewingPlayer,
    coreSelection.heldCores,
    multiPlacementTrashNormalTotal,
    multiPlacementTrashSoulTotal,
    declinedSoulLocations,
    getCoreSplitDestinationIndexForTap,
    anyMovableSoulSourceIds,
  ]);

  // 表示用コアオーバーライド: facade.previewState と現在 state の差分を抽出
  // P3-46 Phase 4: 個別 pending* state からの計算を撤去し、`applyDraftCoreMoves`
  // で得た `previewState` との diff を override として返す。これにより 6 種の
  // コア操作モードを単一窓口 (previewState) に統一する。
  // 後日対応 (heldCores 反映): 2-phase mode の Phase 1 / Phase 2 で「掴み中」の
  // コアも source container から差し引く。draft (= 置き済み) には previewState
  // 経由で反映されるが、heldCores (= 掴んだが未配置) は previewState には乗らない
  // ため、ここで明示的に減算する。
  const coreDisplayOverrides = useMemo(() => {
    const overrides =
      computeCoreDisplayOverrides({
        isActive: coreSelection.isActive,
        previewState: coreSelection.previewState,
        state,
        heldCores: coreSelection.heldCores,
        viewingPlayer,
        pendingCoreDistribution: displayState.pendingCoreDistribution,
      }) ?? {};
    if (
      optionalRepeatCountPending?.selectionMode === "count_decrease" &&
      optionalRepeatCountDraftTotal > 0
    ) {
      const player = state.players.find((p) => p.id === viewingPlayer);
      const countAreaCards = displayState.cardInstances.filter(
        (card) =>
          card.controllerPlayerId === viewingPlayer &&
          card.zone === "count_area"
      ).length;
      overrides["count_area"] = Math.max(
        0,
        (player?.countValue ?? 0) +
          countAreaCards -
          optionalRepeatCountDraftTotal
      );
    }
    if (coreSplitDrafts.length > 0) {
      const deltas = new Map<string, number>();
      const addDelta = (container: NormalCoreContainer, delta: number) => {
        const key = coreContainerDisplayKey(container, viewingPlayer);
        if (!key) return;
        deltas.set(key, (deltas.get(key) ?? 0) + delta);
      };
      for (const draft of coreSplitDrafts) {
        if (draft.kind !== "normal") continue;
        addDelta(draft.from, -draft.amount);
        addDelta(draft.to, draft.amount);
      }
      for (const [key, delta] of deltas) {
        const container =
          key === "reserve" || key === "trash" || key === "life"
            ? ({ kind: key, playerId: viewingPlayer } as NormalCoreContainer)
            : ({ kind: "card", instanceId: key } as NormalCoreContainer);
        const base = normalContainerBaseCount(state, container);
        overrides[key] = Math.max(0, base + delta);
      }
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [
    coreSelection.isActive,
    coreSelection.previewState,
    coreSelection.heldCores,
    state,
    viewingPlayer,
    displayState.pendingCoreDistribution,
    displayState.cardInstances,
    optionalRepeatCountPending?.selectionMode,
    optionalRepeatCountDraftTotal,
    coreSplitDrafts,
  ]);

  // ソウルコア仮想表示オーバーライド: facade.previewState と現在 state の差分を抽出
  // P3-46 Phase 4: 個別 pending* state からの計算を撤去し、preview の soulCoreLocation
  // 差分を override として返す。
  // 後日対応 (heldCores 反映): 「掴み中」のソウルコアも source 位置を消去マーク
  // (false) する。draftMoves に変換される前の Phase 1 / Phase 2 中間状態でも
  // フィールドからソウルが消えて見えるようにするため。
  const soulCoreDisplayOverrides = useMemo(
    () =>
      computeSoulCoreDisplayOverrides({
        isActive: coreSelection.isActive,
        previewState: coreSelection.previewState,
        state,
        heldCores: coreSelection.heldCores,
        viewingPlayer,
        pendingCoreDistribution: displayState.pendingCoreDistribution,
      }),
    [
      coreSelection.isActive,
      coreSelection.previewState,
      coreSelection.heldCores,
      state,
      viewingPlayer,
      displayState.pendingCoreDistribution,
    ]
  );

  // 確定前 Lv / BP / シンボルバッジ算出用の仮想コア state。
  // previewState (確定 draft 反映済み) に「掴み中 (heldCores) で未配置のコア」の
  // source 減算を重ねる。coreDisplayOverrides がコア「数」を仮想表示するのと対になり、
  // コア総数依存の実効ステータス (継続効果込み) を同じ仮想コアで再計算するために FieldArea
  // に渡す。掴み中コアは draft ではないため previewState には乗らず、ここで共通プリミティブ
  // (moveNormalCores / moveSoulCore) 経由で盤面から一時退避する (normal→void / soul→reserve、
  // どちらも表示には使わない sink)。draft も held も無い場合は state と同一参照になるので
  // undefined を返し、FieldArea 側を実 state にフォールバックさせて通常表示と一致させる。
  const coreCalcState = useMemo(() => {
    if (!coreSelection.isActive) return undefined;
    let s = coreSelection.previewState;
    if (coreSelection.heldCores.length > 0) {
      try {
        for (const entry of coreSelection.heldCores) {
          if (entry.kind === "normal") {
            const from = entry.from;
            // 掴み中の通常コアは card / reserve / trash / life 由来のみ (removed_from_game 不可)。
            if (from.kind === "removed_from_game") continue;
            s = moveNormalCores(
              s,
              from,
              { kind: "void", playerId: viewingPlayer },
              1
            );
          } else {
            const owner = entry.playerId ?? viewingPlayer;
            s = moveSoulCore(s, owner, entry.from, {
              kind: "reserve",
              playerId: owner,
            });
          }
        }
      } catch (e) {
        // source container が相手フラッシュ等で無効化された場合は previewState に戻す
        // (coreSelectionFacade.previewState と同じ resilience 方針)。
        console.warn(
          "[coreCalcState] held-core subtraction threw; falling back to previewState.",
          e
        );
        s = coreSelection.previewState;
      }
    }
    s = projectRebirthCorePlacementPreview(s, getDefinition);
    return s === state ? undefined : s;
  }, [coreSelection, state, viewingPlayer, getDefinition]);

  const continueMagicUseWithZoneCost = useCallback(
    (
      ma: UseMagicLegalAction,
      def: CardDefinition,
      selectedZoneCardIds: string[]
    ) => {
      const player = state.players.find((p) => p.id === viewingPlayer);
      if (!player) return;

      const fieldSources: CostPaymentFieldSource[] = [
        ...ma.availableOnBoardCoreSources.map((s) => ({
          instanceId: s.instanceId,
          definitionId: s.definitionId,
          maxAmount: s.availableCoreAmount,
          soulCoreOnly: false,
          ...(s.destination ? { destination: s.destination } : {}),
        })),
        ...ma.availableSoulCoreOnlySources.map((s) => ({
          instanceId: s.instanceId,
          definitionId: s.definitionId,
          maxAmount: s.availableSoulCoreAmount,
          soulCoreOnly: true,
        })),
      ];

      const automaticPaymentSources = getAutomaticCostPaymentSources(
        state,
        viewingPlayer,
        ma.finalCost,
        ma.availableReserveCoreAmount,
        fieldSources
      );
      if (automaticPaymentSources === null) {
        coreSelection.start("card_cost");
        setPendingCostPayment({
          action: ma,
          def,
          finalCost: ma.finalCost,
          reserveAvailable: ma.availableReserveCoreAmount,
          reserveNormal: player.reserveNormalCoreCount,
          fieldSources,
          minCoresForPlacement: 0,
          selectedZoneCardIds,
        });
        return;
      }

      const paymentSourcesForReserve: CardCostPaymentSource[] =
        automaticPaymentSources;
      try {
        const result = applyLegalAction({
          state,
          action: ma,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          paymentSources: paymentSourcesForReserve,
          selectedZoneCardIds,
        });
        setStateAndSync(result.state, ma, {
          paymentSources: paymentSourcesForReserve,
          selectedZoneCardIds,
        });
        showMessage(`${def.name} を使用！ (コスト${ma.finalCost})`);
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    },
    [state, viewingPlayer, coreSelection] // eslint-disable-line react-hooks/exhaustive-deps -- getDefinition/effectLookups/setStateAndSync/showMessage are stable refs
  );

  // SummonCostExcludeChoiceModal (BSTH02.7-M01 effects[0] 等) で除外枚数を確定した後、
  // continueMagicUseWithZoneCost と同型でコスト支払いへ進む。finalCost はここで
  // 除外割引を反映して計算する (pending.reducedCost - selected.length * discountPerCard)。
  const continueSummonWithCostExcludeChoice = useCallback(
    (
      resolveAction: ResolvePendingSummonCostExcludeChoiceLegalAction,
      def: CardDefinition,
      selectedCardInstanceIds: string[]
    ) => {
      const player = state.players.find((p) => p.id === viewingPlayer);
      if (!player) return;

      // fullReduction:true (ENGINE-summon-self-exclude-alt-cost-full-reduction、
      // BSTH11-M01 effects[0]) のときは線形割引ではなく固定額 fullReductionCost に合流する。
      const finalCost =
        resolveAction.fullCostPaid && selectedCardInstanceIds.length > 0
          ? (resolveAction.remainingPaymentCost ?? 0)
          : resolveAction.fullReduction && selectedCardInstanceIds.length > 0
            ? (resolveAction.fullReductionCost ?? resolveAction.reducedCost)
            : Math.max(
                0,
                resolveAction.reducedCost -
                  selectedCardInstanceIds.length * resolveAction.discountPerCard
              );

      const fieldSources: CostPaymentFieldSource[] = [
        ...resolveAction.availableOnBoardCoreSources.map((s) => ({
          instanceId: s.instanceId,
          definitionId: s.definitionId,
          maxAmount: s.availableCoreAmount,
          soulCoreOnly: false,
        })),
        ...resolveAction.availableSoulCoreOnlySources.map((s) => ({
          instanceId: s.instanceId,
          definitionId: s.definitionId,
          maxAmount: s.availableSoulCoreAmount,
          soulCoreOnly: true,
        })),
      ];

      const automaticPaymentSources = getAutomaticCostPaymentSources(
        state,
        viewingPlayer,
        finalCost,
        resolveAction.availableReserveCoreAmount,
        fieldSources
      );
      if (automaticPaymentSources === null) {
        coreSelection.start("card_cost");
        setPendingCostPayment({
          action: resolveAction,
          def,
          finalCost,
          reserveAvailable: resolveAction.availableReserveCoreAmount,
          reserveNormal: player.reserveNormalCoreCount,
          fieldSources,
          minCoresForPlacement: 0,
          summonCostExcludeSelectedCardInstanceIds: selectedCardInstanceIds,
        });
        return;
      }

      const paymentSourcesForReserve: CardCostPaymentSource[] =
        automaticPaymentSources;
      try {
        const dispatchPayload: Record<string, unknown> = {
          paymentSources: paymentSourcesForReserve,
          summonCostExcludeSelectedCardInstanceIds: selectedCardInstanceIds,
        };
        const result = applyLegalAction({
          state,
          action: resolveAction,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          paymentSources: paymentSourcesForReserve,
          summonCostExcludeSelectedCardInstanceIds: selectedCardInstanceIds,
        });
        setStateAndSync(result.state, resolveAction, dispatchPayload);
        showMessage(
          `${def.name} を宣言しました (コスト${finalCost}、除外${selectedCardInstanceIds.length}枚)`
        );
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    },
    [state, viewingPlayer, coreSelection] // eslint-disable-line react-hooks/exhaustive-deps -- getDefinition/effectLookups/setStateAndSync/showMessage are stable refs
  );

  // 共通コアHUD (BSSL01-M02 effects[0,1] 等) で移動枚数+移動先を確定した後、
  // 即座に summon を実行する。costOffset は印字コストと同値のため finalCost は常に 0 ＝
  // continueSummonWithCostExcludeChoice と異なり追加のコスト支払いモーダルへは遷移しない。
  const handleAction = useCallback(
    (
      action: LegalAction,
      skipAttackCostGate = false,
      burstConfirmed = false
    ) => {
      try {
        // 解決用の非公開continuationはroom viewerへ渡さない。choiceはサーバで確定する。
        if (roomId && action.kind === "resolve_pending_step_choice") {
          setStateAndSync(state, action);
          return;
        }
        if (
          !burstConfirmed &&
          action.kind === "resolve_pending_burst_check" &&
          previewBurstEffectSuppression({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
          })
        ) {
          setBurstConfirmationActionId(action.actionId);
          return;
        }
        // 通常召喚/配置の遅延維持コア配置はコア配置 HUD (confirmPlacement) 専用。
        // pendingEnterFieldPlacement 検知の useEffect が HUD を開くため、ここで generic
        // dispatch すると enterFieldCorePlacements 未指定 (空コア) で
        // "Not enough enter-field cores selected" になる。安全のため握りつぶす。
        if (action.kind === "resolve_pending_enter_field_placement") {
          return;
        }
        // P3-127: attack/join_active_attack のコスト源 (破壊/重疲労させるカード)
        // 候補が複数あるとき、どの呼び出し元 (カードタップ / card-action-modal) 経由でも
        // 候補選択モーダルへ振り分ける (SSOT: 1 箇所だけでゲートする)。
        // skipAttackCostGate は候補選択モーダル自身が確定 action を再送する際の
        // バイパス (無限ループ防止)。
        if (
          !skipAttackCostGate &&
          (action.kind === "attack" ||
            action.kind === "join_active_attack" ||
            action.kind === "block")
        ) {
          const key = attackCostGroupKey(action);
          const group = actions.filter(
            (ca): ca is typeof action =>
              (ca.kind === "attack" ||
                ca.kind === "join_active_attack" ||
                ca.kind === "block") &&
              attackCostGroupKey(ca) === key
          );
          const destroyIds = new Set(
            group
              .map(
                (ca) =>
                  ca.battleDestroyCostSourceInstanceIds?.join("+") ??
                  ca.battleDestroyCostSourceInstanceId
              )
              .filter((id): id is string => !!id)
          );
          const exhaustIds = new Set(
            group
              .map((ca) =>
                "attackExhaustCostSourceInstanceIds" in ca
                  ? (ca.attackExhaustCostSourceInstanceIds?.join("+") ??
                    ca.attackExhaustCostSourceInstanceId)
                  : undefined
              )
              .filter((id): id is string => !!id)
          );
          if (destroyIds.size > 1) {
            setAttackCostSourceChoice({
              actions: group,
              field: "battleDestroyCostSourceInstanceId",
            });
            return;
          }
          if (exhaustIds.size > 1) {
            setAttackCostSourceChoice({
              actions: group,
              field: "attackExhaustCostSourceInstanceId",
            });
            return;
          }
        }
        // choice ステップ: 同一効果に複数 choiceIndex があればモーダルを開く
        if (
          (action.kind === "resolve_pending_triggered_effect" ||
            action.kind === "resolve_battle_immediate_effect" ||
            action.kind === "resolve_pending_burst_check") &&
          "choiceIndex" in action &&
          (action as { choiceIndex?: number }).choiceIndex !== undefined
        ) {
          const a = action as {
            pendingId?: string;
            promptId?: string;
            checkId?: string;
            sourceInstanceId?: string;
            sourceCardNo?: string;
            sourceDefinitionId?: string;
            registrationIndex?: number;
            executionMode?: string;
            choiceIndex?: number;
          };
          const groupId = a.pendingId ?? a.promptId ?? a.checkId ?? "";
          const siblings = actions.filter((act) => {
            if (act.kind !== action.kind) return false;
            const b = act as {
              pendingId?: string;
              promptId?: string;
              checkId?: string;
              sourceInstanceId?: string;
              registrationIndex?: number;
              choiceIndex?: number;
            };
            const bGroupId = b.pendingId ?? b.promptId ?? b.checkId ?? "";
            return (
              bGroupId === groupId &&
              b.sourceInstanceId === a.sourceInstanceId &&
              b.registrationIndex === a.registrationIndex &&
              b.choiceIndex !== undefined
            );
          });
          if (siblings.length > 1) {
            setPendingEffectChoice({
              choices: siblings,
              sourceCardNo: a.sourceCardNo ?? "",
              sourceDefinitionId: a.sourceDefinitionId ?? "",
            });
            return;
          }
        }

        // ターゲットが必要なアクションは対象選択モードに入る。
        // ただし「スタック窓を開いて遅延解決する」種別は例外: ルール上スタック窓はコスト
        // 支払い後・対象選択前に開くため、宣言時には対象を選ばず、窓クローズ後の
        // pendingEffectTargetSelection で選ぶ (下の useEffect が resolve_pending_effect_target
        // を対象選択モードに載せる)。
        // ENGINE-step-optional-zero-to-n-target-selection: 0..N 可変選択 (require=0/max>0)
        // も対象選択モードへ。required>0 と max>0 のいずれかで picker を起動する。
        const reqCount =
          "requiredTargetCount" in action
            ? ((action as { requiredTargetCount?: number })
                .requiredTargetCount ?? 0)
            : 0;
        const maxCount =
          "maxTargetCount" in action
            ? ((action as { maxTargetCount?: number }).maxTargetCount ?? 0)
            : 0;
        if (
          !DEFERRED_TARGET_ACTION_KINDS.has(action.kind) &&
          (reqCount > 0 || maxCount > 0) &&
          "candidateTargetInstanceIds" in action
        ) {
          setPendingAction(action);
          setSelectedTargets([]);
          if (reqCount > 0) {
            showMessage(`対象を${reqCount}体選択してください`);
          } else {
            showMessage(`対象を最大${maxCount}体まで選択してください`);
          }
          return;
        }

        // 召喚コスト・トラッシュ除外選択 (BSTH02.7-M01 effects[0] 等): コスト支払いUIへ
        // 行く前に、まず pendingSummonCostExcludeChoice を開くだけの宣言を送る
        // (支払いは除外枚数確定後、SummonCostExcludeChoiceModal → コア選択の2段階)。
        if (action.kind === "summon" && action.opensCostExcludeChoice) {
          try {
            const result = applyLegalAction({
              state,
              action,
              getCardDefinitionById: getDefinition,
              ...effectLookups,
            });
            setStateAndSync(result.state, action, {});
          } catch (e) {
            showMessage(`エラー: ${userFacingError(e)}`);
          }
          return;
        }

        if (action.kind === "summon" || action.kind === "place_nexus") {
          // 召喚/配置も共通判定で支払い選択の要否を決める。
          // ブレイヴ召喚 (printedCategory=brave) も通常 summon として扱い、
          // 合体する/スピリット状態の選択は窓クローズ後の engine pending で行う。
          const sa = action as SummonLegalAction | PlaceNexusLegalAction;
          const card = state.cardInstances.find(
            (c) => c.instanceId === sa.sourceInstanceId
          );
          if (!card) return;
          const def = getDefinition(card.definitionId);
          if (!def) return;
          const player = state.players.find((p) => p.id === viewingPlayer);
          if (!player) return;

          const fieldSources: CostPaymentFieldSource[] = [
            ...sa.availableOnBoardCoreSources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableCoreAmount,
              soulCoreOnly: false,
            })),
            ...sa.availableSoulCoreOnlySources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableSoulCoreAmount,
              soulCoreOnly: true,
            })),
          ];

          if (
            action.kind === "summon" &&
            findTokenPoolPreCostForcedCombineTrigger(
              state,
              viewingPlayer,
              sa.sourceInstanceId,
              getDefinition
            )
          ) {
            try {
              const result = applyLegalAction({
                state,
                action: sa,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, sa, {});
            } catch (error) {
              showMessage(`エラー: ${userFacingError(error)}`);
            }
            return;
          }
          const minCores = sa.minimumEnterFieldCoreCount;
          // ブレイヴの「召喚」は支払い後に「直接合体しますか？」分岐を挟む統合フロー。
          const isBraveSummon =
            action.kind === "summon" && def.printedCategory === "brave";

          const automaticPaymentSources = getAutomaticCostPaymentSources(
            state,
            viewingPlayer,
            sa.finalCost,
            sa.availableReserveCoreAmount,
            fieldSources
          );
          if (automaticPaymentSources === null) {
            // 支払い元選択UIへ
            coreSelection.start("card_cost");
            setPendingCostPayment({
              action: sa,
              def,
              finalCost: sa.finalCost,
              reserveAvailable: sa.availableReserveCoreAmount,
              reserveNormal: player.reserveNormalCoreCount,
              fieldSources,
              minCoresForPlacement: minCores,
              ...(isBraveSummon ? { braveSummon: true } : {}),
            });
            return;
          }

          // 自動支払い可能なら召喚/配置を宣言する。
          // maxReserveCores は通常コアの配置可能数。ソウルコアは hasSoulInReserve で別管理。
          const maxPlaceable = player.reserveNormalCoreCount;
          const hasSoul = player.soulCoreLocation?.kind === "reserve";

          const fieldSourcesForPlacement = buildPlacementFieldSources({
            state,
            actingPlayerId: viewingPlayer,
            getDefinition,
          });

          // 召喚 / 配置: 支払い後にスタック窓を開く。ブレイヴの合体選択は窓クローズ後の
          // engine `pendingBraveCombineChoice` で行う (合体可否はスタック窓より後)。
          if (action.kind === "summon" || action.kind === "place_nexus") {
            try {
              const result = applyLegalAction({
                state,
                action: sa,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
                paymentSources: automaticPaymentSources,
              });
              setStateAndSync(result.state, sa, {
                paymentSources: automaticPaymentSources,
              });
              showMessage(`${def.name} を宣言しました`);
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
            return;
          }

          coreSelection.start("placement");
          setPendingPlacement({
            action: sa,
            def,
            finalCost: sa.finalCost,
            minCores,
            maxReserveCores: maxPlaceable,
            fieldSources: fieldSourcesForPlacement,
            hasSoulInReserve: !!hasSoul,
            destinationInstanceId: sa.sourceInstanceId,
          });
          return;
        }

        if (action.kind === "use_magic") {
          // マジック使用: 有料なら支払い元を選んで確定する
          const ma = action as UseMagicLegalAction;
          const card = state.cardInstances.find(
            (c) => c.instanceId === ma.sourceInstanceId
          );
          if (!card) return;
          const def = getDefinition(card.definitionId);
          if (!def) return;
          const player = state.players.find((p) => p.id === viewingPlayer);
          if (!player) return;

          // P3-160: pre-cost offer は元マジックの支払い UI を開く前に engine へ渡す。
          // ここで paymentSources を渡さないため、apply 側の共通 use_magic handler が
          // pending decision を立て、戦力投入の通常使用を先に完走させる。対象条件・
          // usageLimit は engine が再検証するので、UI metadata は先払い順序の制御だけを担う。
          if (ma.preCostTriggerOffer) {
            try {
              const result = applyLegalAction({
                state,
                action: ma,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, ma, {});
              showMessage("コスト支払い前の効果を選択してください");
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
            return;
          }

          // costMode === "free": cost_override CE による無料使用。
          // applyLegalAction 経由で main/flash/stack timing のスタック窓を開いて
          // 応答・無効化の機会を保証する (paymentSources は engine 側で空配列に強制される)。
          if (ma.costMode === "free") {
            try {
              const result = applyLegalAction({
                state,
                action: ma,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
                paymentSources: [],
              });
              setStateAndSync(result.state, ma, { paymentSources: [] });
              showMessage(`${def.name} を使用！ (コスト支払わず)`);
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
            return;
          }

          if (ma.costMode === "zone_discount") {
            const candidateIds = ma.zoneCostPaymentCandidateIds ?? [];
            const count = ma.zoneCostPaymentCount ?? 0;
            if (count <= 0 || candidateIds.length < count) {
              showMessage("エラー: 追加コストの候補カードが不足しています");
              return;
            }
            setPendingMagicZoneCostSelection({ action: ma, def });
            return;
          }

          const fieldSources: CostPaymentFieldSource[] = [
            ...ma.availableOnBoardCoreSources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableCoreAmount,
              soulCoreOnly: false,
              ...(s.destination ? { destination: s.destination } : {}),
            })),
            ...ma.availableSoulCoreOnlySources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableSoulCoreAmount,
              soulCoreOnly: true,
            })),
          ];

          const automaticPaymentSources = getAutomaticCostPaymentSources(
            state,
            viewingPlayer,
            ma.finalCost,
            ma.availableReserveCoreAmount,
            fieldSources
          );
          if (automaticPaymentSources === null) {
            // 支払い元選択UIへ
            coreSelection.start("card_cost");
            setPendingCostPayment({
              action: ma,
              def,
              finalCost: ma.finalCost,
              reserveAvailable: ma.availableReserveCoreAmount,
              reserveNormal: player.reserveNormalCoreCount,
              fieldSources,
              minCoresForPlacement: 0,
            });
            return;
          }

          // コスト0または通常コアのみの単一支払い元

          const paymentSourcesForReserve: CardCostPaymentSource[] =
            automaticPaymentSources;
          const result = applyLegalAction({
            state,
            action: ma,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: paymentSourcesForReserve,
          });

          setStateAndSync(result.state, ma, {
            paymentSources: paymentSourcesForReserve,
          });
          showMessage(`${def.name} を使用！ (コスト${ma.finalCost})`);
          return;
        }

        // ミラージュセットも有料なら共通HUDで支払う。
        if (action.kind === "set_mirage") {
          const sm = action as SetMirageLegalAction;
          const card = state.cardInstances.find(
            (c) => c.instanceId === sm.sourceInstanceId
          );
          if (!card) return;
          const def = getDefinition(card.definitionId);
          if (!def) return;
          const player = state.players.find((p) => p.id === viewingPlayer);
          if (!player) return;

          const fieldSources: CostPaymentFieldSource[] = [
            ...sm.availableOnBoardCoreSources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableCoreAmount,
              soulCoreOnly: false,
              ...(s.destination ? { destination: s.destination } : {}),
            })),
            ...sm.availableSoulCoreOnlySources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableSoulCoreAmount,
              soulCoreOnly: true,
            })),
          ];

          const automaticPaymentSources = getAutomaticCostPaymentSources(
            state,
            viewingPlayer,
            sm.finalCost,
            sm.availableReserveCoreAmount,
            fieldSources
          );
          if (automaticPaymentSources === null) {
            coreSelection.start("card_cost");
            setPendingCostPayment({
              action: sm,
              def,
              finalCost: sm.finalCost,
              reserveAvailable: sm.availableReserveCoreAmount,
              reserveNormal: player.reserveNormalCoreCount,
              fieldSources,
              minCoresForPlacement: 0,
            });
            return;
          }

          const paymentSourcesForReserve: CardCostPaymentSource[] =
            automaticPaymentSources;
          try {
            const result = applyLegalAction({
              state,
              action: sm,
              getCardDefinitionById: getDefinition,
              ...effectLookups,
              paymentSources: paymentSourcesForReserve,
            });
            setStateAndSync(result.state, sm, {
              paymentSources: paymentSourcesForReserve,
            });
            showMessage(
              `${def.name} をミラージュセット！ (コスト${sm.finalCost})`
            );
          } catch (e) {
            showMessage(`エラー: ${userFacingError(e)}`);
          }
          return;
        }

        if (action.kind === "use_accel" || action.kind === "use_change") {
          // アクセル/チェンジ: マジックと同様のコスト支払いUI
          const ac = action as {
            sourceInstanceId: string;
            finalCost: number;
            availableReserveCoreAmount: number;
            availableOnBoardCoreSources: Array<{
              instanceId: string;
              definitionId: string;
              availableCoreAmount: number;
            }>;
            availableSoulCoreOnlySources: Array<{
              instanceId: string;
              definitionId: string;
              availableSoulCoreAmount: number;
            }>;
          };
          const card = state.cardInstances.find(
            (c) => c.instanceId === ac.sourceInstanceId
          );
          if (!card) return;
          const def = getDefinition(card.definitionId);
          if (!def) return;
          const player = state.players.find((p) => p.id === viewingPlayer);
          if (!player) return;

          const fieldSources: CostPaymentFieldSource[] = [
            ...ac.availableOnBoardCoreSources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableCoreAmount,
              soulCoreOnly: false,
            })),
            ...ac.availableSoulCoreOnlySources.map((s) => ({
              instanceId: s.instanceId,
              definitionId: s.definitionId,
              maxAmount: s.availableSoulCoreAmount,
              soulCoreOnly: true,
            })),
          ];

          const automaticPaymentSources = getAutomaticCostPaymentSources(
            state,
            viewingPlayer,
            ac.finalCost,
            ac.availableReserveCoreAmount,
            fieldSources
          );
          if (automaticPaymentSources === null) {
            coreSelection.start("card_cost");
            setPendingCostPayment({
              action,
              def,
              finalCost: ac.finalCost,
              reserveAvailable: ac.availableReserveCoreAmount,
              reserveNormal: player.reserveNormalCoreCount,
              fieldSources,
              minCoresForPlacement: 0,
            });
            return;
          }

          // 自動支払い可能な配分で宣言する

          const paymentSourcesDirect: CardCostPaymentSource[] =
            automaticPaymentSources;

          const acResult = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: paymentSourcesDirect,
          });
          setStateAndSync(acResult.state, action, {
            paymentSources: paymentSourcesDirect,
          });
          const label = action.kind === "use_accel" ? "アクセル" : "チェンジ";
          showMessage(`${def.name} を${label}使用！ (コスト${ac.finalCost})`);
          return;
        }

        // 効果文内の支払いは解決時の共通pendingへ委ねる。応答窓前には選ばない。
        // その他のアクションは applyLegalAction で処理
        if (import.meta.env.DEV) {
          console.log("[DEBUG] applyLegalAction:", action.kind, action); // eslint-disable-line no-console
        }
        // pendingStepOptionalChoice (step.executionMode='optional') の choice は
        // action.choice (SSOT) を apply 側が直接消費する。GUI dispatcher は
        // 別 payload を注入しない (並行写像を作らない)。
        const result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, action);

        // 誘発効果解決後のログ
        if (action.kind === "resolve_pending_triggered_effect") {
          showMessage("誘発効果を解決");
        } else if (action.kind === "resolve_pending_burst_check") {
          showMessage("バースト発動");
        }
      } catch (e) {
        // room モード: 相手の非公開カード (sanitize 済み state で definitionId=
        // "_hidden_card_") を解決するアクションは、クライアントの sanitize 済み state では
        // applyLegalAction できず "Unknown card definition: _hidden_card_" で throw する。
        // 例: 相手 start step の private 宣言トリガ (パチュリー召喚) を pass_stack で閉じて
        // 解決するケース。サーバは実カードを保持するので、楽観適用を諦めてサーバへ dispatch
        // し、確定後の state を取り直す。setStateAndSync 経由にすることで
        // server-authoritative の reconcile (dispatch 後に権威 state へ収束) と
        // 「送信中…」表示を共有する (楽観 newState は現 state = 変更なし)。
        if (
          roomId &&
          e instanceof Error &&
          e.message.includes("_hidden_card_")
        ) {
          setStateAndSync(state, action);
          return;
        }
        console.error("Action failed:", e);
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    },
    [
      state,
      getDefinition,
      viewingPlayer,
      roomId,
      actions,
      coreSelection,
      effectLookups,
      setStateAndSync,
    ]
  );

  const handleSkipOptionalAction = useCallback(
    (action: LegalAction) => {
      try {
        const result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          skipOptionalEffect: true,
        });
        setStateAndSync(result.state, action, {
          skipOptionalEffect: true,
        });
        showMessage("効果をスキップ");
      } catch (e) {
        console.error("Skip failed:", e);
      }
    },
    [state, getDefinition, effectLookups, setStateAndSync]
  );

  const handleMagicEffectSelected = (
    a: UseMagicLegalAction,
    variants: UseMagicLegalAction[]
  ) => {
    const sameTimingActions = variants.filter(
      (b): b is UseMagicLegalAction =>
        b.kind === "use_magic" &&
        b.sourceInstanceId === a.sourceInstanceId &&
        b.timing === a.timing &&
        b.effectIndex === a.effectIndex &&
        b.choiceIndex === a.choiceIndex
    );
    const paidVariant = sameTimingActions.find((b) => b.costMode === "paid");
    const freeVariant = sameTimingActions.find((b) => b.costMode === "free");
    const overrideVariant = sameTimingActions.find(
      (b) => b.costMode === "override"
    );
    const zoneDiscountVariant = sameTimingActions.find(
      (b) => b.costMode === "zone_discount"
    );
    const modeCount = [
      paidVariant,
      freeVariant,
      overrideVariant,
      zoneDiscountVariant,
    ].filter(Boolean).length;
    if (modeCount >= 2) {
      const resolveSourceName = (
        variant: UseMagicLegalAction | undefined
      ): string | undefined => {
        const srcId = variant?.costOverrideSourceInstanceId;
        const sourceCard = srcId
          ? state.cardInstances.find((c) => c.instanceId === srcId)
          : undefined;
        const sourceDef = sourceCard
          ? getDefinition(sourceCard.definitionId)
          : undefined;
        return sourceDef?.name;
      };
      const freeSourceCardName = resolveSourceName(freeVariant);
      const overrideSourceCardName = resolveSourceName(overrideVariant);
      setMagicCostModeChoice({
        ...(paidVariant ? { paidAction: paidVariant } : {}),
        ...(freeVariant ? { freeAction: freeVariant } : {}),
        ...(overrideVariant ? { overrideAction: overrideVariant } : {}),
        ...(zoneDiscountVariant
          ? { zoneDiscountAction: zoneDiscountVariant }
          : {}),
        ...(freeSourceCardName ? { freeSourceCardName } : {}),
        ...(overrideSourceCardName ? { overrideSourceCardName } : {}),
      });
      return;
    }
    handleAction(a);
  };

  // P3-35 Phase 2-A: declaredFromPrivateZone の auto-fire
  //
  // private declaration で「発揮する/しない」を既に確定している誘発効果は、
  // 公開キューに乗った時点で「誘発効果を発揮」ボタンを別途押す必要がない。
  // 条件を満たしたら handleAction を自動発火して redundant click を省く。
  //
  // 解決対象 (公開キューから 1 件選ぶ):
  // - 公開キューが 1 件 → その pending が auto-fire 対象
  // - 公開キューが 2 件以上 → ターンプレイヤーが select_pending_to_resolve で
  //   selectedByTurnPlayer=true にした pending が auto-fire 対象
  //
  // 条件 (全 true で発火):
  // - 解決対象 pending が見つかる
  // - その pending が private declaration 経由 (declaredFromPrivateZone === true)
  // - 自分のターンの pending である (acting player === viewing player)
  // - 他の UI pending (cost / placement / zone selection 等) がブロックしていない
  // - choice 選択モーダルが開いていない
  // - 候補 action が 1 件のみ (choice variant が無い)
  //
  // stack window が開いた直後は pendingTriggeredEffects から外れる + actions に
  // resolve_pending_triggered_effect が含まれなくなるため、無限ループにならない。
  //
  // 2026-05-03 snapshot fix: 同名カード 2 枚が private 誘発で並列宣言されたあと、
  // どちらを解決するか select した状態で resolve ボタンが GUI に出ないまま
  // auto-fire も length !== 1 で止まり進行不能になっていた問題への対処。
  useEffect(() => {
    if (state.pendingTriggeredEffects.length === 0) return;
    const pending =
      state.pendingTriggeredEffects.length === 1
        ? state.pendingTriggeredEffects[0]
        : (state.pendingTriggeredEffects.find(
            (p) => p.selectedByTurnPlayer === true
          ) ?? null);
    if (!pending || pending.declaredFromPrivateZone !== true) return;
    if (pending.actingPlayerId !== viewingPlayer) return;
    if (hasUiPending) return;
    if (pendingEffectChoice !== null) return;
    const matching = actions.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        "pendingId" in a &&
        (a as { pendingId?: string }).pendingId === pending.pendingId &&
        (!("choiceIndex" in a) ||
          (a as { choiceIndex?: number }).choiceIndex === undefined)
    );
    if (matching.length !== 1) return;
    handleAction(matching[0]!);
  }, [
    state.pendingTriggeredEffects,
    actions,
    viewingPlayer,
    hasUiPending,
    pendingEffectChoice,
    handleAction,
  ]);

  const handleAdvanceStep = useCallback(() => {
    // 送信中の再押下 (連打) を無視。/step は非冪等なので並行 dispatch すると後発が
    // 409 を踏み、reconcile 応答が前後してステップ表示が往復したり余分に進んだりする。
    // 1 件ずつ直列化して、in-flight が解決してから次の遷移を受け付ける。
    if (dispatchPending) return;
    // room モード: ステップ進行はターンプレイヤーのみ。相手ターン中に「次のステップ」を
    // 押してもサーバが "Step advance allowed only for activePlayerId=..." で弾き、
    // 「同期失敗」バナーになるため、クライアント側で無効操作を弾く。
    if (roomId && state.activePlayerId !== viewingPlayer) {
      showMessage("相手のターンです");
      return;
    }
    try {
      // アタックステップの end_attack_step アクションがあればそれを使う
      const endAttackAction = actions.find((a) => a.kind === "end_attack_step");
      if (endAttackAction) {
        handleAction(endAttackAction);
        return;
      }
      const nextState = advanceStep(
        state,
        getDefinition,
        effectLookups.getRegisteredTriggeredEffectActions,
        effectLookups.getRegisteredBurstActions,
        effectLookups.getRegisteredMagicActions
      );
      setPublicDisclosureViewerActionSequence((sequence) => sequence + 1);
      setStateAndSync(nextState, "step");
      // メインステップ以外ではコア移動モードを解除
      if (nextState.step !== "main") {
        coreSelection.end();
        setCoreMoveFrom(null);
      }
    } catch (e) {
      console.error("Step advance failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStateAndSync / coreSelection are stable / intentional omissions
  }, [
    state,
    getDefinition,
    effectLookups,
    actions,
    handleAction,
    roomId,
    viewingPlayer,
    dispatchPending,
  ]);

  // 召喚/配置のコア配置を確定して実行
  const confirmPlacement = useCallback(() => {
    if (!pendingPlacement) return;
    const { action, def, finalCost } = pendingPlacement;
    try {
      // facade の draft (card_cost + placement) から payment + 配置を一括再構成
      const recomposed = recomposeSummonLegalAction(coreSelection.draftMoves);
      // engine の applyCardCostPayments は source 順に処理するため、reserve を先頭に並び替える
      // (旧 GUI が常に reserve 先頭で emit していた挙動に揃える)。
      const orderedPaymentSources: CardCostPaymentSource[] = [
        ...recomposed.paymentSources.filter((p) => p.kind === "reserve"),
        ...recomposed.paymentSources.filter((p) => p.kind !== "reserve"),
      ];
      const placements = recomposed.summonEnterFieldCorePlacements;

      let result;
      let dispatchPayload: Record<string, unknown>;
      // P3-34 B: 効果起点 summon は applyLegalAction (resolve_pending_triggered_effect) 経路で
      // summonPaymentSources / summonEnterFieldCorePlacements として渡す。
      if (
        action.kind === "resolve_pending_triggered_effect" ||
        action.kind === "use_hand_card_effect" ||
        action.kind === "resolve_reverse_rebirth_summon"
      ) {
        result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          summonPaymentSources: orderedPaymentSources,
          summonEnterFieldCorePlacements: placements,
        });
        dispatchPayload = {
          summonPaymentSources: orderedPaymentSources,
          summonEnterFieldCorePlacements: placements,
        };
      } else if (action.kind === "resolve_pending_enter_field_placement") {
        result = applyLegalAction({
          state,
          action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          enterFieldCorePlacements: placements,
        });
        dispatchPayload = {
          enterFieldCorePlacements: placements,
        };
      } else {
        const cardInstanceId = (
          action as SummonLegalAction | PlaceNexusLegalAction
        ).sourceInstanceId;
        if (action.kind === "place_nexus") {
          result = placeNexusAsAction({
            state,
            actingPlayerId: viewingPlayer,
            cardInstanceId,
            getCardDefinitionById: getDefinition,
            getRegisteredTriggeredEffectActions:
              effectLookups.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
            paymentSources: orderedPaymentSources,
            enterFieldCorePlacements: placements,
          });
        } else {
          result = playSummonAsAction({
            state,
            actingPlayerId: viewingPlayer,
            cardInstanceId,
            getCardDefinitionById: getDefinition,
            getRegisteredTriggeredEffectActions:
              effectLookups.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
            paymentSources: orderedPaymentSources,
            enterFieldCorePlacements: placements,
          });
        }
        dispatchPayload = {
          paymentSources: orderedPaymentSources,
          enterFieldCorePlacements: placements,
        };
      }
      setStateAndSync(result.state, action, dispatchPayload);
      const verb =
        action.kind === "place_nexus"
          ? "配置"
          : action.kind === "resolve_reverse_rebirth_summon"
            ? "逆転醒"
            : action.kind === "resolve_pending_enter_field_placement"
              ? def.printedCategory === "nexus"
                ? "配置"
                : "召喚"
              : action.kind === "resolve_pending_triggered_effect" ||
                  action.kind === "use_hand_card_effect"
                ? "効果召喚"
                : "召喚";
      showMessage(
        `${def.name} を${verb}！ (コスト${finalCost} + コア${placementTotal}${summonUseSoul ? " [ソウルコア含む]" : ""})`
      );
    } catch (e) {
      showMessage(`エラー: ${userFacingError(e)}`);
    }
    setPendingPlacement(null);
    coreSelection.end();
    setDeclinedSoulLocations(new Set());
  }, [
    pendingPlacement,
    placementTotal,
    summonUseSoul,
    state,
    viewingPlayer,
    getDefinition,
    effectLookups,
    setStateAndSync,
    coreSelection,
  ]);

  // コスト支払い確定 → マジックは即実行、召喚/配置はコア配置ステップへ
  // P3-46 sub-step 3: paymentSources は `recomposeMagicLegalAction` で
  // `coreSelection.draftMoves` (purpose: "card_cost") から組み立てる。召喚遷移時は
  // `transitionMode("placement")` で draft を保持し、`confirmPlacement` 内の
  // `recomposeSummonLegalAction` で payment portion を再利用する。
  const startHandGainCostPayment = (
    action: LegalAction,
    source: {
      actingPlayerId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
    },
    finalCost: number,
    handGainPayload: NonNullable<PendingCostPaymentState["handGainPayload"]>
  ) => {
    const selectedIds =
      handGainPayload.selectedDeckRevealCardIds ??
      handGainPayload.selectedZoneCardIds ??
      [];
    const def =
      getDefinition(source.sourceDefinitionId) ??
      getDefinition(
        state.cardInstances.find((c) => c.instanceId === selectedIds[0])
          ?.definitionId ?? ""
      );
    if (!def) return;
    const available = getHandGainCostPaymentSources(
      state,
      { ...source, sourceDefinitionId: def.cardNo },
      getDefinition
    );
    coreSelection.start("card_cost");
    setDeclinedSoulLocations(new Set());
    setPendingCostPayment({
      action,
      def,
      finalCost,
      reserveAvailable: available.reserveSource.availableCoreAmount,
      reserveNormal:
        state.players.find((p) => p.id === source.actingPlayerId)
          ?.reserveNormalCoreCount ?? 0,
      fieldSources: available.onBoardCoreSources.map((s) => ({
        instanceId: s.instanceId,
        definitionId: s.definitionId,
        maxAmount: s.availableCoreAmount,
        soulCoreOnly: false,
        ...(s.destination ? { destination: s.destination } : {}),
      })),
      minCoresForPlacement: 0,
      handGainPayload,
    });
  };

  const confirmCostPayment = useCallback(
    (declineHandGain = false) => {
      if (
        !pendingCostPayment ||
        (!costPaymentValid &&
          !(declineHandGain && pendingCostPayment.handGainPayload))
      )
        return;
      const { action, def, finalCost } = pendingCostPayment;

      // recompose で payment payload を再構築。order は draft 出現順なので、
      // tap 順序が反映される (旧実装は reserve を先頭固定だったが、
      // tap 順序はユーザーの意図に沿うため drift しても害はない)。
      const { paymentSources } = recomposeMagicLegalAction(
        coreSelection.draftMoves
      );

      // 旧コードと整合させるため reserve を先頭に並べ替える (engine 側 source 順処理)。
      const orderedPaymentSources: CardCostPaymentSource[] = [
        ...paymentSources.filter((p) => p.kind === "reserve"),
        ...paymentSources.filter((p) => p.kind !== "reserve"),
      ];

      if (pendingCostPayment.handGainPayload) {
        const payload = {
          ...pendingCostPayment.handGainPayload,
          ...(declineHandGain &&
          pendingCostPayment.handGainPayload.selectedDeckRevealCardIds
            ? { selectedDeckRevealCardIds: [] }
            : {}),
          paymentSources: declineHandGain ? [] : orderedPaymentSources,
        };
        try {
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            ...payload,
          });
          setStateAndSync(result.state, action, payload);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        setDeclinedSoulLocations(new Set());
        return;
      }

      // P3-160: 戦力投入の支払い前使用は、resolver の中に保持した通常 use_magic の
      // 支払い候補を使う。ここで nested action を単独 dispatch せず、resolver action
      // に paymentSources を添えて送ることで、元マジックの pending を保ったまま
      // 戦力投入自身の共通使用・スタック経路へ入る。
      if (pendingCostPayment.mode === "field_magic_pre_cost") {
        if (
          action.kind !== "resolve_field_magic_pre_cost_trigger" ||
          !action.triggerMagicUse ||
          pendingCostPayment.fieldMagicPreCostTriggerDecision !== "trigger"
        ) {
          showMessage("エラー: 戦力投入の使用コスト情報が不正です");
          setPendingCostPayment(null);
          coreSelection.end();
          return;
        }
        const dispatchPayload = {
          fieldMagicPreCostTriggerDecision: "trigger" as const,
          paymentSources: orderedPaymentSources,
        };
        try {
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            ...dispatchPayload,
          });
          setStateAndSync(result.state, action, dispatchPayload);
          showMessage(`${def.name} を使用！ (コスト${finalCost})`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        return;
      }

      if (action.kind === "use_magic") {
        const ma = action as UseMagicLegalAction;
        // コアの候補・個数も効果解決時の engine pending に従う。
        // 支払い時の先行選択は創界神系の除外やスタック後の状態を反映できない。
        try {
          const result = applyLegalAction({
            state,
            action: ma,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: orderedPaymentSources,
            ...(pendingCostPayment.selectedZoneCardIds
              ? { selectedZoneCardIds: pendingCostPayment.selectedZoneCardIds }
              : {}),
          });
          setStateAndSync(result.state, ma, {
            paymentSources: orderedPaymentSources,
            ...(pendingCostPayment.selectedZoneCardIds
              ? { selectedZoneCardIds: pendingCostPayment.selectedZoneCardIds }
              : {}),
          });
          showMessage(`${def.name} を使用！ (コスト${finalCost})`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        return;
      }

      // P3-110: 即時型コスト召喚 (resolve_pending_triggered_effect / use_hand_card_effect 経由) は
      // コスト支払い後に payment のみで dispatch する。維持コアは発揮応答スタック窓クローズ後に
      // engine が立てる pendingMultiPlacement を既存 UI が収集する (即時型 = 宣言→スタック→
      // コスト→維持コア)。旧挙動 (コスト支払い後に placement モーダルへ遷移) は維持コアが窓より
      // 前に出る順序逆転だった。常時型/合法手拡張型 (summon-permission の kind:"summon") は
      // 別経路 (play_card, pendingEnterFieldPlacement) で不変。
      if (pendingCostPayment.mode === "summon_in_trigger") {
        const summonTargetId = pendingCostPayment.summonTargetInstanceId;
        if (!summonTargetId) {
          showMessage(
            "エラー: 効果起点 summon の対象 instanceId が不明 (summonTargetInstanceId 未設定)"
          );
          setPendingCostPayment(null);
          coreSelection.end();
          setDeclinedSoulLocations(new Set());
          return;
        }
        try {
          const summonTargets = pendingCostPayment.payCostTargetInstanceIds;
          const dispatchPayload: Record<string, unknown> = {
            summonPaymentSources: orderedPaymentSources,
            ...(summonTargets ? { targetInstanceIds: summonTargets } : {}),
          };
          const result = applyLegalAction({
            state,
            action,
            ...(summonTargets ? { targetInstanceIds: summonTargets } : {}),
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            summonPaymentSources: orderedPaymentSources,
          });
          setStateAndSync(result.state, action, dispatchPayload);
          showMessage(`${def.name} 効果召喚 (コスト${finalCost} 支払い)`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        setDeclinedSoulLocations(new Set());
        return;
      }

      if (action.kind === "use_accel" || action.kind === "use_change") {
        try {
          const acResult = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: orderedPaymentSources,
          });
          setStateAndSync(acResult.state, action, {
            paymentSources: orderedPaymentSources,
          });
          const label = action.kind === "use_accel" ? "アクセル" : "チェンジ";
          showMessage(`${def.name} を${label}使用！ (コスト${finalCost})`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        return;
      }

      // 召喚コスト・トラッシュ除外選択の確定: SummonCostExcludeChoiceModal で決めた
      // 除外カードと支払いソースを同一 apply 呼び出しにまとめて送る。宣言後の維持コア配置は
      // 通常 summon と同じく engine の pendingEnterFieldPlacement に委ねる。
      if (action.kind === "resolve_pending_summon_cost_exclude_choice") {
        const excludeIds =
          pendingCostPayment.summonCostExcludeSelectedCardInstanceIds ?? [];
        try {
          const dispatchPayload: Record<string, unknown> = {
            paymentSources: orderedPaymentSources,
            summonCostExcludeSelectedCardInstanceIds: excludeIds,
          };
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: orderedPaymentSources,
            summonCostExcludeSelectedCardInstanceIds: excludeIds,
          });
          setStateAndSync(result.state, action, dispatchPayload);
          showMessage(
            `${def.name} を宣言しました (コスト${finalCost}、除外${excludeIds.length}枚)`
          );
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        setDeclinedSoulLocations(new Set());
        return;
      }

      // 召喚 / 配置: コスト支払い後はスタック窓を開くだけで宣言を送る。維持コア配置は
      // engine がスタック窓クローズ後に pendingEnterFieldPlacement として出すので、ここでは
      // placement モードへ遷移しない (= 配置選択を遅延)。ブレイヴ召喚も同様で、合体する/
      // スピリット状態の選択は窓クローズ後の engine `pendingBraveCombineChoice` で行う
      // (合体可否はスタック窓より後)。
      if (action.kind === "summon" || action.kind === "place_nexus") {
        try {
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: orderedPaymentSources,
          });
          setStateAndSync(result.state, action, {
            paymentSources: orderedPaymentSources,
          });
          showMessage(`${def.name} を宣言しました (コスト${finalCost})`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        setDeclinedSoulLocations(new Set());
        return;
      }

      // P3-128: ミラージュセットのコスト支払い確定。マジック/アクセルと同型 (choice なし)。
      if (action.kind === "set_mirage") {
        try {
          const result = applyLegalAction({
            state,
            action,
            getCardDefinitionById: getDefinition,
            ...effectLookups,
            paymentSources: orderedPaymentSources,
          });
          setStateAndSync(result.state, action, {
            paymentSources: orderedPaymentSources,
          });
          showMessage(`${def.name} をミラージュセット！ (コスト${finalCost})`);
        } catch (e) {
          showMessage(`エラー: ${userFacingError(e)}`);
        }
        setPendingCostPayment(null);
        coreSelection.end();
        return;
      }

      // 召喚 / 配置 / アクセル / チェンジ / ミラージュセット以外がここに到達することはない
      // (ブレイヴ召喚も上の遅延配置ブロックで return 済み)。
    },
    [
      pendingCostPayment,
      costPaymentValid,
      state,
      getDefinition,
      effectLookups,
      setStateAndSync,
      coreSelection,
    ]
  );

  // コアシュート確定
  const confirmCoreShoot = useCallback(() => {
    if (!pendingCoreShoot || !coreShootValid) return;
    try {
      const recomposed = recomposeCoreShootLegalAction(
        coreSelection.draftMoves
      );
      const soulOption = recomposed.coreShootSoulCoreInstanceId
        ? {
            coreShootSoulCoreInstanceId: recomposed.coreShootSoulCoreInstanceId,
          }
        : {};
      {
        // GameState pending 経由: applyLegalAction で resolve
        const csAction = actions.find(
          (a) => a.kind === "resolve_pending_core_shoot"
        );
        if (!csAction) {
          showMessage("エラー: コアシュートアクションが見つかりません");
          return;
        }
        const result = applyLegalAction({
          state,
          action: csAction,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          coreShootDistribution: recomposed.coreShootDistribution,
          ...soulOption,
        });
        setStateAndSync(result.state, csAction, {
          coreShootDistribution: recomposed.coreShootDistribution,
          ...soulOption,
        });
        showMessage(`${pendingCoreShoot.magicDef.name} — コアシュート！`);
      }
    } catch (e) {
      showMessage(`エラー: ${userFacingError(e)}`);
    }
    setPendingCoreShoot(null);
    coreSelection.end();
    setDeclinedSoulLocations(new Set());
  }, [
    pendingCoreShoot,
    coreShootValid,
    state,
    getDefinition,
    actions,
    effectLookups,
    setStateAndSync,
    coreSelection,
  ]);

  // 分離確定
  // P3-64 Phase B-5: room モードでは専用 endpoint dispatchBraveSeparation 経由で
  // applyLegalAction + moveSoulCore を server-side で原子的に合成。
  // single-player では従来通り pushState fallback。
  const confirmSeparation = useCallback(() => {
    if (!pendingSeparation || separationTotal < pendingSeparation.minCores)
      return;
    // 二重送信ガード: 既に brave-separation dispatch が in-flight なら無視 (連打防止)。
    if (specialDispatchInFlightRef.current) return;
    try {
      const recomposed = recomposeBraveSeparationLegalAction(
        coreSelection.draftMoves
      );
      const result = applyBraveSeparationWithCores(
        {
          state,
          action: pendingSeparation.action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          separateCoreDistribution: recomposed.separateCoreDistribution,
        },
        recomposed.separationSoulCoreSource,
        pendingSeparation.braveInstanceId
      );
      const newState = result.state;
      setState(newState);
      if (roomId) {
        const separationPayload = {
          actionId: pendingSeparation.action.actionId,
          separateCoreDistribution: recomposed.separateCoreDistribution,
          ...(recomposed.separationSoulCoreSource
            ? {
                separationSoulCoreSource: recomposed.separationSoulCoreSource,
                braveInstanceId: pendingSeparation.braveInstanceId,
              }
            : {}),
        };
        specialDispatchInFlightRef.current = true;
        const queued = queueRoomSpecialMutation(
          roomSpecialDispatchSignature("brave-separation", separationPayload),
          async () => {
            try {
              return await dispatchBraveSeparation(separationPayload);
            } finally {
              specialDispatchInFlightRef.current = false;
            }
          },
          () => {
            specialDispatchInFlightRef.current = false;
          }
        );
        if (!queued) {
          specialDispatchInFlightRef.current = false;
        }
      } else {
        pushState(newState);
      }
    } catch (e) {
      showMessage(`分離失敗: ${userFacingError(e)}`);
    }
    setPendingSeparation(null);
    coreSelection.end();
    setDeclinedSoulLocations(new Set());
  }, [
    pendingSeparation,
    separationTotal,
    state,
    getDefinition,
    effectLookups,
    coreSelection,
    roomId,
    dispatchBraveSeparation,
    queueRoomSpecialMutation,
    pushState,
    setState,
  ]);

  // P3-49 placement_multi: 完了 (resolve_pending_multi_placement dispatch)
  // P3-79: displayState ガードで非解決者からの誤発火を防ぐ。
  const confirmMultiPlacement = useCallback(() => {
    const mp = displayState.pendingMultiPlacement;
    if (!mp) return;
    const resolveAction = actions.find(
      (a) => a.kind === "resolve_pending_multi_placement"
    );
    if (!resolveAction) {
      showMessage(
        "エラー: resolve_pending_multi_placement アクションが見つかりません"
      );
      return;
    }
    try {
      const recomposed = recomposeMultiPlacement(coreSelection.draftMoves);
      const result = applyLegalAction({
        state,
        action: resolveAction,
        getCardDefinitionById: getDefinition,
        ...effectLookups,
        multiPlacementAllocations: recomposed.multiPlacementAllocations,
      });
      setStateAndSync(result.state, resolveAction, {
        multiPlacementAllocations: recomposed.multiPlacementAllocations,
      });
    } catch (e) {
      showMessage(`配置失敗: ${userFacingError(e)}`);
      return;
    }
    coreSelection.end();
    setDeclinedSoulLocations(new Set());
  }, [
    state,
    displayState.pendingMultiPlacement,
    actions,
    getDefinition,
    effectLookups,
    setStateAndSync,
    coreSelection,
  ]);

  // P3-49 placement_multi: キャンセル (abort_pending_multi_placement dispatch、snapshot 復元)
  // P3-79: displayState ガードで非解決者からの誤発火を防ぐ。
  const abortMultiPlacement = useCallback(() => {
    const mp = displayState.pendingMultiPlacement;
    if (!mp) return;
    const abortAction = actions.find(
      (a) => a.kind === "abort_pending_multi_placement"
    );
    if (!abortAction) {
      // snapshot 無し → coreSelection だけ end してフォールバック
      coreSelection.end();
      setDeclinedSoulLocations(new Set());
      return;
    }
    try {
      const result = applyLegalAction({
        state,
        action: abortAction,
        getCardDefinitionById: getDefinition,
        ...effectLookups,
      });
      setStateAndSync(result.state, abortAction);
    } catch (e) {
      showMessage(`キャンセル失敗: ${userFacingError(e)}`);
    }
    coreSelection.end();
    setDeclinedSoulLocations(new Set());
  }, [
    state,
    displayState.pendingMultiPlacement,
    actions,
    getDefinition,
    effectLookups,
    setStateAndSync,
    coreSelection,
  ]);

  const resolveChangeCleanupChoice = useCallback(
    (swapTargetInstanceId: string | null) => {
      if (!changeCleanupChoice) return;
      const selectedAction =
        swapTargetInstanceId === null
          ? changeCleanupChoice.trashAction
          : changeCleanupChoice.actions.find(
              (action) =>
                action.outcome === "swap" &&
                action.swapTargetInstanceId === swapTargetInstanceId
            );
      if (!selectedAction) {
        showMessage("チェンジ後処理の候補が見つかりません");
        return;
      }
      try {
        const result = applyLegalAction({
          state,
          action: selectedAction,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, selectedAction);
        showMessage(
          selectedAction.outcome === "swap"
            ? "チェンジ: 入れ替え完了"
            : "チェンジ: 破棄"
        );
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    },
    [changeCleanupChoice, state, getDefinition, effectLookups, setStateAndSync]
  );

  const handleHandCardDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setFieldDragOver(false);
      const instanceId = e.dataTransfer.getData("text/plain");
      if (!instanceId) return;

      const cardActions = actions.filter(
        (a) => "sourceInstanceId" in a && a.sourceInstanceId === instanceId
      );
      if (cardActions.length === 0) return;

      setDroppedCardChoice({ instanceId, actions: cardActions });
    },
    [actions, handleAction] // eslint-disable-line react-hooks/exhaustive-deps -- getDefinition/state.cardInstances are stable within render
  );

  const clearBattleSelections = useCallback(() => {
    setMessage(null);
    setPendingAction(null);
    setSelectedTargets([]);
    setPendingPlacement(null);
    setPendingCostPayment(null);
    setDroppedCardChoice(null);
    coreSelection.end();
    setPregameFirstPlayerOverride(null);
  }, [coreSelection]);

  // Replay replaces the authoritative board without running the handlers that
  // normally finish a selection. Discard frame-local UI before committing the
  // new board, so its pending effects can initialize fresh selections afterward.
  // Keep BattleScreen mounted: card motion and disclosure animations need it.
  const [previousReplayState, setPreviousReplayState] = useState(replayState);
  if (replayState !== previousReplayState) {
    setPreviousReplayState(replayState);
    if (readOnly && replayState) {
      clearBattleSelections();
      setDetailCard(null);
      setZoneBrowse(null);
      setFieldStackBrowse(null);
      setTargetBrowseOpen(false);
      setMoreMenuOpen(false);
      setPendingSeparation(null);
      setPendingCoreShoot(null);
      setPendingMagicZoneCostSelection(null);
      setPendingEffectChoice(null);
      setFieldCardChoice(null);
      setMagicEffectChoice(null);
      setMagicCostModeChoice(null);
      setAccelCostModeChoice(null);
      setAsIfSoulCoreChoice(null);
      setFieldEffectChoice(null);
      setAttackCostSourceChoice(null);
      setBurstConfirmationActionId(null);
      setCoreMoveFrom(null);
      setMultiSourceActiveKey(null);
      setSoulCoreConfirm(null);
      setDeclinedSoulLocations(new Set());
      setTrashDistSoulMode(false);
      setHandPendingSelectedIds([]);
      setHandDiscardGateSelectedIds([]);
      setActiveQueueItemId(null);
      setModalsHidden(false);
    }
  }

  const roomGameNumber = state.roomReset?.gameNumber ?? 0;
  const previousRoomGameNumber = useRef(roomGameNumber);
  useEffect(() => {
    if (previousRoomGameNumber.current !== roomGameNumber) {
      previousRoomGameNumber.current = roomGameNumber;
      clearBattleSelections();
    }
  }, [roomGameNumber, clearBattleSelections]);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetOperationRef = useRef(false);
  const handleRoomReset = async (approve?: boolean) => {
    if (readOnly || resetOperationRef.current) return;
    resetOperationRef.current = true;
    setResetBusy(true);
    setResetError(null);
    try {
      const result = await dispatchReset(approve);
      await reconcileRoomDispatchResult(result);
      if (!result.ok) {
        setResetError(
          "リセットの申請・応答を送信できませんでした。最新の状態を確認して再度お試しください。"
        );
      }
    } catch {
      setResetError(
        "リセットの申請・応答を送信できませんでした。接続状態を確認してください。"
      );
    } finally {
      resetOperationRef.current = false;
      setResetBusy(false);
    }
  };
  const handleReset = () => {
    if (roomId) {
      void handleRoomReset();
      return;
    }
    setStateAndSync(
      createDemoGameState(cardDefs, aliceDeck, bobDeck, firstPlayerIndex)
    );
    clearBattleSelections();
  };
  const resetDisabled =
    !!roomId &&
    (resetBusy ||
      dispatchPending ||
      !!state.gameResult ||
      !!state.roomReset?.requestedBy ||
      !!state.roomReset?.usedBy.includes(viewingPlayer));

  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const resultOperationRef = useRef(false);
  const handleRematch = async () => {
    if (readOnly || resultOperationRef.current) return;
    if (!roomId) {
      onLocalRematch();
      return;
    }
    resultOperationRef.current = true;
    setResultBusy(true);
    setResultError(null);
    try {
      const result = await dispatchRematch();
      if (result.state) applyRoomAuthoritativeState(result.state);
      // A simultaneous rematch by the other player already reached the intended state.
      if (!result.ok && result.state && !result.state.gameResult) return;
      if (!result.ok)
        throw new Error(
          "再戦を開始できませんでした。対戦の接続状態を確認して再度お試しください。"
        );
      if (!result.state) {
        const next = await resetPolling();
        if (next) applyRoomAuthoritativeState(next);
      }
    } catch (error) {
      setResultError(userFacingError(error, "再戦を開始できませんでした"));
    } finally {
      resultOperationRef.current = false;
      setResultBusy(false);
    }
  };
  const handleSaveReplay = async () => {
    if (readOnly || resultOperationRef.current) return;
    resultOperationRef.current = true;
    setResultBusy(true);
    setResultError(null);
    try {
      downloadReplay(await recording.file("対戦棋譜"));
    } catch {
      setResultError("棋譜を保存できませんでした。再度お試しください。");
    } finally {
      resultOperationRef.current = false;
      setResultBusy(false);
    }
  };

  // ブロック辞退: P3-55 Phase B で防御側自身の decline_block を発火する。
  // 旧実装は active 側 start_battle_resolution へのプロキシだったが、Phase B で
  // 防御側 (viewingPlayer) の意思表示エンドポイントとして decline_block legal action
  // を新設したため、自分自身のアクションとして apply する。
  const handleDeclineBlock = useCallback(() => {
    const myDeclineActions = getLegalActions({
      state,
      actingPlayerId: viewingPlayer,
      getCardDefinitionById: getDefinition,
      ...effectLookups,
    });
    const decline = myDeclineActions.find((a) => a.kind === "decline_block");
    if (decline) {
      try {
        const result = applyLegalAction({
          state,
          action: decline,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
        });
        setStateAndSync(result.state, decline);
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
    }
  }, [state, viewingPlayer, getDefinition]); // eslint-disable-line react-hooks/exhaustive-deps -- effectLookups/setStateAndSync are stable refs

  // --- キーボードショートカット ---
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // テキスト入力中は無視
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // ? → ショートカットヘルプ
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowKeyboardHelp((prev) => !prev);
        return;
      }

      // Escape → モーダル/モード閉じ
      if (e.key === "Escape") {
        if (showKeyboardHelp) {
          setShowKeyboardHelp(false);
          return;
        }
        if (detailCard) {
          setDetailCard(null);
          return;
        }
        if (fieldStackBrowse) {
          setFieldStackBrowse(null);
          return;
        }
        if (zoneBrowse) {
          setZoneBrowse(null);
          return;
        }
        if (droppedCardChoice || fieldCardChoice) {
          setDroppedCardChoice(null);
          setFieldCardChoice(null);
          return;
        }
        return;
      }

      // Space / Enter → パス / 決定（最初のパス系ボタン）
      if (e.key === " " || e.key === "Enter") {
        // 既にモーダルが開いてる場合はスキップ
        if (
          detailCard ||
          fieldStackBrowse ||
          zoneBrowse ||
          droppedCardChoice ||
          fieldCardChoice
        )
          return;
        const passAction = actions.find(
          (a) =>
            a.kind === "pass_battle_flash" ||
            a.kind === "pass_stack" ||
            a.kind === "pass_pre_declaration_stack"
        );
        if (passAction) {
          e.preventDefault();
          handleAction(passAction);
          return;
        }
        // end_attack_step
        const endAtk = actions.find((a) => a.kind === "end_attack_step");
        if (endAtk) {
          e.preventDefault();
          handleAction(endAtk);
          return;
        }
        return;
      }

      // D → 直前のアタッカーや最後に操作したカードの詳細（フィールド先頭カード）
      if (e.key === "d" || e.key === "D") {
        const myField = state.cardInstances.filter(
          (c) => c.controllerPlayerId === viewingPlayer && c.zone === "field"
        );
        if (myField.length > 0) {
          setDetailCard(myField[0]!);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    actions,
    handleAction,
    detailCard,
    fieldStackBrowse,
    zoneBrowse,
    droppedCardChoice,
    fieldCardChoice,
    showKeyboardHelp,
    state,
    viewingPlayer,
  ]);

  // ルーム対戦: サーバーから state を受け取るまでローディング表示
  if (!state) {
    return (
      <div
        className="battle-screen"
        data-room-version={roomId ? roomStateVersion.current : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", color: "#aaa" }}>
          <p style={{ fontSize: "1.2em" }}>ゲームデータを読み込み中...</p>
          <button
            className="setup-btn"
            onClick={handleExit}
            style={{ marginTop: "1em" }}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  type SimplePendingDecisionButton = {
    key: string;
    label: string;
    action: LegalAction;
    payload?: Record<string, unknown>;
    tone?: "primary" | "skip";
  };
  type SimplePendingDecision = {
    key: string;
    title: string;
    description: string;
    buttons: SimplePendingDecisionButton[];
  };

  const cardNameForInstance = (instanceId: string): string => {
    if (instanceId === "reserve") return "リザーブ";
    const card = state.cardInstances.find((c) => c.instanceId === instanceId);
    return card
      ? (getDefinition(card.definitionId)?.name ?? instanceId)
      : instanceId;
  };

  const sourceNameForAction = (action: LegalAction): string | null => {
    if ("sourceInstanceId" in action) {
      return cardNameForInstance(action.sourceInstanceId);
    }
    if ("sourceDefinitionId" in action) {
      return (
        getDefinition(action.sourceDefinitionId)?.name ??
        action.sourceDefinitionId
      );
    }
    return null;
  };

  const simpleDecisionLabel = (action: LegalAction): string => {
    switch (action.kind) {
      case "resolve_advent_source_replacement":
        return action.choice === "trash"
          ? "トラッシュに置く"
          : `煌臨元へ追加: ${action.hostInstanceId ? cardNameForInstance(action.hostInstanceId) : "候補"}`;
      case "resolve_soul_state_replacement":
        return action.choice === "keep" ? "魂状態で残す" : "通常どおり離れる";
      case "resolve_borrowed_effect_choice":
        return `効果${action.borrowedEffectIndex + 1}を使う`;
      default:
        return getActionLabel(action);
    }
  };

  const turnFaceDownChoice = getTurnFaceDownChoice(
    displayState.pendingStepOptionalChoice
  );
  const simplePendingDecision: SimplePendingDecision | null = (() => {
    // C12 の pre-cost resolver は pending を保持したまま通常のカードコスト HUD を開く。
    // HUD が優先されないと resolver 選択 overlay が盤面支払い元へのポインタ操作を遮る。
    if (pendingCostPayment !== null || cardSelection.choice) return null;
    const buttonsFor = (
      kinds: readonly LegalAction["kind"][],
      predicate?: (action: LegalAction) => boolean
    ) =>
      actions
        .filter(
          (action) =>
            kinds.includes(action.kind) && (!predicate || predicate(action))
        )
        .map((action) => ({
          key: action.actionId,
          label: simpleDecisionLabel(action),
          action,
          tone:
            action.kind.startsWith("decline_") ||
            ("choice" in action &&
              (action as { choice?: string }).choice === "decline") ||
            ("choice" in action &&
              (action as { choice?: string }).choice === "trash") ||
            ("choice" in action &&
              (action as { choice?: string }).choice === "end")
              ? ("skip" as const)
              : ("primary" as const),
        }));

    const adventReplacement = displayState.pendingAdventSourceReplacement;
    if (adventReplacement) {
      const buttons = buttonsFor(
        ["resolve_advent_source_replacement"],
        (action) =>
          action.kind === "resolve_advent_source_replacement" &&
          action.cardInstanceId === adventReplacement.cardInstanceId
      );
      if (buttons.length > 0) {
        return {
          key: `advent-source:${adventReplacement.cardInstanceId}`,
          title: "煌臨元への追加",
          description: `${cardNameForInstance(adventReplacement.cardInstanceId)} の行き先を選択してください`,
          buttons,
        };
      }
    }

    const faceDownPending = displayState.pendingStepOptionalChoice;
    if (
      turnFaceDownChoice &&
      faceDownPending?.choosingPlayerId === viewingPlayer
    ) {
      const soul = turnFaceDownChoice.resolution === "soul_state";
      const buttons = myActions
        .filter(
          (action) =>
            action.kind === "resolve_pending_step_optional_choice" &&
            action.pendingId === faceDownPending.pendingId
        )
        .map((action) => ({
          key: action.actionId,
          action,
          label:
            "choice" in action && action.choice === "execute"
              ? soul
                ? "魂状態にする"
                : "分離する"
              : soul
                ? "裏向きにする"
                : "一緒に裏向きにする",
          tone:
            "choice" in action && action.choice === "decline"
              ? ("skip" as const)
              : ("primary" as const),
        }));
      if (buttons.length > 0)
        return {
          key: faceDownPending.pendingId,
          title: soul ? "魂状態の選択" : "ブレイヴの選択",
          description: `「${cardNameForInstance(turnFaceDownChoice.instanceId)}」を${soul ? "魂状態に" : "分離"}しますか？${soul ? "裏向きにする代わりに魂状態にできます。" : "分離しない場合は一緒に裏向きになります。"}`,
          buttons,
        };
    }

    const soulReplacement = displayState.pendingSoulStateReplacement;
    if (soulReplacement) {
      const buttons = buttonsFor(
        ["resolve_soul_state_replacement"],
        (action) =>
          action.kind === "resolve_soul_state_replacement" &&
          action.cardInstanceId === soulReplacement.cardInstanceId
      );
      if (buttons.length > 0) {
        return {
          key: `soul-state:${soulReplacement.cardInstanceId}`,
          title: "魂状態置換",
          description: `${cardNameForInstance(soulReplacement.cardInstanceId)} を魂状態で残しますか？`,
          buttons,
        };
      }
    }

    const setAsideReplacement =
      displayState.pendingSetAsideExitReplacementChoice;
    if (setAsideReplacement) {
      const buttons = buttonsFor(
        ["resolve_set_aside_exit_replacement_choice"],
        (action) =>
          action.kind === "resolve_set_aside_exit_replacement_choice" &&
          action.cardInstanceId === setAsideReplacement.cardInstanceId
      );
      if (buttons.length > 0) {
        return {
          key: `set-aside-exit:${setAsideReplacement.cardInstanceId}`,
          title: "除外置換",
          description: `${cardNameForInstance(setAsideReplacement.cardInstanceId)} の処理を選択してください`,
          buttons,
        };
      }
    }

    const connectDecision = displayState.pendingConnectBattleDecision;
    if (connectDecision) {
      const buttons = buttonsFor(
        ["resolve_connect_battle_decision"],
        (action) =>
          action.kind === "resolve_connect_battle_decision" &&
          action.pendingId === connectDecision.pendingId
      );
      if (buttons.length > 0) {
        return {
          key: `connect-battle:${connectDecision.pendingId}`,
          title: "連続バトル",
          description: "続けてバトルするか選択してください",
          buttons,
        };
      }
    }

    const deckBoost = displayState.pendingDeckRevealCountBoostChoice;
    if (deckBoost) {
      const buttons = buttonsFor(
        ["resolve_pending_deck_reveal_count_boost_choice"],
        (action) =>
          action.kind === "resolve_pending_deck_reveal_count_boost_choice" &&
          action.pendingId === deckBoost.pendingId
      );
      if (buttons.length > 0) {
        return {
          key: `deck-boost:${deckBoost.pendingId}`,
          title: "デッキオープン枚数",
          description: `オープン枚数を+${deckBoost.bonusAmount}しますか？`,
          buttons,
        };
      }
    }

    const borrowedChoice = displayState.pendingBorrowedEffectChoice;
    if (borrowedChoice) {
      const buttons = buttonsFor(
        ["resolve_borrowed_effect_choice"],
        (action) =>
          action.kind === "resolve_borrowed_effect_choice" &&
          action.pendingId === borrowedChoice.pendingId
      );
      if (buttons.length > 0) {
        return {
          key: `borrowed-choice:${borrowedChoice.pendingId}`,
          title: "借用効果選択",
          description: `${cardNameForInstance(borrowedChoice.targetInstanceId)} から使う効果を選択してください`,
          buttons,
        };
      }
    }

    const fieldMagicPreCost = displayState.pendingFieldMagicPreCostTrigger;
    if (fieldMagicPreCost) {
      const action = actions.find(
        (candidate) => candidate.kind === "resolve_field_magic_pre_cost_trigger"
      );
      if (action) {
        const sourceName = sourceNameForAction(action) ?? "このカード";
        const triggerCost = action.triggerMagicUse?.finalCost;
        const canTrigger = action.triggerMagicUse !== undefined;
        return {
          key: `field-magic-pre-cost:${fieldMagicPreCost.pendingId}`,
          title: "コスト支払い前の効果",
          description: !canTrigger
            ? `${sourceName} の使用コストを支払えないため、先に使うことはできません`
            : triggerCost === undefined
              ? `${sourceName} の効果を先に使いますか？`
              : `${sourceName} をコスト${triggerCost}で先に使用しますか？`,
          buttons: [
            ...(canTrigger
              ? [
                  {
                    key: `${action.actionId}:trigger`,
                    label: "先に効果を使う",
                    action,
                    payload: { fieldMagicPreCostTriggerDecision: "trigger" },
                    tone: "primary" as const,
                  },
                ]
              : []),
            {
              key: `${action.actionId}:decline`,
              label: "使わず続ける",
              action,
              payload: { fieldMagicPreCostTriggerDecision: "decline" },
              tone: "skip" as const,
            },
          ],
        };
      }
    }

    return null;
  })();

  const applySimplePendingDecision = (button: SimplePendingDecisionButton) => {
    if (button.payload === undefined) {
      handleAction(button.action);
      return;
    }
    if (
      button.action.kind === "resolve_field_magic_pre_cost_trigger" &&
      button.payload?.fieldMagicPreCostTriggerDecision === "trigger" &&
      button.action.triggerMagicUse
    ) {
      const triggerMagicUse = button.action.triggerMagicUse;
      const def = getDefinition(triggerMagicUse.sourceDefinitionId);
      const player = state.players.find((p) => p.id === viewingPlayer);
      if (!def || !player) {
        showMessage("エラー: 戦力投入の使用元が見つかりません");
        return;
      }
      const fieldSources: CostPaymentFieldSource[] = [
        ...triggerMagicUse.availableOnBoardCoreSources.map((source) => ({
          instanceId: source.instanceId,
          definitionId: source.definitionId,
          maxAmount: source.availableCoreAmount,
          soulCoreOnly: false,
          ...(source.destination ? { destination: source.destination } : {}),
        })),
        ...triggerMagicUse.availableSoulCoreOnlySources.map((source) => ({
          instanceId: source.instanceId,
          definitionId: source.definitionId,
          maxAmount: source.availableSoulCoreAmount,
          soulCoreOnly: true,
        })),
      ];
      const automaticPaymentSources = getAutomaticCostPaymentSources(
        state,
        viewingPlayer,
        triggerMagicUse.finalCost,
        triggerMagicUse.availableReserveCoreAmount,
        fieldSources
      );
      if (automaticPaymentSources === null) {
        coreSelection.start("card_cost");
        setPendingCostPayment({
          action: button.action,
          def,
          finalCost: triggerMagicUse.finalCost,
          reserveAvailable: triggerMagicUse.availableReserveCoreAmount,
          reserveNormal: player.reserveNormalCoreCount,
          fieldSources,
          minCoresForPlacement: 0,
          mode: "field_magic_pre_cost",
          fieldMagicPreCostTriggerDecision: "trigger",
        });
        return;
      }
      const paymentSources: CardCostPaymentSource[] = automaticPaymentSources;
      const payload = {
        fieldMagicPreCostTriggerDecision: "trigger" as const,
        paymentSources,
      };
      try {
        const result = applyLegalAction({
          state,
          action: button.action,
          getCardDefinitionById: getDefinition,
          ...effectLookups,
          ...payload,
        });
        setStateAndSync(result.state, button.action, payload);
        showMessage(
          `${def.name} を使用！ (コスト${triggerMagicUse.finalCost})`
        );
      } catch (e) {
        showMessage(`エラー: ${userFacingError(e)}`);
      }
      return;
    }
    try {
      const result = applyLegalAction({
        state,
        action: button.action,
        getCardDefinitionById: getDefinition,
        ...effectLookups,
        ...button.payload,
      });
      setStateAndSync(result.state, button.action, button.payload);
      showMessage(button.label);
    } catch (e) {
      showMessage(`エラー: ${userFacingError(e)}`);
    }
  };

  const opponentId =
    state.players.find((p) => p.id !== viewingPlayer)?.id ?? "bob";
  const moreMenuPanel =
    moreMenuOpen && moreMenuPanelPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={moreMenuPanelRef}
            className="more-menu-panel more-menu-panel-portal"
            role="menu"
            style={{
              right: moreMenuPanelPosition.right,
              bottom: moreMenuPanelPosition.bottom,
            }}
          >
            {replayControls?.details}
            <div
              className="more-menu-bgm"
              data-testid="more-menu-bgm"
              role="group"
              aria-label="BGM 操作"
            >
              <div className="more-menu-bgm-row">
                <button
                  type="button"
                  className="more-menu-bgm-btn"
                  data-testid="btn-bgm-mute"
                  aria-label={bgmMuted ? "ミュート解除" : "ミュート"}
                  title={bgmMuted ? "ミュート解除" : "ミュート"}
                  onClick={toggleBgmMute}
                >
                  {bgmMuted || bgmVolume === 0
                    ? "🔇"
                    : bgmVolume < 0.4
                      ? "🔈"
                      : "🔊"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(Number(e.target.value))}
                  className="more-menu-bgm-volume"
                  aria-label="音量"
                  data-testid="bgm-volume"
                />
                <button
                  type="button"
                  className="more-menu-bgm-btn"
                  data-testid="btn-bgm-skip"
                  aria-label="次の曲へ"
                  title="次の曲 / 作品へ"
                  onClick={skipBgmTrack}
                >
                  ⏭
                </button>
              </div>
              <div className="more-menu-bgm-now" title={bgmNowPlaying}>
                ♪ {bgmNowPlaying}
              </div>
            </div>
            <div className="more-menu-divider" aria-hidden="true" />
            <button
              className="more-menu-item"
              data-testid="btn-public-disclosure-log"
              role="menuitem"
              onClick={() => {
                setMoreMenuOpen(false);
                setPublicDisclosureLogOpen(true);
              }}
            >
              公開情報ログ
            </button>
            {!readOnly && !IS_INTERVIEW_BUILD && (
              <button
                className="more-menu-item"
                data-testid="btn-reset"
                role="menuitem"
                disabled={resetDisabled}
                onClick={() => {
                  setMoreMenuOpen(false);
                  handleReset();
                }}
              >
                リセット
              </button>
            )}
            {(onHome || onExit) && (
              <button
                className="more-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreMenuOpen(false);
                  handleExit();
                }}
              >
                ホームへ
              </button>
            )}
            {!readOnly && (
              <button
                className="more-menu-item"
                data-testid="btn-export-snapshot"
                role="menuitem"
                title="現在の盤面を JSON として保存 (不具合報告用)"
                onClick={() => {
                  setMoreMenuOpen(false);
                  handleExportSnapshot();
                }}
              >
                スナップショット保存
              </button>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <EffectSourceScope
      sourceInstanceId={frontQueueItem?.displaySourceInstanceId ?? null}
      className={`battle-screen${!jankenDone ? " bjk-active" : ""}${readOnly ? " spectator-mode" : ""}${handExpanded ? " hand-expanded" : ""}`}
      data-testid="battle-screen"
      data-room-version={roomId ? roomStateVersion.current : undefined}
      style={
        readOnly && !allowReadOnlyInspection
          ? { pointerEvents: "none" }
          : undefined
      }
    >
      {readOnly && !replayControls && (
        <div
          data-testid="spectator-banner"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            background: "rgba(0, 100, 0, 0.85)",
            color: "#fff",
            padding: "0.4em 1em",
            textAlign: "center",
            fontSize: "0.9em",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          観戦モード （閲覧専用） — 手札・デッキは伏せて表示されています
          {onExit && (
            <button
              onClick={onExit}
              style={{
                marginLeft: "1em",
                background: "#fff",
                color: "#000",
                border: "none",
                padding: "0.2em 0.8em",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              退出
            </button>
          )}
        </div>
      )}
      <img
        className="player-avatar player-avatar-top"
        src={avatarSrc(opponentAvatarId, DEFAULT_OPPONENT_AVATAR_ID)}
        alt="相手のアバター"
        data-testid="player-avatar-top"
      />
      <img
        className="player-avatar player-avatar-bottom"
        src={avatarSrc(selfAvatarId, DEFAULT_SELF_AVATAR_ID)}
        alt="自分のアバター"
        data-testid="player-avatar-bottom"
        onClick={() => setHandOverride(!handExpanded)}
        role="button"
        aria-label={handExpanded ? "手札を隠す" : "手札を表示"}
      />
      <div
        className="self-mini-hand-area"
        data-testid="self-mini-hand-area"
        onClick={() => setHandOverride(!handExpanded)}
        role="button"
        aria-label={handExpanded ? "手札を隠す" : "手札を表示"}
      >
        {(() => {
          const selfHand = state.cardInstances.filter(
            (c) => c.controllerPlayerId === viewingPlayer && c.zone === "hand"
          );
          const N = selfHand.length;
          if (N === 0) return null;
          const center = (N - 1) / 2;
          // 横方向: 予約幅 W に N 枚を均等配置 (はみ出す場合はオーバーラップ)
          // W = 8 * cardUnit = 184 → N=8 で丁度 fill、それ以上で overlap 開始
          const cardUnitNormal = 23;
          const W = cardUnitNormal * 8;
          const slotW = N * cardUnitNormal > W ? W / N : cardUnitNormal;
          // 弧パラメータ (相手手札より少しだけ角度+push を上げる)
          const pixelsPerDeg = 4;
          const halfSpreadDeg = 30;
          const decayDeg = 22;
          const totalSpreadDeg = halfSpreadDeg + decayDeg;
          const maxPushPx = 30;
          return selfHand.map((c, i) => {
            const def = getDefinition(c.definitionId);
            const xPx = (i - center) * slotW;
            const angleDeg = xPx / pixelsPerDeg;
            const absAngle = Math.abs(angleDeg);
            let envelope = 0;
            if (absAngle < totalSpreadDeg) {
              const t = absAngle / totalSpreadDeg;
              envelope = (1 + Math.cos(t * Math.PI)) / 2;
            }
            const clampedAngle = Math.max(
              -halfSpreadDeg,
              Math.min(halfSpreadDeg, angleDeg)
            );
            const pushPx = maxPushPx * envelope;
            // 自分側: 表向き、180° 反転なし、回転は +clampedAngle (右側 CW)
            const rotateDeg = clampedAngle * envelope;
            const transform = `translate(${xPx.toFixed(1)}px, ${(-pushPx).toFixed(1)}px) rotate(${rotateDeg.toFixed(1)}deg)`;
            return (
              <img
                key={c.instanceId}
                className="self-mini-card"
                data-replay-card={c.instanceId}
                src={
                  def?.image ? `/${def.image}` : "/images/ForGUI/card-back.jpg"
                }
                alt={def?.name ?? "card"}
                style={{ transform }}
              />
            );
          });
        })()}
      </div>
      <GameHud
        state={state}
        viewingPlayerId={viewingPlayer}
        firstPlayerOverride={pregameFirstPlayerOverride}
        voidCoreTapActive={
          coreTapTargetIds.has("void:" + viewingPlayer) ||
          (coreTapMode === "placement" && coreTapTargetIds.has("void")) ||
          (coreTapMode === "core_split" &&
            getCoreSplitDestinationIndexForTap("void") !== null)
        }
        onVoidCoreTapClick={() =>
          handleCoreTapClick(pendingCoreHud ? "void:" + viewingPlayer : "void")
        }
        onVoidClick={(pid) =>
          setZoneBrowse({
            zone: "void",
            playerId: pid,
            label: pid === viewingPlayer ? "自分" : "相手",
          })
        }
      />

      {message && (
        <div className="message-toast" data-testid="message-toast">
          {message}
        </div>
      )}

      {dispatchPending && !syncError && (
        <div
          className="dispatch-pending-banner"
          data-testid="dispatch-pending-banner"
          style={{
            position: "fixed",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            padding: "4px 12px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontSize: "0.8em",
            pointerEvents: "none",
          }}
        >
          送信中…
        </div>
      )}
      {syncError && (
        <div className="sync-error-banner" data-testid="sync-error-banner">
          <span>
            {syncError.type === "recovering"
              ? "操作の適用結果を確認しています。復旧までお待ちください"
              : syncError.type === "poll_failed"
                ? "接続が不安定です"
                : syncError.type === "push_failed"
                  ? "操作の同期に失敗しました"
                  : "ネットワークエラー"}
            {/* 診断用: 実際の HTTP ステータス / サーバ engine エラー文を表示する。
                「ほぼ毎アクション失敗」の真因 (400 legal-action mismatch / 409 conflict /
                ネットワーク等) を画面から切り分けられるようにする。 */}
            {syncError.lastError ? (
              <small
                data-testid="sync-error-detail"
                style={{ display: "block", opacity: 0.8, fontWeight: "normal" }}
              >
                {syncError.lastError}
              </small>
            ) : null}
          </span>
          <button
            onClick={async () => {
              const authoritative = await resetPolling();
              if (authoritative) applyRoomAuthoritativeState(authoritative);
            }}
          >
            再接続
          </button>
        </div>
      )}

      {opponentDisconnected && (
        <div className="sync-error-banner" data-testid="disconnect-banner">
          <span>
            対戦相手が切断しました。{canClaimVictory ? "" : "再接続を待機中..."}
          </span>
          {canClaimVictory && !state.gameResult && (
            <button onClick={handleClaimVictory} style={{ marginLeft: 8 }}>
              勝利を宣言する
            </button>
          )}
        </div>
      )}

      <div
        className={`opponent-hand-area${revealHiddenInfo ? " revealed" : ""}`}
        data-testid="opponent-hand-area"
      >
        {(() => {
          const oppHand = state.cardInstances.filter(
            (c) => c.controllerPlayerId === opponentId && c.zone === "hand"
          );
          const N = oppHand.length;
          if (N === 0) return null;
          const center = (N - 1) / 2;
          // self-mini-hand-area と対称な弧型レイアウト (定数は完全一致、
          // 違いは base 回転 180° と Y 方向 (下向きに fan)) 。
          const cardUnitNormal = 23;
          const W = cardUnitNormal * 8;
          const slotW = N * cardUnitNormal > W ? W / N : cardUnitNormal;
          const pixelsPerDeg = 4;
          const halfSpreadDeg = 30;
          const decayDeg = 22;
          const totalSpreadDeg = halfSpreadDeg + decayDeg;
          const maxPushPx = 30;
          return oppHand.map((c, i) => {
            const def = revealHiddenInfo ? getDefinition(c.definitionId) : null;
            const xPx = (i - center) * slotW;
            const angleDeg = xPx / pixelsPerDeg;
            const absAngle = Math.abs(angleDeg);
            let envelope = 0;
            if (absAngle < totalSpreadDeg) {
              const t = absAngle / totalSpreadDeg;
              envelope = (1 + Math.cos(t * Math.PI)) / 2;
            }
            const clampedAngle = Math.max(
              -halfSpreadDeg,
              Math.min(halfSpreadDeg, angleDeg)
            );
            const pushPx = maxPushPx * envelope;
            // 相手側: 180° 反転を base、 弧回転は -clampedAngle*envelope
            // (180° 反転後の見た目で右側カードが外側 (CW) に倒れるように)
            const rotateDeg = -clampedAngle * envelope + 180;
            const transform = `translate(${xPx.toFixed(1)}px, ${pushPx.toFixed(1)}px) rotate(${rotateDeg.toFixed(1)}deg)`;
            return (
              <img
                key={c.instanceId}
                className={`opponent-hand-card${revealHiddenInfo ? " revealed" : ""}`}
                src={
                  def?.image ? `/${def.image}` : "/images/ForGUI/card-back.jpg"
                }
                alt={def?.name ?? "card back"}
                title={def?.name ?? "card back"}
                data-card-name={def?.name ?? undefined}
                data-replay-card={c.instanceId}
                style={{ transform }}
                onClick={
                  revealHiddenInfo
                    ? (e) => {
                        e.stopPropagation();
                        setDetailCard(c);
                      }
                    : undefined
                }
                onContextMenu={
                  revealHiddenInfo
                    ? (e) => {
                        e.preventDefault();
                        setDetailCard(c);
                      }
                    : undefined
                }
              />
            );
          });
        })()}
      </div>
      {(() => {
        const selfHandCount = state.cardInstances.filter(
          (c) => c.controllerPlayerId === viewingPlayer && c.zone === "hand"
        ).length;
        const oppHandCount = state.cardInstances.filter(
          (c) => c.controllerPlayerId === opponentId && c.zone === "hand"
        ).length;
        return (
          <>
            {selfHandCount >= 1 && (
              <div
                className={`hand-count-badge hand-count-badge-self${selfHandCount < HAND_COUNT_BADGE_THRESHOLD ? " low-count" : ""}`}
                data-testid="hand-count-badge-self"
              >
                {selfHandCount}枚
              </div>
            )}
            {oppHandCount >= 1 && (
              <div
                className={`hand-count-badge hand-count-badge-opponent${oppHandCount < HAND_COUNT_BADGE_THRESHOLD ? " low-count" : ""}`}
                data-testid="hand-count-badge-opponent"
              >
                {oppHandCount}枚
              </div>
            )}
          </>
        );
      })()}

      {stepAnnounce && (
        <div className="step-announce" key={stepAnnounce}>
          {stepAnnounce}
        </div>
      )}

      <div
        className={`battle-field${fieldDragOver ? " drag-over" : ""}`}
        data-testid="battle-field"
        onDragOver={(e) => {
          e.preventDefault();
          setFieldDragOver(true);
        }}
        onDragLeave={() => setFieldDragOver(false)}
        onDrop={handleHandCardDrop}
      >
        <FieldArea
          state={state}
          cards={fieldDisplayState.cardInstances}
          getDefinition={getDefinition}
          playerId={opponentId}
          isOpponent
          selectableIds={targetCandidateIds ?? undefined}
          onCardClick={targetCandidateIds ? handleTargetClick : undefined}
          onDetailRequest={openCardDetail}
          onTrashClick={() =>
            setZoneBrowse({
              zone: "trash",
              playerId: opponentId,
              label: "相手",
            })
          }
          onRemovedClick={() =>
            setZoneBrowse({
              zone: "removed_from_game",
              playerId: opponentId,
              label: "相手",
            })
          }
          onSetAsideClick={() =>
            setZoneBrowse({
              zone: "set_aside",
              playerId: opponentId,
              label: "相手",
            })
          }
          onFieldCardsClick={() =>
            setZoneBrowse({
              zone: "field",
              playerId: opponentId,
              label: "相手",
            })
          }
          onBurstClick={() =>
            setZoneBrowse({
              zone: "burst",
              playerId: opponentId,
              label: "相手",
            })
          }
          onDeckClick={() =>
            setZoneBrowse({
              zone: "deck",
              playerId: opponentId,
              label: "相手",
            })
          }
          symbolOverlayMode={symbolOverlayMode}
          {...(coreTapMode === "core_shoot" ||
          coreTapMode === "core_split" ||
          coreTapMode === "core_source_allocation"
            ? {
                coreTapMode,
                coreTapTargetIds,
                onCoreTapClick: handleCoreTapClick,
                coreDisplayOverrides: computeCoreDisplayOverrides({
                  isActive: coreSelection.isActive,
                  previewState: coreSelection.previewState,
                  state,
                  heldCores: coreSelection.heldCores,
                  viewingPlayer: opponentId,
                  pendingCoreDistribution: null,
                }),
                soulCoreDisplayOverrides: computeSoulCoreDisplayOverrides({
                  isActive: coreSelection.isActive,
                  previewState: coreSelection.previewState,
                  state,
                  heldCores: coreSelection.heldCores,
                  viewingPlayer: opponentId,
                  pendingCoreDistribution: null,
                }),
                coreCalcState,
              }
            : {})}
        />

        <div className="battle-center">
          {/* P3-79: モーダル表示は displayState 経由 (非解決者には出さない)。 */}
          {cardSelection.choice ? (
            <PendingCardSelectionControls
              selection={cardSelection}
              onBrowse={() => setTargetBrowseOpen(true)}
              onConfirm={() => {
                const choice = cardSelection.choice;
                const action = cardSelection.resolvedAction;
                if (!choice || !action || !cardSelection.canConfirm) return;
                if (
                  action.kind === "attack" ||
                  action.kind === "join_active_attack" ||
                  action.kind === "block"
                ) {
                  setAttackCostSourceChoice(null);
                  handleAction(action, true);
                  return;
                }
                if (
                  choice.action.kind ===
                  "resolve_pending_summon_cost_exclude_choice"
                ) {
                  const pending = displayState.pendingSummonCostExcludeChoice;
                  const definition =
                    pending && getDefinition(pending.sourceDefinitionId);
                  if (definition)
                    continueSummonWithCostExcludeChoice(
                      choice.action,
                      definition,
                      cardSelection.selectedIds
                    );
                  return;
                }
                const payload = choice.payload(
                  cardSelection.selectedIds,
                  cardSelection.tokenCount
                );
                try {
                  const result = applyLegalAction({
                    state,
                    action,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    ...payload,
                  });
                  setStateAndSync(result.state, action, payload);
                } catch (error) {
                  showMessage(userFacingError(error));
                }
              }}
              onDecline={() => {
                const choice = cardSelection.choice;
                if (choice?.canCancel) {
                  setAttackCostSourceChoice(null);
                  cardSelection.reset();
                  return;
                }
                if (!choice?.declinePayload && !choice?.declineAction) return;
                const action = choice.declineAction ?? choice.action;
                try {
                  const result = applyLegalAction({
                    state,
                    action,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    ...choice.declinePayload,
                  });
                  setStateAndSync(result.state, action, choice.declinePayload);
                } catch (error) {
                  showMessage(userFacingError(error));
                }
              }}
            />
          ) : pendingCoreControls.props ? (
            <CoreSelectionHud {...pendingCoreControls.props} />
          ) : displayState.pendingCoreSplitSelection ? (
            (() => {
              const pending = displayState.pendingCoreSplitSelection;
              const counts = countNormalSoulCores(coreSplitDrafts);
              return (
                <CoreSelectionHud
                  mode="core_split"
                  phase={1}
                  n={coreSplitSelectedTotal}
                  m={pending.totalAmount}
                  a={counts.normal}
                  b={counts.soul}
                  subTitle="コア配分: 置く先を選択"
                  primary={{
                    label: "確定",
                    variant: "ok",
                    disabled: !coreSplitValid || coreSplitAction === undefined,
                    onClick: confirmCoreSplitSelection,
                  }}
                  onReset={() =>
                    coreSelection.removeMovesByPurpose("core_split")
                  }
                />
              );
            })()
          ) : displayState.pendingEffectOptionalRepeatCountSelection
              ?.selectionMode === "count_decrease" ? (
            (() => {
              const pending =
                displayState.pendingEffectOptionalRepeatCountSelection;
              const selectedCount = optionalRepeatCountDraftTotal;
              const canConfirm =
                optionalRepeatCountAction !== undefined &&
                selectedCount >= pending.min &&
                selectedCount <= pending.max;
              return (
                <CoreSelectionHud
                  mode="count_decrease"
                  phase={1}
                  n={selectedCount}
                  m={pending.max}
                  a={selectedCount}
                  b={0}
                  subTitle={`追加発揮: カウントエリアを選択 (${pending.min}〜${pending.max})`}
                  primary={{
                    label: "確定",
                    variant: "ok",
                    disabled: !canConfirm,
                    onClick: () => confirmOptionalRepeatCountSelection(),
                  }}
                  onReset={() =>
                    coreSelection.removeMovesByPurpose("count_decrease")
                  }
                />
              );
            })()
          ) : displayState.pendingEffectOptionalRepeatCountSelection ? (
            (() => {
              const pending =
                displayState.pendingEffectOptionalRepeatCountSelection;
              const values = Array.from(
                { length: pending.max - pending.min + 1 },
                (_, index) => pending.min + index
              );
              return (
                <div className="core-selection-hud">
                  <div className="hud-line">
                    <span>追加発揮</span>
                    <strong>
                      {pending.min}〜{pending.max}
                    </strong>
                  </div>
                  <div className="effect-choice-buttons">
                    {values.map((value) => (
                      <button
                        key={value}
                        className="effect-choice-btn"
                        disabled={optionalRepeatCountAction === undefined}
                        onClick={() =>
                          confirmOptionalRepeatCountSelection(value)
                        }
                      >
                        {value}回
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()
          ) : displayState.pendingMultiPlacement ? (
            soulCoreConfirm && soulCoreConfirmMode === "placement" ? (
              <>
                <TargetToast
                  title="ソウルコア確認"
                  subText="コア配置: ソウルコアを使いますか？"
                />
                <TargetFooterActions
                  actions={[
                    {
                      label: "はい",
                      variant: "ok",
                      onClick: () => {
                        coreSelection.addHeldCore({
                          kind: "soul",
                          from: locationIdToSoulContainer(
                            soulCoreConfirm,
                            viewingPlayer
                          ),
                          playerId: viewingPlayer,
                        });
                        setSoulCoreConfirm(null);
                      },
                    },
                    {
                      label: "いいえ(通常コア)",
                      variant: "warn",
                      onClick: () => {
                        if (remainingNormalAt(soulCoreConfirm) > 0) {
                          coreSelection.addHeldCore({
                            kind: "normal",
                            from: locationIdToNormalContainer(
                              soulCoreConfirm,
                              viewingPlayer
                            ),
                          });
                        }
                        setDeclinedSoulLocations((prev) =>
                          new Set(prev).add(soulCoreConfirm)
                        );
                        setSoulCoreConfirm(null);
                      },
                    },
                  ]}
                />
              </>
            ) : (
              (() => {
                // P3-49 placement_multi: 2-phase grab→place HUD。
                // Phase 1: 「コアを掴む n / 必要 m」, m = sum(targets[].minimumCoreCount)
                // Phase 2: 「コアを置く 残り m」(omitN), m = held buffer 残量
                // P3-79: displayState 経由 (非解決者には出さない)。
                const mp = displayState.pendingMultiPlacement;
                const heldCounts = (() => {
                  let normal = 0;
                  let soul = 0;
                  for (const h of coreSelection.heldCores) {
                    if (h.kind === "soul") soul += 1;
                    else normal += 1;
                  }
                  return { normal, soul };
                })();
                const heldTotal = heldCounts.normal + heldCounts.soul;
                const minTotal = mp.targets.reduce(
                  (s, t) => s + t.minimumCoreCount,
                  0
                );
                const isPhase2 = coreSelection.phase === 2;
                // Phase 2 完了条件: held=0 かつ 各 target が min を満たしている
                const allTargetsMinSatisfied = mp.targets.every((t) => {
                  const placed =
                    multiPlacementPerTargetTotal[t.instanceId] ?? 0;
                  return placed >= t.minimumCoreCount;
                });
                const draftCounts = countNormalSoulCores(placementDrafts);
                return (
                  <CoreSelectionHud
                    mode={
                      coreSelection.fixedDestination
                        ? "placement_single"
                        : "placement_multi"
                    }
                    phase={isPhase2 ? 2 : 1}
                    n={
                      coreSelection.fixedDestination
                        ? placementTotal
                        : heldTotal
                    }
                    m={isPhase2 ? heldTotal : minTotal}
                    a={
                      isPhase2
                        ? heldCounts.normal
                        : draftCounts.normal + heldCounts.normal
                    }
                    b={
                      isPhase2
                        ? heldCounts.soul
                        : draftCounts.soul + heldCounts.soul
                    }
                    subTitle={
                      coreSelection.fixedDestination
                        ? "コア配置: 移動元をタップ"
                        : isPhase2
                          ? "複数体配置: 各カードをタップして配置"
                          : "複数体配置: コアを掴む"
                    }
                    primary={
                      coreSelection.fixedDestination
                        ? {
                            label: "完了",
                            variant: "ok",
                            disabled: !allTargetsMinSatisfied,
                            onClick: confirmMultiPlacement,
                          }
                        : isPhase2
                          ? {
                              label: "完了",
                              variant: "ok",
                              disabled:
                                heldTotal > 0 || !allTargetsMinSatisfied,
                              onClick: confirmMultiPlacement,
                            }
                          : {
                              label: "コアを置く",
                              variant: "ok",
                              disabled: heldTotal < minTotal,
                              onClick: () => coreSelection.enterPlacePhase(),
                            }
                    }
                    onReset={() => {
                      coreSelection.resetPhase("placement");
                      setDeclinedSoulLocations(new Set());
                    }}
                    onCancel={
                      actions.some(
                        (action) =>
                          action.kind === "abort_pending_multi_placement"
                      )
                        ? abortMultiPlacement
                        : undefined
                    }
                  />
                );
              })()
            )
          ) : pendingSeparation ? (
            soulCoreConfirm && soulCoreConfirmMode === "placement" ? (
              <>
                <TargetToast
                  title="ソウルコア確認"
                  subText="ブレイヴ分離: ソウルコアを掴みますか？"
                />
                <TargetFooterActions
                  actions={[
                    {
                      label: "はい",
                      variant: "ok",
                      onClick: () => {
                        // P3-49: ソウルコアを held buffer に積む (Phase 1)。
                        coreSelection.addHeldCore({
                          kind: "soul",
                          from: locationIdToSoulContainer(
                            soulCoreConfirm,
                            viewingPlayer
                          ),
                          playerId: viewingPlayer,
                        });
                        setSoulCoreConfirm(null);
                      },
                    },
                    {
                      label: "いいえ(通常コア)",
                      variant: "warn",
                      onClick: () => {
                        // P3-49: 通常コアを held buffer に積む (Phase 1)。
                        if (remainingNormalAt(soulCoreConfirm) > 0)
                          coreSelection.addHeldCore({
                            kind: "normal",
                            from: locationIdToNormalContainer(
                              soulCoreConfirm,
                              viewingPlayer
                            ),
                          });
                        setDeclinedSoulLocations((prev) =>
                          new Set(prev).add(soulCoreConfirm)
                        );
                        setSoulCoreConfirm(null);
                      },
                    },
                  ]}
                />
              </>
            ) : (
              (() => {
                // P3-49: separation を explicit 2-phase grab→place で表示。
                // Phase 1: 「コアを掴む n / 必要 m」, 主ボタン「コアを置く」(held >= minCores で enabled)。
                // Phase 2: 「コアを置く 残り m」(omitN), 主ボタン「完了」(held=0 で enabled)。
                const heldCounts = (() => {
                  let normal = 0;
                  let soul = 0;
                  for (const h of coreSelection.heldCores) {
                    if (h.kind === "soul") soul += 1;
                    else normal += 1;
                  }
                  return { normal, soul };
                })();
                const heldTotal = heldCounts.normal + heldCounts.soul;
                const draftCounts = countNormalSoulCores(separationDrafts);
                const isPhase2 = coreSelection.phase === 2;
                return (
                  <CoreSelectionHud
                    mode={
                      coreSelection.fixedDestination
                        ? "placement_single"
                        : "separation"
                    }
                    phase={isPhase2 ? 2 : 1}
                    n={
                      coreSelection.fixedDestination
                        ? separationTotal
                        : heldTotal
                    }
                    m={isPhase2 ? heldTotal : pendingSeparation.minCores}
                    a={
                      isPhase2
                        ? heldCounts.normal
                        : draftCounts.normal + heldCounts.normal
                    }
                    b={
                      isPhase2
                        ? heldCounts.soul
                        : draftCounts.soul + heldCounts.soul
                    }
                    subTitle={
                      isPhase2
                        ? "ブレイヴ分離: ブレイヴ本体をタップして配置"
                        : "ブレイヴ分離: コアを掴む"
                    }
                    primary={
                      coreSelection.fixedDestination
                        ? {
                            label: "完了",
                            variant: "ok",
                            disabled:
                              separationTotal < pendingSeparation.minCores,
                            onClick: confirmSeparation,
                          }
                        : isPhase2
                          ? {
                              label: "完了",
                              variant: "ok",
                              disabled:
                                heldTotal > 0 ||
                                separationTotal < pendingSeparation.minCores,
                              onClick: confirmSeparation,
                            }
                          : {
                              label: "コアを置く",
                              variant: "ok",
                              disabled: heldTotal < pendingSeparation.minCores,
                              onClick: () => coreSelection.enterPlacePhase(),
                            }
                    }
                    onReset={() => {
                      // Phase 1: held を空に。Phase 2: snapshot から復元 + draft 消去。
                      coreSelection.resetPhase("separation");
                      setDeclinedSoulLocations(new Set());
                    }}
                    onCancel={() => {
                      setPendingSeparation(null);
                      coreSelection.end();
                      setDeclinedSoulLocations(new Set());
                    }}
                  />
                );
              })()
            )
          ) : pendingCoreShoot ? (
            soulCoreConfirm && soulCoreConfirmMode === "core_shoot" ? (
              <SoulCoreConfirmation
                message={`${pendingCoreShoot.magicDef.name}: ソウルコアを含みますか？`}
                onYes={() => {
                  coreSelection.addMove({
                    kind: "soul",
                    playerId: viewingPlayer,
                    from: soulCoreConfirm.startsWith("reserve:")
                      ? {
                          kind: "reserve",
                          playerId: soulCoreConfirm.slice("reserve:".length),
                        }
                      : { kind: "card", instanceId: soulCoreConfirm },
                    to: { kind: "void", playerId: viewingPlayer },
                    purpose: "shoot",
                  });
                  setSoulCoreConfirm(null);
                }}
                onNo={() => {
                  setDeclinedSoulLocations((prev) =>
                    new Set(prev).add(soulCoreConfirm)
                  );
                  setSoulCoreConfirm(null);
                }}
              />
            ) : (
              (() => {
                // P3-48 + 仕様改訂 (2026-05-06): shoot mode を統一 HUD で表示。
                // m は totalAmount (固定) に変更、HUD は「相手のコアを掴む n / 必要 m」。
                const counts = countNormalSoulCores(coreShootDrafts);
                return (
                  <CoreSelectionHud
                    mode="shoot"
                    phase={1}
                    n={coreShootTotal}
                    m={pendingCoreShoot.totalAmount}
                    a={counts.normal}
                    b={counts.soul}
                    subTitle={`${pendingCoreShoot.magicDef.name} コアシュート`}
                    primary={{
                      label: "確定",
                      variant: "ok",
                      disabled: !coreShootValid,
                      onClick: confirmCoreShoot,
                    }}
                    onReset={() => {
                      coreSelection.removeMovesByPurpose("shoot");
                      setDeclinedSoulLocations(new Set());
                    }}
                  />
                );
              })()
            )
          ) : pendingCostPayment ? (
            soulCoreConfirm && soulCoreConfirmMode === "cost_payment" ? (
              <SoulCoreConfirmation
                message={`${pendingCostPayment.def.name}: ソウルコアをコストに含みますか？`}
                onYes={() => {
                  addCardCostMove("soul", soulCoreConfirm);
                  setSoulCoreConfirm(null);
                }}
                onNo={() => {
                  addCardCostMove("normal", soulCoreConfirm);
                  setDeclinedSoulLocations((prev) =>
                    new Set(prev).add(soulCoreConfirm)
                  );
                  setSoulCoreConfirm(null);
                }}
              />
            ) : (
              (() => {
                // P3-48 + 仕様改訂 (2026-05-06): 統一 HUD で「コストを支払う n / 必要 m」表示。
                // m は finalCost (固定) に変更。n が 0→m へ進む形で進捗を読みやすくする。
                const counts = countNormalSoulCores(costPaymentDrafts);
                return (
                  <CoreSelectionHud
                    mode="card_cost"
                    phase={1}
                    n={costPaymentTappedTotal}
                    m={pendingCostPayment.finalCost}
                    a={counts.normal}
                    b={counts.soul}
                    subTitle={`${pendingCostPayment.def.name} コスト支払い`}
                    primary={{
                      label: "支払う",
                      variant: "ok",
                      disabled: !costPaymentValid,
                      onClick: () => confirmCostPayment(),
                    }}
                    extraActions={
                      pendingCostPayment.handGainPayload
                        ? [
                            {
                              label: "支払わず回収しない",
                              variant: "cancel",
                              onClick: () => confirmCostPayment(true),
                            },
                          ]
                        : []
                    }
                    onReset={() => {
                      coreSelection.removeMovesByPurpose("card_cost");
                      setDeclinedSoulLocations(new Set());
                    }}
                    onCancel={() => {
                      setPendingCostPayment(null);
                      coreSelection.end();
                      setDeclinedSoulLocations(new Set());
                    }}
                  />
                );
              })()
            )
          ) : pendingPlacement ? (
            soulCoreConfirm && soulCoreConfirmMode === "placement" ? (
              <>
                <TargetToast
                  title="ソウルコア確認"
                  subText={`${pendingPlacement.def.name}: ソウルコアを置きますか？`}
                />
                <TargetFooterActions
                  actions={[
                    {
                      label: "はい",
                      variant: "ok",
                      onClick: () => {
                        const destId = pendingPlacement.destinationInstanceId;
                        if (soulCoreConfirm === "reserve") {
                          // ソウルコアは maxReserveCores（通常コア制限）とは独立。
                          // hasSoulInReserve が true でここに到達しているので無条件で配置可能。
                          coreSelection.addMove({
                            kind: "soul",
                            purpose: "placement",
                            playerId: viewingPlayer,
                            from: {
                              kind: "reserve",
                              playerId: viewingPlayer,
                            },
                            to: { kind: "card", instanceId: destId },
                          });
                        } else {
                          coreSelection.addMove({
                            kind: "soul",
                            purpose: "placement",
                            playerId: viewingPlayer,
                            from: { kind: "card", instanceId: soulCoreConfirm },
                            to: { kind: "card", instanceId: destId },
                          });
                        }
                        setSoulCoreConfirm(null);
                      },
                    },
                    {
                      label: "いいえ(通常コア)",
                      variant: "warn",
                      onClick: () => {
                        const destId = pendingPlacement.destinationInstanceId;
                        if (soulCoreConfirm === "reserve") {
                          if (
                            placementReserveNormalTaken <
                            pendingPlacement.maxReserveCores
                          ) {
                            coreSelection.addMove({
                              kind: "normal",
                              purpose: "placement",
                              from: {
                                kind: "reserve",
                                playerId: viewingPlayer,
                              },
                              to: { kind: "card", instanceId: destId },
                              amount: 1,
                            });
                          }
                        } else {
                          // ソウルを辞退して通常コアを取る。ただし通常コア残が
                          // ある場合のみ (ソウルコアのみのスピリットでは通常コアは
                          // 取れないため辞退のみ)。
                          const src = pendingPlacement.fieldSources.find(
                            (s) => s.instanceId === soulCoreConfirm
                          );
                          const normalTaken =
                            placementFieldNormalTaken[soulCoreConfirm] ?? 0;
                          if (src && normalTaken < src.maxAmount) {
                            coreSelection.addMove({
                              kind: "normal",
                              purpose: "placement",
                              from: {
                                kind: "card",
                                instanceId: soulCoreConfirm,
                              },
                              to: { kind: "card", instanceId: destId },
                              amount: 1,
                            });
                          }
                        }
                        setDeclinedSoulLocations((prev) =>
                          new Set(prev).add(soulCoreConfirm)
                        );
                        setSoulCoreConfirm(null);
                      },
                    },
                  ]}
                />
              </>
            ) : (
              (() => {
                // P3-48: 1-phase placement 系として統一 HUD を表示。
                // 単体配置モデル: n<min は "最低 m"、n>=min は希望文省略。
                const counts = countNormalSoulCores(placementDrafts);
                const priorCost = pendingPlacement.priorCostPayment;
                const isDeferredEnterFieldPlacement =
                  pendingPlacement.action.kind ===
                  "resolve_pending_enter_field_placement";
                // 仕様: card_cost → placement 遷移後の cancel は cost stage へ戻る
                // (placement draft 消去、card_cost draft 保持、mode を card_cost に巻戻し)。
                // priorCostPayment が null の場合 (cost=0 直接 placement) は全体 abort。
                const onCancel = isDeferredEnterFieldPlacement
                  ? () => {
                      coreSelection.removeMovesByPurpose("placement");
                      setDeclinedSoulLocations(new Set());
                    }
                  : priorCost
                    ? () => {
                        coreSelection.removeMovesByPurpose("placement");
                        coreSelection.transitionMode("card_cost");
                        setPendingPlacement(null);
                        setPendingCostPayment(priorCost);
                        setDeclinedSoulLocations(new Set());
                      }
                    : () => {
                        setPendingPlacement(null);
                        coreSelection.end();
                        setDeclinedSoulLocations(new Set());
                      };
                return (
                  <CoreSelectionHud
                    mode="placement_single"
                    phase={1}
                    n={placementTotal}
                    m={pendingPlacement.minCores}
                    a={counts.normal}
                    b={counts.soul}
                    subTitle={`${pendingPlacement.def.name} コアを置く`}
                    primary={{
                      label: "完了",
                      variant: "ok",
                      disabled: placementTotal < pendingPlacement.minCores,
                      onClick: confirmPlacement,
                    }}
                    onReset={() => {
                      coreSelection.removeMovesByPurpose("placement");
                      setDeclinedSoulLocations(new Set());
                    }}
                    onCancel={onCancel}
                  />
                );
              })()
            )
          ) : displayState.pendingCoreDistribution ? (
            // P3-79: displayState 経由 (非解決者には出さない)。
            (() => {
              const dist = displayState.pendingCoreDistribution;
              // any_movable Phase 1: ソウルコア grab 確認ダイアログ (core_move 準拠)。
              // pendingCoreDistribution 分岐が汎用 soulCoreConfirm ダイアログ (後段) より
              // 先に評価されるため、ここで描画する。「はい」= held buffer にソウルを積む、
              // 「いいえ」= 同ソースの通常コアを積む。配置は Phase 2 で held から行う。
              if (
                soulCoreConfirm &&
                soulCoreConfirmMode === "core_distribute"
              ) {
                const soulSrcKey =
                  soulCoreConfirm === "reserve"
                    ? "reserve"
                    : soulCoreConfirm === "trash"
                      ? "trash"
                      : soulCoreConfirm === "life"
                        ? "life"
                        : `field:${soulCoreConfirm}`;
                const heldNormalHere = coreSelection.grabbedCores.filter(
                  (h) =>
                    h.kind === "normal" &&
                    ((h.from.kind === "reserve" &&
                      soulCoreConfirm === "reserve") ||
                      (h.from.kind === "trash" &&
                        soulCoreConfirm === "trash") ||
                      (h.from.kind === "life" && soulCoreConfirm === "life") ||
                      (h.from.kind === "card" &&
                        h.from.instanceId === soulCoreConfirm))
                ).length;
                const normalAvailHere =
                  (dist.sourceAvailable?.[soulSrcKey] ?? 0) - heldNormalHere;
                return (
                  <>
                    <TargetToast
                      title="ソウルコア確認"
                      subText="ソウルコアを掴みますか？"
                    />
                    <TargetFooterActions
                      actions={[
                        {
                          label: "はい（ソウルコア）",
                          variant: "ok",
                          onClick: () => {
                            coreSelection.addHeldCore({
                              kind: "soul",
                              from: locationIdToSoulContainer(
                                soulCoreConfirm,
                                viewingPlayer
                              ),
                              playerId: viewingPlayer,
                            });
                            setSoulCoreConfirm(null);
                          },
                        },
                        {
                          label: "いいえ（通常コア）",
                          variant: "warn",
                          onClick: () => {
                            // soul-only ソースでは通常コアが無いので no-op。
                            if (normalAvailHere > 0) {
                              coreSelection.addHeldCore({
                                kind: "normal",
                                from: locationIdToNormalContainer(
                                  soulCoreConfirm,
                                  viewingPlayer
                                ),
                              });
                            }
                            setSoulCoreConfirm(null);
                          },
                        },
                      ]}
                    />
                  </>
                );
              }
              const remaining = dist.totalNormalCores - trashDistTotal;
              const totalSoulCores =
                dist.totalSoulCores ?? (dist.hasSoulCore ? 1 : 0);
              const remainingSoul = Math.max(
                0,
                totalSoulCores - trashDistSoulTotal
              );
              const soulTargetSummary =
                trashDistSoulTotal > 0
                  ? `${trashDistSoulTotal}/${totalSoulCores}`
                  : "未配置";
              // P3-49: any_movable は explicit 2-phase grab→place。trash_distribution
              // (single-source) は従来通り 1-phase。
              const isTargetTotalSelection =
                requiresCoreDistributionTargetTotals(dist);
              const currentTargetTotal = isTargetTotalSelection
                ? dist.candidates.reduce((sum, candidate) => {
                    const card = state.cardInstances.find(
                      (c) => c.instanceId === candidate.instanceId
                    );
                    return (
                      sum +
                      (card?.normalCoreCount ?? 0) +
                      (card?.soulCoreCount ?? 0)
                    );
                  }, 0)
                : 0;
              const targetTotalLimit =
                currentTargetTotal +
                (dist.maxTotal ?? dist.totalNormalCores + totalSoulCores);
              const isAnyMovable =
                dist.fromKind === "any_movable" && !isTargetTotalSelection;
              const isFixedSeparation = Boolean(coreSelection.fixedDestination);
              const isPhase2 = isAnyMovable && coreSelection.phase === 2;
              const heldCounts = (() => {
                let normal = 0;
                let soul = 0;
                for (const h of coreSelection.heldCores) {
                  if (h.kind === "soul") soul += 1;
                  else normal += 1;
                }
                return { normal, soul };
              })();
              const heldTotal = heldCounts.normal + heldCounts.soul;
              const subText = isAnyMovable
                ? coreSelection.phase === 2
                  ? "配置先のカードをタップ"
                  : "移動元のコアをタップ"
                : isTargetTotalSelection
                  ? "対象カードをタップして個数を指定"
                  : trashDistSoulMode
                    ? `ソウルコア配置先のカードをタップ（残り ${remainingSoul}）`
                    : dist.hasSoulCore
                      ? `フィールドのカードをタップしてコアを置く（ソウル: ${soulTargetSummary}）`
                      : "フィールドのカードをタップしてコアを置く";
              const cdAction = actions.find(
                (a) => a.kind === "resolve_pending_core_distribution"
              );
              const confirmTrashDist = () => {
                if (!cdAction) return;
                try {
                  const recomposed = recomposeTrashDistributionLegalAction(
                    coreSelection.draftMoves
                  );
                  const dispatchPayload: Record<string, unknown> =
                    isTargetTotalSelection
                      ? {
                          coreDistributionAllocations:
                            recomposed.coreDistributionAllocations,
                        }
                      : {
                          coreDistributionAllocations:
                            recomposed.coreDistributionAllocations,
                          ...(recomposed.coreDistributionSoulCoreAllocations
                            ? {
                                coreDistributionSoulCoreAllocations:
                                  recomposed.coreDistributionSoulCoreAllocations,
                              }
                            : {}),
                          ...(recomposed.coreDistributionSoulCoreInstanceId
                            ? {
                                coreDistributionSoulCoreInstanceId:
                                  recomposed.coreDistributionSoulCoreInstanceId,
                              }
                            : {}),
                          ...(recomposed.coreDistributionSourceAllocations
                            ? {
                                coreDistributionSourceAllocations:
                                  recomposed.coreDistributionSourceAllocations,
                              }
                            : {}),
                          ...(recomposed.coreDistributionSoulCoreSourceAllocations
                            ? {
                                coreDistributionSoulCoreSourceAllocations:
                                  recomposed.coreDistributionSoulCoreSourceAllocations,
                              }
                            : {}),
                        };
                  const result = applyLegalAction({
                    state,
                    action: cdAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    ...dispatchPayload,
                  });
                  // 確定後の draft 残留を防ぐため end を先に呼ぶ。
                  // setStateAndSync 直後の再 render では previewState が
                  // 新 state に対し旧 drafts を適用しようとして throw する
                  // (trash が空になった後に trash → card draft を再適用するため)。
                  coreSelection.end();
                  setTrashDistSoulMode(false);
                  setStateAndSync(result.state, cdAction, dispatchPayload);
                } catch (e) {
                  console.error("CoreDistribution action failed:", e);
                }
              };
              // P3-48: ソウル選択補助ボタンは extras として HUD に渡す。
              // any_movable は soul を Phase 1 grab → Phase 2 place で扱う (core_move 準拠)
              // ため「ソウル配置先を選ぶ」系ボタンは出さない。1-phase の trash_distribution のみ。
              const extras: TargetActionButton[] = [];
              if (
                dist.hasSoulCore &&
                !isAnyMovable &&
                !isTargetTotalSelection
              ) {
                if (trashDistSoulMode) {
                  extras.push({
                    label: "ソウル選択をやめる",
                    variant: "cancel",
                    onClick: () => setTrashDistSoulMode(false),
                  });
                } else {
                  if (trashDistSoulTotal > 0) {
                    extras.push({
                      label: "ソウルを外す",
                      variant: "warn",
                      onClick: () => {
                        for (
                          let i = coreSelection.draftMoves.length - 1;
                          i >= 0;
                          i -= 1
                        ) {
                          const d = coreSelection.draftMoves[i];
                          if (
                            d?.purpose === "trash_distribution" &&
                            d.kind === "soul"
                          ) {
                            coreSelection.removeMove(i);
                          }
                        }
                      },
                    });
                  }
                  if (remainingSoul > 0) {
                    extras.push({
                      label: "ソウル配置先を選ぶ",
                      variant: "warn",
                      onClick: () => setTrashDistSoulMode(true),
                    });
                  }
                }
              }
              const counts = countNormalSoulCores(trashDistDrafts);
              const distributionTotal = coreDistributionAvailableTotal(dist);
              const distributionRoute = coreDistributionRouteLabel(
                dist,
                viewingPlayer,
                state
              );
              const subTitle = isFixedSeparation
                ? `ブレイヴ分離 — ${getDefinition(dist.candidates[0]!.definitionId)?.name ?? ""}`
                : isAnyMovable
                  ? `${distributionRoute} コア配分 (${distributionTotal}) — ${subText}`
                  : isTargetTotalSelection
                    ? `${distributionRoute} コア個数指定 (${targetTotalLimit}) — ${subText}`
                    : `${distributionRoute} コア配分 (${distributionTotal}) — ${subText}`;
              // P3-49: any_movable Phase 1 / 2 の HUD 数値分岐。
              // Phase 1: n = held 総数, m = minTotal (最低必要、未指定時 0)
              //   `totalNormalCores` は配分可能な POOL の総量（上限）であって必須数ではない。
              //   フランドール【フォーオブアカインド】では minTotal=1 / totalNormalCores=18、
              //   charge 系「好きなだけ置く」では minTotal=0 のような関係。
              // Phase 2: n = heldTotal (omitN), m = heldTotal (残り) — held を fully drain で 0。
              // trash_distribution (1-phase) は従来通り n / 残り m。
              const fixedTargetTotals =
                dist.targetTotalSelection?.fixedTargetTotals;
              const requiredFixedPlacement =
                fixedTargetTotals === undefined
                  ? undefined
                  : dist.candidates.reduce(
                      (sum, candidate) =>
                        sum +
                        Math.max(
                          0,
                          (fixedTargetTotals[candidate.instanceId] ?? 0) -
                            getTotalCoresOnCardById(state, candidate.instanceId)
                        ),
                      0
                    );
              const minTotal = dist.minTotal ?? 0;
              const requiredGrabTotal = Math.max(
                minTotal,
                requiredFixedPlacement ?? 0
              );
              const fixedTargetsSatisfied =
                fixedTargetTotals === undefined ||
                dist.candidates.every(
                  (candidate) =>
                    getTotalCoresOnCardById(
                      coreSelection.previewState,
                      candidate.instanceId
                    ) === (fixedTargetTotals[candidate.instanceId] ?? 0)
                );
              const hudN = isFixedSeparation
                ? trashDistTotal + trashDistSoulTotal
                : isAnyMovable
                  ? isPhase2
                    ? heldTotal
                    : heldTotal
                  : trashDistTotal + trashDistSoulTotal;
              const hudM = isAnyMovable
                ? isPhase2
                  ? heldTotal
                  : requiredGrabTotal
                : isTargetTotalSelection
                  ? Math.max(0, targetTotalLimit - trashDistTotal)
                  : Math.max(
                      0,
                      distributionTotal - trashDistTotal - trashDistSoulTotal
                    );
              // a/b は「掴んでいる（未配置の手持ち）コア」の内訳 (仕様 11_core-selection-hud.md 行31/38)。
              // trash_distribution は grab=SKIP で trash 全コアを最初に手持ちとして抱える 1-phase mode のため、
              // 置いた数ではなく「残り手持ち」を表示しないと配置が進むほど数が増えてしまう。
              // 通常コア残り = totalNormalCores − 配分済み (= remaining)、ソウルは未配置数。
              const hudA = isAnyMovable
                ? isPhase2
                  ? heldCounts.normal
                  : heldCounts.normal + counts.normal
                : Math.max(0, remaining);
              const hudB = isAnyMovable
                ? isPhase2
                  ? heldCounts.soul
                  : heldCounts.soul + counts.soul
                : remainingSoul;
              // BSTH01-M01 等「コアすべて」: trash_distribution で
              // pending.minTotal === totalNormalCores のとき部分配分を禁止する。
              // ソウルコアも mustPlaceSoulCore のときは必ず全数配置先を選ぶ必要がある。
              const incompleteAllocation =
                trashDistTotal + trashDistSoulTotal < minTotal;
              const incompleteSoul =
                !isTargetTotalSelection &&
                dist.mustPlaceSoulCore === true &&
                dist.hasSoulCore &&
                trashDistSoulTotal < totalSoulCores;
              const primary =
                isAnyMovable && !isFixedSeparation
                  ? isPhase2
                    ? {
                        label: "完了",
                        variant: "ok" as const,
                        disabled:
                          heldTotal > 0 ||
                          !cdAction ||
                          incompleteAllocation ||
                          incompleteSoul ||
                          !fixedTargetsSatisfied,
                        onClick: confirmTrashDist,
                      }
                    : {
                        label: "コアを置く",
                        variant: "ok" as const,
                        disabled:
                          heldTotal < requiredGrabTotal ||
                          (requiredFixedPlacement !== undefined &&
                            heldTotal !== requiredFixedPlacement),
                        onClick: () => coreSelection.enterPlacePhase(),
                      }
                  : {
                      label: "完了",
                      variant: "ok" as const,
                      disabled:
                        !cdAction ||
                        incompleteAllocation ||
                        incompleteSoul ||
                        !fixedTargetsSatisfied,
                      onClick: confirmTrashDist,
                    };
              return (
                <CoreSelectionHud
                  mode={
                    isFixedSeparation
                      ? "separation"
                      : isAnyMovable
                        ? "core_distribute_any_self"
                        : "trash_distribution"
                  }
                  phase={isPhase2 ? 2 : 1}
                  n={hudN}
                  m={hudM}
                  a={hudA}
                  b={hudB}
                  subTitle={subTitle}
                  primary={primary}
                  extraActions={extras}
                  onReset={() => {
                    if (isAnyMovable) {
                      // P3-49: phase aware reset — Phase 1 = held 全消去 +
                      // trash_distribution draft 消去, Phase 2 = snapshot 復元 + draft 消去。
                      coreSelection.resetPhase("trash_distribution");
                    } else {
                      coreSelection.removeMovesByPurpose("trash_distribution");
                    }
                    setTrashDistSoulMode(false);
                  }}
                  onCancel={(() => {
                    // P3-48 follow-up: priorStateSnapshot がある pending のみ
                    // abort 可能。actions に abort_pending_core_distribution が
                    // surface されていなければ undefined (= キャンセルボタン非表示)。
                    const abortAction = actions.find(
                      (a) => a.kind === "abort_pending_core_distribution"
                    );
                    if (!abortAction) return undefined;
                    return () => {
                      try {
                        const result = applyLegalAction({
                          state,
                          action: abortAction,
                          getCardDefinitionById: getDefinition,
                          ...effectLookups,
                        });
                        coreSelection.end();
                        setTrashDistSoulMode(false);
                        setStateAndSync(result.state, abortAction);
                      } catch (e) {
                        console.error(
                          "AbortPendingCoreDistribution failed:",
                          e
                        );
                      }
                    };
                  })()}
                />
              );
            })()
          ) : changeCleanupChoice ? (
            (() => {
              const defId = changeCleanupChoice.pending.sourceDefinitionId;
              const name =
                (defId ? getDefinition(defId)?.name : null) ?? "チェンジ";
              return (
                <>
                  <TargetToast
                    title={`${name} 後処理を選択`}
                    subText="入れ替えるスピリットをタップ"
                  />
                  <TargetFooterActions
                    actions={[
                      {
                        label: "破棄",
                        variant: "cancel",
                        onClick: () => resolveChangeCleanupChoice(null),
                      },
                    ]}
                  />
                </>
              );
            })()
          ) : pendingAction ? (
            (() => {
              if (pendingAction.kind === "resolve_brave_combine_choice") {
                return (
                  <>
                    <TargetToast title="合体先選択" subText="合体先をタップ" />
                    <TargetFooterActions
                      actions={[
                        {
                          label: "戻る",
                          variant: "cancel",
                          onClick: cancelTargetSelection,
                        },
                      ]}
                    />
                  </>
                );
              }

              // P3-47 F-4 / P3-76: 効果対象リダイレクト (持続効果の対象変更介入)。
              // 中央系プロンプトで「分身をタップ=変更 / 変更しない=任意の不使用」。
              // スタック/フラッシュ窓・効果キュー UI とは無関係。
              if (pendingAction.kind === "confirm_target_redirect") {
                const redirectAction =
                  pendingAction as ConfirmTargetRedirectLegalAction;
                // P3-79: displayState 経由 (相手宛 redirect では UI 出さない)。
                const pr = displayState.pendingTargetRedirects.find(
                  (p) => p.pendingId === redirectAction.pendingId
                );
                const protectedCard = pr
                  ? state.cardInstances.find(
                      (c) => c.instanceId === pr.redirectableInstanceId
                    )
                  : undefined;
                const protectedName =
                  (protectedCard
                    ? getDefinition(protectedCard.definitionId)?.name
                    : null) ?? "本体";
                const needsReplacement =
                  redirectAction.replacementSelectionRequired !== false;
                const replacementMode =
                  redirectAction.replacementMode ?? "collapse";
                const replacementTargetCount =
                  redirectAction.replacementTargetCount ??
                  (replacementMode === "reselect"
                    ? (redirectAction.redirectableInstanceIds?.length ?? 1)
                    : 1);
                const canConfirmReplacement =
                  selectedTargets.length === replacementTargetCount;
                const declineAction = myActions.find(
                  (a): a is DeclineTargetRedirectLegalAction =>
                    a.kind === "decline_target_redirect" &&
                    a.pendingId === redirectAction.pendingId
                );
                const handleConfirmDecision = () => {
                  try {
                    const result = applyLegalAction({
                      state,
                      action: redirectAction,
                      getCardDefinitionById: getDefinition,
                      ...effectLookups,
                    });
                    setStateAndSync(result.state, redirectAction);
                    showMessage("対象変更を承諾");
                  } catch (e) {
                    showMessage(`エラー: ${userFacingError(e)}`);
                  }
                  setPendingAction(null);
                  setSelectedTargets([]);
                };
                const handleConfirmReplacement = () => {
                  applyTargetSelection(selectedTargets);
                };
                const handleDecline = () => {
                  if (declineAction) {
                    try {
                      const result = applyLegalAction({
                        state,
                        action: declineAction,
                        getCardDefinitionById: getDefinition,
                        ...effectLookups,
                      });
                      setStateAndSync(result.state, declineAction);
                      showMessage("対象変更を辞退");
                    } catch (e) {
                      showMessage(`エラー: ${userFacingError(e)}`);
                    }
                  }
                  setPendingAction(null);
                  setSelectedTargets([]);
                };
                const redirectFooterActions: TargetActionButton[] =
                  needsReplacement
                    ? replacementTargetCount > 1
                      ? [
                          {
                            label: `変更先を確定（${selectedTargets.length}/${replacementTargetCount}）`,
                            variant: "ok",
                            disabled: !canConfirmReplacement,
                            onClick: handleConfirmReplacement,
                          },
                          ...(declineAction
                            ? [
                                {
                                  label: "変更しない",
                                  variant: "cancel" as const,
                                  onClick: handleDecline,
                                },
                              ]
                            : []),
                        ]
                      : declineAction
                        ? [
                            {
                              label: "変更しない",
                              variant: "cancel",
                              onClick: handleDecline,
                            },
                          ]
                        : []
                    : [
                        {
                          label: "変更する",
                          variant: "ok",
                          onClick: handleConfirmDecision,
                        },
                        ...(declineAction
                          ? [
                              {
                                label: "変更しない",
                                variant: "cancel" as const,
                                onClick: handleDecline,
                              },
                            ]
                          : []),
                      ];
                return (
                  <>
                    <TargetToast
                      title={`${protectedName} への対象を変更`}
                      progress={
                        needsReplacement && replacementTargetCount > 1
                          ? {
                              current: selectedTargets.length,
                              required: replacementTargetCount,
                            }
                          : undefined
                      }
                      subText={
                        needsReplacement
                          ? replacementTargetCount > 1
                            ? "変更先を順にタップ"
                            : "変更先の分身をタップ"
                          : "対象変更を承諾しますか"
                      }
                    />
                    <TargetFooterActions actions={redirectFooterActions} />
                  </>
                );
              }

              // 可変選択に加え、固定0件もタップで自動確定できないため明示確定する。
              const canConfirm =
                (pendingIsVariableSelect ||
                  pendingRequiredCount === 0 ||
                  pendingHasRevealedCandidates) &&
                selectedTargets.length >= pendingRequiredCount &&
                selectedTargets.length <= pendingMaxCount &&
                satisfiesSelectionTargetGroups(
                  selectedTargets,
                  pendingTargetGroups,
                  pendingAllowsDuplicateTargets
                );
              const isZeroPickAllowed = pendingRequiredCount === 0;
              const subText =
                pendingMaxCount === 0
                  ? "対象を選ばずに確定してください"
                  : pendingIsVariableSelect
                    ? isZeroPickAllowed && selectedTargets.length === 0
                      ? `0〜${pendingMaxCount} 体まで選択可能（タップで選択）`
                      : pendingAllowsDuplicateTargets
                        ? `${pendingRequiredCount}〜${pendingMaxCount} 回選択（同じ候補を複数回タップ可）`
                        : `${pendingRequiredCount}〜${pendingMaxCount} 体を選択（タップで切り替え）`
                    : pendingTargetGroups.length > 0
                      ? "対象種別ごとに候補カードをタップ"
                      : "候補カードをタップ";
              const actions: TargetActionButton[] = [];
              if (
                pendingAllowsDuplicateTargets &&
                selectedTargets.length > pendingRequiredCount
              ) {
                actions.push({
                  label: "1回減らす",
                  variant: "warn",
                  onClick: () =>
                    setSelectedTargets((prev) => prev.slice(0, -1)),
                });
              }
              if (canConfirm) {
                actions.push({
                  label:
                    selectedTargets.length === 0
                      ? "対象を取らずに確定"
                      : pendingAllowsDuplicateTargets
                        ? `確定（${selectedTargets.length} 回）`
                        : `確定（${selectedTargets.length} 体）`,
                  variant: "ok",
                  onClick: () => applyTargetSelection(selectedTargets),
                });
              }
              if (revealedTargetIds) {
                actions.push({
                  label: "オープン中のカード",
                  variant: "warn",
                  onClick: () => setModalsHidden(false),
                });
              } else if (browsedTargetCandidateIds.length > 0) {
                actions.push({
                  label: "ゾーン候補",
                  variant: "warn",
                  onClick: () => setTargetBrowseOpen(true),
                });
              }
              if (pendingHasRevealedCandidates && !revealedTargetIds) {
                actions.push({
                  label: "オープン中のカード",
                  variant: "warn",
                  onClick: () => setRevealBrowseOpen(true),
                });
              }
              actions.push({
                label: "キャンセル",
                variant: "cancel",
                onClick: cancelTargetSelection,
              });
              return (
                <>
                  <TargetToast
                    title={
                      displayState.pendingEffectTargetSelection?.deferredStack.suppressionEffectDescriptor?.containsActionKinds?.includes(
                        "rebirth"
                      )
                        ? "転醒させるカードを選択"
                        : "対象選択"
                    }
                    progress={{
                      current: selectedTargets.length,
                      required: pendingRequiredCount,
                      ...(pendingIsVariableSelect
                        ? { max: pendingMaxCount }
                        : {}),
                    }}
                    subText={subText}
                  />
                  <TargetFooterActions actions={actions} />
                </>
              );
            })()
          ) : soulCoreConfirm && soulCoreConfirmMode === "core_move" ? (
            <>
              <TargetToast
                title="ソウルコア確認"
                subText="ソウルコアを移動しますか？"
              />
              <TargetFooterActions
                actions={[
                  {
                    label: "はい",
                    variant: "ok",
                    onClick: () => {
                      // P3-49: held buffer に soul を積む (Phase 1)。
                      coreSelection.addHeldCore({
                        kind: "soul",
                        from: locationIdToSoulContainer(
                          soulCoreConfirm,
                          viewingPlayer
                        ),
                        playerId: viewingPlayer,
                      });
                      setSoulCoreConfirm(null);
                    },
                  },
                  {
                    label: "いいえ（通常コア）",
                    variant: "warn",
                    onClick: () => {
                      // P3-49: held buffer に通常コアを積む (Phase 1)。
                      if (remainingNormalAt(soulCoreConfirm) > 0)
                        coreSelection.addHeldCore({
                          kind: "normal",
                          from: locationIdToNormalContainer(
                            soulCoreConfirm,
                            viewingPlayer
                          ),
                        });
                      setSoulCoreConfirm(null);
                    },
                  },
                ]}
              />
            </>
          ) : coreMoveMode ? (
            (() => {
              // P3-49: 自由 core_move を explicit 2-phase grab→place で表示。
              // Phase 1: held buffer の総数 (n) を表示。主ボタン「コアを置く」。
              // Phase 2: 残り (= heldCores 残数) を表示。主ボタン「完了」。
              const heldCounts = (() => {
                let normal = 0;
                let soul = 0;
                for (const h of coreSelection.heldCores) {
                  if (h.kind === "soul") soul += 1;
                  else normal += 1;
                }
                return { normal, soul };
              })();
              const heldTotal = heldCounts.normal + heldCounts.soul;
              const isPhase2 = coreSelection.phase === 2;
              const subTitle = isPhase2
                ? `コア移動: 移動先を選択 (残り ${heldTotal})`
                : "コア移動: 移動元を選択 (任意)";
              return (
                <CoreSelectionHud
                  mode="core_move_free"
                  phase={isPhase2 ? 2 : 1}
                  n={isPhase2 ? heldTotal : heldTotal}
                  m={isPhase2 ? heldTotal : 0}
                  a={isPhase2 ? heldCounts.normal : heldCounts.normal}
                  b={isPhase2 ? heldCounts.soul : heldCounts.soul}
                  subTitle={subTitle}
                  primary={
                    isPhase2
                      ? {
                          // 自由 core_move: 「完了」は常時有効 (held 残置はリセットで戻せる)。
                          // 残った held は draft 化されないので silent に discard。
                          label: "完了",
                          variant: "ok",
                          onClick: exitCoreMoveMode,
                        }
                      : {
                          label: "コアを置く",
                          variant: "ok",
                          disabled: heldTotal === 0,
                          onClick: () => coreSelection.enterPlacePhase(),
                        }
                  }
                  onReset={() => {
                    // Phase 1: held を空に。Phase 2: snapshot から復元 + draft 消去。
                    coreSelection.resetPhase("core_move");
                  }}
                  onCancel={() => {
                    setSoulCoreConfirm(null);
                    coreSelection.end();
                  }}
                />
              );
            })()
          ) : state.activeAttack ? (
            <DuelMark state={state} />
          ) : null}
        </div>

        <FieldArea
          state={state}
          cards={fieldDisplayState.cardInstances}
          getDefinition={getDefinition}
          playerId={viewingPlayer}
          selectableIds={
            changeCleanupChoice
              ? new Set(changeCleanupChoice.pending.swapCandidateInstanceIds)
              : (targetCandidateIds ?? selectableFieldIds)
          }
          onCardClick={
            changeCleanupChoice
              ? (id) => {
                  if (
                    changeCleanupChoice.pending.swapCandidateInstanceIds.includes(
                      id
                    )
                  ) {
                    resolveChangeCleanupChoice(id);
                  }
                }
              : targetCandidateIds
                ? handleTargetClick
                : (id) => {
                    // attack で targetInstanceId 確定済みのものは既存の対象別
                    // legal action なので、フィールドタップの候補には出さない。
                    const clickTargetIds = new Set(
                      getFieldTapTargetIdsForCardClick(state, id)
                    );
                    const cardActions = actions.filter(
                      (a) =>
                        !(
                          a.kind === "attack" &&
                          "targetInstanceId" in a &&
                          a.targetInstanceId
                        ) &&
                        ACTION_UI_ROUTES[a.kind] === "field-tap" &&
                        tapTargetInstanceIds(a).some((targetId) =>
                          clickTargetIds.has(targetId)
                        )
                    );
                    if (cardActions.length > 0) {
                      setFieldCardChoice({
                        instanceId: id,
                        actions: cardActions,
                      });
                    }
                  }
          }
          onDetailRequest={openCardDetail}
          coreMoveMode={coreMoveMode}
          coreMoveFrom={coreMoveFrom}
          coreMoveBlockedIds={coreMoveBlockedIds}
          onCoreMoveClick={handleCoreMoveClick}
          coreDisplayOverrides={coreDisplayOverrides}
          soulCoreDisplayOverrides={soulCoreDisplayOverrides}
          coreCalcState={coreCalcState}
          onTrashClick={() =>
            setZoneBrowse({
              zone: "trash",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          onRemovedClick={() =>
            setZoneBrowse({
              zone: "removed_from_game",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          onSetAsideClick={() =>
            setZoneBrowse({
              zone: "set_aside",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          onFieldCardsClick={() =>
            setZoneBrowse({
              zone: "field",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          onBurstClick={() =>
            setZoneBrowse({
              zone: "burst",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          onDeckClick={() =>
            setZoneBrowse({
              zone: "deck",
              playerId: viewingPlayer,
              label: "自分",
            })
          }
          symbolOverlayMode={symbolOverlayMode}
          {...(coreTapMode === "cost_payment" ||
          coreTapMode === "placement" ||
          coreTapMode === "core_shoot" ||
          coreTapMode === "count_decrease" ||
          coreTapMode === "core_split" ||
          coreTapMode === "core_source_allocation"
            ? {
                coreTapMode,
                coreTapTargetIds,
                coreTapReserve,
                onCoreTapClick: handleCoreTapClick,
                ...(coreTapZones.size > 0 ? { coreTapZones } : {}),
                ...(multiSourceActiveKey !== null
                  ? { multiSourceActiveKey }
                  : {}),
              }
            : {})}
        />

        {/* 効果解決キューは選択 UI と同じ判定で自動非表示。
            選択完了後は自動再表示し、手動トグルで本文も確認できる。 */}
        <EffectQueueOverlay
          state={state}
          getDefinition={getDefinition}
          getRegisteredTriggeredEffectActions={
            effectLookups.getRegisteredTriggeredEffectActions
          }
          viewingPlayerId={viewingPlayer}
          actions={actions}
          onActiveItemChange={setActiveQueueItemId}
          visible={effectQueueVisible}
          onToggleVisible={toggleEffectQueueVisible}
        />
      </div>

      {/* デッキオープン選択モーダル
          (modalsHidden 中は内部 state を保つため display:none で隠す: hidden prop)
          P3-79: displayState 経由 (非解決者には出さない)。 */}
      {displayState.pendingDeckReveal &&
        (() => {
          const drAction = actions.find(
            (a) =>
              a.kind === "resolve_pending_deck_reveal_pick" ||
              a.kind === "resolve_pending_deck_reveal_order"
          );
          if (!drAction) return null;
          return (
            <DeckRevealModal
              key={`${displayState.pendingDeckReveal.pendingId}:${drAction.actionId}`}
              state={displayState}
              pending={displayState.pendingDeckReveal}
              action={
                drAction as
                  | import("@orica/rules-core").ResolvePendingDeckRevealPickLegalAction
                  | import("@orica/rules-core").ResolvePendingDeckRevealOrderLegalAction
              }
              getDefinition={getDefinition}
              hidden={modalsHidden || !!pendingCostPayment?.handGainPayload}
              onResolve={(
                selectedIds,
                placement,
                remainderPlacements,
                freeDestination
              ) => {
                try {
                  const pending = state.pendingDeckReveal;
                  if (
                    pending &&
                    drAction.kind === "resolve_pending_deck_reveal_pick"
                  ) {
                    const cost = getDeckRevealSelectedHandGainCost(
                      state,
                      pending,
                      selectedIds,
                      freeDestination,
                      getDefinition
                    );
                    if (cost > 0) {
                      startHandGainCostPayment(drAction, pending, cost, {
                        selectedDeckRevealCardIds: selectedIds,
                        ...(freeDestination
                          ? { deckRevealPickFreeDestination: freeDestination }
                          : {}),
                      });
                      return;
                    }
                  }
                  const drPayload: Record<string, unknown> =
                    drAction.kind === "resolve_pending_deck_reveal_pick"
                      ? {
                          selectedDeckRevealCardIds: selectedIds,
                          ...(freeDestination
                            ? { deckRevealPickFreeDestination: freeDestination }
                            : {}),
                        }
                      : {
                          deckRevealRemainderOrder: selectedIds,
                          ...(placement
                            ? { deckRevealPlacement: placement }
                            : {}),
                          ...(remainderPlacements
                            ? {
                                deckRevealRemainderPlacements:
                                  remainderPlacements,
                              }
                            : {}),
                        };
                  const result = applyLegalAction({
                    state,
                    action: drAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    ...drPayload,
                  });
                  setStateAndSync(result.state, drAction, drPayload);
                } catch (e) {
                  console.error("DeckReveal action failed:", e);
                }
              }}
            />
          );
        })()}

      {/* ゾーン選択モーダル（デッキ検索/トラッシュ回収/手札破棄/手元移動） —
          自分の手札からの選択はインライン HandArea に移譲（inlineHandSelection 時は非表示）
          P3-79: displayState 経由 (非解決者には出さない)。 */}
      {pendingMagicZoneCostSelection &&
        (() => {
          const { action, def } = pendingMagicZoneCostSelection;
          const pendingId = `magic-zone-cost:${action.actionId}`;
          const sourceDefinitionId =
            state.cardInstances.find(
              (card) => card.instanceId === action.sourceInstanceId
            )?.definitionId ?? "";
          const candidateIds = action.zoneCostPaymentCandidateIds ?? [];
          const maxCount = action.zoneCostPaymentCount ?? 0;
          const pending = {
            pendingId,
            actingPlayerId: action.actingPlayerId,
            sourceInstanceId: action.sourceInstanceId,
            sourceDefinitionId,
            actionKind: "return_from_trash",
            sourceZone: "trash",
            candidateCardInstanceIds: candidateIds,
            maxCount,
            destination: "deck_bottom",
            remainingActions: [],
            effectTiming: { kind: "activated", mode: action.timing ?? "main" },
            canSkip: false,
          } as PendingZoneSelection;
          const selectionAction = {
            kind: "resolve_pending_zone_selection",
            actionId: `${pendingId}:resolve`,
            can: true,
            reason: "magic zone discount cost payment",
            actingPlayerId: action.actingPlayerId,
            pendingId,
            actionKind: "return_from_trash",
            candidateCardInstanceIds: candidateIds,
            maxCount,
            canSkip: false,
          } as ResolvePendingZoneSelectionLegalAction;
          return (
            <ZoneSelectionModal
              state={state}
              pending={pending}
              action={selectionAction}
              getDefinition={getDefinition}
              hidden={modalsHidden}
              criteriaTextOverride={`1枚目をデッキの上、2枚目をデッキの下に戻します（${maxCount}枚選択）`}
              onResolve={(selectedIds) => {
                setPendingMagicZoneCostSelection(null);
                continueMagicUseWithZoneCost(action, def, selectedIds);
              }}
            />
          );
        })()}
      {displayState.pendingZoneSelection &&
        !inlineHandSelection &&
        (() => {
          const zsAction = actions.find(
            (a) => a.kind === "resolve_pending_zone_selection"
          );
          if (!zsAction) return null;
          return (
            <ZoneSelectionModal
              key={zsAction.actionId}
              state={displayState}
              pending={displayState.pendingZoneSelection}
              action={
                zsAction as import("@orica/rules-core").ResolvePendingZoneSelectionLegalAction
              }
              getDefinition={getDefinition}
              hidden={modalsHidden || !!pendingCostPayment?.handGainPayload}
              onPeek={() => setModalsHidden(true)}
              onResolve={(selectedIds, placement, destinationByCardId) => {
                try {
                  const zsPayload = {
                    selectedZoneCardIds: selectedIds,
                    ...(placement ? { deckRevealPlacement: placement } : {}),
                    ...(destinationByCardId
                      ? {
                          zoneSelectionDestinationByCardId: destinationByCardId,
                        }
                      : {}),
                  };
                  const pending = state.pendingZoneSelection!;
                  const cost = getZoneSelectionHandGainCost(
                    state,
                    pending,
                    selectedIds,
                    destinationByCardId
                  );
                  if (cost > 0) {
                    startHandGainCostPayment(
                      zsAction,
                      {
                        ...pending,
                        actingPlayerId:
                          pending.effectActingPlayerId ??
                          pending.actingPlayerId,
                      },
                      cost,
                      zsPayload
                    );
                    return;
                  }
                  const result = applyLegalAction({
                    state,
                    action: zsAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    ...zsPayload,
                  });
                  setStateAndSync(result.state, zsAction, zsPayload);
                } catch (e) {
                  console.error("ZoneSelection action failed:", e);
                }
              }}
            />
          );
        })()}

      {/* ライフダメージ破棄コストゲート (discardCostGate。BSTH02.7-C05[1] 等)。
          ダメージ解決前に「破棄して防ぐか」を解決する。
          displayState 経由で解決者 (= decidingPlayerId) にのみ出す。 */}
      {displayState.pendingLifeDamageDiscardChoice &&
        (() => {
          const ldcAction = actions.find(
            (a) => a.kind === "resolve_pending_life_damage_discard_choice"
          );
          if (!ldcAction) return null;
          return (
            <LifeDamageDiscardChoiceModal
              pending={displayState.pendingLifeDamageDiscardChoice}
              getDefinition={getDefinition}
              hidden={modalsHidden}
              onPay={() => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: ldcAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    lifeDamageDiscardChoice: "pay",
                  });
                  setStateAndSync(result.state, ldcAction, {
                    lifeDamageDiscardChoice: "pay",
                  });
                } catch (e) {
                  console.error("LifeDamageDiscardChoice pay failed:", e);
                }
              }}
              onDecline={() => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: ldcAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    lifeDamageDiscardChoice: "decline",
                  });
                  setStateAndSync(result.state, ldcAction, {
                    lifeDamageDiscardChoice: "decline",
                  });
                } catch (e) {
                  console.error("LifeDamageDiscardChoice decline failed:", e);
                }
              }}
            />
          );
        })()}

      {/* ライフゲイン置換 (life_gain_replacement CE。BSTH02.7-X03 effects[3])。
          自分の効果で自分のライフが増える直前に「置換するか」を解決する。
          displayState 経由で decidingPlayerId にのみ出す。 */}
      {displayState.pendingLifeGainReplacementChoice &&
        (() => {
          const lgrAction = actions.find(
            (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
          );
          if (!lgrAction) return null;
          return (
            <LifeGainReplacementChoiceModal
              pending={displayState.pendingLifeGainReplacementChoice}
              getDefinition={getDefinition}
              hidden={modalsHidden}
              onReplace={() => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: lgrAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    lifeGainReplacementChoice: "replace",
                  });
                  setStateAndSync(result.state, lgrAction, {
                    lifeGainReplacementChoice: "replace",
                  });
                } catch (e) {
                  console.error("LifeGainReplacementChoice replace failed:", e);
                }
              }}
              onDecline={() => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: lgrAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    lifeGainReplacementChoice: "decline",
                  });
                  setStateAndSync(result.state, lgrAction, {
                    lifeGainReplacementChoice: "decline",
                  });
                } catch (e) {
                  console.error("LifeGainReplacementChoice decline failed:", e);
                }
              }}
            />
          );
        })()}

      {/* カウント減少数選択モーダル（動的コスト修正「カウントを好きなだけ減らす」型、
          ENGINE-cost-modify-additional-cost-value-dynamic-amount。例: BSGE01-M02） */}
      {displayState.pendingCountSelection &&
        (() => {
          const pcsPending = displayState.pendingCountSelection;
          const pcsAction = actions.find(
            (a) => a.kind === "resolve_pending_count_decrease"
          );
          if (!pcsAction) return null;
          return (
            <PendingCountSelectionModal
              pending={pcsPending}
              hidden={modalsHidden}
              onConfirm={(count) => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: pcsAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    countDecreaseSelection: count,
                  });
                  setStateAndSync(result.state, pcsAction, {
                    countDecreaseSelection: count,
                  });
                } catch (e) {
                  console.error("PendingCountSelection action failed:", e);
                }
              }}
            />
          );
        })()}

      {/* バースト破棄枚数選択モーダル（「バーストN個まで」型、
          ENGINE-composite-heterogeneous-removal-budget。例: BSTH09-X01） */}
      {displayState.pendingDiscardSetBurstCountSelection &&
        (() => {
          const dsbcsPending =
            displayState.pendingDiscardSetBurstCountSelection;
          const dsbcsAction = actions.find(
            (a) => a.kind === "resolve_pending_discard_set_burst_count"
          );
          if (!dsbcsAction) return null;
          return (
            <PendingDiscardSetBurstCountSelectionModal
              pending={dsbcsPending}
              hidden={modalsHidden}
              onConfirm={(count) => {
                try {
                  const result = applyLegalAction({
                    state,
                    action: dsbcsAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                    discardSetBurstCountSelection: count,
                  });
                  setStateAndSync(result.state, dsbcsAction, {
                    discardSetBurstCountSelection: count,
                  });
                } catch (e) {
                  console.error(
                    "PendingDiscardSetBurstCountSelection action failed:",
                    e
                  );
                }
              }}
            />
          );
        })()}

      {/* インライン手札ゾーン選択のフローティングバナー */}
      {inlineHandSelection &&
        (() => {
          const { pending, action } = inlineHandSelection;
          const alternates = action.alternateSelections ?? [];
          const primaryCandidates = new Set(action.candidateCardInstanceIds);
          // primary 確定: exact は maxCount 枚、up-to は 1..maxCount 枚
          const primarySatisfied =
            handPendingSelectedIds.every((id) => primaryCandidates.has(id)) &&
            (action.canSkip
              ? handPendingSelectedIds.length > 0 &&
                handPendingSelectedIds.length <= action.maxCount
              : handPendingSelectedIds.length === action.maxCount);
          // alt 確定: count 枚一致 + 全 id が alt 候補内
          const matchedAlt = alternates.findIndex((alt) => {
            if (handPendingSelectedIds.length !== alt.count) return false;
            const set = new Set(alt.candidateInstanceIds);
            return handPendingSelectedIds.every((id) => set.has(id));
          });
          const canConfirm = primarySatisfied || matchedAlt >= 0;
          const label = zoneSelectionLabel(pending);
          const zoneName = zoneDisplayLabel(pending.sourceZone);
          // 表示する確定条件文
          const requiredCount = Math.min(
            action.maxCount,
            action.candidateCardInstanceIds.length
          );
          const criteriaText =
            alternates.length === 0
              ? `${handPendingSelectedIds.length}/${requiredCount}`
              : `${action.maxCount}枚` +
                alternates
                  .map(
                    (a) =>
                      ` / ${a.label ?? describeCardFilter(a.filter, a.count)}`
                  )
                  .join("") +
                ` — 現在 ${handPendingSelectedIds.length} 枚`;
          const confirmSelection = (ids: string[]) => {
            try {
              const result = applyLegalAction({
                state,
                action,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
                selectedZoneCardIds: ids,
              });
              setHandPendingSelectedIds([]);
              setStateAndSync(result.state, action, {
                selectedZoneCardIds: ids,
              });
            } catch (e) {
              console.error("Inline hand ZoneSelection failed:", e);
            }
          };
          return (
            <div
              className="hand-selection-banner"
              data-testid="hand-selection-banner"
            >
              <span className="hand-selection-banner-label">
                {label}（{zoneName}）
                <span className="hand-selection-banner-count">
                  {criteriaText}
                </span>
              </span>
              {action.canSkip && (
                <button
                  type="button"
                  className="hand-selection-banner-button skip"
                  onClick={() => confirmSelection([])}
                >
                  スキップ
                </button>
              )}
              <button
                type="button"
                className="hand-selection-banner-button confirm"
                disabled={!canConfirm}
                onClick={() => confirmSelection(handPendingSelectedIds)}
              >
                決定（{handPendingSelectedIds.length}枚）
              </button>
            </div>
          );
        })()}

      {/* 発揮前提手札破棄gateのインライン手札選択バナー */}
      {payToActHandDiscardSelection &&
        (() => {
          const { action } = payToActHandDiscardSelection;
          const candidateIds = new Set(action.candidateCardInstanceIds);
          const canConfirm =
            handDiscardGateSelectedIds.length === action.requiredCount &&
            handDiscardGateSelectedIds.every((id) => candidateIds.has(id));
          const confirmDiscard = (ids: readonly string[]) => {
            try {
              const payload = {
                payToActHandDiscardCardInstanceIds: [...ids],
              };
              const result = applyLegalAction({
                state,
                action,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
                ...payload,
              });
              setHandDiscardGateSelectedIds([]);
              setStateAndSync(result.state, action, payload);
              showMessage(`手札${ids.length}枚を破棄`);
            } catch (e) {
              console.error("Pay-to-act hand discard gate failed:", e);
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };
          const decline = () => {
            try {
              const payload = { payToActHandDiscardGateDecline: true };
              const result = applyLegalAction({
                state,
                action,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
                ...payload,
              });
              setHandDiscardGateSelectedIds([]);
              setStateAndSync(result.state, action, payload);
              showMessage("手札破棄を行わない");
            } catch (e) {
              console.error("Pay-to-act hand discard gate decline failed:", e);
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };
          return (
            <div
              className="hand-selection-banner"
              data-testid="pay-to-act-hand-discard-banner"
            >
              <span className="hand-selection-banner-label">
                手札破棄
                <span className="hand-selection-banner-count">
                  {handDiscardGateSelectedIds.length}/{action.requiredCount}
                </span>
              </span>
              <button
                type="button"
                className="hand-selection-banner-button skip"
                onClick={decline}
              >
                発揮しない
              </button>
              <button
                type="button"
                className="hand-selection-banner-button confirm"
                disabled={!canConfirm}
                onClick={() => confirmDiscard(handDiscardGateSelectedIds)}
              >
                決定（{handDiscardGateSelectedIds.length}枚）
              </button>
            </div>
          );
        })()}

      <HandArea
        cards={getOwnHandCards(state, viewingPlayer, getDefinition)}
        getDefinition={getDefinition}
        selectableIds={selectableHandIds}
        selectedIds={
          cardSelection.choice
            ? new Set(cardSelection.selectedIds)
            : inlineHandSelection
              ? new Set(handPendingSelectedIds)
              : payToActHandDiscardSelection
                ? new Set(handDiscardGateSelectedIds)
                : hasInlineHandTargetSelection
                  ? new Set(selectedTargets)
                  : undefined
        }
        nonCandidateIds={nonCandidateHandIds}
        onCardClick={(id) => {
          if (cardSelection.choice) {
            cardSelection.toggle(id);
            return;
          }
          if (
            hasUiPending &&
            !inlineHandSelection &&
            !payToActHandDiscardSelection &&
            !hasInlineHandTargetSelection
          )
            return;
          // インライン手札選択中はトグル処理
          if (inlineHandSelection) {
            const action = inlineHandSelection.action;
            const allCandidates = new Set<string>(
              action.candidateCardInstanceIds
            );
            for (const alt of action.alternateSelections ?? []) {
              for (const aid of alt.candidateInstanceIds)
                allCandidates.add(aid);
            }
            if (!allCandidates.has(id)) return;
            // 選択上限: primary maxCount と各 alt count の最大値
            let cap = action.maxCount;
            for (const alt of action.alternateSelections ?? []) {
              cap = Math.max(cap, alt.count);
            }
            cap = Math.min(cap, allCandidates.size);
            setHandPendingSelectedIds((prev) => {
              if (prev.includes(id)) return prev.filter((x) => x !== id);
              if (prev.length >= cap) return prev;
              return [...prev, id];
            });
            return;
          }
          if (payToActHandDiscardSelection) {
            const action = payToActHandDiscardSelection.action;
            const candidates = new Set(action.candidateCardInstanceIds);
            if (!candidates.has(id)) return;
            const cap = Math.min(
              action.requiredCount,
              action.candidateCardInstanceIds.length
            );
            setHandDiscardGateSelectedIds((prev) => {
              if (prev.includes(id)) return prev.filter((x) => x !== id);
              if (prev.length >= cap) return prev;
              return [...prev, id];
            });
            return;
          }
          if (pendingActionHandTargetCandidateIds.has(id)) {
            handleTargetClick(id);
            return;
          }
          const cardActions = actions.filter(
            (a) =>
              ACTION_UI_ROUTES[a.kind] === "hand-tap" &&
              tapTargetInstanceIds(a).includes(id)
          );
          if (cardActions.length > 0) {
            setDroppedCardChoice({ instanceId: id, actions: cardActions });
          }
        }}
        onDetailRequest={(id) => {
          const c = state.cardInstances.find((ci) => ci.instanceId === id);
          if (c) setDetailCard(c);
        }}
        onTouchDragPlay={(instanceId) => {
          if (
            hasUiPending ||
            inlineHandSelection ||
            payToActHandDiscardSelection ||
            hasInlineHandTargetSelection
          )
            return;
          const cardActions = actions.filter(
            (a) =>
              ACTION_UI_ROUTES[a.kind] === "hand-tap" &&
              tapTargetInstanceIds(a).includes(instanceId)
          );
          if (cardActions.length > 0) {
            setDroppedCardChoice({ instanceId, actions: cardActions });
          }
        }}
        onDragStart={() => setHandDragging(true)}
      />

      {/* インタラクティブ pending 中（対象選択 / コスト支払 / コア配置 / モーダル等）は
          ActionBar を非表示。効果全体の「発揮する/しない」は、EffectQueue の
          前面カードに対応する action だけを下部の半透明バーへ戻す。
          効果内チョイス / その他 pending 操作は各 overlay / HUD / カードタップ UI に任せる。 */}
      {(!hasUiPending || replayPresentation?.action) && (
        <ActionBar
          actions={(() => {
            if (replayPresentation?.action) return [replayPresentation.action];
            // P3-37: effect queue の前面 (active = items の最後) と一致する pending についてのみ
            // select_pending_to_resolve / resolve を表示する。後ろの pending を解決したい場合は
            // overlay 上でカードタップして前面化し、ActionBar で select を確定する。
            // 前面 1 件の決定: overlay が報告した可視 front (activeQueueItemId) を
            // 最優先。これにより 1 pending 複数 responder でも「表示中カード」と
            // ActionBar の resolve action が 1:1 で一致する。
            // 無ければ selectedByTurnPlayer な triggered (P3-37)、最後に末尾。
            const frontItem = frontQueueItem;
            // キュー非表示中はキュー独立のパス系のみ残す。
            const queueIndependentPassKinds = new Set([
              "pass_stack",
              "pass_pre_declaration_stack",
              "pass_battle_flash",
            ]);
            const hideForCollapsedQueue =
              queueItems.length > 0 && !effectQueueVisible;
            return actions.filter((a) => {
              if (
                hideForCollapsedQueue &&
                !queueIndependentPassKinds.has(a.kind)
              ) {
                return false;
              }
              // 自動実行できない宣言済み効果も、前面の合法手を手動で選べる。
              // P3-86 Phase 3: item-advancing action は「前面項目が claim する 1 件」だけ表示。
              // 別の項目 (背面) が claim する action は除外し、ボタン漏れを構造的に防ぐ。
              // 項目が消えたキュー操作をグローバル操作として表示しない。
              return isActionForEffectQueueFront(a, frontItem);
            });
          })()}
          onActionClick={readOnly ? () => {} : handleAction}
          onSkipOptional={readOnly ? () => {} : handleSkipOptionalAction}
        />
      )}

      {!pendingAction && hasBlockActions && (
        <div className="action-bar">
          <div className="action-group">
            <button
              className="action-btn action-block-decline"
              onClick={handleDeclineBlock}
            >
              {/* P2-05: 複数ブロック中 (1体以上ブロック宣言済み) の decline_block は
                  「残りはブロックしない」完了宣言なのでラベルを変える */}
              <span className="action-label">
                {state.activeAttack?.blockAssignments.some(
                  (ba) => ba.blockedByEntityIds.length > 0
                )
                  ? "ブロック完了"
                  : "ブロックしない"}
              </span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`battle-controls${replayControls ? " battle-controls-replay" : ""}`}
      >
        {(() => {
          // 処理中フラグ: 解決キュー・バトル・効果発揮中・UI選択中はステップ進行/コア移動を無効化。
          // 効果由来 pending (coreDistribution / multiPlacement / effectTargetSelection) も
          // raw state で読むことで、actor 側の advanceStep 直行を防ぐ + 非 actor 側も
          // 「相手が選択中だから待つ」UI を提示する (両者で disable)。
          // P3-79 follow-up: 旧実装は coreDistribution 等を含めておらず、actor の
          // 「次のステップ」「コア移動」が押せてしまっていた (handleAdvanceStep は
          // legal-action filter を経由せず advanceStep を直呼びする経路があるため)。
          const hasPending =
            getGameProgressBlockerReason(state) !== null ||
            pendingCostPayment !== null ||
            pendingPlacement !== null ||
            pendingCoreShoot !== null ||
            pendingSeparation !== null ||
            pendingAction !== null;
          // 中央のアバターを避けて左右に分割するため items 配列で持つ
          const items: React.ReactNode[] = [
            <button
              key="advance-step"
              className="btn-step"
              data-testid="btn-advance-step"
              disabled={
                hasPending ||
                dispatchPending ||
                (state.activePlayerId !== viewingPlayer &&
                  !actions.some((a) => a.kind === "end_attack_step"))
              }
              onClick={handleAdvanceStep}
            >
              {state.step === "end" && state.window === "end_step_cleanup"
                ? "ターン終了"
                : "次のステップ"}
            </button>,
            <button
              key="core-move"
              className={`btn-step ${coreMoveMode ? "btn-active" : ""}`}
              disabled={
                hasPending ||
                !(
                  state.step === "main" &&
                  state.activePlayerId === viewingPlayer
                )
              }
              onClick={() => {
                if (coreMoveMode) exitCoreMoveMode();
                else {
                  coreSelection.start("core_move");
                  setCoreMoveFrom(null);
                  showMessage("移動元を選択");
                }
              }}
            >
              {coreMoveMode ? "コア移動中..." : "コア移動"}
            </button>,
          ];
          if (hasAnyFieldSymbolSource) {
            items.push(
              <button
                key="symbol-summary"
                className={`btn-step${symbolOverlayMode ? " btn-symbol-active" : ""}`}
                data-testid="btn-symbol-summary"
                aria-pressed={symbolOverlayMode}
                onClick={() => setSymbolOverlayMode((v) => !v)}
                title="フィールドシンボル一覧 (両プレイヤー)"
              >
                シンボル表示
              </button>
            );
          }
          // 手札ボタンは廃止: 自分側アバター + ミニ手札表示エリアをクリックで toggle
          items.push(
            <div key="more-menu" className="more-menu-wrap" ref={moreMenuRef}>
              <button
                className={`btn-reset btn-more-menu${moreMenuOpen ? " btn-active" : ""}${
                  publicDisclosureDropPulse
                    ? " public-disclosure-drop-pulse"
                    : ""
                }`}
                data-testid="btn-more-menu"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                title="その他のメニュー"
                onClick={() => {
                  if (!moreMenuOpen) replayControls?.onOpenMenu();
                  setMoreMenuOpen((v) => !v);
                }}
              >
                ・・・
              </button>
            </div>
          );
          const mid = Math.ceil(items.length / 2);
          return (
            <>
              <div className="bar-half bar-half-left">
                {replayControls?.controls ?? items.slice(0, mid)}
              </div>
              <div className="bar-center-spacer" aria-hidden="true" />
              <div className="bar-half bar-half-right">{items.slice(mid)}</div>
            </>
          );
        })()}
      </div>
      {moreMenuPanel}

      <PublicDisclosurePanel
        state={publicDisclosureDisplayState}
        viewerPlayerId={viewingPlayer}
        getDefinition={getDefinition}
        viewerLegalActions={myActions}
        viewerActionSequence={publicDisclosureViewerActionSequence}
        logOpen={publicDisclosureLogOpen}
        onCloseLog={() => setPublicDisclosureLogOpen(false)}
        suppressTargetDeclaredPresentation={suppressTargetDeclaredPresentation}
        getCardPresentationExitAnchor={getPublicDisclosureExitAnchor}
        onCardPresentationExit={pulsePublicDisclosureExitAnchor}
        {...(roomId
          ? {
              presentationContextKey: `room:${roomId}:${viewingPlayer}`,
              suppressInitialPresentation: true,
            }
          : {})}
      />

      {burstConfirmation && (
        <BurstActivationConfirmation
          state={displayState}
          warning={burstConfirmation.warning}
          burstName={
            getDefinition(burstConfirmation.action.sourceDefinitionId ?? "")
              ?.name ?? "選択したカード"
          }
          getDefinition={getDefinition}
          hidden={modalsHidden}
          onPeek={() => setModalsHidden(true)}
          onBack={() => setBurstConfirmationActionId(null)}
          onConfirm={() => {
            setBurstConfirmationActionId(null);
            handleAction(burstConfirmation.action, false, true);
          }}
        />
      )}

      {simplePendingDecision && (
        <div
          className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
          aria-hidden={modalsHidden ? "true" : undefined}
          onClick={() => setModalsHidden(true)}
        >
          <div
            className="effect-choice-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="effect-queue-card active"
              style={{ position: "relative", width: 220 }}
            >
              <div className="effect-queue-text">
                <div className="effect-queue-timing">
                  {simplePendingDecision.title}
                </div>
                <div className="effect-queue-description">
                  {simplePendingDecision.description}
                </div>
              </div>
            </div>
            <div className="effect-choice-buttons">
              <ActionButtonChoices
                choices={distinguishActionButtonChoices(
                  simplePendingDecision.buttons.map((button) => ({
                    key: button.key,
                    label: button.label,
                    className: `effect-choice-btn${
                      button.tone === "skip" ? " effect-choice-skip" : ""
                    }`,
                    onClick: () => applySimplePendingDecision(button),
                  }))
                )}
              />
            </div>
          </div>
        </div>
      )}

      {pendingEffectChoice &&
        (() => {
          const choiceSource = pendingEffectChoice.choices[0];
          const display = getEffectSourceDisplay(
            displayState,
            {
              ...choiceSource,
              sourceDefinitionId: pendingEffectChoice.sourceDefinitionId,
            },
            getDefinition
          );
          const def = display.definition;
          const closeChoice = () => setPendingEffectChoice(null);
          const choiceKind = pendingEffectChoice.choices[0]?.kind;
          const choiceBadge =
            choiceKind === "resolve_pending_burst_check"
              ? { label: "バースト", color: "#3182ce" }
              : { label: "誘発", color: "#38a169" };
          const choiceTitle =
            choiceKind === "resolve_pending_burst_check"
              ? "バースト選択"
              : "選択効果";
          const resolvedMessage =
            choiceKind === "resolve_pending_burst_check"
              ? "バースト発動"
              : "誘発効果を解決";
          const choiceLabels = pendingEffectChoice.choices
            .map((a) =>
              "choiceLabel" in a
                ? (a as { choiceLabel?: string }).choiceLabel
                : undefined
            )
            .filter((label): label is string => !!label);
          const effectText =
            choiceLabels.length > 0
              ? choiceLabels.map(localizeEffectLabel).join(" / ")
              : (def?.textLines?.join("\n") ?? "");
          return (
            <div className="effect-choice-overlay" onClick={closeChoice}>
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 解決キュー風カード表示 */}
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-card-image">
                    <img
                      src={display.imagePath ?? "/images/ForGUI/card-back.jpg"}
                      alt={display.cardName}
                    />
                    <span
                      className="effect-queue-badge"
                      style={{ backgroundColor: choiceBadge.color }}
                    >
                      {choiceBadge.label}
                    </span>
                    <span className="effect-queue-player self">自分</span>
                  </div>
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">{choiceTitle}</div>
                    <div className="effect-queue-description">{effectText}</div>
                  </div>
                </div>
                {/* 選択肢ボタン */}
                <div className="effect-choice-buttons">
                  <ActionButtonChoices
                    choices={distinguishActionButtonChoices(
                      pendingEffectChoice.choices.map((a) => {
                        const label =
                          ("choiceLabel" in a &&
                            localizeEffectLabel(
                              (a as { choiceLabel?: string }).choiceLabel ?? ""
                            )) ||
                          "発揮";
                        // ENGINE-step-optional-zero-to-n-target-selection: 0..N 可変選択
                        // (require=0/max>0) も target picker 起動対象。
                        const reqCountChoice =
                          "requiredTargetCount" in a
                            ? ((a as { requiredTargetCount?: number })
                                .requiredTargetCount ?? 0)
                            : 0;
                        const maxCountChoice =
                          "maxTargetCount" in a
                            ? ((a as { maxTargetCount?: number })
                                .maxTargetCount ?? 0)
                            : 0;
                        const needsTarget =
                          (reqCountChoice > 0 || maxCountChoice > 0) &&
                          "candidateTargetInstanceIds" in a;
                        return {
                          key: a.actionId,
                          label,
                          className: "effect-choice-btn",
                          onClick: () => {
                            closeChoice();
                            if (needsTarget) {
                              setPendingAction(a);
                              setSelectedTargets([]);
                              if (reqCountChoice > 0) {
                                showMessage(
                                  `対象を${reqCountChoice}体選択してください`
                                );
                              } else {
                                showMessage(
                                  `対象を最大${maxCountChoice}体まで選択してください`
                                );
                              }
                            } else {
                              try {
                                const result = applyLegalAction({
                                  state,
                                  action: a,
                                  getCardDefinitionById: getDefinition,
                                  ...effectLookups,
                                });
                                setStateAndSync(result.state, a);
                                showMessage(resolvedMessage);
                              } catch (e) {
                                console.error("Action failed:", e);
                                showMessage(`エラー: ${userFacingError(e)}`);
                              }
                            }
                          },
                        };
                      })
                    )}
                  />
                  <button
                    className="effect-choice-btn effect-choice-cancel"
                    onClick={closeChoice}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {displayState.pendingStepOptionalChoice !== null &&
        turnFaceDownChoice === null &&
        displayState.pendingStepOptionalChoice.choosingPlayerId ===
          viewingPlayer &&
        (() => {
          const pending = displayState.pendingStepOptionalChoice;
          const display = getEffectSourceDisplay(
            displayState,
            pending,
            getDefinition
          );
          const def = display.definition;
          const prompt = pending.prompt;
          const effectText =
            prompt?.sourceText ??
            prompt?.label ??
            def?.textLines?.join("\n") ??
            "";
          const stepOptionalActions = myActions.filter(
            (
              a
            ): a is Extract<
              LegalAction,
              { kind: "resolve_pending_step_optional_choice" }
            > =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.pendingId === pending.pendingId
          );
          if (stepOptionalActions.length === 0) return null;
          return (
            <div
              className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
              onClick={() => setModalsHidden(true)}
            >
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-card-image">
                    <img
                      src={display.imagePath ?? "/images/ForGUI/card-back.jpg"}
                      alt={display.cardName}
                    />
                    <span
                      className="effect-queue-badge"
                      style={{ backgroundColor: "#38a169" }}
                    >
                      任意
                    </span>
                    <span className="effect-queue-player self">自分</span>
                  </div>
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">
                      {prompt?.question ?? "任意効果"}
                    </div>
                    <div className="effect-queue-description">{effectText}</div>
                  </div>
                </div>
                <div className="effect-choice-buttons">
                  {stepOptionalActions.map((a) => (
                    <button
                      key={a.actionId}
                      className={`effect-choice-btn${
                        a.choice === "decline" ? " effect-choice-skip" : ""
                      }`}
                      onClick={() => {
                        try {
                          const result = applyLegalAction({
                            state,
                            action: a,
                            getCardDefinitionById: getDefinition,
                            ...effectLookups,
                          });
                          setStateAndSync(result.state, a);
                          showMessage(getActionLabel(a));
                        } catch (e) {
                          console.error("Step optional choice failed:", e);
                          showMessage(`エラー: ${userFacingError(e)}`);
                        }
                      }}
                    >
                      {getActionLabel(a)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

      {displayState.pendingEffectOptionalRepeatChoice !== null &&
        displayState.pendingEffectOptionalRepeatChoice.actingPlayerId ===
          viewingPlayer &&
        (() => {
          const pending = displayState.pendingEffectOptionalRepeatChoice;
          const display = getEffectSourceDisplay(
            displayState,
            pending,
            getDefinition
          );
          const def = display.definition;
          const effect = def?.effects?.[pending.effectIndex];
          const effectText = (effect?.textRef ?? [])
            .map((lineIndex) => def?.textLines?.[lineIndex])
            .filter(
              (line): line is string =>
                typeof line === "string" && line.trim().length > 0
            )
            .join("\n");
          const repeatChoiceActions = myActions.filter(
            (
              action
            ): action is Extract<
              LegalAction,
              { kind: "resolve_pending_effect_optional_repeat_choice" }
            > =>
              action.kind === "resolve_pending_effect_optional_repeat_choice" &&
              action.pendingId === pending.pendingId
          );
          if (repeatChoiceActions.length === 0) return null;
          return (
            <div
              className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
              onClick={() => setModalsHidden(true)}
            >
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-card-image">
                    <img
                      src={display.imagePath ?? "/images/ForGUI/card-back.jpg"}
                      alt={display.cardName}
                    />
                    <span
                      className="effect-queue-badge"
                      style={{ backgroundColor: "#38a169" }}
                    >
                      選択
                    </span>
                    <span className="effect-queue-player self">自分</span>
                  </div>
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">追加発揮選択</div>
                    {effectText && (
                      <div className="effect-queue-description">
                        {effectText}
                      </div>
                    )}
                  </div>
                </div>
                <div className="effect-choice-buttons">
                  <ActionButtonChoices
                    choices={distinguishActionButtonChoices(
                      repeatChoiceActions.map((action) => ({
                        key: action.actionId,
                        className: "effect-choice-btn",
                        label: localizeEffectLabel(action.choiceLabel),
                        onClick: () => {
                          try {
                            const result = applyLegalAction({
                              state,
                              action,
                              getCardDefinitionById: getDefinition,
                              ...effectLookups,
                            });
                            setStateAndSync(result.state, action);
                            showMessage(
                              localizeEffectLabel(action.choiceLabel)
                            );
                          } catch (e) {
                            console.error("Optional repeat choice failed:", e);
                            showMessage(`エラー: ${userFacingError(e)}`);
                          }
                        },
                      }))
                    )}
                  />
                </div>
              </div>
            </div>
          );
        })()}

      {displayState.pendingStepChoice !== null &&
        displayState.pendingStepChoice.choosingPlayerId === viewingPlayer &&
        (() => {
          const pending = displayState.pendingStepChoice;
          const display = getEffectSourceDisplay(
            displayState,
            pending,
            getDefinition
          );
          const def = display.definition;
          const prompt = pending.prompt;
          const effectText =
            prompt?.sourceText ??
            prompt?.label ??
            def?.textLines?.join("\n") ??
            "";
          const stepChoiceActions = myActions.filter(
            (a) => a.kind === "resolve_pending_step_choice"
          );
          if (stepChoiceActions.length === 0) return null;
          const quartzStep =
            pending.continuation.resumeEffectOverride?.steps[pending.stepIndex];
          const quartzChoices = stepChoiceActions.flatMap((choice) => {
            const variant =
              choice.choiceIndex === 0
                ? quartzStep
                : quartzStep?.choice?.[choice.choiceIndex - 1];
            return variant?.action.kind === "quartz_set" &&
              variant.action.placement
              ? [
                  {
                    ...variant.action.placement,
                    actionId: choice.actionId,
                    choice,
                  },
                ]
              : [];
          });
          if (quartzChoices.length === stepChoiceActions.length)
            return (
              <QuartzPlacementHud
                state={displayState}
                actions={quartzChoices}
                getDefinition={getDefinition}
                onSelect={(option) => handleAction(option.choice)}
                hidden={modalsHidden}
                onPeek={() => setModalsHidden(true)}
              >
                <StepChoiceRevealedCards
                  state={displayState}
                  pending={pending}
                  getDefinition={getDefinition}
                />
              </QuartzPlacementHud>
            );
          return (
            <div
              className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
              onClick={() => setModalsHidden(true)}
            >
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-card-image">
                    <img
                      src={display.imagePath ?? "/images/ForGUI/card-back.jpg"}
                      alt={display.cardName}
                    />
                    <span
                      className="effect-queue-badge"
                      style={{ backgroundColor: "#38a169" }}
                    >
                      選択
                    </span>
                    <span className="effect-queue-player self">自分</span>
                  </div>
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">
                      {prompt?.question ?? "効果選択"}
                    </div>
                    <div className="effect-queue-description">{effectText}</div>
                  </div>
                </div>
                <StepChoiceRevealedCards
                  state={displayState}
                  pending={pending}
                  getDefinition={getDefinition}
                />
                <div className="effect-choice-buttons">
                  <ActionButtonChoices
                    choices={distinguishActionButtonChoices(
                      stepChoiceActions.map((a) => {
                        const choicePrompt = a.choicePrompt;
                        const label = localizeEffectLabel(
                          choicePrompt?.label ?? a.choiceLabel
                        );
                        return {
                          key: a.actionId,
                          className: "effect-choice-btn",
                          label,
                          onClick: () => {
                            handleAction(a);
                            showMessage(label);
                          },
                        };
                      })
                    )}
                  />
                </div>
              </div>
            </div>
          );
        })()}

      {/* P3-47 F-4 / P3-76: 効果対象リダイレクトは旧・全画面モーダルを撤去し、既存の対象選択モード
          (field-tap) に統合した。変更先の分身はフィールド上のカードを直接タップして選び
          (疲労状態・コア数が field 描画でそのまま見える)、中央系プロンプトの「変更しない」で
          任意の不使用を選ぶ。配線は targetCandidateIds memo / 専用 useEffect / handleTargetClick /
          中央 prompt (pendingAction ブロック) を参照。 */}

      {braveLeaveChoicePending !== null &&
        braveLeaveChoicePending.choosingPlayerId === viewingPlayer &&
        (() => {
          const pending = braveLeaveChoicePending;
          const keepAction = myActions.find(
            (a): a is ResolveBraveLeaveChoiceLegalAction =>
              a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
          );
          const sendAction = myActions.find(
            (a): a is ResolveBraveLeaveChoiceLegalAction =>
              a.kind === "resolve_brave_leave_choice" &&
              a.choice === "send_with_host"
          );
          if (!keepAction || !sendAction) return null;

          const braveCards = pending.braveInstanceIds
            .map((id) => state.cardInstances.find((c) => c.instanceId === id))
            .filter(Boolean);
          const braveNames = braveCards
            .map((c) => getDefinition(c!.definitionId)?.name ?? "?")
            .join(", ");

          const handleKeep = () => {
            // ブレイヴをフィールドに残す → コア選択UIを起動
            const brave = braveCards[0];
            if (brave) {
              const minCores = brave.minimumRequiredCores;
              if (minCores > 0) {
                coreSelection.start("separation", [
                  { kind: "card", instanceId: brave.instanceId },
                ]);
                setPendingSeparation({
                  action: keepAction as unknown as LegalAction,
                  braveInstanceId: brave.instanceId,
                  minCores,
                });
              } else {
                // Lv1 コスト 0 → コア不要で即残存
                try {
                  const result = applyLegalAction({
                    state,
                    action: keepAction,
                    getCardDefinitionById: getDefinition,
                    ...effectLookups,
                  });
                  setStateAndSync(result.state, keepAction);
                  showMessage("ブレイヴをフィールドに残す");
                } catch (e) {
                  showMessage(`エラー: ${userFacingError(e)}`);
                }
              }
            }
          };

          const handleSend = () => {
            try {
              const result = applyLegalAction({
                state,
                action: sendAction,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, sendAction);
              showMessage("ブレイヴもホストと一緒に移動");
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };

          return (
            <div
              className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
              onClick={() => setModalsHidden(true)}
            >
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">ブレイヴの選択</div>
                    <div className="effect-queue-description">
                      {`${braveNames} をフィールドに残しますか?`}
                    </div>
                  </div>
                </div>
                <div className="effect-choice-buttons">
                  <button className="effect-choice-btn" onClick={handleKeep}>
                    フィールドに残す
                  </button>
                  <button
                    className="effect-choice-btn effect-choice-skip"
                    onClick={handleSend}
                  >
                    一緒に移動
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      <ImmediateAttackJoinPrompt
        actions={myActions}
        cardName={(id) => {
          const card = state.cardInstances.find(
            (candidate) => candidate.instanceId === id
          );
          return card ? (getDefinition(card.definitionId)?.name ?? id) : id;
        }}
        onAction={handleAction}
        hidden={modalsHidden || attackCostSourceChoice !== null}
      />
      {displayState.pendingBraveAttackContinuation !== null &&
        displayState.pendingBraveAttackContinuation.choosingPlayerId ===
          viewingPlayer &&
        (() => {
          const pending = displayState.pendingBraveAttackContinuation;
          const continueAction = myActions.find(
            (a): a is ResolveBraveAttackContinuationLegalAction =>
              a.kind === "resolve_brave_attack_continuation" &&
              a.choice === "continue"
          );
          const endAction = myActions.find(
            (a): a is ResolveBraveAttackContinuationLegalAction =>
              a.kind === "resolve_brave_attack_continuation" &&
              a.choice === "end_attack"
          );
          if (!continueAction || !endAction) return null;

          const braveNames = pending.braveInstanceIds
            .map((id) => {
              const c = state.cardInstances.find((ci) => ci.instanceId === id);
              return c ? (getDefinition(c.definitionId)?.name ?? "?") : "?";
            })
            .join(", ");

          const handleContinue = () => {
            try {
              const result = applyLegalAction({
                state,
                action: continueAction,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, continueAction);
              showMessage("ブレイヴでアタック継続");
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };

          const handleEnd = () => {
            try {
              const result = applyLegalAction({
                state,
                action: endAction,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, endAction);
              showMessage("アタック終了");
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };

          return (
            <div
              className={`effect-choice-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
              onClick={() => setModalsHidden(true)}
            >
              <div
                className="effect-choice-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="effect-queue-card active"
                  style={{ position: "relative", width: 220 }}
                >
                  <div className="effect-queue-text">
                    <div className="effect-queue-timing">アタック継続選択</div>
                    <div className="effect-queue-description">
                      {`${braveNames} でアタックを継続しますか?`}
                    </div>
                  </div>
                </div>
                <div className="effect-choice-buttons">
                  <button
                    className="effect-choice-btn"
                    onClick={handleContinue}
                  >
                    アタック継続
                  </button>
                  <button
                    className="effect-choice-btn effect-choice-skip"
                    onClick={handleEnd}
                  >
                    アタック終了
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ブレイヴ召喚/転醒後ブレイヴ: スタック窓クローズ後の「合体する/スピリット状態」選択モーダル。
          engine `pendingBraveCombineChoice` / `pendingStoneFlipCombine` は同じ
          `resolve_brave_combine_choice` を返す。選択後のコア配置は既存 HUD が処理。 */}
      {braveCombineChoicePending &&
        !isBraveCombineChoiceHostSelection &&
        braveCombineChoicePending.actingPlayerId === viewingPlayer &&
        (() => {
          const pending = braveCombineChoicePending;
          const braveCard = state.cardInstances.find(
            (c) => c.instanceId === pending.braveInstanceId
          );
          const braveDefinitionId =
            pending.braveDefinitionId ?? braveCard?.definitionId;
          const braveDef = braveDefinitionId
            ? getDefinition(braveDefinitionId)
            : undefined;
          const isCorePlacementSpiritChoice =
            "corePlacementChoice" in pending &&
            pending.corePlacementChoice != null;
          const choiceActions = actions.filter(
            (
              a
            ): a is Extract<
              LegalAction,
              { kind: "resolve_brave_combine_choice" }
            > =>
              a.kind === "resolve_brave_combine_choice" &&
              a.pendingId === pending.pendingId
          );
          const hostActions = choiceActions.filter(
            (a) => a.chosenHostInstanceId !== null
          );
          const spiritAction = choiceActions.find(
            (a) => a.chosenHostInstanceId === null
          );
          const applyChoice = (a: LegalAction) => {
            try {
              const result = applyLegalAction({
                state,
                action: a,
                getCardDefinitionById: getDefinition,
                ...effectLookups,
              });
              setStateAndSync(result.state, a);
            } catch (e) {
              showMessage(`エラー: ${userFacingError(e)}`);
            }
          };
          const enterHostSelection = () => {
            const hostTargetIds = hostActions
              .map((a) => a.chosenHostInstanceId)
              .filter((id): id is string => id !== null);
            if (hostTargetIds.length === 1 && hostActions[0]) {
              applyChoice(hostActions[0]);
              return;
            }
            if (!hostActions[0]) return;
            setPendingAction({
              ...hostActions[0],
              candidateTargetInstanceIds: hostTargetIds,
              requiredTargetCount: 1,
              targetMode: "manual" as const,
            } as unknown as LegalAction);
            setSelectedTargets([]);
            showMessage("合体先を選択してください");
          };
          return (
            <div
              className={`card-action-overlay${modalsHidden ? " modal-hidden" : ""}`}
              aria-hidden={modalsHidden ? "true" : undefined}
            >
              <div
                className="card-action-modal"
                onClick={(e) => e.stopPropagation()}
              >
                {braveDef?.image ? (
                  <img
                    className="card-action-image"
                    src={`/${braveDef.image}`}
                    alt={braveDef.name}
                  />
                ) : (
                  <div className="card-action-placeholder">
                    <span>
                      {braveDef?.name ??
                        braveDefinitionId ??
                        pending.braveInstanceId}
                    </span>
                  </div>
                )}
                <div className="card-action-title">直接合体しますか？</div>
                <div className="card-action-buttons">
                  {hostActions.length > 0 && (
                    <button
                      className="card-action-btn"
                      onClick={enterHostSelection}
                    >
                      合体
                    </button>
                  )}
                  {spiritAction && (
                    <button
                      className="card-action-btn"
                      onClick={() => applyChoice(spiritAction)}
                    >
                      {isCorePlacementSpiritChoice
                        ? "スピリット状態"
                        : "いいえ（スピリット状態）"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {!inlineHandSelection &&
        !hasInlineHandTargetSelection &&
        (droppedCardChoice || fieldCardChoice) &&
        (() => {
          const choice = (droppedCardChoice || fieldCardChoice)!;
          const card = state.cardInstances.find(
            (c) => c.instanceId === choice.instanceId
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const closeChoice = () => {
            setDroppedCardChoice(null);
            setFieldCardChoice(null);
          };
          const filteredActions = (() => {
            // brave 系アクションを kind ごとに1つに集約
            const seen = new Set<string>();
            // use_magic は (timing, choiceIndex)、use_accel はソースカード単位で
            // 集約。いずれも paid を表示優先 (free/override 等は同一ボタンに集約し、
            // 押下時に costMode 選択モーダルへ分岐)。
            const seenMagicTimings = new Set<string>();
            const seenAdventSources = new Set<string>();
            const seenHostDualAdventSources = new Set<string>();
            // 同一カードの複数効果発揮 (例: BSTH01-X04 フォーオブアカインド) は
            // 「効果発揮」1 ボタンに集約し、押下後に効果選択モーダルで分岐する。
            const seenFieldEffectSources = new Set<string>();
            // P3-127: attack/join_active_attack のコスト源 (破壊/重疲労させる
            // カード) 候補が複数あっても 1 ボタンに集約 (後段で候補選択モーダル)。
            const seenAttackGroups = new Set<string>();
            const filtered = choice.actions.filter((a) => {
              if (
                a.kind === "attack" &&
                "targetInstanceId" in a &&
                a.targetInstanceId
              )
                return false;
              if (
                a.kind === "attack" ||
                a.kind === "join_active_attack" ||
                a.kind === "block"
              ) {
                const key = attackCostGroupKey(a);
                if (seenAttackGroups.has(key)) return false;
                seenAttackGroups.add(key);
              }
              if (
                a.kind === "brave_combine" ||
                a.kind === "brave_separate" ||
                a.kind === "brave_swap" ||
                a.kind === "contract_combine" ||
                a.kind === "link_aid"
              ) {
                // brave 系候補は後段で候補選択。link_aid は魂状態カードの宣言ボタンへ集約し、
                // 効果文内コスト源はスタック窓後の pending で選ぶ。
                if (seen.has(a.kind)) return false;
                seen.add(a.kind);
              }
              if (a.kind === "use_magic") {
                // 同 (timing, choiceIndex) の paid を優先表示。free のみの場合は free を表示。
                // choice 変種 (choiceIndex 違い、BSTH01-C21 等) は別ボタンとして残す。
                const key = `${a.timing}:${a.choiceIndex ?? ""}`;
                if (seenMagicTimings.has(key)) return false;
                const paidExists = choice.actions.some(
                  (b) =>
                    b.kind === "use_magic" &&
                    b.timing === a.timing &&
                    b.choiceIndex === a.choiceIndex &&
                    b.costMode === "paid"
                );
                if (paidExists && a.costMode !== "paid") return false;
                seenMagicTimings.add(key);
              }
              if (a.kind === "use_accel") {
                // 同一ソースカードの paid を優先表示 (use_magic と同型の集約。
                // ENGINE-accel-tribe-cost-override, BSTH08.5-R12)。
                const key = `accel:${a.sourceInstanceId}`;
                if (seenMagicTimings.has(key)) return false;
                const paidExists = choice.actions.some(
                  (b) =>
                    b.kind === "use_accel" &&
                    b.sourceInstanceId === a.sourceInstanceId &&
                    (b.costMode ?? "paid") === "paid"
                );
                if (paidExists && (a.costMode ?? "paid") !== "paid")
                  return false;
                seenMagicTimings.add(key);
              }
              if (a.kind === "declare_advent") {
                const key = `advent:${a.sourceInstanceId}`;
                if (seenAdventSources.has(key)) return false;
                const normalExists = choice.actions.some(
                  (b) =>
                    b.kind === "declare_advent" &&
                    b.sourceInstanceId === a.sourceInstanceId &&
                    !b.useAlternateCost
                );
                if (normalExists && a.useAlternateCost) return false;
                seenAdventSources.add(key);
              }
              if (a.kind === "declare_host_dual_advent") {
                const key = `host_dual_advent:${a.sourceInstanceId}`;
                if (seenHostDualAdventSources.has(key)) return false;
                const normalExists = choice.actions.some(
                  (b) =>
                    b.kind === "declare_host_dual_advent" &&
                    b.sourceInstanceId === a.sourceInstanceId &&
                    !b.useAlternateCost
                );
                if (normalExists && a.useAlternateCost) return false;
                seenHostDualAdventSources.add(key);
              }
              if (a.kind === "use_field_card_effect") {
                // 同一カードの効果発揮は 1 ボタンに集約 (後段で効果選択)。
                const sourceInstanceId = getCardActionModalSourceInstanceId(
                  a,
                  choice.instanceId
                );
                if (seenFieldEffectSources.has(sourceInstanceId)) return false;
                seenFieldEffectSources.add(sourceInstanceId);
              }
              return true;
            });
            // 表示順固定 (詳細: card-action-modal-order.ts)。
            return sortCardActionsForModal(filtered);
          })();
          const actionGroups = groupCardActionsForModal(
            filteredActions,
            choice.instanceId
          );
          const renderSourceVisual = (sourceDef: CardDefinition | undefined) =>
            sourceDef?.image ? (
              <img
                className="card-action-image"
                src={`/${sourceDef.image}`}
                alt={sourceDef.name}
              />
            ) : sourceDef ? (
              <div className="card-action-placeholder">
                <span>{sourceDef.name}</span>
                <span>{sourceDef.printedCategory}</span>
              </div>
            ) : null;
          const getGroupDefinition = (group: (typeof actionGroups)[number]) => {
            const groupCard =
              state.cardInstances.find(
                (c) => c.instanceId === group.instanceId
              ) ?? card;
            return groupCard ? getDefinition(groupCard.definitionId) : def;
          };
          const getSimultaneousAttack = (
            group: (typeof actionGroups)[number]
          ) => {
            const simulAttack = group.actions.find(
              (b): b is AttackLegalAction =>
                b.kind === "attack" &&
                !("targetInstanceId" in b && b.targetInstanceId) &&
                b.simultaneousAttackOption !== undefined
            );
            return {
              simulAttack,
              option: simulAttack?.simultaneousAttackOption,
            };
          };
          const handleModalAction = (a: LegalAction) => {
            if (a.kind === "use_magic") {
              const variants = choice.actions.filter(
                (b): b is UseMagicLegalAction =>
                  b.kind === "use_magic" &&
                  b.sourceInstanceId === a.sourceInstanceId &&
                  b.timing === a.timing &&
                  b.choiceIndex === a.choiceIndex
              );
              closeChoice();
              setHandOverride(false);
              if (new Set(variants.map((b) => b.effectIndex)).size > 1) {
                setMagicEffectChoice({
                  actions: variants,
                  instanceId: a.sourceInstanceId,
                });
              } else {
                handleMagicEffectSelected(a, variants);
              }
              return;
            }
            if (a.kind === "use_accel") {
              // 同一ソースカードで paid/free 両方が legal なら
              // コストモード選択モーダルへ (use_magic と同型)。
              const sameSourceActions = choice.actions.filter(
                (b): b is UseAccelLegalAction =>
                  b.kind === "use_accel" &&
                  b.sourceInstanceId === a.sourceInstanceId
              );
              const paidVariant = sameSourceActions.find(
                (b) => (b.costMode ?? "paid") === "paid"
              );
              const freeVariant = sameSourceActions.find(
                (b) => b.costMode === "free"
              );
              if (paidVariant && freeVariant) {
                const srcId = freeVariant.costOverrideSourceInstanceId;
                const sourceCard = srcId
                  ? state.cardInstances.find((c) => c.instanceId === srcId)
                  : undefined;
                const freeSourceCardName = sourceCard
                  ? getDefinition(sourceCard.definitionId)?.name
                  : undefined;
                closeChoice();
                setAccelCostModeChoice({
                  paidAction: paidVariant,
                  freeAction: freeVariant,
                  ...(freeSourceCardName ? { freeSourceCardName } : {}),
                });
                return;
              }
            }
            if (a.kind === "declare_advent") {
              closeChoice();
              setHandOverride(false);
              handleAction(a);
              return;
            }
            if (a.kind === "declare_host_dual_advent") {
              closeChoice();
              setHandOverride(false);
              handleAction(a);
              return;
            }
            if (a.kind === "use_field_card_effect") {
              // 同一カードに複数の効果発揮があれば効果選択モーダルへ。
              const fieldEffectActions = dedupeFieldEffectChoiceActions(
                choice.actions.filter(
                  (b): b is FieldCardEffectLegalAction =>
                    b.kind === "use_field_card_effect" &&
                    getCardActionModalSourceInstanceId(b, choice.instanceId) ===
                      getCardActionModalSourceInstanceId(a, choice.instanceId)
                )
              );
              if (fieldEffectActions.length > 1) {
                closeChoice();
                setHandOverride(false);
                setFieldEffectChoice({
                  actions: fieldEffectActions,
                  instanceId: getCardActionModalSourceInstanceId(
                    a,
                    choice.instanceId
                  ),
                });
                return;
              }
            }
            closeChoice();
            // action コミット (cancel 以外) で手札ドロワーを閉じる。
            // コスト 0 / 自動コスト等で pendingCostPayment / pendingPlacement
            // が立たないアクション (use_magic / attack / effect 等) でも確実に
            // 閉じるよう、 useEffect ベースの post-tap modal フックではなく
            // ここで明示的に setHandOverride(false) を打つ。
            setHandOverride(false);
            if (a.kind === "brave_combine") {
              // 合体先スピリット選択モードに入る
              const targets = actions
                .filter(
                  (ca): ca is typeof a =>
                    ca.kind === "brave_combine" &&
                    ca.braveInstanceId === a.braveInstanceId
                )
                .map((ca) => ca.targetInstanceId);
              setPendingAction({
                ...a,
                candidateTargetInstanceIds: targets,
                requiredTargetCount: 1,
                targetMode: "manual" as const,
              } as unknown as LegalAction);
              setSelectedTargets([]);
              showMessage("合体先を選択してください");
            } else if (a.kind === "brave_swap") {
              // 交換先スピリット選択モードに入る
              const targets = actions
                .filter(
                  (ca): ca is typeof a =>
                    ca.kind === "brave_swap" &&
                    ca.braveInstanceId === a.braveInstanceId
                )
                .map((ca) => ca.toHostInstanceId);
              setPendingAction({
                ...a,
                candidateTargetInstanceIds: targets,
                requiredTargetCount: 1,
                targetMode: "manual" as const,
              } as unknown as LegalAction);
              setSelectedTargets([]);
              showMessage("交換先を選択してください");
            } else if (a.kind === "contract_combine") {
              handleAction(a);
            } else if (a.kind === "link_aid") {
              handleAction(a);
            } else if (a.kind === "brave_separate") {
              // コア選択UIを起動（D&D パスと同等）
              const brave = state.cardInstances.find(
                (c) => c.instanceId === a.braveInstanceId
              );
              const minCores = brave?.minimumRequiredCores ?? 0;
              coreSelection.start("separation", [
                { kind: "card", instanceId: a.braveInstanceId },
              ]);
              setPendingSeparation({
                action: a,
                braveInstanceId: a.braveInstanceId,
                minCores,
              });
            } else {
              // P3-127: attack/join_active_attack のコスト源 (破壊/
              // 重疲労させるカード) 候補選択ゲートは handleAction 側
              // (SSOT) で一元判定する。ここでは常に handleAction を呼ぶ。
              handleAction(a);
            }
          };
          const getCardActionButtonLabel = (a: LegalAction) => {
            if (a.kind === "use_field_card_effect") return "効果発揮";
            if (a.kind === "use_hand_card_effect") return "効果発揮";
            if (a.kind === "block") {
              const sameSourceBlocks = choice.actions.filter(
                (b) =>
                  b.kind === "block" &&
                  b.sourceInstanceId === a.sourceInstanceId
              );
              if (sameSourceBlocks.length <= 1) return "ブロック";
              const entity = state.battleEntities.find(
                (en) => en.entityId === a.participantEntityId
              );
              const memberId = entity?.memberInstanceIds[0];
              const memberCard = memberId
                ? state.cardInstances.find((c) => c.instanceId === memberId)
                : undefined;
              const memberDef = memberCard
                ? getDefinition(memberCard.definitionId)
                : undefined;
              return `ブロック（→${memberDef?.name ?? "?"}）`;
            }
            return getActionLabel(a);
          };
          const getCardActionButtonChoices = (
            groupActions: readonly LegalAction[]
          ): ActionButtonChoice[] => {
            const quartz = groupActions.find(
              (action) => action.kind === "set_quartz"
            );
            return [
              ...(quartz
                ? [
                    {
                      key: `quartz:${quartz.sourceInstanceId}`,
                      sourceId: quartz.sourceInstanceId,
                      label: "クォーツセット",
                      onClick: () => {
                        closeChoice();
                        setHandOverride(false);
                        setQuartzPlacementSource(quartz.sourceInstanceId);
                      },
                    },
                  ]
                : []),
              ...groupActions
                .filter((a) => a.kind !== "set_quartz")
                .map((a) => {
                  const sourceId = getCardActionModalSourceInstanceId(
                    a,
                    choice.instanceId
                  );
                  const sourceCard = state.cardInstances.find(
                    (c) => c.instanceId === sourceId
                  );
                  const sourceDef = sourceCard
                    ? getDefinition(sourceCard.definitionId)
                    : def;
                  const skill =
                    a.kind === "use_divine_skill"
                      ? sourceDef?.grandwalkerData?.divineSkills?.[a.skillIndex]
                      : undefined;
                  const skillText = skill?.effects
                    ?.flatMap((effect) =>
                      (effect.textRef ?? []).map(
                        (line) => sourceDef?.textLines[line] ?? ""
                      )
                    )
                    .filter(Boolean)
                    .join(" ");
                  const mirageDescription =
                    a.kind === "set_mirage"
                      ? a.replacedMirageInstanceIds.length === 0
                        ? "追加"
                        : a.replacedMirageInstanceIds
                            .map((id) => {
                              const index = state.mirageSetStates
                                .filter(
                                  (entry) => entry.playerId === a.actingPlayerId
                                )
                                .findIndex(
                                  (entry) => entry.cardInstanceId === id
                                );
                              return `${cardNameForInstance(id)}（セット${index + 1}）と入れ替え`;
                            })
                            .join("、")
                      : undefined;
                  const description =
                    mirageDescription ||
                    (a.kind === "use_divine_skill"
                      ? `${a.coreCost}個：${divineSkillChoiceText(skillText || getCardActionButtonLabel(a), a.coreCost)}`
                      : undefined) ||
                    ("choiceLabel" in a && a.choiceLabel
                      ? localizeEffectLabel(a.choiceLabel)
                      : undefined) ||
                    ("effectIndex" in a
                      ? extractEffectChoiceTextByEffectIndex(
                          sourceDef,
                          a.effectIndex
                        )
                      : undefined) ||
                    ("targetInstanceId" in a && a.targetInstanceId
                      ? `${getCardActionButtonLabel(a)}（${cardNameForInstance(a.targetInstanceId)}）`
                      : undefined);
                  return {
                    key: a.actionId,
                    sourceId,
                    label:
                      a.kind === "set_mirage" &&
                      groupActions.filter(
                        (candidate) => candidate.kind === "set_mirage"
                      ).length === 1
                        ? `ミラージュセット（${mirageDescription}）`
                        : getCardActionButtonLabel(a),
                    ...(description ? { description } : {}),
                    onClick: () => handleModalAction(a),
                  };
                }),
            ];
          };
          const renderActionButtons = (
            groupActions: readonly LegalAction[]
          ) => (
            <ActionButtonChoices
              choices={getCardActionButtonChoices(groupActions)}
            />
          );
          const renderSimultaneousAttackButton = (
            simulAttack: AttackLegalAction,
            option: NonNullable<AttackLegalAction["simultaneousAttackOption"]>
          ) => (
            <button
              key={`${simulAttack.actionId}:simul`}
              className="card-action-btn"
              onClick={() => {
                closeChoice();
                setHandOverride(false);
                setPendingAction({
                  ...simulAttack,
                  candidateTargetInstanceIds: option.candidateInstanceIds,
                  requiredTargetCount: 1,
                  maxTargetCount: option.maxCount - 1,
                  targetMode: "manual" as const,
                } as unknown as LegalAction);
                setSelectedTargets([]);
                showMessage("同時にアタックするスピリットを選択（確定で宣言）");
              }}
            >
              複数でアタック
            </button>
          );
          const isMultipleSourceModal = actionGroups.length > 1;
          const singleGroup = actionGroups[0];
          const singleSimul = singleGroup
            ? getSimultaneousAttack(singleGroup)
            : { simulAttack: undefined, option: undefined };
          const renderedActionCountForGroup = (
            group: (typeof actionGroups)[number]
          ) => {
            const { simulAttack, option } = getSimultaneousAttack(group);
            return (
              groupActionButtonChoices(
                getCardActionButtonChoices(group.actions)
              ).length + (simulAttack && option ? 1 : 0)
            );
          };
          const actionCountClass = (count: number) =>
            `card-action-source-actions-${Math.min(Math.max(count, 1), 4)}`;
          const renderedActionRowCount = (count: number) =>
            Math.max(1, Math.ceil(count / 2));
          const maxRenderedActionRowCount = Math.max(
            1,
            ...actionGroups.map((group) =>
              renderedActionRowCount(renderedActionCountForGroup(group))
            )
          );
          return (
            <div className="card-action-overlay" onClick={closeChoice}>
              <div
                className={`card-action-modal${isMultipleSourceModal ? " card-action-modal-multiple" : ""}${
                  isMultipleSourceModal
                    ? ` card-action-modal-source-action-rows-${Math.min(
                        maxRenderedActionRowCount,
                        4
                      )}`
                    : ""
                }`}
                style={
                  isMultipleSourceModal
                    ? ({
                        "--card-action-source-max-rows": String(
                          maxRenderedActionRowCount
                        ),
                      } as CSSProperties)
                    : undefined
                }
                onClick={(e) => e.stopPropagation()}
              >
                {isMultipleSourceModal ? (
                  <>
                    <div className="card-action-source-list card-action-source-list-multiple">
                      {actionGroups.map((group) => {
                        const groupDef = getGroupDefinition(group);
                        const { simulAttack, option } =
                          getSimultaneousAttack(group);
                        const renderedActionCount =
                          renderedActionCountForGroup(group);
                        return (
                          <div
                            key={group.instanceId}
                            className={`card-action-source ${actionCountClass(
                              renderedActionCount
                            )}`}
                          >
                            {renderSourceVisual(groupDef)}
                            <div className="card-action-buttons">
                              {renderActionButtons(group.actions)}
                              {simulAttack && option
                                ? renderSimultaneousAttackButton(
                                    simulAttack,
                                    option
                                  )
                                : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="card-action-buttons card-action-cancel-row">
                      <button
                        className="card-action-btn card-action-cancel"
                        onClick={closeChoice}
                      >
                        キャンセル
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {renderSourceVisual(
                      singleGroup ? getGroupDefinition(singleGroup) : def
                    )}
                    <div className="card-action-buttons">
                      {renderActionButtons(
                        singleGroup?.actions ?? filteredActions
                      )}
                      {singleSimul.simulAttack && singleSimul.option
                        ? renderSimultaneousAttackButton(
                            singleSimul.simulAttack,
                            singleSimul.option
                          )
                        : null}
                      <button
                        className="card-action-btn card-action-cancel"
                        onClick={closeChoice}
                      >
                        キャンセル
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {/* 効果発揮の効果選択モーダル。
          同一カードに複数の効果発揮 (例: BSTH01-X04 フォーオブアカインド) があるとき、
          「効果発揮」押下後に開く。各効果のテキストを表示して 1 つを選ばせ、選択後に
          handleAction で宣言 → スタック窓へ進む (相手のスタックタイミング)。 */}
      {fieldEffectChoice &&
        (() => {
          const choice = fieldEffectChoice;
          const card = state.cardInstances.find(
            (c) => c.instanceId === choice.instanceId
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const closeChoice = () => setFieldEffectChoice(null);
          const effectActions = dedupeFieldEffectChoiceActions(choice.actions);
          return (
            <div className="card-action-overlay" onClick={closeChoice}>
              <div
                className="card-action-modal card-action-modal-effect-choice"
                onClick={(e) => e.stopPropagation()}
              >
                {def?.image ? (
                  <img
                    className="card-action-image"
                    src={`/${def.image}`}
                    alt={def.name}
                  />
                ) : def ? (
                  <div className="card-action-placeholder">
                    <span>{def.name}</span>
                  </div>
                ) : null}
                <div className="card-action-effect-choice-title">
                  発揮する効果を選択
                </div>
                <div className="card-action-buttons">
                  <ActionButtonChoices
                    choices={distinguishActionButtonChoices(
                      effectActions.map((a) => {
                        const effectDefinition =
                          getDefinition(getFieldEffectActionDefinitionId(a)) ??
                          def;
                        const effectIndex =
                          effectLookups.getRegisteredFieldCardEffectActions(
                            a.sourceCardNo
                          )?.[a.registrationIndex]?.effectIndex;
                        const text = compactEffectChoiceText(
                          extractEffectChoiceTextByEffectIndex(
                            effectDefinition,
                            effectIndex
                          ) ??
                            extractEffectTextByRegistrationIndex(
                              effectDefinition,
                              a.registrationIndex
                            ) ??
                            (a.choiceLabel
                              ? localizeEffectLabel(a.choiceLabel)
                              : undefined) ??
                            `効果 ${a.registrationIndex + 1}`
                        );
                        return {
                          key: fieldEffectChoiceActionKey(a),
                          className:
                            "card-action-btn card-action-effect-option",
                          label: text,
                          onClick: () => {
                            closeChoice();
                            setHandOverride(false);
                            handleAction(a);
                          },
                        };
                      })
                    )}
                  />
                  <button
                    className="card-action-btn card-action-cancel"
                    onClick={closeChoice}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* マジック使用のコストモード選択モーダル
          タイミング選択 (card-action-modal) で paid+free 両方が legal action にあった場合のみ表示。
          ボタンは 3 つ: コスト支払わず使用 / 通常コストで使用 / キャンセル。
          use_magic は使用コスト支払い後にスタック窓が開くため、ここは
          スタック前のコスト経路選択としてキャンセル可能。 */}
      {magicEffectChoice &&
        (() => {
          const choice = magicEffectChoice;
          const card = state.cardInstances.find(
            (c) => c.instanceId === choice.instanceId
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const effectActions = choice.actions.filter(
            (a, i, all) =>
              all.findIndex((b) => b.effectIndex === a.effectIndex) === i
          );
          return (
            <ActionModeChoiceModal
              overlayClassName="card-action-overlay"
              modalClassName="card-action-modal card-action-modal-effect-choice"
              imageClassName="card-action-image"
              testId="magic-effect-choice-modal"
              cardDefinition={def}
              prompt="使用する効果を選択"
              buttons={effectActions.map((a) => ({
                key: String(a.effectIndex),
                className: "card-action-btn card-action-effect-option",
                testId: "magic-effect-option-" + a.effectIndex,
                label: compactEffectChoiceText(
                  extractEffectChoiceTextByEffectIndex(def, a.effectIndex) ??
                    (a.choiceLabel
                      ? localizeEffectLabel(a.choiceLabel)
                      : undefined) ??
                    "効果 " + ((a.effectIndex ?? 0) + 1)
                ),
                onClick: () => {
                  setMagicEffectChoice(null);
                  handleMagicEffectSelected(a, choice.actions);
                },
              }))}
              onClose={() => setMagicEffectChoice(null)}
            />
          );
        })()}
      {magicCostModeChoice &&
        (() => {
          const choice = magicCostModeChoice;
          const baseAction =
            choice.paidAction ??
            choice.zoneDiscountAction ??
            choice.overrideAction ??
            choice.freeAction;
          if (!baseAction) return null;
          const card = state.cardInstances.find(
            (c) => c.instanceId === baseAction.sourceInstanceId
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const closeChoice = () => setMagicCostModeChoice(null);
          const timingLabel =
            baseAction.timing === "main"
              ? "メイン"
              : baseAction.timing === "flash"
                ? "フラッシュ"
                : "スタック";
          const buttons: ActionModeChoiceButton[] = [];
          if (choice.freeAction) {
            buttons.push({
              key: "free",
              className: "magic-cost-mode-free",
              testId: "magic-cost-mode-free",
              label: "コストを支払わず使用",
              description: choice.freeSourceCardName
                ? `${choice.freeSourceCardName}の効果`
                : undefined,
              onClick: () => {
                const action = choice.freeAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          if (choice.overrideAction) {
            buttons.push({
              key: "override",
              className: "magic-cost-mode-override",
              testId: "magic-cost-mode-override",
              label: `${choice.overrideAction.overrideCost ?? choice.overrideAction.finalCost}コストで使用`,
              description: choice.overrideSourceCardName
                ? `${choice.overrideSourceCardName}の効果`
                : undefined,
              onClick: () => {
                const action = choice.overrideAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          if (choice.zoneDiscountAction) {
            buttons.push({
              key: "zone-discount",
              className: "magic-cost-mode-override",
              testId: "magic-cost-mode-zone-discount",
              label: `${choice.zoneDiscountAction.finalCost}コストで使用`,
              description: "追加コスト適用",
              onClick: () => {
                const action = choice.zoneDiscountAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          if (choice.paidAction) {
            buttons.push({
              key: "paid",
              className: "magic-cost-mode-paid",
              testId: "magic-cost-mode-paid",
              label: "通常コストで使用",
              description: `${choice.paidAction.finalCost}コア`,
              onClick: () => {
                const action = choice.paidAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          buttons.push({
            key: "cancel",
            className: "card-action-cancel",
            testId: "magic-cost-mode-cancel",
            label: "キャンセル",
            onClick: closeChoice,
          });
          return (
            <ActionModeChoiceModal
              overlayClassName="magic-cost-mode-overlay"
              testId="magic-cost-mode-modal"
              cardDefinition={def}
              prompt={`${timingLabel}使用 — どのコストで使用しますか?`}
              buttons={buttons}
              onClose={closeChoice}
            />
          );
        })()}

      {/* アクセル使用のコストモード選択モーダル (magicCostModeChoice の簡略版)。
          card-action-modal で同一ソースカードの paid+free 両方が legal action に
          あった場合のみ表示。use_magic と同じくスタック前のコスト経路選択なので
          キャンセル可能。 */}
      {accelCostModeChoice &&
        (() => {
          const choice = accelCostModeChoice;
          const baseAction = choice.paidAction ?? choice.freeAction;
          if (!baseAction) return null;
          const card = state.cardInstances.find(
            (c) => c.instanceId === baseAction.sourceInstanceId
          );
          const def = card ? getDefinition(card.definitionId) : undefined;
          const closeChoice = () => setAccelCostModeChoice(null);
          const buttons: ActionModeChoiceButton[] = [];
          if (choice.freeAction) {
            buttons.push({
              key: "free",
              className: "magic-cost-mode-free",
              testId: "accel-cost-mode-free",
              label: "コストを支払わず使用",
              description: choice.freeSourceCardName
                ? `${choice.freeSourceCardName}の効果`
                : undefined,
              onClick: () => {
                const action = choice.freeAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          if (choice.paidAction) {
            buttons.push({
              key: "paid",
              className: "magic-cost-mode-paid",
              testId: "accel-cost-mode-paid",
              label: "通常コストで使用",
              description: `${choice.paidAction.finalCost}コア`,
              onClick: () => {
                const action = choice.paidAction!;
                closeChoice();
                setHandOverride(false);
                handleAction(action);
              },
            });
          }
          buttons.push({
            key: "cancel",
            className: "card-action-cancel",
            testId: "accel-cost-mode-cancel",
            label: "キャンセル",
            onClick: closeChoice,
          });
          return (
            <ActionModeChoiceModal
              overlayClassName="accel-cost-mode-overlay"
              modalClassName="accel-cost-mode-modal"
              imageClassName="accel-cost-mode-image"
              testId="accel-cost-mode-modal"
              cardDefinition={def}
              prompt="アクセル使用 — どのコストで使用しますか?"
              buttons={buttons}
              onClose={closeChoice}
            />
          );
        })()}

      {asIfSoulCoreChoice &&
        (() => {
          const choice = asIfSoulCoreChoice;
          const visualCard = state.cardInstances.find(
            (c) => c.instanceId === choice.visualInstanceId
          );
          const visualDef = visualCard
            ? getDefinition(visualCard.definitionId)
            : undefined;
          const closeChoice = () => {
            setAsIfSoulCoreChoice(null);
            setPendingAction(null);
            setSelectedTargets([]);
          };
          const buttons: ActionModeChoiceButton[] = choice.options.map(
            (option, index) => ({
              key: option.action.actionId,
              className:
                option.action.choiceId === "normal"
                  ? "magic-cost-mode-paid"
                  : "magic-cost-mode-free",
              testId: `as-if-soul-core-option-${index}`,
              label: option.label,
              description: option.sourceName
                ? `${option.sourceName}の効果`
                : undefined,
              onClick: () => applyAsIfSoulCoreAction(option.action),
            })
          );
          return (
            <ActionModeChoiceModal
              overlayClassName="as-if-soul-core-overlay"
              testId="as-if-soul-core-modal"
              cardDefinition={visualDef}
              prompt={choice.prompt}
              buttons={buttons}
              onClose={closeChoice}
              closeOnOverlayClick={false}
            />
          );
        })()}

      {zoneBrowse && (
        <ZoneBrowseModal
          // sanitize 済み state で解決 (未公開の相手バーストがあれば伏せる。
          // トラッシュ/除外/手元は元々公開ゾーンのため displayState でも内容は同一)。
          state={displayState}
          zone={zoneBrowse.zone}
          playerId={zoneBrowse.playerId}
          playerLabel={zoneBrowse.label}
          getDefinition={getDefinition}
          onClose={() => setZoneBrowse(null)}
          actions={
            hasUiPending || coreTapMode || targetCandidateIds ? [] : actions
          }
          viewingPlayerId={viewingPlayer}
          onCardAction={(instanceId, cardActions) =>
            setDroppedCardChoice({ instanceId, actions: cardActions })
          }
          {...(coreTapMode
            ? {
                selectableIds: coreTapTargetIds,
                onSelectInstance: (instanceId: string) => {
                  handleCoreTapClick(instanceId);
                  setZoneBrowse(null);
                },
                selectionHint: "クリック: コア操作 ／ 右クリック・長押し: 詳細",
              }
            : cardSelection.choice
              ? {
                  selectableIds: cardSelection.candidateIds,
                  selectedIds: cardSelection.selectedIds,
                  onSelectInstance: cardSelection.toggle,
                  selectionHint:
                    "クリック: 選択切り替え ／ 右クリック・長押し: 詳細",
                }
              : targetCandidateIds
                ? {
                    selectableIds: targetCandidateIds,
                    selectedIds: selectedTargets,
                    onSelectInstance: handleTargetClick,
                    selectionHint:
                      "クリック: 対象選択 ／ 右クリック・長押し: 詳細",
                  }
                : {})}
        />
      )}

      {revealedTargetIds && targetCandidateIds && (
        <DeckRevealTargetModal
          state={displayState}
          instanceIds={revealedTargetIds}
          getDefinition={getDefinition}
          candidateIds={targetCandidateIds}
          selectedIds={selectedTargets}
          onSelect={handleTargetClick}
          onConfirm={() => applyTargetSelection(selectedTargets)}
          canConfirm={
            selectedTargets.length >= pendingRequiredCount &&
            selectedTargets.length <= pendingMaxCount &&
            satisfiesSelectionTargetGroups(
              selectedTargets,
              pendingTargetGroups,
              pendingAllowsDuplicateTargets
            )
          }
          onClose={() => setModalsHidden(true)}
          hidden={modalsHidden}
        />
      )}
      {publicRevealedIds.length > 0 &&
        !revealedTargetIds &&
        !displayState.pendingDeckReveal && (
          <button
            className="reveal-browse-toggle"
            onClick={() => setRevealBrowseOpen(true)}
          >
            オープン中のカード ({publicRevealedIds.length}枚)
          </button>
        )}
      {revealBrowseOpen &&
        publicRevealedIds.length > 0 &&
        !revealedTargetIds && (
          <DeckRevealTargetModal
            state={displayState}
            instanceIds={publicRevealedIds}
            getDefinition={getDefinition}
            selectedIds={selectedTargets}
            pickedIds={confirmedRevealedIds}
            onClose={() => setRevealBrowseOpen(false)}
          />
        )}

      {targetBrowseOpen &&
        !revealedTargetIds &&
        (cardSelection.choice || pendingAction) &&
        (cardSelection.choice
          ? cardSelection.zoneIds.length
          : browsedTargetCandidateIds.length) > 0 && (
          <ZoneBrowseModal
            state={displayState}
            instanceIds={
              cardSelection.choice
                ? cardSelection.zoneIds
                : browsedTargetCandidateIds
            }
            titleOverride="ゾーン候補"
            groupByOwnerZone
            getDefinition={getDefinition}
            onClose={() => setTargetBrowseOpen(false)}
            viewingPlayerId={viewingPlayer}
            selectedIds={
              cardSelection.choice ? cardSelection.selectedIds : selectedTargets
            }
            onSelectInstance={
              cardSelection.choice ? cardSelection.toggle : handleTargetClick
            }
            selectionHint="クリック: 対象選択 ／ 右クリック・長押し: 詳細"
            {...(cardSelection.choice
              ? { selectableIds: cardSelection.candidateIds }
              : targetCandidateIds
                ? { selectableIds: targetCandidateIds }
                : {})}
          />
        )}

      {quartzPlacementSource !== null && (
        <QuartzPlacementHud
          state={displayState}
          actions={actions.filter(
            (a): a is Extract<LegalAction, { kind: "set_quartz" }> =>
              a.kind === "set_quartz" &&
              a.sourceInstanceId === quartzPlacementSource
          )}
          getDefinition={getDefinition}
          onCancel={() => setQuartzPlacementSource(null)}
          onSelect={(action) => {
            setQuartzPlacementSource(null);
            handleAction(action);
          }}
        />
      )}

      {fieldStackBrowse && (
        <ZoneBrowseModal
          // sanitize 済み state で解決 (裏向きアンダーカードがあれば相手には伏せる)。
          state={displayState}
          instanceIds={fieldStackBrowse.instanceIds}
          titleOverride={fieldStackBrowse.title}
          groupByFieldStackRole
          getDefinition={getDefinition}
          onClose={() => setFieldStackBrowse(null)}
          {...(targetCandidateIds
            ? {
                selectableIds: targetCandidateIds,
                selectedIds: selectedTargets,
                onSelectInstance: handleTargetClick,
                selectionHint: "クリック: 対象選択 ／ 右クリック・長押し: 詳細",
              }
            : {})}
        />
      )}

      {detailCard && (
        <CardDetailModal
          // sanitize 済みインスタンスで解決し、相手の非公開カードは正体を伏せる
          // (_hidden_card_ → card=null → BunshinOnlyDetail / 裏向き表示にフォールバック)。
          card={
            getDefinition(
              (sanitizedCardById.get(detailCard.instanceId) ?? detailCard)
                .definitionId
            ) ?? null
          }
          cardInstance={
            sanitizedCardById.get(detailCard.instanceId) ?? detailCard
          }
          gameState={state}
          getCardDefinitionById={getDefinition}
          hideDeckActions
          onClose={() => setDetailCard(null)}
        />
      )}

      {/* 対象選択モーダルの「盤面確認」/「対象選択に戻る」トグル
          解決キュー「非表示」と同じ画面右端 (top-right) に配置。
          ゲーム進行操作は hasUiPending / hasPending によりブロック済み。 */}
      {hasFullScreenModalPending && (
        <button
          type="button"
          className={`modal-peek-toggle${modalsHidden ? " modal-peek-toggle--peeked" : ""}`}
          data-testid="modal-peek-toggle"
          onClick={() => setModalsHidden((v) => !v)}
          title={
            modalsHidden
              ? "一時非表示にした選択モーダルを表示"
              : "盤面/手札/トラッシュを確認 (選択状態は保持)"
          }
        >
          {modalsHidden ? modalPeekReturnLabel : "盤面確認"}
        </button>
      )}

      {!replayControls && state.gameResult && resultOverlayVisible && (
        <GameResultOverlay
          result={state.gameResult}
          viewingPlayerId={viewingPlayer}
          onReset={readOnly ? undefined : () => void handleRematch()}
          onSaveReplay={readOnly || IS_INTERVIEW_BUILD ? undefined : () => void handleSaveReplay()}
          busy={resultBusy}
          error={resultError}
          onHome={onHome}
        />
      )}

      {replayControls && state.preGame && (
        <BattlePreGamePresentation
          gameState={state}
          viewingPlayerId={viewingPlayer}
          uiPhase={
            replayPresentation?.preGamePhase ??
            initialPreGameUiPhase(state.preGame, viewingPlayer)
          }
          getDefinition={getDefinition}
        />
      )}
      {!replayControls && !jankenDone && state && (
        <BattlePreGameOverlay
          key={roomGameNumber}
          gameState={state}
          viewingPlayerId={viewingPlayer}
          isRoom={!!roomId}
          getDefinition={getDefinition}
          onSync={(updated) => {
            setState(updated);
            // P3-64 Phase B-5: room モードでは専用 endpoint `/pregame-update` 経由で
            // preGame 部分更新を送信。マリガンは yes/no だけを送り、shuffle/draw は
            // server-side の authoritative state 上で実行する。
            if (roomId) {
              if (!updated.preGame) return;
              const nextPreGame = updated.preGame;
              const pregamePayload = {
                preGame: nextPreGame,
              };
              queueRoomSpecialMutation(
                roomSpecialDispatchSignature("pregame-update", pregamePayload),
                () => dispatchPregameUpdate(pregamePayload)
              );
            }
          }}
          onComplete={handlePreGameComplete}
          onFirstPlayerDecided={setPregameFirstPlayerOverride}
        />
      )}

      {roomId && !readOnly && !state.gameResult && (
        <RoomResetNotice
          requestedBy={state.roomReset?.requestedBy ?? null}
          viewingPlayerId={viewingPlayer}
          busy={resetBusy}
          error={resetError}
          onRespond={(approve) => void handleRoomReset(approve)}
        />
      )}

      {showKeyboardHelp && (
        <div
          className="keyboard-help-overlay"
          onClick={() => setShowKeyboardHelp(false)}
        >
          <div
            className="keyboard-help-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="keyboard-help-title">キーボードショートカット</h2>
            <table className="keyboard-help-table">
              <tbody>
                <tr>
                  <td className="kb-key">Space / Enter</td>
                  <td>パス / 決定</td>
                </tr>
                <tr>
                  <td className="kb-key">Escape</td>
                  <td>モーダルを閉じる</td>
                </tr>
                <tr>
                  <td className="kb-key">D</td>
                  <td>カード詳細を表示</td>
                </tr>
                <tr>
                  <td className="kb-key">?</td>
                  <td>このヘルプを表示</td>
                </tr>
              </tbody>
            </table>
            <button
              className="keyboard-help-close"
              onClick={() => setShowKeyboardHelp(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </EffectSourceScope>
  );
}

// ─── Battle Pre-Game Overlay (Janken + Mulligan) ───
// 1人対戦: ローカルCPU処理。ルーム対戦: preGame フィールドの push/poll で双方向同期。

const JK_EMOJI: Record<JankenHand, string> = {
  rock: "✊",
  scissors: "✌️",
  paper: "🖐️",
};
const JK_LABEL: Record<JankenHand, string> = {
  rock: "グー",
  scissors: "チョキ",
  paper: "パー",
};

function jkResult(p: JankenHand, o: JankenHand): "win" | "lose" | "draw" {
  if (p === o) return "draw";
  if (
    (p === "rock" && o === "scissors") ||
    (p === "scissors" && o === "paper") ||
    (p === "paper" && o === "rock")
  )
    return "win";
  return "lose";
}

type ContractDetailTarget = {
  playerId: string;
  cardNo: string;
  instanceId?: string | undefined;
};

const PREGAME_MORE_MENU_FORWARD_SELECTOR = [
  ".btn-more-menu",
  ".more-menu-panel button",
  ".more-menu-panel input",
].join(",");

function findPregameMoreMenuForwardTarget(
  clientX: number,
  clientY: number
): HTMLElement | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.closest(".bjk-overlay")) continue;
    const target = element.closest<HTMLElement>(
      PREGAME_MORE_MENU_FORWARD_SELECTOR
    );
    if (target) return target;
  }
  return null;
}

type ActionModeChoiceButton = {
  key: string;
  className: string;
  testId: string;
  label: string;
  description?: ReactNode;
  onClick: () => void;
};

function ActionModeChoiceModal({
  overlayClassName,
  modalClassName = "magic-cost-mode-modal",
  imageClassName = "magic-cost-mode-image",
  testId,
  cardDefinition,
  prompt,
  buttons,
  onClose,
  closeOnOverlayClick = true,
}: {
  overlayClassName: string;
  modalClassName?: string;
  imageClassName?: string;
  testId: string;
  cardDefinition?: CardDefinition | undefined;
  prompt: ReactNode;
  buttons: readonly ActionModeChoiceButton[];
  onClose: () => void;
  closeOnOverlayClick?: boolean;
}) {
  const uniqueButtons = distinguishActionButtonChoices(
    buttons.map(({ key, label, onClick }) => ({ key, label, onClick }))
  );
  return (
    <div
      className={`card-action-overlay ${overlayClassName}`}
      data-testid={testId}
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        className={`card-action-modal ${modalClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {cardDefinition?.image ? (
          <img
            className={`card-action-image ${imageClassName}`}
            src={`/${cardDefinition.image}`}
            alt={cardDefinition.name}
          />
        ) : cardDefinition ? (
          <div className="card-action-placeholder">
            <span>{cardDefinition.name}</span>
            <span>{cardDefinition.printedCategory}</span>
          </div>
        ) : null}
        <div className="magic-cost-mode-prompt">{prompt}</div>
        <div className="card-action-buttons magic-cost-mode-buttons">
          {buttons.map((button, index) => (
            <button
              key={button.key}
              type="button"
              className={`card-action-btn ${button.className}`}
              data-testid={button.testId}
              onClick={button.onClick}
            >
              <span>{uniqueButtons[index]!.label}</span>
              {button.description ? (
                <span className="magic-cost-mode-source">
                  {button.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function asIfSoulCoreKeywordLabel(
  actionKind: AsIfSoulCoreChoice["actionKind"],
  definition: CardDefinition | undefined
): string {
  if (actionKind === "contract_combine") return "契約合体";
  if (actionKind === "declare_host_dual_advent") return "契約煌臨";
  const adventMode = definition?.adventData?.adventVariant;
  if (adventMode === "f_contract") return "F契約煌臨";
  if (adventMode === "contract") return "契約煌臨";
  return "煌臨";
}

function asIfSoulCoreDoneMessage(action: AsIfSoulCoreAction): string {
  return `${localizeEffectLabel(action.choiceLabel)}を選択`;
}

function forwardPregameMoreMenuMouseDown(
  event: React.MouseEvent<HTMLDivElement>
) {
  const forwardTarget = findPregameMoreMenuForwardTarget(
    event.clientX,
    event.clientY
  );
  if (!forwardTarget) return;

  const target = event.target;
  const insidePreGameCard =
    target instanceof HTMLElement && target.closest(".bjk-card");
  if (insidePreGameCard && !forwardTarget.closest(".more-menu-panel")) return;

  event.preventDefault();
  event.stopPropagation();
  forwardTarget.click();
}

function ContractCardButton({
  ownerLabel,
  cardNo,
  definition,
  compact = false,
  onOpen,
}: {
  ownerLabel: string;
  cardNo: string;
  definition: CardDefinition | undefined;
  compact?: boolean;
  onOpen: () => void;
}) {
  const longPress = useLongPress(onOpen);
  const handleOpen = useCallback(() => {
    if (longPress.consumeFired()) return;
    onOpen();
  }, [longPress, onOpen]);

  return (
    <button
      type="button"
      className={`bjk-contract-card bjk-contract-card-button${compact ? " bjk-contract-card-compact" : ""}`}
      {...longPress.handlers}
      onClick={handleOpen}
      title={`${definition?.name ?? cardNo} の詳細`}
      aria-label={`${definition?.name ?? cardNo} の詳細`}
    >
      <span className="bjk-contract-owner">{ownerLabel}</span>
      <span className="bjk-contract-thumb">
        {definition?.image ? (
          <img src={`/${definition.image}`} alt={definition.name} />
        ) : (
          <span className="bjk-contract-placeholder">
            {definition?.name ?? cardNo}
          </span>
        )}
      </span>
      <span className="bjk-contract-name">{definition?.name ?? cardNo}</span>
    </button>
  );
}

function BattlePreGameOverlay({
  gameState,
  viewingPlayerId,
  isRoom,
  getDefinition,
  onSync,
  onComplete,
  onFirstPlayerDecided,
}: {
  gameState: GameState;
  viewingPlayerId: string;
  isRoom: boolean;
  getDefinition: (definitionId: string) => CardDefinition | undefined;
  onSync: (updated: GameState) => void;
  onComplete: (finalState: GameState) => void;
  /** 先攻が確定した瞬間に親へ通知し HUD を即時更新する。state 全体は伝播させない */
  onFirstPlayerDecided?: (firstPlayerId: string) => void;
}) {
  const myId = viewingPlayerId;
  const oppId = myId === "alice" ? "bob" : "alice";

  const [uiPhase, setUiPhase] = useState<UIPhase>(() =>
    initialPreGameUiPhase(gameState.preGame, myId)
  );
  const [currentState, setCurrentState] = useState(gameState);
  const currentStateRef = useRef(gameState);
  const mulliganSubmittedRef = useRef(false);

  const pg = currentState.preGame;
  const firstPlayerId = pg?.firstPlayerId ?? null;
  const iAmFirst = firstPlayerId === myId;
  // State + sync helper
  // local モードでも親 state へ反映し、手札ドロワー/HUD など overlay 外の表示を
  // 最新 preGame state に追従させる。preGame 中のゲーム内 legal action は
  // rules-core 側で空になるため、ゲーム開始自体は従来通り onComplete に集約する。
  const updateAndSync = useCallback(
    (updater: (s: GameState) => GameState) => {
      const next = updater(currentStateRef.current);
      currentStateRef.current = next;
      setCurrentState(next);
      onSync(next);
    },
    [onSync]
  );

  const announce = useCallback(
    (message: string, nextPhase: UIPhase, delay = 2000) => {
      setUiPhase({ kind: "announce", message });
      setTimeout(() => setUiPhase(nextPhase), delay);
    },
    []
  );

  const handleContractPresentation = useCallback(
    (present: boolean) => {
      updateAndSync((s) => {
        const pg = s.preGame!;
        const choices = {
          ...(pg.contractPresentationChoices ?? {}),
          [myId]: present,
        };
        if (
          !isRoom &&
          pg.contractCandidateCardNos?.[oppId] !== undefined &&
          choices[oppId] === undefined
        ) {
          choices[oppId] = true;
        }

        const candidateIds = Object.keys(pg.contractCandidateCardNos ?? {});
        const allChoicesDone = candidateIds.every(
          (id) => choices[id] !== undefined
        );
        const withChoices = {
          ...s,
          preGame: { ...pg, contractPresentationChoices: choices },
        };
        if (!isRoom && allChoicesDone) {
          const dealt = applyGameStartEffects(
            applyContractPresentationChoices(withChoices, choices),
            getDefinition
          );
          return {
            ...dealt,
            preGame: {
              ...dealt.preGame!,
              contractPresentationChoices: choices,
              contractConfirmed: pg.contractConfirmed ?? {},
              phase: "contract_confirm" as PreGamePhase,
            },
          };
        }
        return withChoices;
      });
      setUiPhase(
        isRoom ? { kind: "waiting_contract" } : { kind: "contract_confirm" }
      );
    },
    [isRoom, myId, oppId, updateAndSync, getDefinition]
  );

  const confirmContractPresentation = useCallback(() => {
    updateAndSync((s) => {
      const pg = s.preGame!;
      if (isRoom) {
        return {
          ...s,
          preGame: {
            ...pg,
            contractConfirmed: {
              ...(pg.contractConfirmed ?? {}),
              [myId]: true,
            },
          },
        };
      }
      return {
        ...s,
        preGame: {
          ...pg,
          contractConfirmed: {
            ...(pg.contractConfirmed ?? {}),
            [myId]: true,
            [oppId]: true,
          },
          phase: "waiting_janken" as PreGamePhase,
        },
      };
    });
    setUiPhase(
      isRoom ? { kind: "waiting_contract_confirm" } : { kind: "janken" }
    );
  }, [isRoom, myId, oppId, updateAndSync]);

  useEffect(() => {
    if (isRoom || uiPhase.kind !== "waiting_contract") return;
    const timer = setTimeout(() => {
      let advanced = false;
      updateAndSync((s) => {
        const pg = s.preGame;
        if (!pg || pg.phase !== "waiting_contract") return s;
        const choices = { ...(pg.contractPresentationChoices ?? {}) };
        for (const id of Object.keys(pg.contractCandidateCardNos ?? {})) {
          if (choices[id] === undefined && id !== myId) choices[id] = true;
        }
        const allChoicesDone = Object.keys(
          pg.contractCandidateCardNos ?? {}
        ).every((id) => choices[id] !== undefined);
        if (!allChoicesDone)
          return {
            ...s,
            preGame: { ...pg, contractPresentationChoices: choices },
          };
        const withChoices = {
          ...s,
          preGame: { ...pg, contractPresentationChoices: choices },
        };
        const dealt = applyGameStartEffects(
          applyContractPresentationChoices(withChoices, choices),
          getDefinition
        );
        advanced = true;
        return {
          ...dealt,
          preGame: {
            ...dealt.preGame!,
            contractPresentationChoices: choices,
            contractConfirmed: pg.contractConfirmed ?? {},
            phase: "contract_confirm" as PreGamePhase,
          },
        };
      });
      if (advanced) setUiPhase({ kind: "contract_confirm" });
    }, 1000);
    return () => clearTimeout(timer);
  }, [uiPhase.kind, isRoom, myId, updateAndSync, getDefinition]);

  // ─── React to polling updates (room mode) ───
  // 依存配列は ref-style: phase / hands / mulliganDone の変化のみ trigger し、
  // 内部で参照する announce / updateAndSync / uiPhase などは常に最新を使う
  const polledPgPhase = isRoom ? gameState.preGame?.phase : null;
  const polledPgJankenHandsKey = isRoom
    ? JSON.stringify(gameState.preGame?.jankenHands)
    : null;
  const polledPgMulliganDoneKey = isRoom
    ? JSON.stringify(gameState.preGame?.mulliganDone)
    : null;
  const polledPgContractChoicesKey = isRoom
    ? JSON.stringify(gameState.preGame?.contractPresentationChoices)
    : null;
  const polledPgContractConfirmedKey = isRoom
    ? JSON.stringify(gameState.preGame?.contractConfirmed)
    : null;
  useEffect(() => {
    if (!isRoom) return;
    const polledPg = gameState.preGame;
    if (!polledPg) return;
    currentStateRef.current = gameState;
    setCurrentState(gameState);

    // 楽観表示後に送信が失敗した場合、reconcile された権威 state には自分の
    // 選択が無い。待機 UI と二重送信ガードを戻して再操作を許可する。
    if (
      mulliganSubmittedRef.current &&
      polledPg.mulliganDone[myId] === undefined &&
      (polledPg.phase === "order_decided" ||
        polledPg.phase === "waiting_mulligan_second")
    ) {
      mulliganSubmittedRef.current = false;
      setUiPhase({ kind: "mulligan_self" });
      return;
    }

    // server-authoritative: phase / jankenWinner / firstPlayerId はすべてサーバ導出。
    // クライアントは導出済みの phase に追従して uiPhase を更新するだけ
    // (じゃんけん勝敗・あいこ判定・先後確定・finalize の駆動はサーバが行う)。
    const phase = polledPg.phase;
    if (phase === "waiting_contract") {
      const myCandidate = polledPg.contractCandidateCardNos?.[myId];
      const myChoice = polledPg.contractPresentationChoices?.[myId];
      setUiPhase(
        myCandidate && myChoice === undefined
          ? { kind: "contract_present" }
          : { kind: "waiting_contract" }
      );
      return;
    }

    if (phase === "contract_confirm") {
      setUiPhase(
        polledPg.contractConfirmed?.[myId]
          ? { kind: "waiting_contract_confirm" }
          : { kind: "contract_confirm" }
      );
      return;
    }

    if (phase === "waiting_janken") {
      const myRoomHand = polledPg.jankenHands[myId] as JankenHand | undefined;
      setUiPhase(
        myRoomHand ? { kind: "waiting_opponent_janken" } : { kind: "janken" }
      );
      return;
    }

    const myHand = polledPg.jankenHands[myId] as JankenHand | undefined;
    const oppHand = polledPg.jankenHands[oppId] as JankenHand | undefined;
    const polledFirstPlayer = polledPg.firstPlayerId;
    const polledIAmFirst = polledFirstPlayer === myId;

    // あいこ: サーバが janken_resolved + 両手保持にしている → 結果表示して再提出へ。
    if (phase === "janken_resolved" && myHand && oppHand) {
      setUiPhase({ kind: "janken_result", myHand, oppHand });
      setTimeout(() => setUiPhase({ kind: "janken" }), 1500);
      return;
    }

    // 勝敗確定 → 先後選択。
    if (phase === "waiting_order_pick" && polledPg.jankenWinner) {
      const nextPick: UIPhase =
        polledPg.jankenWinner === myId
          ? { kind: "pick_order" }
          : { kind: "waiting_opponent_pick" };
      if (
        uiPhase.kind !== "pick_order" &&
        uiPhase.kind !== "waiting_opponent_pick"
      ) {
        if (myHand && oppHand) {
          // 結果アニメーションを見せてから選択 / 待機へ。
          setUiPhase({ kind: "janken_result", myHand, oppHand });
          setTimeout(() => setUiPhase(nextPick), 1500);
        } else {
          setUiPhase(nextPick);
        }
      }
      return;
    }

    // 先後確定 → マリガン。
    if (phase === "order_decided" && polledFirstPlayer) {
      onFirstPlayerDecided?.(polledFirstPlayer);
      if (
        uiPhase.kind !== "mulligan_self" &&
        uiPhase.kind !== "mulligan_opponent" &&
        uiPhase.kind !== "done"
      ) {
        const msg = polledIAmFirst ? "あなたは先攻です" : "あなたは後攻です";
        announce(
          msg,
          polledIAmFirst
            ? { kind: "mulligan_self" }
            : { kind: "mulligan_opponent" }
        );
      }
      return;
    }

    // 先攻のマリガン完了 → 後攻の番。
    if (phase === "waiting_mulligan_second" && polledFirstPlayer) {
      onFirstPlayerDecided?.(polledFirstPlayer);
      if (polledIAmFirst && uiPhase.kind === "mulligan_self") {
        setUiPhase({ kind: "mulligan_opponent" });
      }
      if (!polledIAmFirst && uiPhase.kind === "mulligan_opponent") {
        const firstMulliganed = polledPg.mulliganDone[polledFirstPlayer];
        const msg = firstMulliganed
          ? "相手がマリガンしました"
          : "相手はマリガンしませんでした";
        announce(msg, { kind: "mulligan_self" });
      }
      return;
    }

    // 全完了。
    if (phase === "pregame_complete") {
      if (uiPhase.kind !== "done") {
        const secondMulliganed =
          polledPg.mulliganDone[polledFirstPlayer === myId ? oppId : myId];
        if (polledIAmFirst && uiPhase.kind === "mulligan_opponent") {
          const msg = secondMulliganed
            ? "相手がマリガンしました"
            : "相手はマリガンしませんでした";
          announce(msg, { kind: "done" });
        } else {
          announce("ゲーム開始！", { kind: "done" }, 1500);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling: 上記 3 キーの変化のみ trigger。他の参照は常に最新値を取得する設計
  }, [
    polledPgPhase,
    polledPgJankenHandsKey,
    polledPgMulliganDoneKey,
    polledPgContractChoicesKey,
    polledPgContractConfirmedKey,
  ]);

  // ─── Janken (local CPU mode) ───
  const playLocal = useCallback(
    (hand: JankenHand) => {
      const hands: JankenHand[] = ["rock", "scissors", "paper"];
      const opp = hands[Math.floor(Math.random() * 3)]!;
      const result = jkResult(hand, opp);
      if (result === "draw") {
        setUiPhase({ kind: "janken_result", myHand: hand, oppHand: opp });
        setTimeout(() => setUiPhase({ kind: "janken" }), 1500);
      } else if (result === "win") {
        setUiPhase({ kind: "janken_result", myHand: hand, oppHand: opp });
        setTimeout(() => setUiPhase({ kind: "pick_order" }), 1500);
      } else {
        setUiPhase({ kind: "janken_result", myHand: hand, oppHand: opp });
        setTimeout(() => {
          const cpuGoesFirst = Math.random() < 0.5;
          const fId = cpuGoesFirst ? oppId : myId;
          // playerOrder と preGame.firstPlayerId を同時更新し、HUD（先攻/後攻）が
          // janken 確定と同時に正しく反映されるようにする。
          // 親 state には伝播させず HUD 専用 callback で通知 (マリガン中の自動進行を防ぐ)。
          updateAndSync((s) => {
            const updated = setFirstPlayer(s, fId);
            return {
              ...updated,
              preGame: {
                ...updated.preGame!,
                phase: "order_decided" as const,
                firstPlayerId: fId,
              },
            };
          });
          onFirstPlayerDecided?.(fId);
          const msg = cpuGoesFirst
            ? "相手が先攻を選びました\nあなたは後攻です"
            : "相手が後攻を選びました\nあなたは先攻です";
          announce(
            msg,
            fId === myId
              ? { kind: "mulligan_self" }
              : { kind: "mulligan_opponent" }
          );
        }, 1500);
      }
    },
    [oppId, myId, updateAndSync, announce, onFirstPlayerDecided]
  );

  // ─── Janken (room mode) ───
  const playRoom = useCallback(
    (hand: JankenHand) => {
      updateAndSync((s) => ({
        ...s,
        preGame: {
          ...s.preGame!,
          jankenHands: { ...s.preGame!.jankenHands, [myId]: hand },
        },
      }));
      setUiPhase({ kind: "waiting_opponent_janken" });
    },
    [myId, updateAndSync]
  );

  // ─── Pick order ───
  const pickOrder = useCallback(
    (goFirst: boolean) => {
      const fId = goFirst ? myId : oppId;
      if (isRoom) {
        // 先後選択は「自分の入力 (firstPlayerId)」だけ送り、phase / order の確定は
        // サーバに委ねる。サーバ確定 (poll で order_decided) を待ってからマリガンへ
        // 進む。ローカルで先行して mulligan へ進むと、firstPlayerId 未着のまま
        // マリガンが走る競合になる (orica-snapshot 2026-06-19)。
        updateAndSync((s) => ({
          ...s,
          preGame: { ...s.preGame!, firstPlayerId: fId },
        }));
        onFirstPlayerDecided?.(fId);
        setUiPhase({
          kind: "announce",
          message: "先攻・後攻を確定しています...",
        });
        return;
      }
      updateAndSync((s) => {
        const updated = setFirstPlayer(s, fId);
        return {
          ...updated,
          preGame: {
            ...updated.preGame!,
            phase: "order_decided" as const,
            firstPlayerId: fId,
          },
        };
      });
      onFirstPlayerDecided?.(fId);
      const msg = goFirst ? "あなたは先攻です" : "あなたは後攻です";
      announce(
        msg,
        fId === myId ? { kind: "mulligan_self" } : { kind: "mulligan_opponent" }
      );
    },
    [myId, oppId, isRoom, updateAndSync, announce, onFirstPlayerDecided]
  );

  // ─── Mulligan (self) ───
  // 二重押下ガード: room モードでは handleMulligan 後に uiPhase を即変更せず poll を
  // 待つため、ボタンが画面に残り続ける。サーバ側も二重実行を拒否するが、不要な再送と
  // 競合表示を避けるため ref で同期的に 1 回に制限する。
  const handleMulligan = useCallback(
    (doMulligan: boolean) => {
      if (mulliganSubmittedRef.current) return;
      // 先後未確定のままマリガンを確定すると、iAmFirstLocal=false フォールバックで
      // phase=pregame_complete が firstPlayerId=null のままサーバへ着弾し、先後未確定・
      // 片側のマリガン選択スキップでゲームが開始してしまう (order-decision の
      // pregame-update が未着のまま mulligan が先行するレース。orica-snapshot 2026-06-19)。
      // 同期済み state で先後が確定するまで送信をブロックする (サーバ側にも完了不変条件
      // ガードあり。二重防御)。
      if (!firstPlayerId) return;
      mulliganSubmittedRef.current = true;
      updateAndSync((s) => {
        const updated =
          !isRoom && doMulligan ? mulliganHand(s, myId, getDefinition) : s;
        const pg = updated.preGame!;
        const newMulliganDone = { ...pg.mulliganDone, [myId]: doMulligan };
        if (isRoom) {
          // room: 自分のマリガン選択だけ送り、phase / finalize はサーバが導出する。
          return {
            ...updated,
            preGame: { ...pg, mulliganDone: newMulliganDone },
          };
        }
        const iAmFirstLocal = pg.firstPlayerId === myId;
        const nextPhase = iAmFirstLocal
          ? "waiting_mulligan_second"
          : "pregame_complete";
        return {
          ...updated,
          preGame: {
            ...pg,
            mulliganDone: newMulliganDone,
            phase: nextPhase as PreGamePhase,
          },
        };
      });

      if (isRoom) {
        // Room: poll を待つ間ボタンを画面から消す (再押下=2回目マリガン防止)。
        // 先攻は相手のマリガン待ち、後攻は完了待ち。最終 uiPhase は poll が確定する。
        setUiPhase(
          iAmFirst
            ? { kind: "mulligan_opponent" }
            : { kind: "announce", message: "相手の操作を待っています..." }
        );
      } else {
        // Local CPU
        if (iAmFirst) {
          setUiPhase({ kind: "mulligan_opponent" });
        } else {
          announce("ゲーム開始！", { kind: "done" }, 1500);
        }
      }
    },
    [
      myId,
      isRoom,
      iAmFirst,
      firstPlayerId,
      updateAndSync,
      announce,
      getDefinition,
    ]
  );

  // ─── Mulligan (opponent / CPU, local mode only) ───
  useEffect(() => {
    if (isRoom || uiPhase.kind !== "mulligan_opponent") return;
    const timer = setTimeout(() => {
      const cpuMulligans = Math.random() < 0.3;
      updateAndSync((s) => {
        const updated = cpuMulligans
          ? mulliganHand(s, oppId, getDefinition)
          : s;
        const pg = updated.preGame!;
        const iAmFirstLocal = pg.firstPlayerId === myId;
        const nextPhase = iAmFirstLocal
          ? "pregame_complete"
          : "waiting_mulligan_second"; // shouldn't happen for CPU
        return {
          ...updated,
          preGame: {
            ...pg,
            mulliganDone: { ...pg.mulliganDone, [oppId]: cpuMulligans },
            phase: nextPhase as PreGamePhase,
          },
        };
      });
      const msg = cpuMulligans
        ? "相手がマリガンしました"
        : "相手はマリガンしませんでした";
      if (iAmFirst) {
        announce(msg, { kind: "done" }, 1500);
      } else {
        setUiPhase({ kind: "announce", message: msg });
        setTimeout(() => setUiPhase({ kind: "mulligan_self" }), 1500);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [uiPhase.kind, isRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Done ───
  useEffect(() => {
    if (uiPhase.kind === "done") {
      onComplete({ ...currentState, preGame: null });
    }
  }, [uiPhase.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BattlePreGamePresentation
      gameState={currentState}
      viewingPlayerId={myId}
      uiPhase={uiPhase}
      getDefinition={getDefinition}
      handleContractPresentation={handleContractPresentation}
      confirmContractPresentation={confirmContractPresentation}
      playHand={isRoom ? playRoom : playLocal}
      pickOrder={pickOrder}
      handleMulligan={handleMulligan}
    />
  );
}

function BattlePreGamePresentation({
  gameState: currentState,
  viewingPlayerId: myId,
  uiPhase,
  getDefinition,
  handleContractPresentation,
  confirmContractPresentation,
  playHand,
  pickOrder,
  handleMulligan,
}: {
  gameState: GameState;
  viewingPlayerId: string;
  uiPhase: UIPhase;
  getDefinition: (id: string) => CardDefinition | undefined;
  handleContractPresentation?: (present: boolean) => void;
  confirmContractPresentation?: () => void;
  playHand?: (hand: JankenHand) => void;
  pickOrder?: (first: boolean) => void;
  handleMulligan?: (mulligan: boolean) => void;
}) {
  const [contractDetailTarget, setContractDetailTarget] =
    useState<ContractDetailTarget | null>(null);
  const pg = currentState.preGame;
  const myContractCandidateCardNo = pg?.contractCandidateCardNos?.[myId];
  const myContractCandidateInstanceId =
    pg?.contractCandidateInstanceIds?.[myId];
  const myContractCandidateDef = myContractCandidateCardNo
    ? getDefinition(myContractCandidateCardNo)
    : undefined;

  const contractSummaryRows = currentState.players.map((player) => {
    const presented = pg?.contractPresentationChoices?.[player.id] === true;
    const cardNo = presented ? pg?.contractCandidateCardNos?.[player.id] : null;
    const def = cardNo ? getDefinition(cardNo) : undefined;
    return {
      playerId: player.id,
      label: player.id === myId ? "あなた" : "相手",
      presented,
      cardNo,
      definition: def,
      instanceId: pg?.contractCandidateInstanceIds?.[player.id],
    };
  });
  const contractDetailDef = contractDetailTarget
    ? getDefinition(contractDetailTarget.cardNo)
    : undefined;
  const contractDetailInstance = contractDetailTarget
    ? ((contractDetailTarget.instanceId
        ? currentState.cardInstances.find(
            (card) => card.instanceId === contractDetailTarget.instanceId
          )
        : undefined) ??
      currentState.cardInstances.find(
        (card) =>
          card.ownerPlayerId === contractDetailTarget.playerId &&
          card.definitionId === contractDetailTarget.cardNo
      ))
    : undefined;
  const isContractPhase =
    uiPhase.kind === "contract_present" ||
    uiPhase.kind === "waiting_contract" ||
    uiPhase.kind === "contract_confirm" ||
    uiPhase.kind === "waiting_contract_confirm";

  if (uiPhase.kind === "done") return null;

  return (
    <>
      <div
        className={`bjk-overlay${isContractPhase ? " bjk-overlay-contract" : ""}`}
        onMouseDown={forwardPregameMoreMenuMouseDown}
        inert={!playHand}
      >
        <div
          className={`bjk-card${isContractPhase ? " bjk-card-contract" : ""}`}
        >
          {uiPhase.kind === "contract_present" && myContractCandidateCardNo && (
            <>
              <h1 className="bjk-title">契約提示</h1>
              <ContractCardButton
                ownerLabel="あなたの契約カード"
                cardNo={myContractCandidateCardNo}
                definition={myContractCandidateDef}
                onOpen={() =>
                  setContractDetailTarget({
                    playerId: myId,
                    cardNo: myContractCandidateCardNo,
                    instanceId: myContractCandidateInstanceId,
                  })
                }
              />
              <div className="bjk-pick">
                <button
                  className="bjk-pick-btn"
                  data-testid="pregame-contract-true"
                  onClick={() => handleContractPresentation?.(true)}
                >
                  初手に加える
                </button>
                <button
                  className="bjk-pick-btn bjk-pick-btn-no"
                  data-testid="pregame-contract-false"
                  onClick={() => handleContractPresentation?.(false)}
                >
                  加えない
                </button>
              </div>
            </>
          )}

          {uiPhase.kind === "waiting_contract" && (
            <>
              <h1 className="bjk-title">契約提示</h1>
              <p className="bjk-sub">相手の契約提示を待っています...</p>
            </>
          )}

          {uiPhase.kind === "contract_confirm" && (
            <>
              <h1 className="bjk-title">契約確認</h1>
              <div className="bjk-contract-list">
                {contractSummaryRows.map((row) =>
                  row.presented && row.cardNo ? (
                    <ContractCardButton
                      key={row.playerId}
                      ownerLabel={row.label}
                      cardNo={row.cardNo}
                      definition={row.definition}
                      compact
                      onOpen={() =>
                        setContractDetailTarget({
                          playerId: row.playerId,
                          cardNo: row.cardNo!,
                          instanceId: row.instanceId,
                        })
                      }
                    />
                  ) : (
                    <div
                      key={row.playerId}
                      className="bjk-contract-card bjk-contract-card-empty"
                    >
                      <div className="bjk-contract-owner">{row.label}</div>
                      <div className="bjk-contract-name">なし</div>
                    </div>
                  )
                )}
              </div>
              <div className="bjk-pick">
                <button
                  className="bjk-pick-btn"
                  data-testid="pregame-contract-confirm"
                  onClick={confirmContractPresentation}
                >
                  確認
                </button>
              </div>
            </>
          )}

          {uiPhase.kind === "waiting_contract_confirm" && (
            <>
              <h1 className="bjk-title">契約確認</h1>
              <p className="bjk-sub">相手の確認を待っています...</p>
            </>
          )}

          {uiPhase.kind === "janken" && (
            <>
              <h1 className="bjk-title">じゃんけん</h1>
              <p className="bjk-sub">手札を確認して先攻/後攻を決めましょう</p>
              <div className="bjk-hands">
                {(["rock", "scissors", "paper"] as JankenHand[]).map((h) => (
                  <button
                    key={h}
                    className="bjk-btn"
                    data-testid={`pregame-janken-${h}`}
                    onClick={() => playHand?.(h)}
                  >
                    <span style={{ fontSize: "2em" }}>{JK_EMOJI[h]}</span>
                    <span>{JK_LABEL[h]}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {uiPhase.kind === "waiting_opponent_janken" && (
            <>
              <h1 className="bjk-title">じゃんけん</h1>
              <p className="bjk-sub">相手の手を待っています...</p>
            </>
          )}

          {uiPhase.kind === "janken_result" && (
            <>
              <h1 className="bjk-title">じゃんけん</h1>
              <div className="bjk-result">
                <div className="bjk-matchup">
                  <div>
                    <span style={{ fontSize: "2.5em" }}>
                      {JK_EMOJI[uiPhase.myHand]}
                    </span>
                    <br />
                    あなた
                  </div>
                  <span style={{ fontSize: "1.5em", fontWeight: "bold" }}>
                    対
                  </span>
                  <div>
                    <span style={{ fontSize: "2.5em" }}>
                      {JK_EMOJI[uiPhase.oppHand]}
                    </span>
                    <br />
                    相手
                  </div>
                </div>
                <p className="bjk-result-text">
                  {jkResult(uiPhase.myHand, uiPhase.oppHand) === "draw"
                    ? "あいこ！ もう一度"
                    : jkResult(uiPhase.myHand, uiPhase.oppHand) === "win"
                      ? "勝ち！"
                      : "負け！"}
                </p>
              </div>
            </>
          )}

          {uiPhase.kind === "pick_order" && (
            <>
              <h1 className="bjk-title">先攻/後攻を選択</h1>
              <p className="bjk-sub">じゃんけんに勝ちました！</p>
              <div className="bjk-pick">
                <button
                  className="bjk-pick-btn"
                  data-testid="pregame-order-first"
                  onClick={() => pickOrder?.(true)}
                >
                  先攻
                </button>
                <button
                  className="bjk-pick-btn"
                  data-testid="pregame-order-second"
                  onClick={() => pickOrder?.(false)}
                >
                  後攻
                </button>
              </div>
            </>
          )}

          {uiPhase.kind === "waiting_opponent_pick" && (
            <>
              <h1 className="bjk-title">先攻/後攻</h1>
              <p className="bjk-sub">相手が先攻/後攻を選んでいます...</p>
            </>
          )}

          {uiPhase.kind === "announce" && (
            <div className="bjk-announce">
              {uiPhase.message.split("\n").map((line, i) => (
                <p key={i} className="bjk-announce-text">
                  {line}
                </p>
              ))}
            </div>
          )}

          {uiPhase.kind === "mulligan_self" && (
            <>
              <h1 className="bjk-title">マリガン</h1>
              <p className="bjk-sub">手札を引き直しますか？（1回のみ）</p>
              <div className="bjk-pick">
                <button
                  className="bjk-pick-btn"
                  data-testid="pregame-mulligan-true"
                  onClick={() => handleMulligan?.(true)}
                >
                  引き直す
                </button>
                <button
                  className="bjk-pick-btn bjk-pick-btn-no"
                  data-testid="pregame-mulligan-false"
                  onClick={() => handleMulligan?.(false)}
                >
                  このまま
                </button>
              </div>
            </>
          )}

          {uiPhase.kind === "mulligan_opponent" && (
            <>
              <h1 className="bjk-title">マリガン</h1>
              <p className="bjk-sub">相手がマリガンを検討中...</p>
            </>
          )}
        </div>
      </div>
      {contractDetailDef && (
        <CardDetailModal
          card={contractDetailDef}
          {...(contractDetailInstance
            ? {
                cardInstance: contractDetailInstance,
                gameState: currentState,
                getCardDefinitionById: getDefinition,
              }
            : {})}
          hideDeckActions
          zIndex={1200}
          onClose={() => setContractDetailTarget(null)}
        />
      )}
    </>
  );
}
