import { collectChargeCoreSources } from "./mechanics/core-charge-distribution";
import { replaceCardInstances } from "./zone/card-instance-state";
import { isAwaitingEffectEntryCores } from "./zone/enter-field-placement-pending";
import { getEnterFieldCorePlacementPolicy } from "./zone/enter-field-placement-policy";
import { hasPendingEffectResolution } from "./effect/pending-resolution-policy";
import { requireCardZone } from "./model";
import {
  applyCardCostPayments,
  assertPaymentSourcesAreAvailable,
  getAutomaticNormalCorePaymentSources,
  getAvailablePayCostCoreSources,
  type CardCostPaymentSource,
} from "./core/payment-system";
import {
  normalizeCardStateBattleStatus,
  resetCardBattleStatus,
} from "./card/card-state-reset";
import {
  advanceDepartedFieldInstanceGeneration,
  advanceSoulStateGeneration,
} from "./effect/effect-usage-lifecycle";
import { collectPendingStacks } from "./legal/stack-collection-helpers";
import {
  resolveActAsSpiritCardName,
  resolveActAsSpiritMinimumRequiredCores,
  hasCannotCombineRestriction,
} from "./mechanics/act-as-spirit";
import { attachAsAdventSource } from "./mechanics/advent-system";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
  isCurrentCombatMember,
  isRuleStrengthBattlePrevented,
  removeBattleEntityMembersAndRecompute,
  removeStateInvalidBattleEntityMembersAndRecompute,
} from "./battle/battle-shared";
import { getCardById, isPlayersContractCard } from "./card/card-lookup";
import { calculateLevelFromResources } from "./card/level-calculation";
import { matchesCardFilter } from "./card/card-filter";
import { getCEsForTarget, getGlobalCEs } from "./card/ce-lookup";
import { matchesEffectResistanceFilter } from "./effect/effect-resistance-check";
import { applyFaceDownPolicyOnZoneChange } from "./zone/face-down-policy";
import {
  getEffectiveColors,
  getEffectiveLevelCostDelta,
  getEffectiveLevelCostOverride,
  getSoulStateActivationEffectIndex,
  isIncomingBraveConditionIgnoredByHost,
  getBraveCapacitySeparationOptions,
  matchesBraveConditionForCard,
} from "./legal/legal-actions-shared";
import { resolveCardLeaveAffectDecisions } from "./effect/effect-affect-adapter";
import {
  getArtsTokenInPlayCount,
  getEligibleQuartzHosts,
  placeArtsToken,
  releaseQuartzOnHostLeave,
} from "./mechanics/quartz-system";
import { recomputeAndRebuildContinuousEffectsForSources } from "./effect/continuous-effect-rebuild";
import { isAwaitingRebirthPostChoice } from "./mechanics/rebirth-post-choice";
import { evaluateCondition } from "./effect/structured-effect-interpreter";
import {
  applyNonFieldRemoveFromGameStamp,
  advanceSetAsideExitReplacementChoice,
  executeReverseRebirth,
} from "./effect/structured-card-replacement";
import {
  expandWithSoulStateInheritingKeyBraves,
  getEffectiveSoulStateIds,
} from "./mechanics/magic-compatible-soul-state";
import {
  getTotalCoresOnCardById,
  moveCardZone,
  moveNormalCores,
  resolveCardLeavesFieldCores,
  updateCard,
  updatePlayer,
  withSoulCoreLocation,
} from "./core/core-system";
import {
  hasIndependentCoreManagement,
  type BattleEntity,
  type CardColor,
  type CardDefinition,
  type CardInstance,
  type EffectQueueEntry,
  type GameState,
  type LeaveFieldCoreDestinationOverride,
  type PendingLeaveCause,
  type PendingLeaveEntity,
  type PendingLeaveKind,
  type PendingPrivateDeclaration,
  type PendingTriggeredEffect,
  type Zone,
  adventSourceIdsOf,
  collectUnderCardScopeIds,
  normalizeUnderCardRoleTag,
  stripUnderCardReferences,
} from "./model";
import type { Effect } from "./dsl-types";
import { matchesDeclaredCardEventKind } from "./zone/leave-field-event-matching";
import { hasPreventBraveSeparationRestriction } from "./mechanics/brave-separation-restriction";
import {
  resolveSeparatedBraveExhaustState,
  synchronizeBraveExhaustion,
} from "./mechanics/brave-spirit-state-recovery";
import { isChainAtOrUnder } from "./chain-id";
export { hasPendingLeaveResolutionChoice } from "./pending-state-guards";
export { isChainAtOrUnder } from "./chain-id";

/**
 * 待機状態 (PendingLeaveKind) のデフォルト着地ゾーン。
 *
 * flushPendingLeaves で `fieldExitCheck.zoneReplacements` による置換が無いとき、
 * pendingLeave.kind に応じて選択される。
 *
 * - destroy / vanish / bounce: トラッシュ (既存挙動を維持)
 *   ※ production の bounce は `leaveDestination` で手札/手元を明示して
 *     queuePendingLeave に入る。未指定の bounce は scaffolding 互換として "trash" に固定する。
 * - remove_from_game: removed_from_game ゾーン
 *   (Step 2/4: flushPendingLeaves destination 分岐の正源。
 *    Step 4 で executeRemoveFromGame が queuePendingLeave 経由に切り替わったとき、
 *    ホスト = remove_from_game 対象に合体ブレイヴがあれば checkBraveLeaveChoice で
 *    残存/同行選択が出され、合体ブレイヴ orphan が解消される)
 */
function getDefaultLeaveDestinationZone(kind: PendingLeaveKind): Zone {
  switch (kind) {
    case "destroy":
    case "vanish":
    case "bounce":
    case "rule_cleanup":
      return "trash";
    case "remove_from_game":
      return "removed_from_game";
  }
}
import { processMovedToTrashEffects } from "./effect/structured-effect-interpreter";

export type StateBasedActionKind =
  | "vanish_due_to_core_deficit"
  | "pending_leave_cleanup"
  | "brave_forced_separation"
  | "brave_capacity_choice"
  | "brave_backface_auto_revert"
  | "place_arts_token_due_to_condition"
  | "vanish_due_to_arts_gate_lost"
  | "vanish_due_to_soul_state_only_field";
export type EffectFilterTag =
  | "general"
  | "vanish_related"
  | "leave_field_related"
  | "suppress_effects"
  | "suppress_used_card";

export interface StateBasedActionCheck {
  kind: StateBasedActionKind;
  instanceId: string;
  detail: string;
  /** `place_arts_token_due_to_condition` が配置したトークンの cardNo。 */
  tokenCardNo?: string;
}

export interface StateBasedActionResult {
  state: GameState;
  checks: StateBasedActionCheck[];
}

export interface QueuePendingLeaveOptions {
  state: GameState;
  instanceId: string;
  kind: PendingLeaveKind;
  cause: PendingLeaveCause;
  chainId: string;
  /** フィールド離脱を引き起こしたプレイヤーID。魂状態置換判定に使用。 */
  causePlayerId?: string | null;
  deferZoneMoveUntilChainEnd?: boolean;
  leaveFieldCoreDestinationOverride?: LeaveFieldCoreDestinationOverride | null;
  /** pending leave の最終移動先 intent。field-origin send_to_deck で deck top/bottom を保持する。 */
  leaveDestination?: PendingLeaveEntity["leaveDestination"];
  /** 離脱者自身の stay_on_field 型残置反応を待たずに flush する。 */
  preventStayOnField?: boolean;
  /** この pending leave 由来の誘発 pending に注入する解決済み/除外済み source key。 */
  resolvedSourceRegistrationKeys?: string[];
  /** 破壊されたカードの効果抑制スコープ（`destroyed_only` / `all_opponent`）。 */
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
  /** 「この効果でブレイヴはフィールドに残せない」。合体ホスト離脱時にブレイヴ残存の
   * 選択待ちを設けず、強制的に send_with_host で解決する（10_rules/05 選択肢2 強制）。 */
  forceBraveSendWithHost?: boolean;
  /** P3-74 Phase B: cannot_leave_field 耐性で物理離脱が阻止されたが、破壊判定自体は成立した状態。
   * card.pendingLeaveKind は set しない (フィールドに残るため)。
   * pendingLeaveEntities にだけエントリを積み、破壊判定の成立を内包 conditional_result から参照可能にする。
   * flushPendingLeaves で zone 移動せず除去のみ、trigger-system で event emit しない。
   */
  blockedByResistance?: boolean;
  outcomeEstablished?: boolean;
  /**
   * この離脱を引き起こした効果の発揮元カード instanceId
   * (ENGINE-generic-effect-activation-causal-trigger Step2/3: causal-tracking 層)。
   * host が自身の効果解決で引き起こした離脱を、明示 stepId 参照 (`{kind:"ref"}`) 無しで
   * 追跡できるようにする。現状 destroy/vanish/remove_from_game/効果の bp_compare_destroy/
   * hand-written resolver 経由の呼び出しが渡す。実バトル破壊・ブレイヴ合体は設計上対象外
   * (効果解決由来ではない)。`pay_cost` 由来のコスト支払い消滅のうち、`applyCardCostPayments`/
   * `markCostPaymentVanishes` (payment-system.ts) を経由する経路 — native-action-registry.ts
   * `pay_cost` ハンドラの (a) GUI/呼び出し側がソース指定した分岐のみ — は Step3 で対応済み。
   * 同じ `pay_cost` ハンドラ内でも (a2) `allowPendingPayCostSourceAllocation` 自動配分分岐と
   * `coreSourceAllocations` resume 分岐は `moveNormalCores` を直接呼び
   * `applyCardCostPayments` を経由しないため、未対応のまま (コア不足消滅自体は汎用 SBA 掃引で
   * 検出されるが causal tag は付かない。次ステップ)。カード使用/召喚そのもののコスト支払い
   * (play-card-resolution.ts / magic-system.ts / accel-change-system.ts の使用コスト) は
   * 「プレイという行為」であり効果解決由来ではないため設計上対象外 (実バトル破壊・ブレイヴ合体と
   * 同じ扱い)。structured-summon.ts / mirage-system.ts の効果駆動召喚コストは効果解決由来だが、
   * 各呼び出し箇所での「host 効果 instanceId」特定が未整理のため現状未対応 (次ステップ)。
   * 未指定時は undefined のまま (fail-closed、誤帰属しない)。
   */
  causedByEffectSourceInstanceId?: string | null;
  /**
   * effect source の防止レベル。leave_field trigger が「防げない状態ではない」等を
   * 判定できるよう、pending leave の物理 flush 境界まで保持する。
   */
  causedByEffectSourcePreventionLevel?: import("./model").EffectPreventionLevel;
  /**
   * 実バトルの BP 比べでこの離脱を成立させた相手側参加カード instanceId。
   * effect causal field とは分離し、triggerSourceFilter 用イベントへ転写する場合だけ参照する。
   */
  causedByBattleSourceInstanceId?: string | null;
  /**
   * 実バトルの BP 比べでこの離脱を成立させた相手側参加カード instanceId 群。
   * 複数ブロッカーは個別 BP 比較の複数 source として保持する。
   */
  causedByBattleSourceInstanceIds?: readonly string[] | null;
}

// Ver.17.0: 消滅待機の特別制約を撤廃。全待機状態を破壊と同一扱いに統一。
// 旧: VANISH_PENDING_ALLOWED_EFFECT_FILTERS で消滅待機は限定的な効果しか受けなかった。

export function getMinimumRequiredCores(card: CardInstance): number {
  return card.zone === "field" ? card.minimumRequiredCores : 0;
}

export function getAllowedEffectFilterTags(
  _card: CardInstance
): readonly EffectFilterTag[] {
  // Ver.17.0: 全待機状態で統一。消滅待機の特別制約なし。
  return [
    "general",
    "vanish_related",
    "leave_field_related",
    "suppress_effects",
    "suppress_used_card",
  ];
}

export function getEffectFilterBlockReason(
  card: CardInstance,
  effectFilterTags: readonly EffectFilterTag[] = ["general"]
): string | null {
  if (card.zone === "in_use") {
    // 「使用されたカードの効果を無効にする」系の効果は in_use でも作用できる
    const canTargetInUse = effectFilterTags.includes("suppress_used_card");
    if (!canTargetInUse) {
      return "card_in_use_zone";
    }
  }

  // Ver.17.0: 消滅待機でも全効果タグを受け付ける（破壊と同一扱い）
  return null;
}

export function canCardBeAffectedByEffect(
  card: CardInstance,
  effectFilterTags: readonly EffectFilterTag[] = ["general"]
): boolean {
  return getEffectFilterBlockReason(card, effectFilterTags) === null;
}

/**
 * 【アーツ】の「属性値が…満たしている間、フィールドに置き」を安定状態の自動遷移として
 * 解決する。これはプレイヤーの宣言・選択・タイミング窓を伴わない。
 *
 * BSLH01-T07〜T17 の確定裁定（needs-ruling.jsonl、2026-07-18）は、本文に発揮開始
 * タイミングがなく「フィールドに置き」が可能形でもないことから、配置と退場を対称な
 * 継続監視として扱う。条件充足時には誰のターンかを問わずトークンプールから配置し、
 * 条件を失った既存トークンは collectStateBasedActions の
 * `vanish_due_to_arts_gate_lost` で離脱する。
 */
function placeAutomaticArtsTokens(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): { state: GameState; checks: StateBasedActionCheck[] } {
  if (!getCardDefinitionById) return { state, checks: [] };

  let currentState = state;
  const checks: StateBasedActionCheck[] = [];

  for (const player of currentState.players) {
    const hosts = getEligibleQuartzHosts(
      currentState,
      player.id,
      getCardDefinitionById
    );
    for (const host of hosts) {
      const hostDef = getCardDefinitionById(host.definitionId);
      for (const tokenCardNo of hostDef?.relatedTokenCardNos ?? []) {
        const tokenDef = getCardDefinitionById(tokenCardNo);
        if (!tokenDef?.continuousSummonCondition || !tokenDef.summonCondition) {
          continue;
        }
        if (
          getArtsTokenInPlayCount(currentState, player.id, tokenDef.cardNo) >=
          (tokenDef.maxTokenDeckCount ?? Number.POSITIVE_INFINITY)
        ) {
          continue;
        }
        if (
          !evaluateCondition(
            currentState,
            tokenDef.summonCondition,
            host.instanceId,
            player.id,
            getCardDefinitionById
          )
        ) {
          continue;
        }

        currentState = placeArtsToken(currentState, player.id, tokenDef);
        checks.push({
          kind: "place_arts_token_due_to_condition",
          instanceId: host.instanceId,
          tokenCardNo: tokenDef.cardNo,
          detail: `arts-token=${tokenDef.cardNo}:host=${host.instanceId}`,
        });
      }
    }
  }

  return { state: currentState, checks };
}

export function filterTargetCardInstanceIdsByEffectFilter(
  state: GameState,
  candidateInstanceIds: readonly string[],
  effectFilterTags: readonly EffectFilterTag[] = ["general"]
): string[] {
  const cardInstancesById = new Map(
    state.cardInstances.map((cardInstance) => [
      cardInstance.instanceId,
      cardInstance,
    ])
  );

  return candidateInstanceIds.filter((candidateInstanceId) => {
    const cardInstance = cardInstancesById.get(candidateInstanceId);

    if (!cardInstance) {
      return false;
    }

    return canCardBeAffectedByEffect(cardInstance, effectFilterTags);
  });
}

export function collectStateBasedActions(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): StateBasedActionCheck[] {
  const checks: StateBasedActionCheck[] = [];
  const underCardIds = collectUnderCardScopeIds(state);
  const effectiveSoulStateIds = getCardDefinitionById
    ? getEffectiveSoulStateIds(state, getCardDefinitionById)
    : new Set(state.players.flatMap((player) => player.soulStateInstanceIds));

  for (const card of state.cardInstances) {
    const existingPendingLeaveKind = card.pendingLeaveKind;
    // 03f: コア不足は既存の離脱待機を変更しない。
    if (existingPendingLeaveKind !== null) {
      continue;
    }

    if (card.zone !== "field") {
      continue;
    }

    if (
      underCardIds.adventSource.has(card.instanceId) ||
      underCardIds.textRole.has(card.instanceId)
    ) {
      continue;
    }

    // ENGINE-quartz-core-deficit-vanish-exemption: クォーツとしてセットされたカードは
    // 「コアは持たない（魂状態）」設計 (quartz-system.ts setQuartz) のため常に
    // normalCoreCount:0。実カード定義由来の printed minimumRequiredCores (levelDefs[0].
    // requiredCores) は zone:"field" 遷移時にクリアされないため、クォーツセット直後に
    // 何らかの SBA が走ると本来の意味を持たないコア不足消滅が誤発火する
    // (BSLH01-C09 の battle_resolution flushPendingLeaves 経由テストで発覚)。
    if (card.zoneRoleName === "quartz") {
      continue;
    }

    if (getCardDefinitionById) {
      const def = getCardDefinitionById(card.definitionId);
      const hasSoulStateActivation =
        def !== undefined &&
        (getSoulStateActivationEffectIndex(def, "hand") !== null ||
          getSoulStateActivationEffectIndex(def, "set_aside") !== null);
      const controller = state.players.find(
        (p) => p.id === card.controllerPlayerId
      );
      const isSoulState =
        controller?.soulStateInstanceIds.includes(card.instanceId) ?? false;
      if (hasSoulStateActivation && !isSoulState) {
        checks.push({
          kind: "vanish_due_to_soul_state_only_field",
          instanceId: card.instanceId,
          detail: "soul-state-only-card-on-field-without-soul-state",
        });
        continue;
      }
    }

    // 魂状態のカードは field に置かれるが、スピリット/ブレイヴ等ではなく Lv を持たない。
    // そのため通常のコア不足消滅・合体条件喪失などのフィールド実体向け SBA から除外する。
    if (effectiveSoulStateIds.has(card.instanceId)) {
      continue;
    }

    // 【アーツ】自己配置トークン: 継続ゲート条件 (continuousSummonCondition) を
    // 満たさなくなったら SBA でフィールドから除去する (F2.4b⑤、qa-033 派生、
    // BSLH01-T07〜T17)。トークンのため flushPendingLeaves の token 経路が
    // removed_from_game へ自動振り分ける。
    if (card.zoneRoleName === "arts" && getCardDefinitionById) {
      const artsDef = getCardDefinitionById(card.definitionId);
      if (artsDef?.continuousSummonCondition && artsDef.summonCondition) {
        const conditionMet = evaluateCondition(
          state,
          artsDef.summonCondition,
          card.instanceId,
          card.controllerPlayerId,
          getCardDefinitionById
        );
        if (!conditionMet) {
          checks.push({
            kind: "vanish_due_to_arts_gate_lost",
            instanceId: card.instanceId,
            detail: "arts-gate-condition-no-longer-satisfied",
          });
          continue;
        }
      }
    }

    // P3-110 / P3-151: 維持コア配置待ち、またはブレイヴ直接合体選択待ちのカードは
    // 場入り直後 0 コアの「召喚 limbo」状態。配置/合体選択の前にコア不足消滅 SBA を
    // 適用しない (即時型効果召喚は 宣言→スタック→コスト→維持コア/合体選択 の順で、
    // 配置/選択完了後に改めて SBA が走る)。
    const awaitingEnterFieldPlacement =
      state.pendingEnterFieldPlacement?.sourceInstanceId === card.instanceId ||
      isAwaitingEffectEntryCores(state, card.instanceId);
    const awaitingBraveCombineChoice =
      state.pendingBraveCombineChoice?.braveInstanceId === card.instanceId;
    const awaitingBraveLeaveChoice =
      state.pendingBraveLeaveChoice?.braveInstanceIds.includes(card.instanceId);
    if (
      awaitingEnterFieldPlacement ||
      awaitingBraveCombineChoice ||
      awaitingBraveLeaveChoice
    ) {
      continue;
    }
    const awaitingCoreDistribution =
      state.pendingCoreDistribution?.candidates.some(
        (target) => target.instanceId === card.instanceId
      ) ?? false;
    const awaitingRebirthPostChoice = isAwaitingRebirthPostChoice({
      state,
      instanceId: card.instanceId,
    });
    if (awaitingCoreDistribution || awaitingRebirthPostChoice) {
      continue;
    }

    // P3-47 F-2: act_as_spirit (分身) が付与された裏向きカードは疑似スピリットとして
    // コア不足消滅の対象になる。実効最低コア (Lvコスト) は印字 minimumRequiredCores
    // ではなく付与された素性 (levelDefs) から導出する。
    const actAsSpiritMinimumRequiredCores = getCardDefinitionById
      ? resolveActAsSpiritMinimumRequiredCores(
          state,
          card,
          getCardDefinitionById
        )
      : undefined;

    // P3-47 F-1: 裏向きフィールド配置は「定義情報秘匿のリンボ」状態。
    // 印字 BP/Lv は適用されず、F-2 act_as_spirit CE が後続 step で attach されるまで
    // BP=0 / Lv=0 でも破壊判定の対象外とする (frandolle【フォーオブアカインド】 step1
    // で deck → field 裏向き 3 枚 → step2 core_distribute pending の間に SBA が走る経路)。
    // 裁定 #2 (host 離脱でも裏向きカードはフィールド残留) もこの分岐で吸収される。
    // 付与済み (act_as_spirit あり) の裏向きトークンは除外せず消滅判定へ進む。
    if (card.faceDown && actAsSpiritMinimumRequiredCores === undefined) {
      continue;
    }

    // 合体中のブレイヴはコア欠損消滅の対象外。合体スピリットは 1 体として扱い、
    // ユニットの Lv (コア数) はホスト側で判定されるため、ブレイヴ単体のコアが
    // Lv1 未満でも消滅しない (`05_brave-and-attack-special-cases.md`「合体スピリット
    // は 1 体として扱う」「ブレイヴ上のコアは合体先に移動する」)。ホスト離場時は
    // 先に分離されて attachedToInstanceId が null になってから本判定が適用される。
    if (card.attachedToInstanceId === null) {
      const def = getCardDefinitionById?.(card.definitionId);
      const printedMinimumRequiredCores =
        actAsSpiritMinimumRequiredCores ?? getMinimumRequiredCores(card);
      const levelCostOverride = getCardDefinitionById
        ? getEffectiveLevelCostOverride(state, card, def, getCardDefinitionById)
        : undefined;
      // Lv コスト修飾（「Lv1コストを1にする」型 + 「相手のLvコスト+2」型）を
      // getEffectiveLevel と同じ順序で最低 Lv コストへ反映する。
      const baseMinimumRequiredCores =
        levelCostOverride?.lv1 ?? printedMinimumRequiredCores;
      const levelCostDelta = getCardDefinitionById
        ? getEffectiveLevelCostDelta(state, card, def, getCardDefinitionById)
        : 0;
      const minimumRequiredCores = Math.max(
        0,
        baseMinimumRequiredCores + levelCostDelta
      );
      // ネクサスは通常コア0でも消滅しないが、Lvコスト修飾で実効最低Lvコストが
      // 正になった場合は、その実効最低コアを満たせなければ消滅する。
      if (
        card.zoneRoleName === "nexus" &&
        (minimumRequiredCores <= 0 ||
          (levelCostOverride === undefined && levelCostDelta <= 0))
      ) {
        continue;
      }

      const totalCoreCount = getTotalCoresOnCardById(state, card.instanceId);

      if (totalCoreCount < minimumRequiredCores) {
        checks.push({
          kind: "vanish_due_to_core_deficit",
          instanceId: card.instanceId,
          detail: `cores=${totalCoreCount} < minimum=${minimumRequiredCores}`,
        });
      }
    }

    // 合体条件喪失チェック: ブレイヴがスピリットに合体中で、条件を満たさなくなった場合
    if (
      card.zoneRoleName === "brave" &&
      card.attachedToInstanceId !== null &&
      existingPendingLeaveKind === null &&
      getCardDefinitionById
    ) {
      const braveDef = getCardDefinitionById(card.definitionId);
      const host = getCardById(state, card.attachedToInstanceId);
      const hostDef = host
        ? getCardDefinitionById(host.definitionId)
        : undefined;

      if (braveDef && host && host.pendingLeaveKind === null && hostDef) {
        const conditionLost =
          braveDef.braveCondition !== undefined &&
          !isIncomingBraveConditionIgnoredByHost({
            state,
            host,
            incomingBrave: card,
            incomingBraveDef: braveDef,
            getCardDefinitionById,
          }) &&
          !matchesBraveConditionForCard({
            condition: braveDef.braveCondition,
            state,
            card: host,
            definition: hostDef,
            getCardDefinitionById,
            excludeBraveInstanceId: card.instanceId,
            categoryEvaluation: "brave_host",
          });
        // 「このスピリットは合体できない」は、印字静的条件だけでなく、継続効果で
        // 付与されることがある。効果抑止が解けて restriction が戻った直後も、既に
        // 合体しているブレイヴを残さず SBA でただちに分離する (公式 Q24907)。
        const cannotCombineRestrictionActive =
          hasCannotCombineRestriction(state, card.instanceId, braveDef) ||
          hasCannotCombineRestriction(state, host.instanceId, hostDef);
        const separationReason = cannotCombineRestrictionActive
          ? "cannot_combine_restriction"
          : conditionLost
            ? "condition_lost"
            : undefined;
        if (
          separationReason !== undefined &&
          !hasPreventBraveSeparationRestriction(state, host.instanceId)
        ) {
          checks.push({
            kind: "brave_forced_separation",
            instanceId: card.instanceId,
            detail: `brave=${card.instanceId} host=${host.instanceId} ${separationReason}`,
          });
        }
      }
    }

    // BSGE01 裏面5面 textLines[0]「スピリット状態のこのブレイヴは…ただちに裏返す」
    // (P3-111 残り): B 面ブレイヴが合体先から分離してスピリット状態単独になった
    // (このパスまでに brave_forced_separation 等で attachedToInstanceId が既に
    // null 化済み) 瞬間、SBA で即座に A 面へ裏返る。原文はスピリット状態の間ずっと
    // 継続する性質のため、分離原因を問わず判定する。
    if (
      card.zoneRoleName === "brave" &&
      card.attachedToInstanceId === null &&
      card.definitionId !== card.originalDefinitionId &&
      getCardDefinitionById
    ) {
      const frontDef = getCardDefinitionById(card.originalDefinitionId);
      if (frontDef?.backFace?.revertToFrontOnSeparation) {
        checks.push({
          kind: "brave_backface_auto_revert",
          instanceId: card.instanceId,
          detail: `brave=${card.instanceId} back_to_front_on_separation`,
        });
      }
    }
  }

  if (
    getCardDefinitionById &&
    state.pendingZoneSelection === null &&
    !state.pendingCoreDistribution?.stateBasedBraveSeparation
  ) {
    for (const host of state.cardInstances) {
      if (
        host.zone !== "field" ||
        host.pendingLeaveKind !== null ||
        state.pendingBraveLeaveChoice?.hostInstanceId === host.instanceId ||
        host.attachedChildrenIds.length === 0 ||
        hasPreventBraveSeparationRestriction(state, host.instanceId)
      )
        continue;
      // Mandatory condition failures and entry into waiting resolve first.
      // Q24909 / Ver.17.0: neither an illegal brave nor a vanishing host is
      // a candidate for an ordinary capacity choice.
      if (
        checks.some(
          (check) =>
            check.instanceId === host.instanceId ||
            (check.kind === "brave_forced_separation" &&
              host.attachedChildrenIds.includes(check.instanceId))
        )
      )
        continue;
      if (
        getBraveCapacitySeparationOptions({
          state,
          host,
          getCardDefinitionById,
        }).length > 0
      ) {
        checks.push({
          kind: "brave_capacity_choice",
          instanceId: host.instanceId,
          detail: "owner_selects_legal_remainder",
        });
      }
    }
  }

  return checks;
}

function createStateBasedChainId(
  state: GameState,
  check: StateBasedActionCheck
): string {
  return `sba:${state.turnNumber}:${state.activePlayerId}:${state.step}:${check.kind}:${check.instanceId}`;
}

function applyCheckToCard(
  card: CardInstance,
  state: GameState,
  check: StateBasedActionCheck
): CardInstance {
  if (card.instanceId !== check.instanceId) {
    return card;
  }

  if (
    check.kind === "vanish_due_to_core_deficit" ||
    check.kind === "vanish_due_to_arts_gate_lost" ||
    check.kind === "vanish_due_to_soul_state_only_field"
  ) {
    const pendingLeaveKind =
      check.kind === "vanish_due_to_soul_state_only_field"
        ? "rule_cleanup"
        : "vanish";
    return {
      ...card,
      pendingLeaveKind,
      pendingLeaveCause: "state_based_action",
      // 効果由来の SBA 消滅はチェーンに束縛しない (例2: 自分のサブチェーン閉鎖時に移動)。
      // コスト支払い由来の消滅は payment-system が cause="cost_payment" + defer=true で別途検出。
      deferZoneMoveUntilChainEnd: false,
      pendingLeaveChainId: createStateBasedChainId(state, check),
    };
  }

  return card;
}

function removePendingLeaveReactionsForTransition(
  state: GameState,
  instanceId: string,
  oldChainId: string | null
): GameState {
  if (oldChainId === null) return state;
  const isOldPendingLeaveReaction = (reaction: {
    chainId: string | null;
    relatedInstanceId?: string | null;
  }): boolean =>
    reaction.relatedInstanceId === instanceId &&
    reaction.chainId === oldChainId;

  return {
    ...state,
    pendingTriggeredEffects: state.pendingTriggeredEffects.filter(
      (effect) => !isOldPendingLeaveReaction(effect)
    ),
    pendingDeferredTriggeredEffects:
      state.pendingDeferredTriggeredEffects.filter(
        (effect) => !isOldPendingLeaveReaction(effect)
      ),
    pendingPrivateDeclarations: state.pendingPrivateDeclarations.filter(
      (declaration) => !isOldPendingLeaveReaction(declaration)
    ),
    pendingBurstChecks: state.pendingBurstChecks.filter(
      (burstCheck) => !isOldPendingLeaveReaction(burstCheck)
    ),
  };
}

function applyBraveCapacityChoiceChecks(
  state: GameState,
  checks: readonly StateBasedActionCheck[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (
    !getCardDefinitionById ||
    state.pendingZoneSelection !== null ||
    state.pendingCoreDistribution?.stateBasedBraveSeparation
  )
    return state;
  for (const check of checks) {
    if (check.kind !== "brave_capacity_choice") continue;
    const host = getCardById(state, check.instanceId);
    if (!host || host.pendingLeaveKind !== null) continue;
    const choices = getBraveCapacitySeparationOptions({
      state,
      host,
      getCardDefinitionById,
    });
    const first = choices[0];
    if (!first) continue;
    return {
      ...state,
      pendingZoneSelection: {
        pendingId: `sba-brave-capacity:${host.instanceId}`,
        actingPlayerId: host.ownerPlayerId,
        sourceInstanceId: host.instanceId,
        sourceDefinitionId: host.definitionId,
        actionKind: "brave_separation",
        braveCapacityHostInstanceId: host.instanceId,
        sourceZone: "field",
        destination: "field",
        candidateCardInstanceIds: first,
        maxCount: first.length,
        canSkip: false,
        alternateSelections: choices
          .slice(1)
          .map((ids) => ({ count: ids.length, candidateInstanceIds: ids })),
        remainingActions: [],
        effectTiming: { kind: "continuous" },
      },
    };
  }
  return state;
}

export function resolveBraveCapacitySelection(
  state: GameState,
  selectedIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const hostId = state.pendingZoneSelection?.braveCapacityHostInstanceId;
  const host = hostId && getCardById(state, hostId);
  if (
    !host ||
    host.pendingLeaveKind !== null ||
    hasPreventBraveSeparationRestriction(state, host.instanceId)
  )
    throw new Error("Brave capacity choice is no longer applicable");
  const choices = getBraveCapacitySeparationOptions({
    state,
    host,
    getCardDefinitionById,
  });
  if (
    !choices.some(
      (ids) =>
        ids.length === selectedIds.length &&
        ids.every((id) => selectedIds.includes(id))
    )
  )
    throw new Error(
      "Brave capacity selection must leave a legal maximal combination"
    );
  return continueBraveForcedSeparations(
    { ...state, pendingZoneSelection: null },
    selectedIds,
    getCardDefinitionById
  );
}

export function continueBraveForcedSeparations(
  state: GameState,
  braveIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  return applyBraveForcedSeparationChecks(
    state,
    braveIds.map((instanceId) => ({
      kind: "brave_forced_separation",
      instanceId,
      detail: "owner_selected",
    })),
    getCardDefinitionById
  );
}

function applyBraveForcedSeparationChecks(
  state: GameState,
  checks: readonly StateBasedActionCheck[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  let current = state;
  for (const [index, check] of checks.entries()) {
    if (check.kind !== "brave_forced_separation") continue;
    if (current.pendingCoreDistribution !== null) break;
    const brave = getCardById(current, check.instanceId);
    const host =
      brave?.attachedToInstanceId &&
      getCardById(current, brave.attachedToInstanceId);
    // Ver.17.0: collecting a check before a simultaneous vanish must not
    // detach a brave after its host has entered waiting.
    if (
      !brave ||
      !host ||
      host.pendingLeaveKind !== null ||
      brave.pendingLeaveKind !== null ||
      current.pendingBraveLeaveChoice?.braveInstanceIds.includes(
        brave.instanceId
      ) ||
      hasPreventBraveSeparationRestriction(current, host.instanceId)
    )
      continue;
    const hostExhaustState =
      current.pendingBraveLeaveChoice?.hostInstanceId === host.instanceId
        ? current.pendingBraveLeaveChoice.hostExhaustState
        : current.reverseRebirthBraveSeparationExhaustSnapshots?.[
            brave.instanceId
          ];
    const definition = getCardDefinitionById?.(brave.definitionId);
    const policy =
      definition &&
      getEnterFieldCorePlacementPolicy({ card: brave, definition });
    const maximumAdditionalCores =
      policy?.maximumCoreCount == null
        ? undefined
        : Math.max(
            0,
            policy.maximumCoreCount -
              getTotalCoresOnCardById(current, brave.instanceId)
          );
    const sources =
      getCardDefinitionById &&
      collectChargeCoreSources(
        current,
        brave.controllerPlayerId,
        brave.instanceId,
        getCardDefinitionById
      );
    // Q382: putting cores is an owner choice even with a single source.
    // Use the existing field/reserve normal+soul-core chooser, including zero.
    if (
      maximumAdditionalCores !== 0 &&
      sources &&
      sources.totalNormalCores + sources.totalSoulCores > 0
    ) {
      current = {
        ...current,
        pendingCoreDistribution: {
          pendingId: `sba-brave-separate-core:${brave.instanceId}`,
          actingPlayerId: brave.ownerPlayerId,
          sourceInstanceId: brave.instanceId,
          sourceDefinitionId: brave.definitionId,
          candidates: [
            { instanceId: brave.instanceId, definitionId: brave.definitionId },
          ],
          ...sources,
          fromKind: "any_movable",
          minTotal: 0,
          ...(maximumAdditionalCores !== undefined
            ? { maxTotal: maximumAdditionalCores }
            : {}),
          fromPlayerId: brave.controllerPlayerId,
          toPlayerId: brave.controllerPlayerId,
          effectTiming: { kind: "continuous" },
          stateBasedBraveSeparation: {
            hostInstanceId: host.instanceId,
            braveInstanceId: brave.instanceId,
            ...(hostExhaustState !== undefined ? { hostExhaustState } : {}),
            ...(checks
              .slice(index + 1)
              .some((next) => next.kind === "brave_forced_separation")
              ? {
                  remainingBraveInstanceIds: checks
                    .slice(index + 1)
                    .filter((next) => next.kind === "brave_forced_separation")
                    .map((next) => next.instanceId),
                }
              : {}),
          },
        },
        log: [
          ...current.log,
          `sba:brave-forced-separation-core-choice:${brave.instanceId}:${host.instanceId}`,
        ],
      };
      break;
    }
    current = completeBraveForcedSeparation(
      current,
      brave.instanceId,
      host.instanceId,
      getCardDefinitionById,
      hostExhaustState
    );
  }
  return current;
}

/** Rule separation is not destruction/vanish; an unsupported brave goes straight
 * to trash without leave triggers (page09/Q382/Q367). Shared by immediate
 * no-core separation and the ordinary core-distribution continuation. */
export function completeBraveForcedSeparation(
  state: GameState,
  braveId: string,
  hostId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  hostExhaustState?: CardInstance["exhaustState"]
): GameState {
  const brave = getCardById(state, braveId);
  const host = getCardById(state, hostId);
  if (
    !brave ||
    !host ||
    brave.attachedToInstanceId !== hostId ||
    host.pendingLeaveKind !== null ||
    brave.pendingLeaveKind !== null ||
    hasPreventBraveSeparationRestriction(state, hostId)
  )
    return state;
  const def = getCardDefinitionById?.(brave.definitionId);
  const exhaustState = resolveSeparatedBraveExhaustState(
    brave,
    def,
    hostExhaustState === undefined
      ? host
      : { ...host, exhaustState: hostExhaustState }
  );
  let current = updateCard(state, braveId, (card) => ({
    ...card,
    attachedToInstanceId: null,
    exhaustState,
    ...(exhaustState === "recovered"
      ? { exhaustedByUnpreventableEffect: false }
      : {}),
  }));
  current = updateCard(current, hostId, (card) => ({
    ...card,
    attachedChildrenIds: card.attachedChildrenIds.filter(
      (id) => id !== braveId
    ),
  }));
  const snapshots = current.reverseRebirthBraveSeparationExhaustSnapshots;
  if (snapshots?.[braveId] !== undefined) {
    const { [braveId]: _consumed, ...rest } = snapshots;
    current = {
      ...current,
      reverseRebirthBraveSeparationExhaustSnapshots: rest,
    };
  }
  const detached = getCardById(current, braveId)!;
  const supported =
    def && getCardDefinitionById
      ? getEffectiveLevel(current, detached, def, getCardDefinitionById) > 0
      : getTotalCoresOnCardById(current, braveId) >=
        detached.minimumRequiredCores;
  if (!supported) {
    current = resolveCardLeavesFieldCores(current, braveId);
    current = moveCardZone(current, braveId, "trash");
    current = {
      ...current,
      log: [
        ...current.log,
        `sba:brave-rule-discard:${JSON.stringify([braveId, getCardById(current, braveId)?.fieldInstanceGeneration ?? 0])}`,
      ],
    };
  }
  if (getCardDefinitionById)
    current = removeBattleEntityMembersAndRecompute(
      current,
      [braveId],
      getCardDefinitionById
    );
  return {
    ...current,
    log: [
      ...current.log,
      `sba:brave-forced-separation:resolved:${braveId}:${hostId}:${supported ? "field" : "trash"}`,
    ],
  };
}

/**
 * BSGE01 裏面5面「ただちに裏返す」(P3-111 残り)。検出条件のみ新設し、フリップ処理自体は
 * 既存 `executeReverseRebirth` (mode:"flip") をそのまま再利用する。
 */
function applyBraveBackfaceAutoRevertChecks(
  state: GameState,
  checks: readonly StateBasedActionCheck[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (!getCardDefinitionById) return state;
  let updatedState = state;

  for (const check of checks) {
    if (check.kind !== "brave_backface_auto_revert") continue;
    const brave = getCardById(updatedState, check.instanceId);
    if (!brave || brave.attachedToInstanceId !== null) continue;
    updatedState = executeReverseRebirth(
      updatedState,
      brave.controllerPlayerId,
      { kind: "reverse_rebirth", mode: "flip" },
      brave.instanceId,
      getCardDefinitionById
    );
  }

  return updatedState;
}

function normalizeBattleSourceInstanceIds(
  source:
    | {
        causedByBattleSourceInstanceId?: string | null;
        causedByBattleSourceInstanceIds?: readonly string[] | null;
      }
    | null
    | undefined
): string[] {
  const sourceIds = new Set<string>();
  if (source?.causedByBattleSourceInstanceId) {
    sourceIds.add(source.causedByBattleSourceInstanceId);
  }
  for (const instanceId of source?.causedByBattleSourceInstanceIds ?? []) {
    sourceIds.add(instanceId);
  }
  return [...sourceIds];
}

function battleSourceInstanceIdsKey(instanceIds: readonly string[]): string {
  return [...instanceIds].sort().join("\u0000");
}

type PendingLeaveIdentity = Pick<
  PendingLeaveEntity,
  | "kind"
  | "cause"
  | "causePlayerId"
  | "chainId"
  | "leaveDestination"
  | "leaveFieldCoreDestinationOverride"
  | "causedByEffectSourceInstanceId"
  | "causedByBattleSourceInstanceId"
  | "causedByBattleSourceInstanceIds"
  | "blockedByResistance"
>;

function pendingLeaveDestinationKey(
  destination: PendingLeaveEntity["leaveDestination"] | undefined
): string {
  return `${destination?.zone ?? ""}:${destination?.position ?? ""}`;
}

function leaveCoreDestinationKey(
  destination:
    | LeaveFieldCoreDestinationOverride["normalCoreDestination"]
    | LeaveFieldCoreDestinationOverride["soulCoreDestination"]
    | undefined
): string {
  return destination === undefined
    ? ""
    : `${destination.kind}:${"playerId" in destination ? destination.playerId : ""}`;
}

function leaveFieldCoreDestinationOverrideKey(
  override: LeaveFieldCoreDestinationOverride | null | undefined
): string {
  return `${leaveCoreDestinationKey(
    override?.normalCoreDestination
  )}|${leaveCoreDestinationKey(override?.soulCoreDestination)}`;
}

export function hasPendingLeaveIdentityChanged(
  previous: PendingLeaveIdentity | null | undefined,
  next: PendingLeaveIdentity
): boolean {
  if (previous === null || previous === undefined) {
    return true;
  }
  return (
    previous.kind !== next.kind ||
    previous.chainId !== next.chainId ||
    previous.cause !== next.cause ||
    (previous.causePlayerId ?? null) !== (next.causePlayerId ?? null) ||
    (previous.causedByEffectSourceInstanceId ?? null) !==
      (next.causedByEffectSourceInstanceId ?? null) ||
    (previous.causedByBattleSourceInstanceId ?? null) !==
      (next.causedByBattleSourceInstanceId ?? null) ||
    battleSourceInstanceIdsKey(normalizeBattleSourceInstanceIds(previous)) !==
      battleSourceInstanceIdsKey(normalizeBattleSourceInstanceIds(next)) ||
    pendingLeaveDestinationKey(previous.leaveDestination) !==
      pendingLeaveDestinationKey(next.leaveDestination) ||
    leaveFieldCoreDestinationOverrideKey(
      previous.leaveFieldCoreDestinationOverride
    ) !==
      leaveFieldCoreDestinationOverrideKey(
        next.leaveFieldCoreDestinationOverride
      ) ||
    (previous.blockedByResistance === true) !==
      (next.blockedByResistance === true)
  );
}

export function queuePendingLeave(
  options: QueuePendingLeaveOptions
): GameState {
  if (options.leaveDestination) requireCardZone(options.leaveDestination.zone);
  const targetCard = getCardById(options.state, options.instanceId);

  if (!targetCard) {
    throw new Error(`Unknown pending leave target: ${options.instanceId}`);
  }

  if (targetCard.zone !== "field") {
    throw new Error(
      `Pending leave target must be on the field: ${options.instanceId}`
    );
  }

  const forceBraveSendWithHost =
    options.forceBraveSendWithHost ||
    hasPreventBraveSeparationRestriction(options.state, options.instanceId);
  const nextBattleSourceInstanceIds = normalizeBattleSourceInstanceIds(options);
  const primaryBattleSourceInstanceId = nextBattleSourceInstanceIds[0];

  // P3-74 Phase B: cannot_leave_field 耐性で阻止された経路。
  // card.pendingLeaveKind は触らず、pendingLeaveEntities にだけ判定成立マーカーを積む。
  if (options.blockedByResistance) {
    const pendingLeaveEntity: PendingLeaveEntity = {
      instanceId: options.instanceId,
      kind: options.kind,
      cause: options.cause,
      causePlayerId: options.causePlayerId ?? null,
      chainId: options.chainId,
      deferZoneMoveUntilChainEnd: false,
      leaveFieldCoreDestinationOverride: null,
      ...(options.leaveDestination
        ? { leaveDestination: options.leaveDestination }
        : {}),
      ...(options.preventStayOnField ? { preventStayOnField: true } : {}),
      ...(options.resolvedSourceRegistrationKeys?.length
        ? {
            resolvedSourceRegistrationKeys: [
              ...options.resolvedSourceRegistrationKeys,
            ],
          }
        : {}),
      ...(forceBraveSendWithHost ? { forceBraveSendWithHost: true } : {}),
      blockedByResistance: true,
      outcomeEstablished: options.outcomeEstablished === true,
      ...(options.causedByEffectSourceInstanceId
        ? {
            causedByEffectSourceInstanceId:
              options.causedByEffectSourceInstanceId,
          }
        : {}),
      ...(options.causedByEffectSourcePreventionLevel !== undefined
        ? {
            causedByEffectSourcePreventionLevel:
              options.causedByEffectSourcePreventionLevel,
          }
        : {}),
      ...(primaryBattleSourceInstanceId
        ? {
            causedByBattleSourceInstanceId: primaryBattleSourceInstanceId,
          }
        : {}),
      ...(nextBattleSourceInstanceIds.length > 0
        ? { causedByBattleSourceInstanceIds: nextBattleSourceInstanceIds }
        : {}),
    };
    return {
      ...options.state,
      pendingLeaveEntities: [
        ...options.state.pendingLeaveEntities.filter(
          (pendingLeave) => pendingLeave.instanceId !== options.instanceId
        ),
        pendingLeaveEntity,
      ],
      log: [
        ...options.state.log,
        `pending-leave-blocked-by-resistance:${options.kind}:${options.instanceId}:${options.chainId}:${options.cause}`,
      ],
    };
  }

  const deferZoneMoveUntilChainEnd =
    options.deferZoneMoveUntilChainEnd ?? false;

  // Ver.17.0: 待機状態間の遷移 — 既に待機状態のカードが別の待機状態に変化する場合、
  // 前の状態の誘発効果は解決不可となり、新状態の誘発が発揮される。
  const existingPendingLeave = options.state.pendingLeaveEntities.find(
    (pendingLeave) => pendingLeave.instanceId === options.instanceId
  );
  const oldPendingLeaveKind =
    existingPendingLeave?.kind ?? targetCard.pendingLeaveKind;
  const oldPendingLeaveChainId =
    existingPendingLeave?.chainId ?? targetCard.pendingLeaveChainId;
  const oldPendingLeaveCause =
    existingPendingLeave?.cause ?? targetCard.pendingLeaveCause;
  const oldPendingLeaveCausePlayerId =
    existingPendingLeave?.causePlayerId ?? null;
  const oldCausedByEffectSourceInstanceId =
    existingPendingLeave?.causedByEffectSourceInstanceId ?? null;
  const oldCausedByBattleSourceInstanceId =
    existingPendingLeave?.causedByBattleSourceInstanceId ?? null;
  const oldBattleSourceInstanceIdsKey = battleSourceInstanceIdsKey(
    normalizeBattleSourceInstanceIds(existingPendingLeave)
  );
  const nextCausePlayerId = options.causePlayerId ?? null;
  const nextCausedByEffectSourceInstanceId =
    options.causedByEffectSourceInstanceId ?? null;
  const nextCausedByBattleSourceInstanceId =
    primaryBattleSourceInstanceId ?? null;
  const previousPendingLeaveIdentity: PendingLeaveIdentity | null =
    oldPendingLeaveKind === null
      ? null
      : (existingPendingLeave ?? {
          kind: oldPendingLeaveKind,
          chainId: oldPendingLeaveChainId ?? options.chainId,
          cause: oldPendingLeaveCause ?? options.cause,
          causePlayerId: oldPendingLeaveCausePlayerId,
          leaveFieldCoreDestinationOverride: null,
          causedByEffectSourceInstanceId: oldCausedByEffectSourceInstanceId,
          causedByBattleSourceInstanceId: oldCausedByBattleSourceInstanceId,
          causedByBattleSourceInstanceIds:
            oldBattleSourceInstanceIdsKey.length > 0
              ? oldBattleSourceInstanceIdsKey.split("\u0000")
              : [],
        });
  const nextPendingLeaveIdentity: PendingLeaveIdentity = {
    kind: options.kind,
    chainId: options.chainId,
    cause: options.cause,
    causePlayerId: nextCausePlayerId,
    leaveFieldCoreDestinationOverride:
      options.leaveFieldCoreDestinationOverride ?? null,
    ...(options.leaveDestination
      ? { leaveDestination: options.leaveDestination }
      : {}),
    causedByEffectSourceInstanceId: nextCausedByEffectSourceInstanceId,
    causedByBattleSourceInstanceId: nextCausedByBattleSourceInstanceId,
    causedByBattleSourceInstanceIds: nextBattleSourceInstanceIds,
  };
  const isTransition =
    oldPendingLeaveKind !== null &&
    hasPendingLeaveIdentityChanged(
      previousPendingLeaveIdentity,
      nextPendingLeaveIdentity
    );

  // Ver.17.0: 合体ブレイヴ単体破壊 — ブレイヴが待機状態に入った場合、
  // 合体スピリットへの色・コスト・BP+・シンボル・合体中効果の付与を即座に停止する。
  // ブレイヴを即時分離して付与を解除する。
  const braveDetachHostId = targetCard.attachedToInstanceId;

  const updatedCardInstances = options.state.cardInstances.map(
    (cardInstance) => {
      if (cardInstance.instanceId === options.instanceId) {
        return {
          ...cardInstance,
          pendingLeaveKind: options.kind,
          pendingLeaveCause: options.cause,
          pendingLeaveChainId: options.chainId,
          deferZoneMoveUntilChainEnd,
          // ブレイヴ単体破壊: 合体リンクを即時解除
          ...(braveDetachHostId !== null ? { attachedToInstanceId: null } : {}),
        };
      }
      // ホスト側: ブレイヴの参照を除去
      if (
        braveDetachHostId !== null &&
        cardInstance.instanceId === braveDetachHostId
      ) {
        return {
          ...cardInstance,
          attachedChildrenIds: cardInstance.attachedChildrenIds.filter(
            (id) => id !== options.instanceId
          ),
        };
      }
      return cardInstance;
    }
  );

  // Ver.17.0: 待機状態間の遷移 — 前の状態の誘発効果を無効化
  let updatedPendingTriggeredEffects = options.state.pendingTriggeredEffects;
  let updatedPendingDeferredTriggeredEffects =
    options.state.pendingDeferredTriggeredEffects;
  let updatedPendingPrivateDeclarations =
    options.state.pendingPrivateDeclarations;
  let updatedPendingBurstChecks = options.state.pendingBurstChecks;
  if (isTransition && oldPendingLeaveChainId !== null) {
    const stateWithoutOldReactions = removePendingLeaveReactionsForTransition(
      {
        ...options.state,
        pendingTriggeredEffects: updatedPendingTriggeredEffects,
        pendingDeferredTriggeredEffects: updatedPendingDeferredTriggeredEffects,
        pendingPrivateDeclarations: updatedPendingPrivateDeclarations,
        pendingBurstChecks: updatedPendingBurstChecks,
      },
      options.instanceId,
      oldPendingLeaveChainId
    );
    updatedPendingTriggeredEffects =
      stateWithoutOldReactions.pendingTriggeredEffects;
    updatedPendingDeferredTriggeredEffects =
      stateWithoutOldReactions.pendingDeferredTriggeredEffects;
    updatedPendingPrivateDeclarations =
      stateWithoutOldReactions.pendingPrivateDeclarations;
    updatedPendingBurstChecks = stateWithoutOldReactions.pendingBurstChecks;
  }

  const pendingLeaveEntity: PendingLeaveEntity = {
    instanceId: options.instanceId,
    kind: options.kind,
    cause: options.cause,
    causePlayerId: options.causePlayerId ?? null,
    chainId: options.chainId,
    deferZoneMoveUntilChainEnd,
    leaveFieldCoreDestinationOverride:
      options.leaveFieldCoreDestinationOverride ?? null,
    ...(options.leaveDestination
      ? { leaveDestination: options.leaveDestination }
      : {}),
    ...(options.preventStayOnField ? { preventStayOnField: true } : {}),
    ...(options.resolvedSourceRegistrationKeys?.length
      ? {
          resolvedSourceRegistrationKeys: [
            ...options.resolvedSourceRegistrationKeys,
          ],
        }
      : {}),
    ...(options.suppressDestroyedEffects
      ? { suppressDestroyedEffects: options.suppressDestroyedEffects }
      : {}),
    ...(forceBraveSendWithHost ? { forceBraveSendWithHost: true } : {}),
    ...(options.causedByEffectSourceInstanceId
      ? {
          causedByEffectSourceInstanceId:
            options.causedByEffectSourceInstanceId,
        }
      : {}),
    ...(options.causedByEffectSourcePreventionLevel !== undefined
      ? {
          causedByEffectSourcePreventionLevel:
            options.causedByEffectSourcePreventionLevel,
        }
      : {}),
    ...(primaryBattleSourceInstanceId
      ? { causedByBattleSourceInstanceId: primaryBattleSourceInstanceId }
      : {}),
    ...(nextBattleSourceInstanceIds.length > 0
      ? { causedByBattleSourceInstanceIds: nextBattleSourceInstanceIds }
      : {}),
  };

  const logEntries = [
    `pending-leave:${options.kind}:${options.instanceId}:${options.chainId}:${options.cause}`,
  ];
  if (isTransition) {
    logEntries.push(
      `pending-leave-transition:${oldPendingLeaveKind}->${options.kind}:${options.instanceId}`
    );
  }
  if (braveDetachHostId !== null) {
    logEntries.push(
      `brave:detached:${options.instanceId}:pending-leave:host=${braveDetachHostId}`
    );
  }

  // P3-14 C-5: バトル中の破壊判定成立を ActiveAttack に記録する (「このバトルで破壊した」カウント源)。
  // 破壊判定は Q16 で常に成立するため、後続の残留置換でフィールドに残っても記録は維持する。
  // 待機状態遷移 (destroy→他 kind) は破壊が上書きされたため記録から除去する。
  let updatedActiveAttack = options.state.activeAttack;
  if (updatedActiveAttack !== null) {
    if (options.kind === "destroy") {
      const existingRecords = updatedActiveAttack.battleDestroyedRecords ?? [];
      if (!existingRecords.some((r) => r.instanceId === options.instanceId)) {
        updatedActiveAttack = {
          ...updatedActiveAttack,
          battleDestroyedRecords: [
            ...existingRecords,
            {
              instanceId: options.instanceId,
              definitionId: targetCard.definitionId,
              ownerPlayerId: targetCard.controllerPlayerId,
              causePlayerId: options.causePlayerId ?? null,
            },
          ],
        };
      }
    } else if (isTransition && oldPendingLeaveKind === "destroy") {
      const existingRecords = updatedActiveAttack.battleDestroyedRecords ?? [];
      if (existingRecords.some((r) => r.instanceId === options.instanceId)) {
        updatedActiveAttack = {
          ...updatedActiveAttack,
          battleDestroyedRecords: existingRecords.filter(
            (r) => r.instanceId !== options.instanceId
          ),
        };
      }
    }
  }

  return replaceCardInstances(
    {
      ...options.state,
      pendingTriggeredEffects: updatedPendingTriggeredEffects,
      pendingDeferredTriggeredEffects: updatedPendingDeferredTriggeredEffects,
      pendingPrivateDeclarations: updatedPendingPrivateDeclarations,
      pendingBurstChecks: updatedPendingBurstChecks,
      activeAttack: updatedActiveAttack,
      pendingLeaveEntities: [
        ...options.state.pendingLeaveEntities.filter(
          (pendingLeave) => pendingLeave.instanceId !== options.instanceId
        ),
        pendingLeaveEntity,
      ],
      log: [...options.state.log, ...logEntries],
    },
    updatedCardInstances
  );
}

/**
 * フィールド上のスピリットの実効 Lv（印字 levelDefs + コア数 + Lv コスト修飾）を返す。
 * `pendingLeaveLvSnapshot` のローリング記録専用。def が引けない / levelDefs が無い場合は null。
 *
 * Lv条件の算出は評価経路と同じ calculateLevelFromResources を使う。
 * 通常の安定時 snapshot は Lv コスト修飾を含める。
 * ただし、Lv コスト上昇だけで同一 SBA pass 内に消滅へ入る場合は、誘発条件用 snapshot は
 * 上昇前の安定 Lv を保持するため、呼び出し側が修飾を無視して fallback 算出できる。
 */
function computeFieldLevelForSnapshot(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: { ignoreLevelCostModifiers?: boolean } = {}
): number | null {
  const definition = getCardDefinitionById?.(card.definitionId);
  if (!definition || definition.levelDefs.length === 0) {
    return null;
  }
  const totalCores = getTotalCoresOnCardById(state, card.instanceId);
  const levelCostDelta =
    options.ignoreLevelCostModifiers === true
      ? 0
      : getEffectiveLevelCostDelta(
          state,
          card,
          definition,
          getCardDefinitionById
        );
  const levelCostOverride =
    options.ignoreLevelCostModifiers === true
      ? undefined
      : getEffectiveLevelCostOverride(
          state,
          card,
          definition,
          getCardDefinitionById
        );
  return calculateLevelFromResources(
    definition.levelDefs,
    totalCores,
    state.players.find((player) => player.id === card.controllerPlayerId)
      ?.countValue ?? 0,
    levelCostDelta,
    levelCostOverride
  );
}

function isLevelCostModifierOnlyVanish(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const definition = getCardDefinitionById?.(card.definitionId);
  if (!definition) return false;
  const levelCostDelta = getEffectiveLevelCostDelta(
    state,
    card,
    definition,
    getCardDefinitionById
  );
  const levelCostOverride = getEffectiveLevelCostOverride(
    state,
    card,
    definition,
    getCardDefinitionById
  );
  if (levelCostDelta <= 0 && levelCostOverride === undefined) return false;
  const baseMinimumRequiredCores = getMinimumRequiredCores(card);
  const effectiveMinimumRequiredCores = Math.max(
    0,
    (levelCostOverride?.lv1 ?? baseMinimumRequiredCores) + levelCostDelta
  );
  const totalCores = getTotalCoresOnCardById(state, card.instanceId);
  return (
    totalCores >= baseMinimumRequiredCores &&
    totalCores < effectiveMinimumRequiredCores
  );
}

export function runStateBasedActions(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  /**
   * P3-68 ギャップ 2: コア不足消滅 (`vanish_due_to_core_deficit`) を引き起こした
   * 効果のコントローラ (= 直前に解決した chain の acting player)。
   * 設定すると vanish の `causePlayerId` に伝搬し、相手のコア奪取由来の消滅が
   * `deriveTriggerEventCauseFromPendingLeave` で `opponent_effect` に導出される
   * (バースト発動条件 / 契約の魂状態置換 / replace_field_exit が正しく相手起因と判定)。
   * 省略時は null (現挙動維持 = 相手起因と判定しない)。
   */
  causedByPlayerId?: string | null,
  /**
   * P3-97: 効果解決でコア不足消滅 SBA が発生した場合も、離脱を引き起こした
   * 効果の発揮元 instanceId を pendingLeave に残す。delayed flush 後の
   * moved_to_trash などが source 色/カテゴリ条件を評価するために使う。
   */
  causedByEffectSourceInstanceId?: string | null,
  /**
   * ENGINE-soul-drive-departure-prevention-immunity (BSLH01-C07): `collectStateBasedActions`
   * は場全体を毎回スイープするため、`causedByEffectSourceInstanceId` の一致だけで
   * `preventStayOnField` を許可すると、同じ SBA パス内でたまたま無関係な理由でコア不足に
   * 陥った相手の別カードにまで誤って適用されうる (adversarial verifier round2 で refute)。
   * 直前に実行された【ソウルドライブ・S】発動元の core_move ステップが実際にコアを
   * 減らした対象 instanceId 集合を渡すと、`preventStayOnField` はこの集合に含まれる
   * インスタンスにのみ絞り込まれる。指定時のみ絞り込みが働く追加フィルタで、省略時は
   * `causedByEffectSourceInstanceId` 一致 + opponent-controlled のみで判定する既存挙動を保つ
   * (destroy 経路のように因果関係が既にアクション自身の target 解決で閉じている呼び出し元や、
   * 単体テストでの直接呼び出しに影響しないため)。唯一の実プロダクション呼び出し元
   * (`native-condition-connector.ts` の `after_triggers` 経路) は必ずこれを渡し、
   * 無関係カードへの誤適用を閉じる。
   */
  causedByStayOnFieldPreventionEligibleInstanceIds?: readonly string[] | null
): StateBasedActionResult {
  state = normalizeCardStateBattleStatus(state);
  state = synchronizeBraveExhaustion(state, getCardDefinitionById);
  const automaticArtsPlacement = placeAutomaticArtsTokens(
    state,
    getCardDefinitionById
  );
  const automaticArtsTokenInstanceIds =
    automaticArtsPlacement.state.cardInstances
      .slice(state.cardInstances.length)
      .map((card) => card.instanceId);
  state = automaticArtsPlacement.state;
  const checks = collectStateBasedActions(state, getCardDefinitionById);
  // BSLH01-C07 (ENGINE-soul-drive-departure-prevention-immunity): `causedByEffectSourceInstanceId`
  // が直前の executeEffect の soulDriveConsumption 配列に含まれる間、コア不足消滅の
  // preventStayOnField を適用する (1回限りではなく、この effect 解決に属する全対象へ適用。
  // 単一発動が複数対象へ及ぶ場合 (X09 Lv2/Lv3) に after_triggers 呼び出し毎で再評価されるため、
  // ここではクリアしない — クリアは executeEffect wrapper が呼び出し全体の return 時に行う
  // (model.ts 参照)。
  const causedByPreventStayOnField =
    causedByEffectSourceInstanceId !== undefined &&
    causedByEffectSourceInstanceId !== null &&
    (
      state.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds ??
      []
    ).includes(causedByEffectSourceInstanceId);

  // Ver.17.0 例2: 消滅待機に入る時点での Lv を `pendingLeaveLvSnapshot` に保存する。
  // 消滅判定は「コアがすべて外れた後」に走るため、その時点で現在コアから Lv を求めると
  // 0 になり「Lv2 で消滅」を再現できない。そこでフィールドで安定している (待機状態でない)
  // スピリットの実効 Lv を毎パス記録しておき、消滅遷移時に直前値を凍結する。
  // 1 個ずつ外された場合 (2→1→0) は各パスで Lv が下がり、消滅直前パスの Lv1 が凍結される。
  const vanishingInstanceIds = new Set(
    checks
      .filter(
        (check) =>
          check.kind === "vanish_due_to_core_deficit" ||
          check.kind === "vanish_due_to_arts_gate_lost" ||
          check.kind === "vanish_due_to_soul_state_only_field"
      )
      .map((check) => check.instanceId)
  );
  let rolledSnapshot = false;
  const rolledCards = state.cardInstances.map((card) => {
    const isVanishing = vanishingInstanceIds.has(card.instanceId);
    const isLevelCostModifierOnly = isVanishing
      ? isLevelCostModifierOnlyVanish(state, card, getCardDefinitionById)
      : false;
    if (
      card.zone !== "field" ||
      (card.zoneRoleName === "nexus" && !isLevelCostModifierOnly) ||
      card.attachedToInstanceId !== null ||
      card.faceDown ||
      (card.pendingLeaveKind !== null && !isLevelCostModifierOnly)
    ) {
      // 待機状態 / 消滅判定対象は記録しない（直前の安定 Lv を凍結値として保持する）。
      return card;
    }
    if (isVanishing) {
      if (!isLevelCostModifierOnly) {
        return card;
      }
      if (card.pendingLeaveLvSnapshot !== null) {
        return card;
      }
      const level = computeFieldLevelForSnapshot(
        state,
        card,
        getCardDefinitionById,
        { ignoreLevelCostModifiers: true }
      );
      if (level === null || level === card.pendingLeaveLvSnapshot) {
        return card;
      }
      rolledSnapshot = true;
      return { ...card, pendingLeaveLvSnapshot: level };
    }
    const level = computeFieldLevelForSnapshot(
      state,
      card,
      getCardDefinitionById
    );
    if (level === null || level === card.pendingLeaveLvSnapshot) {
      return card;
    }
    rolledSnapshot = true;
    return { ...card, pendingLeaveLvSnapshot: level };
  });

  if (checks.length === 0) {
    const stableState = rolledSnapshot
      ? replaceCardInstances({ ...state }, rolledCards)
      : state;
    if (automaticArtsPlacement.checks.length === 0) {
      return { state: stableState, checks };
    }
    return {
      state: recomputeAndRebuildContinuousEffectsForSources(
        stableState,
        getCardDefinitionById!,
        automaticArtsTokenInstanceIds
      ),
      checks: automaticArtsPlacement.checks,
    };
  }

  let updatedState: GameState = replaceCardInstances(
    {
      ...state,
      pendingLeaveEntities: [...state.pendingLeaveEntities],
    },
    rolledCards.map((card) =>
      checks.reduce(
        (currentCard, check) => applyCheckToCard(currentCard, state, check),
        card
      )
    )
  );

  // 強制分離: ブレイヴとホストの合体リンクを解除し、分離時疲労状態を決定する。
  updatedState = applyBraveForcedSeparationChecks(
    updatedState,
    checks,
    getCardDefinitionById
  );
  updatedState = applyBraveBackfaceAutoRevertChecks(
    updatedState,
    checks,
    getCardDefinitionById
  );
  updatedState = applyBraveCapacityChoiceChecks(
    updatedState,
    checks,
    getCardDefinitionById
  );

  const allChecks: StateBasedActionCheck[] = [...checks];
  const seenCheckKeys = new Set(
    checks.map((check) => `${check.kind}:${check.instanceId}`)
  );

  for (let pass = 0; pass < state.cardInstances.length; pass++) {
    const nextChecks = collectStateBasedActions(
      updatedState,
      getCardDefinitionById
    ).filter(
      (check) => !seenCheckKeys.has(`${check.kind}:${check.instanceId}`)
    );
    if (nextChecks.length === 0) break;
    allChecks.push(...nextChecks);
    for (const check of nextChecks) {
      seenCheckKeys.add(`${check.kind}:${check.instanceId}`);
    }
    updatedState = replaceCardInstances(
      {
        ...updatedState,
      },
      updatedState.cardInstances.map((card) =>
        nextChecks.reduce(
          (currentCard, check) =>
            applyCheckToCard(currentCard, updatedState, check),
          card
        )
      )
    );
    updatedState = applyBraveForcedSeparationChecks(
      updatedState,
      nextChecks,
      getCardDefinitionById
    );
    updatedState = applyBraveBackfaceAutoRevertChecks(
      updatedState,
      nextChecks,
      getCardDefinitionById
    );
    updatedState = applyBraveCapacityChoiceChecks(
      updatedState,
      nextChecks,
      getCardDefinitionById
    );
  }

  const pendingLeaveEntities = [...updatedState.pendingLeaveEntities];
  const pendingLeaveLogEntries: string[] = [];

  for (const check of allChecks) {
    if (
      check.kind !== "vanish_due_to_core_deficit" &&
      check.kind !== "vanish_due_to_arts_gate_lost" &&
      check.kind !== "vanish_due_to_soul_state_only_field"
    ) {
      continue;
    }
    const isSoulStateOnlyFieldConstraint =
      check.kind === "vanish_due_to_soul_state_only_field";
    const nextPendingLeaveKind: PendingLeaveKind =
      isSoulStateOnlyFieldConstraint ? "rule_cleanup" : "vanish";
    const existingPendingLeaveIndex = pendingLeaveEntities.findIndex(
      (pendingLeave) => pendingLeave.instanceId === check.instanceId
    );
    const existingPendingLeave =
      existingPendingLeaveIndex >= 0
        ? pendingLeaveEntities[existingPendingLeaveIndex]
        : undefined;
    // blockedByResistance は Q16/Q17 の「判定だけ成立した」marker であり、
    // card 側の離脱待機を表さない。SBA が同一カードを再評価したときにこれを既存の
    // leave と見なすと、applyCheckToCard() が一時的に立てた pending fields を復元して
    // marker と card state が非対称になる。耐性が失効した次の SBA では marker を通常の
    // pending leave に置換し、初めてカードも離脱待機へ入る。
    const existingPendingLeaveIsBlocked =
      existingPendingLeave?.blockedByResistance === true;
    if (
      existingPendingLeave?.kind === "vanish" &&
      !existingPendingLeaveIsBlocked &&
      !isSoulStateOnlyFieldConstraint
    ) {
      continue;
    }
    const cardBeforeRun = state.cardInstances.find(
      (c) => c.instanceId === check.instanceId
    );
    const oldPendingLeaveKind =
      (existingPendingLeaveIsBlocked ? null : existingPendingLeave?.kind) ??
      cardBeforeRun?.pendingLeaveKind ??
      null;
    const oldPendingLeaveChainId =
      (existingPendingLeaveIsBlocked ? null : existingPendingLeave?.chainId) ??
      cardBeforeRun?.pendingLeaveChainId ??
      null;
    const chainId = createStateBasedChainId(state, check);
    const card = updatedState.cardInstances.find(
      (c) => c.instanceId === check.instanceId
    );
    const blockedByResistance =
      !isSoulStateOnlyFieldConstraint &&
      card !== undefined &&
      resolveCardLeaveAffectDecisions(
        updatedState,
        [card],
        "vanish",
        causedByPlayerId ?? null,
        getCardDefinitionById ?? (() => undefined),
        "none",
        false,
        "effect"
      )[0]?.decision.kind === "blocked";
    if (blockedByResistance) {
      updatedState = replaceCardInstances(
        {
          ...updatedState,
        },
        updatedState.cardInstances.map((c) =>
          c.instanceId === check.instanceId
            ? oldPendingLeaveKind !== null
              ? {
                  ...c,
                  pendingLeaveKind: oldPendingLeaveKind,
                  pendingLeaveCause:
                    existingPendingLeave?.cause ?? c.pendingLeaveCause,
                  deferZoneMoveUntilChainEnd:
                    existingPendingLeave?.deferZoneMoveUntilChainEnd ??
                    c.deferZoneMoveUntilChainEnd,
                  pendingLeaveChainId: oldPendingLeaveChainId,
                }
              : {
                  ...c,
                  pendingLeaveKind: null,
                  pendingLeaveCause: null,
                  deferZoneMoveUntilChainEnd: false,
                  pendingLeaveChainId: null,
                }
            : c
        )
      );
      if (existingPendingLeave !== undefined) {
        pendingLeaveLogEntries.push(
          `pending-leave-blocked-by-resistance:vanish:${check.instanceId}:${chainId}:state_based_action`
        );
        continue;
      }
    }

    // BSLH01-C07: コア不足消滅 (X09型 core_move→trash) で離脱する相手カードすべてに
    // preventStayOnField を反映する (causedByPlayerId = 効果コントローラ。対象カードがその
    // 相手のときのみ適用。1回限りではなく、同一発動が及ぼす全対象へ一様に適用する)。
    // eligibleInstanceIds が渡されているときは、直前の core_move ステップが実際にコアを
    // 減らした対象だけに絞り込み、同じ SBA パスに偶然混入した無関係な相手カードへの
    // 誤適用を防ぐ (adversarial verifier round2)。
    const appliesSoulDriveStayOnFieldPrevention =
      check.kind === "vanish_due_to_core_deficit" &&
      causedByPreventStayOnField &&
      card !== undefined &&
      causedByPlayerId !== null &&
      causedByPlayerId !== undefined &&
      card.controllerPlayerId !== causedByPlayerId &&
      (causedByStayOnFieldPreventionEligibleInstanceIds === undefined ||
        causedByStayOnFieldPreventionEligibleInstanceIds === null ||
        causedByStayOnFieldPreventionEligibleInstanceIds.includes(
          check.instanceId
        ));
    const forceBraveSendWithHost = hasPreventBraveSeparationRestriction(
      updatedState,
      check.instanceId
    );
    const pendingLeaveEntity: PendingLeaveEntity = {
      instanceId: check.instanceId,
      kind: nextPendingLeaveKind,
      cause: "state_based_action",
      causePlayerId: isSoulStateOnlyFieldConstraint
        ? null
        : (causedByPlayerId ?? null),
      chainId,
      deferZoneMoveUntilChainEnd: false,
      leaveFieldCoreDestinationOverride: null,
      ...(blockedByResistance
        ? {
            blockedByResistance: true,
            outcomeEstablished:
              card !== undefined &&
              resolveCardLeaveAffectDecisions(
                updatedState,
                [card],
                "vanish",
                causedByPlayerId ?? null,
                getCardDefinitionById ?? (() => undefined),
                "none",
                true,
                "effect"
              )[0]?.decision.kind !== "blocked",
          }
        : {}),
      ...(!isSoulStateOnlyFieldConstraint && causedByEffectSourceInstanceId
        ? { causedByEffectSourceInstanceId }
        : {}),
      ...(appliesSoulDriveStayOnFieldPrevention
        ? { preventStayOnField: true }
        : {}),
      ...(forceBraveSendWithHost ? { forceBraveSendWithHost: true } : {}),
    };
    if (existingPendingLeaveIndex >= 0) {
      pendingLeaveEntities.splice(
        existingPendingLeaveIndex,
        1,
        pendingLeaveEntity
      );
      if (!existingPendingLeaveIsBlocked) {
        updatedState = removePendingLeaveReactionsForTransition(
          updatedState,
          check.instanceId,
          oldPendingLeaveChainId
        );
      }
      if (!existingPendingLeaveIsBlocked && oldPendingLeaveKind !== null) {
        pendingLeaveLogEntries.push(
          `pending-leave-transition:${oldPendingLeaveKind}->${nextPendingLeaveKind}:${check.instanceId}`
        );
      }
    } else {
      pendingLeaveEntities.push(pendingLeaveEntity);
    }
    pendingLeaveLogEntries.push(
      blockedByResistance
        ? `pending-leave-blocked-by-resistance:vanish:${check.instanceId}:${chainId}:state_based_action`
        : `pending-leave:${nextPendingLeaveKind}:${check.instanceId}:${chainId}`
    );
  }

  const stateBasedLogEntries = [
    ...automaticArtsPlacement.checks.map(
      (check) => `sba:${check.kind}:${check.instanceId}:${check.detail}`
    ),
    ...allChecks.map(
      (check) => `sba:${check.kind}:${check.instanceId}:${check.detail}`
    ),
    ...pendingLeaveLogEntries,
  ];

  const resultState: GameState = {
    ...updatedState,
    pendingLeaveEntities,
    log: [...updatedState.log, ...stateBasedLogEntries],
  };
  return {
    state:
      automaticArtsPlacement.checks.length > 0
        ? recomputeAndRebuildContinuousEffectsForSources(
            resultState,
            getCardDefinitionById!,
            automaticArtsTokenInstanceIds
          )
        : resultState,
    checks: [...automaticArtsPlacement.checks, ...allChecks],
  };
}

export function applyStateBasedActions(state: GameState): GameState {
  return runStateBasedActions(state).state;
}

export function canFlushPendingLeaves(state: GameState): boolean {
  return getFlushablePendingLeaves(state).length > 0;
}

function isChainScopedEffectQueueEntry(entry: EffectQueueEntry): boolean {
  return entry.scope === "chain";
}

/** 効果解決の入力・継続待ち。分類の正源は pending-resolution-policy.ts。
 * 離脱選択は別段階なので含めず、leave 自身を待つ循環を避ける。 */
export function hasOutstandingEffectResolutionContinuation(
  state: GameState
): boolean {
  return hasPendingEffectResolution(state, "all");
}

/**
 * 同じ解決区間で発生した離脱と派生誘発を結び付ける。
 * 外側の chain 全体ではなく発生した pending ID を待つことで、after_triggers の
 * 後段を待つ循環を避け、内側の離脱はその区間の反応が閉じた時点で確定する (04/04d)。
 */
export function trackPendingLeaveResolutionReactions(
  beforeState: GameState,
  state: GameState,
  resolutionChainId: string | null
): GameState {
  const previousLeaves = new Map(
    beforeState.pendingLeaveEntities.map((leave) => [leave.instanceId, leave])
  );
  const newLeaves = state.pendingLeaveEntities.filter(
    (leave) =>
      (leave.cause === "effect_resolution" ||
        leave.cause === "state_based_action") &&
      hasPendingLeaveIdentityChanged(
        previousLeaves.get(leave.instanceId),
        leave
      )
  );
  if (newLeaves.length === 0) return state;
  const pendingReactions = (value: GameState) => [
    ...value.pendingTriggeredEffects,
    ...value.pendingDeferredTriggeredEffects,
    ...value.pendingPrivateDeclarations,
  ];
  const previousIds = new Set(
    pendingReactions(beforeState).map((pending) => pending.pendingId)
  );
  const reactions = pendingReactions(state).filter(
    (pending) =>
      !previousIds.has(pending.pendingId) ||
      (resolutionChainId !== null && pending.chainId === resolutionChainId)
  );
  const isPreFlush = (
    pending: PendingTriggeredEffect | PendingPrivateDeclaration
  ) =>
    pending.preFlushLeaveEvent === true ||
    (pending.registeredLeaveFieldPreFlushSourceKeys?.length ?? 0) > 0;
  const blocksRelatedLeave = (
    pending: PendingTriggeredEffect | PendingPrivateDeclaration,
    leave: PendingLeaveEntity
  ) =>
    "declarationId" in pending
      ? isPrivateRegisteredPreFlushLeaveReactionForLeaver(pending, leave)
      : isPendingRegisteredPreFlushLeaveReactionForLeaver(pending, leave) ||
        isPendingGrantedEffectLeaveReactionForLeaver(state, pending, leave);
  const reactionIds = reactions
    .filter((pending) => !isPreFlush(pending))
    .map((pending) => pending.pendingId);
  // 実際に待機を保つ反応だけを同時離脱の他の対象にも伝える (04d)。
  // raw 登録や、残留禁止で待つ必要のない自身の反応は含めない。
  const preFlushReactions = reactions.filter(
    (pending) =>
      isPreFlush(pending) &&
      newLeaves.some((leave) => blocksRelatedLeave(pending, leave))
  );
  if (reactionIds.length === 0 && preFlushReactions.length === 0) return state;
  const newIds = new Set(newLeaves.map((leave) => leave.instanceId));
  return {
    ...state,
    pendingLeaveEntities: state.pendingLeaveEntities.map((leave) =>
      newIds.has(leave.instanceId)
        ? {
            ...leave,
            reactionChainIds: [
              ...new Set([
                ...(leave.reactionChainIds ?? []),
                ...reactionIds,
                ...preFlushReactions
                  .filter(
                    (pending) =>
                      !isRelatedPendingLeave(pending, leave) ||
                      blocksRelatedLeave(pending, leave)
                  )
                  .map((pending) => pending.pendingId),
              ]),
            ],
          }
        : leave
    ),
  };
}

/** 離脱に由来する宣言・実行チェーンを記録し、その派生効果まで待つ。 */
export function trackPendingLeaveReactionChain(
  state: GameState,
  pending: PendingTriggeredEffect,
  chainId: string,
  relatedIds = new Set([
    pending.relatedInstanceId,
    ...(pending.relatedInstanceIds ?? []),
  ])
): GameState {
  return {
    ...state,
    pendingLeaveEntities: state.pendingLeaveEntities.map((leave) => {
      const initial =
        pending.preFlushLeaveEvent === true && relatedIds.has(leave.instanceId);
      const derived = leave.reactionChainIds?.some(
        (ownerChainId) =>
          isChainAtOrUnder(pending.pendingId, ownerChainId) ||
          (pending.chainId !== null &&
            isChainAtOrUnder(pending.chainId, ownerChainId))
      );
      return initial || derived
        ? {
            ...leave,
            reactionChainIds: [
              ...new Set([...(leave.reactionChainIds ?? []), chainId]),
            ],
          }
        : leave;
    }),
  };
}

/**
 * owner 鎖 (またはその子孫サブチェーン) の解決が effectQueue 上で進行中か。
 * 両系統共通: 自分のサブチェーンがまだ解決中なら実移動しない。
 */
function isOwnChainResolving(state: GameState, ownerChainId: string): boolean {
  return state.effectQueueEntries.some(
    (entry) =>
      entry.scope === "chain" &&
      entry.chainId != null &&
      isChainAtOrUnder(entry.chainId, ownerChainId)
  );
}

/**
 * owner 鎖、またはその子孫サブチェーンに紐づく誘発効果が pending/deferred/宣言中か。
 * 原因チェーン全体を待つ指定と、離脱から派生した反応チェーンの完了確認に使用する。
 * 外側の原因効果と内側の離脱反応を区別し、無関係な後続効果までは待たない。
 */
function hasPendingDescendantTriggeredEffects(
  state: GameState,
  ownerChainId: string,
  includeDeclared = false
): boolean {
  const matchesChain = (chainId: string | null | undefined): boolean =>
    chainId != null && isChainAtOrUnder(chainId, ownerChainId);
  return (
    state.pendingTriggeredEffects.some(
      (effect) => matchesChain(effect.pendingId) || matchesChain(effect.chainId)
    ) ||
    state.pendingDeferredTriggeredEffects.some(
      (effect) => matchesChain(effect.pendingId) || matchesChain(effect.chainId)
    ) ||
    state.pendingPrivateDeclarations.some(
      (decl) => matchesChain(decl.pendingId) || matchesChain(decl.chainId)
    ) ||
    (includeDeclared &&
      collectPendingStacks(state).some((stack) => matchesChain(stack.chainId)))
  );
}

/**
 * `pendingLeave` の離脱者自身 (instanceId) への未解決 `granted_effect` mechanic pending
 * のうち、付与効果本体が離脱イベントに反応するものがあるか。
 *
 * 付与された効果の判定。通常の登録済み効果は別の source key ゲートで
 * ドロー/カウント等も含めて待ち、宣言した効果の派生チェーンも追跡する (Q1501)。
 */
function isPendingGrantedEffectLeaveReactionForLeaver(
  state: GameState,
  pending: PendingTriggeredEffect,
  pendingLeave: PendingLeaveEntity
): boolean {
  return (
    pending.mechanic?.kind === "granted_effect" &&
    pending.relatedInstanceId === pendingLeave.instanceId &&
    isGrantedLeaveReaction(
      state,
      pending.mechanic.grantCeEffectId,
      pendingLeave.kind
    ) &&
    !(
      pendingLeave.preventStayOnField &&
      isGrantedLeaveReaction(
        state,
        pending.mechanic.grantCeEffectId,
        pendingLeave.kind,
        true
      )
    )
  );
}

function hasPendingGrantedEffectLeaveReactionForLeaver(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  return state.pendingTriggeredEffects.some((pending) =>
    isPendingGrantedEffectLeaveReactionForLeaver(state, pending, pendingLeave)
  );
}

function hasOutstandingEffectResolutionContinuationBlockingLeaveFlush(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  // after_triggers の後続 step 待ちは、それ自体では defer=false の効果離脱を止めない。
  // 元チェーン全体を待つ指定と、離脱から派生した効果の後続 step は blocker に残す。
  const waitChainIds = [
    ...(pendingLeave.reactionChainIds ?? []),
    ...(pendingLeave.deferZoneMoveUntilChainEnd ? [pendingLeave.chainId] : []),
  ];
  const pendingAfterTriggersContinuations =
    state.pendingAfterTriggersContinuations.filter((continuation) => {
      const continuationChainIds = [
        continuation.chainId,
        continuation.waitChainId,
      ].filter((chainId): chainId is string => typeof chainId === "string");
      return continuationChainIds.some((chainId) =>
        waitChainIds.some((waitChainId) =>
          isChainAtOrUnder(chainId, waitChainId)
        )
      );
    });
  return hasOutstandingEffectResolutionContinuation({
    ...state,
    pendingAfterTriggersContinuations,
    // 発動選択済みのバーストは、応答スタックのコスト支払いで生じた離脱を
    // 確定してから効果宣言へ進む。effect-declaration marker がまだ付いていない
    // activation stack もここに含めないと、離脱は cascade を待ち、cascade は
    // 離脱を待つ相互待機になる (EDH-0183)。
    pendingStackCascade: state.pendingStackCascade?.remainingStacks.every(
      (stack) =>
        // 応答やそのバーストを待つ次のスタックは、現在の効果の継続ではない。
        // そのスタック自身のコスト離脱・派生処理を待つ場合だけ依存を残す。
        ((stack.waitForResolutionChainIds?.length ?? 0) > 0 &&
          !waitChainIds.some((chainId) =>
            isChainAtOrUnder(stack.chainId, chainId)
          )) ||
        (stack.actionKind === "burst_activation" &&
          (stack.burstEffectDeclarationPending === true ||
            (stack.burstActivationWindowPending !== true &&
              stack.burstCheckId !== undefined &&
              state.pendingBurstChecks.some(
                (check) =>
                  check.checkId === stack.burstCheckId &&
                  check.activationSelected === true
              ))))
    )
      ? null
      : state.pendingStackCascade,
    // 対象開示に対する応答効果が発生させた通常の離脱は、その応答サブチェーンの
    // 終端で実移動させてから開示元効果を再開する。外側の開示 continuation を
    // 一律 blocker にすると、手札へ戻したはずの対象が field 扱いのまま元効果を受ける。
    // チェーン終端まで残す明示指定だけは従来どおり外側 continuation を待つ。
    pendingTargetedDisclosureContinuation:
      pendingLeave.deferZoneMoveUntilChainEnd === true
        ? state.pendingTargetedDisclosureContinuation
        : null,
  });
}

function resolvedSourceKeysContain(
  resolvedKeys: Set<string>,
  sourceKey: string
): boolean {
  if (resolvedKeys.has(sourceKey)) return true;
  const sourceInstanceId = sourceKey.split("#", 1)[0];
  return sourceInstanceId !== undefined && resolvedKeys.has(sourceInstanceId);
}

function hasUnresolvedStayOnFieldSourceKey(
  pending: PendingTriggeredEffect
): boolean {
  const staySourceKeys = pending.registeredLeaveFieldStayOnFieldSourceKeys;
  if (!staySourceKeys || staySourceKeys.length === 0) return false;
  const resolvedKeys = new Set(pending.resolvedSourceRegistrationKeys ?? []);
  return staySourceKeys.some(
    (sourceKey) => !resolvedSourceKeysContain(resolvedKeys, sourceKey)
  );
}

function hasUnresolvedPreFlushSourceKey(
  pending: PendingTriggeredEffect,
  pendingLeave: PendingLeaveEntity
): boolean {
  const sourceKeys = pending.registeredLeaveFieldPreFlushSourceKeys;
  if (!sourceKeys || sourceKeys.length === 0) return false;
  const resolvedKeys = new Set(pending.resolvedSourceRegistrationKeys ?? []);
  if (pending.effectSuppressed) return false;
  return sourceKeys.some(
    (sourceKey) =>
      !resolvedSourceKeysContain(resolvedKeys, sourceKey) &&
      !pending.suppressedSourceInstanceIds?.includes(
        sourceKey.split("#")[0]!
      ) &&
      !(
        pendingLeave.preventStayOnField &&
        pending.registeredLeaveFieldStayOnFieldSourceKeys?.includes(sourceKey)
      )
  );
}

/** 集約された離脱イベントは、代表だけでなく全関連個体の待機を保つ (Q1501)。 */
function isRelatedPendingLeave(
  event: Pick<
    PendingTriggeredEffect,
    "relatedInstanceId" | "relatedInstanceIds"
  >,
  leave: PendingLeaveEntity
): boolean {
  return (
    event.relatedInstanceId === leave.instanceId ||
    event.relatedInstanceIds?.includes(leave.instanceId) === true
  );
}

function isPendingRegisteredStayOnFieldLeaveReactionForLeaver(
  pending: PendingTriggeredEffect,
  pendingLeave: PendingLeaveEntity
): boolean {
  if (!isRelatedPendingLeave(pending, pendingLeave)) return false;
  if (!matchesDeclaredCardEventKind([pending.eventKind], pendingLeave.kind)) {
    return false;
  }
  return hasUnresolvedStayOnFieldSourceKey(pending);
}

function isPendingRegisteredPreFlushLeaveReactionForLeaver(
  pending: PendingTriggeredEffect,
  pendingLeave: PendingLeaveEntity
): boolean {
  if (!isRelatedPendingLeave(pending, pendingLeave)) return false;
  if (!matchesDeclaredCardEventKind([pending.eventKind], pendingLeave.kind)) {
    return false;
  }
  return hasUnresolvedPreFlushSourceKey(pending, pendingLeave);
}

function privateDeclarationHasRegisteredStayOnFieldSourceKey(
  declaration: PendingPrivateDeclaration
): boolean {
  const sourceKeys = declaration.registeredLeaveFieldStayOnFieldSourceKeys;
  return sourceKeys !== undefined && sourceKeys.length > 0;
}

function privateDeclarationHasRegisteredPreFlushSourceKey(
  declaration: PendingPrivateDeclaration
): boolean {
  const sourceKeys = declaration.registeredLeaveFieldPreFlushSourceKeys;
  return sourceKeys !== undefined && sourceKeys.length > 0;
}

function isPrivateRegisteredStayOnFieldLeaveReactionForLeaver(
  declaration: PendingPrivateDeclaration,
  pendingLeave: PendingLeaveEntity
): boolean {
  if (!isRelatedPendingLeave(declaration, pendingLeave)) return false;
  if (
    !matchesDeclaredCardEventKind([declaration.eventKind], pendingLeave.kind)
  ) {
    return false;
  }
  return privateDeclarationHasRegisteredStayOnFieldSourceKey(declaration);
}

function isPrivateRegisteredPreFlushLeaveReactionForLeaver(
  declaration: PendingPrivateDeclaration,
  pendingLeave: PendingLeaveEntity
): boolean {
  if (!isRelatedPendingLeave(declaration, pendingLeave)) return false;
  if (
    !matchesDeclaredCardEventKind([declaration.eventKind], pendingLeave.kind)
  ) {
    return false;
  }
  return (
    privateDeclarationHasRegisteredPreFlushSourceKey(declaration) &&
    !(
      pendingLeave.preventStayOnField &&
      privateDeclarationHasRegisteredStayOnFieldSourceKey(declaration)
    )
  );
}

function hasPendingRegisteredStayOnFieldLeaveReactionForLeaver(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  if (pendingLeave.preventStayOnField) return false;
  return (
    state.pendingTriggeredEffects.some((pending) =>
      isPendingRegisteredStayOnFieldLeaveReactionForLeaver(
        pending,
        pendingLeave
      )
    ) ||
    state.pendingPrivateDeclarations.some((declaration) =>
      isPrivateRegisteredStayOnFieldLeaveReactionForLeaver(
        declaration,
        pendingLeave
      )
    )
  );
}

function hasPendingRegisteredPreFlushLeaveReactionForLeaver(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  return (
    state.pendingTriggeredEffects.some((pending) =>
      isPendingRegisteredPreFlushLeaveReactionForLeaver(pending, pendingLeave)
    ) ||
    state.pendingPrivateDeclarations.some((declaration) =>
      isPrivateRegisteredPreFlushLeaveReactionForLeaver(
        declaration,
        pendingLeave
      )
    )
  );
}

function hasDeclaredRegisteredStayOnFieldLeaveReactionForLeaver(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  return (
    !pendingLeave.preventStayOnField &&
    collectPendingStacks(state).some(
      (stack) =>
        stack.triggeredPendingSnapshot !== undefined &&
        isPendingRegisteredStayOnFieldLeaveReactionForLeaver(
          stack.triggeredPendingSnapshot,
          pendingLeave
        )
    )
  );
}

function hasDeclaredRegisteredPreFlushLeaveReactionForLeaver(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  return collectPendingStacks(state).some(
    (stack) =>
      stack.triggeredPendingSnapshot !== undefined &&
      isPendingRegisteredPreFlushLeaveReactionForLeaver(
        stack.triggeredPendingSnapshot,
        pendingLeave
      )
  );
}

function isGrantedLeaveReaction(
  state: GameState,
  grantCeEffectId: string,
  pendingLeaveKind: PendingLeaveKind,
  requireStay = false
): boolean {
  const ce = state.activeContinuousEffects.find(
    (candidate) => candidate.effectId === grantCeEffectId
  );
  const grantedEffect = ce?.metadata?.grantedEffect as Effect | undefined;
  if (!grantedEffect) return false;
  const timing = grantedEffect.timing;
  if (
    typeof timing !== "object" ||
    timing === null ||
    timing.kind !== "card_event"
  ) {
    return false;
  }
  const events = Array.isArray(timing.event) ? timing.event : [timing.event];
  if (!matchesDeclaredCardEventKind(events, pendingLeaveKind)) return false;
  return (
    !requireStay ||
    grantedEffect.steps.some((step) => step.action.kind === "stay_on_field")
  );
}

function canFlushPendingLeaveEntity(
  state: GameState,
  pendingLeave: PendingLeaveEntity
): boolean {
  // プレイヤー入力待ちの効果解決継続 (コア配分 / 対象選択 / 維持コア配置 / スタックカスケード等) が
  // 残っている間は、その離脱の原因チェーンがまだ閉じていないため実移動しない (例1/例2)。
  // 全待機種別共通: defer=false (例2) でも、自サブチェーンが入力待ちで中断中なら閉鎖前。
  // 最後の継続が resume → finalize した時点で flush される。
  if (
    hasOutstandingEffectResolutionContinuationBlockingLeaveFlush(
      state,
      pendingLeave
    )
  ) {
    return false;
  }

  // Q420/Q436/Q480: 発動宣言は待機入り時。宣言する/しないの選択が
  // 未完了なら実移動前の魂状態/ブレイヴ選択をまだ提示しない。
  if (
    state.pendingBurstChecks.some(
      (check) =>
        check.relatedInstanceId === pendingLeave.instanceId &&
        check.activationSelected === false
    )
  )
    return false;

  // 自分のサブチェーン (owner 鎖とその子孫) が effectQueue 上で解決中なら待つ (両系統共通)。
  // 例2 の C は owner=破壊専用 ID で、祖先 (召喚時誘発) の解決鎖は自分の配下でないため
  // ここを通過し、after_triggers 境界で「この効果発揮後」より前に移動できる。
  if (isOwnChainResolving(state, pendingLeave.chainId)) {
    return false;
  }

  if (
    pendingLeave.reactionChainIds?.some(
      (chainId) =>
        isOwnChainResolving(state, chainId) ||
        hasPendingDescendantTriggeredEffects(state, chainId, true)
    )
  )
    return false;

  // 離脱者自身への registered card_event stay_on_field / granted_effect 残置選択が
  // 未解決/宣言中なら defer フラグを問わず保留する。通常の count+1/draw 等も
  // registeredLeaveFieldPreFlushSourceKeys に含め、すべて解決後に選択へ進む (Q1501)。
  // 同じく、離脱者自身を `includePendingLeave:true` で対象にする pre-flush 反応
  // (例: 破壊された対象をデッキ下へ戻す) も flush 前に解決させる。
  if (hasPendingRegisteredPreFlushLeaveReactionForLeaver(state, pendingLeave)) {
    return false;
  }
  if (
    hasDeclaredRegisteredPreFlushLeaveReactionForLeaver(state, pendingLeave)
  ) {
    return false;
  }
  if (
    hasPendingRegisteredStayOnFieldLeaveReactionForLeaver(state, pendingLeave)
  ) {
    return false;
  }
  if (
    hasDeclaredRegisteredStayOnFieldLeaveReactionForLeaver(state, pendingLeave)
  ) {
    return false;
  }
  if (hasPendingGrantedEffectLeaveReactionForLeaver(state, pendingLeave)) {
    return false;
  }

  // 例1 (コスト支払い消滅, defer=true): 使用効果チェーン全体に束縛。owner 配下の誘発効果
  // (召喚時誘発等) が pending/解決中の間も保留し、全子孫サブチェーン閉鎖後に移動する。
  // P3-85: 単一 chainId の exact 比較では召喚時誘発「解決中」のサブチェーンを取りこぼし
  // B が「この効果発揮後」より前に flush していた。子孫 chainId を包含判定で捕捉する。
  if (
    pendingLeave.deferZoneMoveUntilChainEnd &&
    (hasPendingDescendantTriggeredEffects(state, pendingLeave.chainId) ||
      (state.pendingEffectCompletions ?? []).some(
        (completion) =>
          completion.chainId != null &&
          isChainAtOrUnder(completion.chainId, pendingLeave.chainId)
      ))
  ) {
    return false;
  }

  // owner 配下が無くても global 解決が進行中なら未閉鎖とみなして待つ。
  return state.effectQueueEntries.every(isChainScopedEffectQueueEntry);
}

interface FlushPendingLeavesOptions {
  ownerChainId?: string | null;
}

function isPendingLeaveInFlushScope(
  pendingLeave: PendingLeaveEntity,
  options?: FlushPendingLeavesOptions
): boolean {
  const ownerChainId = options?.ownerChainId;
  return (
    ownerChainId === undefined ||
    ownerChainId === null ||
    isChainAtOrUnder(pendingLeave.chainId, ownerChainId)
  );
}

function getFlushablePendingLeaves(
  state: GameState,
  options?: FlushPendingLeavesOptions
): PendingLeaveEntity[] {
  return state.pendingLeaveEntities.filter(
    (pendingLeave) =>
      isPendingLeaveInFlushScope(pendingLeave, options) &&
      canFlushPendingLeaveEntity(state, pendingLeave)
  );
}

function getZoneRoleNameAfterLeave(card: CardInstance): string {
  switch (card.zoneRoleName) {
    case "spirit":
    case "ultimate":
    case "brave":
    case "nexus":
    case "magic":
      return `${card.zoneRoleName}-card`;
    default:
      return card.zoneRoleName;
  }
}

function getPendingLeaveDestinationZone(
  pendingLeave: PendingLeaveEntity
): Zone {
  return (
    pendingLeave.leaveDestination?.zone ??
    getDefaultLeaveDestinationZone(pendingLeave.kind)
  );
}

function isPendingLeaveEligibleForFieldExitReplacement(
  pendingLeave: PendingLeaveEntity
): boolean {
  // rule_cleanup は「フィールド離脱」ではなく、ルール上存在できない不正状態の清掃。
  // leave_field 系置換や魂状態/煌臨元置換で曲げず、常に既定の trash へ流す。
  return pendingLeave.kind !== "rule_cleanup";
}

function getPendingLeaveDeckPosition(
  pendingLeave: PendingLeaveEntity
): "top" | "bottom" | undefined {
  return pendingLeave.leaveDestination?.zone === "deck"
    ? (pendingLeave.leaveDestination.position ?? "bottom")
    : undefined;
}

function applyControllerAfterZoneChange(
  card: CardInstance,
  zone: Zone
): Pick<CardInstance, "controllerPlayerId"> {
  return {
    controllerPlayerId:
      zone === "deck" ? card.ownerPlayerId : card.controllerPlayerId,
  };
}

function reorderDeckCardsForPendingLeaveDestinations(
  cards: CardInstance[],
  deckPositionByMovedId: Map<string, "top" | "bottom">
): CardInstance[] {
  if (deckPositionByMovedId.size === 0) return cards;

  const affectedOwners = new Set<string>();
  for (const card of cards) {
    if (deckPositionByMovedId.has(card.instanceId)) {
      affectedOwners.add(card.ownerPlayerId);
    }
  }
  if (affectedOwners.size === 0) return cards;

  const existingDeckByOwner = new Map<string, CardInstance[]>();
  const topMovedByOwner = new Map<string, CardInstance[]>();
  const bottomMovedByOwner = new Map<string, CardInstance[]>();
  for (const card of cards) {
    if (card.zone !== "deck" || !affectedOwners.has(card.ownerPlayerId)) {
      continue;
    }
    const position = deckPositionByMovedId.get(card.instanceId);
    if (position === "top") {
      const top = topMovedByOwner.get(card.ownerPlayerId) ?? [];
      top.push(card);
      topMovedByOwner.set(card.ownerPlayerId, top);
    } else if (position === "bottom") {
      const bottom = bottomMovedByOwner.get(card.ownerPlayerId) ?? [];
      bottom.push(card);
      bottomMovedByOwner.set(card.ownerPlayerId, bottom);
    } else {
      const existing = existingDeckByOwner.get(card.ownerPlayerId) ?? [];
      existing.push(card);
      existingDeckByOwner.set(card.ownerPlayerId, existing);
    }
  }

  const emittedOwners = new Set<string>();
  const result: CardInstance[] = [];
  const emitOwnerDeck = (ownerPlayerId: string): void => {
    if (emittedOwners.has(ownerPlayerId)) return;
    emittedOwners.add(ownerPlayerId);
    result.push(
      ...(topMovedByOwner.get(ownerPlayerId) ?? []),
      ...(existingDeckByOwner.get(ownerPlayerId) ?? []),
      ...(bottomMovedByOwner.get(ownerPlayerId) ?? [])
    );
  };

  for (const card of cards) {
    if (card.zone === "deck" && affectedOwners.has(card.ownerPlayerId)) {
      emitOwnerDeck(card.ownerPlayerId);
      continue;
    }
    result.push(card);
  }
  for (const ownerPlayerId of affectedOwners) {
    emitOwnerDeck(ownerPlayerId);
  }
  return result;
}

/**
 * 合体スピリット破壊時のブレイヴ選択チェック。
 * ホストがフィールドを離れるとき、合体中のブレイヴがあれば選択待ちを設定し、ホストのフラッシュを保留する。
 */
function checkBraveLeaveChoice(
  state: GameState,
  pendingLeaves: PendingLeaveEntity[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): { state: GameState; excludedInstanceIds: Set<string> } {
  const excludedInstanceIds = new Set<string>();
  let currentState = state;

  if (state.pendingBraveLeaveChoice !== null) {
    // 現在の選択に加え、未選択の他ホストも実移動から除外する。
    excludedInstanceIds.add(state.pendingBraveLeaveChoice.hostInstanceId);
  }

  for (const pendingLeave of pendingLeaves) {
    const host = getCardById(state, pendingLeave.instanceId);
    if (!host || host.attachedChildrenIds.length === 0) continue;

    const soulStateInheritedBraveIds = getCardDefinitionById
      ? getAttachedBravesInheritedInSoulState(
          state,
          pendingLeave,
          host,
          getCardDefinitionById
        )
      : new Set<string>();
    // 重なり内の魂状態化は全選択後に適用するため、継承を選んだ鍵ブレイヴは
    // まだ合体中。ホストの保持が確定していれば同じ継承選択を再提示しない。
    const soulStateInheritanceChoiceIds =
      pendingLeave.soulStateReplacementChoices?.[host.instanceId] === true
        ? []
        : host.attachedChildrenIds.filter((id) =>
            soulStateInheritedBraveIds.has(id)
          );
    const remainingBraveChoiceIds = host.attachedChildrenIds.filter(
      (id) => !soulStateInheritedBraveIds.has(id)
    );
    const braveChoiceIds =
      soulStateInheritanceChoiceIds.length > 0
        ? soulStateInheritanceChoiceIds
        : remainingBraveChoiceIds;
    if (braveChoiceIds.length === 0) continue;

    // 「ブレイヴはフィールドに残せない」: 残存の選択待ちは設けず、ホストをそのまま
    // flush させる。flushPendingLeaves 本体が forceSendBraveDestById マップで
    // ブレイヴをホストと同じ場所へ送る（10_rules/05 選択肢2 強制）。
    if (pendingLeave.forceBraveSendWithHost) continue;

    // 合体中のブレイヴがある → 選択待ちを設定
    excludedInstanceIds.add(pendingLeave.instanceId);
    if (currentState.pendingBraveLeaveChoice !== null) continue;
    currentState = {
      ...state,
      pendingBraveLeaveChoice: {
        choosingPlayerId: host.controllerPlayerId,
        hostInstanceId: host.instanceId,
        braveInstanceIds: braveChoiceIds,
        leaveKind: pendingLeave.kind,
        leaveCause: pendingLeave.cause,
        ...(pendingLeave.leaveDestination
          ? { leaveDestination: pendingLeave.leaveDestination }
          : {}),
        ...(soulStateInheritanceChoiceIds.length > 0
          ? {
              soulStateInheritance: {
                remainingBraveInstanceIds: remainingBraveChoiceIds,
              },
            }
          : {}),
      },
      log: [
        ...state.log,
        `brave-leave-choice:pending:${host.instanceId}:braves:${braveChoiceIds.join(",")}`,
      ],
    };
  }

  return { state: currentState, excludedInstanceIds };
}

function getAttachedBravesInheritedInSoulState(
  state: GameState,
  pendingLeave: PendingLeaveEntity,
  host: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Set<string> {
  if (pendingLeave.soulStateReplacementDeclined) return new Set();
  if (
    !isPendingLeaveEligibleForSoulStateReplacement(state, pendingLeave, host)
  ) {
    return new Set();
  }

  const soulStateIds = new Set(
    expandWithSoulStateInheritingKeyBraves(
      state,
      [host.instanceId],
      getCardDefinitionById
    )
  );
  return new Set(host.attachedChildrenIds.filter((id) => soulStateIds.has(id)));
}

function getSoulStateReplacementInstanceIds(
  state: GameState,
  hostInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  return expandWithSoulStateInheritingKeyBraves(
    state,
    [hostInstanceId],
    getCardDefinitionById
  );
}

function isPendingLeaveCausedByOpponent(
  pendingLeave: PendingLeaveEntity,
  controllerPlayerId: string
): boolean {
  return (
    (pendingLeave.causePlayerId !== null &&
      pendingLeave.causePlayerId !== controllerPlayerId) ||
    pendingLeave.cause === "battle"
  );
}

function isPendingLeaveCausedByOpponentEffect(
  pendingLeave: PendingLeaveEntity,
  controllerPlayerId: string
): boolean {
  return (
    pendingLeave.cause !== "battle" &&
    pendingLeave.cause !== "bp_compare" &&
    pendingLeave.causePlayerId !== null &&
    pendingLeave.causePlayerId !== controllerPlayerId
  );
}

/**
 * `isPendingLeaveCausedByOpponentEffect` の対称形。「自分が〇〇するとき」型の
 * source:"self" 判定 (ENGINE-set-aside-exit-replacement-choice Step1)。
 * battle/bp_compare は対象カードのコントローラー自身の意思による離脱ではないため除外する。
 */
function isPendingLeaveCausedBySelfEffect(
  pendingLeave: PendingLeaveEntity,
  controllerPlayerId: string
): boolean {
  return (
    pendingLeave.cause !== "battle" &&
    pendingLeave.cause !== "bp_compare" &&
    pendingLeave.causePlayerId !== null &&
    pendingLeave.causePlayerId === controllerPlayerId
  );
}

function isPendingLeaveEligibleForSoulStateReplacement(
  state: GameState,
  pendingLeave: PendingLeaveEntity,
  card: CardInstance
): boolean {
  if (!isPendingLeaveEligibleForFieldExitReplacement(pendingLeave)) {
    return false;
  }
  if (
    pendingLeave.soulStateReplacementDeclined &&
    pendingLeave.instanceId === card.instanceId
  )
    return false;
  if (pendingLeave.preventStayOnField) return false;
  if (card.zone !== "field" || card.faceDown) return false;

  const controller = state.players.find(
    (p) => p.id === card.controllerPlayerId
  );

  // (a) 契約カード判定。originalDefinitionId で判定（B面の場合も A面の cardNo で一致）。
  const isContractCard = isPlayersContractCard(
    card,
    controller?.contractCardNo
  );

  // (b) soul_state 置換 CE 判定。advent_source 置換 (checkAdventSourceReplacement) と
  // 同じ replace_field_exit CE 規約。trigger は move_to/advent_source 系と同一。
  let hasSoulStateReplacementCE = false;
  if (!isContractCard) {
    for (const ce of getCEsForTarget(state, card.instanceId)) {
      if (ce.modifierTag !== "replace_field_exit") continue;
      const meta = ce.metadata as
        | {
            trigger?: "leave_field" | "destroy" | "bounce" | "vanish";
            replacement?: { kind?: string };
          }
        | undefined;
      if (meta?.replacement?.kind !== "soul_state") continue;
      const trigger = meta.trigger ?? "leave_field";
      if (trigger !== "leave_field" && trigger !== pendingLeave.kind) continue;
      hasSoulStateReplacementCE = true;
      break;
    }
  }

  if (!isContractCard && !hasSoulStateReplacementCE) return false;
  if (!isPendingLeaveCausedByOpponent(pendingLeave, card.controllerPlayerId)) {
    return false;
  }
  return !(controller?.soulStateInstanceIds.includes(card.instanceId) ?? false);
}

/** 共有煌臨元は最後の重なりが離れるときだけ同行する（08a2 契約・真バディ）。 */
function getLeavingAdventSourceIds(
  state: GameState,
  host: CardInstance,
  leavingInstanceIds: ReadonlySet<string>
): string[] {
  return adventSourceIdsOf(host).filter(
    (sourceId) =>
      !state.cardInstances.some(
        (other) =>
          other.zone === "field" &&
          other.instanceId !== host.instanceId &&
          !leavingInstanceIds.has(other.instanceId) &&
          adventSourceIdsOf(other).includes(sourceId)
      )
  );
}

/**
 * 契約カードの魂状態置換チェック。
 * 相手によってフィールドを離れる契約カードがあれば選択待ちを設定し、そのカードのフラッシュを保留する。
 */
function checkSoulStateReplacement(
  state: GameState,
  pendingLeaves: PendingLeaveEntity[]
): { state: GameState; excludedInstanceIds: Set<string> } {
  const excludedInstanceIds = new Set<string>();
  let currentState = state;
  const leavingInstanceIds = new Set(
    pendingLeaves.map((leave) => leave.instanceId)
  );

  if (state.pendingSoulStateReplacement !== null) {
    // 表示中の1枚に加え、未選択の適格カードもすべて実移動から除外する。
    excludedInstanceIds.add(
      state.pendingSoulStateReplacement.leavingCardInstanceId ??
        state.pendingSoulStateReplacement.cardInstanceId
    );
  }

  for (const pendingLeave of pendingLeaves) {
    const host = getCardById(state, pendingLeave.instanceId);
    if (!host) continue;
    // 公式 Q1505/Q1506: 通常煌臨を含め、煌臨元の契約カードもそれぞれ選択できる。
    const candidates = [
      host.instanceId,
      ...getLeavingAdventSourceIds(state, host, leavingInstanceIds),
    ];
    const card = candidates
      .map((id) => getCardById(state, id))
      .find(
        (candidate) =>
          candidate !== undefined &&
          pendingLeave.soulStateReplacementChoices?.[candidate.instanceId] ===
            undefined &&
          isPendingLeaveEligibleForSoulStateReplacement(
            state,
            pendingLeave,
            candidate
          )
      );
    if (!card) continue;

    // 魂状態置換選択を設定
    excludedInstanceIds.add(pendingLeave.instanceId);
    if (currentState.pendingSoulStateReplacement !== null) continue;
    currentState = {
      ...state,
      pendingSoulStateReplacement: {
        choosingPlayerId: card.controllerPlayerId,
        cardInstanceId: card.instanceId,
        ...(adventSourceIdsOf(host).length > 0
          ? { leavingCardInstanceId: host.instanceId }
          : {}),
        originalLeaveKind: pendingLeave.kind,
        originalLeaveCause: pendingLeave.cause,
      },
      log: [
        ...state.log,
        `soul-state-replacement:pending:${card.instanceId}:${pendingLeave.kind}`,
      ],
    };
  }

  return { state: currentState, excludedInstanceIds };
}

/**
 * 煌臨元への追加置換チェック。
 *
 * `replace_field_exit` CE の `metadata.replacement.kind === "advent_source"` を持つカードが
 * 相手起因でフィールドを離れるとき、`target` フィルタ (例: cardName「水篠 旬」) に一致する
 * 自分のスピリットがいれば、コントローラーに「煌臨元に追加 / トラッシュ」の選択待ちを設定し、
 * 当該カードを通常フラッシュから除外する。一致するスピリットが不在のときは置換不可とし、
 * 何もしない (= 通常通りトラッシュへ流れる)。
 *
 * 08a_advent-rebirth-contract.md L36「フィールド離脱時、煌臨元も全て同じ場所に移動」の逆操作。
 * 選択の解決は `resolveAdventSourceReplacement` で行う (魂状態置換と同じ pending パターン)。
 */
function checkAdventSourceReplacement(
  state: GameState,
  pendingLeaves: PendingLeaveEntity[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): { state: GameState; excludedInstanceIds: Set<string> } {
  const excludedInstanceIds = new Set<string>();
  let currentState = state;

  if (state.pendingAdventSourceReplacement !== null) {
    // 表示中の1枚に加え、未選択の適格カードもすべて実移動から除外する。
    excludedInstanceIds.add(
      state.pendingAdventSourceReplacement.cardInstanceId
    );
  }

  // 定義解決ができないと cardName フィルタを評価できない → 置換不可 (トラッシュへ)。
  if (!getCardDefinitionById) return { state, excludedInstanceIds };

  for (const pl of pendingLeaves) {
    if (!isPendingLeaveEligibleForFieldExitReplacement(pl)) continue;
    // 既に「トラッシュ」を選択済みの離脱は再提示しない (通常トラッシュへ流す)。
    if (pl.adventSourceReplacementDeclined) continue;

    const card = getCardById(state, pl.instanceId);
    if (!card) continue;

    const ces = getCEsForTarget(state, pl.instanceId);
    let matchedAdventSource: {
      target: import("./dsl-types").CardFilter;
    } | null = null;
    for (const ce of ces) {
      if (ce.modifierTag !== "replace_field_exit") continue;
      const meta = ce.metadata as
        | {
            trigger?: "leave_field" | "destroy" | "bounce" | "vanish";
            source?: "opponent_effect" | "opponent" | "all" | "self";
            replacement?: {
              kind?: string;
              target?: import("./dsl-types").CardFilter;
              orTrash?: boolean;
            };
          }
        | undefined;
      if (meta?.replacement?.kind !== "advent_source") continue;
      if (!meta.replacement.target) continue;

      // trigger 条件マッチング (move_to 系と同一規約)。
      const trigger = meta.trigger ?? "leave_field";
      if (trigger !== "leave_field" && trigger !== pl.kind) continue;

      // source 条件マッチング。
      // "opponent_effect" は相手効果限定、"opponent" は「相手によって」= 相手効果 + battle、
      // "self" は「自分が〇〇するとき」= 自分効果限定 (battle/bp_compare 除く)。
      const source = meta.source ?? "all";
      if (source === "opponent_effect") {
        if (
          !isPendingLeaveCausedByOpponentEffect(pl, card.controllerPlayerId)
        ) {
          continue;
        }
      } else if (source === "opponent") {
        if (!isPendingLeaveCausedByOpponent(pl, card.controllerPlayerId)) {
          continue;
        }
      } else if (source === "self") {
        if (!isPendingLeaveCausedBySelfEffect(pl, card.controllerPlayerId)) {
          continue;
        }
      }

      matchedAdventSource = { target: meta.replacement.target };
      break;
    }
    if (!matchedAdventSource) continue;

    const soulStateIds = getEffectiveSoulStateIds(state, getCardDefinitionById);
    const underCardIds = collectUnderCardScopeIds(state);

    // 追加先候補スピリット = コントローラー所有・フィールド・フィルタ一致・離脱中でない。
    // 自身 (離脱カード) は除外。
    const candidateHostInstanceIds: string[] = [];
    for (const candidate of state.cardInstances) {
      if (candidate.instanceId === card.instanceId) continue;
      if (candidate.controllerPlayerId !== card.controllerPlayerId) continue;
      if (candidate.zone !== "field") continue;
      if (candidate.zoneRoleName === "advent-source") continue;
      if (candidate.pendingLeaveKind !== null) continue;
      const def = getCardDefinitionById(candidate.definitionId);
      if (!def) continue;
      if (
        matchesCardFilter(candidate, def, matchedAdventSource.target, {
          state,
          effectiveColors: getEffectiveColors(state, candidate, def),
          effectiveBp: getCombinedUnitBp(
            state,
            candidate,
            def,
            getCardDefinitionById
          ),
          coreCount: getTotalCoresOnCardById(state, candidate.instanceId),
          effectiveLevel: getEffectiveLevel(
            state,
            candidate,
            def,
            getCardDefinitionById
          ),
          soulStateIds,
          underCardIds,
          effectiveSymbolCount: getCombinedUnitSymbolCount(
            state,
            candidate,
            def,
            getCardDefinitionById
          ),
        })
      ) {
        candidateHostInstanceIds.push(candidate.instanceId);
      }
    }

    excludedInstanceIds.add(pl.instanceId);
    if (currentState.pendingAdventSourceReplacement !== null) continue;
    currentState = {
      ...state,
      pendingAdventSourceReplacement: {
        choosingPlayerId: card.controllerPlayerId,
        cardInstanceId: card.instanceId,
        candidateHostInstanceIds,
        originalLeaveKind: pl.kind,
        originalLeaveCause: pl.cause,
      },
      log: [
        ...state.log,
        `advent-source-replacement:pending:${card.instanceId}:${pl.kind}:hosts:${candidateHostInstanceIds.join(",")}`,
      ],
    };
  }

  return { state: currentState, excludedInstanceIds };
}

/**
 * 置換効果によるフィールド離脱の変更チェック。
 * フィールド離脱対象カードに `replace_field_exit` CE がある場合、
 * 離脱原因（destroy/bounce/vanish）と CE の trigger 条件をマッチングし、
 * 一致すれば離脱を代替アクションに置き換える。
 *
 * CE.metadata の構造:
 * - trigger: "leave_field" | "destroy" | "bounce" | "vanish"
 *   - "leave_field" は任意の離脱原因にマッチ、それ以外は同名の kind のみマッチ
 * - source: "opponent_effect" | "opponent" | "all"
 *   - "opponent_effect" は相手効果による離脱のみ発動
 *   - "opponent" は「相手によって」= 相手効果 + battle で発動
 * - replacement: { kind: "move_to", zone: "hand" | "deck_bottom" }
 *
 * 注: 疲労状態でフィールドに残置する挙動は本関数では扱わない。
 *     `stay_on_field` triggered effect 経由で実装されているため、
 *     pending leave に入った *後* に triggered timing で発火する。
 */
function checkFieldExitReplacement(
  state: GameState,
  pendingLeaves: PendingLeaveEntity[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): {
  state: GameState;
  zoneReplacements: Map<string, "hand" | "deck">;
} {
  const zoneReplacements = new Map<string, "hand" | "deck">();

  for (const pl of pendingLeaves) {
    if (!isPendingLeaveEligibleForFieldExitReplacement(pl)) continue;
    const card = getCardById(state, pl.instanceId);
    if (!card) continue;

    // クラス全体対象 (dynamic filter, targetInstanceId 無し) の置換 CE も拾う。
    // 「系統：X を持つ自分のスピリットは〜」型は登録後に場へ出た個体も対象に含むため、
    // targetInstanceId 固定の per-target snapshot だけでは新規召喚カードを追従できない
    // (adversarial verifier 2026-07-30 round1 指摘, BSTH07.8-M01)。
    const globalReplacementCEs = getCardDefinitionById
      ? getGlobalCEs(state).filter(
          (ce) =>
            ce.modifierTag === "replace_field_exit" &&
            matchesEffectResistanceFilter(
              state,
              ce,
              card,
              getCardDefinitionById
            )
        )
      : [];
    const ces = [
      ...getCEsForTarget(state, pl.instanceId),
      ...globalReplacementCEs,
    ];
    for (const ce of ces) {
      if (ce.modifierTag !== "replace_field_exit") continue;
      const meta = ce.metadata as
        | {
            trigger?: "leave_field" | "destroy" | "bounce" | "vanish";
            source?: "opponent_effect" | "opponent" | "all" | "self";
            replacement?: { kind?: string; zone?: "hand" | "deck_bottom" };
          }
        | undefined;
      if (!meta?.replacement) continue;
      // advent_source 系は checkAdventSourceReplacement / pending 経路で処理する。
      // ここ (zone 直接置換) では move_to のみ扱う。
      if (meta.replacement.kind !== "move_to") continue;

      // trigger 条件マッチング
      const trigger = meta.trigger ?? "leave_field";
      const triggerMatches = trigger === "leave_field" || trigger === pl.kind;
      if (!triggerMatches) continue;

      // source 条件マッチング
      const source = meta.source ?? "all";
      if (source === "opponent_effect") {
        // 相手効果による離脱のみ捕捉。battle は含めない。
        if (
          !isPendingLeaveCausedByOpponentEffect(pl, card.controllerPlayerId)
        ) {
          continue;
        }
      } else if (source === "opponent") {
        // 「相手によって」の離脱のみ捕捉。バトル破壊も含む。
        if (!isPendingLeaveCausedByOpponent(pl, card.controllerPlayerId)) {
          continue;
        }
      } else if (source === "self") {
        // 「自分が〇〇するとき」= 自分効果限定 (battle/bp_compare 除く)。
        if (!isPendingLeaveCausedBySelfEffect(pl, card.controllerPlayerId)) {
          continue;
        }
      }

      // 置換アクション適用（kind === "move_to" は上のガードで保証済み）
      const zone = meta.replacement.zone === "hand" ? "hand" : "deck";
      zoneReplacements.set(pl.instanceId, zone);
      break; // 最初にマッチした置換効果を適用
    }
  }

  return { state, zoneReplacements };
}

export function flushPendingLeaves(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourceColors?: readonly CardColor[],
  sourceCategory?: import("./model").CardCategory,
  options?: FlushPendingLeavesOptions
): GameState {
  // P3-74 Phase B: cannot_leave_field 耐性で阻止された entries は zone 移動なしで除去。
  // 破壊判定の成立を内包 conditional_result から参照させた後、副作用 (zone 移動 / event emit) を
  // 起こさずに消す。card.pendingLeaveKind はそもそも set されていないので card 自体の更新は不要。
  // ログ形式は通常の `pending-leave-flushed:` パターンと統一し、blocked 系で接頭辞を揃える。
  let currentStateAfterBlockedCleanup: GameState = state;
  const blockedEntries = state.pendingLeaveEntities.filter(
    (pl) =>
      pl.blockedByResistance === true && isPendingLeaveInFlushScope(pl, options)
  );
  if (blockedEntries.length > 0) {
    currentStateAfterBlockedCleanup = {
      ...state,
      pendingLeaveEntities: state.pendingLeaveEntities.filter(
        (pl) =>
          pl.blockedByResistance !== true ||
          !isPendingLeaveInFlushScope(pl, options)
      ),
      log: [
        ...state.log,
        ...blockedEntries.map(
          (pl) =>
            `pending-leave-blocked-flushed:${pl.kind}:${pl.instanceId}:${pl.chainId}:${pl.cause}`
        ),
      ],
    };
  }

  const flushablePendingLeaves = getFlushablePendingLeaves(
    currentStateAfterBlockedCleanup,
    options
  );

  if (flushablePendingLeaves.length === 0) {
    return currentStateAfterBlockedCleanup;
  }
  state = currentStateAfterBlockedCleanup;

  // 合体スピリット破壊時のブレイヴ選択チェック
  const braveLeaveCheck = checkBraveLeaveChoice(
    state,
    flushablePendingLeaves,
    getCardDefinitionById
  );
  let currentState = braveLeaveCheck.state;
  const excludedByReplacement = braveLeaveCheck.excludedInstanceIds;

  // 契約カードの魂状態置換チェック
  const soulStateCheck = checkSoulStateReplacement(
    currentState,
    flushablePendingLeaves
  );
  currentState = soulStateCheck.state;
  for (const id of soulStateCheck.excludedInstanceIds) {
    excludedByReplacement.add(id);
    if (!getCardDefinitionById) continue;
    for (const inheritedId of getSoulStateReplacementInstanceIds(
      currentState,
      id,
      getCardDefinitionById
    )) {
      excludedByReplacement.add(inheritedId);
    }
  }

  // 煌臨元への追加置換チェック（相手起因離脱→指定スピリットの煌臨元 or トラッシュ選択）
  const adventSourceCheck = checkAdventSourceReplacement(
    currentState,
    flushablePendingLeaves.filter(
      (pl) => !excludedByReplacement.has(pl.instanceId)
    ),
    getCardDefinitionById
  );
  currentState = adventSourceCheck.state;
  for (const id of adventSourceCheck.excludedInstanceIds) {
    excludedByReplacement.add(id);
  }

  // 置換効果チェック（破壊→手札 / デッキ下。疲労残置は stay_on_field triggered で別経路）
  const fieldExitCheck = checkFieldExitReplacement(
    currentState,
    flushablePendingLeaves.filter(
      (pl) => !excludedByReplacement.has(pl.instanceId)
    ),
    getCardDefinitionById
  );
  currentState = fieldExitCheck.state;

  // 魂状態置換で除外されたカードを除いてフラッシュ
  const effectiveFlushable = flushablePendingLeaves.filter(
    (pl) => !excludedByReplacement.has(pl.instanceId)
  );

  if (effectiveFlushable.length === 0) {
    return currentState;
  }

  // 重なり内の全選択が確定してから魂状態を適用する。残りのカードの移動は
  // この flush の共通処理へ流し、契約カード自身の離脱・バーストは発生させない。
  const remainingSoulStateChoice = currentState.pendingSoulStateReplacement;
  for (const leave of effectiveFlushable) {
    for (const [instanceId, keep] of Object.entries(
      leave.soulStateReplacementChoices ?? {}
    )) {
      if (!keep) continue;
      const chosen = getCardById(currentState, instanceId);
      if (!chosen || chosen.zone !== "field") continue;
      if (
        currentState.players.some((player) =>
          player.soulStateInstanceIds.includes(instanceId)
        )
      )
        continue;
      currentState = resolveSoulStateReplacement(
        {
          ...currentState,
          pendingSoulStateReplacement: {
            choosingPlayerId: chosen.controllerPlayerId,
            cardInstanceId: instanceId,
            originalLeaveKind: leave.kind,
            originalLeaveCause: leave.cause,
          },
        },
        true,
        getCardDefinitionById
      );
    }
  }
  currentState = {
    ...currentState,
    pendingSoulStateReplacement: remainingSoulStateChoice,
  };

  const movedInstanceIds = new Set<string>();
  const pendingDeckPositionByMovedId = new Map<string, "top" | "bottom">();
  const pendingLeaveByInstanceId = new Map(
    effectiveFlushable.map((pendingLeave) => [
      pendingLeave.instanceId,
      pendingLeave,
    ])
  );

  // ホスト (pendingLeave 対象) ごとの着地ゾーン: 置換効果優先・無ければ kind の既定値。
  // 合体ブレイヴ / 煌臨元 / クォーツ追従はホストと同じゾーンへ送るため、ここで一括算出する。
  // (Step 2/4: ENGINE-remove-from-game-attached-brave-orphan 段階的着地。
  //  既存の destroy/vanish 既定値は "trash" のままで挙動非変化。
  //  remove_from_game も executeRemoveFromGame の field 対象からここへ流入する。)
  const hostDestZoneByInstanceId = new Map<string, Zone>();
  for (const pendingLeave of effectiveFlushable) {
    const replacementZone = fieldExitCheck.zoneReplacements.get(
      pendingLeave.instanceId
    );
    // トークンカード (keywordTags:"token") はフィールドを離れたらトラッシュ/手札/デッキではなく
    // トークンプール（デッキ外）へ戻る（10_rules/07b §トークンカード、裁定 2026-06-14、
    // engine-token-summon-primitive）。専用 Zone を新設せず、既存の removed_from_game を
    // トークンプールの代替先として再利用する（トークンは executeTokenSummon が毎回新規
    // instance を生成するため、旧 instance が removed_from_game に残っても再召喚可能枚数
    // には影響しない）。置換効果より優先（トークンに advent_source 等の残置置換は想定外）。
    const isTokenLeaving =
      getCardDefinitionById !== undefined &&
      (() => {
        const card = getCardById(currentState, pendingLeave.instanceId);
        const def = card ? getCardDefinitionById(card.definitionId) : undefined;
        return def?.keywordTags?.includes("token") ?? false;
      })();
    const hostDest = isTokenLeaving
      ? "removed_from_game"
      : pendingLeave.adventSourceReplacementDeclined === true
        ? "trash"
        : (replacementZone ?? getPendingLeaveDestinationZone(pendingLeave));
    hostDestZoneByInstanceId.set(pendingLeave.instanceId, hostDest);
    const deckPosition = getPendingLeaveDeckPosition(pendingLeave);
    if (hostDest === "deck" && deckPosition !== undefined) {
      pendingDeckPositionByMovedId.set(pendingLeave.instanceId, deckPosition);
    }
  }

  for (const pendingLeave of effectiveFlushable) {
    let coreOverride = pendingLeave.leaveFieldCoreDestinationOverride ?? null;

    // 創界神/導界者/創界石ネクサス: フィールド離脱時、上のコアはボイドへ（通常ネクサスはリザーブ）
    if (!coreOverride?.normalCoreDestination && getCardDefinitionById) {
      const card = getCardById(currentState, pendingLeave.instanceId);
      if (card) {
        const def = getCardDefinitionById(card.definitionId);
        if (def && hasIndependentCoreManagement(def)) {
          coreOverride = {
            ...coreOverride,
            normalCoreDestination: {
              kind: "void",
              playerId: card.controllerPlayerId,
            },
          };
        }
      }
    }

    currentState = resolveCardLeavesFieldCores(
      currentState,
      pendingLeave.instanceId,
      coreOverride,
      getCardDefinitionById
    );
  }

  // 「この効果でブレイヴはフィールドに残せない」: forceBraveSendWithHost を持つ離脱の
  // ホスト配下ブレイヴは、残存させずホストと同じ場所へ移動させる
  // （10_rules/05 選択肢2 を強制。BSTS01-R03）。ブレイヴ自身のコアはリザーブへ退避する。
  const forceSendBraveDestById = new Map<string, Zone>();
  for (const pendingLeave of effectiveFlushable) {
    if (!pendingLeave.forceBraveSendWithHost) continue;
    const host = getCardById(currentState, pendingLeave.instanceId);
    if (host && host.attachedChildrenIds.length > 0) {
      const hostDest =
        hostDestZoneByInstanceId.get(pendingLeave.instanceId) ??
        getPendingLeaveDestinationZone(pendingLeave);
      const deckPosition = getPendingLeaveDeckPosition(pendingLeave);
      for (const braveId of host.attachedChildrenIds) {
        forceSendBraveDestById.set(braveId, hostDest);
        if (deckPosition !== undefined) {
          pendingDeckPositionByMovedId.set(braveId, deckPosition);
        }
      }
    }
  }
  for (const braveId of forceSendBraveDestById.keys()) {
    currentState = resolveCardLeavesFieldCores(
      currentState,
      braveId,
      null,
      getCardDefinitionById
    );
  }

  // 合体スピリット破壊時: ブレイヴをフィールドに残す（合体リンク解除）。
  // ただし forceBraveSendWithHost のブレイヴは残存させない（上で送り済み）。
  const detachedBraveIds = new Set<string>();
  const detachedBraveHostById = new Map<string, CardInstance>();
  for (const pendingLeave of effectiveFlushable) {
    // 魂状態で残ったホストに合体中の鍵は、確定済みの継承を維持する。
    if (
      pendingLeave.soulStateReplacementChoices?.[pendingLeave.instanceId] ===
      true
    )
      continue;
    const host = getCardById(currentState, pendingLeave.instanceId);
    if (host && host.attachedChildrenIds.length > 0) {
      for (const braveId of host.attachedChildrenIds) {
        if (forceSendBraveDestById.has(braveId)) continue;
        detachedBraveIds.add(braveId);
        detachedBraveHostById.set(braveId, host);
      }
    }
  }

  // 煌臨元カード一括移動: 煌臨中カードがフィールドを離れるとき、煌臨元も全て同じ場所に移動
  // (08a_advent-rebirth-contract.md L36)。
  // 魂状態で残す契約カードは先に参照を解除済み。残りは置換後の host の行き先へ同行する。
  // BSDB01-CX01【真バディ】host 共有分岐構造 (issues/P3-117): 1つの煌臨元 (host) が
  // 複数の現存 top から並行して advent_source 参照されうる (host→A、host→B の分岐)。
  // 今回離脱する top 以外に、その煌臨元をまだ advent_source として参照している現存カード
  // (今回の離脱バッチに含まれないもの) があれば、host は道連れにせず場に残す
  // (host が手放されるのは全ての occupant が離れたときのみ)。通常の単一専有ケースでは
  // 煌臨元を参照する top は常に1枚のみなのでこの判定は常に false となり、既存挙動を
  // 完全に保持する。
  const leavingInstanceIds = new Set(
    effectiveFlushable.map((p) => p.instanceId)
  );
  const adventSourceDestById = new Map<string, Zone>();
  for (const pendingLeave of effectiveFlushable) {
    const host = getCardById(currentState, pendingLeave.instanceId);
    if (host) {
      const hostDest =
        hostDestZoneByInstanceId.get(host.instanceId) ??
        getPendingLeaveDestinationZone(pendingLeave);
      const deckPosition = getPendingLeaveDeckPosition(pendingLeave);
      for (const srcId of getLeavingAdventSourceIds(
        currentState,
        host,
        leavingInstanceIds
      )) {
        adventSourceDestById.set(srcId, hostDest);
        if (deckPosition !== undefined) {
          pendingDeckPositionByMovedId.set(srcId, deckPosition);
        }
      }
    }
  }

  // text_role アンダーカード離脱時処遇: host がフィールドを離れるとき、
  // 【星霊衣】(roleTag="星霊衣") / バレットエディット (roleTag="バレットエディット") は host の行き先が
  // トラッシュ以外（手札/デッキ等）でも常にトラッシュへ破棄する（07b §6 / P3-100 S2、
  // バレットエディットは BSGE01-CX01「フィールドを離れるとき、破棄する」P3-111 S7 同型）。
  // それ以外の text_role roleTag (【アルドノアドライブ】等) は既定で host と同じ場所へ
  // 追従する（07b §6「host離脱時は下のカードも host と同じ場所へ追従（トラッシュ固定では
  // ない）」、engine-aldnoah-drive-under-card-keyword が初出）。host の着地先は
  // `hostDestZoneByInstanceId` (置換効果 zoneReplacements 優先・無ければ kind 既定値、
  // クォーツ host 追従 releaseQuartzOnHostLeave と同じ SSOT) を再利用し、host が
  // replace_field_exit 等でトラッシュ以外へ着地する場合もそちらへ追従させる。
  const starGarmentIdsToDiscard = new Set<string>();
  const textRoleFollowHostDestById = new Map<string, Zone>();
  // ENGINE-x03-cross-zone-aldnoah-drive-transfer: 上記 textRoleFollowHostDestById と同時に、
  // 完全 detach される子カードへ元 host の由来 (実効カード名+roleTag) を記録する
  // (CardInstance.detachedUnderCardOrigin)。host.underCards は detach と同時に空になるため、
  // ここで捕捉しないと detach 後は二度と元 host を辿れない。
  const textRoleOriginById = new Map<
    string,
    { hostCardNameEffective: string; roleTag: string }
  >();
  for (const pendingLeave of effectiveFlushable) {
    const host = getCardById(currentState, pendingLeave.instanceId);
    if (!host) continue;
    // 魂状態で残ったカード自身の下カードは実離脱していないため保持する。
    if (pendingLeave.soulStateReplacementChoices?.[host.instanceId] === true)
      continue;
    const hostDef = getCardDefinitionById?.(host.definitionId);
    // act_as_spirit トークンのカード名固定上書きのみを対象とする限定実装
    // (getEffectiveCardName の完全版は legal-actions-shared.ts 依存で循環 import になるため
    // 呼べない、model.ts CardInstance.detachedUnderCardOrigin docstring 参照)。
    const hostCardNameEffective =
      (host.faceDown
        ? resolveActAsSpiritCardName(currentState, host.instanceId)
        : undefined) ??
      hostDef?.name ??
      "";
    for (const uc of host.underCards) {
      if (uc.role !== "text_role" || uc.roleTag === undefined) continue;
      const roleTag = normalizeUnderCardRoleTag(uc.roleTag);
      if (roleTag === "星霊衣" || roleTag === "バレットエディット") {
        starGarmentIdsToDiscard.add(uc.cardInstanceId);
      } else {
        textRoleFollowHostDestById.set(
          uc.cardInstanceId,
          hostDestZoneByInstanceId.get(pendingLeave.instanceId) ??
            getPendingLeaveDestinationZone(pendingLeave)
        );
        const deckPosition = getPendingLeaveDeckPosition(pendingLeave);
        if (deckPosition !== undefined) {
          pendingDeckPositionByMovedId.set(uc.cardInstanceId, deckPosition);
        }
        textRoleOriginById.set(uc.cardInstanceId, {
          hostCardNameEffective,
          roleTag,
        });
      }
    }
  }

  let updatedCards = currentState.cardInstances.map((card) => {
    // ブレイヴ残存: ホストが破壊されるブレイヴは合体リンクを解除してフィールドに残る
    if (detachedBraveIds.has(card.instanceId)) {
      const separatedBraveExhaustState = resolveSeparatedBraveExhaustState(
        card,
        getCardDefinitionById?.(card.definitionId),
        detachedBraveHostById.get(card.instanceId)
      );
      return {
        ...card,
        attachedToInstanceId: null,
        exhaustState: separatedBraveExhaustState,
        ...(separatedBraveExhaustState === "recovered"
          ? { exhaustedByUnpreventableEffect: false }
          : {}),
      };
    }

    // 「ブレイヴはフィールドに残せない」: ホストと同じ場所へ移動 (置換 or kind 既定)。
    // コアは上で resolveCardLeavesFieldCores によりリザーブへ退避済み。
    const forceSendBraveDest = forceSendBraveDestById.get(card.instanceId);
    if (forceSendBraveDest !== undefined) {
      movedInstanceIds.add(card.instanceId);
      const definitionId =
        card.definitionId !== card.originalDefinitionId
          ? card.originalDefinitionId
          : card.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...card,
          definitionId,
          zone: forceSendBraveDest,
          ...applyControllerAfterZoneChange(card, forceSendBraveDest),
          zoneRoleName: getZoneRoleNameAfterLeave(card),
          pendingLeaveKind: null,
          pendingLeaveCause: null,
          pendingLeaveChainId: null,
          deferZoneMoveUntilChainEnd: false,
          attachedChildrenIds: [],
          attachedToInstanceId: null,
          underCards: [],
        },
        forceSendBraveDest
      );
    }

    // 煌臨元カード一括移動: 煌臨中カードと同じ場所 (置換 or kind 既定) に移動
    const adventSourceDest = adventSourceDestById.get(card.instanceId);
    if (adventSourceDest !== undefined) {
      movedInstanceIds.add(card.instanceId);
      const definitionId =
        card.definitionId !== card.originalDefinitionId
          ? card.originalDefinitionId
          : card.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...card,
          definitionId,
          zone: adventSourceDest,
          ...applyControllerAfterZoneChange(card, adventSourceDest),
          zoneRoleName: getZoneRoleNameAfterLeave(card),
          pendingLeaveKind: null,
          pendingLeaveCause: null,
          pendingLeaveChainId: null,
          deferZoneMoveUntilChainEnd: false,
          attachedChildrenIds: [],
          attachedToInstanceId: null,
          underCards: [],
        },
        adventSourceDest
      );
    }

    // text_role アンダーカード (星霊衣/バレットエディット以外、例: アルドノアドライブ): host と同じ既定
    // ゾーンへ追従。
    const textRoleFollowHostDest = textRoleFollowHostDestById.get(
      card.instanceId
    );
    if (textRoleFollowHostDest !== undefined) {
      movedInstanceIds.add(card.instanceId);
      const definitionId =
        card.definitionId !== card.originalDefinitionId
          ? card.originalDefinitionId
          : card.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...card,
          definitionId,
          zone: textRoleFollowHostDest,
          ...applyControllerAfterZoneChange(card, textRoleFollowHostDest),
          zoneRoleName: getZoneRoleNameAfterLeave(card),
          pendingLeaveKind: null,
          pendingLeaveCause: null,
          pendingLeaveChainId: null,
          deferZoneMoveUntilChainEnd: false,
          attachedChildrenIds: [],
          attachedToInstanceId: null,
          underCards: [],
          detachedUnderCardOrigin:
            textRoleOriginById.get(card.instanceId) ?? null,
        },
        textRoleFollowHostDest
      );
    }

    // 星霊衣 (text_role) アンダーカード: host 離脱で常にトラッシュへ破棄（A面復帰）。
    if (starGarmentIdsToDiscard.has(card.instanceId)) {
      movedInstanceIds.add(card.instanceId);
      const definitionId =
        card.definitionId !== card.originalDefinitionId
          ? card.originalDefinitionId
          : card.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...card,
          definitionId,
          zone: "trash" as const,
          zoneRoleName: getZoneRoleNameAfterLeave(card),
          pendingLeaveKind: null,
          pendingLeaveCause: null,
          pendingLeaveChainId: null,
          deferZoneMoveUntilChainEnd: false,
          attachedChildrenIds: [],
          attachedToInstanceId: null,
          underCards: [],
        },
        "trash"
      );
    }

    const pendingLeave = pendingLeaveByInstanceId.get(card.instanceId);

    if (!pendingLeave || card.pendingLeaveKind === null) {
      // ホスト側の attachedChildrenIds もクリア
      if (
        card.attachedChildrenIds.length > 0 &&
        card.attachedChildrenIds.some((id) => detachedBraveIds.has(id))
      ) {
        return {
          ...card,
          attachedChildrenIds: card.attachedChildrenIds.filter(
            (id) => !detachedBraveIds.has(id)
          ),
        };
      }
      return card;
    }

    movedInstanceIds.add(card.instanceId);

    // 転醒 A 面自動復帰: B 面でフィールドを離れる場合、definitionId を A 面に戻す
    const definitionId =
      card.definitionId !== card.originalDefinitionId
        ? card.originalDefinitionId
        : card.definitionId;

    // 置換効果: 移動先がトラッシュ以外に変更されている場合。
    // 無ければ pendingLeave.kind のデフォルト着地ゾーン (Step 2/4 で SSOT 化)。
    const replacementZone = fieldExitCheck.zoneReplacements.get(
      card.instanceId
    );
    const destZone =
      replacementZone ??
      hostDestZoneByInstanceId.get(card.instanceId) ??
      "trash";

    return applyFaceDownPolicyOnZoneChange(
      {
        ...card,
        definitionId,
        zone: destZone,
        ...applyControllerAfterZoneChange(card, destZone),
        zoneRoleName: getZoneRoleNameAfterLeave(card),
        pendingLeaveKind: null,
        pendingLeaveCause: null,
        pendingLeaveChainId: null,
        deferZoneMoveUntilChainEnd: false,
        attachedChildrenIds: [],
        attachedToInstanceId: null,
        underCards: [],
      },
      destZone
    );
  });

  // An under-card can itself leave the field while its host remains.  Remove
  // the host-side reference after all moves are known so the relationship
  // remains valid regardless of cardInstances iteration order.
  updatedCards = stripUnderCardReferences(updatedCards, movedInstanceIds);

  if (movedInstanceIds.size === 0) {
    return currentState;
  }

  updatedCards = reorderDeckCardsForPendingLeaveDestinations(
    updatedCards,
    pendingDeckPositionByMovedId
  );

  // 魂状態のカードがフィールドを離れた場合、soulStateInstanceIds からも除去
  const updatedPlayers = currentState.players.map((p) => {
    let updated = p;
    const removedSoulIds = p.soulStateInstanceIds.filter((id) =>
      movedInstanceIds.has(id)
    );
    if (removedSoulIds.length > 0) {
      updated = {
        ...updated,
        soulStateInstanceIds: updated.soulStateInstanceIds.filter(
          (id) => !movedInstanceIds.has(id)
        ),
      };
    }
    return updated === p ? p : updated;
  });

  const remainingPendingLeaves = currentState.pendingLeaveEntities.filter(
    (pendingLeave) => !movedInstanceIds.has(pendingLeave.instanceId)
  );

  // 置換効果ログ
  const replacementLogs: string[] = [];
  for (const [id, zone] of fieldExitCheck.zoneReplacements) {
    if (movedInstanceIds.has(id)) {
      replacementLogs.push(`replacement:destroy_to_${zone}:${id}`);
    }
  }

  let result: GameState = replaceCardInstances(
    {
      ...currentState,
      players: updatedPlayers,
      pendingLeaveEntities: remainingPendingLeaves,
      log: [
        ...currentState.log,
        ...[...detachedBraveIds].map(
          (braveId) => `brave:detached:${braveId}:host-destroyed`
        ),
        ...effectiveFlushable
          .filter((pendingLeave) =>
            movedInstanceIds.has(pendingLeave.instanceId)
          )
          .map(
            (pendingLeave) =>
              `pending-leave-flushed:${pendingLeave.kind}:${pendingLeave.instanceId}:${pendingLeave.chainId}:${pendingLeave.cause}`
          ),
        ...replacementLogs,
      ],
    },
    updatedCards
  );

  result = advanceDepartedFieldInstanceGeneration(currentState, result);
  result = normalizeCardStateBattleStatus(result);

  // クォーツ host が離脱したら、セット中クォーツを host と同じ場所へ追従させセット解除する
  // （F2.4b④）。host の destZone は置換先 (zoneReplacements) が最優先で、無ければ
  // pendingLeave.kind の既定値 (Step 2/4 で SSOT 化)。
  for (const hostId of movedInstanceIds) {
    if (!result.quartzSetStates.some((q) => q.hostInstanceId === hostId)) {
      continue;
    }
    const hostDestZone =
      fieldExitCheck.zoneReplacements.get(hostId) ??
      hostDestZoneByInstanceId.get(hostId) ??
      "trash";
    result = releaseQuartzOnHostLeave(result, hostId, hostDestZone);
  }

  // A set quartz can itself leave the field independently of its host (for
  // example, its own effect returns it to hand). The ordinary pending-leave
  // path already moved the card and removed its soul-state reference; clear
  // the stale set binding as well before it can be set to another host.
  const releasedQuartzInstanceIds = new Set(
    [...movedInstanceIds].filter((instanceId) =>
      result.quartzSetStates.some(
        (quartzState) => quartzState.quartzInstanceId === instanceId
      )
    )
  );
  if (releasedQuartzInstanceIds.size > 0) {
    result = {
      ...result,
      quartzSetStates: result.quartzSetStates.filter(
        (quartzState) =>
          !releasedQuartzInstanceIds.has(quartzState.quartzInstanceId)
      ),
      log: [
        ...result.log,
        ...[...releasedQuartzInstanceIds].map(
          (instanceId) => `quartz:release:source_leave:${instanceId}`
        ),
      ],
    };
  }

  // moved_to_trash 自動効果: フィールドからトラッシュに移動したカードを処理
  // (置換効果でトラッシュ以外に移動したカード / remove_from_game 既定で removed_from_game
  //  へ移動したカードは除外)
  if (getCardDefinitionById) {
    const trashMovedIds = [...movedInstanceIds].filter((id) => {
      const card = result.cardInstances.find((c) => c.instanceId === id);
      return card?.zone === "trash";
    });
    result = processMovedToTrashEffects(
      result,
      trashMovedIds,
      getCardDefinitionById,
      {
        sourceColors: sourceColors ?? [],
        ...(sourceCategory ? { sourceCategory } : {}),
        fromZone: "field",
      }
    );
  }

  // 残ったブレイヴは参加可能ならアタック/ブロックを強制継続する。
  // 参加者の除去・攻防不可の判定・空バトル保持は共通処理で確定する。
  if (getCardDefinitionById && movedInstanceIds.size > 0) {
    result = removeBattleEntityMembersAndRecompute(
      result,
      [...movedInstanceIds],
      getCardDefinitionById
    );
  }

  return result;
}

function isContinuableBraveAttackMember(
  state: GameState,
  memberId: string,
  attackState: BattleEntity["attackState"],
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): boolean {
  const card = getCardById(state, memberId);
  return (
    card !== undefined &&
    isCurrentCombatMember(state, { memberInstanceIds: [memberId] }, memberId) &&
    card.pendingLeaveKind === null &&
    card.zoneRoleName === "brave" &&
    !isRuleStrengthBattlePrevented(
      state,
      memberId,
      attackState,
      getCardDefinitionById
    )
  );
}

function getContinuableBraveAttackMemberIds(
  state: GameState,
  memberIds: readonly string[],
  attackState: BattleEntity["attackState"],
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): string[] {
  return memberIds.filter((memberId) =>
    isContinuableBraveAttackMember(
      state,
      memberId,
      attackState,
      getCardDefinitionById
    )
  );
}

/**
 * 魂状態置換の選択を解決する。
 * accept=true: 魂状態に残す（ペンディングリーブをキャンセルし魂状態化）
 * accept=false: 通常通りフィールドを離れる（ペンディングリーブを進行）
 */
export function resolveSoulStateReplacement(
  state: GameState,
  accept: boolean,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingSoulStateReplacement;
  if (!pending) return state;

  const shouldKeep = accept || !!pending.forceKeepDueToSoulStateInheritance;

  if (pending.leavingCardInstanceId !== undefined) {
    // 共有煌臨元の選択は、同じカードを参照する離脱元にも伝える。
    return {
      ...state,
      pendingSoulStateReplacement: null,
      pendingLeaveEntities: state.pendingLeaveEntities.map((leave) =>
        leave.instanceId === pending.leavingCardInstanceId ||
        adventSourceIdsOf(
          getCardById(state, leave.instanceId) ?? { underCards: [] }
        ).includes(pending.cardInstanceId)
          ? {
              ...leave,
              soulStateReplacementChoices: {
                ...leave.soulStateReplacementChoices,
                [pending.cardInstanceId]: shouldKeep,
              },
            }
          : leave
      ),
      log: [
        ...state.log,
        `soul-state-replacement:chosen:${pending.cardInstanceId}:${shouldKeep}`,
      ],
    };
  }

  if (!shouldKeep) {
    // 通常通りフィールドを離れる。pendingLeave は残しつつ declined フラグを立て、
    // 次回 flush で checkSoulStateReplacement が再提示せず通常通り離脱させる
    // (advent_source 置換と同じ無限ループ防止。08a L126)。
    return {
      ...state,
      pendingSoulStateReplacement: null,
      pendingLeaveEntities: state.pendingLeaveEntities.map((pl) =>
        pl.instanceId === pending.cardInstanceId
          ? { ...pl, soulStateReplacementDeclined: true }
          : pl
      ),
      log: [
        ...state.log,
        `soul-state-replacement:declined:${pending.cardInstanceId}`,
      ],
    };
  }

  const card = getCardById(state, pending.cardInstanceId);
  if (!card) {
    return { ...state, pendingSoulStateReplacement: null };
  }

  {
    // 魂状態に残す: ペンディングリーブをキャンセルし、魂状態に移行
    const soulStateIds = getCardDefinitionById
      ? getSoulStateReplacementInstanceIds(
          state,
          pending.cardInstanceId,
          getCardDefinitionById
        )
      : [pending.cardInstanceId];
    const soulStateIdSet = new Set(soulStateIds);
    const totalCoresReturned = state.cardInstances
      .filter((c) => soulStateIdSet.has(c.instanceId))
      .reduce((sum, c) => sum + c.normalCoreCount, 0);
    // 対象カードにソウルコアが乗っていたなら、所有プレイヤーのソウルコアを reserve に戻す
    const soulCoreOwnerId = state.players.find(
      (p) =>
        p.soulCoreLocation?.kind === "card" &&
        soulStateIdSet.has(p.soulCoreLocation.instanceId)
    )?.id;
    const result = replaceCardInstances(
      {
        ...state,
        pendingSoulStateReplacement: null,
        players: state.players.map((p) => {
          if (p.id !== pending.choosingPlayerId) return p;
          return {
            ...p,
            soulStateInstanceIds: [
              ...p.soulStateInstanceIds,
              ...(p.soulStateInstanceIds.includes(pending.cardInstanceId)
                ? []
                : [pending.cardInstanceId]),
            ],
            reserveNormalCoreCount:
              p.reserveNormalCoreCount + totalCoresReturned,
          };
        }),
        pendingLeaveEntities: state.pendingLeaveEntities.filter(
          (pl) => !soulStateIdSet.has(pl.instanceId)
        ),
        // 破壊→魂状態の場合、トラッシュに置かれないため「相手による破壊後」バースト不発動
        pendingBurstChecks: state.pendingBurstChecks.filter(
          (bc) =>
            (bc as { relatedInstanceId?: string }).relatedInstanceId ===
              undefined ||
            !soulStateIdSet.has(
              (bc as { relatedInstanceId?: string }).relatedInstanceId!
            )
        ),
        log: [
          ...state.log,
          `soul-state-replacement:accepted:${pending.cardInstanceId}`,
        ],
      },
      stripUnderCardReferences(
        state.cardInstances.map((c) => {
          if (soulStateIdSet.has(c.instanceId)) {
            return {
              ...resetCardBattleStatus(c),
              normalCoreCount: 0,
              pendingLeaveKind: null,
              pendingLeaveCause: null,
              pendingLeaveChainId: null,
              deferZoneMoveUntilChainEnd: false,
              ...(c.zoneRoleName === "advent-source"
                ? {
                    zoneRoleName:
                      getCardDefinitionById?.(c.definitionId)
                        ?.printedCategory ?? "spirit",
                    attachedToInstanceId: null,
                  }
                : {}),
            };
          }
          return c;
        }),
        new Set(
          soulStateIds.filter(
            (id) => getCardById(state, id)?.zoneRoleName === "advent-source"
          )
        )
      )
    );
    const withGeneration = advanceSoulStateGeneration(
      state,
      result,
      getCardDefinitionById
    );
    const withSoulCore = soulCoreOwnerId
      ? withSoulCoreLocation(withGeneration, soulCoreOwnerId, {
          kind: "reserve",
        })
      : withGeneration;
    if (!getCardDefinitionById) return withSoulCore;
    const withBattleMembersRemoved = removeBattleEntityMembersAndRecompute(
      withSoulCore,
      soulStateIds,
      getCardDefinitionById
    );
    return removeStateInvalidBattleEntityMembersAndRecompute(
      withBattleMembersRemoved,
      getCardDefinitionById
    );
  }
}

/**
 * 手元 (set_aside) カード自己除外の置換選択を解決する
 * (ENGINE-set-aside-exit-replacement-choice、BSTH08.5-M11/X04 正源)。
 *
 * - accept=true かつ replacement.kind==="move_to": 対象カードを replacement.zone
 *   (現状 "hand" のみ) へ移動する。除外は発生しない。
 * - pay_cost は通常の効果コストと同じ原資・制限・実支払いを使う。原資やコア種の
 *   選択が必要なら共通pendingCoreSourceAllocationで待ち、置換queueと本文を保持する。
 *   明示配分は現在の候補で再検証し、不正入力を除外への辞退に読み替えない。
 * - accept=false: 置換を辞退し、通常通り除外する
 *   (`applyNonFieldRemoveFromGameStamp` で `removed_from_game` へ)。
 */
export function resolveSetAsideExitReplacementChoice(
  state: GameState,
  accept: boolean,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  selectedPaymentSources?: readonly CardCostPaymentSource[]
): GameState {
  const pending = state.pendingSetAsideExitReplacementChoice;
  if (!pending) return state;
  const finish = (next: GameState) =>
    advanceSetAsideExitReplacementChoice(
      getCardDefinitionById
        ? recomputeAndRebuildContinuousEffectsForSources(
            next,
            getCardDefinitionById,
            new Set([pending.cardInstanceId])
          )
        : next,
      pending
    );

  const card = getCardById(state, pending.cardInstanceId);
  if (!card || card.zone !== "set_aside") {
    return finish(state);
  }

  if (!accept) {
    const stamped = applyNonFieldRemoveFromGameStamp(state, [card]);
    stamped.log.push(
      `set-aside-exit-replacement:declined:${pending.cardInstanceId}`
    );
    return finish(stamped);
  }

  if (pending.replacement.kind === "pay_cost") {
    const amount = pending.replacement.amount;
    const payerId = card.controllerPlayerId;
    const candidates = getAvailablePayCostCoreSources(
      state,
      payerId,
      getCardDefinitionById ?? (() => undefined)
    );
    if (candidates.reduce((sum, source) => sum + source.available, 0) < amount)
      throw new Error("No legal sources for set-aside exit replacement cost");
    const automatic = getAutomaticNormalCorePaymentSources(
      amount,
      candidates.map((source) => ({ ...source, sourceId: source.instanceId }))
    );
    if (
      selectedPaymentSources === undefined &&
      (automatic === null || automatic.some((source) => source.kind === "card"))
    ) {
      return {
        ...state,
        pendingCoreSourceAllocation: {
          purpose: "set_aside_exit_replacement",
          pendingId: `set-aside-exit-cost-${pending.cardInstanceId}-${pending.continuation?.chainId ?? state.turnNumber}-${state.log.length}`,
          actingPlayerId: payerId,
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          candidates,
          requiredTotal: amount,
          toLocation: { kind: "trash", player: "self" },
          effectTiming: { kind: "continuous" },
        },
      };
    }
    const paymentSources = selectedPaymentSources ?? automatic!;
    if (
      paymentSources.some(
        (source) =>
          !Number.isInteger(source.amount) ||
          source.amount <= 0 ||
          (source.kind === "card" &&
            source.destination !== undefined &&
            source.destination !== "trash")
      ) ||
      paymentSources.reduce((sum, source) => sum + source.amount, 0) !== amount
    )
      throw new Error("Invalid set-aside exit replacement cost allocation");
    // Validate the requested physical kinds for every caller, including direct
    // explicit payments. The shared payment primitive's normal-first fallback
    // must not substitute a soul core for an allocation that selected normal.
    const requestedById = new Map<string, { normal: number; soul: number }>();
    for (const source of paymentSources) {
      const id = source.kind === "reserve" ? "reserve" : source.instanceId;
      const requested = requestedById.get(id) ?? { normal: 0, soul: 0 };
      const soul = Number(source.includeSoulCore === true);
      requestedById.set(id, {
        normal: requested.normal + source.amount - soul,
        soul: requested.soul + soul,
      });
    }
    for (const [id, requested] of requestedById) {
      const available = candidates.find(
        (candidate) => candidate.instanceId === id
      );
      if (
        !available ||
        requested.normal > available.normalAvailable ||
        requested.soul > Number(available.hasSoulCore)
      )
        throw new Error(
          "Replacement allocation exceeds current physical core availability"
        );
    }
    assertPaymentSourcesAreAvailable({
      paymentSources,
      availableReserveCoreAmount:
        candidates.find((source) => source.instanceId === "reserve")
          ?.available ?? 0,
      availableOnBoardCoreSources: candidates
        .filter((source) => source.instanceId !== "reserve")
        .map((source) => {
          const payingCard = getCardById(state, source.instanceId)!;
          return {
            kind: "card" as const,
            instanceId: source.instanceId,
            definitionId: payingCard.definitionId,
            zoneRoleName: payingCard.zoneRoleName,
            availableCoreAmount: source.available,
            soulCoreAvailable: source.hasSoulCore,
          };
        }),
    });
    const paid = applyCardCostPayments({
      state: { ...state, pendingSetAsideExitReplacementChoice: null },
      actingPlayerId: payerId,
      chainId: `${pending.continuation?.chainId ?? "set-aside-exit"}:pay-cost:${card.instanceId}`,
      paymentSources,
      causedByEffectSourceInstanceId: card.instanceId,
      getCardDefinitionById,
    });
    paid.log.push(
      `set-aside-exit-replacement:accepted:paid-cost:${pending.cardInstanceId}:${amount}`
    );
    return finish(paid);
  }

  let next = moveCardZone(
    { ...state, pendingSetAsideExitReplacementChoice: null },
    card.instanceId,
    pending.replacement.zone
  );
  next.log.push(
    `set-aside-exit-replacement:accepted:${pending.cardInstanceId}:to:${pending.replacement.zone}`
  );
  if (card.normalCoreCount > 0) {
    next = updateCard(next, card.instanceId, (c) => ({
      ...c,
      normalCoreCount: 0,
    }));
    next = updatePlayer(next, card.controllerPlayerId, (p) => ({
      ...p,
      reserveNormalCoreCount: p.reserveNormalCoreCount + card.normalCoreCount,
    }));
  }
  return finish(next);
}

/**
 * 煌臨元への追加置換の選択を解決する。
 *
 * - choice="trash": 煌臨元への追加を辞退。pendingLeave はそのまま残り、次回
 *   `flushPendingLeaves` で通常通りトラッシュへ流れる (魂状態 decline と同じ挙動)。
 * - choice="advent_source": `hostInstanceId` で指定したスピリットの煌臨元に追加する。
 *   コアはリザーブへ退避し、pendingLeave を除去。トラッシュに置かれないため
 *   「相手による破壊後」系バーストは不発動 (関連 burst check を除去)。
 *
 * `hostInstanceId` は pending の候補リストに含まれていなければならない。不正な host や
 * choice="advent_source" で host 未指定の場合は安全側に倒してトラッシュ扱い (pending 解除のみ)。
 *
 * 08a_advent-rebirth-contract.md L36「フィールド離脱時、煌臨元も全て同じ場所に移動」の逆操作。
 */
export function resolveAdventSourceReplacement(
  state: GameState,
  choice: "advent_source" | "trash",
  hostInstanceId?: string
): GameState {
  const pending = state.pendingAdventSourceReplacement;
  if (!pending) return state;

  const validHost =
    choice === "advent_source" &&
    hostInstanceId !== undefined &&
    pending.candidateHostInstanceIds.includes(hostInstanceId);

  if (!validHost) {
    // トラッシュ選択 (または不正 host)。pendingLeave は残しつつ declined フラグを立て、
    // 次回 flush で再提示されずにトラッシュへ流れるようにする。
    // 元の離脱種別が remove_from_game 等でも、印字の「トラッシュに置く」を優先する。
    return {
      ...state,
      pendingAdventSourceReplacement: null,
      pendingLeaveEntities: state.pendingLeaveEntities.map((pl) =>
        pl.instanceId === pending.cardInstanceId
          ? {
              ...pl,
              adventSourceReplacementDeclined: true,
            }
          : pl
      ),
      log: [
        ...state.log,
        `advent-source-replacement:trash:${pending.cardInstanceId}`,
      ],
    };
  }

  // コアをリザーブへ退避 (フィールド離脱の共通プリミティブを経由)。
  let next = resolveCardLeavesFieldCores(state, pending.cardInstanceId, null);

  // 煌臨元として配置 (advent-system の SSOT 入口)。
  const attached = attachAsAdventSource(
    next,
    pending.cardInstanceId,
    hostInstanceId
  );
  if (!attached) {
    // host が消えている等で配置不可 → トラッシュ扱い (pendingLeave を残す)。
    return {
      ...next,
      pendingAdventSourceReplacement: null,
      pendingLeaveEntities: next.pendingLeaveEntities.map((pl) =>
        pl.instanceId === pending.cardInstanceId
          ? {
              ...pl,
              adventSourceReplacementDeclined: true,
            }
          : pl
      ),
      log: [
        ...next.log,
        `advent-source-replacement:trash-fallback:${pending.cardInstanceId}`,
      ],
    };
  }
  next = attached;

  return {
    ...next,
    pendingAdventSourceReplacement: null,
    pendingLeaveEntities: next.pendingLeaveEntities.filter(
      (pl) => pl.instanceId !== pending.cardInstanceId
    ),
    // トラッシュに置かれないため「相手による破壊後」系バーストは不発動。
    pendingBurstChecks: next.pendingBurstChecks.filter(
      (bc) =>
        (bc as { relatedInstanceId?: string }).relatedInstanceId ===
          undefined ||
        (bc as { relatedInstanceId?: string }).relatedInstanceId !==
          pending.cardInstanceId
    ),
    log: [
      ...next.log,
      `advent-source-replacement:attached:${pending.cardInstanceId}:host:${hostInstanceId}`,
    ],
  };
}

/**
 * 合体スピリット破壊時のブレイヴ選択を解決する。
 * choice="keep": ブレイヴをフィールドに残す（ホストのみフラッシュ）
 * choice="send_with_host": ブレイヴもホストと同じ場所へ移動
 * choice="inherit_soul_state": 鍵ブレイヴを合体状態のまま魂状態へ引き継ぐ
 * coreDistribution: "keep" 時に GUI から指定されたコア補填（ソース別）
 */
export function resolveBraveLeaveChoice(
  state: GameState,
  choice: "keep" | "send_with_host" | "inherit_soul_state",
  coreDistribution?: Record<string, number>,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingBraveLeaveChoice;
  if (!pending) return state;

  const nextPending = getNextBraveLeaveChoiceAfterCurrent(pending);

  if (choice === "inherit_soul_state") {
    return {
      ...state,
      pendingBraveLeaveChoice: nextPending,
      pendingSoulStateReplacement:
        state.pendingSoulStateReplacement?.cardInstanceId ===
        pending.hostInstanceId
          ? {
              ...state.pendingSoulStateReplacement,
              forceKeepDueToSoulStateInheritance: {
                braveInstanceIds: [
                  ...pending.braveInstanceIds,
                  ...(state.pendingSoulStateReplacement
                    .forceKeepDueToSoulStateInheritance?.braveInstanceIds ??
                    []),
                ],
              },
            }
          : state.pendingSoulStateReplacement,
      log: [
        ...state.log,
        `brave-leave-choice:inherit_soul_state:${pending.hostInstanceId}:braves:${pending.braveInstanceIds.join(",")}`,
      ],
    };
  }

  if (choice === "keep") {
    const host = getCardById(state, pending.hostInstanceId);
    const hostBeforeSeparation =
      host && pending.hostExhaustState !== undefined
        ? { ...host, exhaustState: pending.hostExhaustState }
        : host;
    // ブレイヴをフィールドに残す: 合体リンクを事前に解除して
    // 次回 flushPendingLeaves で再度 checkBraveLeaveChoice がトリガーされないようにする
    // GUI 指定のコア補填があれば適用
    let nextState: GameState = replaceCardInstances(
      {
        ...state,
        pendingBraveLeaveChoice: nextPending,
        log: [
          ...state.log,
          `brave-leave-choice:keep:${pending.hostInstanceId}:braves:${pending.braveInstanceIds.join(",")}`,
        ],
      },
      state.cardInstances.map((c) => {
        if (c.instanceId === pending.hostInstanceId) {
          return {
            ...c,
            attachedChildrenIds: c.attachedChildrenIds.filter(
              (id) => !pending.braveInstanceIds.includes(id)
            ),
          };
        }
        if (pending.braveInstanceIds.includes(c.instanceId)) {
          const separatedBraveExhaustState = resolveSeparatedBraveExhaustState(
            c,
            getCardDefinitionById?.(c.definitionId),
            hostBeforeSeparation
          );
          return {
            ...c,
            attachedToInstanceId: null,
            exhaustState: separatedBraveExhaustState,
            ...(separatedBraveExhaustState === "recovered"
              ? { exhaustedByUnpreventableEffect: false }
              : {}),
          };
        }
        return c;
      })
    );

    if (coreDistribution && Object.keys(coreDistribution).length > 0) {
      for (const braveId of pending.braveInstanceIds) {
        for (const [sourceId, amount] of Object.entries(coreDistribution)) {
          if (amount <= 0) continue;
          const from =
            sourceId === "reserve"
              ? ({
                  kind: "reserve" as const,
                  playerId: pending.choosingPlayerId,
                } as const)
              : ({ kind: "card" as const, instanceId: sourceId } as const);
          nextState = moveNormalCores(
            nextState,
            from,
            { kind: "card", instanceId: braveId },
            amount,
            getCardDefinitionById
          );
        }
      }
    }

    return nextState;
  }

  // 同行ブレイヴはホストと同じ離脱チェーンで確定する。魂状態選択が
  // 続いても、最後の選択後に同じ flush 範囲で移動する。
  const hostLeave = state.pendingLeaveEntities.find(
    (leave) => leave.instanceId === pending.hostInstanceId
  );
  const chainId =
    hostLeave?.chainId ?? `brave-leave-with-host-${pending.hostInstanceId}`;
  const newPendingLeaves = pending.braveInstanceIds.map((braveId) => ({
    instanceId: braveId,
    kind: pending.leaveKind,
    cause: pending.leaveCause,
    causePlayerId: null,
    chainId,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
    ...(pending.leaveDestination
      ? { leaveDestination: pending.leaveDestination }
      : {}),
  }));

  // ブレイヴの合体リンクを解除（選択対象のみ host から外す）
  const updatedCards = state.cardInstances.map((c) => {
    if (c.instanceId === pending.hostInstanceId) {
      return {
        ...c,
        attachedChildrenIds: c.attachedChildrenIds.filter(
          (id) => !pending.braveInstanceIds.includes(id)
        ),
      };
    }
    if (pending.braveInstanceIds.includes(c.instanceId)) {
      return {
        ...c,
        attachedToInstanceId: null,
        pendingLeaveKind: pending.leaveKind,
        pendingLeaveCause: pending.leaveCause,
        pendingLeaveChainId: chainId,
        deferZoneMoveUntilChainEnd: false,
      };
    }
    return c;
  });

  return replaceCardInstances(
    {
      ...state,
      pendingBraveLeaveChoice: nextPending,
      pendingLeaveEntities: [
        ...state.pendingLeaveEntities,
        ...newPendingLeaves,
      ],
      log: [
        ...state.log,
        `brave-leave-choice:send_with_host:${pending.hostInstanceId}:braves:${pending.braveInstanceIds.join(",")}`,
      ],
    },
    updatedCards
  );
}

function getNextBraveLeaveChoiceAfterCurrent(
  pending: NonNullable<GameState["pendingBraveLeaveChoice"]>
): GameState["pendingBraveLeaveChoice"] {
  const remainingBraveInstanceIds =
    pending.soulStateInheritance?.remainingBraveInstanceIds ?? [];
  if (remainingBraveInstanceIds.length === 0) return null;
  return {
    choosingPlayerId: pending.choosingPlayerId,
    hostInstanceId: pending.hostInstanceId,
    braveInstanceIds: remainingBraveInstanceIds,
    ...(pending.hostExhaustState !== undefined
      ? { hostExhaustState: pending.hostExhaustState }
      : {}),
    leaveKind: pending.leaveKind,
    leaveCause: pending.leaveCause,
    ...(pending.leaveDestination
      ? { leaveDestination: pending.leaveDestination }
      : {}),
  };
}

/**
 * @deprecated 旧スナップショット/棋譜の継続選択を再生する互換処理。新規対戦では呼ばない。
 * choice="continue": ブレイヴ単体でアタック継続（エンティティの memberInstanceIds を更新）
 * choice="end_attack": ブレイヴの参加を終了（成立済みバトルは継続）
 */
export function resolveBraveAttackContinuation(
  state: GameState,
  choice: "continue" | "end_attack",
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingBraveAttackContinuation;
  if (!pending) return state;

  const entity = state.battleEntities.find(
    (e) => e.entityId === pending.entityId
  );
  const endAttack = (reason: "end" | "blocked"): GameState =>
    removeBattleEntityMembersAndRecompute(
      {
        ...state,
        pendingBraveAttackContinuation: null,
        log: [
          ...state.log,
          `brave-attack-continuation:${reason}:${pending.entityId}`,
        ],
      },
      entity?.memberInstanceIds ?? [],
      getCardDefinitionById ?? (() => undefined)
    );

  if (choice === "end_attack") {
    return endAttack("end");
  }

  const continuableBraves = getContinuableBraveAttackMemberIds(
    state,
    pending.braveInstanceIds,
    entity?.attackState ?? "attacking",
    getCardDefinitionById
  );

  if (continuableBraves.length === 0) {
    return endAttack("blocked");
  }

  if (!entity) {
    return endAttack("blocked");
  }

  // continue: エンティティの memberInstanceIds をブレイヴだけに絞る
  return {
    ...state,
    pendingBraveAttackContinuation: null,
    battleEntities: state.battleEntities.map((e) =>
      e.entityId === pending.entityId
        ? { ...e, memberInstanceIds: [...continuableBraves] }
        : e
    ),
    log: [
      ...state.log,
      `brave-attack-continuation:continue:${pending.entityId}:braves:${continuableBraves.join(",")}`,
    ],
  };
}
