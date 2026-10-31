import { getExtendedFieldSymbolSourceCards } from "../card/field-symbol-source-extension";
import { isCardInEffectZone } from "../effect/card-access-rules";
import { createStepExecutionContext } from "../step-execution-context";
import {
  continuousEffectReadInputState,
  memoizeContinuousEffectRead,
} from "../effect/continuous-effect-read";
import { getPrintedSymbolEntries } from "../model";
import { effectIncludesSoulState } from "../effect/effect-label-utils";
import { deriveSuppressionEffectDescriptor } from "../effect/structured-effect-registrations";
import { getCardById } from "../card/card-lookup";
import {
  getAdditionalCosts,
  getSelfCountThresholdValue,
  matchesCardFilter,
  matchesCardReferenceFilter,
  matchesCardFilterByDef,
  matchesCardName,
  matchesTribes,
  resolveDynamicThresholdsInFilter,
  resolveTribesMatchRefFilter,
  shouldExcludeAttachedCombinedChildForFieldCategoryFilter,
  tribeContainsExcludedSubstring,
} from "../card/card-filter";
import {
  getCEsForTarget,
  getGlobalCEs,
  isCEActiveForScope,
  isTimingScopeActive,
} from "../card/ce-lookup";
import {
  applyEffectParamOverridesToFilter,
  deriveEffectParamOverrideClass,
  type EffectParamOverrideClass,
} from "../effect/effect-param-override";
import { evaluateEffectApplicabilityForCard } from "../effect/effect-applicability-core";
import { getEffectiveDuration } from "../effect/duration-override";
import {
  getAvailableLifeCoreMoveChoices,
  getPlayerLifeCoreCount,
  getPlayerReserveCoreCount,
  getPlayerTrashCoreCount,
  getTotalCoresOnCardById,
  isSoulCoreOn,
} from "../core/core-system";
import { canMoveNormalCoresFrom } from "../core/core-movability";
import { calculateReduction } from "../core/cost-system";
import {
  isContinuousEffectStillValid,
  resolveProvenanceEffectForTiming,
} from "../effect/continuous-effect-rebuild";
import {
  resolveCardImmunityAffect,
  resolveCardImmunityAffectDecisions,
} from "../effect/effect-affect-adapter";
import { isCardRecoveryRestricted } from "../effect/recovery-restriction";
import {
  resolveAffectSourceIdentity,
  type ResolvedAffectSourceIdentity,
} from "../effect/effect-source-identity";
import { canSourceBypassResistanceCE } from "../effect/effect-resistance-check";
import {
  getEffectiveCategories,
  getEffectiveCategory,
  getEffectiveTribe,
  hasCannotCombineRestriction,
  resolveActAsSpiritBp,
  resolveActAsSpiritCardName,
  resolveActAsSpiritColors,
  resolveActAsSpiritCost,
} from "../mechanics/act-as-spirit";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import {
  getVirtualCombinedBraveBpPlusTotal,
  getVirtualCombinedBraveCostTotal,
  getVirtualCombinedBraveLimitCount,
  getVirtualCombinedBraves,
  isEffectivelyCombined,
} from "../mechanics/virtual-combine";
import type {
  ActiveStack,
  BraveCondition,
  CardCategory,
  CardColor,
  CardDefinition,
  CardInstance,
  Condition,
  ContinuousEffect,
  ContinuousEffectTag,
  Duration,
  EffectCategory,
  EffectExecutionMode,
  EffectForceLevel,
  EffectPreventionLevel,
  EffectReevaluationCheckKind,
  EffectReevaluationFailurePolicy,
  EffectReevaluationPoint,
  EffectReevaluationTiming,
  EffectUsageLimit,
  EffectUsageLimitDuration,
  EffectUsageRecord,
  GameState,
  LifeCoreDestination,
  LifeCoreKind,
  NormalCoreContainer,
  Step,
  SuppressionEffectDescriptor,
  SymbolColor,
  TenshoSummon,
  Zone,
} from "../model";
import {
  grandwalkerKindMatches,
  hasEnterFieldOnlyCorePlacementRestriction,
  immuneProtectedCount,
  isGrandwalkerOrGuidedNexus,
  isCardInSetState,
  isCardTextCardState,
  normalizeAsColors,
  collectUnderCardScopeIds,
  textRoleUnderCardIdsOf,
} from "../model";
import type {
  ApplicabilityZone,
  CardFilter,
  CountBound,
  CoreLocation,
  DSL,
  DynamicCount,
  DynamicCountSource,
  Effect,
  EffectTargetFilter,
} from "../dsl-types";
import {
  assertPaymentSourcesAreAvailable,
  assertReserveOrOnBoardExclusivePaymentSources,
  type CardCostPaymentSource,
} from "../core/payment-system";
import { filterTargetCardInstanceIdsByEffectFilter } from "../state-based-actions";
import {
  cardTargetRef,
  matchesEffectSourceFilter,
  mergeTargetLockBypassProfiles,
  normalizePreventionProfile,
  resolveTargetAcquisition,
} from "../effect/target-affect-gate";
import type {
  EffectSourceFilter,
  EffectSourceContext,
  EffectSourceIdentity,
  EffectResistanceSourceScope,
  PreventionProfile,
  TargetAcquireContext,
  TargetAcquisitionGate,
  TargetLockBypassProfile,
} from "../effect/target-affect-gate";
import type {
  LegalActionTargetMode,
  LegalActionTargetGroup,
  UseAccelLegalAction,
  UseChangeLegalAction,
  UseMagicLegalAction,
  PlaceNexusLegalAction,
  RegisteredEffectLifeCoreChoice,
  RegisteredTargetGroup,
  RegisteredTargetedEffectActionBase,
  SummonLegalAction,
} from "./legal-actions-types";
import {
  hasOpenTextRoleUnderCardSlot,
  isStarGarmentTargetEligible,
} from "../mechanics/star-garment-utils";
import { hasPendingBattleEndFinalizeBlockers } from "../battle/battle-end-finalize-blockers";
// 循環依存メモ: battle-shared.ts は本ファイルから getEffectiveBp/getSymbolAdditions/
// getOverriddenProperties を import し、本ファイルは battle-shared.ts から
// getCombinedUnitSymbolCount を import する。ESM の cycle hoisting で fn 内参照は
// 解決時 (実行時) に bind されるため、module top-level で評価しなければ問題なし。
import {
  getCombinedUnitSymbolCount,
  getCombinedUnitSymbols,
  getEffectiveLevel,
  getEffectiveLevelExcludingGlobalOverrideProperties,
} from "../battle/battle-shared";
import { isCombinedBrave } from "../mechanics/virtual-combine";

function readBpModifyPreventionLevel(
  ce: ContinuousEffect
): EffectPreventionLevel {
  const value = ce.metadata?.bpModifySourcePreventionLevel;
  return value === "unpreventable" ? "unpreventable" : "none";
}

function readBpModifyTargetLockBypass(
  ce: ContinuousEffect
): TargetLockBypassProfile {
  return (
    readTargetLockBypassProfile(
      ce.metadata?.bpModifySourceTargetLockBypass
    ) ?? {
      kind: "none",
    }
  );
}

function readBpModifyPreventionBypass(
  ce: ContinuousEffect
): TargetLockBypassProfile | undefined {
  return readTargetLockBypassProfile(
    ce.metadata?.bpModifySourcePreventionBypass
  );
}

function readOverridePropertiesPreventionLevel(
  ce: ContinuousEffect
): EffectPreventionLevel {
  const value = ce.metadata?.overridePropertiesSourcePreventionLevel;
  return value === "unpreventable" ? "unpreventable" : "none";
}

function readOverridePropertiesTargetLockBypass(
  ce: ContinuousEffect
): TargetLockBypassProfile {
  return (
    readTargetLockBypassProfile(
      ce.metadata?.overridePropertiesSourceTargetLockBypass
    ) ?? {
      kind: "none",
    }
  );
}

function readOverridePropertiesPreventionBypass(
  ce: ContinuousEffect
): TargetLockBypassProfile | undefined {
  return readTargetLockBypassProfile(
    ce.metadata?.overridePropertiesSourcePreventionBypass
  );
}

function readOverridePropertiesEffectSourceInstanceId(
  ce: ContinuousEffect
): string {
  const value = ce.metadata?.overridePropertiesEffectSourceInstanceId;
  return typeof value === "string"
    ? value
    : (ce.provenance?.effectSourceInstanceId ?? ce.sourceInstanceId);
}

function readOverridePropertiesEffectSourceDefinitionId(
  ce: ContinuousEffect
): string {
  const value = ce.metadata?.overridePropertiesEffectSourceDefinitionId;
  return typeof value === "string"
    ? value
    : (ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId);
}

function readTargetLockBypassProfile(
  value: unknown
): TargetLockBypassProfile | undefined {
  const kind =
    typeof value === "object" && value !== null && "kind" in value
      ? (value as { kind?: unknown }).kind
      : undefined;
  if (
    kind === "none" ||
    kind === "all_effects" ||
    kind === "blanket_affect_immunity" ||
    kind === "preventing_effect_filter" ||
    kind === "any_preventing_effect_filter"
  ) {
    return value as TargetLockBypassProfile;
  }
  return undefined;
}

interface TargetSelectableLegalAction {
  actionId: string;
  targetMode: LegalActionTargetMode;
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  candidateTargetInstanceIds: string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  allowDuplicateTargets?: boolean;
}

interface LifeCoreSelectableLegalAction {
  actionId: string;
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
}

export function getEffectExecutionMode(registration: {
  executionMode?: EffectExecutionMode;
}): EffectExecutionMode {
  return registration.executionMode ?? "mandatory";
}

/**
 * 登録から effectCategory を取得する。明示指定があればそれを返し、
 * なければ defaultCategory を返す。
 * 呼び出し側で登録型に応じた defaultCategory を渡すことを想定:
 *   RegisteredTriggeredEffectAction / RegisteredBurstAction → "triggered"
 *   RegisteredMagicAction / RegisteredHandCardEffectAction → "activated"
 *   RegisteredFieldCardEffectAction → "activated"
 *   RegisteredBattleImmediateEffectAction → "triggered"
 */
export function getEffectCategory(
  registration: { effectCategory?: EffectCategory },
  defaultCategory: EffectCategory
): EffectCategory {
  return registration.effectCategory ?? defaultCategory;
}

export function getEffectForceLevel(registration: {
  forceLevel?: EffectForceLevel;
}): EffectForceLevel {
  return registration.forceLevel ?? "normal";
}

const FORCE_LEVEL_RANK: Record<EffectForceLevel, number> = {
  prohibition: 2,
  obligation: 1,
  normal: 0,
};

/**
 * 2 つの効果の forceLevel を比較する。
 * 戻り値:
 *   正数 → a が優先、負数 → b が優先、0 → 同格。
 */
export function compareForceLevel(
  a: EffectForceLevel,
  b: EffectForceLevel
): number {
  return FORCE_LEVEL_RANK[a] - FORCE_LEVEL_RANK[b];
}

/**
 * 対象カードの active CE に、同じ modifierTag で より高い forceLevel を持つ
 * 効果が存在する場合、ブロック理由を返す。存在しなければ null。
 *
 * 例: target に prohibition-level の "bp_modifier" CE がある場合、
 * normal-level の "bp_modifier" 効果は blocked_by_force:prohibition を返す。
 */
export function getForceBlockReasonForTag(
  state: GameState,
  targetInstanceId: string,
  modifierTag: string,
  effectForceLevel: EffectForceLevel
): string | null {
  for (const ce of getCEsForTarget(state, targetInstanceId)) {
    if (ce.modifierTag !== modifierTag) continue;
    const ceForceLevel = ce.forceLevel ?? "normal";
    if (compareForceLevel(ceForceLevel, effectForceLevel) > 0) {
      return `blocked_by_force:${ceForceLevel}`;
    }
  }
  return null;
}

export function getEffectPreventionLevel(registration: {
  preventionLevel?: EffectPreventionLevel;
}): EffectPreventionLevel {
  return registration.preventionLevel ?? "none";
}

/**
 * Effect DSL の防止レベル producer の SSOT 導出。明示 `preventionLevel` を最優先する。
 * 限定的防止不可 `preventionRestriction` は sourcePreventionBypass 側で scoped 判定するため、
 * ここでは blanket `"unpreventable"` に昇格させない。未指定は `undefined`。
 */
export function derivePreventionLevel(effect: {
  preventionLevel?: EffectPreventionLevel;
  preventionRestriction?: unknown;
}): EffectPreventionLevel | undefined {
  if (effect.preventionLevel !== undefined) return effect.preventionLevel;
  return undefined;
}

interface PreventionRestrictionLike {
  onlyPreventableByColors?: CardColor[];
  onlyPreventableByCategories?: CardCategory[];
  onlyPreventableByTribes?: string[];
  onlyPreventableByKeywords?: string[];
  notPreventableByColors?: CardColor[];
  notPreventableByCategories?: CardCategory[];
  notPreventableByTribes?: string[];
  notPreventableByKeywords?: string[];
  colorMatchMode?: "exact" | "includes";
}

function deriveTargetLockBypassFromPreventionRestriction(
  restriction: unknown
): TargetLockBypassProfile | undefined {
  if (restriction === undefined || restriction === null) return undefined;
  if (typeof restriction !== "object") return undefined;

  const r = restriction as PreventionRestrictionLike;
  const filters: EffectSourceFilter[] = [];
  const onlyFilter: EffectSourceFilter = {};
  if (r.onlyPreventableByColors?.length) {
    onlyFilter.colors = [...r.onlyPreventableByColors];
  }
  if (r.onlyPreventableByCategories?.length) {
    onlyFilter.categories = [...r.onlyPreventableByCategories];
  }
  if (r.onlyPreventableByTribes?.length) {
    onlyFilter.tribes = [...r.onlyPreventableByTribes];
  }
  if (r.onlyPreventableByKeywords?.length) {
    onlyFilter.keywords = [...r.onlyPreventableByKeywords];
  }
  if (r.colorMatchMode !== undefined) {
    onlyFilter.colorMatchMode = r.colorMatchMode;
  }
  if (Object.keys(onlyFilter).length > 0) {
    filters.push({ ...onlyFilter, bypassUnlessMatches: true });
  }

  if (r.notPreventableByColors?.length) {
    filters.push({
      colors: [...r.notPreventableByColors],
      ...(r.colorMatchMode !== undefined
        ? { colorMatchMode: r.colorMatchMode }
        : {}),
    });
  }
  if (r.notPreventableByCategories?.length) {
    filters.push({ categories: [...r.notPreventableByCategories] });
  }
  if (r.notPreventableByTribes?.length) {
    filters.push({ tribes: [...r.notPreventableByTribes] });
  }
  if (r.notPreventableByKeywords?.length) {
    filters.push({ keywords: [...r.notPreventableByKeywords] });
  }

  if (filters.length === 0) return undefined;
  if (filters.length === 1) {
    return { kind: "preventing_effect_filter", filter: filters[0]! };
  }
  return { kind: "any_preventing_effect_filter", filters };
}

/**
 * P3-105: `derivePreventionLevel` の上位互換 profile。
 *
 * 既存 `EffectPreventionLevel` は cannot_* / defense_immune 等の affect resistance
 * 貫通だけを表し、`対象にできない/含めない` target lock の貫通は別軸
 * `targetLockBypass` に分ける。
 */
export function derivePreventionProfile(effect: {
  preventionLevel?: EffectPreventionLevel;
  preventionRestriction?: unknown;
  targetLockBypass?: TargetLockBypassProfile;
}): PreventionProfile | undefined {
  const resistance = derivePreventionLevel(effect);
  const restrictionBypass = deriveTargetLockBypassFromPreventionRestriction(
    effect.preventionRestriction
  );
  const bypass = effect.targetLockBypass ?? restrictionBypass;
  if (resistance === undefined && bypass === undefined) {
    return undefined;
  }
  const impliedResistance =
    effect.targetLockBypass !== undefined &&
    bypass !== undefined &&
    bypass.kind !== "none"
      ? "unpreventable"
      : "none";
  return normalizePreventionProfile({
    resistance: resistance ?? impliedResistance,
    ...(bypass !== undefined ? { targetLockBypass: bypass } : {}),
  });
}

const PREVENTION_LEVEL_RANK: Record<EffectPreventionLevel, number> = {
  unpreventable: 3,
  immune: 2,
  suppress: 1,
  none: 0,
};

/**
 * 2 つの防止レベルを比較する。
 * 戻り値:
 *   正数 → a が優先、負数 → b が優先、0 → 同格。
 */
export function comparePreventionLevel(
  a: EffectPreventionLevel,
  b: EffectPreventionLevel
): number {
  return PREVENTION_LEVEL_RANK[a] - PREVENTION_LEVEL_RANK[b];
}

/**
 * 効果の防止レベル (攻撃側) とターゲットの防止レベル (防御側) が衝突したとき、
 * 効果が通るかどうかを判定する。
 * - 攻撃側が "unpreventable" なら、防御側の immune/suppress を貫通する。
 * - 防御側が "immune" なら、攻撃側が unpreventable でない限りブロックされる。
 * - 防御側が "suppress" なら、攻撃側が immune 以上でない限りブロックされる。
 */
export function canEffectPenetrateDefense(
  attackerLevel: EffectPreventionLevel,
  defenderLevel: EffectPreventionLevel
): boolean {
  if (defenderLevel === "none") return true;
  return (
    PREVENTION_LEVEL_RANK[attackerLevel] > PREVENTION_LEVEL_RANK[defenderLevel]
  );
}

export type EndRestrictionTag =
  | "restrict_end_attack_step"
  | "restrict_end_battle"
  | "restrict_end_step"
  | "restrict_end_turn";

export function getEndRestrictionPreventionLevel(
  ce: ContinuousEffect
): EffectPreventionLevel {
  const level = ce.metadata?.preventionLevel;
  return level === "unpreventable" || level === "immune" || level === "suppress"
    ? level
    : "none";
}

export function canEndEffectIgnoreRestriction(
  ce: ContinuousEffect,
  unaffectedByRestriction?: boolean
): boolean {
  if (unaffectedByRestriction !== true) return false;
  return !canEffectPenetrateDefense(
    getEndRestrictionPreventionLevel(ce),
    "immune"
  );
}

export function getActiveEndRestrictions(
  state: GameState,
  actingPlayerId: string,
  tags: readonly EndRestrictionTag[],
  unaffectedByRestriction?: boolean
): ContinuousEffect[] {
  return state.activeContinuousEffects.filter(
    (ce) =>
      tags.includes(ce.modifierTag as EndRestrictionTag) &&
      ce.targetInstanceId === actingPlayerId &&
      !canEndEffectIgnoreRestriction(ce, unaffectedByRestriction) &&
      isTimingScopeActive(
        ce.timingScope,
        state.step,
        state.activePlayerId,
        ce.actingPlayerId
      )
  );
}

export function hasActiveEndRestriction(
  state: GameState,
  actingPlayerId: string,
  tags: readonly EndRestrictionTag[],
  unaffectedByRestriction?: boolean
): boolean {
  return (
    getActiveEndRestrictions(
      state,
      actingPlayerId,
      tags,
      unaffectedByRestriction
    ).length > 0
  );
}

export function hasActiveOpponentEndRestriction(
  state: GameState,
  actingPlayerId: string,
  tags: readonly EndRestrictionTag[],
  unaffectedByRestriction?: boolean
): boolean {
  return getActiveEndRestrictions(
    state,
    actingPlayerId,
    tags,
    unaffectedByRestriction
  ).some((ce) => ce.actingPlayerId !== actingPlayerId);
}

/**
 * 対象カードに対する防御 continuous effect の最強レベルを取得する。
 * defense_immune / defense_suppress を探索し、存在しなければ "none" を返す。
 */
export function getStrongestDefenseLevel(
  state: GameState,
  targetInstanceId: string
): EffectPreventionLevel {
  let strongest: EffectPreventionLevel = "none";
  for (const ce of getCEsForTarget(state, targetInstanceId)) {
    // 発生源/発揮プレイヤースコープ付き「効果を受けない」は blanket 免疫では
    // ない。発生源に依存するため、ここ (発生源非依存の集計) では数えず、
    // 発生源を知る getStrongestDefenseLevelForSource (effect-resistance-check) に委ねる。
    if (ce.immunitySourceScope !== undefined) continue;
    if (ce.immunityPlayerScope === "self") continue;
    if (ce.modifierTag === "defense_immune") {
      if (comparePreventionLevel("immune", strongest) > 0) {
        strongest = "immune";
      }
    } else if (ce.modifierTag === "defense_suppress") {
      if (comparePreventionLevel("suppress", strongest) > 0) {
        strongest = "suppress";
      }
    }
  }
  return strongest;
}

/**
 * P3-77 Step B/C: バースト効果が相手の「無効」/「発揮できない」効果で抑制されるか判定する。
 *
 * `negate_opponent_burst` CE が当該バーストのコントローラの相手側に存在するとき抑制候補。
 * CE の `metadata.burstSuppressKind` で種別を区別する:
 *   - "nullify"(無効にする, 既定): 発動はするが効果が発揮されない。
 *   - "cannot_activate"(発揮できない): 発揮自体を阻害する。
 *
 * 抑制の回避は2系統 ([03b:25] 防げない > 受けない > 発揮できない, 「無効」はラダー外):
 *   1. **発動中(節②)を覆う受けない** = `metadata.burstActivationWindow` を持つ defense_immune。
 *      発動成立〜解決後の窓を覆うため「無効」「発揮できない」両方を回避する
 *      (BSTH01-X07「このカードが発動している間…相手の効果を受けない」)。
 *      セット束縛(節①)の defense_immune は発揮(解決)時点では「セット中」を脱しており、
 *      発動宣言窓での破棄等は防ぐが、発揮への無効は防がない (BSTH01-M13「セット/トラッシュ中
 *      受けない」)。よって window 免疫のみを回避源とし、素の defense_immune は数えない。
 *   2. **発揮できない無視** = `opts.ignoresOpponentCannotActivateBurst`。
 *      "cannot_activate" のみを能動的にバイパスする (受けない由来ではない)。"nullify" は受ける
 *      (BSTH01-M13「相手の『バースト効果を発揮できない』効果を無視して発揮できる」)。
 */
export function getBurstEffectSuppressors(
  state: GameState,
  burstCardInstanceId: string,
  burstControllerId: string,
  opts?: {
    ignoresOpponentCannotActivateBurst?: boolean;
    getCardDefinitionById?:
      | ((id: string) => CardDefinition | undefined)
      | undefined;
    requiredBurstSuppressKind?: "nullify" | "cannot_activate";
  }
): ContinuousEffect[] {
  const opponentId = state.players.find((p) => p.id !== burstControllerId)?.id;
  if (opponentId === undefined) return [];
  const suppressors = state.activeContinuousEffects.filter(
    (ce) =>
      ce.modifierTag === "negate_opponent_burst" &&
      ce.actingPlayerId === opponentId &&
      // timingScope 付き常駐無効化 (BSTH09.2-転醒R03(B)「自分のアタックステップ」) は、
      // 発動者のスコープが現在の step / ターンで有効なときのみ抑制源として数える。
      // timingScope 未設定 (BSTH07「このターンの間」等) は常に有効 (後方互換)。
      isCEActiveForScope(ce, state.step, state.activePlayerId)
  );
  if (suppressors.length === 0) return [];

  // 発動中(節②)を覆う受けない: burstActivationWindow 付き defense_immune のみ。
  const hasActivationWindowImmunity = state.activeContinuousEffects.some(
    (ce) =>
      ce.modifierTag === "defense_immune" &&
      ce.targetInstanceId === burstCardInstanceId &&
      typeof (ce.metadata as { burstActivationWindow?: unknown } | undefined)
        ?.burstActivationWindow === "string"
  );

  const effectiveSuppressors: ContinuousEffect[] = [];
  for (const ce of suppressors) {
    const targetFilter = (
      ce.metadata as { targetFilter?: CardFilter } | undefined
    )?.targetFilter;
    if (targetFilter !== undefined) {
      const burstCard = getCardById(state, burstCardInstanceId);
      const getCardDefinitionById = opts?.getCardDefinitionById;
      const burstDef =
        burstCard !== undefined && getCardDefinitionById !== undefined
          ? getCardDefinitionById(burstCard.definitionId)
          : undefined;
      if (burstCard === undefined || burstDef === undefined) continue;
      if (
        !matchesCardFilter(burstCard, burstDef, targetFilter, {
          state,
          additionalCosts: getAdditionalCosts(state, burstCard.instanceId),
          battleEntities: state.battleEntities,
          effectiveCategory: getEffectiveCategory(state, burstCard, burstDef),
          effectiveColors: getEffectiveColors(state, burstCard, burstDef),
          effectiveBp:
            burstCard.zone === "field"
              ? getCombinedUnitBp(
                  state,
                  burstCard,
                  burstDef,
                  getCardDefinitionById
                )
              : undefined,
          effectiveLevel:
            burstCard.zone === "field"
              ? getEffectiveLevel(
                  state,
                  burstCard,
                  burstDef,
                  getCardDefinitionById
                )
              : undefined,
          effectiveTribes: getEffectiveTribes(
            state,
            burstCard,
            burstDef,
            getCardDefinitionById
          ),
          underCardIds: collectUnderCardScopeIds(state),
        })
      ) {
        continue;
      }
    }
    const kind =
      (ce.metadata as { burstSuppressKind?: string } | undefined)
        ?.burstSuppressKind ?? "nullify";
    if (
      opts?.requiredBurstSuppressKind !== undefined &&
      kind !== opts.requiredBurstSuppressKind
    ) {
      continue;
    }
    if (kind === "cannot_activate") {
      // 発揮できない: 発動中受けない or 発揮できない無視 のいずれかで回避。
      if (hasActivationWindowImmunity) continue;
      if (opts?.ignoresOpponentCannotActivateBurst) continue;
      effectiveSuppressors.push(ce);
      continue;
    }
    // nullify(無効): 発動中受けない でのみ回避 (発揮できない無視は効かない)。
    if (hasActivationWindowImmunity) continue;
    effectiveSuppressors.push(ce);
  }
  return effectiveSuppressors;
}

/** 解決時の判定と表示用の原因一覧は同じ抑止・耐性判定を使う。 */
export function isBurstEffectNullifiedByOpponent(
  ...args: Parameters<typeof getBurstEffectSuppressors>
): boolean {
  return getBurstEffectSuppressors(...args).length > 0;
}

/**
 * 効果の防止レベルと対象の防御レベルから block reason を返す。
 * 防御に阻まれない場合は null。
 */
interface PreventionFilterContext {
  effectAspect?: string | undefined;
  actingPlayerId?: string | null;
  effectSource?: {
    instance?: CardInstance | undefined;
    definition?: CardDefinition | undefined;
  };
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  sourcePreventionBypass?: TargetLockBypassProfile;
}

export function getPreventionBlockReason(
  state: GameState,
  targetInstanceId: string,
  sourcePreventionLevel: EffectPreventionLevel,
  context?: PreventionFilterContext
): string | null {
  if (context?.actingPlayerId !== undefined) {
    const targetCard = getCardById(state, targetInstanceId);
    if (!targetCard) return null;
    const immunityDecision = resolveCardImmunityAffect(
      state,
      targetCard,
      context.actingPlayerId,
      sourcePreventionLevel,
      context.effectSource,
      context.getCardDefinitionById,
      context.sourcePreventionBypass,
      context.effectAspect
    );
    return immunityDecision.kind === "blocked"
      ? `prevented_by_defense:${immunityDecision.reason}`
      : null;
  }
  const defenseLevel = getStrongestDefenseLevel(state, targetInstanceId);
  if (canEffectPenetrateDefense(sourcePreventionLevel, defenseLevel)) {
    return null;
  }
  return `prevented_by_defense:${defenseLevel}`;
}

/**
 * 候補ターゲットから防御レベルに阻まれるものを除外する。
 * sourcePreventionLevel が "none" で防御効果がなければ全候補がそのまま通る。
 */
export function filterTargetsByPreventionLevel(
  state: GameState,
  candidateInstanceIds: readonly string[],
  sourcePreventionLevel: EffectPreventionLevel,
  context?: PreventionFilterContext
): string[] {
  return candidateInstanceIds.filter((id) => {
    const card = getCardById(state, id);
    if (card && context?.actingPlayerId !== undefined) {
      const result = resolveCardImmunityAffectDecisions(
        state,
        [card],
        context.actingPlayerId,
        sourcePreventionLevel,
        context.effectSource,
        context.getCardDefinitionById,
        context.sourcePreventionBypass,
        context.effectAspect
      )[0]!;
      // 非公開の耐性は選択を確定してから証明する。候補の有無で先に内容を漏らさない。
      return (
        result.decision.kind === "allowed" ||
        (result.proofCardInstanceIds?.length ?? 0) > 0
      );
    }
    return (
      getPreventionBlockReason(state, id, sourcePreventionLevel, context) ===
      null
    );
  });
}

function isTargetLockCETag(
  tag: ContinuousEffectTag
): tag is "cannot_be_targeted" | "cannot_include" {
  return tag === "cannot_be_targeted" || tag === "cannot_include";
}

function targetGateSourceForCE(
  ce: ContinuousEffect
): EffectResistanceSourceScope {
  const meta = ce.metadata as
    | { source?: EffectResistanceSourceScope }
    | undefined;
  return meta?.source ?? "all";
}

/**
 * P3-142: 防止元 identity (`EffectSourceIdentity`) 構築の共有 SSOT。
 * `effectSourceIdentityForCE` (target lock 経路, 本ファイル) と
 * `getResistanceCESourceIdentity` (cannot_* 効果耐性経路, effect-resistance-check.ts)
 * が個別に category/colors/tribes/keywords を組み立てる並行写像だったのを解消する
 * (P3-142 残タスク1)。
 *
 * **設計判断 (engine-effective-colors-tribes-combined-unit-union, P3-142 残留懸念調査)**:
 * `categories` は合体中ブレイヴ/転神中ネクサスでホスト側の値を union する
 * (`getEffectiveCategories()`) が、`colors`/`tribes` は union しない。
 * - 系統: `05_brave-and-attack-special-cases.md:27`「合算しない要素: 名前、系統、
 *   Lv ごとのコア数、軽減シンボル」で明示的に対象外と裁定済み
 *   (`getEffectiveTribes()` 自身のコメントの `virtualAttachedBraves` 除外とも整合)。
 * - 色: 同ファイル:26「属性（色が追加）」自体は合体スピリットという 1 エンティティの
 *   表示・参照用属性としては union されるが、この防止元 identity 経路
 *   （`preventionRestriction.onlyPreventableByColors`/`notPreventableByColors`/
 *   `colorMatchMode` 照合、`matchesEffectSourceFilter()`）に union を持ち込むと、
 *   `colorMatchMode:"exact"` の単色判定 (`sameStringSet`) が意図せず崩れる
 *   リスクがある。現行カードプール調査 (2026-08-06, 再検証済 2026-08-06):
 *   `printedCategory:"brave"` は card-data 全体で 68 枚。うち `effect_resistance`/
 *   `resistsOutcome` を保持するブレイヴは 19 枚（BSAZ01/BSAZ02/BSGE01/BSTH003/
 *   BSTH05/BSTH08.5 各カード）だが、いずれも `applicability.combined:false` /
 *   `zone:"set_aside"` 限定 / trigger 時の一時付与のみで、合体中に恒常適用される
 *   ものは無い。`preventionRestriction` を持つサイトは card-data 全体で 13 サイト
 *   あるが、うち色スコープ (`onlyPreventableByColors`/`notPreventableByColors`)
 *   を持つのは 3 サイト (BSTH002-X01/BSTH01-R11/BSTH03-X01) のみ。この 3 サイトを
 *   実際に防ぎうる cannot_be_destroyed/cannot_be_targeted 型耐性を持つ合体対応
 *   ブレイヴは 0 枚。実害が確認されるカードが出るまで union は見送り、必要になった
 *   時点で `getEffectiveCategories()` と同型の合成 helper を追加する。
 */
export function buildEffectSourceIdentity(
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): EffectSourceIdentity {
  const effectiveCategories = sourceCard
    ? getEffectiveCategories(
        state,
        sourceCard,
        sourceDefinition,
        getCardDefinitionById
      )
    : sourceDefinition.printedCategory !== undefined
      ? [sourceDefinition.printedCategory]
      : [];
  const effectiveColors = getEffectiveColors(
    state,
    sourceCard,
    sourceDefinition
  );
  const effectiveTribes = getEffectiveTribes(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    options
  );
  return {
    ...(effectiveCategories.length > 0
      ? { categories: effectiveCategories }
      : {}),
    colors: effectiveColors,
    ...(effectiveTribes.length > 0 ? { tribes: effectiveTribes } : {}),
    keywords: sourceDefinition.keywordTags,
  };
}

function effectSourceIdentityForCE(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): EffectSourceIdentity | undefined {
  if (!getCardDefinitionById) return undefined;
  const sourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: ce.sourceInstanceId,
    sourceDefinitionId: ce.sourceDefinitionId,
    ...(ce.provenance?.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: ce.provenance.effectSourceInstanceId }
      : {}),
    ...(ce.provenance?.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: ce.provenance.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  const sourceCard = sourceIdentity.instance;
  const sourceDefinition = sourceIdentity.definition;
  if (!sourceDefinition) return undefined;
  return buildEffectSourceIdentity(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    options
  );
}

export interface TargetAcquisitionGateEvaluationOptions {
  readonly includeGlobalOverridePropertiesInFilter?: boolean | undefined;
  readonly source?: EffectSourceContext;
}

export function getTargetAcquisitionGatesForCard(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: TargetAcquisitionGateEvaluationOptions = {}
): TargetAcquisitionGate[] {
  const gates: TargetAcquisitionGate[] = [];
  const getDef = getCardDefinitionById ?? (() => undefined);
  const includeGlobal = options.includeGlobalOverridePropertiesInFilter;
  const cardDef = getCardDefinitionById?.(card.definitionId);
  const candidates = [
    ...getCEsForTarget(state, card.instanceId),
    ...getGlobalCEs(state).filter(
      (ce) =>
        isTargetLockCETag(ce.modifierTag) &&
        ce.targetFilter !== undefined &&
        matchesGlobalCETargetFilterInternal(state, ce, card, {
          getCardDefinitionById: getDef,
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          includeGlobalOverrideProperties: includeGlobal,
          includeGlobalOverridePropertiesInCost: includeGlobal,
          ...(includeGlobal === false && card.zone === "field" && cardDef
            ? {
                effectiveLevel:
                  getEffectiveLevelExcludingGlobalOverrideProperties(
                    state,
                    card,
                    cardDef,
                    getDef,
                    new Set()
                  ),
              }
            : {}),
        })
    ),
  ];
  for (const ce of candidates) {
    if (!isTargetLockCETag(ce.modifierTag)) continue;
    const sourceFilter = ce.metadata?.targetLockSourceFilter as
      | EffectSourceFilter
      | undefined;
    if (sourceFilter && options.source) {
      const sourceCard = options.source.sourceInstanceId
        ? getCardById(state, options.source.sourceInstanceId)
        : undefined;
      const sourceDefinition = getDef(
        options.source.sourceDefinitionId ?? sourceCard?.definitionId ?? ""
      );
      if (
        sourceDefinition &&
        !matchesEffectSourceFilter(
          buildEffectSourceIdentity(
            state,
            sourceCard,
            sourceDefinition,
            getDef,
            { includeGlobalOverrideProperties: includeGlobal }
          ),
          sourceFilter
        )
      )
        continue;
    }
    const preventingEffect = effectSourceIdentityForCE(
      state,
      ce,
      getCardDefinitionById,
      {
        includeGlobalOverrideProperties: includeGlobal,
      }
    );
    gates.push({
      reason: ce.modifierTag,
      byEffectId: ce.effectId,
      source: targetGateSourceForCE(ce),
      targetControllerPlayerId: card.controllerPlayerId,
      ...(preventingEffect !== undefined ? { preventingEffect } : {}),
    });
  }
  return gates;
}

export function filterTargetsByTargetAcquisitionGate(
  state: GameState,
  candidateInstanceIds: readonly string[],
  source: EffectSourceContext,
  selectorIntent: TargetAcquireContext["selectorIntent"],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): string[] {
  const ctx: TargetAcquireContext = {
    source,
    targetClass: "card_or_zone",
    selectorIntent,
  };
  return candidateInstanceIds.filter((id) => {
    const card = getCardById(state, id);
    if (!card) return false;
    return (
      resolveTargetAcquisition(
        ctx,
        cardTargetRef(card),
        getTargetAcquisitionGatesForCard(state, card, getCardDefinitionById, {
          source,
        })
      ).kind === "candidate"
    );
  });
}

/**
 * 動的フィルタ CE（`targetInstanceId` 未設定・`targetFilter` あり=「すべて」系効果）が
 * 対象カードに適用されるか判定する共通述語（SSOT）。
 *
 * player（self=owner / それ以外=owner の相手）+ CardFilter 相当条件を見る。
 * 場のカードは `matchesCardFilter` に実効系統とコア数を注入して評価する。
 * インスタンス文脈がない場合だけ、def で判定できる印字条件にフォールバックする。
 *
 * 消費側で「player + category（+ コア数）」マッチを再実装しないための単一正源。
 * bp_modifier（コア数フィルタ無し）と prevent_battle（コア数フィルタ有り）の双方が使う。
 */
export function matchesGlobalCETargetFilter(
  state: GameState,
  ce: ContinuousEffect,
  targetCard: {
    controllerPlayerId: string;
    ownerPlayerId?: string;
    definitionId: string;
    instanceId?: string;
    zone?: Zone;
  },
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  coreCount?: number,
  sourceDefinition?: CardDefinition,
  options: EffectivePropertyEvaluationOptions = {}
): boolean {
  return matchesGlobalCETargetFilterInternal(state, ce, targetCard, {
    getCardDefinitionById,
    coreCount,
    sourceDefinition,
    includeGlobalOverrideProperties: options.includeGlobalOverrideProperties,
  });
}

function matchesGlobalCETargetFilterInternal(
  state: GameState,
  ce: ContinuousEffect,
  targetCard: {
    controllerPlayerId: string;
    ownerPlayerId?: string;
    definitionId: string;
    instanceId?: string;
    zone?: Zone;
  },
  opts: {
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    coreCount?: number | undefined;
    effectiveTribes?: readonly string[] | undefined;
    effectiveColors?: readonly CardColor[] | undefined;
    effectiveLevel?: number | undefined;
    sourceDefinition?: CardDefinition | undefined;
    includeGlobalOverrideProperties?: boolean | undefined;
    includeGlobalOverridePropertiesInCost?: boolean | undefined;
  }
): boolean {
  const f = ce.targetFilter;
  if (!f) return false;
  if (ce.targetExcludeSelf && targetCard.instanceId === ce.sourceInstanceId) {
    return false;
  }
  // "either" は両プレイヤー対象のため player 軸での除外を行わない
  // (card-filter.ts の matchesCostCEFilterClause と同じ扱い)。
  if (f.player !== "either") {
    const filterPlayerId =
      f.player === "self"
        ? ce.actingPlayerId
        : state.players.find((p) => p.id !== ce.actingPlayerId)?.id;
    const zonePlayerId =
      targetCard.zone !== undefined && targetCard.zone !== "field"
        ? (targetCard.ownerPlayerId ?? targetCard.controllerPlayerId)
        : targetCard.controllerPlayerId;
    if (!filterPlayerId || zonePlayerId !== filterPlayerId) {
      return false;
    }
  }

  const actualCard =
    targetCard.instanceId !== undefined
      ? getCardById(state, targetCard.instanceId)
      : undefined;
  // Viewer-sanitized face-down field cards still receive effects matching
  // their public grants. Keep null printed identity local to the actual card;
  // a missing hand/deck definition or a dangling target is not a spirit.
  // Keep the explicitly supplied definition for engine projections (e.g. a
  // magic's rebirth back face). Only an actual concealed field card loses it.
  const def =
    actualCard?.faceDown && actualCard.zone === "field"
      ? getCardDefinitionForEffectiveFieldCard(
          actualCard,
          opts.getCardDefinitionById,
          {
            state,
            filter: f,
            includeGlobalOverrideProperties:
              opts.includeGlobalOverrideProperties,
          }
        )
      : opts.getCardDefinitionById(targetCard.definitionId);
  if (!def) return false;
  if (actualCard) {
    const { player: _player, ...cardFilter } = f;
    void _player;
    const effectiveTribes =
      opts.effectiveTribes ??
      getEffectiveTribes(state, actualCard, def, opts.getCardDefinitionById, {
        includeGlobalOverrideProperties: opts.includeGlobalOverrideProperties,
      });
    const effectiveColors =
      opts.effectiveColors ?? getEffectiveColors(state, actualCard, def);
    const injectedCoreCount =
      opts.coreCount ?? getTotalCoresOnCardById(state, actualCard.instanceId);
    const injectedEffectiveLevel =
      actualCard.zone === "field"
        ? (opts.effectiveLevel ??
          getEffectiveLevel(state, actualCard, def, opts.getCardDefinitionById))
        : undefined;
    const sourceDefinition =
      opts.sourceDefinition ??
      opts.getCardDefinitionById(ce.sourceDefinitionId);
    if (
      !matchesCardFilter(actualCard, def, cardFilter, {
        state,
        getCardDefinitionById: opts.getCardDefinitionById,
        soulStateIds: getEffectiveSoulStateIds(
          state,
          opts.getCardDefinitionById
        ),
        underCardIds: collectUnderCardScopeIds(state),
        effectiveTribes,
        effectiveColors,
        effectiveBp:
          actualCard.zone === "field" && cardFilterNeedsEffectiveBp(f)
            ? getCombinedUnitBp(
                state,
                actualCard,
                def,
                opts.getCardDefinitionById
              )
            : undefined,
        effectiveSymbolCount:
          actualCard.zone === "field" && cardFilterNeedsEffectiveSymbolCount(f)
            ? getCombinedUnitSymbolCount(
                state,
                actualCard,
                def,
                opts.getCardDefinitionById
              )
            : undefined,
        coreCount: injectedCoreCount,
        effectiveLevel: injectedEffectiveLevel,
        ...(sourceDefinition ? { sourceDefinition } : {}),
        ...getCombinedUnitCostFilterOptions(
          state,
          actualCard,
          def,
          opts.getCardDefinitionById,
          {
            includeGlobalOverrideProperties:
              opts.includeGlobalOverridePropertiesInCost ??
              opts.includeGlobalOverrideProperties,
          }
        ),
      })
    ) {
      return false;
    }
  } else if (f.category) {
    if (!matchesCardFilterByDef(def, { category: f.category })) return false;
  }

  if (!actualCard && f.colors) {
    if (!f.colors.some((color) => def.colors.includes(color))) return false;
  }
  if (
    !actualCard &&
    (f.tribes ||
      f.tribesRequired ||
      f.noTribes === true ||
      (f.excludeTribeSubstring && f.excludeTribeSubstring.length > 0))
  ) {
    if (!matchesTribes(def.tribe, f)) return false;
  }

  if (!actualCard && f.cardName) {
    const sourceDef =
      opts.sourceDefinition ??
      opts.getCardDefinitionById(ce.sourceDefinitionId);
    const overridden = targetCard.instanceId
      ? getOverriddenProperties(
          state,
          targetCard.instanceId,
          opts.getCardDefinitionById,
          opts.includeGlobalOverrideProperties
        )
      : null;
    const names = [def?.name, overridden?.cardName].filter(
      (name): name is string => typeof name === "string"
    );
    if (
      names.length === 0 ||
      !names.some((name) => matchesCardName(name, f.cardName!, sourceDef))
    ) {
      return false;
    }
  }
  if (f.maxCores !== undefined || f.minCores !== undefined) {
    if (opts.coreCount === undefined) return false;
    if (f.maxCores !== undefined && opts.coreCount > f.maxCores) return false;
    if (f.minCores !== undefined && opts.coreCount < f.minCores) return false;
  }
  return true;
}

function resolveDynamicCountPlayer(
  state: GameState,
  actingPlayerId: string,
  player: import("../dsl-types").PlayerRef
): string {
  if (player === "self") return actingPlayerId;
  return (
    state.players.find((p) => p.id !== actingPlayerId)?.id ?? actingPlayerId
  );
}

/**
 * 継続修飾（bp_modifier 等）が保持する `DynamicCount` を、盤面のみで解決できる
 * 種別（count_value / cores_on(reserve|life|trash) / cards_in_zone）に限って
 * 評価する leaf-local 関数。`stepContext` を要する種別（cards_from_ref /
 * event_amount / cost_paid_this_effect、cores_on(this_card 等)）は **継続修飾では
 * 使われない** 前提で 0 を返す。
 *
 * SSOT: target-resolution の `resolveSourceCount` がこの関数へ委譲する
 * （stateless 3 種は単一実装に集約）。multiplier / divisor / groupMultiplier /
 * offset / subtract / cap の適用順は resolveDynamicCount と一致させる。
 */
export interface DynamicCountEvaluationContext {
  sourceTribes?: readonly string[];
}

function dynamicCountContextForSourceDefinition(
  sourceDefinition: CardDefinition | undefined
): DynamicCountEvaluationContext | undefined {
  if (!sourceDefinition) return undefined;
  return {
    sourceTribes: sourceDefinition.tribe?.split("・").filter(Boolean) ?? [],
  };
}

function resolveBpModifyEffectSourceIdentity(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): ResolvedAffectSourceIdentity {
  const identity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: ce.sourceInstanceId,
    sourceDefinitionId: ce.sourceDefinitionId,
    ...(ce.provenance?.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: ce.provenance.effectSourceInstanceId }
      : {}),
    ...(ce.provenance?.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: ce.provenance.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  if (
    ce.provenance?.effectSourceDefinitionId !== undefined &&
    ce.provenance.effectSourceInstanceId === undefined &&
    identity.instance?.definitionId !== identity.definitionId
  ) {
    return {
      instanceId: identity.instanceId,
      ...(identity.definitionId !== undefined
        ? { definitionId: identity.definitionId }
        : {}),
      ...(identity.definition !== undefined
        ? { definition: identity.definition }
        : {}),
      usedEffectSource: identity.usedEffectSource,
      effectSourceIsCombinedBrave: identity.effectSourceIsCombinedBrave,
    };
  }
  return identity;
}

function dynamicCountContextForContinuousEffect(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): DynamicCountEvaluationContext | undefined {
  const sourceIdentity = resolveBpModifyEffectSourceIdentity(
    state,
    ce,
    getCardDefinitionById
  );
  const sourceDefinitionId = sourceIdentity.definitionId;
  const sourceCard = sourceIdentity.instance;
  const sourceDefinition =
    sourceIdentity.definition ??
    (sourceDefinitionId !== undefined
      ? getCardDefinitionById?.(sourceDefinitionId)
      : undefined) ??
    (sourceCard ? getCardDefinitionById?.(sourceCard.definitionId) : undefined);
  if (!sourceCard) {
    return dynamicCountContextForSourceDefinition(sourceDefinition);
  }
  return {
    sourceTribes: getEffectiveTribes(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById
    ),
  };
}

function getBpModifyEffectSourceDefinition(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  const sourceIdentity = resolveBpModifyEffectSourceIdentity(
    state,
    ce,
    getCardDefinitionById
  );
  return (
    sourceIdentity.definition ??
    (sourceIdentity.definitionId !== undefined
      ? getCardDefinitionById(sourceIdentity.definitionId)
      : undefined) ??
    (sourceIdentity.instance
      ? getCardDefinitionById(sourceIdentity.instance.definitionId)
      : undefined)
  );
}

export function evaluateContinuousDynamicAmount(
  state: GameState,
  actingPlayerId: string,
  dc: DynamicCount,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  context?: DynamicCountEvaluationContext
): number {
  const baseCount = evaluateStatelessSourceCount(
    state,
    actingPlayerId,
    dc.source,
    getCardDefinitionById,
    context
  );
  const multiplier = dc.multiplier ?? 1;
  const divisor = dc.divisor ?? 1;
  const groupMultiplier = dc.groupMultiplier ?? 1;
  const offset = dc.offset ?? 0;
  let value =
    Math.floor((baseCount * multiplier) / divisor) * groupMultiplier + offset;
  if (dc.subtract !== undefined) {
    const subtractCount = evaluateStatelessSourceCount(
      state,
      actingPlayerId,
      dc.subtract,
      getCardDefinitionById,
      context
    );
    value = Math.max(0, value - subtractCount);
  }
  return dc.cap !== undefined ? Math.min(value, dc.cap) : value;
}

export function cardFilterNeedsEffectiveBp(
  filter: CardFilter | undefined
): boolean {
  if (!filter) return false;
  const nestedNeeds =
    (filter.filterOr?.some((sub) => cardFilterNeedsEffectiveBp(sub)) ??
      false) ||
    cardFilterNeedsEffectiveBp(filter.exclude);
  if (filter.filterOr && filter.filterOr.length > 0) return nestedNeeds;
  return (
    filter.minBp !== undefined ||
    filter.maxBp !== undefined ||
    filter.extremal?.metric === "bp" ||
    nestedNeeds
  );
}

export function cardFilterNeedsEffectiveSymbolCount(
  filter: CardFilter | undefined
): boolean {
  if (!filter) return false;
  const nestedNeeds =
    (filter.filterOr?.some((sub) => cardFilterNeedsEffectiveSymbolCount(sub)) ??
      false) ||
    cardFilterNeedsEffectiveSymbolCount(filter.exclude);
  if (filter.filterOr && filter.filterOr.length > 0) return nestedNeeds;
  return (
    filter.symbolCount !== undefined ||
    filter.minSymbolCount !== undefined ||
    filter.maxSymbolCount !== undefined ||
    nestedNeeds
  );
}

export function cardFilterNeedsEffectiveLevel(
  filter: CardFilter | undefined
): boolean {
  if (!filter) return false;
  const nestedNeeds =
    (filter.filterOr?.some(cardFilterNeedsEffectiveLevel) ?? false) ||
    cardFilterNeedsEffectiveLevel(filter.exclude);
  if (filter.filterOr && filter.filterOr.length > 0) return nestedNeeds;
  return (
    filter.minLevel !== undefined ||
    filter.maxLevel !== undefined ||
    filter.belowOwnMinimumLevel === true ||
    filter.atOwnMaximumLevel !== undefined ||
    nestedNeeds
  );
}

function cardFilterNeedsEffectiveName(filter: CardFilter | undefined): boolean {
  if (!filter) return false;
  const nestedNeeds =
    (filter.filterOr?.some(cardFilterNeedsEffectiveName) ?? false) ||
    cardFilterNeedsEffectiveName(filter.exclude);
  if (filter.filterOr && filter.filterOr.length > 0) return nestedNeeds;
  return (
    filter.cardName !== undefined ||
    filter.excludeCardName !== undefined ||
    nestedNeeds
  );
}

/**
 * `DynamicCountSource` のうち盤面のみで解決できる stateless 種別を数える。
 * context 依存種別は 0 を返す（継続修飾では使われない）。
 */
export function evaluateStatelessSourceCount(
  state: GameState,
  actingPlayerId: string,
  src: DynamicCountSource,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  context?: DynamicCountEvaluationContext
): number {
  switch (src.kind) {
    case "count_value": {
      const pid = resolveDynamicCountPlayer(state, actingPlayerId, src.player);
      const p = state.players.find((pp) => pp.id === pid);
      if (!p) return 0;
      if (!context?.sourceTribes) return p.countValue;
      return Math.max(
        0,
        p.countValue -
          immuneProtectedCount(p.protectedCounts, context.sourceTribes)
      );
    }
    case "declaration_count_this_turn": {
      const pid = resolveDynamicCountPlayer(state, actingPlayerId, src.player);
      return state.declarationCountThisTurn[pid] ?? 0;
    }
    case "cores_on":
      return statelessCoreLocationCount(state, actingPlayerId, src.location);
    case "cards_in_zone": {
      const playerId = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        src.player
      );
      return state.cardInstances.filter((c) => {
        const zonePlayerId =
          c.zone === "field" ? c.controllerPlayerId : c.ownerPlayerId;
        if (zonePlayerId !== playerId) return false;
        if (
          getCardDefinitionById
            ? !isCardInEffectZone(
                state,
                c,
                [src.zone],
                actingPlayerId,
                getCardDefinitionById
              )
            : c.zone !== src.zone
        )
          return false;
        if (src.filter) {
          if (!getCardDefinitionById) return false;
          const def = getCardDefinitionForEffectiveFieldCard(
            c,
            getCardDefinitionById,
            { state, filter: src.filter }
          );
          if (!def) return false;
          // effectiveBp は filter が BP を参照するときだけ評価する。無条件評価は
          // 「BP+(自分の合体ブレイヴ数×N)」型 (BSFT01-C02) で BP 算出 →
          // bp_modifier の動的量再評価 → cards_in_zone → BP 算出の無限再帰を招く。
          const needsBp = cardFilterNeedsEffectiveBp(src.filter);
          const needsSym = cardFilterNeedsEffectiveSymbolCount(src.filter);
          return matchesCardReferenceFilter(c, def, src.filter, {
            state,
            getCardDefinitionById,
            battleEntities: state.battleEntities,
            effectiveColors: getEffectiveColors(state, c, def),
            effectiveTribes: getEffectiveTribes(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            ...getCombinedUnitCostFilterOptions(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            effectiveBp:
              needsBp && c.zone === "field"
                ? getCombinedUnitBp(state, c, def, getCardDefinitionById)
                : undefined,
            effectiveLevel:
              c.zone === "field"
                ? getEffectiveLevel(state, c, def, getCardDefinitionById)
                : undefined,
            coreCount:
              c.zone === "field"
                ? getTotalCoresOnCardById(state, c.instanceId)
                : undefined,
            // 合体ユニット (host+attached brave) と symbol_addition CE 由来の
            // 実効シンボル数。場外は undefined → card-filter 側で印字フォールバック。
            effectiveSymbolCount:
              needsSym && c.zone === "field"
                ? getCombinedUnitSymbolCount(
                    state,
                    c,
                    def,
                    getCardDefinitionById
                  )
                : undefined,
          });
        }
        return true;
      }).length;
    }
    case "field_bp_total": {
      const playerId = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        src.player
      );
      return state.cardInstances
        .filter((c) => {
          if (c.zone !== "field") return false;
          if (c.controllerPlayerId !== playerId) return false;
          if (!src.filter) return true;
          if (!getCardDefinitionById) return false;
          const def = getCardDefinitionForEffectiveFieldCard(
            c,
            getCardDefinitionById,
            { state, filter: src.filter }
          );
          if (!def) return false;
          return matchesCardReferenceFilter(c, def, src.filter, {
            state,
            getCardDefinitionById,
            battleEntities: state.battleEntities,
            effectiveColors: getEffectiveColors(state, c, def),
            effectiveTribes: getEffectiveTribes(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            ...getCombinedUnitCostFilterOptions(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            effectiveBp: getCombinedUnitBp(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, c.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              c,
              def,
              getCardDefinitionById
            ),
          });
        })
        .reduce((sum, c) => {
          const def = getCardDefinitionById?.(c.definitionId);
          // getCombinedUnitBp (host+合体ブレイヴの「BP＋」加算込み、10_rules/05) を使う。
          // getEffectiveBp は host 単体のみで合体ブレイヴの BP＋ 加算を除外するため過小評価になる。
          return sum + getCombinedUnitBp(state, c, def, getCardDefinitionById);
        }, 0);
    }

    // context 依存種別: 継続修飾では使われない（0 を返す）
    case "cards_from_ref":
    case "cost_from_ref":
    case "symbol_count_from_ref":
    case "selected_targets":
    case "trigger_related_instances":
    case "trigger_related_instances_count":
    case "event_amount":
    case "cost_paid_this_effect":
    case "braves_on_source":
    case "source_effective_cost":
    case "source_effective_bp":
    case "source_effective_level":
    case "step_numeric_amount":
    case "self_under_card_count":
      return 0;
  }
}

function statelessCoreLocationCount(
  state: GameState,
  actingPlayerId: string,
  location: CoreLocation
): number {
  switch (location.kind) {
    case "union":
      throw new Error("core source union is only supported by core_move");
    case "reserve": {
      const pid = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        location.player
      );
      const p = state.players.find((pp) => pp.id === pid);
      return p ? getPlayerReserveCoreCount(p) : 0;
    }
    case "life": {
      const pid = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        location.player
      );
      const p = state.players.find((pp) => pp.id === pid);
      return p ? getPlayerLifeCoreCount(p) : 0;
    }
    case "trash": {
      const pid = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        location.player
      );
      const p = state.players.find((pp) => pp.id === pid);
      return p ? getPlayerTrashCoreCount(p) : 0;
    }
    case "card_instance":
      return getTotalCoresOnCardById(state, location.instanceId);
    // context 依存（this_card 等）は継続修飾では使われない → 0
    case "this_card":
    case "target_card":
    case "ref":
    case "field_card":
    case "void":
    case "field":
    case "count_area":
    case "any_movable_self":
    case "non_life_normal_self":
    case "field_and_reserve_self":
    case "field_reserve_and_trash_self":
    case "outside_game":
    case "removed_from_game":
      return 0;
  }
}

/**
 * CE 1 件の実効 BP 修飾量を返す。`modifierAmountDynamic`（動的）があれば優先して
 * live 評価し、なければ `modifierAmount`（固定）を返す。どちらも無ければ undefined。
 */
function getCeBpAmount(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number | undefined {
  if (ce.modifierAmountDynamic !== undefined) {
    return evaluateContinuousDynamicAmount(
      state,
      ce.actingPlayerId,
      ce.modifierAmountDynamic,
      getCardDefinitionById,
      dynamicCountContextForContinuousEffect(state, ce, getCardDefinitionById)
    );
  }
  return ce.modifierAmount;
}

/** Evaluate a modifier's inputs before applying that same modifier. Nested
 * property reads retain every other CE; each dependency removes its own CE,
 * just as global level filters exclude the level modifier being considered.
 * This is a read-only view, not an engine transition or hidden-state rebuild.
 */
function continuousEffectInputState(
  state: GameState,
  ce: ContinuousEffect
): GameState {
  return continuousEffectReadInputState(state, ce.effectId);
}

function globalBpModifierCanAffectCard(
  state: GameState,
  ce: ContinuousEffect,
  targetCard: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const sourcePreventionLevel = readBpModifyPreventionLevel(ce);
  const sourcePreventionBypass = readBpModifyPreventionBypass(ce);
  const sourceIdentity = resolveBpModifyEffectSourceIdentity(
    state,
    ce,
    getCardDefinitionById
  );
  const sourceInstanceId = sourceIdentity.instanceId;
  const sourceDefinitionId =
    sourceIdentity.definitionId ?? ce.sourceDefinitionId;
  const sourceCard = sourceIdentity.instance;
  const sourceDefinition =
    sourceIdentity.definition ??
    getBpModifyEffectSourceDefinition(state, ce, getCardDefinitionById);
  const immunityDecision = resolveCardImmunityAffect(
    state,
    targetCard,
    ce.actingPlayerId,
    sourcePreventionLevel,
    {
      ...(sourceCard ? { instance: sourceCard } : {}),
      ...(sourceDefinition ? { definition: sourceDefinition } : {}),
    },
    getCardDefinitionById,
    sourcePreventionBypass,
    "bp"
  );
  if (immunityDecision.kind !== "allowed") return false;

  const source: EffectSourceContext = {
    actingPlayerId: ce.actingPlayerId,
    sourceInstanceId,
    sourceDefinitionId,
    prevention: normalizePreventionProfile({
      resistance: sourcePreventionLevel,
      targetLockBypass: readBpModifyTargetLockBypass(ce),
    }),
    cause: "effect",
  };
  const ctx: TargetAcquireContext = {
    source,
    targetClass: "card_or_zone",
    selectorIntent: "include_all",
  };
  return (
    resolveTargetAcquisition(
      ctx,
      cardTargetRef(targetCard),
      getTargetAcquisitionGatesForCard(
        state,
        targetCard,
        getCardDefinitionById,
        { source }
      )
    ).kind === "candidate"
  );
}

/**
 * `count:"all"` の filter-target dynamic global CE（`isAllScopeFilter` 分岐、
 * targetInstanceId 未設定・targetFilter で動的マッチ）が特定カードへ適用可能かを判定する
 * 共通ゲート。symbols / addTribes / levelCost / levelCostDelta / level の5読み出し経路
 * (`getOverriddenProperties`/`getEffectiveLevelCostDelta`/`getEffectiveLevelCostOverride`/
 * `getEffectiveLevelOverride`/`getEffectiveTribes`) が共有する SSOT。
 *
 * `effectAspect` は `ce.metadata.properties` のどのキーを読み出す文脈かを
 * `isCardImmuneToOpponentEffect` 系のチェーンへ伝える（呼び出し元がプロパティキー名と
 * 同じ文字列を渡す規約、ENGINE-symbol-lock-self-effect-immunity の "symbols" 前例を踏襲）。
 * 未指定だと `immunitySourceScope.restrictedAspects` 付き免疫 CE が判定対象から
 * スキップされ (effect-resistance-check.ts のガード)、部分免疫が効かなくなる
 * (ENGINE-effect-immunity-global-ce-fast-path-bypass)。blanket 免疫 (restrictedAspects
 * 未設定) は effectAspect の有無に関係なく従来通り機能する。
 */
function globalOverridePropertiesCanAffectCard(
  inputState: GameState,
  ce: ContinuousEffect,
  targetCard: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effectAspect?: string
): boolean {
  const state = continuousEffectInputState(inputState, ce);
  const sourcePreventionLevel = readOverridePropertiesPreventionLevel(ce);
  const sourcePreventionBypass = readOverridePropertiesPreventionBypass(ce);
  const sourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: ce.sourceInstanceId,
    sourceDefinitionId: ce.sourceDefinitionId,
    effectSourceInstanceId: readOverridePropertiesEffectSourceInstanceId(ce),
    effectSourceDefinitionId:
      readOverridePropertiesEffectSourceDefinitionId(ce),
    getCardDefinitionById,
  });
  const sourceInstanceId = sourceIdentity.instanceId;
  const sourceDefinitionId =
    sourceIdentity.definitionId ?? ce.sourceDefinitionId;
  const sourceCard = sourceIdentity.instance;
  const sourceDefinition =
    sourceIdentity.definition ??
    getCardDefinitionById(sourceCard?.definitionId ?? sourceDefinitionId);
  const immunityDecision = resolveCardImmunityAffect(
    state,
    targetCard,
    ce.actingPlayerId,
    sourcePreventionLevel,
    {
      ...(sourceCard ? { instance: sourceCard } : {}),
      ...(sourceDefinition ? { definition: sourceDefinition } : {}),
    },
    getCardDefinitionById,
    sourcePreventionBypass,
    effectAspect,
    {
      filterOptions: { includeGlobalOverrideProperties: false },
      sourceIdentityOptions: { includeGlobalOverrideProperties: false },
    }
  );
  if (immunityDecision.kind !== "allowed") return false;

  const source: EffectSourceContext = {
    actingPlayerId: ce.actingPlayerId,
    sourceInstanceId,
    sourceDefinitionId,
    prevention: normalizePreventionProfile({
      resistance: sourcePreventionLevel,
      targetLockBypass: readOverridePropertiesTargetLockBypass(ce),
    }),
    cause: "effect",
  };
  const ctx: TargetAcquireContext = {
    source,
    targetClass: "card_or_zone",
    selectorIntent: "include_all",
  };
  return (
    resolveTargetAcquisition(
      ctx,
      cardTargetRef(targetCard),
      getTargetAcquisitionGatesForCard(
        state,
        targetCard,
        getCardDefinitionById,
        {
          includeGlobalOverridePropertiesInFilter: false,
          source,
        }
      )
    ).kind === "candidate"
  );
}

/**
 * 対象カードに適用中の bp_modifier 継続効果の合計増減値を返す。
 * modifierAmount / modifierAmountDynamic がどちらも未設定の bp_modifier は無視する。
 */
export function getBpModifierTotal(
  state: GameState,
  targetInstanceId: string,
  /** targetFilter 動的マッチング用。省略時は targetInstanceId のみで判定。 */
  targetCard?: {
    controllerPlayerId: string;
    definitionId: string;
    instanceId?: string;
  },
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  return memoizeContinuousEffectRead(
    state,
    getBpModifierTotal,
    [
      targetInstanceId,
      targetCard !== undefined,
      targetCard?.controllerPlayerId,
      targetCard?.definitionId,
      targetCard?.instanceId,
      getCardDefinitionById,
    ],
    () =>
      computeBpModifierTotal(
        state,
        targetInstanceId,
        targetCard,
        getCardDefinitionById
      )
  );
}

function computeBpModifierTotal(
  ...[state, targetInstanceId, targetCard, getCardDefinitionById]: Parameters<
    typeof getBpModifierTotal
  >
): number {
  let total = 0;

  // 特定カード指定の CE を索引から取得
  for (const ce of getCEsForTarget(state, targetInstanceId)) {
    if (ce.modifierTag !== "bp_modifier") continue;
    const amount = getCeBpAmount(
      continuousEffectInputState(state, ce),
      ce,
      getCardDefinitionById
    );
    if (amount === undefined) continue;
    total += amount;
  }

  // 動的フィルタ: targetInstanceId 未設定の CE（「すべて」系効果）
  if (targetCard && getCardDefinitionById) {
    const targetInstance = getCardById(state, targetInstanceId);
    const targetForFilter =
      targetCard.instanceId !== undefined
        ? targetCard
        : targetInstance !== undefined
          ? { ...targetCard, instanceId: targetInstance.instanceId }
          : targetCard;
    for (const ce of getGlobalCEs(state)) {
      if (ce.modifierTag !== "bp_modifier") continue;
      const inputState = continuousEffectInputState(state, ce);
      const amount = getCeBpAmount(inputState, ce, getCardDefinitionById);
      if (amount === undefined) continue;
      if (
        matchesGlobalCETargetFilter(
          inputState,
          ce,
          targetForFilter,
          getCardDefinitionById,
          undefined,
          getBpModifyEffectSourceDefinition(state, ce, getCardDefinitionById)
        ) &&
        targetInstance !== undefined &&
        globalBpModifierCanAffectCard(
          inputState,
          ce,
          targetInstance,
          getCardDefinitionById
        )
      ) {
        total += amount;
      }
    }
  }

  return total;
}

/**
 * field_colors_present の循環コピーだけを除いた、場の合体単位の実効シンボル色。
 * コピー元の固定・仮想合体・色追加を反映し、魂状態/下のカードは供給源にしない。
 */
function getColorsPresentOnField(
  state: GameState,
  playerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColor[] {
  const seen = new Set<SymbolColor>();
  const symbolState = {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) => ce.modifierSymbolSource?.kind !== "field_colors_present"
    ),
  };
  const soulStateIds = getEffectiveSoulStateIds(state, getCardDefinitionById);
  const sourceCards = new Map(
    state.cardInstances
      .filter(
        (card) => card.zone === "field" && card.controllerPlayerId === playerId
      )
      .map((card) => [card.instanceId, card])
  );
  for (const card of getExtendedFieldSymbolSourceCards(
    symbolState,
    playerId,
    getCardDefinitionById
  )) {
    sourceCards.set(card.instanceId, card);
  }
  for (const card of sourceCards.values()) {
    const def = getCardDefinitionForEffectiveFieldCard(
      card,
      getCardDefinitionById
    );
    if (!def) continue;
    if (
      card.zone === "field" &&
      (isCardTextCardState(card, state) ||
        soulStateIds.has(card.instanceId) ||
        isCombinedBrave(state, card, def))
    )
      continue;
    for (const s of getCombinedUnitSymbols(
      symbolState,
      card,
      def,
      getCardDefinitionById
    ))
      seen.add(s);
  }
  return [...seen];
}

/**
 * host (hostInstanceId) の roleTag 一致 text_role アンダーカードすべての base symbolColors
 * (definition.symbolColors) を「1 シンボル = 1 要素」の bundle 列として返す。
 * symbol_add の `under_card_symbols` 動的ソース用（BSAZ02-TX01(B) precedent）。
 * `field_colors_present` (union して 1 個の複数色バンドルにまとめる) と異なり、各アンダー
 * カードの各シンボルをそれぞれ個別の 1 シンボルとして加算する（原文「シンボルすべてを…得る」＝
 * 実在するシンボルの個数がそのまま増える）。裏向きアンダーカードは素性を持たないため除外する。
 */
function getUnderCardSymbolBundles(
  state: GameState,
  hostInstanceId: string,
  roleTag: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  filter?: CardFilter
): SymbolColor[][] {
  const host = getCardById(state, hostInstanceId);
  if (!host) return [];
  const bundles: SymbolColor[][] = [];
  for (const underId of filter
    ? host.underCards.map((entry) => entry.cardInstanceId)
    : textRoleUnderCardIdsOf(host, roleTag)) {
    const underCard = getCardById(state, underId);
    if (!underCard || underCard.faceDown) continue;
    const underDef = getCardDefinitionById(underCard.definitionId);
    if (!underDef) continue;
    if (
      filter &&
      !matchesCardReferenceFilter(underCard, underDef, filter, {
        state,
        getCardDefinitionById,
      })
    )
      continue;
    bundles.push(...getPrintedSymbolEntries(underDef));
  }
  return bundles;
}

/**
 * player の指定 zone にあり filter (省略時=無条件) に一致する各カードの base symbolColors
 * (definition.symbolColors) を「1 シンボル = 1 要素」の bundle 列として返す。
 * symbol_add の `zone_symbols` 動的ソース用（BSTH08.5-X04 precedent）。`under_card_symbols`
 * のホスト自身アンダーカード限定版に対し、任意ゾーン+CardFilter に一般化した版。
 * 裏向きカードは素性を持たないため除外する。
 */
function getZoneCardSymbolBundles(
  state: GameState,
  playerId: string,
  zone: Zone,
  filter: CardFilter | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColor[][] {
  const bundles: SymbolColor[][] = [];
  for (const card of state.cardInstances) {
    if (card.zone !== zone || card.controllerPlayerId !== playerId) continue;
    if (card.faceDown) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    if (filter && !matchesCardFilterByDef(def, filter)) continue;
    bundles.push(...getPrintedSymbolEntries(def));
  }
  return bundles;
}

/**
 * player がゲーム開始時に提示した契約カードの印字色を返す。
 * `presented_contract_color` 条件と同じく player.contractCardNo を正源にし、
 * CE / treat_as による実効色は参照しない。
 */
function getPresentedContractColors(
  state: GameState,
  playerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColor[] {
  const player = state.players.find((p) => p.id === playerId);
  const contractCardNo = player?.contractCardNo;
  if (!contractCardNo) return [];
  const def = getCardDefinitionById(contractCardNo);
  return [...(def?.colors ?? [])];
}

/**
 * 全体シンボル付与の作用免疫と include_all 対象取得を共通 gate で判定する。
 * blanket_affect_immunity は作用だけを貫通し、対象ロックは貫通しない。
 */
function globalSymbolAdditionCanAffectCard(
  state: GameState,
  ce: ContinuousEffect,
  targetCard: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const sourcePreventionLevel =
    ce.metadata?.preventionLevel === "unpreventable" ? "unpreventable" : "none";
  const bypass = readTargetLockBypassProfile(
    ce.metadata?.symbolAddSourceTargetLockBypass
  );
  const preventionBypass =
    readTargetLockBypassProfile(ce.metadata?.symbolAddSourcePreventionBypass) ??
    bypass;
  const identity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: ce.sourceInstanceId,
    sourceDefinitionId: ce.sourceDefinitionId,
    ...(ce.provenance?.effectSourceInstanceId
      ? { effectSourceInstanceId: ce.provenance.effectSourceInstanceId }
      : {}),
    ...(ce.provenance?.effectSourceDefinitionId
      ? { effectSourceDefinitionId: ce.provenance.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  const definition =
    identity.definition ??
    getCardDefinitionById(identity.definitionId ?? ce.sourceDefinitionId);
  if (
    resolveCardImmunityAffect(
      state,
      targetCard,
      ce.actingPlayerId,
      sourcePreventionLevel,
      {
        ...(identity.instance ? { instance: identity.instance } : {}),
        ...(definition ? { definition } : {}),
      },
      getCardDefinitionById,
      preventionBypass,
      "symbols"
    ).kind !== "allowed"
  )
    return false;
  const source: EffectSourceContext = {
    actingPlayerId: ce.actingPlayerId,
    sourceInstanceId: identity.instanceId,
    sourceDefinitionId: identity.definitionId ?? ce.sourceDefinitionId,
    prevention: normalizePreventionProfile({
      resistance: sourcePreventionLevel,
      ...(bypass ? { targetLockBypass: bypass } : {}),
    }),
    cause: "effect",
  };
  return (
    resolveTargetAcquisition(
      { source, targetClass: "card_or_zone", selectorIntent: "include_all" },
      cardTargetRef(targetCard),
      getTargetAcquisitionGatesForCard(
        state,
        targetCard,
        getCardDefinitionById,
        { source }
      )
    ).kind === "candidate"
  );
}

/**
 * 対象カードに適用中の symbol_addition 継続効果の追加シンボル一覧を返す。
 * 1 entry = 1 physical symbol; 複合色も1つの配列として保持する。
 * modifierSymbolSource はgetCardDefinitionByIdがある場合にlive評価する。
 */
export function getSymbolAdditions(
  state: GameState,
  targetInstanceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): SymbolColor[][] {
  const additions = memoizeContinuousEffectRead(
    state,
    getSymbolAdditions,
    [targetInstanceId, getCardDefinitionById],
    () => computeSymbolAdditions(state, targetInstanceId, getCardDefinitionById)
  );
  // Each caller owns its bundles, including callers nested in the same read.
  return additions.map((colors) => [...colors]);
}

function computeSymbolAdditions(
  ...[state, targetInstanceId, getCardDefinitionById]: Parameters<
    typeof getSymbolAdditions
  >
): SymbolColor[][] {
  const additions: SymbolColor[][] = [];
  const targetCard = getCardById(state, targetInstanceId);
  const globalAdditions =
    targetCard && getCardDefinitionById
      ? getGlobalCEs(state).filter((ce) => {
          if (ce.modifierTag !== "symbol_addition") return false;
          const inputState = continuousEffectInputState(state, ce);
          return (
            matchesGlobalCETargetFilter(
              inputState,
              ce,
              targetCard,
              getCardDefinitionById,
              getTotalCoresOnCardById(state, targetInstanceId)
            ) &&
            globalSymbolAdditionCanAffectCard(
              inputState,
              ce,
              targetCard,
              getCardDefinitionById
            )
          );
        })
      : [];
  for (const ce of [
    ...getCEsForTarget(state, targetInstanceId),
    ...globalAdditions,
  ]) {
    if (ce.modifierTag !== "symbol_addition") continue;
    const inputState = continuousEffectInputState(state, ce);
    if (ce.modifierSymbolSource) {
      if (!getCardDefinitionById) continue;
      if (ce.modifierSymbolSource.kind === "under_card_symbols") {
        additions.push(
          ...getUnderCardSymbolBundles(
            inputState,
            targetInstanceId,
            ce.modifierSymbolSource.roleTag,
            getCardDefinitionById,
            ce.modifierSymbolSource.filter
          )
        );
        continue;
      }
      if (ce.modifierSymbolSource.kind === "zone_symbols") {
        additions.push(
          ...getZoneCardSymbolBundles(
            inputState,
            ce.modifierSymbolSource.playerId,
            ce.modifierSymbolSource.zone,
            ce.modifierSymbolSource.filter,
            getCardDefinitionById
          )
        );
        continue;
      }
      const colors =
        ce.modifierSymbolSource.kind === "field_colors_present"
          ? getColorsPresentOnField(
              inputState,
              ce.modifierSymbolSource.playerId,
              getCardDefinitionById
            )
          : ce.modifierSymbolSource.kind === "presented_contract_colors"
            ? getPresentedContractColors(
                inputState,
                ce.modifierSymbolSource.playerId,
                getCardDefinitionById
              )
            : [];
      if (colors.length > 0) additions.push(colors);
      continue;
    }
    if (ce.modifierSymbol !== undefined && ce.modifierSymbol.length > 0) {
      // count: 「宣言した回数1につきシンボル1つ」等の動的個数（省略時=1）。
      // 1 CE で複数「独立した」シンボルを表す（dual-color の色配列とは別軸）。
      const count =
        ce.modifierSymbolCountDynamic !== undefined
          ? Math.max(
              0,
              evaluateContinuousDynamicAmount(
                inputState,
                ce.actingPlayerId,
                ce.modifierSymbolCountDynamic,
                getCardDefinitionById,
                dynamicCountContextForContinuousEffect(
                  inputState,
                  ce,
                  getCardDefinitionById
                )
              )
            )
          : (ce.modifierSymbolCount ?? 1);
      for (let i = 0; i < count; i++) {
        additions.push([...ce.modifierSymbol]);
      }
    }
  }
  return additions;
}

/**
 * turn スコープ Duration について、`turns` + `next` を合成した総ターン数を返す。
 * scope が turn 以外の場合は `Number.POSITIVE_INFINITY`（時間では期限切れ扱いしない）。
 *
 * P3-15 問題5 対応: turn スコープ期限判定ロジックを `legal-actions-shared` / `retrigger-system`
 * の重複から本関数群に集約。
 */
export function getDurationTotalTurns(duration: Duration): number {
  if (duration.scope !== "turn") return Number.POSITIVE_INFINITY;
  const baseTurns = duration.turns ?? 1;
  return baseTurns + (duration.next ? 1 : 0);
}

/**
 * 指定 turn_end 時点で `duration` が消滅すべきか判定する。
 * - scope が turn 以外: 時間トリガーでは消滅しない → false
 * - scope="turn": `elapsed >= totalTurns - 1` の turn_end で消滅
 *   - 既定 turns=1 → 作成ターンの turn_end で消滅
 *   - turns=N → N 回分 turn_end を生き延びる
 *   - next=true → さらに +1 回延命
 */
export function shouldExpireDurationAtTurnEnd(
  duration: Duration,
  createdAtTurn: number,
  currentTurnNumber: number
): boolean {
  if (duration.scope !== "turn") return false;
  const totalTurns = getDurationTotalTurns(duration);
  const elapsed = currentTurnNumber - createdAtTurn;
  return elapsed >= totalTurns - 1;
}

/**
 * 現在時点 (`currentTurnNumber`) で turn スコープ `duration` が有効か判定する。
 * - scope が turn 以外: 時間では無効化しない → true
 * - scope="turn": `elapsed ∈ [0, totalTurns)` なら有効
 */
export function isDurationActiveAtTurn(
  duration: Duration,
  createdAtTurn: number,
  currentTurnNumber: number
): boolean {
  if (duration.scope !== "turn") return true;
  const totalTurns = getDurationTotalTurns(duration);
  const elapsed = currentTurnNumber - createdAtTurn;
  return elapsed >= 0 && elapsed < totalTurns;
}

function isBattleEndScopeFinalizationPending(
  state: GameState,
  attackId: string
): boolean {
  return (
    state.pendingBattleEndFinalizeAttackIds.includes(attackId) ||
    hasPendingBattleEndFinalizeBlockers(state, attackId)
  );
}

/**
 * 期限切れの継続効果を除去する。
 * - scope="turn": 既定では turn_end 1 回で消滅。`turns: N` で N 回分、`next: true` でさらに +1 回延命。
 *   `whose="opponent"` は将来拡張用（現状は経過 turn_end 数のみで判定）。
 * - scope="battle" / "attack": 指定 attackId と一致しない効果を除去。本エンジンは
 *   複数ブロッカーを含む 1 attack 分のバトルを単一の battle_end で一括解決する
 *   ([[project_simultaneous_attack_multi_block]]) ため、両 scope のライフサイクルは
 *   同一 (ENGINE-attack-scope-ce-expiry: scope:"attack" は従来 battle_end で除去されず
 *   permanent 相当に残留する bug だった)。
 *   `untilTurnEnd` がある場合は、battle_end が未到達でも turn_end で除去。
 *   `nextBattleEnd` がある場合は turn_end では除去せず、登録元バトルの battle_end も
 *   生き延び、次に閉じるバトルの battle_end で除去（ターン限定語なしの「次のバトル終了後
 *   まで」。model.ts:Duration.nextBattleEnd 参照）。
 * - scope="step": `step_end` トリガーで、`duration.step` が離脱中ステップと一致する効果を除去。
 *   `duration.step` 未指定の step スコープは、いずれのステップ離脱でも除去（保守的）。
 *   `duration.whose` 指定時は、離脱中ステップのアクティブプレイヤー
 *   (`trigger.activePlayerId`) が `effect.actingPlayerId` と一致するか（"self"）/
 *   一致しないか（"opponent"）でも絞り込む。「次の自分のスタートステップまで」型
 *   (`{scope:"step", step:"start", whose:"self"}`) を正しく表現するための絞り込みで、
 *   `whose` 未指定時は従来通りステップ種別のみで判定する（後方互換）。
 * - scope="permanent" / "while_on_field" / "while_set" / "while_in_trash" /
 *   "while_in_set_aside" / "while_revealed": 時間トリガーでは除去しない (ゾーン離脱でのみ除去)。
 */
export function removeExpiredContinuousEffects(
  state: GameState,
  trigger:
    | { kind: "turn_end" }
    | { kind: "battle_end"; attackId: string }
    | { kind: "step_end"; step: Step; activePlayerId: string },
  opts?: {
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): ContinuousEffect[] {
  return state.activeContinuousEffects.flatMap((effect) => {
    // duration_override CE (ENGINE-continuous-effect-duration-rewrite) が対象なら
    // 実効 duration (書き換え後) で失効判定する。省略時は effect.duration のまま。
    const effectiveDuration = getEffectiveDuration(
      state,
      effect,
      opts?.getCardDefinitionById
    );
    const survives = survivesExpiryTrigger(
      state,
      effect,
      effectiveDuration,
      trigger
    );
    if (!survives) return [];
    // duration_override が適用された CE は、実効 duration をそのまま確定 (書き戻し) する。
    // override 側 CE は timingScope (「自分のターン」等) で活性が変動するため、都度
    // isCEActiveForScope で再判定すると、書き換え後に非活性ターンへ入った瞬間に判定が
    // 元の duration.scope へ巻き戻り、意図しない早期失効/残留を招く
    // (adversarial verifier lens4 指摘、BSLH01-X03)。一度 override が適用された時点で
    // 対象 CE 自身の duration を確定させ、以後は override 側の活性に非依存にする。
    if (effectiveDuration !== effect.duration) {
      return [{ ...effect, duration: effectiveDuration }];
    }
    return [effect];
  });
}

function survivesExpiryTrigger(
  state: GameState,
  effect: ContinuousEffect,
  effectiveDuration: Duration,
  trigger:
    | { kind: "turn_end" }
    | { kind: "battle_end"; attackId: string }
    | { kind: "step_end"; step: Step; activePlayerId: string }
): boolean {
  const { scope } = effectiveDuration;
  if (
    scope === "permanent" ||
    scope === "while_on_field" ||
    scope === "while_set" ||
    scope === "while_in_trash" ||
    scope === "while_in_set_aside" ||
    scope === "while_revealed" ||
    // ENGINE-effect-immunity-own-pending-resolution: turn/battle/step_end では
    // 自然消滅せず、宣言者自身の effect_activated (発揮完了直後) でのみ除去される
    // (removeUntilEventContinuousEffects 参照)。
    scope === "while_own_declaration_pending"
  )
    return true;
  if (trigger.kind === "turn_end") {
    if (effectiveDuration.untilTurnEnd === true) return false;
    if (scope !== "turn") return true;
    return !shouldExpireDurationAtTurnEnd(
      effectiveDuration,
      effect.createdAtTurn,
      state.turnNumber
    );
  }
  if (trigger.kind === "battle_end") {
    if (scope !== "battle" && scope !== "attack") return true;
    if (
      effectiveDuration.untilTurnEnd === true ||
      effectiveDuration.nextBattleEnd === true
    ) {
      // createdAtAttackId===null (登録元でアクティブなバトルが無かった、例:
      // duration_override が main step 中に生成された scope:"turn" CE を
      // scope:"battle"+nextBattleEnd へ書き換えたケース) は、"登録元バトル" 概念が
      // 存在しないため、この条件は常に false=除去される。これは意図通り: 「次に
      // 閉じるバトル」= 登録後最初に閉じるバトルであり、それがまさに現在の
      // trigger.attackId である (adversarial verifier lens3 で指摘されたが、
      // pre_declaration_stack null 処理 (下記) と同型の既存意味論と確認済み。
      // BSLH01-X03 テスト参照)。
      return (
        effect.createdAtAttackId !== null &&
        effect.createdAtAttackId === trigger.attackId
      );
    }
    if (
      effect.createdAtAttackId !== null &&
      effect.createdAtAttackId === trigger.attackId &&
      isBattleEndScopeFinalizationPending(state, trigger.attackId)
    ) {
      return true;
    }
    // pre_declaration_stack 中に登録した battle/attack CE は activeAttack 未確定なので
    // createdAtAttackId=null (effect-interpreter.ts:8015 ほか)。次に閉じる battle_end で
    // 失効させる (本来狙った直近バトルの終端)。null を放置すると `null !== X` が常に
    // true となり後続バトルへ silent に残留する pre-existing bug。
    // 参照: needs-dsl ENGINE-pre-declaration-stack-battle-ce-expiry。
    if (effect.createdAtAttackId === null) return false;
    return effect.createdAtAttackId !== trigger.attackId;
  }
  if (trigger.kind === "step_end") {
    if (scope !== "step") return true;
    // duration.step 指定時は、その step を離れるときだけ消滅させる。
    if (effectiveDuration.step && effectiveDuration.step !== trigger.step)
      return true;
    // duration.whose 指定時は、離脱プレイヤーが「自分」("self") か「相手」("opponent")
    // かでも絞り込む。「次の自分のスタートステップまで」= whose:"self" は、
    // 効果発動者 (actingPlayerId) 自身がそのステップを離れるときだけ消滅させる。
    if (effectiveDuration.whose) {
      const leavingIsActingPlayer =
        trigger.activePlayerId === effect.actingPlayerId;
      const matchesWhose =
        effectiveDuration.whose === "self"
          ? leavingIsActingPlayer
          : !leavingIsActingPlayer;
      if (!matchesWhose) return true;
    }
    // next:true → 作成ターン内の最初の一致 (登録直後にそのステップ自身が閉じる場合) では
    // 消滅させず、次巡目の一致まで延命する（「次の自分のXステップまで」型、scope="turn" の
    // next と同型の意味論。BSTH05.5-XX01【神域】「次の『自分のエンドステップ』まで」が初出）。
    if (
      effectiveDuration.next === true &&
      state.turnNumber === effect.createdAtTurn
    ) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * 効果解決後の再計算節目で呼ぶ。盤面状態に基づき無効化すべき継続効果を除去する。
 * - this_battle: 該当バトルが終了済みなら除去。
 * - target 指定効果: 対象カードがフィールドに不在なら除去 (player-scoped CE は除く)。
 */
export function recomputeContinuousEffects(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const activeEffects = state.activeContinuousEffects;
  if (activeEffects.length === 0) return state;
  const underCardScopeIds = collectUnderCardScopeIds(state);

  const recomputed = activeEffects.filter((effect) => {
    const sourceCard = getCardById(state, effect.sourceInstanceId);
    const origin = getCardDefinitionById
      ? resolveProvenanceEffectForTiming({
          state,
          ce: effect,
          getCardDefinitionById,
        })
      : undefined;
    if (
      getCardDefinitionById &&
      !isContinuousEffectStillValid(state, effect, getCardDefinitionById)
    ) {
      return false;
    }
    // 発揮資格の正源は元 Effect。解決済みの起動・誘発効果には再適用しない。
    // 定義/provenance を持たない旧 CE のみ、保存済み zone を共通評価器へ渡す。
    const sourceApplicabilityZone = origin
      ? origin.timing.kind === "continuous"
        ? origin.applicability?.zone
        : undefined
      : (effect.metadata?.sourceApplicabilityZone as
          | ApplicabilityZone
          | ApplicabilityZone[]
          | undefined);
    const hasSourceApplicability = sourceApplicabilityZone !== undefined;
    if (
      !origin &&
      hasSourceApplicability &&
      (!sourceCard ||
        !evaluateEffectApplicabilityForCard({
          state,
          applicability: { zone: sourceApplicabilityZone },
          card: sourceCard,
          definition: getCardDefinitionById?.(sourceCard.definitionId),
          getCardDefinitionById: getCardDefinitionById ?? (() => undefined),
          getCurrentLevel: getEffectiveLevel,
        }))
    )
      return false;

    // while_on_field: ソースカードがフィールド不在なら除去
    if (effect.duration.scope === "while_on_field" && !hasSourceApplicability) {
      if (!sourceCard) {
        return false;
      }
      if (
        sourceCard.zone !== "field" ||
        underCardScopeIds.adventSource.has(sourceCard.instanceId)
      ) {
        return false;
      }
    }

    // while_target_on_field: while_on_field と同じ判定だが、見る対象がソースカードではなく
    // 対象カード (targetInstanceId)。免疫判定用の sourceInstanceId (真の効果発生源) は
    // 変えずに、CE 自体の寿命だけ対象カードの在場に紐づけたい合成効果専用
    // (BSFT01-TR03(A) 借用効果スティール抑止、effect-borrowing.ts applyBorrowedEffectSuppression)。
    if (effect.duration.scope === "while_target_on_field") {
      const targetCard = effect.targetInstanceId
        ? getCardById(state, effect.targetInstanceId)
        : undefined;
      if (!targetCard || targetCard.zone !== "field") {
        return false;
      }
    }

    // while_set: ソースカードがバースト/ミラージュのセット状態を外れたら除去。
    // バーストは発動宣言後も zone:"burst" に残るため、setBurstStates を見る。
    if (effect.duration.scope === "while_set" && !hasSourceApplicability) {
      const sourceCard = getCardById(state, effect.sourceInstanceId);
      if (!sourceCard || !isCardInSetState(state, sourceCard)) {
        return false;
      }
    }

    // while_in_trash: ソースカードがトラッシュゾーン不在なら除去
    // 「トラッシュにあるこのカードは効果を受けない」型のゾーン束縛常時耐性に使用。
    // while_set と対称 (continuous-effect-rebuild が再入場時に再登録する)。
    if (effect.duration.scope === "while_in_trash" && !hasSourceApplicability) {
      const sourceCard = getCardById(state, effect.sourceInstanceId);
      if (!sourceCard || sourceCard.zone !== "trash") {
        return false;
      }
    }

    // while_in_set_aside: ソースカードが手元 (set_aside) を離れたら除去。
    // 手元常駐効果は while_set (burst/mirage のセット状態専用) で表せないため、
    // set_aside のゾーン寿命を明示する。
    if (
      effect.duration.scope === "while_in_set_aside" &&
      !hasSourceApplicability
    ) {
      const sourceCard = getCardById(state, effect.sourceInstanceId);
      if (!sourceCard || sourceCard.zone !== "set_aside") {
        return false;
      }
    }

    // while_revealed: ソースカードが revealed ゾーン不在なら除去
    // 「デッキからオープンされたこのカードは系統：「X」を持つ」型のゾーン束縛常時効果
    // (BSTH07.8-X02) に使用。while_set/while_in_trash と対称
    // (continuous-effect-rebuild が再オープン時に再登録する)。
    if (effect.duration.scope === "while_revealed" && !hasSourceApplicability) {
      const sourceCard = getCardById(state, effect.sourceInstanceId);
      if (!sourceCard || sourceCard.zone !== "revealed") {
        return false;
      }
    }

    if (
      (effect.duration.scope === "battle" ||
        effect.duration.scope === "attack") &&
      effect.createdAtAttackId !== null
    ) {
      if (
        effect.duration.untilTurnEnd === true ||
        effect.duration.nextBattleEnd === true
      ) {
        return true;
      }
      if (
        isBattleEndScopeFinalizationPending(state, effect.createdAtAttackId)
      ) {
        return true;
      }
      if (
        !state.activeAttack ||
        state.activeAttack.attackId !== effect.createdAtAttackId
      ) {
        return false;
      }
    }

    if (
      effect.targetInstanceId &&
      effect.duration.scope !== "while_set" &&
      effect.duration.scope !== "while_in_trash" &&
      effect.duration.scope !== "while_in_set_aside" &&
      effect.duration.scope !== "while_revealed"
    ) {
      // P3-77: player-scoped CE (restrict_* / player_effect_immunity) は
      // targetInstanceId に playerId を格納する (カードではない) ため、
      // 「対象カードが field 不在なら除去」の card 検査を適用してはならない。
      // 適用すると getCardById(playerId)=undefined → 即除去となり、
      // 「このターン、相手は〜できない」型の制限が次の recompute 節目で消える (pre-existing bug)。
      // burst 発動中ウィンドウ CE もバーストライフサイクルが手動で登録/除去するため対象外
      // (発動中はカードが burst→field 遷移中で zone が一定しない)。
      const burstWindowManaged =
        typeof (effect.metadata as { burstActivationWindow?: unknown })
          ?.burstActivationWindow === "string";
      // engine-player-scoped-turn-reservation: turnReservation CE (BSKB01-R04 等) は
      // targetInstanceId が grantee カード自身 (通常 sourceInstanceId と同一) だが、使用後
      // トラッシュへ行くマジック自身への自己付与のように grantee が場を離れることを前提と
      // する variant なので、targetInstanceId の card 検査 (「対象カードが field 不在なら
      // 除去」) を適用してはならない (continuous-effect-rebuild.ts /
      // native-ce-registration-handlers.ts / mechanic-trigger-handlers.ts /
      // legal-actions-availability.ts の同型バイパスと揃える、寿命は duration:{scope:"turn"}
      // のみで管理する)。
      const isTurnReservationGrant = effect.metadata?.turnReservation === true;
      if (
        state.players.some((player) => player.id === effect.targetInstanceId) ||
        burstWindowManaged ||
        isTurnReservationGrant
      ) {
        return true;
      }
      const targetCard = getCardById(state, effect.targetInstanceId);

      // 明示された発揮ゾーンを満たす自己対象 CE は、同じカードの field 不在だけで
      // 除去しない。他カードへの付与は、その対象の在場を引き続き要求する。
      const isApplicableSelfEffect =
        hasSourceApplicability &&
        effect.targetInstanceId === effect.sourceInstanceId;
      if (
        !targetCard ||
        (targetCard.zone !== "field" && !isApplicableSelfEffect)
      ) {
        return false;
      }
    }

    // while_set / while_in_trash / while_in_set_aside / while_revealed スコープの target 指定 CE (P3-119 根治,
    // while_revealed は ENGINE-revealed-zone-continuous-effect-applicability で追加): 上の
    // scope 別チェック (while_set はバースト/ミラージュ在場、while_in_trash はトラッシュ
    // 在場、while_in_set_aside は手元在場、while_revealed は revealed 在場を要求) が既に
    // ゾーン寿命を正しく判定済みなので、
    // ここで重ねて「targetInstanceId が field 不在なら除去」を適用すると必ず矛盾して即除去
    // される (バースト/トラッシュ/revealed のカードは定義上 field ではないため)。この矛盾が
    // executeTreatAs → recomputeContinuousEffects → rebuildContinuousEffectsFromField の
    // register/expire 無限往復 (fuzz gate ハングの真因) を起こしていた。

    return true;
  });

  if (recomputed.length === activeEffects.length) return state;

  const recomputedIds = new Set(recomputed.map((e) => e.effectId));
  const expired = activeEffects.filter((e) => !recomputedIds.has(e.effectId));

  state.log.push(
    ...expired.map(
      (e) =>
        `continuous-effect:expired:${e.effectId}:${e.modifierTag}:${e.duration}`
    )
  );
  // 発揮資格を与えるCEの失効が、別CEの資格も失わせる場合がある。
  // 削除のみの単調な再評価で、登録側と同じ評価器を盤面が安定するまで使う。
  const next = { ...state, activeContinuousEffects: recomputed };
  return getCardDefinitionById
    ? recomputeContinuousEffects(next, getCardDefinitionById)
    : next;
}

export function getRequiredTargetCount(
  actionRegistration: RegisteredTargetedEffectActionBase
): number {
  return actionRegistration.requiredTargetCount ?? 0;
}

/**
 * 対象選択数の上限を取得する。
 * registration.maxTargetCount が requiredTargetCount より大きい場合は可変選択。
 * それ以外は固定数（requiredTargetCount に等しい）。
 * D-2 Phase 2 - 複数選択。
 */
export function getMaxTargetCount(
  actionRegistration: RegisteredTargetedEffectActionBase
): number {
  const required = actionRegistration.requiredTargetCount ?? 0;
  const max = actionRegistration.maxTargetCount;
  if (max === undefined || max < required) return required;
  return max;
}

export function getTargetMode(
  requiredTargetCount: number,
  maxTargetCount?: number
): LegalActionTargetMode {
  // min=0 でも max>0 なら任意選択モード（0 体〜max 体）
  if (requiredTargetCount > 0) return "manual";
  if (maxTargetCount !== undefined && maxTargetCount > 0) return "manual";
  return "none";
}

/**
 * 空撃ち（対象不在でも効果を使用可能）に対応した実効対象数を算出する。
 * ルール正源: manual/ai-reference/10_rules/03b_resolution-and-interrupts.md「空撃ち」(131-)。
 *
 * - 候補が必要数以上: そのまま（通常の対象選択）。
 * - 候補が必要数未満:
 *   - `gatedByConditionalCost`（「○○することで△△する」の効果側）→ `block: true`。
 *     対象が無いとき△△が成立せず、コスト○○だけ払うことは双方向ルール(03b:34)で禁止。
 *   - それ以外（単純な効果範囲 = 「N体を破壊する」等）→ 「可能な限り選ぶ」に従い
 *     実効必要数＝候補数（0 体なら空撃ち＝対象なしで使用）。
 *
 * 返す requiredTargetCount / maxTargetCount をそのまま legal action に載せることで、
 * apply 側の `resolveLegalActionTargets` 検証（targetMode "none" or 範囲内）も整合する。
 */
export function resolveEmptyFireTargetCounts(args: {
  requiredTargetCount: number;
  maxTargetCount: number;
  candidateCount: number;
  gatedByConditionalCost: boolean;
  requiresFullCount?: boolean;
}): { block: boolean; requiredTargetCount: number; maxTargetCount: number } {
  const {
    requiredTargetCount,
    maxTargetCount,
    candidateCount,
    gatedByConditionalCost,
    requiresFullCount = false,
  } = args;
  if (maxTargetCount < requiredTargetCount) {
    return { block: true, requiredTargetCount, maxTargetCount };
  }
  if (candidateCount >= requiredTargetCount) {
    return { block: false, requiredTargetCount, maxTargetCount };
  }
  if (gatedByConditionalCost || requiresFullCount) {
    return { block: true, requiredTargetCount, maxTargetCount };
  }
  // 空撃ち / 部分撃ち: 候補数を実効必要数・上限とする（0 体なら targetMode "none"）。
  return {
    block: false,
    requiredTargetCount: candidateCount,
    maxTargetCount: candidateCount,
  };
}

export function getTargetEffectFilterTags(
  actionRegistration: RegisteredTargetedEffectActionBase
) {
  return actionRegistration.targetEffectFilterTags ?? ["general"];
}

// ════════════════════════════════════════════════════════════════
// 実効 BP の正源 (getEffectiveBp)
// ════════════════════════════════════════════════════════════════
//
// SSOT: カードの「現在の BP」を返す唯一の正源。divineTransform / 現在レベル(コア数) /
// override_properties / 消滅待機 snapshot / bp_modifier CE / act_as_spirit(分身) を
// 全て織り込む。CardFilter の minBp/maxBp 判定・battle 対決・copy_from snapshot 等、
// BP を参照する全経路はこの関数を通すこと（印字 def.levelDefs[0].bp の直読みをしない）。
//
// 配置理由: getEffectiveBp は getBpModifierTotal / getOverriddenProperties
// (本モジュール) に依存する。候補列挙 getCandidateTargetInstanceIds も同じ実効 BP を
// 必要とするが、battle-shared → legal-actions-shared の片方向依存のため
// legal-actions-shared から battle-shared を import できない。よって正源を本モジュールに
// 置き、battle-shared 側は re-export する（DI で配り直す並行写像を避ける）。

/** 転神/印字の BP 表を、Lv コスト変更を含む実効 Lv で参照する。 */
function getResolvedBpForBattleEntity(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const currentLevel = getEffectiveLevel(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById
  );
  // 転神/転者状態: divineTransformState の BP 定義を使用
  if (sourceCard.divineTransformState) {
    // divineTransformState.bpByLevel からカレントレベル以下の最大 BP を取得
    let bp = 0;
    for (const entry of sourceCard.divineTransformState.bpByLevel) {
      if (entry.level <= currentLevel) {
        bp = Math.max(bp, entry.bp);
      }
    }
    return bp;
  }

  return getPrintedBpAtLevel(sourceDefinition, currentLevel);
}

/**
 * 指定 Lv 以下の levelDefs のうち最大 BP を返す（Ver.17.0 例2 の消滅待機 base BP 用）。
 * コア数ではなく Lv をキーに引くことで、コアが全移動して Lv0 でも消滅時 Lv の印字 BP を得る。
 */
function getPrintedBpAtLevel(
  definition: CardDefinition,
  level: number
): number {
  return definition.levelDefs.reduce((highestBp, levelDef) => {
    return levelDef.level <= level
      ? Math.max(highestBp, levelDef.bp ?? 0)
      : highestBp;
  }, 0);
}

/**
 * カードの実効 BP を返す。base BP (levelDefs + core count) に bp_modifier CE を加算。
 * override_properties CE による BP 上書きがある場合はそちらを base として使用。
 * BP は 0 未満にはならない。
 */
export function getEffectiveBp(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number {
  return Math.max(
    0,
    getBpBeforeFloor(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById,
      visited
    )
  );
}

/** 合体ユニットを合算するまでマイナス分を保持する内部計算。公開BPは必ず0以上にする。 */
function getBpBeforeFloor(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number {
  // act_as_spirit (P3-47 F-2) — token は本体追従の BP を返す。
  // 分身がコピーする「このスピリット」= 合体ユニットなので、live_copy では
  // source host の合体ブレイヴの BP＋ も含めた合体 BP を追従する
  // (シンボル resolveActAsSpiritSymbolBundles と同じ合体ユニット扱い・裁定 2026-06-01)。
  if (getCardDefinitionById) {
    const tokenBp = resolveActAsSpiritBp(
      state,
      sourceCard,
      (s, c, d, v) => getCombinedUnitBp(s, c, d, getCardDefinitionById, v),
      getCardDefinitionById,
      visited
    );
    if (tokenBp !== undefined) {
      const modifier = getBpModifierTotal(
        state,
        sourceCard.instanceId,
        {
          controllerPlayerId: sourceCard.controllerPlayerId,
          definitionId: sourceCard.definitionId,
          instanceId: sourceCard.instanceId,
        },
        getCardDefinitionById
      );
      return tokenBp + modifier;
    }
  }

  // act_as_spirit でなく def も無い (viewer sanitize 済 _hidden_card_ 等) なら算出不能 → 0
  if (!sourceDefinition) return 0;

  // override_properties による BP 上書き
  const overridden = getOverriddenProperties(
    state,
    sourceCard.instanceId,
    getCardDefinitionById
  );
  let baseBp: number;
  if (overridden?.bp) {
    const currentLevel = getEffectiveLevel(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById
    );
    const overriddenLevelDefs = [
      { bp: overridden.bp.lv1 },
      ...(overridden.bp.lv2 !== undefined ? [{ bp: overridden.bp.lv2 }] : []),
      ...(overridden.bp.lv3 !== undefined ? [{ bp: overridden.bp.lv3 }] : []),
    ];
    // 印字/転神と同じ実効 Lv を使い、上書き BP のレベル順序を維持する。
    baseBp = sourceDefinition.levelDefs.reduce(
      (max, ld, i) =>
        ld.level <= currentLevel
          ? Math.max(max, overriddenLevelDefs[i]?.bp ?? 0)
          : max,
      overriddenLevelDefs[0]?.bp ?? 0
    );
  } else if (
    sourceCard.pendingLeaveKind === "vanish" &&
    sourceCard.pendingLeaveLvSnapshot !== null &&
    !sourceCard.divineTransformState
  ) {
    // Ver.17.0 例2/例1: 消滅待機はコア全移動で Lv0 でも、消滅時 Lv の印字 BP を base にし、
    // 待機中も残る継続効果 (例1: BP+3000) は下の bp_modifier 加算で維持される。
    baseBp = getPrintedBpAtLevel(
      sourceDefinition,
      sourceCard.pendingLeaveLvSnapshot
    );
  } else {
    baseBp = getResolvedBpForBattleEntity(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById
    );
  }

  const modifier = getBpModifierTotal(
    state,
    sourceCard.instanceId,
    {
      controllerPlayerId: sourceCard.controllerPlayerId,
      definitionId: sourceCard.definitionId,
      instanceId: sourceCard.instanceId,
    },
    getCardDefinitionById
  );
  const controller = state.players.find(
    (player) => player.id === sourceCard.controllerPlayerId
  );
  const overCount = sourceDefinition.overCount;
  const ocBonus =
    overCount &&
    !isCardTextCardState(sourceCard, state) &&
    (controller?.countValue ?? 0) >= overCount.minCount
      ? overCount.bpBonus
      : 0;
  return baseBp + ocBonus + modifier;
}

/**
 * 合体スピリット (1体) のBP。本体・合体ブレイヴ・仮想ブレイヴのBPと修正値を
 * 合算した後にだけ0へ丸める。途中で丸めるとBP-の超過分が失われ、
 * ブレイヴのBP＋が残ってBP0破壊を免れる（エターナルQ164/Q165、10_rules/03c・05）。
 *
 * ブレイヴのBP＋はcombinedBoostを使い、未設定時のみ共有コア数での印字BPへ
 * フォールバックする。getEffectiveBpの公開契約（単体BP・0以上）は維持する。
 */
export function getCombinedUnitBp(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number {
  const hostBp = getBpBeforeFloor(
    state,
    card,
    definition,
    getCardDefinitionById,
    visited
  );

  const braveChildren = getCombinedUnitBraveChildren(
    state,
    card,
    getCardDefinitionById
  );

  const virtualBpPlus = getVirtualCombinedBraveBpPlusTotal(
    state,
    card.instanceId
  );

  if (braveChildren.length === 0) return Math.max(0, hostBp + virtualBpPlus);

  // 合体スピリット上のコア総数 (host + 合体ブレイヴ)。各カードはこの共有コア数で
  // それぞれの Lv を判定する (10_rules/05: Lv ごとのコア数は合算しない)。
  let combinedCores = getTotalCoresOnCardById(state, card.instanceId);
  for (const brave of braveChildren) {
    combinedCores += getTotalCoresOnCardById(state, brave.instanceId);
  }

  let braveBpTotal = 0;
  for (const brave of braveChildren) {
    const braveDef = getCardDefinitionById?.(brave.definitionId);
    if (!braveDef) continue;
    // ブレイヴの『BP＋』= 印字された `(0)合体 +N` の値（combinedBoost）。
    // これはスピリット状態の Lv1 BP（levelDefs）とは別の印字値（10_rules/05）。
    // combinedBoost 未設定のカードのみ、後方互換で共有コア数到達 Lv の印字 BP へフォールバック。
    const bpPlus =
      braveDef.combinedBoost ??
      braveDef.levelDefs.reduce(
        (highest, ld) =>
          ld.requiredCores <= combinedCores
            ? Math.max(highest, ld.bp ?? 0)
            : highest,
        0
      );
    const braveModifier = getBpModifierTotal(
      state,
      brave.instanceId,
      {
        controllerPlayerId: brave.controllerPlayerId,
        definitionId: brave.definitionId,
        instanceId: brave.instanceId,
      },
      getCardDefinitionById
    );
    braveBpTotal += bpPlus + braveModifier;
  }

  return Math.max(0, hostBp + braveBpTotal + virtualBpPlus);
}

export function getCombinedUnitBraveChildren(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): CardInstance[] {
  const children: CardInstance[] = [];
  const pushIfCombinedBrave = (candidate: CardInstance | undefined) => {
    if (!candidate || candidate.zone !== "field") return;
    const isLeftCombined = candidate.attachedToInstanceId === card.instanceId;
    const isRightCombined =
      candidate.imaginRightCombinedWith === card.instanceId;
    if (!isLeftCombined && !isRightCombined) return;
    const candidateDef = getCardDefinitionById?.(candidate.definitionId);
    if (candidateDef?.printedCategory !== "brave") return;
    if (isCardTextCardState(candidate, state)) return;
    if (children.some((child) => child.instanceId === candidate.instanceId))
      return;
    children.push(candidate);
  };

  for (const childId of card.attachedChildrenIds) {
    pushIfCombinedBrave(
      state.cardInstances.find((c) => c.instanceId === childId)
    );
  }
  for (const candidate of state.cardInstances) {
    if (candidate.attachedToInstanceId !== card.instanceId) continue;
    if (candidate.zoneRoleName !== "brave") continue;
    pushIfCombinedBrave(candidate);
  }
  for (const candidate of state.cardInstances) {
    if (candidate.imaginRightCombinedWith !== card.instanceId) continue;
    pushIfCombinedBrave(candidate);
  }

  return children;
}

export const DEFAULT_CANDIDATE_TARGET_ZONES = [
  "field",
] as const satisfies readonly Zone[];

export function getCandidateTargetZones(
  actionRegistration: RegisteredTargetedEffectActionBase
) {
  return (
    actionRegistration.candidateTargetZones ?? DEFAULT_CANDIDATE_TARGET_ZONES
  );
}

/**
 * 極値セレクタ（CardFilter.extremal）の SSOT。候補 instanceId 集合を、指定メトリックが
 * 最小（"lowest"）/ 最大（"highest"）のカードだけに絞る。「最もBPの低い相手1体を破壊」型。
 * タイ時は全タイ候補を残し（標準ルール: 「最も〜」が複数なら効果の持ち主が対象を選ぶ）、
 * 後段の count 選択に委ねる。候補列挙（getCandidateTargetInstanceIds）と解決
 * （target-resolution）の両経路で同じこの関数を通し、選べる対象と実際に取れる対象を一致させる。
 *
 * メトリック値が算出できないカード（bp/core: 場外、bp/cost: def 不明）は極値計算から
 * 除外する。算出可能な候補が皆無なら空集合を返す（fail-closed。極値参照効果は対象が場の
 * カードである前提のため permissive には倒さない）。
 * metric "core" は getTotalCoresOnCardById（通常 + ソウル、SSOT）で場のカードのコア数を測る。
 */
export function selectExtremalInstanceIds(
  state: GameState,
  instanceIds: readonly string[],
  extremal: NonNullable<CardFilter["extremal"]>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const valued: { id: string; value: number }[] = [];
  for (const id of instanceIds) {
    const card = getCardById(state, id);
    if (!card) continue;
    const def = getCardDefinitionById(card.definitionId);
    const value =
      extremal.metric === "bp"
        ? card.zone === "field"
          ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
          : undefined
        : extremal.metric === "core"
          ? card.zone === "field"
            ? getTotalCoresOnCardById(state, card.instanceId)
            : undefined
          : def?.cost;
    if (value !== undefined) valued.push({ id, value });
  }
  if (valued.length === 0) return [];
  const values = valued.map((v) => v.value);
  const best =
    extremal.mode === "lowest" ? Math.min(...values) : Math.max(...values);
  return valued.filter((v) => v.value === best).map((v) => v.id);
}

/**
 * viewer に印字 def が伏せられた裏向きカード (_hidden_card_) を matchesCardFilter に
 * かけるための null-identity placeholder 定義。
 *
 * 裏向きフィールドカードの素性は印字 def ではなく実効 getter で決まる:
 * - category: `getEffectiveCategory` が act_as_spirit を "spirit"、それ以外を undefined
 *   (P3-69 素性なし) に解決する（裏向きカードに対しては def を読まない）。
 * - BP: `getCombinedUnitBp` が act_as_spirit の本体追従 BP と合体 BP を返す（def 不要）。
 *
 * よってこの placeholder の印字値 (colors/levelDefs/name 等) は state 文脈 (null-identity)
 * では一切読まれない。唯一 def を読む grandwalker 判定が誤発火しないよう
 * grandwalkerData を未設定 (= 非創界神) にしておく。
 */
const HIDDEN_CARD_NULL_IDENTITY_DEF: CardDefinition = {
  cardNo: "_hidden_card_",
  name: "",
  printedCategory: "spirit",
  colors: [],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

/** Field filters discard concealed printing even when the owner knows it.
 * Name predicates use the common public-name resolver on that null definition;
 * other predicates do not evaluate names or introduce their dependencies.
 */
export function getCardDefinitionForEffectiveFieldCard(
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  context?: EffectivePropertyEvaluationOptions & {
    state: GameState;
    filter: CardFilter;
  }
): CardDefinition | undefined {
  if (!card.faceDown || card.zone !== "field") {
    return getCardDefinitionById(card.definitionId);
  }
  if (!context || !cardFilterNeedsEffectiveName(context.filter)) {
    return HIDDEN_CARD_NULL_IDENTITY_DEF;
  }
  const name = getEffectiveCardName(
    context.state,
    card,
    HIDDEN_CARD_NULL_IDENTITY_DEF,
    getCardDefinitionById,
    context
  );
  return name === ""
    ? HIDDEN_CARD_NULL_IDENTITY_DEF
    : { ...HIDDEN_CARD_NULL_IDENTITY_DEF, name };
}

export function getCandidateTargetInstanceIds(
  state: GameState,
  actingPlayerId: string,
  actionRegistration: RegisteredTargetedEffectActionBase,
  options?: {
    /** P3-52: target.filter (CardFilter) を適用するために必要。 */
    getCardDefinitionById?:
      | ((id: string) => CardDefinition | undefined)
      | undefined;
    /** P3-52: target.excludeSelf=true の場合に除外する効果発動元 instanceId。 */
    sourceInstanceId?: string;
    /**
     * `cardName: "self"` フィルタを解決するための効果発動元 CardDefinition。
     * 指定が無いと matchesCardFilter は `cardName: "self"` を false にして候補を空にする。
     */
    sourceDefinition?: CardDefinition;
    /**
     * Affect/immunity/prevention gate 用の source identity。
     *
     * `sourceInstanceId` は target.excludeSelf / source under-card scope など action host 文脈にも
     * 使うため、text_role/quartz/combined brave の provider identity をここで別管理する。
     */
    affectSourceIdentity?: ResolvedAffectSourceIdentity;
    evaluateCondition?: (
      condition: Condition,
      sourceInstanceId: string,
      actingPlayerId: string
    ) => boolean;
    evaluateApplicability?: (
      applicability: NonNullable<Effect["applicability"]>,
      sourceInstanceId: string
    ) => boolean;
    /**
     * ENGINE-brave-combine-third-party-target: `braveCombineHostOnly` の判定基準を
     * `sourceDefinition` ではなく指定したブレイヴの定義にする。未指定時は従来どおり
     * `sourceDefinition` を基準にする（既存 BSFT01 系との後方互換）。
     */
    braveCombineIncomingBraveDefinition?: CardDefinition;
    /**
     * ENGINE-brave-combine-cannot-combine-candidate-gate:
     * 合体元ブレイヴ自身が cannot_combine を持つ場合、実行時 no-op ではなく候補列挙時点で
     * host 候補を空にするために使う。未指定時は sourceInstanceId を合体元として扱う。
     */
    braveCombineIncomingBraveInstanceId?: string;
    /** restricted「防げない」bypass。未指定なら sourceInstanceId から動的 CE を導出する。 */
    sourcePreventionBypass?: TargetLockBypassProfile;
  }
): string[] {
  if (actionRegistration.targetGroups?.length) {
    const { targetGroups: _targetGroups, ...baseRegistration } =
      actionRegistration;
    const ids = actionRegistration.targetGroups.flatMap((group) =>
      getCandidateTargetInstanceIds(
        state,
        actingPlayerId,
        mergeTargetGroupRegistration(baseRegistration, group),
        options
      )
    );
    return Array.from(new Set(ids));
  }
  const candidateTargetZones = getCandidateTargetZones(actionRegistration);
  const targetPlayerScope =
    actionRegistration.candidateTargetPlayerScope ?? "any";
  const setBurstCandidateIds =
    actionRegistration.targetCandidatesRequireSetBurstState === true
      ? new Set(
          state.setBurstStates
            .filter((setState) => {
              if (targetPlayerScope === "any") return true;
              if (targetPlayerScope === "acting_player") {
                return setState.playerId === actingPlayerId;
              }
              return setState.playerId !== actingPlayerId;
            })
            .map((setState) => setState.cardInstanceId)
        )
      : null;
  const adventSourceIdsForOwnerScope =
    actionRegistration.candidateIncludeAdventSource === true
      ? collectUnderCardScopeIds(state).adventSource
      : null;
  const scopePlayerIdForCandidate = (cardInstance: CardInstance): string => {
    // Field cards are controlled objects; hand/trash/set_aside/etc. are owner
    // zones. summon.target.from_zone execution uses ownerPlayerId, so GUI
    // target candidates must use the same basis for non-field zones.
    if (
      cardInstance.zone !== "field" ||
      adventSourceIdsForOwnerScope?.has(cardInstance.instanceId)
    ) {
      return cardInstance.ownerPlayerId;
    }
    return cardInstance.controllerPlayerId;
  };
  const scopedByPlayer = (cardInstance: CardInstance): boolean => {
    if (targetPlayerScope === "any") return true;
    const scopePlayerId = scopePlayerIdForCandidate(cardInstance);
    if (targetPlayerScope === "acting_player") {
      return scopePlayerId === actingPlayerId;
    }
    // P3-52: opponent scope
    return scopePlayerId !== actingPlayerId;
  };
  const candidateInstanceIds = state.cardInstances
    .filter((cardInstance) =>
      options?.getCardDefinitionById
        ? isCardInEffectZone(
            state,
            cardInstance,
            candidateTargetZones,
            actingPlayerId,
            options.getCardDefinitionById
          )
        : candidateTargetZones.includes(cardInstance.zone)
    )
    .filter(
      (cardInstance) =>
        setBurstCandidateIds === null ||
        setBurstCandidateIds.has(cardInstance.instanceId)
    )
    .filter(scopedByPlayer)
    .map((cardInstance) => cardInstance.instanceId);
  // `summon.target.from_zone.includeAdventSource` (BSSL01-X01[5,6]): 煌臨元アンダーカードは
  // runtime Zone 上 "field" のままホストの下に重なるため candidateTargetZones では拾えず、
  // collectUnderCardScopeIds() 経由で別途 union する。
  if (actionRegistration.candidateIncludeAdventSource === true) {
    const adventSourceIds =
      adventSourceIdsForOwnerScope ??
      collectUnderCardScopeIds(state).adventSource;
    for (const cardInstance of state.cardInstances) {
      if (
        adventSourceIds.has(cardInstance.instanceId) &&
        scopedByPlayer(cardInstance) &&
        !candidateInstanceIds.includes(cardInstance.instanceId)
      ) {
        candidateInstanceIds.push(cardInstance.instanceId);
      }
    }
  }
  if (actionRegistration.candidateIncludeSoulState === true) {
    const soulStateIds = new Set(
      state.players.flatMap((player) => player.soulStateInstanceIds)
    );
    for (const cardInstance of state.cardInstances) {
      if (
        soulStateIds.has(cardInstance.instanceId) &&
        scopedByPlayer(cardInstance) &&
        !candidateInstanceIds.includes(cardInstance.instanceId)
      ) {
        candidateInstanceIds.push(cardInstance.instanceId);
      }
    }
  }
  const sourceUnderCardCandidateIds = (() => {
    const role = actionRegistration.sourceUnderCardRole;
    if (role === undefined) return null;
    const sourceId = options?.sourceInstanceId;
    if (sourceId === undefined) return new Set<string>();
    const sourceCard = getCardById(state, sourceId);
    return new Set(
      (sourceCard?.underCards ?? [])
        .filter((entry) => entry.role === role)
        .map((entry) => entry.cardInstanceId)
    );
  })();
  const sourceAttachedChildCandidateIds = (() => {
    if (actionRegistration.sourceAttachedChildrenOnly !== true) return null;
    const sourceId = options?.sourceInstanceId;
    if (sourceId === undefined) return new Set<string>();
    const sourceCard = getCardById(state, sourceId);
    return new Set(sourceCard?.attachedChildrenIds ?? []);
  })();
  const sourceRequiredOpenUnderCardSlot =
    actionRegistration.sourceRequiredOpenUnderCardSlot;
  if (sourceRequiredOpenUnderCardSlot !== undefined) {
    const sourceId = options?.sourceInstanceId;
    if (sourceId === undefined) return [];
    const sourceCard = getCardById(state, sourceId);
    if (
      !sourceCard ||
      !hasOpenTextRoleUnderCardSlot(
        sourceCard,
        sourceRequiredOpenUnderCardSlot.roleTag,
        sourceRequiredOpenUnderCardSlot.maxCount,
        state,
        options?.getCardDefinitionById
      )
    ) {
      return [];
    }
  }
  const afterSourceAttachedChildrenFilter =
    sourceAttachedChildCandidateIds === null
      ? candidateInstanceIds
      : candidateInstanceIds.filter((instanceId) =>
          sourceAttachedChildCandidateIds.has(instanceId)
        );
  const afterSourceUnderCardFilter =
    sourceUnderCardCandidateIds === null
      ? afterSourceAttachedChildrenFilter
      : afterSourceAttachedChildrenFilter.filter((instanceId) =>
          sourceUnderCardCandidateIds.has(instanceId)
        );
  const afterStarGarmentEligibilityFilter =
    actionRegistration.starGarmentTargetEligibleOnly === true &&
    options?.getCardDefinitionById
      ? afterSourceUnderCardFilter.filter((instanceId) => {
          const card = getCardById(state, instanceId);
          if (!card || card.pendingLeaveKind !== null) return false;
          const def = card
            ? options.getCardDefinitionById?.(card.definitionId)
            : undefined;
          return def ? isStarGarmentTargetEligible(def) : false;
        })
      : afterSourceUnderCardFilter;

  const braveCombineIncomingBraveDef =
    options?.braveCombineIncomingBraveDefinition ?? options?.sourceDefinition;
  const braveCombineIncomingBraveInstanceId =
    options?.braveCombineIncomingBraveInstanceId ?? options?.sourceInstanceId;
  const braveCombineIncomingBrave =
    braveCombineIncomingBraveInstanceId !== undefined
      ? getCardById(state, braveCombineIncomingBraveInstanceId)
      : undefined;
  if (
    actionRegistration.braveCombineHostOnly === true &&
    braveCombineIncomingBraveDef &&
    braveCombineIncomingBraveInstanceId &&
    hasCannotCombineRestriction(
      state,
      braveCombineIncomingBraveInstanceId,
      braveCombineIncomingBraveDef
    )
  ) {
    return [];
  }
  const afterBraveCombineHostFilter =
    actionRegistration.braveCombineHostOnly === true &&
    options?.getCardDefinitionById &&
    braveCombineIncomingBraveDef
      ? afterStarGarmentEligibilityFilter.filter((instanceId) => {
          if (instanceId === braveCombineIncomingBraveInstanceId) {
            return false;
          }
          const card = getCardById(state, instanceId);
          if (!card || card.pendingLeaveKind !== null) return false;
          const def = options.getCardDefinitionById?.(card.definitionId);
          if (!def) return false;
          return isEligibleBraveCombineHost({
            state,
            host: card,
            hostDefinition: def,
            incomingBraveCondition: braveCombineIncomingBraveDef.braveCondition,
            ...(braveCombineIncomingBrave
              ? { incomingBrave: braveCombineIncomingBrave }
              : {}),
            incomingBraveDef: braveCombineIncomingBraveDef,
            getCardDefinitionById: options.getCardDefinitionById!,
          });
        })
      : afterStarGarmentEligibilityFilter;

  const afterEffectFilter = filterTargetCardInstanceIdsByEffectFilter(
    state,
    afterBraveCombineHostFilter,
    getTargetEffectFilterTags(actionRegistration)
  );

  // P3-52: target.filter / excludeSelf による 2 次絞り込み。
  // getCardDefinitionById が無い呼び出し経路では従来挙動 (filter 未適用)。
  const getDef = options?.getCardDefinitionById;
  const rawTargetCardFilter = actionRegistration.targetCardFilter;
  const preventionProfile =
    derivePreventionProfile(actionRegistration) ?? normalizePreventionProfile();
  const bypassSpecialNexusTargetLock =
    preventionProfile.targetLockBypass.kind !== "none";
  // P3-14 A-7: effect_param_override CE による filter 拡張を listing にも反映する。
  // destroy / vanish / bounce / prevent_battle / exhaust 由来かつ sourceInstanceId が
  // 分かる場合のみ適用（recover は前例なし、常に対象外）。
  const effectiveTargetCardFilter: CardFilter | undefined = (() => {
    if (!rawTargetCardFilter) return rawTargetCardFilter;
    const overrideKind = actionRegistration.targetCardFilterActionKind;
    const overrideSourceId = options?.sourceInstanceId;
    if (!overrideKind || overrideKind === "recover" || !overrideSourceId) {
      return rawTargetCardFilter;
    }
    const effectClass = deriveEffectParamOverrideClass(
      overrideKind,
      rawTargetCardFilter
    );
    if (!effectClass) return rawTargetCardFilter;
    return applyEffectParamOverridesToFilter(
      rawTargetCardFilter,
      effectClass,
      overrideSourceId,
      state,
      getDef
    );
  })();
  // 動的 maxBp（「このスピリットのBP以下」）を効果発動元の実効 BP へ解決する。
  // 候補列挙も解決経路（target-resolution）と同じ閾値で絞る（preSelected 経路は
  // 解決時に再フィルタしないため、候補列挙が権威となる）。
  // 動的 maxBp/maxCost（「このスピリットのBP/コスト以下」）を源の実効 BP / 本来コストへ解決する。
  // 候補列挙も解決経路（target-resolution）と同じ閾値で絞る（preSelected 経路は
  // 解決時に再フィルタしないため、候補列挙が権威となる）。
  const selfThresholdResolvedFilter: CardFilter | undefined = (() => {
    let f = effectiveTargetCardFilter;
    if (!f) return f;
    const srcId = options?.sourceInstanceId;
    const src = srcId ? getCardById(state, srcId) : undefined;
    const srcDef = src && getDef ? getDef(src.definitionId) : undefined;
    const srcBp =
      src && src.zone === "field" && srcDef && getDef
        ? getCombinedUnitBp(state, src, srcDef, getDef)
        : undefined;
    // filterOr の各枝にネストした maxBpSource/maxCostSource/maxCoresSource も
    // 再帰的に解決する (SSOT: resolveDynamicThresholdsInFilter、BSGE01-TX01(B)
    // adversarial verifier round3 で filterOr 内の閾値ソースが黙って無視される
    // silent bug を発見)。
    const srcCostOptions =
      src && srcDef
        ? getCombinedUnitCostFilterOptions(state, src, srcDef, getDef)
        : undefined;
    f = resolveDynamicThresholdsInFilter(f, {
      effectiveBp: srcBp,
      sourceCost: srcCostOptions?.effectiveCost,
      additionalCosts: srcCostOptions?.additionalCosts,
      countValue: getSelfCountThresholdValue(state, src, srcDef),
    });
    // 動的 tribes（「ブロック宣言する相手と同じ系統を持つ」）を解決する。BSFT01-C01 型。
    // 「他の」= 参照カード自身（ブロック中）の除外は呼び出し側 filter の
    // `exclude: { battleState: "blocking" }` に委ねる（既存 battleState 除外機構の再利用）。
    if (f.tribesMatchRef === "declared_blocker" && getDef) {
      f = resolveTribesMatchRefFilter(
        f,
        resolveDeclaredBlockerTribes(state, getDef)
      );
    }
    return f;
  })();
  const excludeSelfId = actionRegistration.targetExcludeSelf
    ? options?.sourceInstanceId
    : undefined;
  const sourceFilterStepContext = options?.sourceInstanceId
    ? {
        ...createStepExecutionContext(state),
        sourceInstanceId: options.sourceInstanceId,
      }
    : undefined;
  const afterTargetSpecFilter =
    !selfThresholdResolvedFilter && excludeSelfId === undefined
      ? afterEffectFilter
      : afterEffectFilter.filter((instanceId) => {
          if (excludeSelfId !== undefined && instanceId === excludeSelfId) {
            return false;
          }
          if (!selfThresholdResolvedFilter || !getDef) return true;
          const card = getCardById(state, instanceId);
          if (!card) return false;
          const def = getCardDefinitionForEffectiveFieldCard(card, getDef, {
            state,
            filter: selfThresholdResolvedFilter,
          });
          // def 未取得 = viewer に伏せられた秘匿カード (_hidden_card_)。
          // 裏向きフィールドカードは印字 def 無しでも素性が実効 getter で決まる
          // (getEffectiveCategory: act_as_spirit→"spirit" / それ以外→undefined 素性なし,
          //  getEffectiveBp: act_as_spirit は本体追従 BP)。サーバの実 state 評価 (def あり)
          // と候補集合を一致させるため、裏向きカードは null-identity placeholder + 実効 BP で
          // matchesCardFilter にかける。これをしないと viewer 側だけ filter を素通りして
          // 候補に残り、「ことで」ガード付き効果 (紅魔館フラッシュ等) を過剰提示して desync する。
          // 裏向き以外の秘匿カード (相手の手札/デッキ等) は評価不能なので従来通り候補に残す。
          if (!def && !card.faceDown) return true;
          return matchesCardFilter(
            card,
            def ?? HIDDEN_CARD_NULL_IDENTITY_DEF,
            selfThresholdResolvedFilter,
            {
              ...(excludeSelfId !== undefined
                ? { excludeInstanceId: excludeSelfId }
                : {}),
              ...(bypassSpecialNexusTargetLock
                ? { bypassSpecialNexusTargetLock: true }
                : {}),
              ignoreCategoryExclusion:
                preventionProfile.targetLockBypass.kind === "all_effects",
              ...(options?.sourceDefinition
                ? { sourceDefinition: options.sourceDefinition }
                : {}),
              ...(sourceFilterStepContext
                ? { stepContext: sourceFilterStepContext }
                : {}),
              ...(options?.evaluateCondition
                ? { evaluateCondition: options.evaluateCondition }
                : {}),
              ...(options?.evaluateApplicability
                ? { evaluateApplicability: options.evaluateApplicability }
                : {}),
              state,
              // アンダーカード包含スコープ（SSOT: collectUnderCardScopeIds, model）。
              // 候補列挙でも煌臨元・text_role アンダーカードを無印スコープから除外し、
              // target-resolution（解決経路）と選べる/取れる候補を一致させる
              // （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
              underCardIds: collectUnderCardScopeIds(state),
              soulStateIds: getEffectiveSoulStateIds(state, getDef),
              // 候補列挙でも分身(act_as_spirit)・現在レベル・修正値込みの実効 BP で
              // minBp/maxBp を判定する（解決経路と一致させる）。場外は印字フォールバック。
              ...(actionRegistration.starGarmentTargetEligibleOnly === true
                ? {
                    // The physical B-face operation has an explicit category
                    // domain; all other predicates retain public field identity.
                    effectiveCategory: getDef(card.definitionId)
                      ?.printedCategory,
                  }
                : {
                    fieldCategoryContext: true,
                    getCardDefinitionById: getDef,
                  }),
              effectiveBp:
                card.zone === "field"
                  ? getCombinedUnitBp(state, card, def, getDef)
                  : undefined,
              effectiveLevel:
                card.zone === "field"
                  ? getEffectiveLevel(state, card, def, getDef)
                  : undefined,
              // 色フィルタも treat_as_color 等の実効色で判定し、target-resolution
              // の解決経路と候補列挙を一致させる。
              effectiveColors: getEffectiveColors(state, card, def),
              // 系統フィルタも override_properties.addTribes 等の実効系統で判定し、
              // target-resolution の解決経路と候補列挙を一致させる。
              effectiveTribes: getEffectiveTribes(state, card, def, getDef),
              // コア数フィルタ (maxCores/minCores) 用。場外は undefined でフィルタ無効。
              coreCount:
                card.zone === "field"
                  ? getTotalCoresOnCardById(state, card.instanceId)
                  : undefined,
              // シンボル数フィルタ (symbolCount/minSymbolCount) 用。合体ユニット
              // (host+attached brave) と symbol_addition CE 由来の実効値を反映
              // (memory project_combined_unit_symbol_and_bunshin)。場外は印字フォールバック。
              effectiveSymbolCount:
                card.zone === "field"
                  ? getCombinedUnitSymbolCount(state, card, def, getDef)
                  : undefined,
              // 対象側 cost 判定は合体ユニット/実効コスト/追加コスト候補をまとめた
              // getCombinedUnitCostFilterOptions を使い、target-resolution の解決経路と
              // 候補列挙を一致させる。
              ...getCombinedUnitCostFilterOptions(
                state,
                card,
                def ?? HIDDEN_CARD_NULL_IDENTITY_DEF,
                getDef
              ),
            }
          );
        });
  const afterAttachedCombinedChildFilter =
    selfThresholdResolvedFilter &&
    getDef &&
    actionRegistration.sourceAttachedChildrenOnly !== true &&
    actionRegistration.starGarmentTargetEligibleOnly !== true
      ? afterTargetSpecFilter.filter((instanceId) => {
          const card = getCardById(state, instanceId);
          if (!card || card.zone !== "field") return true;
          const def = getDef(card.definitionId);
          if (!def) return true;
          return !shouldExcludeAttachedCombinedChildForFieldCategoryFilter(
            state,
            card,
            def,
            selfThresholdResolvedFilter,
            {
              ...(options?.sourceDefinition
                ? { sourceDefinition: options.sourceDefinition }
                : {}),
              state,
              fieldCategoryContext: true,
              getCardDefinitionById: getDef,
              effectiveBp: getCombinedUnitBp(state, card, def, getDef),
              effectiveLevel: getEffectiveLevel(state, card, def, getDef),
              effectiveColors: getEffectiveColors(state, card, def),
              effectiveTribes: getEffectiveTribes(state, card, def, getDef),
              coreCount: getTotalCoresOnCardById(state, card.instanceId),
              effectiveSymbolCount: getCombinedUnitSymbolCount(
                state,
                card,
                def,
                getDef
              ),
              ...getCombinedUnitCostFilterOptions(state, card, def, getDef),
            }
          );
        })
      : afterTargetSpecFilter;
  const afterActionStateFilter =
    actionRegistration.targetCardFilterActionKind === "exhaust"
      ? afterAttachedCombinedChildFilter.filter((instanceId) => {
          const card = getCardById(state, instanceId);
          if (!card) return false;
          const resultState =
            actionRegistration.targetExhaustState ?? "exhausted";
          return resultState === "heavily_exhausted"
            ? card.exhaustState !== "heavily_exhausted"
            : card.exhaustState === "recovered";
        })
      : actionRegistration.targetCardFilterActionKind === "recover"
        ? afterAttachedCombinedChildFilter.filter((instanceId) => {
            const card = getCardById(state, instanceId);
            if (!card) return false;
            return (
              card.exhaustState !== "recovered" &&
              (!getDef || !isCardRecoveryRestricted(state, card, getDef))
            );
          })
        : afterAttachedCombinedChildFilter;

  // P3-105 裁定: 対象を取る効果は「受けない」も候補から除外する。
  // 選択後に耐性を得た対象の部分解決は executor の affect gate が担当する。
  const sourcePreventionLevel = getEffectPreventionLevel(actionRegistration);
  const sourceInstance =
    options?.sourceInstanceId !== undefined
      ? getCardById(state, options.sourceInstanceId)
      : undefined;
  const affectSourceIdentity = options?.affectSourceIdentity;
  const affectSourceInstance =
    affectSourceIdentity?.instance ??
    (affectSourceIdentity?.instanceId !== undefined
      ? getCardById(state, affectSourceIdentity.instanceId)
      : sourceInstance);
  const affectSourceInstanceId =
    affectSourceIdentity?.instanceId ?? options?.sourceInstanceId;
  const affectSourceDefinitionId =
    affectSourceIdentity?.definitionId ??
    affectSourceIdentity?.definition?.cardNo ??
    options?.sourceDefinition?.cardNo ??
    affectSourceInstance?.definitionId;
  const affectSourceDefinition =
    affectSourceIdentity?.definition ??
    (affectSourceDefinitionId !== undefined
      ? getDef?.(affectSourceDefinitionId)
      : undefined) ??
    options?.sourceDefinition;
  const dynamicSourcePreventionBypass =
    affectSourceInstanceId !== undefined && getDef !== undefined
      ? getEffectSourceTribePreventionBypass(
          state,
          affectSourceInstanceId,
          actingPlayerId,
          getDef
        )
      : undefined;
  const sourcePreventionBypass = mergeTargetLockBypassProfiles(
    mergeTargetLockBypassProfiles(
      preventionProfile.targetLockBypass,
      dynamicSourcePreventionBypass
    ),
    options?.sourcePreventionBypass
  );
  const targetSelectionBypassesAffectGate =
    actionRegistration.targetSelectionBypassesAffectGate === true;
  const afterPreventionFilter =
    targetSelectionBypassesAffectGate ||
    actionRegistration.targetSelectionBypassesPreventionGate === true
      ? afterActionStateFilter
      : filterTargetsByPreventionLevel(
          state,
          afterActionStateFilter,
          sourcePreventionLevel,
          {
            actingPlayerId,
            effectSource: {
              instance: affectSourceInstance,
              definition: affectSourceDefinition,
            },
            getCardDefinitionById: getDef,
            effectAspect: actionRegistration.targetEffectAspect,
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
          }
        );

  const afterTargetAcquisitionGate = targetSelectionBypassesAffectGate
    ? afterPreventionFilter
    : state.activeContinuousEffects.length === 0
      ? afterPreventionFilter
      : filterTargetsByTargetAcquisitionGate(
          state,
          afterPreventionFilter,
          {
            actingPlayerId,
            ...(affectSourceInstanceId !== undefined
              ? { sourceInstanceId: affectSourceInstanceId }
              : {}),
            ...(affectSourceDefinitionId !== undefined
              ? { sourceDefinitionId: affectSourceDefinitionId }
              : {}),
            prevention: preventionProfile,
            cause: "effect",
          },
          "explicit_target",
          getDef
        );

  // 極値セレクタ（「最もBP/コストの低い相手1体」）。実際に取れる対象（防止フィルタ後）の
  // うち極値だけを残す。タイは全候補を残して選択者に委ねる。getDef がなければ極値計算
  // 不能なので素通り（従来挙動）。
  const extremal = effectiveTargetCardFilter?.extremal;
  if (extremal && getDef) {
    return selectExtremalInstanceIds(
      state,
      afterTargetAcquisitionGate,
      extremal,
      getDef
    );
  }
  return afterTargetAcquisitionGate;
}

function mergeTargetGroupRegistration(
  base: Omit<RegisteredTargetedEffectActionBase, "targetGroups">,
  group: RegisteredTargetGroup
): RegisteredTargetedEffectActionBase {
  const {
    requiredTargetCount: _requiredTargetCount,
    requiredTargetCountDynamic: _requiredTargetCountDynamic,
    maxTargetCount: _maxTargetCount,
    maxTargetCountDynamic: _maxTargetCountDynamic,
    targetEffectFilterTags: _targetEffectFilterTags,
    targetEffectAspect: _targetEffectAspect,
    candidateTargetZones: _candidateTargetZones,
    candidateTargetPlayerScope: _candidateTargetPlayerScope,
    targetCardFilter: _targetCardFilter,
    targetExcludeSelf: _targetExcludeSelf,
    sourceUnderCardRole: _sourceUnderCardRole,
    sourceAttachedChildrenOnly: _sourceAttachedChildrenOnly,
    starGarmentTargetEligibleOnly: _starGarmentTargetEligibleOnly,
    sourceRequiredOpenUnderCardSlot: _sourceRequiredOpenUnderCardSlot,
    targetRequiresFullCount: _targetRequiresFullCount,
    targetCardFilterActionKind: baseTargetCardFilterActionKind,
    targetExhaustState: baseTargetExhaustState,
    targetStepId: _targetStepId,
    ...baseRest
  } = base;
  return {
    ...baseRest,
    requiredTargetCount: group.requiredTargetCount,
    ...(group.requiredTargetCountDynamic !== undefined
      ? { requiredTargetCountDynamic: group.requiredTargetCountDynamic }
      : {}),
    ...(group.maxTargetCount !== undefined
      ? { maxTargetCount: group.maxTargetCount }
      : {}),
    ...(group.maxTargetCountDynamic !== undefined
      ? { maxTargetCountDynamic: group.maxTargetCountDynamic }
      : {}),
    ...(group.targetEffectFilterTags !== undefined
      ? { targetEffectFilterTags: group.targetEffectFilterTags }
      : {}),
    ...(group.targetEffectAspect !== undefined
      ? { targetEffectAspect: group.targetEffectAspect }
      : {}),
    ...(group.candidateTargetZones !== undefined
      ? { candidateTargetZones: group.candidateTargetZones }
      : {}),
    ...(group.candidateTargetPlayerScope !== undefined
      ? { candidateTargetPlayerScope: group.candidateTargetPlayerScope }
      : {}),
    ...(group.targetCardFilter !== undefined
      ? { targetCardFilter: group.targetCardFilter }
      : {}),
    ...(group.targetExcludeSelf !== undefined
      ? { targetExcludeSelf: group.targetExcludeSelf }
      : {}),
    ...(group.sourceUnderCardRole !== undefined
      ? { sourceUnderCardRole: group.sourceUnderCardRole }
      : {}),
    ...(group.sourceAttachedChildrenOnly !== undefined
      ? { sourceAttachedChildrenOnly: group.sourceAttachedChildrenOnly }
      : {}),
    ...(group.starGarmentTargetEligibleOnly !== undefined
      ? { starGarmentTargetEligibleOnly: group.starGarmentTargetEligibleOnly }
      : {}),
    ...(group.sourceRequiredOpenUnderCardSlot !== undefined
      ? {
          sourceRequiredOpenUnderCardSlot:
            group.sourceRequiredOpenUnderCardSlot,
        }
      : {}),
    ...(group.targetRequiresFullCount !== undefined
      ? { targetRequiresFullCount: group.targetRequiresFullCount }
      : {}),
    ...(group.targetCardFilterActionKind !== undefined
      ? { targetCardFilterActionKind: group.targetCardFilterActionKind }
      : baseTargetCardFilterActionKind !== undefined
        ? { targetCardFilterActionKind: baseTargetCardFilterActionKind }
        : {}),
    ...(group.targetExhaustState !== undefined
      ? { targetExhaustState: group.targetExhaustState }
      : baseTargetExhaustState !== undefined
        ? { targetExhaustState: baseTargetExhaustState }
        : {}),
  };
}

export function buildLegalActionTargetGroups(options: {
  state: GameState;
  actingPlayerId: string;
  actionRegistration: RegisteredTargetedEffectActionBase;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  sourceInstanceId?: string;
  sourceDefinition?: CardDefinition;
  affectSourceIdentity?: ResolvedAffectSourceIdentity;
  evaluateCondition?: (
    condition: Condition,
    sourceInstanceId: string,
    actingPlayerId: string
  ) => boolean;
  evaluateApplicability?: (
    applicability: NonNullable<Effect["applicability"]>,
    sourceInstanceId: string
  ) => boolean;
  resolveCountBound?: (bound: CountBound) => number;
  braveCombineIncomingBraveDefinition?: CardDefinition;
  braveCombineIncomingBraveInstanceId?: string;
  sourcePreventionBypass?: TargetLockBypassProfile;
}): LegalActionTargetGroup[] {
  if (!options.actionRegistration.targetGroups?.length) {
    return [];
  }

  const { targetGroups, ...baseRegistration } = options.actionRegistration;
  return targetGroups.flatMap((group) => {
    const mergedRegistration = mergeTargetGroupRegistration(
      baseRegistration,
      group
    );
    const candidateTargetInstanceIds = getCandidateTargetInstanceIds(
      options.state,
      options.actingPlayerId,
      mergedRegistration,
      {
        ...(options.getCardDefinitionById !== undefined
          ? { getCardDefinitionById: options.getCardDefinitionById }
          : {}),
        ...(options.sourceInstanceId !== undefined
          ? { sourceInstanceId: options.sourceInstanceId }
          : {}),
        ...(options.sourceDefinition !== undefined
          ? { sourceDefinition: options.sourceDefinition }
          : {}),
        ...(options.affectSourceIdentity !== undefined
          ? { affectSourceIdentity: options.affectSourceIdentity }
          : {}),
        ...(options.evaluateCondition !== undefined
          ? { evaluateCondition: options.evaluateCondition }
          : {}),
        ...(options.evaluateApplicability !== undefined
          ? { evaluateApplicability: options.evaluateApplicability }
          : {}),
        ...(options.braveCombineIncomingBraveDefinition !== undefined
          ? {
              braveCombineIncomingBraveDefinition:
                options.braveCombineIncomingBraveDefinition,
            }
          : {}),
        ...(options.braveCombineIncomingBraveInstanceId !== undefined
          ? {
              braveCombineIncomingBraveInstanceId:
                options.braveCombineIncomingBraveInstanceId,
            }
          : {}),
        ...(options.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: options.sourcePreventionBypass }
          : {}),
      }
    );
    const requiredTargetCount = Math.max(
      0,
      Math.floor(
        group.requiredTargetCountDynamic !== undefined &&
          options.resolveCountBound !== undefined
          ? options.resolveCountBound(group.requiredTargetCountDynamic)
          : group.requiredTargetCount
      )
    );
    const rawMaxTargetCount =
      group.maxTargetCountDynamic !== undefined &&
      options.resolveCountBound !== undefined
        ? options.resolveCountBound(group.maxTargetCountDynamic)
        : group.maxTargetCount;
    const maxTargetCount =
      rawMaxTargetCount === undefined
        ? requiredTargetCount
        : Math.max(requiredTargetCount, Math.floor(rawMaxTargetCount));
    const candidateCount =
      options.actionRegistration.allowDuplicateTargets === true &&
      candidateTargetInstanceIds.length > 0
        ? Math.max(candidateTargetInstanceIds.length, requiredTargetCount)
        : candidateTargetInstanceIds.length;
    const emptyFire = resolveEmptyFireTargetCounts({
      requiredTargetCount,
      maxTargetCount,
      candidateCount,
      gatedByConditionalCost:
        mergedRegistration.targetGatedByConditionalCost === true,
      requiresFullCount: mergedRegistration.targetRequiresFullCount === true,
    });
    if (emptyFire.block) {
      return [
        {
          requiredTargetCount,
          ...(maxTargetCount !== requiredTargetCount ? { maxTargetCount } : {}),
          ...(group.targetStepId !== undefined
            ? { targetStepId: group.targetStepId }
            : {}),
          candidateTargetZones: getCandidateTargetZones(mergedRegistration),
          candidateTargetInstanceIds,
        },
      ];
    }
    return [
      {
        requiredTargetCount: emptyFire.requiredTargetCount,
        ...(emptyFire.maxTargetCount !== undefined &&
        emptyFire.maxTargetCount !== emptyFire.requiredTargetCount
          ? { maxTargetCount: emptyFire.maxTargetCount }
          : {}),
        ...(group.targetStepId !== undefined
          ? { targetStepId: group.targetStepId }
          : {}),
        candidateTargetZones: getCandidateTargetZones(mergedRegistration),
        candidateTargetInstanceIds,
      },
    ];
  });
}

export function areLegalActionTargetGroupsSatisfiable(
  targetGroups: readonly LegalActionTargetGroup[],
  allowDuplicateTargets: boolean
): boolean {
  return (
    assignLegalActionTargetGroups({
      targetGroups,
      allowDuplicateTargets,
    }) !== null
  );
}

export function isLegalActionTargetGroupSelectionSatisfied(options: {
  targetInstanceIds: readonly string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  allowDuplicateTargets?: boolean;
}): boolean {
  if (!options.targetGroups?.length) return true;
  if (options.allowDuplicateTargets !== true) {
    const unique = new Set(options.targetInstanceIds);
    if (unique.size !== options.targetInstanceIds.length) return false;
  }
  return (
    assignLegalActionTargetGroups(
      options as {
        targetInstanceIds: readonly string[];
        targetGroups: readonly LegalActionTargetGroup[];
        allowDuplicateTargets?: boolean;
      }
    ) !== null
  );
}

export function assignLegalActionTargetGroups(options: {
  targetGroups: readonly LegalActionTargetGroup[];
  targetInstanceIds?: readonly string[];
  allowDuplicateTargets?: boolean;
}): string[] | null {
  const requiredGroups = options.targetGroups.filter(
    (group) => group.requiredTargetCount > 0
  );
  if (options.targetInstanceIds === undefined && requiredGroups.length === 0) {
    return [];
  }

  const groupLimits = options.targetGroups.map((group) => ({
    requiredTargetCount: group.requiredTargetCount,
    maxTargetCount: group.maxTargetCount ?? group.requiredTargetCount,
    candidateTargetInstanceIds: group.candidateTargetInstanceIds,
  }));

  if (options.targetInstanceIds !== undefined) {
    if (options.allowDuplicateTargets !== true) {
      const unique = new Set(options.targetInstanceIds);
      if (unique.size !== options.targetInstanceIds.length) return null;
    }
    const minTargetCount = groupLimits.reduce(
      (sum, group) => sum + group.requiredTargetCount,
      0
    );
    const maxTargetCount = groupLimits.reduce(
      (sum, group) => sum + group.maxTargetCount,
      0
    );
    if (
      options.targetInstanceIds.length < minTargetCount ||
      options.targetInstanceIds.length > maxTargetCount
    ) {
      return null;
    }

    const selected = options.targetInstanceIds.map((id, index) => ({
      id,
      index,
      candidateGroupIndexes: groupLimits
        .map((group, groupIndex) =>
          group.candidateTargetInstanceIds.includes(id) ? groupIndex : -1
        )
        .filter((groupIndex) => groupIndex >= 0),
    }));
    if (selected.some((entry) => entry.candidateGroupIndexes.length === 0)) {
      return null;
    }
    selected.sort((a, b) => {
      const candidateDelta =
        a.candidateGroupIndexes.length - b.candidateGroupIndexes.length;
      if (candidateDelta !== 0) return candidateDelta;
      return a.index - b.index;
    });

    const assignedCounts = Array.from({ length: groupLimits.length }, () => 0);
    const assignedTargetIds: string[] = [];
    const canAssignSelectedTarget = (selectionIndex: number): boolean => {
      if (selectionIndex >= selected.length) {
        return groupLimits.every(
          (group, groupIndex) =>
            assignedCounts[groupIndex]! >= group.requiredTargetCount
        );
      }
      const entry = selected[selectionIndex]!;
      for (const groupIndex of entry.candidateGroupIndexes) {
        const group = groupLimits[groupIndex]!;
        if (assignedCounts[groupIndex]! >= group.maxTargetCount) continue;
        assignedCounts[groupIndex] = assignedCounts[groupIndex]! + 1;
        assignedTargetIds.push(entry.id);
        if (canAssignSelectedTarget(selectionIndex + 1)) return true;
        assignedTargetIds.pop();
        assignedCounts[groupIndex] = assignedCounts[groupIndex]! - 1;
      }
      return false;
    };

    return canAssignSelectedTarget(0) ? assignedTargetIds : null;
  }

  if (
    options.targetInstanceIds === undefined &&
    options.allowDuplicateTargets
  ) {
    const allGroupsHaveCandidate = requiredGroups.every(
      (group) => group.candidateTargetInstanceIds.length > 0
    );
    if (!allGroupsHaveCandidate) return null;
    return requiredGroups.flatMap((group) =>
      Array.from(
        { length: group.requiredTargetCount },
        () => group.candidateTargetInstanceIds[0]!
      )
    );
  }

  const slots = requiredGroups.flatMap((group, groupIndex) =>
    Array.from({ length: group.requiredTargetCount }, (_, slotIndex) => ({
      groupIndex,
      slotIndex,
      candidateTargetInstanceIds: group.candidateTargetInstanceIds,
    }))
  );
  if (
    options.targetInstanceIds === undefined &&
    requiredGroups.some(
      (group) =>
        group.candidateTargetInstanceIds.length < group.requiredTargetCount
    )
  ) {
    return null;
  }

  slots.sort((a, b) => {
    const aCandidateCount =
      options.targetInstanceIds === undefined
        ? a.candidateTargetInstanceIds.length
        : options.targetInstanceIds.filter((id) =>
            a.candidateTargetInstanceIds.includes(id)
          ).length;
    const bCandidateCount =
      options.targetInstanceIds === undefined
        ? b.candidateTargetInstanceIds.length
        : options.targetInstanceIds.filter((id) =>
            b.candidateTargetInstanceIds.includes(id)
          ).length;
    const candidateDelta = aCandidateCount - bCandidateCount;
    if (candidateDelta !== 0) return candidateDelta;
    if (a.groupIndex !== b.groupIndex) return a.groupIndex - b.groupIndex;
    return a.slotIndex - b.slotIndex;
  });

  const consumedTargetIds = new Set<string>();
  const consumedTargetIndexes = new Set<number>();
  const assignedTargetIds: string[] = [];
  const canAssignSlot = (slotIndex: number): boolean => {
    if (slotIndex >= slots.length) return true;
    const slot = slots[slotIndex]!;
    const candidates =
      options.targetInstanceIds === undefined
        ? slot.candidateTargetInstanceIds.map((id) => ({ id, index: -1 }))
        : options.targetInstanceIds
            .map((id, index) => ({ id, index }))
            .filter(({ id }) => slot.candidateTargetInstanceIds.includes(id));

    for (const candidate of candidates) {
      if (candidate.index >= 0) {
        if (consumedTargetIndexes.has(candidate.index)) continue;
        consumedTargetIndexes.add(candidate.index);
      } else if (options.allowDuplicateTargets !== true) {
        if (consumedTargetIds.has(candidate.id)) continue;
        consumedTargetIds.add(candidate.id);
      }
      assignedTargetIds.push(candidate.id);
      if (canAssignSlot(slotIndex + 1)) return true;
      assignedTargetIds.pop();
      if (candidate.index >= 0) {
        consumedTargetIndexes.delete(candidate.index);
      } else {
        consumedTargetIds.delete(candidate.id);
      }
    }
    return false;
  };

  return canAssignSlot(0) ? assignedTargetIds : null;
}

export function assertLegalActionTargetGroupsSatisfied(options: {
  actionId: string;
  targetInstanceIds: readonly string[];
  targetGroups?: readonly LegalActionTargetGroup[];
  allowDuplicateTargets?: boolean;
  label?: string;
}): void {
  if (
    !isLegalActionTargetGroupSelectionSatisfied({
      targetInstanceIds: options.targetInstanceIds,
      ...(options.targetGroups !== undefined
        ? { targetGroups: options.targetGroups }
        : {}),
      ...(options.allowDuplicateTargets !== undefined
        ? { allowDuplicateTargets: options.allowDuplicateTargets }
        : {}),
    })
  ) {
    const expected = (options.targetGroups ?? []).reduce(
      (sum, group) => sum + group.requiredTargetCount,
      0
    );
    throw new Error(
      `${options.label ?? "Legal action target group"} count does not match: action=${options.actionId} expected=${expected} actual=${options.targetInstanceIds.length}`
    );
  }
}

/**
 * forced_target_inclusion CE (「相手が対象を選ぶ効果を発揮するとき、可能なら
 * このカードを対象に含めなければならない」タウント。forced-target-inclusion-taunt
 * cluster, BSFT01-TR02(B)) の必須対象集合を求める。`actingPlayerId` (今まさに
 * 対象選択を行う側=効果発揮者) と異なる controller が持つ CE のみが対象
 * (「相手が…発揮するとき」)。候補プールに無い taunt (耐性・ゾーン不一致等で
 * そもそも対象化できない) は「可能なら」を満たさないため除外する。
 *
 * 必須集合が `maxTargetCount` を超えて全員は含められない (複数 taunt 源が競合し
 * 物理的に不可能) 場合は、優先順位を定義せず強制を見送る
 * (forced-target-inclusion-taunt cluster の設計判断)。
 */
export function getMandatoryForcedTargetInclusionIds(
  state: GameState,
  actingPlayerId: string,
  candidateInstanceIds: readonly string[],
  maxTargetCount: number
): string[] {
  const candidateSet = new Set(candidateInstanceIds);
  const forcedIds = new Set<string>();
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "forced_target_inclusion") continue;
    if (ce.actingPlayerId === actingPlayerId) continue;
    if (!ce.targetInstanceId || !candidateSet.has(ce.targetInstanceId)) {
      continue;
    }
    if (!isCEActiveForScope(ce, state.step, state.activePlayerId)) continue;
    forcedIds.add(ce.targetInstanceId);
  }
  const result = Array.from(forcedIds);
  return result.length <= maxTargetCount ? result : [];
}

export function getLifeCoreChoiceDestination(
  sourceInstanceId: string,
  candidateTargetInstanceIds: readonly string[],
  lifeCoreChoice: RegisteredEffectLifeCoreChoice
): LifeCoreDestination | null {
  if (lifeCoreChoice.destinationKind === "source_card") {
    return {
      kind: "card",
      instanceId: sourceInstanceId,
    };
  }

  const targetInstanceId =
    candidateTargetInstanceIds[lifeCoreChoice.targetIndex ?? 0];

  return targetInstanceId
    ? {
        kind: "card",
        instanceId: targetInstanceId,
      }
    : null;
}

export function getAvailableChosenLifeCoreKinds(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  actionRegistration: RegisteredTargetedEffectActionBase;
  candidateTargetInstanceIds: readonly string[];
  getCardDefinitionById?:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined;
}): LifeCoreKind[] {
  const lifeCoreChoice = options.actionRegistration.actingPlayerLifeCoreChoice;

  if (!lifeCoreChoice) {
    return [];
  }

  const destination = getLifeCoreChoiceDestination(
    options.sourceInstanceId,
    options.candidateTargetInstanceIds,
    lifeCoreChoice
  );

  if (destination === null) {
    return [];
  }

  return getAvailableLifeCoreMoveChoices({
    state: options.state,
    playerId: options.actingPlayerId,
    destination,
    effectKind: lifeCoreChoice.effectKind ?? "generic",
    getCardDefinitionById: options.getCardDefinitionById,
  }).map((choice) => choice.coreKind);
}

export function createFieldCardEffectLegalActionId(
  sourceKind: string,
  sourceInstanceId: string,
  index: number,
  choiceIndex?: number
): string {
  const baseId = `legal:field-effect:${sourceKind}:${sourceInstanceId}:${index}`;
  return choiceIndex !== undefined ? `${baseId}:choice:${choiceIndex}` : baseId;
}

export function createHandActivatedEffectLegalActionId(
  sourceInstanceId: string,
  index: number,
  choiceIndex?: number
): string {
  const baseId = `legal:hand-effect:${sourceInstanceId}:${index}`;
  return choiceIndex !== undefined ? `${baseId}:choice:${choiceIndex}` : baseId;
}

export function createResolvePendingTriggeredEffectLegalActionId(
  pendingId: string,
  sourceInstanceId?: string,
  registrationIndex?: number,
  choiceIndex?: number
): string {
  if (sourceInstanceId === undefined) {
    return `legal:resolve-pending-trigger:${pendingId}`;
  }

  const baseId = `legal:resolve-pending-trigger:${pendingId}:${sourceInstanceId}:${
    registrationIndex ?? 0
  }`;
  // P3-24 Phase 2: choice 変種ごとに別 action ID にする (同一 registration から N 個展開)
  return choiceIndex !== undefined ? `${baseId}:choice:${choiceIndex}` : baseId;
}

/** P3-36 Phase C: ターンプレイヤーによる pending 選択アクション ID。 */
export function createSelectPendingToResolveLegalActionId(
  pendingId: string,
  sourceInstanceId?: string,
  registrationIndex?: number
): string {
  const baseId = `legal:select-pending-to-resolve:${pendingId}`;
  if (sourceInstanceId === undefined) return baseId;
  return `${baseId}:${sourceInstanceId}:${registrationIndex ?? 0}`;
}

export function createResolvePendingBurstCheckLegalActionId(
  checkId: string,
  sourceInstanceId?: string,
  registrationIndex?: number,
  choiceIndex?: number
): string {
  if (sourceInstanceId === undefined) {
    return `legal:resolve-pending-burst:${checkId}`;
  }

  const base = `legal:resolve-pending-burst:${checkId}:${sourceInstanceId}:${
    registrationIndex ?? 0
  }`;
  return choiceIndex === undefined ? base : `${base}:choice:${choiceIndex}`;
}

export function createDeclinePendingBurstCheckLegalActionId(
  checkId: string
): string {
  return `legal:decline-pending-burst:${checkId}`;
}

export function createBattleImmediateEffectLegalActionId(
  promptId: string,
  choiceIndex?: number
): string {
  if (choiceIndex !== undefined) {
    return `legal:battle-immediate:${promptId}:choice:${choiceIndex}`;
  }
  return `legal:battle-immediate:${promptId}`;
}

export function canEnumerateMainHandCardActions(
  state: GameState,
  actingPlayerId: string
): boolean {
  return state.step === "main" && state.activePlayerId === actingPlayerId;
}

export function createHandCardLegalActionId(
  kind: "summon" | "place_nexus",
  sourceInstanceId: string
): string {
  return `legal:${kind}:${sourceInstanceId}`;
}

export function createMagicLegalActionId(
  sourceInstanceId: string,
  timing: "main" | "flash" | "stack",
  costMode:
    | "paid"
    | "free"
    | "override"
    | "zone_discount"
    | "zone_discount_variable" = "paid",
  choiceIndex?: number,
  effectIndex?: number,
  // zone_discount / zone_discount_variable option の配列内 index。
  // 同一 sourceCard に対し getMagicZoneCostDiscountOptions() が複数 option を
  // 返しうる (1枚の CE 保持カードが独立した複数 continuous cost_modify+
  // useCostPayment step を持つ場合や、複数の CE 保持カードが同時成立する場合の
  // 両方を含む) ため、CE 保持カード instanceId 単体では discriminator として
  // 不十分 (同一カードの複数 step が同じ instanceId で衝突する)。呼び出し元の
  // 配列 index を渡すことで option 単位の一意性を保証する
  // (adversarial verifier 2回目ラウンド Lens4 指摘)。
  zoneCostOptionIndex?: number
): string {
  const suffix =
    costMode === "free"
      ? ":free"
      : costMode === "override"
        ? ":override"
        : costMode === "zone_discount"
          ? ":zone-discount"
          : costMode === "zone_discount_variable"
            ? ":zone-discount-variable"
            : "";
  const effectSuffix =
    effectIndex !== undefined ? `:effect:${effectIndex}` : "";
  const choiceSuffix =
    choiceIndex !== undefined ? `:choice:${choiceIndex}` : "";
  const zoneCostOptionSuffix =
    zoneCostOptionIndex !== undefined ? `:opt:${zoneCostOptionIndex}` : "";
  return `legal:use-magic:${timing}:${sourceInstanceId}${suffix}${effectSuffix}${choiceSuffix}${zoneCostOptionSuffix}`;
}

export function createSetBurstLegalActionId(sourceInstanceId: string): string {
  return `legal:set-burst:${sourceInstanceId}`;
}

export function createSetMirageLegalActionId(
  sourceInstanceId: string,
  replacedMirageInstanceIds: readonly string[] = []
): string {
  return `legal:set-mirage:${sourceInstanceId}:${JSON.stringify(replacedMirageInstanceIds)}`;
}

export function createSetQuartzLegalActionId(
  sourceInstanceId: string,
  hostInstanceId: string,
  slot: string,
  replacedQuartzInstanceId?: string
): string {
  return `legal:set-quartz:${sourceInstanceId}:${hostInstanceId}:${slot}${replacedQuartzInstanceId === undefined ? "" : `:replace:${replacedQuartzInstanceId}`}`;
}

export function createActivateSoulStateLegalActionId(
  sourceInstanceId: string,
  effectIndex: number
): string {
  return `legal:activate-soul-state:${sourceInstanceId}:${effectIndex}`;
}

/**
 * カード定義に「指定ゾーンから魂状態化できる」起動効果があればその effect index を返す（無ければ null）。
 * 条件: timing=activated かつ applicability.zone に sourceZone を含み、enter_soul_state ステップを持つ。
 * （ENIGMA「手札/手元にあるこのカードは自分のメインステップに魂状態にできる」）
 * activate_soul_state legal action の列挙と「魂状態以外で存在不可」(召喚抑止) の SSOT 判別。
 * sourceZone のデフォルトは "hand"（getHandCardLegalActionKind による手札召喚抑止用途）。
 */
export function getSoulStateActivationEffectIndex(
  def: CardDefinition,
  sourceZone: "hand" | "set_aside" = "hand"
): number | null {
  if (!def.effects) return null;
  for (const [i, eff] of def.effects.entries()) {
    if (eff.timing.kind !== "activated") continue;
    const zone = eff.applicability?.zone;
    const matches =
      zone === sourceZone || (Array.isArray(zone) && zone.includes(sourceZone));
    if (!matches) continue;
    if (eff.steps.some((s) => s.action?.kind === "enter_soul_state")) return i;
  }
  return null;
}

export function getHandCardLegalActionKind(
  definition: CardDefinition
): "summon" | "place_nexus" | null {
  // 「魂状態以外でフィールドに存在できない」カード（手札からの魂状態化起動効果を持つ。
  // ENIGMA[戦術オーブメント] 等）は activate_soul_state でのみ場に出るため通常召喚/配置を抑止する。
  if (getSoulStateActivationEffectIndex(definition) !== null) {
    return null;
  }
  if (
    definition.printedCategory === "spirit" ||
    definition.printedCategory === "ultimate" ||
    definition.printedCategory === "brave"
  ) {
    return "summon";
  }

  if (definition.printedCategory === "nexus") {
    return "place_nexus";
  }

  return null;
}

/**
 * アルティメット召喚条件（《召喚条件：…》）を満たすか判定する。
 * - ultimate 以外は常に true。
 * - summonCondition が未定義/空の ultimate は条件なしとして true。
 * - summonCondition（ConditionClause 配列）は `evaluateCondition()` で判定する（SSOT）。
 *   evaluateCondition は structured-effect-interpreter にあり、本モジュールへの逆依存
 *   （循環 import）を避けるため呼び出し側から注入する（getEffectiveBp と同じ DI 方針）。
 *   注入が無いまま条件付き ultimate を評価しようとした場合は配線漏れなので false で塞ぎ、
 *   テストで顕在化させる。
 */
export function canSummonUltimate(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  options?: {
    sourceInstanceId?: string;
    evaluateCondition?: (
      state: GameState,
      condition: Condition,
      sourceInstanceId: string,
      actingPlayerId: string,
      getCardDefinitionById: (id: string) => CardDefinition | undefined
    ) => boolean;
  }
): boolean {
  if (definition.printedCategory !== "ultimate") {
    return true;
  }

  const condition = definition.summonCondition;
  if (!condition || condition.length === 0) {
    return true;
  }

  // 「召喚条件を無視して召喚できる」許可 (BSAZ02-C11【アルティメット合体中】)。
  // hasIgnoreSummonConditionGrant で先にバイパスを確認する。
  if (hasIgnoreSummonConditionGrant(state, actingPlayerId, definition)) {
    return true;
  }

  if (!options?.evaluateCondition) {
    return false;
  }

  return options.evaluateCondition(
    state,
    condition,
    options.sourceInstanceId ?? "",
    actingPlayerId,
    getCardDefinitionById
  );
}

export type BraveCombineAsSummonGateResult =
  | { kind: "allowed" }
  | { kind: "restricted" }
  | { kind: "summon_condition_failed" }
  | { kind: "tensho_target_missing" }
  | { kind: "field_name_uniqueness" };

export type SummonDeclarationGateResult = BraveCombineAsSummonGateResult;

/**
 * 召喚/配置宣言の共通 gate。通常手札召喚・効果による手札召喚許可・
 * brave_combine_effect.asSummon が同じ宣言前制限を消費するための SSOT。
 */
export function evaluateSummonDeclarationGate(options: {
  state: GameState;
  actingPlayerId: string;
  card: CardInstance;
  definition: CardDefinition;
  actionKind: "summon" | "place_nexus";
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  ignoreSummonCondition?: boolean;
  evaluateCondition?: (
    state: GameState,
    condition: Condition,
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean;
}): SummonDeclarationGateResult {
  if (
    options.actionKind === "summon" &&
    options.ignoreSummonCondition !== true &&
    !canSummonUltimate(
      options.state,
      options.actingPlayerId,
      options.definition,
      options.getCardDefinitionById,
      {
        sourceInstanceId: options.card.instanceId,
        ...(options.evaluateCondition
          ? { evaluateCondition: options.evaluateCondition }
          : {}),
      }
    )
  ) {
    return { kind: "summon_condition_failed" };
  }

  if (
    options.actionKind === "summon" &&
    !canSummonCardTensho(
      options.state,
      options.actingPlayerId,
      options.definition,
      options.getCardDefinitionById
    )
  ) {
    return { kind: "tensho_target_missing" };
  }

  if (
    isCardUseRestricted(
      options.state,
      options.actingPlayerId,
      options.card,
      options.definition,
      options.getCardDefinitionById,
      options.actionKind
    )
  ) {
    return { kind: "restricted" };
  }

  if (
    isBlockedByFieldNameUniqueness(
      options.state,
      options.actingPlayerId,
      options.definition,
      options.getCardDefinitionById,
      options.evaluateCondition
    )
  ) {
    return { kind: "field_name_uniqueness" };
  }

  return { kind: "allowed" };
}

/**
 * 「直接合体するように召喚できる」型の brave_combine_effect で、合体元が場外なら
 * 通常の召喚制限とアルティメット召喚条件を共有ゲートとして見る。
 */
export function evaluateBraveCombineAsSummonGate(options: {
  state: GameState;
  brave: CardInstance;
  braveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  evaluateCondition?: (
    state: GameState,
    condition: Condition,
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean;
}): BraveCombineAsSummonGateResult {
  const { state, brave, braveDef, getCardDefinitionById } = options;
  if (brave.zone === "field") return { kind: "allowed" };

  return evaluateSummonDeclarationGate({
    state,
    actingPlayerId: brave.controllerPlayerId,
    card: brave,
    definition: braveDef,
    actionKind: "summon",
    getCardDefinitionById,
    ...(options.evaluateCondition
      ? { evaluateCondition: options.evaluateCondition }
      : {}),
  });
}

/**
 * 転召（[[CardDefinition.tenshoSummon]]）の強制コア消費対象になりうる自分のスピリットを列挙する。
 * - 場の自分のスピリットで `targetFilter` を満たし、かつ動かせる通常コアが `minCores` 個以上ある個体。
 * - ソウルコアはボイド不可（[[project_soul_core_movement_generic]]）で、現状の転召カードは全て送り先=ボイド。
 *   実行（`executeCoreMove` card_instance 経路）も通常コアのみ動かすため、適法性も通常コア数で数える
 *   （送り先がトラッシュ/リザーブのカードは未登場。登場時に soul 移送と合わせて拡張する）。
 * - 召喚宣言時（場入り前）の適法性ゲート（`canSummonCardTensho`）と解決時の対象算出の両方で使う SSOT。
 */
export function getTenshoTargetCandidates(
  state: GameState,
  actingPlayerId: string,
  tensho: TenshoSummon,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  excludeInstanceId?: string
): string[] {
  const result: string[] = [];
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== actingPlayerId) continue;
    if (excludeInstanceId && card.instanceId === excludeInstanceId) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    const coreCount = getTotalCoresOnCardById(state, card.instanceId);
    if (
      !matchesCardFilter(card, def, tensho.targetFilter, {
        state,
        coreCount,
        effectiveColors: getEffectiveColors(state, card, def),
        effectiveBp: getCombinedUnitBp(state, card, def, getCardDefinitionById),
        effectiveLevel: getEffectiveLevel(
          state,
          card,
          def,
          getCardDefinitionById
        ),
        effectiveSymbolCount: getCombinedUnitSymbolCount(
          state,
          card,
          def,
          getCardDefinitionById
        ),
      })
    ) {
      continue;
    }
    if (card.normalCoreCount < tensho.minCores) continue;
    result.push(card.instanceId);
  }
  return result;
}

/**
 * 転召を持つカードを召喚宣言できるか（対象が 1 体以上存在するか）。
 * 転召は召喚手順内ステップで、対象不在なら召喚宣言自体が不可（裁定 2026-06-14, 10_rules/07b）。
 * 転召を持たないカードは常に true。
 */
export function canSummonCardTensho(
  state: GameState,
  actingPlayerId: string,
  definition: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (!definition.tenshoSummon) return true;
  return (
    getTenshoTargetCandidates(
      state,
      actingPlayerId,
      definition.tenshoSummon,
      getCardDefinitionById
    ).length > 0
  );
}

export function createAttackLegalActionId(sourceInstanceId: string): string {
  return `legal:attack:${sourceInstanceId}`;
}

export function createSpiritTargetAttackLegalActionId(
  sourceInstanceId: string,
  targetInstanceId: string
): string {
  return `legal:attack:spirit:${sourceInstanceId}:${targetInstanceId}`;
}

export function createJoinActiveAttackLegalActionId(
  sourceInstanceId: string,
  attackId: string
): string {
  return `legal:join_active_attack:${sourceInstanceId}:${attackId}`;
}

export function createBlockLegalActionId(
  sourceInstanceId: string,
  participantEntityId: string
): string {
  return `legal:block:${sourceInstanceId}:${participantEntityId}`;
}

export function createOpenBattleFlashLegalActionId(
  attackId: string,
  flashKind: "before_block" | "after_block"
): string {
  return `legal:open-battle-flash:${flashKind}:${attackId}`;
}

export function createPassBattleFlashLegalActionId(
  attackId: string,
  flashKind: "before_block" | "after_block"
): string {
  return `legal:pass-battle-flash:${flashKind}:${attackId}`;
}

export function createPassStackLegalActionId(actingPlayerId: string): string {
  return `legal:pass-stack:${actingPlayerId}`;
}

export function createDeclineBlockLegalActionId(attackId: string): string {
  return `legal:decline-block:${attackId}`;
}

export function createEndAttackStepLegalActionId(
  actingPlayerId: string
): string {
  return `legal:end-attack-step:${actingPlayerId}`;
}

export function createPassPreDeclarationStackLegalActionId(
  declarationKind: "attack" | "block" | "forced_block" | "join_active_attack",
  actingPlayerId: string
): string {
  return `legal:pass-pre-declaration-stack:${declarationKind}:${actingPlayerId}`;
}

export function resolveLegalActionTargets(
  action: TargetSelectableLegalAction,
  targetInstanceIds: string[] | undefined
): string[] {
  if (action.targetMode === "none") {
    if (targetInstanceIds && targetInstanceIds.length > 0) {
      throw new Error(`Legal action does not take targets: ${action.actionId}`);
    }

    return [];
  }

  if (!targetInstanceIds) {
    // 可変選択 (max>required) で min=0 の場合のみ空配列を許容
    if (
      action.requiredTargetCount === 0 &&
      action.maxTargetCount !== undefined &&
      action.maxTargetCount > 0
    ) {
      return [];
    }
    throw new Error(`Legal action requires targets: ${action.actionId}`);
  }

  // 可変選択時は [requiredTargetCount, maxTargetCount] の範囲で許容
  // maxTargetCount 省略時は requiredTargetCount と等しい（固定数）
  const maxCount =
    action.maxTargetCount !== undefined &&
    action.maxTargetCount > action.requiredTargetCount
      ? action.maxTargetCount
      : action.requiredTargetCount;
  const isVariable = maxCount > action.requiredTargetCount;

  if (isVariable) {
    if (
      targetInstanceIds.length < action.requiredTargetCount ||
      targetInstanceIds.length > maxCount
    ) {
      throw new Error(
        `Legal action target count out of range: action=${action.actionId} expected=[${action.requiredTargetCount}..${maxCount}] actual=${targetInstanceIds.length}`
      );
    }
  } else if (targetInstanceIds.length !== action.requiredTargetCount) {
    throw new Error(
      `Legal action target count does not match: action=${action.actionId} expected=${action.requiredTargetCount} actual=${targetInstanceIds.length}`
    );
  }

  // 重複した instanceId を弾く。optional repeat のように同じ対象を複数回選び直せる
  // action は allowDuplicateTargets で順序付き選択を許可する。
  const seen = new Set<string>();
  for (const targetInstanceId of targetInstanceIds) {
    if (
      !("allowDuplicateTargets" in action && action.allowDuplicateTargets) &&
      seen.has(targetInstanceId)
    ) {
      throw new Error(
        `Duplicate target for action ${action.actionId}: ${targetInstanceId}`
      );
    }
    seen.add(targetInstanceId);
    if (!action.candidateTargetInstanceIds.includes(targetInstanceId)) {
      throw new Error(
        `Target is not a legal candidate for action ${action.actionId}: ${targetInstanceId}`
      );
    }
  }

  assertLegalActionTargetGroupsSatisfied({
    actionId: action.actionId,
    targetInstanceIds,
    ...(action.targetGroups !== undefined
      ? { targetGroups: action.targetGroups }
      : {}),
    ...(action.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: action.allowDuplicateTargets }
      : {}),
    label: "Legal action target group",
  });

  return [...targetInstanceIds];
}

export function resolveChosenLifeCoreKind(
  action: LifeCoreSelectableLegalAction,
  chosenLifeCoreKind: LifeCoreKind | null | undefined
): LifeCoreKind | undefined {
  if (chosenLifeCoreKind === null || chosenLifeCoreKind === undefined) {
    if (action.requiresChosenLifeCoreKind) {
      throw new Error(
        `Legal action requires a life-core choice: ${action.actionId}`
      );
    }

    return undefined;
  }

  if (!action.availableChosenLifeCoreKinds.includes(chosenLifeCoreKind)) {
    throw new Error(
      `Life-core choice is not legal for action ${action.actionId}: ${chosenLifeCoreKind}`
    );
  }

  return chosenLifeCoreKind;
}

export function resolvePaymentSources(
  action:
    | UseMagicLegalAction
    | UseAccelLegalAction
    | UseChangeLegalAction
    | SummonLegalAction
    | PlaceNexusLegalAction,
  paymentSources: readonly CardCostPaymentSource[] | undefined
): readonly CardCostPaymentSource[] {
  if (!paymentSources || paymentSources.length === 0) {
    if (action.finalCost === 0) {
      return [];
    }

    throw new Error(
      `Legal action requires payment sources: ${action.actionId}`
    );
  }

  const resolved = [...paymentSources];
  assertPaymentSourcesAreAvailable({
    paymentSources: resolved,
    availableReserveCoreAmount: action.availableReserveCoreAmount,
    availableOnBoardCoreSources: action.availableOnBoardCoreSources,
  });
  if (
    "onBoardCoreSourceFilter" in action &&
    action.onBoardCoreSourceFilter !== undefined
  ) {
    assertReserveOrOnBoardExclusivePaymentSources(resolved);
  }
  return resolved;
}

/**
 * 使用回数制限の最大回数を取得する。
 *
 * `limit.maxCountOverrides` が指定されている場合は、context (state+sourceInstanceId) を渡し
 * 評価する。最初に成立した override の maxCount を返す。何も成立しなければ base maxCount
 * (省略時 1) を返す。
 *
 * BSAZ01-X01[1] 「合体中、この効果を[ターンに3回]に変更する」用 (2026-06-26)。
 * 循環 import 回避のため、evaluator は inline (combined / count_value のみ対応)。新 clause は
 * evaluateUsageLimitClause に追加する。
 */
export function getUsageLimitMaxCount(
  limit: EffectUsageLimit,
  context?: {
    state: GameState;
    sourceInstanceId: string;
    sourceDefinitionId?: string;
    getCardDefinitionById?:
      | ((id: string) => CardDefinition | undefined)
      | undefined;
  }
): number {
  let base = limit.maxCount ?? 1;
  if (limit.maxCountAdditionalDynamic !== undefined && context) {
    const source = getCardById(context.state, context.sourceInstanceId);
    const actingPlayerId = source?.controllerPlayerId ?? source?.ownerPlayerId;
    if (actingPlayerId) {
      const sourceDefinitionId =
        source?.definitionId ?? context.sourceDefinitionId;
      const sourceContext = dynamicCountContextForSourceDefinition(
        sourceDefinitionId !== undefined
          ? context.getCardDefinitionById?.(sourceDefinitionId)
          : undefined
      );
      base += evaluateContinuousDynamicAmount(
        context.state,
        actingPlayerId,
        limit.maxCountAdditionalDynamic,
        context.getCardDefinitionById,
        sourceContext
      );
    }
  }
  const overrides = limit.maxCountOverrides;
  if (!overrides || overrides.length === 0 || !context) return base;
  for (const ov of overrides) {
    if (ov.when.every((clause) => evaluateUsageLimitClause(clause, context))) {
      return ov.maxCount;
    }
  }
  return base;
}

/**
 * usageLimit.maxCountOverrides 用の inline 条件評価。循環 import 回避のため
 * structured-effect-interpreter の evaluateConditionClause からは独立。
 * 必要に応じて clause 種類を増やす（カード定義参照が要らないものに限定）。
 */
function evaluateUsageLimitClause(
  clause: Condition[number],
  context: { state: GameState; sourceInstanceId: string }
): boolean {
  switch (clause.kind) {
    case "combined": {
      const source = getCardById(context.state, context.sourceInstanceId);
      if (!source) return false;
      return isEffectivelyCombined(context.state, source);
    }
    case "count_value": {
      const source = getCardById(context.state, context.sourceInstanceId);
      const sourcePlayerId =
        source?.controllerPlayerId ?? source?.ownerPlayerId;
      if (!sourcePlayerId) return false;
      const playerId =
        clause.player === "opponent"
          ? context.state.players
              .map((player) => player.id)
              .find((id) => id !== sourcePlayerId)
          : sourcePlayerId;
      if (!playerId) return false;
      const countValue =
        context.state.players.find((player) => player.id === playerId)
          ?.countValue ?? 0;
      if (clause.min !== undefined && countValue < clause.min) return false;
      if (clause.max !== undefined && countValue > clause.max) return false;
      return true;
    }
    default:
      return false;
  }
}

/**
 * 使用回数制限の期間軸を取得する。省略時は "turn"。
 */
export function getUsageLimitDuration(
  limit: EffectUsageLimit
): EffectUsageLimitDuration {
  return limit.duration ?? "turn";
}

/**
 * レコードが現在の state に対して、指定 duration のスコープ内にあるか判定する。
 */
/**
 * レコードの duration スコープ判定。`effectUsageRecords` / `effectOccurrenceRecords`
 * (ENGINE-nth-occurrence-trigger-gate) 双方で共有する SSOT。
 */
export function isRecordInDurationScope(
  record: EffectUsageRecord,
  state: GameState,
  duration: EffectUsageLimitDuration
): boolean {
  switch (duration) {
    case "turn":
      return record.turnNumber === state.turnNumber;
    case "game":
      return true;
    case "step":
      return (
        record.turnNumber === state.turnNumber && record.step === state.step
      );
    case "battle":
      return (
        record.attackId != null &&
        record.attackId === (state.activeAttack?.attackId ?? null)
      );
    default:
      return true;
  }
}

// --- effectUsageRecords 索引 (WeakMap 遅延キャッシュ) ---

interface UsageRecordIndex {
  readonly byInstanceId: ReadonlyMap<string, readonly EffectUsageRecord[]>;
  readonly byDefinitionId: ReadonlyMap<string, readonly EffectUsageRecord[]>;
}

const usageRecordCache = new WeakMap<
  readonly EffectUsageRecord[],
  UsageRecordIndex
>();

function buildUsageRecordIndex(
  records: readonly EffectUsageRecord[]
): UsageRecordIndex {
  let index = usageRecordCache.get(records);
  if (!index) {
    const byInstanceId = new Map<string, EffectUsageRecord[]>();
    const byDefinitionId = new Map<string, EffectUsageRecord[]>();
    for (const r of records) {
      let instArr = byInstanceId.get(r.sourceInstanceId);
      if (!instArr) {
        instArr = [];
        byInstanceId.set(r.sourceInstanceId, instArr);
      }
      instArr.push(r);
      let defArr = byDefinitionId.get(r.sourceDefinitionId);
      if (!defArr) {
        defArr = [];
        byDefinitionId.set(r.sourceDefinitionId, defArr);
      }
      defArr.push(r);
    }
    index = { byInstanceId, byDefinitionId };
    usageRecordCache.set(records, index);
  }
  return index;
}

function getUsageSourcePlayerId(
  state: GameState,
  source: { sourceInstanceId: string; playerId?: string }
): string | undefined {
  if (source.playerId) {
    return source.playerId;
  }
  // cardInstances 未設定の最小 state（一部 unit test が `as GameState` で渡す）でも
  // クラッシュしないよう防御する。未解決なら player スコープ無し（従来挙動）にフォールバック。
  const sourceCard = state.cardInstances?.find(
    (card) => card.instanceId === source.sourceInstanceId
  );
  return sourceCard?.controllerPlayerId ?? sourceCard?.ownerPlayerId;
}

/**
 * choice 変種ごとに独立した使用制限 (「ターンに1回ずつ」) 用の使用記録ラベル。
 * effect 単位の stable label (`getStableEffectLabel` / "magic" 等) に
 * `:choice:${choiceIndex}` を suffix する (choiceIndex 0=デフォルト, 1+=choice[k-1])。
 * effect 単位 usageLimit (Effect.usageLimit) は従来どおり suffix なしの共有ラベル。
 */
export function getChoiceVariantUsageLabel(
  baseLabel: string,
  choiceIndex: number
): string {
  return `${baseLabel}:choice:${choiceIndex}`;
}

/**
 * recordedUsage (P3-62 払い戻し情報) を複数エントリから合成する。
 * 先頭の defined エントリを主記録、残りを extraRecords に積む。全 undefined なら undefined。
 */
export function composeRecordedUsage(
  entries: readonly (import("../model").RecordedEffectUsageEntry | undefined)[]
): import("../model").RecordedEffectUsage | undefined {
  const defined = entries.filter(
    (e): e is import("../model").RecordedEffectUsageEntry => e !== undefined
  );
  if (defined.length === 0) return undefined;
  const [primary, ...rest] = defined;
  return {
    ...primary!,
    ...(rest.length > 0 ? { extraRecords: rest } : {}),
  };
}

/**
 * P3-24 Phase 2 choice 変種の対象系メタデータ (registration 横断の共通形)。
 * triggered / battle_immediate / magic の各 ChoiceVariant 型はこの形を満たす。
 * per-variant usageLimit (「ターンに1回ずつ」) もここに載る。
 */
export interface EffectChoiceVariantTargetMeta {
  label: string;
  requiredTargetCount?: number;
  maxTargetCount?: number;
  maxTargetCountDynamic?: import("../dsl-types").CountBound;
  targetEffectFilterTags?: readonly import("../state-based-actions").EffectFilterTag[];
  targetEffectAspect?: string;
  candidateTargetZones?: readonly import("../model").Zone[];
  candidateTargetPlayerScope?: "any" | "acting_player" | "opponent";
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  sourceAttachedChildrenOnly?: boolean;
  starGarmentTargetEligibleOnly?: boolean;
  sourceRequiredOpenUnderCardSlot?: import("./legal-actions-types").RegisteredSourceUnderCardSlotRequirement;
  sourceRequiredUnderCard?: import("./legal-actions-types").RegisteredSourceUnderCardRequirement;
  targetRequiresFullCount?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  targetSelectionBypassesAffectGate?: boolean;
  targetSelectionBypassesPreventionGate?: boolean;
  targetCandidatesRequireSetBurstState?: boolean;
  targetGroups?: readonly RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("./legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("./legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("./legal-actions-types").RequiredDiscardCost;
  chooser?: "self" | "opponent" | "either";
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}

/**
 * choice 変種メタを registration top-level にマージした擬似 registration を生成する
 * 共通コア (SSOT)。triggered / battle_immediate の merge 関数と magic の変種展開が
 * 全てここへ委譲する。
 *
 * choices に上書き対象フィールドが存在しない場合は、registration top-level の値ではなく
 * variant 由来の undefined にする (top-level は choices 不在時のデフォルトであり、
 * choices 持ちの effect では variant 単独の値だけが意味を持つ)。
 * variant.usageLimit は top-level (= effect 単位共有制限) にマージ**しない**。
 * 変種別制限は呼び出し側が `getChoiceVariantUsageLabel` の別ラベルで独立に検査する。
 */
export function mergeRegistrationChoiceVariant<
  T extends {
    requiredTargetCount?: number;
    maxTargetCount?: number;
    maxTargetCountDynamic?: import("../dsl-types").CountBound;
    targetEffectFilterTags?: readonly import("../state-based-actions").EffectFilterTag[];
    targetEffectAspect?: string;
    candidateTargetZones?: readonly import("../model").Zone[];
    candidateTargetPlayerScope?: "any" | "acting_player" | "opponent";
    targetCardFilter?: import("../dsl-types").CardFilter;
    targetExcludeSelf?: boolean;
    sourceUnderCardRole?: "advent_source" | "text_role";
    sourceAttachedChildrenOnly?: boolean;
    starGarmentTargetEligibleOnly?: boolean;
    sourceRequiredOpenUnderCardSlot?: import("./legal-actions-types").RegisteredSourceUnderCardSlotRequirement;
    sourceRequiredUnderCard?: import("./legal-actions-types").RegisteredSourceUnderCardRequirement;
    targetRequiresFullCount?: boolean;
    targetCardFilterActionKind?:
      | "destroy"
      | "vanish"
      | "bounce"
      | "prevent_battle"
      | "exhaust"
      | "recover";
    targetExhaustState?: "exhausted" | "heavily_exhausted";
    targetSelectionBypassesAffectGate?: boolean;
    targetSelectionBypassesPreventionGate?: boolean;
    targetCandidatesRequireSetBurstState?: boolean;
    targetGroups?: readonly RegisteredTargetGroup[];
    targetStepId?: string;
    allowDuplicateTargets?: boolean;
    targetGatedByConditionalCost?: boolean;
    requiredPayCostAmount?: number;
    requiredCountCostAmount?: number;
    requiredCountCostPlayer?: import("../model").EffectPlayerRef;
    requiredSelectedTargetsCountCost?: import("./legal-actions-types").RequiredSelectedTargetsCountCost;
    requiredCoreMoveCost?: import("./legal-actions-types").RequiredCoreMoveCost;
    requiredDiscardCost?: import("./legal-actions-types").RequiredDiscardCost;
    chooser?: "self" | "opponent" | "either";
  },
>(registration: T, variant: EffectChoiceVariantTargetMeta): T {
  const {
    requiredTargetCount: _r,
    maxTargetCount: _m,
    maxTargetCountDynamic: _md,
    targetEffectFilterTags: _t,
    targetEffectAspect: _aspect,
    candidateTargetZones: _z,
    candidateTargetPlayerScope: _p,
    targetCardFilter: _f,
    targetExcludeSelf: _e,
    sourceUnderCardRole: _sourceUnderCardRole,
    sourceAttachedChildrenOnly: _sourceAttachedChildrenOnly,
    starGarmentTargetEligibleOnly: _starGarmentTargetEligibleOnly,
    sourceRequiredOpenUnderCardSlot: _sourceRequiredOpenUnderCardSlot,
    sourceRequiredUnderCard: _sourceRequiredUnderCard,
    targetRequiresFullCount: _targetRequiresFullCount,
    targetCardFilterActionKind: _a,
    targetExhaustState: _targetExhaustState,
    targetSelectionBypassesAffectGate: _bypass,
    targetSelectionBypassesPreventionGate: _preventionBypass,
    targetCandidatesRequireSetBurstState: _setBurst,
    targetGroups: _groups,
    targetStepId: _s,
    allowDuplicateTargets: _d,
    targetGatedByConditionalCost: _g,
    requiredPayCostAmount: _pc,
    requiredCountCostAmount: _cc,
    requiredCountCostPlayer: _ccp,
    requiredSelectedTargetsCountCost: _stcc,
    requiredCoreMoveCost: _cmc,
    requiredDiscardCost: _dc,
    chooser: _c,
    ...rest
  } = registration;
  // exactOptionalPropertyTypes 下では undefined 代入を避けるため、ある場合のみ spread する
  return {
    ...rest,
    ...(variant.requiredTargetCount !== undefined
      ? { requiredTargetCount: variant.requiredTargetCount }
      : {}),
    ...(variant.maxTargetCount !== undefined
      ? { maxTargetCount: variant.maxTargetCount }
      : {}),
    ...(variant.maxTargetCountDynamic !== undefined
      ? { maxTargetCountDynamic: variant.maxTargetCountDynamic }
      : {}),
    ...(variant.targetEffectFilterTags !== undefined
      ? { targetEffectFilterTags: variant.targetEffectFilterTags }
      : {}),
    ...(variant.targetEffectAspect !== undefined
      ? { targetEffectAspect: variant.targetEffectAspect }
      : {}),
    ...(variant.candidateTargetZones !== undefined
      ? { candidateTargetZones: variant.candidateTargetZones }
      : {}),
    ...(variant.candidateTargetPlayerScope !== undefined
      ? { candidateTargetPlayerScope: variant.candidateTargetPlayerScope }
      : {}),
    ...(variant.targetCardFilter !== undefined
      ? { targetCardFilter: variant.targetCardFilter }
      : {}),
    ...(variant.targetExcludeSelf !== undefined
      ? { targetExcludeSelf: variant.targetExcludeSelf }
      : {}),
    ...(variant.sourceUnderCardRole !== undefined
      ? { sourceUnderCardRole: variant.sourceUnderCardRole }
      : {}),
    ...(variant.sourceAttachedChildrenOnly !== undefined
      ? { sourceAttachedChildrenOnly: variant.sourceAttachedChildrenOnly }
      : {}),
    ...(variant.starGarmentTargetEligibleOnly !== undefined
      ? { starGarmentTargetEligibleOnly: variant.starGarmentTargetEligibleOnly }
      : {}),
    ...(variant.sourceRequiredOpenUnderCardSlot !== undefined
      ? {
          sourceRequiredOpenUnderCardSlot:
            variant.sourceRequiredOpenUnderCardSlot,
        }
      : {}),
    ...(variant.sourceRequiredUnderCard !== undefined
      ? { sourceRequiredUnderCard: variant.sourceRequiredUnderCard }
      : {}),
    ...(variant.targetRequiresFullCount !== undefined
      ? { targetRequiresFullCount: variant.targetRequiresFullCount }
      : {}),
    ...(variant.targetCardFilterActionKind !== undefined
      ? { targetCardFilterActionKind: variant.targetCardFilterActionKind }
      : {}),
    ...(variant.targetExhaustState !== undefined
      ? { targetExhaustState: variant.targetExhaustState }
      : {}),
    ...(variant.targetSelectionBypassesAffectGate !== undefined
      ? {
          targetSelectionBypassesAffectGate:
            variant.targetSelectionBypassesAffectGate,
        }
      : {}),
    ...(variant.targetSelectionBypassesPreventionGate !== undefined
      ? {
          targetSelectionBypassesPreventionGate:
            variant.targetSelectionBypassesPreventionGate,
        }
      : {}),
    ...(variant.targetCandidatesRequireSetBurstState !== undefined
      ? {
          targetCandidatesRequireSetBurstState:
            variant.targetCandidatesRequireSetBurstState,
        }
      : {}),
    ...(variant.targetGroups !== undefined
      ? { targetGroups: variant.targetGroups }
      : {}),
    ...(variant.targetStepId !== undefined
      ? { targetStepId: variant.targetStepId }
      : {}),
    ...(variant.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: variant.allowDuplicateTargets }
      : {}),
    ...(variant.targetGatedByConditionalCost !== undefined
      ? { targetGatedByConditionalCost: variant.targetGatedByConditionalCost }
      : {}),
    ...(variant.requiredPayCostAmount !== undefined
      ? { requiredPayCostAmount: variant.requiredPayCostAmount }
      : {}),
    ...(variant.requiredCountCostAmount !== undefined
      ? { requiredCountCostAmount: variant.requiredCountCostAmount }
      : {}),
    ...(variant.requiredCountCostPlayer !== undefined
      ? { requiredCountCostPlayer: variant.requiredCountCostPlayer }
      : {}),
    ...(variant.requiredSelectedTargetsCountCost !== undefined
      ? {
          requiredSelectedTargetsCountCost:
            variant.requiredSelectedTargetsCountCost,
        }
      : {}),
    ...(variant.requiredCoreMoveCost !== undefined
      ? { requiredCoreMoveCost: variant.requiredCoreMoveCost }
      : {}),
    ...(variant.requiredDiscardCost !== undefined
      ? { requiredDiscardCost: variant.requiredDiscardCost }
      : {}),
    ...(variant.chooser !== undefined ? { chooser: variant.chooser } : {}),
  } as T;
}

/**
 * effectIndex を持つ registration には経路非依存の安定した effectLabel を返す。
 * triggered / battle_immediate 両方で同じラベルになり、usageLimit が共有される。
 */
export function getStableEffectLabel(
  fallbackPrefix: string,
  fallbackIndex: number,
  registration?: { effectIndex?: number; choiceIndex?: number }
): string {
  // P3-24: usageLimit は effect 単位で共有する。
  // choice 変種ごとに別ラベルにすると「ターンに1回, A or B」が両方使える bug になるため、
  // effectIndex があれば choiceIndex を無視して effect:N のラベルに統一する。
  if (registration?.effectIndex !== undefined) {
    return `effect:${registration.effectIndex}`;
  }
  return `${fallbackPrefix}:${fallbackIndex}`;
}

/**
 * step-level usageLimit の記録/事前判定で共有する安定ラベル。
 *
 * Effect interpreter が実行時に記録するラベルと、宣言前 availability が参照する
 * ラベルを一致させる。これにより、単一の即時効果 step に付いた「ステップに1回」等を
 * 解決時の skip ではなく、次の宣言を積む前に止められる。
 */
export function getStepUsageLabel(
  sourceDefinitionId: string,
  effectIndex: number,
  stepIndex: number,
  usageGroupId?: string
): string {
  return `__step:${sourceDefinitionId}:${effectIndex}:${usageGroupId ?? stepIndex}`;
}

/**
 * 使用回数制限に基づき、効果を発揮できるかどうかを判定する。
 *
 * - "per_instance": 〔ターンに1回〕等 — 同一 instanceId + effectLabel の使用回数が maxCount 未満。
 * - "per_card_name": 〔ターンに1回:同名〕等 — 同一 definitionId + effectLabel の使用回数が maxCount 未満。
 * - "no_duplicate": 〔重複不可〕— 同一 definitionId + effectLabel が未使用。
 */
export function canUseEffectByUsageLimit(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  playerId?: string;
  /** 発揮する効果そのもの。魂状態を含むかの判定に用い、ラベルから効果番号を推測しない。 */
  sourceEffect?: Effect | undefined;
  effectLabel: string;
  usageLimit: EffectUsageLimit | EffectUsageLimit[];
  /** 共有使用制限グループ ID。設定時は effectLabel ではなく groupId でレコードをマッチする。 */
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y の instanceId。
   * triggered 効果の declare/availability 経路で pendingEffect.relatedInstanceId を渡す。
   * 他 kind では参照されない (undefined OK)。
   */
  relatedInstanceId?: string;
  /**
   * 〔重複不可〕(`no_duplicate`) per-event scope key。通常は
   * `PendingTriggeredEffect.pendingId`。同一 trigger event 内のみで畳むため、別 event
   * (= 別 pendingId) で記録された no_duplicate レコードと混同しない。
   * triggered 効果の queue/availability/resolve 経路で渡す。他 kind では参照されない。
   * 10_rules/03c §〔重複不可〕 per-event scope (裁定 2026-06-24)。
   */
  triggerEventScopeKey?: string;
  /**
   * `per_trigger_activation` 用: 同一 effect activation 由来 trigger 群を識別するキー。
   * 通常は `PendingTriggeredEffect.chainId`。同 chainId 内の listener 発火を 1 回に dedup する。
   * triggered 効果の queue/availability/resolve 経路で渡す。他 kind では参照されない。
   * ENGINE-trigger-per-effect-activation-dedup。
   */
  triggerActivationKey?: string;
}): boolean {
  const { usageLimit } = options;
  // 配列の場合: すべての制限を通過する必要がある (AND 条件)
  if (Array.isArray(usageLimit)) {
    return usageLimit.every((single) =>
      canUseEffectByUsageLimitSingle({
        ...options,
        usageLimit: single,
        shareRelatedUsageByName: usageLimit.some(
          (limit) => limit.kind === "no_duplicate"
        ),
      })
    );
  }
  return canUseEffectByUsageLimitSingle(
    options as Parameters<typeof canUseEffectByUsageLimitSingle>[0]
  );
}

function canUseEffectByUsageLimitSingle(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  playerId?: string;
  /** 発揮する効果そのもの。魂状態を含むかの判定に用い、ラベルから効果番号を推測しない。 */
  sourceEffect?: Effect | undefined;
  effectLabel: string;
  usageLimit: EffectUsageLimit;
  /** 重複不可との併用時は、同名の発揮元を替えても主語の使用済み回数を共有する。 */
  shareRelatedUsageByName?: boolean;
  groupId?: string;
  relatedInstanceId?: string;
  triggerEventScopeKey?: string;
  triggerActivationKey?: string;
}): boolean {
  const {
    state,
    sourceInstanceId,
    sourceDefinitionId,
    getCardDefinitionById,
    effectLabel,
    usageLimit,
    groupId,
    relatedInstanceId,
    triggerEventScopeKey,
    triggerActivationKey,
  } = options;
  const maxCount = getUsageLimitMaxCount(usageLimit, {
    state,
    sourceInstanceId,
    sourceDefinitionId,
    getCardDefinitionById,
  });
  const duration = getUsageLimitDuration(usageLimit);
  const idx = buildUsageRecordIndex(state.effectUsageRecords);
  const sourcePlayerId = getUsageSourcePlayerId(state, options);

  /** effectLabel または groupId でレコードをマッチ */
  const matchesLabel = (r: EffectUsageRecord): boolean =>
    groupId ? r.groupId === groupId : r.effectLabel === effectLabel;
  const matchesSourcePlayer = (r: EffectUsageRecord): boolean => {
    if (!sourcePlayerId) {
      return true;
    }
    const recordPlayerId = getUsageSourcePlayerId(state, r);
    return !recordPlayerId || recordPlayerId === sourcePlayerId;
  };

  switch (usageLimit.kind) {
    case "per_group": {
      if (!groupId) return false;
      const totalCount = state.effectUsageRecords
        .filter(
          (r) =>
            matchesLabel(r) &&
            matchesSourcePlayer(r) &&
            isRecordInDurationScope(r, state, duration)
        )
        .reduce((sum, r) => sum + r.count, 0);
      return totalCount < maxCount;
    }
    case "per_instance": {
      const sourceCard = getCardById(state, sourceInstanceId);
      const sourceGeneration = sourceCard?.fieldInstanceGeneration ?? 0;
      const sourceSoulGeneration = sourceCard?.soulStateGeneration ?? 0;
      const preservesSoulStateUsage = effectIncludesSoulState(
        options.sourceEffect,
        getCardDefinitionById?.(sourceDefinitionId)?.textLines
      );
      const records = idx.byInstanceId.get(sourceInstanceId) ?? [];
      const totalCount = records
        .filter(
          (r) =>
            (r.sourceFieldInstanceGeneration ?? 0) === sourceGeneration &&
            (preservesSoulStateUsage ||
              (r.sourceSoulStateGeneration ?? 0) === sourceSoulGeneration) &&
            matchesLabel(r) &&
            isRecordInDurationScope(r, state, duration)
        )
        .reduce((sum, r) => sum + r.count, 0);
      return totalCount < maxCount;
    }
    case "per_card_name": {
      const records = idx.byDefinitionId.get(sourceDefinitionId) ?? [];
      const totalCount = records
        .filter(
          (r) =>
            matchesLabel(r) &&
            matchesSourcePlayer(r) &&
            isRecordInDurationScope(r, state, duration)
        )
        .reduce((sum, r) => sum + r.count, 0);
      return totalCount < maxCount;
    }
    case "no_duplicate": {
      // 10_rules/03c §〔重複不可〕 per-event scope (裁定 2026-06-24, ENGINE-no-duplicate-per-event-scope)
      // no_duplicate は同一 trigger event (= 同 pendingId) 内のみで畳む。`duration` は無視する
      // (model.ts:895 doc コメントどおり)。
      // - triggerEventScopeKey が両側で defined: 一致した record のみ match (同 event 内畳み)。
      // - 両側 undefined: legacy 経路 (非 trigger 呼び出し) として全 record 照合。
      // - 片側のみ undefined: 別 event 扱いで no match (new event 発火を妨げない)。
      const records = idx.byDefinitionId.get(sourceDefinitionId) ?? [];
      const used = records.some(
        (r) =>
          matchesLabel(r) &&
          matchesSourcePlayer(r) &&
          (r.triggerEventScopeKey ?? null) === (triggerEventScopeKey ?? null)
      );
      return !used;
    }
    case "per_trigger_related_instance": {
      // 主語 Y (relatedInstanceId) 別に独立 turn 1 回 (or maxCount 回)。
      // 同一 (sourceInstanceId, effectLabel, relatedInstanceId) で maxCount 未満かを判定。
      const records = options.shareRelatedUsageByName
        ? (idx.byDefinitionId.get(sourceDefinitionId) ?? [])
        : (idx.byInstanceId.get(sourceInstanceId) ?? []);
      const relatedGeneration = relatedInstanceId
        ? (getCardById(state, relatedInstanceId)?.fieldInstanceGeneration ?? 0)
        : 0;
      const totalCount = records
        .filter(
          (r) =>
            matchesLabel(r) &&
            matchesSourcePlayer(r) &&
            r.relatedInstanceId === relatedInstanceId &&
            (r.relatedFieldInstanceGeneration ?? 0) === relatedGeneration &&
            isRecordInDurationScope(r, state, duration)
        )
        .reduce((sum, r) => sum + r.count, 0);
      return totalCount < maxCount;
    }
    case "per_trigger_activation": {
      // ENGINE-trigger-per-effect-activation-dedup: 同一 effect activation 由来の
      // 複数 triggered 発火 (1 破壊効果が複数体を破壊した per-card emit 等) を、
      // activation 単位 (= 同 chainId) で dedup する。
      // triggerActivationKey が undefined (state-based / 非 triggered 由来) のときは
      // legacy per-instance 同様の挙動とする (record 全件 vs maxCount で判定)。
      const records = idx.byInstanceId.get(sourceInstanceId) ?? [];
      const totalCount = records
        .filter(
          (r) =>
            matchesLabel(r) &&
            (r.triggerActivationKey ?? null) ===
              (triggerActivationKey ?? null) &&
            isRecordInDurationScope(r, state, duration)
        )
        .reduce((sum, r) => sum + r.count, 0);
      return totalCount < maxCount;
    }
    default:
      return true;
  }
}

/**
 * 効果の使用を記録する。既存レコードがあれば count を加算し、なければ新規作成する。
 * 不変更新で新しい effectUsageRecords を返す。
 */
export function recordEffectUsage(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  playerId?: string;
  effectLabel: string;
  duration: EffectUsageLimitDuration;
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y の instanceId。
   * 同一 (sourceInstanceId, effectLabel) でも relatedInstanceId が異なれば別レコード。
   */
  relatedInstanceId?: string;
  /**
   * 〔重複不可〕(`no_duplicate`) per-event scope key。同一 trigger event 内 (= 同 pendingId)
   * の照合に使う。10_rules/03c §〔重複不可〕 per-event scope (裁定 2026-06-24)。
   */
  triggerEventScopeKey?: string;
  /**
   * `per_trigger_activation` 用: 同 chainId 内の record 畳み込みに使うキー。
   * ENGINE-trigger-per-effect-activation-dedup。他 kind では undefined で記録。
   */
  triggerActivationKey?: string;
}): EffectUsageRecord[] {
  const {
    state,
    sourceInstanceId,
    sourceDefinitionId,
    effectLabel,
    duration,
    groupId,
    relatedInstanceId,
    triggerEventScopeKey,
    triggerActivationKey,
  } = options;
  const playerId = getUsageSourcePlayerId(state, options);
  const attackId: string | null | undefined =
    duration === "battle" ? (state.activeAttack?.attackId ?? null) : undefined;
  const sourceFieldInstanceGeneration =
    getCardById(state, sourceInstanceId)?.fieldInstanceGeneration ?? 0;
  const sourceSoulStateGeneration =
    getCardById(state, sourceInstanceId)?.soulStateGeneration ?? 0;
  const relatedFieldInstanceGeneration = relatedInstanceId
    ? (getCardById(state, relatedInstanceId)?.fieldInstanceGeneration ?? 0)
    : 0;
  const existingIndex = state.effectUsageRecords.findIndex(
    (r) =>
      (r.sourceSoulStateGeneration ?? 0) === sourceSoulStateGeneration &&
      (r.sourceFieldInstanceGeneration ?? 0) ===
        sourceFieldInstanceGeneration &&
      r.sourceInstanceId === sourceInstanceId &&
      r.effectLabel === effectLabel &&
      r.duration === duration &&
      r.turnNumber === state.turnNumber &&
      r.step === state.step &&
      r.attackId === attackId &&
      r.relatedInstanceId === relatedInstanceId &&
      (r.relatedFieldInstanceGeneration ?? 0) ===
        relatedFieldInstanceGeneration &&
      r.triggerEventScopeKey === triggerEventScopeKey &&
      r.triggerActivationKey === triggerActivationKey
  );

  if (existingIndex >= 0) {
    return state.effectUsageRecords.map((r, i) =>
      i === existingIndex ? { ...r, count: r.count + 1 } : r
    );
  }

  return [
    ...state.effectUsageRecords,
    {
      sourceInstanceId,
      ...(sourceFieldInstanceGeneration > 0
        ? { sourceFieldInstanceGeneration }
        : {}),
      ...(sourceSoulStateGeneration > 0 ? { sourceSoulStateGeneration } : {}),
      sourceDefinitionId,
      ...(playerId ? { playerId } : {}),
      effectLabel,
      turnNumber: state.turnNumber,
      step: state.step,
      duration,
      count: 1,
      ...(attackId !== undefined ? { attackId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(relatedInstanceId ? { relatedInstanceId } : {}),
      ...(relatedInstanceId ? { relatedFieldInstanceGeneration } : {}),
      ...(triggerEventScopeKey ? { triggerEventScopeKey } : {}),
      ...(triggerActivationKey ? { triggerActivationKey } : {}),
    },
  ];
}

/**
 * usageLimit が設定されている場合のみ使用を記録し、更新済み state を返す。
 * usageLimit が undefined なら state をそのまま返す。
 * 配列の場合はすべての制限について記録する。
 */
export function recordEffectUsageIfLimited(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  playerId?: string;
  effectLabel: string;
  usageLimit: EffectUsageLimit | EffectUsageLimit[] | undefined;
  /** 共有使用制限グループ ID。設定時はレコードに groupId を保存し、
   *  canUseEffectByUsageLimit 側でも groupId 一致でマッチングする。 */
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y の instanceId。
   * 該当 kind のときのみレコードに保存する。他 kind では undefined で記録。
   */
  relatedInstanceId?: string;
  /**
   * 〔重複不可〕(`no_duplicate`) per-event scope key。同一 trigger event (= 同 pendingId)
   * の照合に使う。`no_duplicate` kind のときのみレコードに保存する。他 kind では undefined
   * で記録 (legacy 経路の挙動を変えない)。
   * 10_rules/03c §〔重複不可〕 per-event scope (裁定 2026-06-24)。
   */
  triggerEventScopeKey?: string;
  /**
   * `per_trigger_activation` 用: 同 chainId 内畳み込みキー。該当 kind のときのみ record。
   * ENGINE-trigger-per-effect-activation-dedup。
   */
  triggerActivationKey?: string;
}): GameState {
  if (!options.usageLimit) return options.state;

  const limits = Array.isArray(options.usageLimit)
    ? options.usageLimit
    : [options.usageLimit];

  let current = options.state;
  for (const limit of limits) {
    const isPerY = limit.kind === "per_trigger_related_instance";
    const isNoDup = limit.kind === "no_duplicate";
    const isPerActivation = limit.kind === "per_trigger_activation";
    current = {
      ...current,
      effectUsageRecords: recordEffectUsage({
        state: current,
        sourceInstanceId: options.sourceInstanceId,
        sourceDefinitionId: options.sourceDefinitionId,
        ...(options.playerId ? { playerId: options.playerId } : {}),
        effectLabel: options.effectLabel,
        duration: getUsageLimitDuration(limit),
        ...(options.groupId ? { groupId: options.groupId } : {}),
        ...(isPerY && options.relatedInstanceId
          ? { relatedInstanceId: options.relatedInstanceId }
          : {}),
        ...(isNoDup && options.triggerEventScopeKey
          ? { triggerEventScopeKey: options.triggerEventScopeKey }
          : {}),
        ...(isPerActivation && options.triggerActivationKey
          ? { triggerActivationKey: options.triggerActivationKey }
          : {}),
      }),
    };
  }
  return current;
}

/**
 * 1 件分の使用回数を払い戻す。P3-62: 「発揮できません」となった効果は usageLimit
 * を消費しないという公式裁定 (page14 一般則 / Q5「○○することで△△する」) に基づき、
 * recordEffectUsage で記録した 1 回ぶんを取り消す。
 *
 * - 同 (sourceInstanceId, effectLabel, duration, turnNumber, step) を持つ最新レコードを探す。
 * - count > 1 → count を 1 減らす。
 * - count === 1 → レコードごと除去。
 * - マッチするレコードが無ければ no-op (idempotent)。
 */
export function refundEffectUsage(options: {
  state: GameState;
  sourceInstanceId: string;
  effectLabel: string;
  duration: EffectUsageLimitDuration;
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y。
   * 指定時は relatedInstanceId 一致のレコードのみ refund 対象。
   * 未指定なら関連性で絞らず最新一致レコードを refund (既存挙動)。
   */
  relatedInstanceId?: string;
  /** no_duplicate の per-event scope。指定時は同じ scope の record のみ refund。 */
  triggerEventScopeKey?: string;
}): EffectUsageRecord[] {
  const {
    state,
    sourceInstanceId,
    effectLabel,
    duration,
    groupId,
    relatedInstanceId,
    triggerEventScopeKey,
  } = options;
  // per_trigger_activation の refund key 拡張は意図的に未配線:
  // RecordedEffectUsageEntry / composeRecordedUsage が triggerActivationKey を
  // 持たないため call site から渡せず dead code になる。BSDB01-CX01 effects[1] は
  // conditional_cost を持たず P3-62 rollback 経路を踏まないため即時 bug は無い。
  // per_trigger_activation + conditional_cost を併用する将来カード追加時に、
  // RecordedEffectUsageEntry → refundAllRecordedUsage 全経路で対称配線する。
  // 正源: verifier 2026-06-28 round 2 lens 6 (engine-claude lane)。
  const target = [...state.effectUsageRecords]
    .reverse()
    .find(
      (r) =>
        r.sourceInstanceId === sourceInstanceId &&
        (groupId ? r.groupId === groupId : r.effectLabel === effectLabel) &&
        r.duration === duration &&
        r.turnNumber === state.turnNumber &&
        r.step === state.step &&
        (relatedInstanceId === undefined ||
          r.relatedInstanceId === relatedInstanceId) &&
        (triggerEventScopeKey === undefined ||
          r.triggerEventScopeKey === triggerEventScopeKey)
    );
  if (!target) return state.effectUsageRecords;
  const targetIndex = state.effectUsageRecords.indexOf(target);
  if (target.count > 1) {
    return state.effectUsageRecords.map((r, i) =>
      i === targetIndex ? { ...r, count: r.count - 1 } : r
    );
  }
  return state.effectUsageRecords.filter((_, i) => i !== targetIndex);
}

/**
 * usageLimit が設定されている場合のみ使用を払い戻し、更新済み state を返す。
 * usageLimit が undefined なら state をそのまま返す。
 * 配列の場合はすべての制限について払い戻す (recordEffectUsageIfLimited と対称)。
 *
 * P3-62: condition unmet や conditional_cost rollback で発揮不能となった場合に
 * 呼び出し、宣言時に記録した usageLimit を取り消す。
 */
export function refundEffectUsageIfRecorded(options: {
  state: GameState;
  sourceInstanceId: string;
  effectLabel: string;
  usageLimit: EffectUsageLimit | EffectUsageLimit[] | undefined;
  groupId?: string;
  /**
   * `per_trigger_related_instance` 用: 観測トリガー主語 Y。指定時は対応レコードのみ refund。
   */
  relatedInstanceId?: string;
  /** no_duplicate の per-event scope。指定時は対応レコードのみ refund。 */
  triggerEventScopeKey?: string;
}): GameState {
  if (!options.usageLimit) return options.state;
  const limits = Array.isArray(options.usageLimit)
    ? options.usageLimit
    : [options.usageLimit];
  let current = options.state;
  for (const limit of limits) {
    const isPerY = limit.kind === "per_trigger_related_instance";
    const isNoDup = limit.kind === "no_duplicate";
    current = {
      ...current,
      effectUsageRecords: refundEffectUsage({
        state: current,
        sourceInstanceId: options.sourceInstanceId,
        effectLabel: options.effectLabel,
        duration: getUsageLimitDuration(limit),
        ...(options.groupId ? { groupId: options.groupId } : {}),
        ...(isPerY && options.relatedInstanceId
          ? { relatedInstanceId: options.relatedInstanceId }
          : {}),
        ...(isNoDup && options.triggerEventScopeKey
          ? { triggerEventScopeKey: options.triggerEventScopeKey }
          : {}),
      }),
    };
  }
  return current;
}

/**
 * 期限切れの使用回数レコードをクリアする。
 * - turn duration: 現在ターンより前のレコードを除去。
 * - game duration: 除去しない (ゲーム終了まで保持)。
 * - step duration: ステップ遷移時に前ステップのレコードを除去。
 *
 * 呼び出しタイミング: ターン終了時やステップ遷移時。
 */
export function clearExpiredEffectUsageRecords(
  state: GameState
): EffectUsageRecord[] {
  return state.effectUsageRecords.filter((record) =>
    isRecordInDurationScope(record, state, record.duration)
  );
}

/**
 * 再評価ポイントの失敗方針を取得する。省略時は "skip_step"。
 */
export function getReevaluationFailurePolicy(
  point: EffectReevaluationPoint
): EffectReevaluationFailurePolicy {
  return point.failurePolicy ?? "skip_step";
}

/**
 * 登録から、指定タイミングに該当する再評価ポイントを抽出する。
 */
export function getReevaluationPointsForTiming(
  registration: { reevaluationPoints?: readonly EffectReevaluationPoint[] },
  timing: EffectReevaluationTiming
): readonly EffectReevaluationPoint[] {
  if (!registration.reevaluationPoints) return [];
  return registration.reevaluationPoints.filter((p) => p.timing === timing);
}

/**
 * `suppress_effect` の `effectFilter` を、いま発揮されようとしている効果の
 * 記述子と突き合わせる。指定された各サブ条件をすべて満たすときのみ true。
 *
 * descriptor が無い (効果を特定できない) 場合は false を返す。呼び出し側は
 * 「filter 付き CE は descriptor 無しではマッチしない」扱いにする。
 */
export function matchesEffectTargetFilter(
  filter: EffectTargetFilter,
  descriptor: SuppressionEffectDescriptor | undefined
): boolean {
  if (!descriptor) return false;
  if (filter.filterOr !== undefined && filter.filterOr.length > 0) {
    return filter.filterOr.some((branch) =>
      matchesEffectTargetFilter(branch, descriptor)
    );
  }

  if (
    filter.sourceDefinitionId !== undefined &&
    filter.sourceDefinitionId !== descriptor.sourceDefinitionId
  ) {
    return false;
  }
  if (filter.sourceKinds !== undefined && filter.sourceKinds.length > 0) {
    if (
      descriptor.sourceKind === undefined ||
      !filter.sourceKinds.includes(descriptor.sourceKind)
    ) {
      return false;
    }
  }
  if (filter.effectIndex !== undefined) {
    const allowedEffectIndexes = Array.isArray(filter.effectIndex)
      ? filter.effectIndex
      : [filter.effectIndex];
    if (
      descriptor.effectIndex === undefined ||
      !allowedEffectIndexes.includes(descriptor.effectIndex)
    ) {
      return false;
    }
  }
  if (filter.effectLabels !== undefined && filter.effectLabels.length > 0) {
    const have = new Set(descriptor.effectLabels ?? []);
    if (!filter.effectLabels.some((label) => have.has(label))) {
      return false;
    }
  }
  if (filter.heading !== undefined && filter.heading !== descriptor.heading) {
    return false;
  }
  if (
    filter.triggerPhrase !== undefined &&
    !(descriptor.triggerPhrases ?? []).includes(filter.triggerPhrase)
  ) {
    return false;
  }
  if (filter.timingKind !== undefined) {
    const allowed = Array.isArray(filter.timingKind)
      ? filter.timingKind
      : [filter.timingKind];
    if (
      descriptor.timingKind === undefined ||
      !allowed.includes(descriptor.timingKind)
    ) {
      return false;
    }
  }
  if (filter.eventAction !== undefined) {
    const allowed = Array.isArray(filter.eventAction)
      ? filter.eventAction
      : [filter.eventAction];
    const actual =
      descriptor.eventAction === undefined
        ? []
        : Array.isArray(descriptor.eventAction)
          ? descriptor.eventAction
          : [descriptor.eventAction];
    if (!actual.some((eventAction) => allowed.includes(eventAction))) {
      return false;
    }
  }
  if (filter.activatedMode !== undefined && filter.activatedMode.length > 0) {
    if (
      descriptor.activatedMode === undefined ||
      !filter.activatedMode.includes(
        descriptor.activatedMode as "main" | "flash" | "stack"
      )
    ) {
      return false;
    }
  }
  if (filter.keywords !== undefined && filter.keywords.length > 0) {
    const have = new Set(descriptor.keywords ?? []);
    if (!filter.keywords.every((k) => have.has(k))) {
      return false;
    }
  }
  if (
    filter.containsActionKinds !== undefined &&
    filter.containsActionKinds.length > 0
  ) {
    const have = new Set(descriptor.containsActionKinds ?? []);
    if (!filter.containsActionKinds.some((k) => have.has(k))) {
      return false;
    }
  }
  return true;
}

function isUnsuppressibleAlwaysOnEffect(
  descriptor: SuppressionEffectDescriptor | undefined
): boolean {
  // 10_rules/03b Ver.17.0: 発揮場所・発揮条件のない常時効果は
  // 「効果を発揮できない」では無効化できない。blanket suppress_effect でも同じ例外を通す。
  return (
    descriptor?.timingKind === "continuous" &&
    descriptor.activationCondition == null &&
    descriptor.activationLocation == null
  );
}

/**
 * 再評価チェック 1 件を実行する。
 * 戻り値: true = チェック通過 (効果は続行可), false = チェック失敗 (再評価により中断/スキップ)。
 */
export function executeReevaluationCheck(options: {
  state: GameState;
  checkKind: EffectReevaluationCheckKind;
  sourceInstanceId: string;
  targetInstanceIds: readonly string[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** effect_suppression 判定で、いま発揮されようとしている効果の記述子。 */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  /**
   * 動的フィルタ suppress（targetInstanceId 未設定・metadata.suppressTargetFilter あり）の
   * 評価に使う def 逆引き。未指定なら動的フィルタ CE は評価されない（特定 instance 指定の
   * suppress のみ判定＝後方互換）。
   */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}): boolean {
  const { state, checkKind, targetInstanceIds } = options;

  switch (checkKind) {
    case "target_validity": {
      // 全対象がまだ盤面 (field) に存在するか
      return targetInstanceIds.every((id) =>
        state.cardInstances.some(
          (ci) => ci.instanceId === id && ci.zone === "field"
        )
      );
    }
    case "effect_suppression": {
      // 「発揮させない」(effect_suppression) の判定。
      // activeContinuousEffects に effect_suppression タグでソースカードを
      // 対象にした CE があれば、そのカードの効果は発揮されない。
      // - metadata.effectFilter 無し (blanket): カードの全効果を抑止。
      //   (「(対象)の効果をすべて発揮させない」/「その効果を発揮させない」)
      //   ただし 10_rules/03b Ver.17.0 により、発揮場所・発揮条件のない
      //   常時効果は「効果を発揮できない」で無効化できないため抑止対象外。
      // - metadata.effectFilter 有り: いま発揮されようとしている効果が
      //   フィルタに一致するときのみ抑止する。
      const sourceCard = state.cardInstances.find(
        (ci) => ci.instanceId === options.sourceInstanceId
      );
      const getSuppressionCeMetadataPreventionLevel = (
        ce: ContinuousEffect
      ): EffectPreventionLevel => {
        return ce.metadata?.preventionLevel === "unpreventable" ||
          ce.metadata?.preventionLevel === "immune" ||
          ce.metadata?.preventionLevel === "suppress"
          ? ce.metadata.preventionLevel
          : "none";
      };
      const getSuppressionCeDefenseLevel = (
        ce: ContinuousEffect
      ): EffectPreventionLevel => {
        const metadataLevel = getSuppressionCeMetadataPreventionLevel(ce);
        return metadataLevel === "none" ? "suppress" : metadataLevel;
      };
      const sourceCanBypassSuppressionCe = (ce: ContinuousEffect): boolean => {
        const sourcePreventionLevel = options.sourcePreventionLevel ?? "none";
        const suppressionDefenseLevel = getSuppressionCeDefenseLevel(ce);
        if (
          sourcePreventionLevel !== "none" &&
          canEffectPenetrateDefense(
            sourcePreventionLevel,
            suppressionDefenseLevel
          )
        ) {
          return true;
        }
        const suppressionMetadataPreventionLevel =
          getSuppressionCeMetadataPreventionLevel(ce);
        const sourcePreventionBypass =
          options.getCardDefinitionById && sourceCard
            ? mergeTargetLockBypassProfiles(
                options.sourcePreventionBypass,
                getEffectClassSourcePreventionBypass(
                  state,
                  undefined,
                  sourceCard.instanceId,
                  sourceCard.controllerPlayerId,
                  options.getCardDefinitionById,
                  "prevention",
                  options.suppressionEffectDescriptor
                )
              )
            : options.sourcePreventionBypass;
        if (!options.getCardDefinitionById || !sourcePreventionBypass) {
          return false;
        }
        if (suppressionMetadataPreventionLevel !== "none") {
          return false;
        }
        return canSourceBypassResistanceCE(
          state,
          ce,
          options.getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        );
      };
      const suppressionCeCanAffectSource = (
        ce: ContinuousEffect,
        card: CardInstance
      ): boolean => {
        const suppressSourceCard = getCardById(state, ce.sourceInstanceId);
        const suppressSourceDef = options.getCardDefinitionById?.(
          ce.sourceDefinitionId
        );
        const suppressionPreventionLevel = getSuppressionCeDefenseLevel(ce);
        const immunityDecision = resolveCardImmunityAffect(
          state,
          card,
          ce.actingPlayerId,
          suppressionPreventionLevel,
          {
            instance: suppressSourceCard,
            definition: suppressSourceDef,
          },
          options.getCardDefinitionById
        );
        return immunityDecision.kind !== "blocked";
      };
      const suppressionCeTargetAffectGateMatches = (
        ce: ContinuousEffect,
        card: CardInstance
      ): boolean => {
        if (ce.metadata?.targetAffectGate !== "blocked_by_source_immunity") {
          return true;
        }
        const suppressSourceCard = getCardById(state, ce.sourceInstanceId);
        const suppressSourceDef = options.getCardDefinitionById?.(
          ce.sourceDefinitionId
        );
        return (
          resolveCardImmunityAffect(
            state,
            card,
            ce.actingPlayerId,
            "none",
            {
              instance: suppressSourceCard,
              definition: suppressSourceDef,
            },
            options.getCardDefinitionById
          ).kind === "blocked"
        );
      };
      const ceSuppressesSource = (
        ce: ContinuousEffect,
        card?: CardInstance
      ): boolean => {
        if (ce.modifierTag !== "effect_suppression") return false;
        if (sourceCanBypassSuppressionCe(ce)) return false;
        if (isUnsuppressibleAlwaysOnEffect(options.suppressionEffectDescriptor))
          return false;
        if (card && !suppressionCeTargetAffectGateMatches(ce, card))
          return false;
        if (card && !suppressionCeCanAffectSource(ce, card)) return false;
        const effectFilter = ce.metadata?.effectFilter as
          | EffectTargetFilter
          | undefined;
        if (!effectFilter) return true; // blanket: 03b Ver.17.0 例外を除く全効果抑止
        return matchesEffectTargetFilter(
          effectFilter,
          options.suppressionEffectDescriptor
        );
      };

      // (1) 特定 instance 指定の suppress CE。BSLH01-X08 等のフィールド対象 suppress は
      //     ターゲットがフィールド離脱したら自動失効する（CE 本体は残るが消費しない）。
      //     動的フィルタ経路 (2) の zone guard と対称。
      let suppressed =
        sourceCard?.zone === "field" &&
        getCEsForTarget(state, options.sourceInstanceId).some((ce) =>
          ceSuppressesSource(ce, sourceCard)
        );

      // (2) 動的フィルタ suppress CE（targetInstanceId 未設定）。登録後に場へ出た
      //     カードも消費時に matchesCardFilter（SSOT）で動的判定する
      //     （「相手のフィールドの<フィルタ>カードの効果は発揮されない」型、金龍ほか）。
      if (!suppressed && options.getCardDefinitionById) {
        const getCardDefinitionById = options.getCardDefinitionById;
        if (sourceCard) {
          const sourceDef = getCardDefinitionById(sourceCard.definitionId);
          if (sourceDef) {
            suppressed = getGlobalCEs(state).some(
              (ce) =>
                matchesDynamicEffectSuppressionTarget({
                  state,
                  ce,
                  sourceCard,
                  sourceDefinition: sourceDef,
                  getCardDefinitionById,
                }) && ceSuppressesSource(ce, sourceCard)
            );
          }
        }
      }

      return !suppressed;
    }
    case "prevention_clash": {
      // 各ターゲットに対し、防止レベル衝突判定を行う。
      // ターゲット側に defense_immune / defense_suppress の常在効果がある場合、
      // 最も強い防御レベルを選び、ソース効果の preventionLevel で貫通できるか判定する。
      const attackerLevel = options.sourcePreventionLevel ?? "none";
      return targetInstanceIds.every((targetId) => {
        const defenseEffects = getCEsForTarget(state, targetId).filter(
          (ce) =>
            ce.modifierTag === "defense_immune" ||
            ce.modifierTag === "defense_suppress"
        );
        if (defenseEffects.length === 0) return true;
        // 全防御効果のうち最強のレベルを選ぶ
        let strongestLevel: EffectPreventionLevel = "none";
        for (const de of defenseEffects) {
          const level: EffectPreventionLevel =
            de.modifierTag === "defense_immune" ? "immune" : "suppress";
          if (comparePreventionLevel(level, strongestLevel) > 0) {
            strongestLevel = level;
          }
        }
        return canEffectPenetrateDefense(attackerLevel, strongestLevel);
      });
    }
    default:
      return true;
  }
}

/**
 * targetInstanceId を持たない dynamic `effect_suppression` CE が、指定 source を
 * 対象に取るかを判定する。発揮可否の消費側と battle/step scope 失効後の
 * continuous-effect 復元側で同じ CardFilter/effective 値の SSOT を共有する。
 */
function matchesDynamicEffectSuppressionTarget(options: {
  state: GameState;
  ce: ContinuousEffect;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const { state, ce, sourceCard, sourceDefinition, getCardDefinitionById } =
    options;
  if (ce.modifierTag !== "effect_suppression") return false;
  const filter = ce.metadata?.suppressTargetFilter as CardFilter | undefined;
  if (!filter) return false;
  const filterPlayer = ce.metadata?.suppressTargetPlayer as
    | "self"
    | "opponent"
    | "any"
    | undefined;
  const filterPlayerId =
    filterPlayer === "self"
      ? ce.actingPlayerId
      : filterPlayer === "opponent"
        ? state.players.find((p) => p.id !== ce.actingPlayerId)?.id
        : undefined;
  const sourceZonePlayerId =
    sourceCard.zone === "field"
      ? sourceCard.controllerPlayerId
      : sourceCard.ownerPlayerId;
  if (filterPlayerId !== undefined && sourceZonePlayerId !== filterPlayerId) {
    return false;
  }
  // 対象ゾーン（省略時は従来どおり "field" 限定。「相手のミラージュの効果は
  // 発揮されない」型は登録時に suppressTargetZone:["mirage"] 等を持つ）。
  const suppressZones = (ce.metadata?.suppressTargetZone as
    | readonly Zone[]
    | undefined) ?? ["field"];
  if (!suppressZones.includes(sourceCard.zone)) return false;
  return matchesCardFilter(sourceCard, sourceDefinition, filter, {
    state,
    ...getCombinedUnitCostFilterOptions(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById
    ),
    ...(sourceCard.zone === "field"
      ? { fieldCategoryContext: true, getCardDefinitionById }
      : {
          effectiveCategory: getEffectiveCategory(
            state,
            sourceCard,
            sourceDefinition
          ),
        }),
    effectiveColors: getEffectiveColors(state, sourceCard, sourceDefinition),
    effectiveBp:
      sourceCard.zone === "field"
        ? getCombinedUnitBp(
            state,
            sourceCard,
            sourceDefinition,
            getCardDefinitionById
          )
        : undefined,
    effectiveLevel:
      sourceCard.zone === "field"
        ? getEffectiveLevel(
            state,
            sourceCard,
            sourceDefinition,
            getCardDefinitionById
          )
        : undefined,
    coreCount:
      sourceCard.zone === "field"
        ? getTotalCoresOnCardById(state, sourceCard.instanceId)
        : undefined,
    effectiveSymbolCount:
      sourceCard.zone === "field"
        ? getCombinedUnitSymbolCount(
            state,
            sourceCard,
            sourceDefinition,
            getCardDefinitionById
          )
        : undefined,
    soulStateIds: getEffectiveSoulStateIds(state, getCardDefinitionById),
    underCardIds: collectUnderCardScopeIds(state),
  });
}

/**
 * battle/attack scope の dynamic effect_suppression が失効したとき、抑止中に
 * 除去された可能性がある source を収集する。effectFilter は各 continuous effect の
 * 再登録時に SSOT の effect_suppression 判定で評価されるため、ここでは対象カードの
 * CardFilter/プレイヤー/ゾーンだけを確定する。
 */
export function getDynamicEffectSuppressionTargetIds(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Set<string> {
  const sourceInstanceIds = new Set<string>();
  for (const sourceCard of state.cardInstances) {
    const sourceDefinition = getCardDefinitionById(sourceCard.definitionId);
    if (
      sourceDefinition &&
      matchesDynamicEffectSuppressionTarget({
        state,
        ce,
        sourceCard,
        sourceDefinition,
        getCardDefinitionById,
      })
    ) {
      sourceInstanceIds.add(sourceCard.instanceId);
    }
  }
  return sourceInstanceIds;
}

/**
 * 指定タイミングの全再評価ポイントを実行し、結果を返す。
 *
 * 戻り値:
 * - passed: true なら全チェック通過。
 * - failurePolicy: 失敗時の処理方針 (passed=true なら undefined)。
 * - failedChecks: 失敗したチェックの種類 (passed=true なら空)。
 */
export function runReevaluationAtTiming(options: {
  state: GameState;
  registration: {
    reevaluationPoints?: readonly EffectReevaluationPoint[];
    preventionLevel?: EffectPreventionLevel;
  };
  timing: EffectReevaluationTiming;
  sourceInstanceId: string;
  targetInstanceIds: readonly string[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
  /** 動的フィルタ suppress 評価用の def 逆引き（effect_suppression 判定で使用）。 */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
}): {
  passed: boolean;
  failurePolicy?: EffectReevaluationFailurePolicy;
  failedChecks: EffectReevaluationCheckKind[];
} {
  const points = getReevaluationPointsForTiming(
    options.registration,
    options.timing
  );
  const failedChecks: EffectReevaluationCheckKind[] = [];

  for (const point of points) {
    for (const checkKind of point.checks) {
      const passed = executeReevaluationCheck({
        state: options.state,
        checkKind,
        sourceInstanceId: options.sourceInstanceId,
        targetInstanceIds: options.targetInstanceIds,
        sourcePreventionLevel:
          options.sourcePreventionLevel ??
          options.registration.preventionLevel ??
          "none",
        ...(options.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: options.sourcePreventionBypass }
          : {}),
        ...(options.suppressionEffectDescriptor
          ? {
              suppressionEffectDescriptor: options.suppressionEffectDescriptor,
            }
          : {}),
        ...(options.getCardDefinitionById
          ? { getCardDefinitionById: options.getCardDefinitionById }
          : {}),
      });
      if (!passed) {
        failedChecks.push(checkKind);
        return {
          passed: false,
          failurePolicy: getReevaluationFailurePolicy(point),
          failedChecks,
        };
      }
    }
  }

  return { passed: true, failedChecks: [] };
}

/**
 * 効果解決パイプラインに渡す再評価設定。
 */
export interface ReevaluationConfig {
  registration: {
    reevaluationPoints?: readonly EffectReevaluationPoint[];
    preventionLevel?: EffectPreventionLevel;
  };
  sourceInstanceId: string;
  targetInstanceIds: readonly string[];
  /**
   * いま発揮されようとしている効果の記述子。effect_suppression 判定で
   * `suppress_effect` の `effectFilter` と突き合わせる。effectFilter 付き
   * (filtered) の抑止 CE は、この記述子が無いと一致せず抑止されない。
   */
  suppressionEffectDescriptor?: SuppressionEffectDescriptor;
}

/**
 * 効果登録から ReevaluationConfig を構築する。
 * reevaluationPoints が無ければ undefined を返す (再評価不要)。
 */
export function buildReevaluationConfig(
  registration:
    | {
        reevaluationPoints?: readonly EffectReevaluationPoint[];
        preventionLevel?: EffectPreventionLevel;
        suppressionEffectDescriptor?: SuppressionEffectDescriptor;
      }
    | undefined,
  sourceInstanceId: string,
  targetInstanceIds: readonly string[]
): ReevaluationConfig | undefined {
  if (!registration?.reevaluationPoints?.length) return undefined;
  return {
    registration: {
      reevaluationPoints: registration.reevaluationPoints,
      ...(registration.preventionLevel !== undefined
        ? { preventionLevel: registration.preventionLevel }
        : {}),
    },
    sourceInstanceId,
    targetInstanceIds,
    // 効果登録 (registration) が登録時に効果から導出した記述子を config へ伝搬。
    // これにより filtered な suppress_effect が解決時に該当効果のみ抑止できる。
    ...(registration.suppressionEffectDescriptor !== undefined
      ? {
          suppressionEffectDescriptor: registration.suppressionEffectDescriptor,
        }
      : {}),
  };
}

// ════════════════════════════════════════════════════════════════
// override_properties CE 消費
// ══════════════════════════════════════════════════════��═════════

export interface OverriddenProperties {
  treatAsCategory?: CardCategory;
  cardName?: string;
  combined?: boolean;
  cost?: number;
  symbols?: SymbolColor[];
  /** copy_from解決済みsnapshot。各配列が物理シンボル1個の色を保持する。 */
  symbolColorEntries?: SymbolColor[][] | undefined;
  symbolCountFixed?: boolean;
  tribes?: string[];
  /**
   * 加算的に付与される系統。すべての該当 CE から集約した結合済みリスト（重複除去後）。
   * `tribes`（overwrite）とは独立に作用し、`getEffectiveTribes` で
   * 「定義系統 ∪ addTribes」または「override tribes ∪ addTribes」として合成される。
   */
  addTribes?: string[];
  bp?: { lv1: number; lv2?: number; lv3?: number };
  levelCost?: { lv1?: number; lv2?: number; lv3?: number };
  /**
   * Lv コスト（レベル維持コスト）への加算修飾の合計。複数 CE 分を合算した値。
   * `levelCost`（上書き）とは独立に作用し、上書き後（または定義）の各レベル閾値に
   * 一律加算される（`getEffectiveLevel` で適用）。
   */
  levelCostDelta?: number;
  /**
   * 実効 Lv の直接上書き。`"max"` = 対象カード自身の最高 Lv 扱い。`{delta}` = コア数基準の
   * 通常算出値への加算（`getEffectiveLevel` の SSOT、DSL 側は dsl-types.ts の
   * OverridePropertiesAction.properties.level を参照）。
   */
  level?: "max" | { delta: number };
}

interface GlobalOverridePropertiesEvaluationOptions {
  readonly excludedGlobalEffectIds?: ReadonlySet<string>;
}

export interface EffectivePropertyEvaluationOptions {
  readonly includeGlobalOverrideProperties?: boolean | undefined;
}

function getDefinitionTribeParts(def: CardDefinition | undefined): string[] {
  const tribe = def?.tribe as unknown;
  if (Array.isArray(tribe)) {
    return tribe.filter((part): part is string => typeof part === "string");
  }
  return typeof tribe === "string" && tribe.length > 0 ? tribe.split("・") : [];
}

/**
 * 対象カードに適用中の override_properties CE から上書きプロパティを収集する。
 * 複数の CE が同プロパティを上書きする場合、後勝ち（配列末尾優先）。
 * "copy_self" 値はソースカード定義で解決する。
 */
export function getOverriddenProperties(
  state: GameState,
  targetInstanceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  includeGlobalOverrideProperties = true
): OverriddenProperties | null {
  const ces = getCEsForTarget(state, targetInstanceId);
  let result: OverriddenProperties | null = null;

  for (const ce of ces) {
    if (ce.modifierTag !== "override_properties" || !ce.metadata) continue;
    const props = ce.metadata.properties as Record<string, unknown> | undefined;
    if (!props) continue;

    if (!result) result = {};

    const sourceDef = getCardDefinitionById?.(ce.sourceDefinitionId);

    if (props.treatAsCategory !== undefined) {
      result.treatAsCategory = props.treatAsCategory as CardCategory;
    }
    if (props.cardName !== undefined) {
      const resolved =
        props.cardName === "copy_self"
          ? sourceDef?.name
          : (props.cardName as string);
      if (resolved !== undefined) result.cardName = resolved;
    }
    if (props.combined === true) {
      result.combined = true;
    }
    if (props.cost !== undefined) {
      const resolved =
        props.cost === "copy_self" ? sourceDef?.cost : (props.cost as number);
      if (resolved !== undefined) result.cost = resolved;
    }
    if (props.symbols !== undefined) {
      const resolved =
        props.symbols === "copy_self"
          ? sourceDef
            ? [...sourceDef.symbolColors]
            : undefined
          : (props.symbols as SymbolColor[]);
      if (resolved !== undefined) {
        result.symbols = resolved;
        result.symbolColorEntries =
          props.symbols === "copy_self" && sourceDef
            ? getPrintedSymbolEntries(sourceDef)
            : (props.symbolColorEntries as SymbolColor[][] | undefined);
      }
    }
    if (props.symbolCountFixed === true) {
      result.symbolCountFixed = true;
    }
    if (props.tribes !== undefined) {
      const sourceTribes = getDefinitionTribeParts(sourceDef);
      const resolved =
        props.tribes === "copy_self"
          ? sourceTribes.length > 0
            ? sourceTribes
            : undefined
          : (props.tribes as string[]);
      if (resolved !== undefined) result.tribes = resolved;
    }
    if (Array.isArray(props.addTribes) && props.addTribes.length > 0) {
      const accum = result.addTribes ?? [];
      for (const t of props.addTribes as string[]) {
        if (!accum.includes(t)) accum.push(t);
      }
      result.addTribes = accum;
    }
    if (props.bp !== undefined) {
      if (props.bp === "copy_self" && sourceDef) {
        const lv1 = sourceDef.levelDefs[0]?.bp ?? 0;
        const lv2 = sourceDef.levelDefs[1]?.bp;
        const lv3 = sourceDef.levelDefs[2]?.bp;
        result.bp = {
          lv1,
          ...(lv2 !== undefined ? { lv2 } : {}),
          ...(lv3 !== undefined ? { lv3 } : {}),
        };
      } else if (props.bp !== "copy_self") {
        result.bp = props.bp as { lv1: number; lv2?: number; lv3?: number };
      }
    }
    if (props.levelCost !== undefined) {
      result.levelCost = props.levelCost as {
        lv1?: number;
        lv2?: number;
        lv3?: number;
      };
    }
    if (typeof props.levelCostDelta === "number") {
      // 加算修飾は複数 CE 分を合算する（後勝ちではない）
      result.levelCostDelta =
        (result.levelCostDelta ?? 0) + (props.levelCostDelta as number);
    }
    if (props.level === "max") {
      result.level = "max";
    } else if (
      typeof props.level === "object" &&
      props.level !== null &&
      typeof (props.level as { delta?: unknown }).delta === "number"
    ) {
      result.level = { delta: (props.level as { delta: number }).delta };
    }
  }

  if (includeGlobalOverrideProperties && getCardDefinitionById) {
    const targetCard = getCardById(state, targetInstanceId);
    const targetDef = targetCard
      ? getCardDefinitionById(targetCard.definitionId)
      : undefined;
    if (targetCard && targetDef) {
      const baseParts = getDefinitionTribeParts(targetDef);
      for (const ce of getGlobalCEs(state)) {
        if (ce.modifierTag !== "override_properties") continue;
        if (!ce.targetFilter) continue;
        const props = ce.metadata?.properties as
          | Record<string, unknown>
          | undefined;
        if (!props || props.symbols === undefined) continue;
        if (
          !matchesOverridePropertiesGlobalCE(
            ce,
            targetCard,
            targetDef,
            state,
            baseParts,
            getCardDefinitionById
          )
        ) {
          continue;
        }
        if (
          !globalOverridePropertiesCanAffectCard(
            state,
            ce,
            targetCard,
            getCardDefinitionById,
            "symbols"
          )
        ) {
          continue;
        }
        if (!result) result = {};
        const sourceDef = getCardDefinitionById(ce.sourceDefinitionId);
        const resolved =
          props.symbols === "copy_self"
            ? sourceDef
              ? [...sourceDef.symbolColors]
              : undefined
            : (props.symbols as SymbolColor[]);
        if (resolved !== undefined) {
          result.symbols = resolved;
          result.symbolColorEntries =
            props.symbols === "copy_self" && sourceDef
              ? getPrintedSymbolEntries(sourceDef)
              : (props.symbolColorEntries as SymbolColor[][] | undefined);
        }
        if (props.symbolCountFixed === true) {
          result.symbolCountFixed = true;
        }
      }
    }
  }

  return result;
}

export function getEffectiveCardName(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): string {
  // engine-deck-derived-clone-spirit: act_as_spirit トークンのカード名固定上書き
  // (「アレイオン」「スティギス」等) を最優先で採用する。
  const actAsSpiritName = card.faceDown
    ? resolveActAsSpiritCardName(state, card.instanceId)
    : undefined;
  if (actAsSpiritName !== undefined) return actAsSpiritName;
  return (
    getOverriddenProperties(
      state,
      card.instanceId,
      getCardDefinitionById,
      options.includeGlobalOverrideProperties
    )?.cardName ?? def.name
  );
}

export function getEffectiveCost(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  return getEffectiveCostWithOptions(state, card, def, getCardDefinitionById);
}

function getEffectiveCostWithOptions(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: { includeGlobalOverrideProperties?: boolean | undefined } = {}
): number {
  // engine-deck-derived-clone-spirit: act_as_spirit トークンのコスト固定上書きを優先。
  if (card.faceDown && getCardDefinitionById) {
    const actAsSpiritCost = resolveActAsSpiritCost(
      state,
      card,
      getCardDefinitionById
    );
    if (actAsSpiritCost !== undefined) return actAsSpiritCost;
  }
  return (
    getOverriddenProperties(
      state,
      card.instanceId,
      getCardDefinitionById,
      options.includeGlobalOverrideProperties
    )?.cost ?? def.cost
  );
}

export function getCombinedUnitCost(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const ownCost = getEffectiveCost(state, card, def, getCardDefinitionById);
  const childCost = getCombinedUnitBraveChildren(
    state,
    card,
    getCardDefinitionById
  ).reduce((sum, child) => {
    const childDef = getCardDefinitionById?.(child.definitionId);
    if (!childDef) {
      return sum;
    }
    return (
      sum + getEffectiveCost(state, child, childDef, getCardDefinitionById)
    );
  }, 0);
  return (
    ownCost +
    childCost +
    getVirtualCombinedBraveCostTotal(state, card.instanceId)
  );
}

export function getCombinedUnitCostFilterCandidates(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: { includeGlobalOverrideProperties?: boolean | undefined } = {}
): number[] {
  const ownEffectiveCost = getEffectiveCostWithOptions(
    state,
    card,
    def,
    getCardDefinitionById,
    options
  );
  let combinedMemberTotals = [ownEffectiveCost];
  for (const child of getCombinedUnitBraveChildren(
    state,
    card,
    getCardDefinitionById
  )) {
    const childDef = getCardDefinitionById?.(child.definitionId);
    if (!childDef) continue;
    const childCandidates = [
      getEffectiveCostWithOptions(
        state,
        child,
        childDef,
        getCardDefinitionById,
        options
      ),
      ...getAdditionalCosts(state, child.instanceId),
    ];
    combinedMemberTotals = combinedMemberTotals.flatMap((total) =>
      childCandidates.map((childCost) => total + childCost)
    );
  }
  const virtualCost = getVirtualCombinedBraveCostTotal(state, card.instanceId);
  if (virtualCost > 0) {
    combinedMemberTotals = combinedMemberTotals.map(
      (total) => total + virtualCost
    );
  }
  // BS13 Q&A: 合体ユニットに「コストはXとしても扱う」が付いた場合、
  // 合体コスト+X ではなく「合体ユニットの本来コスト」と「X」の代替候補になる。
  return [
    ...new Set([
      ...combinedMemberTotals,
      ...getAdditionalCosts(state, card.instanceId),
    ]),
  ];
}

export function getCombinedUnitCostFilterOptions(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: { includeGlobalOverrideProperties?: boolean | undefined } = {}
): { effectiveCost: number; additionalCosts: number[] } {
  const [effectiveCost = def.cost, ...additionalCosts] =
    getCombinedUnitCostFilterCandidates(
      state,
      card,
      def,
      getCardDefinitionById,
      options
    );
  return { effectiveCost, additionalCosts };
}

export function getEffectiveOrAdditionalCost(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const effectiveCost = getEffectiveCost(
    state,
    card,
    def,
    getCardDefinitionById
  );
  const additionalCosts = getAdditionalCosts(state, card.instanceId);
  return additionalCosts.length > 0
    ? Math.max(effectiveCost, ...additionalCosts)
    : effectiveCost;
}

export function getCombinedUnitEffectiveOrAdditionalCost(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const ownCost = getEffectiveOrAdditionalCost(
    state,
    card,
    def,
    getCardDefinitionById
  );
  const childCost = getCombinedUnitBraveChildren(
    state,
    card,
    getCardDefinitionById
  ).reduce((sum, child) => {
    const childDef = getCardDefinitionById?.(child.definitionId);
    if (!childDef) {
      return sum;
    }
    return (
      sum +
      getEffectiveOrAdditionalCost(
        state,
        child,
        childDef,
        getCardDefinitionById
      )
    );
  }, 0);
  return (
    ownCost +
    childCost +
    getVirtualCombinedBraveCostTotal(state, card.instanceId)
  );
}

/**
 * 「鍵ブレイヴ」等 brave_limit_exempt 系キーワードの合体数カウント除外判定。
 * legal-actions-availability.ts の brave_combine 系合法手生成と
 * ENGINE-bsft01-tr-rebirth-brave-combine-branch (効果ステップ内合体) の両方から使う SSOT。
 */
function isBraveLimitExemptForHost(options: {
  state: GameState;
  def: CardDefinition | undefined;
  host: CardInstance;
  hostDef: CardDefinition | undefined;
  effectiveHostName: string | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  excludeBraveInstanceId?: string | undefined;
}): boolean {
  const { def, host, hostDef, effectiveHostName } = options;
  if (def?.printedCategory !== "brave") return false;
  if (
    (def.keywordTags ?? []).includes("brave_limit_exempt_lucy") &&
    (effectiveHostName?.includes("ルーシィ") ?? false)
  ) {
    return true;
  }
  const exemption = def.braveLimitExemption;
  if (!exemption) return false;
  if (!exemption.hostCondition) return true;
  if (!hostDef) return false;
  return matchesBraveConditionForCard({
    condition: exemption.hostCondition,
    state: options.state,
    card: host,
    definition: hostDef,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.excludeBraveInstanceId !== undefined
      ? { excludeBraveInstanceId: options.excludeBraveInstanceId }
      : {}),
    categoryEvaluation: "brave_host",
  });
}

function attachedBraveCountMatchingNameContains(
  state: GameState,
  host: CardInstance,
  cardNameContains: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number {
  const physicalCount = host.attachedChildrenIds.filter((braveId) => {
    const brave = getCardById(state, braveId);
    const braveDef = brave
      ? getCardDefinitionById(brave.definitionId)
      : undefined;
    return (
      brave !== undefined &&
      braveDef !== undefined &&
      getEffectiveCardName(
        state,
        brave,
        braveDef,
        getCardDefinitionById
      ).includes(cardNameContains)
    );
  }).length;
  const virtualCount = getVirtualCombinedBraves(state, host.instanceId).filter(
    (brave) => brave.cardName?.includes(cardNameContains) ?? false
  ).length;
  return physicalCount + virtualCount;
}

function hostHasAttachedBraveNameContains(
  state: GameState,
  host: CardInstance,
  cardNameContains: string[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  excludeBraveInstanceId?: string
): boolean {
  if (cardNameContains.length === 0) return true;
  return cardNameContains.some(
    (name) =>
      attachedBraveCountMatchingNameContains(
        state,
        {
          ...host,
          attachedChildrenIds: host.attachedChildrenIds.filter(
            (id) => id !== excludeBraveInstanceId
          ),
        },
        name,
        getCardDefinitionById
      ) > 0
  );
}

function attachedBraveCountMatchingCardNo(
  state: GameState,
  host: CardInstance,
  cardNo: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  excludeBraveInstanceId?: string
): number {
  return host.attachedChildrenIds.filter((braveId) => {
    if (braveId === excludeBraveInstanceId) return false;
    const brave = getCardById(state, braveId);
    const braveDef = brave
      ? getCardDefinitionById(brave.definitionId)
      : undefined;
    return braveDef?.cardNo === cardNo;
  }).length;
}

function effectiveCardNameContains(
  state: GameState,
  card: CardInstance | undefined,
  definition: CardDefinition,
  cardNameContains: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  const name =
    card !== undefined
      ? getEffectiveCardName(state, card, definition, getCardDefinitionById)
      : definition.name;
  return name.includes(cardNameContains);
}

function getAdditionalBraveSlotBonusForHost(options: {
  state: GameState;
  host: CardInstance;
  hostDef: CardDefinition | undefined;
  incomingBrave?: CardInstance;
  incomingBraveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  excludeBraveInstanceId?: string | undefined;
}): number {
  const slot = options.incomingBraveDef.additionalBraveSlot;
  if (!slot || !options.hostDef) return 0;
  if (
    slot.hostCondition &&
    !matchesBraveConditionForCard({
      condition: slot.hostCondition,
      state: options.state,
      card: options.host,
      definition: options.hostDef,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.excludeBraveInstanceId !== undefined
        ? { excludeBraveInstanceId: options.excludeBraveInstanceId }
        : {}),
      categoryEvaluation: "brave_host",
    })
  ) {
    return 0;
  }
  if (
    slot.requiredAttachedBraveNameContains &&
    !hostHasAttachedBraveNameContains(
      options.state,
      options.host,
      slot.requiredAttachedBraveNameContains,
      options.getCardDefinitionById,
      options.excludeBraveInstanceId
    )
  ) {
    return 0;
  }
  const maxPerHost = slot.maxPerHost ?? 1;
  const sameCardCount = attachedBraveCountMatchingCardNo(
    options.state,
    options.host,
    options.incomingBraveDef.cardNo,
    options.getCardDefinitionById,
    options.incomingBrave?.instanceId ?? options.excludeBraveInstanceId
  );
  if (sameCardCount >= maxPerHost) return 0;
  return 1;
}

export function attachedBravesCountingTowardLimit(
  state: GameState,
  host: CardInstance,
  hostDef: CardDefinition | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number {
  const effectiveHostName = hostDef
    ? getEffectiveCardName(state, host, hostDef, getCardDefinitionById)
    : undefined;
  const physicalCount = host.attachedChildrenIds.filter((braveId) => {
    const brave = getCardById(state, braveId);
    const braveDef = brave
      ? getCardDefinitionById(brave.definitionId)
      : undefined;
    return !isBraveLimitExemptForHost({
      state,
      def: braveDef,
      host,
      hostDef,
      effectiveHostName,
      getCardDefinitionById,
      excludeBraveInstanceId: brave?.instanceId,
    });
  }).length;
  return (
    physicalCount + getVirtualCombinedBraveLimitCount(state, host.instanceId)
  );
}

/**
 * maxCombinedBraves.condition 等の定義レベルのブレイヴ条件判定。
 * matchesBraveConditionForCard (instance/実効値ベース) とは別に、
 * 対象カード定義のみで categories/colors/tribes/minCost/cardNames を判定する。
 */
function matchesBraveConditionSingle(
  cond: BraveCondition,
  targetDef: CardDefinition
): boolean {
  if (cond.attachedBraveNameContains?.length) return false;
  if (
    cond.targetsGrandwalker === "only" &&
    !isGrandwalkerOrGuidedNexus(targetDef)
  ) {
    return false;
  }
  if (
    cond.grandwalkerKind &&
    cond.grandwalkerKind !== "any" &&
    !grandwalkerKindMatches(targetDef.grandwalkerData, cond.grandwalkerKind)
  ) {
    return false;
  }
  if (
    cond.categories &&
    !matchesCardFilterByDef(targetDef, { category: cond.categories })
  ) {
    return false;
  }
  if (cond.colors && !cond.colors.some((c) => targetDef.colors.includes(c)))
    return false;
  if (
    cond.tribes &&
    !matchesTribes(targetDef.tribe, {
      tribes: cond.tribes,
      ...(cond.tribesLogic ? { tribesLogic: cond.tribesLogic } : {}),
    })
  )
    return false;
  if (cond.excludeTribeSubstring && cond.excludeTribeSubstring.length > 0) {
    const tribeParts = targetDef.tribe ? targetDef.tribe.split("・") : [];
    if (tribeContainsExcludedSubstring(tribeParts, cond.excludeTribeSubstring))
      return false;
  }
  if (cond.minCost !== undefined && targetDef.cost < cond.minCost) return false;
  if (cond.cardNames && !cond.cardNames.includes(targetDef.name)) return false;
  if (
    cond.cardNameContains &&
    !cond.cardNameContains.some((n) => targetDef.name.includes(n))
  )
    return false;
  return true;
}

/**
 * `BraveCondition.alternatives`（OR）込みの判定。基本条件を満たさなければ、
 * alternatives のいずれか 1 つを満たすかを追加でチェックする。
 */
function matchesBraveCondition(
  cond: BraveCondition,
  targetDef: CardDefinition
): boolean {
  if (matchesBraveConditionSingle(cond, targetDef)) return true;
  return (cond.alternatives ?? []).some((alt) =>
    matchesBraveConditionSingle(alt, targetDef)
  );
}

/**
 * 異魔神ブレイヴ (10_rules/08c §7) の右合体スロットが host を占有しているか。右スロットは
 * host 側 `attachedChildrenIds` に反映しない非対称設計 (model.ts CardInstance.imaginRightCombinedWith)
 * のため、`attachedBravesCountingTowardLimit` の走査からは見えない。「異魔神と合体中は
 * 他のブレイヴと合体不可」を守るため `canReceiveBraveWithinCombineLimit` 側で加算する。
 */
function isHostOccupiedByImaginRightSlot(
  state: GameState,
  hostInstanceId: string
): boolean {
  return state.cardInstances.some(
    (c) => c.imaginRightCombinedWith === hostInstanceId
  );
}

type MaxCombinedBravesConfig = NonNullable<CardDefinition["maxCombinedBraves"]>;

function incomingBraveMatchesMaxCombinedBravesCondition(options: {
  state: GameState;
  multi: MaxCombinedBravesConfig;
  incomingBrave?: CardInstance;
  incomingBraveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (!options.multi.condition) return true;
  return options.incomingBrave
    ? matchesBraveConditionForCard({
        condition: options.multi.condition,
        state: options.state,
        card: options.incomingBrave,
        definition: options.incomingBraveDef,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    : matchesBraveCondition(options.multi.condition, options.incomingBraveDef);
}

function createContinuousEffectSuppressionDescriptor(options: {
  definition: CardDefinition;
  effect: Effect;
  effectIndex: number;
}): SuppressionEffectDescriptor {
  const hasActivationCondition =
    (options.effect.condition !== undefined &&
      options.effect.condition.length > 0) ||
    options.effect.applicability?.level !== undefined;
  const hasActivationLocation =
    options.effect.applicability !== undefined ||
    options.effect.timingScope !== undefined;
  return {
    sourceDefinitionId: options.definition.cardNo,
    effectIndex: options.effectIndex,
    timingKind: options.effect.timing.kind,
    ...(options.effect.heading !== undefined
      ? { heading: options.effect.heading }
      : {}),
    ...(options.effect.keywords !== undefined
      ? { keywords: options.effect.keywords }
      : {}),
    ...(hasActivationCondition
      ? { activationCondition: "present" as const }
      : {}),
    ...(hasActivationLocation
      ? { activationLocation: "present" as const }
      : {}),
  };
}

export function getActiveMaxCombinedBravesForHost(options: {
  state: GameState;
  host: CardInstance;
  hostDef: CardDefinition | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): MaxCombinedBravesConfig | undefined {
  const hostDef = options.hostDef;
  const multi = hostDef?.maxCombinedBraves;
  if (!multi) return undefined;
  if (multi.effectIndex === undefined) return multi;

  const effect = hostDef.effects?.[multi.effectIndex];
  if (!effect || effect.timing.kind !== "continuous") {
    return undefined;
  }
  if (
    !isTimingScopeActive(
      effect.timingScope,
      options.state.step,
      options.state.activePlayerId,
      options.host.controllerPlayerId
    )
  ) {
    return undefined;
  }
  if (
    effect.applicability !== undefined &&
    !evaluateEffectApplicabilityForCard({
      state: options.state,
      applicability: effect.applicability,
      card: options.host,
      definition: hostDef,
      getCardDefinitionById: options.getCardDefinitionById,
      getCurrentLevel: getEffectiveLevel,
    })
  ) {
    return undefined;
  }
  if (effect.condition !== undefined && effect.condition.length > 0) {
    return undefined;
  }
  if (
    !executeReevaluationCheck({
      state: options.state,
      checkKind: "effect_suppression",
      sourceInstanceId: options.host.instanceId,
      targetInstanceIds: [],
      suppressionEffectDescriptor: createContinuousEffectSuppressionDescriptor({
        definition: hostDef,
        effect,
        effectIndex: multi.effectIndex,
      }),
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    return undefined;
  }

  return multi;
}

export type BraveSelfReferenceRewriteStatus =
  | "not_required"
  | "blocked"
  | "allowed_mandatory"
  | "allowed_optional";

function effectTextParts(options: {
  effect: Effect;
  sourceEffectDefinition: CardDefinition;
}): string[] {
  const textParts: string[] = [];
  if (options.effect.heading) {
    textParts.push(options.effect.heading);
  }
  for (const lineIndex of options.effect.textRef ?? []) {
    const line = options.sourceEffectDefinition.textLines[lineIndex];
    if (line !== undefined) {
      textParts.push(line);
    }
  }
  return textParts;
}

function effectTextReferencesThisSpirit(options: {
  effect: Effect;
  sourceEffectDefinition: CardDefinition;
}): boolean {
  const textParts = effectTextParts(options);
  return textParts.some((part) => /このスピリット(?![/／])/.test(part));
}

function effectHasSpiritCombinedHeading(options: {
  effect: Effect;
  sourceEffectDefinition: CardDefinition;
}): boolean {
  const textParts = effectTextParts(options);
  return textParts.some((part) => part.includes("【スピリット合体中】"));
}

/**
 * Host-side maxCombinedBraves may allow combined brave effect text to rewrite
 * "this spirit" as "this ultimate".  The old generic resolveSelfReferenceCard
 * host redirect is intentionally not enough here: this helper decides whether
 * dispatch/continuous rebuild may apply it, and whether rewriting is optional.
 */
export function getBraveSelfReferenceRewriteStatus(options: {
  state: GameState;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceEffectDefinition: CardDefinition;
  sourceEffectInstanceId?: string;
  effect: Effect | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): BraveSelfReferenceRewriteStatus {
  const effect = options.effect;
  if (effect === undefined) {
    return "not_required";
  }
  const effectSourceCard =
    options.sourceEffectInstanceId !== undefined
      ? getCardById(options.state, options.sourceEffectInstanceId)
      : options.sourceCard;
  if (!effectSourceCard) {
    return options.sourceEffectDefinition.printedCategory === "brave"
      ? "blocked"
      : "not_required";
  }
  const hostInstanceId = effectSourceCard.attachedToInstanceId;
  if (hostInstanceId === null) {
    return "not_required";
  }
  if (
    getEffectiveCategory(
      options.state,
      effectSourceCard,
      options.sourceEffectDefinition
    ) !== "brave" ||
    !effectTextReferencesThisSpirit({
      effect,
      sourceEffectDefinition: options.sourceEffectDefinition,
    })
  ) {
    return "not_required";
  }

  const host = getCardById(options.state, hostInstanceId);
  const hostDef = host
    ? options.getCardDefinitionById(host.definitionId)
    : undefined;
  if (!host || !hostDef) {
    return "not_required";
  }
  if (getEffectiveCategory(options.state, host, hostDef) !== "ultimate") {
    return "not_required";
  }
  if (
    effectHasSpiritCombinedHeading({
      effect,
      sourceEffectDefinition: options.sourceEffectDefinition,
    })
  ) {
    return "blocked";
  }

  const multi = getActiveMaxCombinedBravesForHost({
    state: options.state,
    host,
    hostDef,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const rewrite = multi?.selfReferenceRewrite;
  if (
    multi === undefined ||
    rewrite?.fromText !== "this_spirit" ||
    rewrite.toHostCategory !== "ultimate" ||
    (rewrite.executionMode !== "optional" &&
      rewrite.executionMode !== "mandatory") ||
    multi.ignoreIncomingBraveCondition !== true ||
    !incomingBraveMatchesMaxCombinedBravesCondition({
      state: options.state,
      multi,
      incomingBrave: effectSourceCard,
      incomingBraveDef: options.sourceEffectDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    return "blocked";
  }

  return rewrite.executionMode === "mandatory"
    ? "allowed_mandatory"
    : "allowed_optional";
}

/**
 * Enumerate minimal separations, not an attachment-order-selected survivor.
 * Q3322/Q24909: the owner chooses a legal remainder. Named/tribal permissions
 * do not remove the ordinary single slot (Q15380/Q7111).
 * Construction order remains relevant to additionalBraveSlot; try legal last
 * additions rather than turning that distinct permission into a flat count.
 */
export function getBraveCapacitySeparationOptions(options: {
  state: GameState;
  host: CardInstance;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string[][] {
  const all = getCombinedUnitBraveChildren(
    options.state,
    options.host,
    options.getCardDefinitionById
  )
    .filter((brave) =>
      options.host.attachedChildrenIds.includes(brave.instanceId)
    )
    .map((brave) => brave.instanceId)
    .sort();
  const feasible = new Map<string, boolean>();
  const isFeasible = (ids: string[]): boolean => {
    if (ids.length === 0) return true;
    const key = JSON.stringify(ids);
    const cached = feasible.get(key);
    if (cached !== undefined) return cached;
    const result = ids.some((id) => {
      const brave = getCardById(options.state, id);
      const braveDef =
        brave && options.getCardDefinitionById(brave.definitionId);
      if (!brave || !braveDef) return false;
      const rest = ids.filter((other) => other !== id);
      return (
        canReceiveBraveWithinCombineLimit({
          ...options,
          host: { ...options.host, attachedChildrenIds: rest },
          incomingBrave: brave,
          incomingBraveDef: braveDef,
        }) && isFeasible(rest)
      );
    });
    feasible.set(key, result);
    return result;
  };
  if (isFeasible(all)) return [];
  const remainders: string[][] = [];
  const visited = new Set<string>();
  const visit = (ids: string[]): void => {
    const key = JSON.stringify(ids);
    if (visited.has(key)) return;
    visited.add(key);
    if (isFeasible(ids)) {
      remainders.push(ids);
      return;
    }
    for (const id of ids) visit(ids.filter((other) => other !== id));
  };
  visit(all);
  return remainders
    .filter(
      (ids) =>
        !remainders.some(
          (other) =>
            other.length > ids.length && ids.every((id) => other.includes(id))
        )
    )
    .map((ids) => all.filter((id) => !ids.includes(id)));
}

/**
 * ホスト側の多重合体キーワード (maxCombinedBraves) を含めた「このブレイヴを受け入れられるか」判定。
 * legal_brave_combine (main フェーズの直接合体) と ENGINE-bsft01-tr-rebirth-brave-combine-branch
 * (効果ステップ内合体、brave_combine_effect) の両方の SSOT。
 */
export function canReceiveBraveWithinCombineLimit(options: {
  state: GameState;
  host: CardInstance;
  incomingBrave?: CardInstance;
  incomingBraveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const hostDef = options.getCardDefinitionById(options.host.definitionId);
  // Additional multiple-combine permission is separate from the ordinary slot.
  const multi = getActiveMaxCombinedBravesForHost({
    state: options.state,
    host: options.host,
    hostDef,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const existingCount =
    attachedBravesCountingTowardLimit(
      options.state,
      options.host,
      hostDef,
      options.getCardDefinitionById
    ) +
    (isHostOccupiedByImaginRightSlot(options.state, options.host.instanceId)
      ? 1
      : 0);
  const effectiveHostName = hostDef
    ? getEffectiveCardName(
        options.state,
        options.host,
        hostDef,
        options.getCardDefinitionById
      )
    : undefined;
  const incomingCount = isBraveLimitExemptForHost({
    state: options.state,
    def: options.incomingBraveDef,
    host: options.host,
    hostDef,
    effectiveHostName,
    getCardDefinitionById: options.getCardDefinitionById,
    excludeBraveInstanceId: options.incomingBrave?.instanceId,
  })
    ? 0
    : 1;
  // A count-exempt brave does not consume the restricted multi-combine slots.
  // Its own combine condition is checked by the ordinary combine pipeline.
  if (incomingCount === 0) return true;
  const countedHost = {
    ...options.host,
    attachedChildrenIds: options.host.attachedChildrenIds.filter((id) => {
      const brave = getCardById(options.state, id);
      return !isBraveLimitExemptForHost({
        state: options.state,
        def: brave && options.getCardDefinitionById(brave.definitionId),
        host: options.host,
        hostDef,
        effectiveHostName,
        getCardDefinitionById: options.getCardDefinitionById,
        excludeBraveInstanceId: id,
      });
    }),
  };
  const additionalSlotBonus = getAdditionalBraveSlotBonusForHost({
    state: options.state,
    host: options.host,
    hostDef,
    ...(options.incomingBrave ? { incomingBrave: options.incomingBrave } : {}),
    incomingBraveDef: options.incomingBraveDef,
    getCardDefinitionById: options.getCardDefinitionById,
    excludeBraveInstanceId: options.incomingBrave?.instanceId,
  });
  // Q15380/Q7111: an unrelated brave can occupy the ordinary slot, but
  // cannot share the restricted multiple-combine permission with other braves.
  if (existingCount + incomingCount <= 1 + additionalSlotBonus) return true;
  if (!multi) return false;
  const matches = (
    incomingBrave: CardInstance | undefined,
    incomingBraveDef: CardDefinition
  ) =>
    incomingBraveMatchesMaxCombinedBravesCondition({
      ...options,
      multi,
      ...(incomingBrave ? { incomingBrave } : {}),
      incomingBraveDef,
    });
  if (!matches(options.incomingBrave, options.incomingBraveDef)) return false;
  if (
    !countedHost.attachedChildrenIds.every((id) => {
      const brave = getCardById(options.state, id);
      const def = brave && options.getCardDefinitionById(brave.definitionId);
      return brave !== undefined && def !== undefined && matches(brave, def);
    })
  )
    return false;
  for (const limit of multi.nameLimits ?? []) {
    if (
      !effectiveCardNameContains(
        options.state,
        options.incomingBrave,
        options.incomingBraveDef,
        limit.cardNameContains,
        options.getCardDefinitionById
      )
    )
      continue;
    const existingNamedCount = attachedBraveCountMatchingNameContains(
      options.state,
      countedHost,
      limit.cardNameContains,
      options.getCardDefinitionById
    );
    if (existingNamedCount + incomingCount > limit.maxCount) return false;
  }
  return existingCount + incomingCount <= multi.count + additionalSlotBonus;
}

export function isIncomingBraveConditionIgnoredByHost(options: {
  state: GameState;
  host: CardInstance;
  incomingBrave?: CardInstance;
  incomingBraveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const hostDef = options.getCardDefinitionById(options.host.definitionId);
  const multi = getActiveMaxCombinedBravesForHost({
    state: options.state,
    host: options.host,
    hostDef,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return (
    multi?.ignoreIncomingBraveCondition === true &&
    incomingBraveMatchesMaxCombinedBravesCondition({
      state: options.state,
      multi,
      ...(options.incomingBrave
        ? { incomingBrave: options.incomingBrave }
        : {}),
      incomingBraveDef: options.incomingBraveDef,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  );
}

/**
 * ある自分のスピリット/アルティメット (host) が、指定ブレイヴ (incomingBraveDef) の
 * 効果ステップ内合体 (brave_combine_effect) の対象として適格か。
 * legal-actions-availability.ts の getAvailableBraveCombineLegalActions (直接合体) と
 * 同じ 3 条件 (cannot_combine 制約 / braveCondition / 多重合体上限) を SSOT として共有する。
 */
export function isEligibleBraveCombineHost(options: {
  state: GameState;
  host: CardInstance;
  hostDefinition: CardDefinition;
  incomingBraveCondition: BraveCondition | undefined;
  incomingBrave?: CardInstance;
  incomingBraveDef: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (
    hasCannotCombineRestriction(
      options.state,
      options.host.instanceId,
      options.hostDefinition
    )
  )
    return false;
  if (
    options.incomingBrave &&
    hasEnterFieldOnlyCorePlacementRestriction(options.hostDefinition) &&
    getTotalCoresOnCardById(options.state, options.incomingBrave.instanceId) > 0
  ) {
    return false;
  }
  if (
    options.incomingBraveCondition &&
    !isIncomingBraveConditionIgnoredByHost({
      state: options.state,
      host: options.host,
      ...(options.incomingBrave
        ? { incomingBrave: options.incomingBrave }
        : {}),
      incomingBraveDef: options.incomingBraveDef,
      getCardDefinitionById: options.getCardDefinitionById,
    }) &&
    !matchesBraveConditionForCard({
      condition: options.incomingBraveCondition,
      state: options.state,
      card: options.host,
      definition: options.hostDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      categoryEvaluation: "brave_host",
    })
  )
    return false;
  return canReceiveBraveWithinCombineLimit({
    state: options.state,
    host: options.host,
    ...(options.incomingBrave ? { incomingBrave: options.incomingBrave } : {}),
    incomingBraveDef: options.incomingBraveDef,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * 解決時点の盤面で、ブレイヴが直接合体できる生存ホストを列挙する。
 *
 * ブレイヴ召喚、効果内合体、転醒内蔵の「このとき」合体選択の共通 SSOT。
 * `braveDef` は実カードがまだ A 面の仮想転醒中でも、転醒後 B 面定義を渡して評価する。
 */
export function getValidBraveCombineHosts(
  state: GameState,
  braveDef: CardDefinition,
  controllerPlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  braveInstanceId?: string
): CardInstance[] {
  if (hasCannotCombineRestriction(state, braveInstanceId, braveDef)) return [];
  const braveCard =
    braveInstanceId !== undefined ? getCardById(state, braveInstanceId) : null;
  const allowsNexusHost = braveConditionAllowsNexusHost(
    braveDef.braveCondition
  );
  return state.cardInstances.filter((host) => {
    if (host.zone !== "field") return false;
    if (host.controllerPlayerId !== controllerPlayerId) return false;
    if (
      host.zoneRoleName !== "spirit" &&
      host.zoneRoleName !== "ultimate" &&
      !(allowsNexusHost && host.zoneRoleName === "nexus")
    )
      return false;
    if (host.pendingLeaveKind !== null) return false;
    const hostDef = getCardDefinitionById(host.definitionId);
    if (!hostDef) return false;
    return isEligibleBraveCombineHost({
      state,
      host,
      hostDefinition: hostDef,
      incomingBraveCondition: braveDef.braveCondition,
      ...(braveCard ? { incomingBrave: braveCard } : {}),
      incomingBraveDef: braveDef,
      getCardDefinitionById,
    });
  });
}

export interface BraveSeparationCoreSource {
  key: string;
  container: NormalCoreContainer;
  available: number;
}

/**
 * ブレイヴ分離の維持コア補填に充てられる通常コア source。
 *
 * key は GUI / REST の `separateCoreDistribution` と同じ `"reserve"` または
 * card instanceId。候補 source はリザーブ + 自分フィールドのカード上で、
 * canMoveCoresFrom で移動禁止のものは除外する。
 */
export function getAvailableBraveSeparationCoreSources(
  state: GameState,
  playerId: string,
  braveInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): BraveSeparationCoreSource[] {
  const sources: BraveSeparationCoreSource[] = [];
  const player = state.players.find((p) => p.id === playerId);
  if ((player?.reserveNormalCoreCount ?? 0) > 0) {
    sources.push({
      key: "reserve",
      container: { kind: "reserve", playerId },
      available: player!.reserveNormalCoreCount,
    });
  }
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== playerId) continue;
    if (card.instanceId === braveInstanceId) continue;
    if (card.normalCoreCount <= 0) continue;
    const definition = getCardDefinitionById(card.definitionId);
    if (!canMoveNormalCoresFrom(state, card, definition)) continue;
    sources.push({
      key: card.instanceId,
      container: { kind: "card", instanceId: card.instanceId },
      available: card.normalCoreCount,
    });
  }
  return sources;
}

/**
 * ブレイヴ分離の維持コア補填に充てられる通常コア数。
 *
 * getAvailableBraveSeparateLegalActions (legal-actions-availability.ts、GUI 基本操作
 * brave_separate) と brave_separate_effect (native-target-resolution.ts、
 * engine-field-magic-self-placement カード効果発動経路) の共通 SSOT。片方だけ
 * 充足性チェックを持つと、もう片方で moveNormalCoresForBraveSeparation の無条件
 * throw が対象解決をすり抜けて未捕捉例外になる。
 */
export function getAvailableBraveSeparationCoreCount(
  state: GameState,
  playerId: string,
  braveInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  return getAvailableBraveSeparationCoreSources(
    state,
    playerId,
    braveInstanceId,
    getCardDefinitionById
  ).reduce((total, source) => total + source.available, 0);
}

/**
 * 指定ブレイヴが分離時に維持コア (Lv1 requiredCores) を補填できるか
 * (getAvailableBraveSeparationCoreCount が SSOT)。
 */
export function isEligibleBraveSeparationTarget(
  state: GameState,
  brave: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const braveMinCores = brave.minimumRequiredCores;
  const braveCores =
    brave.normalCoreCount + (isSoulCoreOn(state, brave.instanceId) ? 1 : 0);
  const needed = Math.max(0, braveMinCores - braveCores);
  if (needed === 0) return true;
  const availableCores = getAvailableBraveSeparationCoreCount(
    state,
    brave.controllerPlayerId,
    brave.instanceId,
    getCardDefinitionById
  );
  return needed <= availableCores;
}

function getBraveConditionColors(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  excludeBraveInstanceId?: string
): CardColor[] {
  const result = [...getEffectiveColors(state, card, def)];
  for (const childId of card.attachedChildrenIds) {
    if (childId === excludeBraveInstanceId) continue;
    const child = getCardById(state, childId);
    if (
      !child ||
      child.zone !== "field" ||
      child.attachedToInstanceId !== card.instanceId
    ) {
      continue;
    }
    const childDef = getCardDefinitionById?.(child.definitionId);
    if (!childDef) continue;
    for (const color of getEffectiveColors(state, child, childDef)) {
      if (!result.includes(color)) result.push(color);
    }
  }
  return result;
}

function getBraveConditionCost(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  excludeBraveInstanceId?: string
): number {
  let result = getEffectiveCost(state, card, def, getCardDefinitionById);
  for (const childId of card.attachedChildrenIds) {
    if (childId === excludeBraveInstanceId) continue;
    const child = getCardById(state, childId);
    if (
      !child ||
      child.zone !== "field" ||
      child.attachedToInstanceId !== card.instanceId
    ) {
      continue;
    }
    const childDef = getCardDefinitionById?.(child.definitionId);
    if (!childDef) continue;
    result += getEffectiveCost(state, child, childDef, getCardDefinitionById);
  }
  return result + getVirtualCombinedBraveCostTotal(state, card.instanceId);
}

function getBraveHostPhysicalCategory(
  card: CardInstance
): CardCategory | undefined {
  return card.zoneRoleName === "spirit" ||
    card.zoneRoleName === "ultimate" ||
    card.zoneRoleName === "nexus"
    ? card.zoneRoleName
    : undefined;
}

/**
 * ブレイヴ合体条件を、override_properties.cardName 反映後の有効カード名込みで判定する。
 *
 * カード名指定は 2 種類:
 * - `cardNames`        … 「カード名：「X」」形式。カード名全文が完全一致。
 * - `cardNameContains` … 「「X」」形式。カード名に X を部分文字列として含めば成立。
 */
export function matchesBraveConditionForCard(options: {
  condition: BraveCondition;
  state: GameState;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  excludeBraveInstanceId?: string;
  categoryEvaluation?: "effective" | "brave_host";
}): boolean {
  const { condition: cond, state, card, definition } = options;
  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    options.getCardDefinitionById
  );
  const effectiveCategory =
    overridden?.treatAsCategory ??
    getEffectiveCategory(state, card, definition);
  const conditionCategory =
    options.categoryEvaluation === "brave_host"
      ? getBraveHostPhysicalCategory(card)
      : effectiveCategory;
  const effectiveColors = getBraveConditionColors(
    state,
    card,
    definition,
    options.getCardDefinitionById,
    options.excludeBraveInstanceId
  );
  const effectiveTribes = getEffectiveTribes(
    state,
    card,
    definition,
    options.getCardDefinitionById
  );
  const effectiveCost = getBraveConditionCost(
    state,
    card,
    definition,
    options.getCardDefinitionById,
    options.excludeBraveInstanceId
  );
  const countValue =
    state.players.find((p) => p.id === card.controllerPlayerId)?.countValue ??
    0;
  const effectiveName = getEffectiveCardName(
    state,
    card,
    definition,
    options.getCardDefinitionById
  );

  const matchesSingle = (c: BraveCondition): boolean => {
    if (
      c.targetsGrandwalker === "only" &&
      !isGrandwalkerOrGuidedNexus(definition)
    ) {
      return false;
    }
    if (
      c.grandwalkerKind &&
      c.grandwalkerKind !== "any" &&
      !grandwalkerKindMatches(definition.grandwalkerData, c.grandwalkerKind)
    ) {
      return false;
    }
    if (
      c.categories &&
      (conditionCategory === undefined ||
        !c.categories.includes(conditionCategory))
    )
      return false;
    if (c.colors && !c.colors.some((col) => effectiveColors.includes(col)))
      return false;
    if (
      c.tribes &&
      !matchesTribes(
        undefined,
        {
          tribes: c.tribes,
          ...(c.tribesLogic ? { tribesLogic: c.tribesLogic } : {}),
        },
        effectiveTribes
      )
    )
      return false;
    if (
      c.excludeTribeSubstring &&
      c.excludeTribeSubstring.length > 0 &&
      tribeContainsExcludedSubstring(effectiveTribes, c.excludeTribeSubstring)
    )
      return false;
    if (c.minCost !== undefined && effectiveCost < c.minCost) return false;
    if (c.minCount !== undefined && countValue < c.minCount) return false;
    if (c.cardNames && !c.cardNames.includes(effectiveName)) return false;
    if (
      c.cardNameContains &&
      !c.cardNameContains.some((n) => effectiveName.includes(n))
    )
      return false;
    if (
      c.attachedBraveNameContains &&
      !hostHasAttachedBraveNameContains(
        state,
        card,
        c.attachedBraveNameContains,
        options.getCardDefinitionById ?? (() => undefined),
        options.excludeBraveInstanceId
      )
    )
      return false;
    return true;
  };

  if (matchesSingle(cond)) return true;
  return (cond.alternatives ?? []).some((alt) => matchesSingle(alt));
}

/**
 * `braveCondition`（`alternatives` 込み）がネクサスをホスト候補として許容するか。
 * ENGINE-brave-combine-nexus-host: 候補列挙 (`getAvailableBraveCombineLegalActions` /
 * `getValidBraveCombineHosts`) は categories:"nexus" を明示するブレイヴのみネクサスも
 * 候補に含める（既定は spirit/ultimate のみ）。基本条件だけでなく `alternatives` の
 * いずれかが categories:"nexus" を含む場合も対象（BSTH003-C31 型: 「導魔＆コスト5以上」or
 * 「導魔＆導界者ネクサス」のように一部の合体条件のみネクサスを許すブレイヴ）。
 */
export function braveConditionAllowsNexusHost(
  condition: BraveCondition | undefined
): boolean {
  if (!condition) return false;
  if (condition.categories?.includes("nexus")) return true;
  return (condition.alternatives ?? []).some((alt) =>
    alt.categories?.includes("nexus")
  );
}

/**
 * カードに適用中の Lv コスト加算修飾（`override_properties.levelCostDelta`）の合計を返す。
 *
 * 2 経路を合算する:
 *  1. instance 直付け CE（`getOverriddenProperties` で集約済み）。
 *  2. filter ベースのグローバル CE（「相手のスピリット/アルティメットすべて」型）。
 *     動的メンバーシップのため、解決時に当該カードがフィルタにマッチするか判定する。
 *
 * `levelCost`（上書き）とは独立に作用する純粋な加算。`getEffectiveLevel` が
 * 閾値（必要コア数）に一律加算するために使う。
 */
export function getEffectiveLevelCostDelta(
  state: GameState,
  card: CardInstance | undefined,
  def: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: GlobalOverridePropertiesEvaluationOptions = {}
): number {
  if (!card) return 0;
  let delta = 0;

  // (1) instance 直付け CE
  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    getCardDefinitionById,
    false
  );
  if (typeof overridden?.levelCostDelta === "number") {
    delta += overridden.levelCostDelta;
  }

  // (2) filter ベースのグローバル CE（動的メンバーシップ）
  if (def && getCardDefinitionById) {
    const baseParts = def.tribe ? def.tribe.split("・") : [];
    for (const ce of getGlobalCEs(state)) {
      if (options.excludedGlobalEffectIds?.has(ce.effectId)) continue;
      if (ce.modifierTag !== "override_properties") continue;
      if (!ce.targetFilter) continue;
      const props = ce.metadata?.properties as
        | Record<string, unknown>
        | undefined;
      if (!props || typeof props.levelCostDelta !== "number") continue;
      if (
        !matchesOverridePropertiesGlobalCE(
          ce,
          card,
          def,
          state,
          baseParts,
          getCardDefinitionById,
          options
        )
      ) {
        continue;
      }
      if (
        !globalOverridePropertiesCanAffectCard(
          state,
          ce,
          card,
          getCardDefinitionById,
          "levelCostDelta"
        )
      ) {
        continue;
      }
      delta += props.levelCostDelta as number;
    }
  }

  return delta;
}

/**
 * `levelCost`（Lv 別必要コア数の絶対値上書き）の実効値を取得する。
 * instance 直付け CE (`getOverriddenProperties`) を優先し、無ければ filter ベースの
 * グローバル CE（動的メンバーシップ、`getEffectiveLevelCostDelta`/`getEffectiveTribes`
 * と同型）を走査する。複数のグローバル CE が同時にマッチする場合は最初に見つかったものを
 * 採用する（`levelCostDelta` と異なり絶対値上書きは合算できないため）。
 * `getEffectiveLevel`（battle-shared.ts）の SSOT。
 */
export function getEffectiveLevelCostOverride(
  state: GameState,
  card: CardInstance | undefined,
  def: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: GlobalOverridePropertiesEvaluationOptions = {}
): { lv1?: number; lv2?: number; lv3?: number } | undefined {
  if (!card) return undefined;

  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    getCardDefinitionById,
    false
  );
  if (overridden?.levelCost) return overridden.levelCost;

  if (def && getCardDefinitionById) {
    const baseParts = def.tribe ? def.tribe.split("・") : [];
    for (const ce of getGlobalCEs(state)) {
      if (options.excludedGlobalEffectIds?.has(ce.effectId)) continue;
      if (ce.modifierTag !== "override_properties") continue;
      if (!ce.targetFilter) continue;
      const props = ce.metadata?.properties as
        | Record<string, unknown>
        | undefined;
      if (
        !props ||
        typeof props.levelCost !== "object" ||
        props.levelCost === null
      ) {
        continue;
      }
      if (
        !matchesOverridePropertiesGlobalCE(
          ce,
          card,
          def,
          state,
          baseParts,
          getCardDefinitionById,
          options
        )
      ) {
        continue;
      }
      if (
        !globalOverridePropertiesCanAffectCard(
          state,
          ce,
          card,
          getCardDefinitionById,
          "levelCost"
        )
      ) {
        continue;
      }
      return props.levelCost as { lv1?: number; lv2?: number; lv3?: number };
    }
  }

  return undefined;
}

/**
 * 実効 Lv の直接上書き（`"max"` = 対象カード自身の最高 Lv 扱い、`{delta}` = 通常算出値への
 * 加算）の実効値を取得する。instance 直付け CE (`getOverriddenProperties`) を優先し、
 * 無ければ filter ベースのグローバル CE（動的メンバーシップ、`getEffectiveLevelCostOverride`
 * と同型、`"max"` のみ対応）を走査する。`{delta}` は count:"all" のフィルタ対象にしない
 * 前提（`executeOverrideProperties` の `isAllScopeFilter` 判定が `onlyLevel` を `"max"` 限定に
 * しているため、常に instance 直付け経路のみを通る）。`getEffectiveLevel`（battle-shared.ts）の
 * SSOT。
 */
export function getEffectiveLevelOverride(
  state: GameState,
  card: CardInstance | undefined,
  def: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: GlobalOverridePropertiesEvaluationOptions = {}
): "max" | { delta: number } | undefined {
  if (!card) return undefined;

  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    getCardDefinitionById,
    false
  );
  if (overridden?.level === "max") return "max";
  if (overridden?.level && typeof overridden.level === "object") {
    return overridden.level;
  }

  if (def && getCardDefinitionById) {
    const baseParts = def.tribe ? def.tribe.split("・") : [];
    for (const ce of getGlobalCEs(state)) {
      if (options.excludedGlobalEffectIds?.has(ce.effectId)) continue;
      if (ce.modifierTag !== "override_properties") continue;
      if (!ce.targetFilter) continue;
      const props = ce.metadata?.properties as
        | Record<string, unknown>
        | undefined;
      if (!props || props.level !== "max") continue;
      if (
        !matchesOverridePropertiesGlobalCE(
          ce,
          card,
          def,
          state,
          baseParts,
          getCardDefinitionById,
          options
        )
      ) {
        continue;
      }
      if (
        !globalOverridePropertiesCanAffectCard(
          state,
          ce,
          card,
          getCardDefinitionById,
          "level"
        )
      ) {
        continue;
      }
      return "max";
    }
  }

  return undefined;
}

/**
 * カードの実効系統リストを取得する。
 * 計算順序:
 *   1. ベース = `tribes` overwrite CE があれば overwrite 後の値、なければ `def.tribe.split("・")`
 *   2. 自分宛て CE の `addTribes`（addTribes は重複除去で加算）
 *   3. グローバル `override_properties` CE で `targetFilter` が当該カードにマッチするものの `addTribes`
 *
 * カードインスタンス未指定（deck/hand 内などインスタンス文脈なし）の場合は
 * 単に `def.tribe.split("・")` を返す。
 *
 * `virtualAttachedBraves`（mechanics/virtual-combine.ts）の `tribes` はここに
 * 混入しない（意図的）。BP/シンボル/コストは合体ユニット全体の値として仮想ブレイヴ分を
 * 加算する（`getCombinedUnitBp` 等）が、系統はホスト自身のカード同一性の一部であり、
 * `getEffectiveTribes` は effect-resistance-check.ts の
 * `getEffectSourceTribeImmunityBypass`/`isEffectSourceTribeStackNegateImmune` や
 * trigger-system.ts の `TriggerContext.sourceTribes` 導出など、**発生源カードそのものの
 * 識別**に使う複数の source-sensitive negate/suppress/trigger 経路から共有参照される
 * SSOT でもある。ここに仮想ブレイヴの系統を足すと、そのカード自身の効果すべて
 * （合体中に限らず）が仮想ブレイヴの系統を持つかのように誤認され、対象選択の
 * `tribes` filter 等カード同一性全般にも波及してしまう。「合体先が特定の系統を持つか」
 * だけを見たい場合は `ConditionClause.kind:"combined_guest_tribes"` を使う
 * （engine-virtual-brave-combine-bsth07-r01: BSTH07-R01 の仮想ブレイヴ「雲山」由来の
 * 【合体中】能力は、この境界により実際は本体(雲居一輪)を発生源として扱う。現行カード
 * プールに系統「入道」を発生源スコープにした negate/suppress/trigger が存在しないため
 * 実害は無い。将来そうしたカードが必要になった場合、仮想ブレイヴを別 pseudo-source
 * identity として持たせる新規 primitive が要る）。
 */
export function getEffectiveTribes(
  state: GameState,
  card: CardInstance | undefined,
  def: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): string[] {
  const printedBaseParts = getDefinitionTribeParts(def);
  if (!card) return printedBaseParts;
  const includeGlobalOverrideProperties =
    options.includeGlobalOverrideProperties !== false;
  const baseParts = card.faceDown
    ? getEffectiveTribe(
        state,
        card,
        def ?? HIDDEN_CARD_NULL_IDENTITY_DEF,
        getCardDefinitionById
      )
        .split("・")
        .filter(Boolean)
    : printedBaseParts;

  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    getCardDefinitionById,
    includeGlobalOverrideProperties
  );
  const result = [...(overridden?.tribes ?? baseParts)];

  if (overridden?.addTribes) {
    for (const t of overridden.addTribes) {
      if (!result.includes(t)) result.push(t);
    }
  }

  // グローバル override_properties CE（filter target ベース）の addTribes を加算
  if (includeGlobalOverrideProperties && def && getCardDefinitionById) {
    const globals = getGlobalCEs(state);
    for (const ce of globals) {
      if (ce.modifierTag !== "override_properties") continue;
      if (!ce.targetFilter) continue;
      if (
        !matchesOverridePropertiesGlobalCE(
          ce,
          card,
          def,
          state,
          baseParts,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        !globalOverridePropertiesCanAffectCard(
          state,
          ce,
          card,
          getCardDefinitionById,
          "addTribes"
        )
      ) {
        continue;
      }
      const props = ce.metadata?.properties as
        | Record<string, unknown>
        | undefined;
      if (!props) continue;
      const add = props.addTribes;
      if (Array.isArray(add)) {
        for (const t of add as string[]) {
          if (typeof t === "string" && !result.includes(t)) result.push(t);
        }
      }
    }
  }

  return result;
}

/**
 * `CardFilter.tribesMatchRef: "declared_blocker"` の参照カードを解決する（SSOT:
 * 「現在ブロック宣言している相手カード」の導出はここ一箇所のみ）。
 * `activeAttack.blockAssignments` から最初にブロック宣言済み（`blockedByEntityIds`
 * 非空）のエントリを取り、対応する `battleEntity` の host（`memberInstanceIds[0]`）
 * を返す。P2-05 複数ブロック時は最初のエントリ・先頭ブロッカーのみ参照する（既知の限界:
 * 複数の attacker/複数のブロッカーが異なる系統を持つ場合は先頭のみ反映）。バトル外・
 * ブロック未宣言なら `undefined`。
 */
export function resolveDeclaredBlockerCard(
  state: Pick<GameState, "activeAttack" | "battleEntities" | "cardInstances">
): CardInstance | undefined {
  const activeAttack = state.activeAttack;
  if (!activeAttack) return undefined;
  const assignment = activeAttack.blockAssignments.find(
    (a) => a.blockedByEntityIds.length > 0
  );
  const blockerEntityId = assignment?.blockedByEntityIds[0];
  if (!blockerEntityId) return undefined;
  const entity = state.battleEntities.find(
    (e) => e.entityId === blockerEntityId
  );
  const hostInstanceId = entity?.memberInstanceIds[0];
  if (!hostInstanceId) return undefined;
  return state.cardInstances.find((c) => c.instanceId === hostInstanceId);
}

/**
 * `tribesMatchRef: "declared_blocker"` の解決に使う実効系統を返す
 * (`resolveDeclaredBlockerCard` + `getEffectiveTribes` の合成、SSOT)。
 * 参照カード不在・系統なしのときは `undefined`（呼び出し側は
 * `resolveTribesMatchRefFilter` の fail-closed 番兵値に委ねる）。
 */
export function resolveDeclaredBlockerTribes(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] | undefined {
  const card = resolveDeclaredBlockerCard(state);
  if (!card) return undefined;
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return undefined;
  const tribes = getEffectiveTribes(state, card, def, getCardDefinitionById);
  return tribes.length > 0 ? tribes : undefined;
}

/**
 * カードの実効色リストを取得する (P3-33)。
 *
 * 計算順序:
 *   1. ベース = `def.colors`
 *   2. card が field/mirage/burst にあれば、active CE から `treat_as_color` /
 *      `treat_as_color_and_symbol` を集約 (modifierSymbol[0] を加色)
 *   3. card が hand にあれば、`def.effects` の continuous treat_as を直接走査
 *      (`appliesToCard:true` + `aspects` 含 `"color"` のもの)。
 *      手札ゾーンは continuous CE 未登録 (P3-32 と同型の問題)
 *      なので DSL 直接読みで補う。
 *
 * `getEffectiveSymbolBundles` (シンボル) / `getEffectiveTribes` (系統) と
 * 並列の helper。色フィルタ判定で `def.colors` の代わりに使う。
 */
export function getEffectiveColors(
  state: GameState,
  card: CardInstance | undefined,
  def: CardDefinition | undefined
): CardColor[] {
  // engine-deck-derived-clone-spirit: 裏向き act_as_spirit トークンが色を上書きしている
  // 場合はそれを最優先で採用する (「黄の分身スピリット」等、印字カード色を漏らさない)。
  // snapshot.colors 未指定の裏向きカードは null identity のため印字色へフォールバックしない。
  const faceDownOverride = card?.faceDown
    ? resolveActAsSpiritColors(state, card)
    : undefined;

  const base = card?.faceDown
    ? [...(faceDownOverride ?? [])]
    : def?.colors
      ? [...def.colors]
      : [];
  if (!card || !def) return base;

  const result = [...base];
  const addColor = (c: CardColor): void => {
    if (!result.includes(c)) result.push(c);
  };

  // Field/burst/mirage zone: 登録済み CE を集約
  if (
    card.zone === "field" ||
    card.zone === "mirage" ||
    card.zone === "burst"
  ) {
    const ces = getCEsForTarget(state, card.instanceId);
    for (const ce of ces) {
      if (
        ce.modifierTag !== "treat_as_color" &&
        ce.modifierTag !== "treat_as_color_and_symbol"
      ) {
        continue;
      }
      // 多色 treat_as: modifierSymbol の全色を加色する。
      for (const c of ce.modifierSymbol ?? []) {
        if (isCardColorSymbol(c)) addColor(c as CardColor);
      }
    }
  }

  // Hand zone: continuous CE 未登録なので DSL 直接読み。
  // 裏向き手札は null identity のため、印字 continuous treat_as を漏らさない。
  if (card.zone === "hand" && !card.faceDown) {
    for (const effect of def.effects ?? []) {
      if (effect.timing.kind !== "continuous") continue;
      // condition / applicability 評価は省略 (sourceInstanceId は card.instanceId だが、
      // hand 内 condition は実例がほぼ無く、保守的に無条件のみ適用)
      if (effect.condition && effect.condition.length > 0) continue;
      if (effect.applicability) continue;

      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "treat_as") continue;
        if (!action.appliesToCard) continue;
        if (!action.aspects.includes("color")) continue;
        for (const c of normalizeAsColors(action.asColor ?? [])) {
          if (isCardColorSymbol(c)) addColor(c as CardColor);
        }
      }
    }
  }

  return result;
}

const CARD_COLOR_SET = new Set<string>([
  "red",
  "purple",
  "green",
  "white",
  "yellow",
  "blue",
  "black",
]);
function isCardColorSymbol(c: string): boolean {
  return CARD_COLOR_SET.has(c);
}

function getLocalOverrideEffectiveTribes(
  state: GameState,
  card: CardInstance,
  baseTribeParts: readonly string[]
): string[] {
  const overridden = getOverriddenProperties(
    state,
    card.instanceId,
    undefined,
    false
  );
  const result = [...(overridden?.tribes ?? baseTribeParts)];
  for (const t of overridden?.addTribes ?? []) {
    if (!result.includes(t)) result.push(t);
  }
  return result;
}

/**
 * グローバル override_properties CE の targetFilter が指定カードに合致するか。
 * tribe は「instance 宛て CE + 印字」に限定して、グローバル override_properties 同士の
 * targetFilter 再帰を避ける。Lv 判定は通常の実効 Lv を使うが、Lv コスト変更 CE
 * 自身の minLevel/maxLevel 判定だけは評価中 CE を除外する。
 */
function matchesOverridePropertiesGlobalCE(
  ce: ContinuousEffect,
  card: CardInstance,
  def: CardDefinition,
  inputState: GameState,
  baseTribeParts: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options: GlobalOverridePropertiesEvaluationOptions = {}
): boolean {
  const state = continuousEffectInputState(inputState, ce);
  const localTribeParts = getLocalOverrideEffectiveTribes(
    state,
    card,
    baseTribeParts
  );
  const props = ce.metadata?.properties as Record<string, unknown> | undefined;
  const changesLevel =
    props?.levelCost !== undefined ||
    typeof props?.levelCostDelta === "number" ||
    props?.level === "max";
  const excludedGlobalEffectIds = changesLevel
    ? new Set(options.excludedGlobalEffectIds ?? [])
    : undefined;
  if (excludedGlobalEffectIds) excludedGlobalEffectIds.add(ce.effectId);
  return matchesGlobalCETargetFilterInternal(
    state,
    ce,
    {
      controllerPlayerId: card.controllerPlayerId,
      definitionId: card.definitionId,
      instanceId: card.instanceId,
    },
    {
      getCardDefinitionById,
      coreCount: getTotalCoresOnCardById(state, card.instanceId),
      effectiveTribes: localTribeParts,
      effectiveLevel:
        card.zone === "field"
          ? changesLevel
            ? getEffectiveLevelExcludingGlobalOverrideProperties(
                state,
                card,
                def,
                getCardDefinitionById,
                excludedGlobalEffectIds!
              )
            : getEffectiveLevel(state, card, def, getCardDefinitionById)
          : undefined,
      // グローバル override_properties 自身の targetFilter 判定中に cost を読むと、
      // getEffectiveCost -> getOverriddenProperties -> matchesOverridePropertiesGlobalCE が
      // 再入する。instance 直付け override / act_as_spirit / additional_cost は維持し、
      // global override_properties だけをこの評価中は除外する。
      includeGlobalOverridePropertiesInCost: false,
    }
  );
}

// ════════════════════════════════════════════════════════════════
// restrict_use CE 消費 — カード使用制限
// ════════════════════════════════════════════════════════════════

/**
 * プレイヤーが指定カードの使用（召喚/配置/マジック使用/アクセル/チェンジ）を
 * restrict_use CE により制限されているか判定する。
 *
 * restrict_use CE は targetInstanceId = playerId でプレイヤーに紐付き、
 * metadata.filter の CardFilter でカード群を限定する。
 * `metadata.restrictedKinds` が指定されている CE は、その使用種別のみ制限する
 * (省略時 = 全種別制限、既存挙動と後方互換。「効果以外で召喚できない」型
 * (BSTH08.5-X04 effects[0]) のように特定の使用手段だけ禁止したい場合に使う)。
 */
export function isCardUseRestricted(
  state: GameState,
  playerId: string,
  card: CardInstance,
  def: CardDefinition,
  /** field カードに対し effective-* 注入が必要なときに渡す (effectiveSymbolCount 等)。 */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  usageKind?: DSL.CardUseKind,
  useContext?: { byEffect?: boolean; effectiveCost?: number }
): boolean {
  const candidateCEs = [
    ...getCEsForTarget(state, playerId),
    ...getGlobalCEs(state).filter(
      (ce) =>
        ce.modifierTag === "restrict_use" && ce.metadata?.targetScope === "card"
    ),
  ];
  // `filter.maxCost`/`minCost` 判定用の実効(軽減後)コスト。card.zone を問わず
  // calculateReduction で都度計算する（手札/手元ゾーンでも軽減シンボル/floor/追加コストを
  // 反映するため、複数 CE 間で使い回す遅延キャッシュ。BSTH08.5-C22「お互いコストを
  // 支払わずに手札/手元のカードを使えない」= restrict_use + filter.maxCost:0 の判定に使う）。
  let effectiveCostForFilter = useContext?.effectiveCost;
  for (const ce of candidateCEs) {
    if (ce.modifierTag !== "restrict_use" || !ce.metadata) continue;
    if (ce.metadata.onlyNormalUse === true && useContext?.byEffect) continue;
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter) continue;
    const restrictedKinds = ce.metadata.restrictedKinds as
      | DSL.CardUseKind[]
      | undefined;
    // 「使えない」だけでは使用を伴わないフィールド配置を禁止しない。
    if (usageKind === "put_on_field" && !restrictedKinds) continue;
    if (
      restrictedKinds &&
      (!usageKind || !restrictedKinds.includes(usageKind))
    ) {
      continue;
    }
    const sourceDefinition = getCardDefinitionById?.(ce.sourceDefinitionId);
    const needsEffectiveCost =
      ce.metadata.targetScope !== "card" &&
      (filter.maxCost !== undefined || filter.minCost !== undefined);
    if (needsEffectiveCost && effectiveCostForFilter === undefined) {
      effectiveCostForFilter = getCardDefinitionById
        ? calculateReduction({
            state,
            actingPlayerId: playerId,
            card: def,
            getCardDefinitionById,
            sourceInstanceId: card.instanceId,
          }).finalCost
        : def.cost;
    }
    if (ce.metadata.targetScope === "card") {
      if (!getCardDefinitionById) continue;
      if (
        !matchesGlobalCETargetFilter(
          state,
          ce,
          {
            ownerPlayerId: card.ownerPlayerId,
            controllerPlayerId: card.controllerPlayerId,
            definitionId: card.definitionId,
            instanceId: card.instanceId,
            zone: card.zone,
          },
          getCardDefinitionById,
          getTotalCoresOnCardById(state, card.instanceId),
          sourceDefinition
        )
      ) {
        continue;
      }
      const sourceCard = getCardById(state, ce.sourceInstanceId);
      const immunityDecision = resolveCardImmunityAffect(
        state,
        card,
        ce.actingPlayerId,
        "none",
        {
          instance: sourceCard,
          definition: sourceDefinition,
        },
        getCardDefinitionById
      );
      if (immunityDecision.kind !== "allowed") continue;
      return true;
    }
    const opts = {
      cardZone: card.zone,
      ...(effectiveCostForFilter !== undefined
        ? { effectiveCost: effectiveCostForFilter }
        : {}),
      ...(card.zone === "field" && getCardDefinitionById
        ? {
            state,
            effectiveColors: getEffectiveColors(state, card, def),
            effectiveBp: getCombinedUnitBp(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, card.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              card,
              def,
              getCardDefinitionById
            ),
          }
        : {}),
      // `filter.cardName: "self"` (BSTH08.5-X04 効果以外で召喚できない、等) の解決用。
      ...(sourceDefinition ? { sourceDefinition } : {}),
    };
    if (matchesCardFilter(card, def, filter, opts)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// restrict_flash / restrict_stack CE 消費 — タイミング制限 (P3-75)
// ════════════════════════════════════════════════════════════════

/**
 * プレイヤーがフラッシュ効果の使用を `restrict_flash` CE により制限されているか判定する。
 * restrict_flash CE は targetInstanceId = playerId でプレイヤーに紐付く。
 * source(Zone) フィルタは CE の metadata.restrictedZones に格納される（未指定 = 全ゾーン）。
 *
 * @param sourceZone 発動元ゾーン。省略時は全ゾーン制限 CE にのみ一致。
 */
export function isFlashRestricted(
  state: GameState,
  playerId: string,
  sourceZone?: Zone
): boolean {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (!ce.modifierTag.startsWith("restrict_flash")) continue;
    // metadata.restrictedZones が無い = "any" = 全ゾーン制限
    const restrictedZones = ce.metadata?.restrictedZones as Zone[] | undefined;
    if (!restrictedZones) return true; // blanket restriction
    if (sourceZone && restrictedZones.includes(sourceZone)) return true;
  }
  return false;
}

/**
 * プレイヤーがスタック効果の使用を `restrict_stack` CE により制限されているか判定する (P3-75)。
 * restrict_stack CE は targetInstanceId = playerId でプレイヤーに紐付く。
 */
export function isStackRestricted(state: GameState, playerId: string): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) =>
      ce.modifierTag === "restrict_stack" &&
      ce.metadata?.targetScope !== "effect_source"
  );
}

/** `cannot_activate_opponent_burst` CE の metadata から対価を読み出す共通ヘルパ。
 * 対価未指定 (無条件禁止 CE) なら null。 */
function readBurstActivationPaidCost(
  ce: ContinuousEffect
): { resource: "life_core"; amount: number } | null {
  const meta = ce.metadata as
    | { cost?: { resource?: unknown; amount?: unknown } }
    | undefined;
  const amount = meta?.cost?.amount;
  if (meta?.cost?.resource === "life_core" && typeof amount === "number") {
    return { resource: "life_core", amount };
  }
  return null;
}

/**
 * 対価付き `cannot_activate_opponent_burst` CE 全件の対価を合算する共通ヘルパ。
 * 03d:31「同型ゲート複数(別カード)なら合計複数個」はフラッシュ/スタック限定の裁定
 * (03d:30「バースト＝原則含まない」) だが、複数ソースの対価を先頭 1 件のみ判定/請求
 * するのは別ソース分の制限を無視する実質バグのため、対価は合算方式で扱う
 * (同名カード複数枚の重複排除は現状 1 枚のみ存在し未検証のため未対応。
 * 実例が出たら needs-ruling へ)。
 * 対価付き CE が 1 件も無ければ null。
 */
function sumBurstActivationPaidCost(
  state: GameState,
  playerId: string
): { resource: "life_core"; amount: number } | null {
  let total = 0;
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "cannot_activate_opponent_burst") continue;
    const cost = readBurstActivationPaidCost(ce);
    if (cost !== null) total += cost.amount;
  }
  return total > 0 ? { resource: "life_core", amount: total } : null;
}

/**
 * プレイヤーがバースト発動宣言を `cannot_activate_opponent_burst` CE により制限されているか判定する。
 * negate_opponent_burst は発動後の効果抑制であり、こちらは pending burst check の
 * resolve legal action 生成自体を抑止する。
 *
 * CE が対価 (`cost`) を持つ場合 (BSTH02-M02「ライフのコア2個をボイドに置かなければ
 * バーストを発動できない」)、無条件禁止ではなく「対価(複数ソースなら合算)を支払えない
 * ときのみ禁止」。ボイドへの一般コア移動はソウルコア不可
 * (project_soul_core_movement_generic) なので資力判定はライフの通常コア数のみで行う。
 */
export function isBurstActivationRestricted(
  state: GameState,
  playerId: string
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  const hasUnconditionalBan = getCEsForTarget(state, playerId).some(
    (ce) =>
      ce.modifierTag === "cannot_activate_opponent_burst" &&
      readBurstActivationPaidCost(ce) === null
  );
  if (hasUnconditionalBan) return true;
  const totalCost = sumBurstActivationPaidCost(state, playerId);
  if (totalCost === null) return false;
  return (player?.lifeNormalCoreCount ?? 0) < totalCost.amount;
}

/**
 * バースト発動に対価支払いを要求する `cannot_activate_opponent_burst` CE が
 * 現在 playerId に対して有効な場合、その対価(複数ソースなら合算)を返す
 * (資力の有無は問わない)。
 * consumer: legal-actions-apply.ts の resolve_pending_burst_check が宣言時強制支払いに使う。
 */
export function getBurstActivationRequiredLifeCoreCost(
  state: GameState,
  playerId: string
): { resource: "life_core"; amount: number } | null {
  return sumBurstActivationPaidCost(state, playerId);
}

/**
 * プレイヤーが【煌臨】宣言を `restrict_advent` CE により制限されているか判定する
 * (ENGINE-restrict-advent、BSFT01-X01)。restrict_advent CE は targetInstanceId = playerId で
 * プレイヤーに紐付く。isStackRestricted と同型。
 */
export function isAdventRestricted(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "restrict_advent"
  );
}

/**
 * プレイヤーがコストをリザーブから支払うことを `restrict_reserve_cost_payment` CE により
 * 制限されているか判定する (ENGINE-restrict-reserve-cost-payment、BSSL01-R03)。
 * restrict_reserve_cost_payment CE は targetInstanceId = playerId でプレイヤーに紐付く。
 * isAdventRestricted と同型。消費側は payment-system.ts の getAvailableCardCostPaymentSources。
 */
export function isReserveCostPaymentRestricted(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "restrict_reserve_cost_payment"
  );
}

/**
 * プレイヤーがコストをフィールド（カード上のコア）から支払うことを
 * `restrict_field_cost_payment` CE により制限されているか判定する
 * (ENGINE-restrict-field-cost-payment、BSTH08-C06)。isReserveCostPaymentRestricted と
 * 対称。metadata.effectModes が設定されている場合、渡された effectMode がその一覧に
 * 含まれるときのみ制限対象とする (省略時は無条件に制限、リザーブ制限と同じ挙動)。
 * 消費側は payment-system.ts の getAvailableCardCostPaymentSources。
 */
export function isFieldCostPaymentRestricted(
  state: GameState,
  playerId: string,
  effectMode?: "main" | "flash" | "stack"
): boolean {
  return getCEsForTarget(state, playerId).some((ce) => {
    if (ce.modifierTag !== "restrict_field_cost_payment") return false;
    const scopedModes = (
      ce.metadata as { effectModes?: readonly string[] } | undefined
    )?.effectModes;
    if (!scopedModes) return true;
    return effectMode !== undefined && scopedModes.includes(effectMode);
  });
}

/**
 * プレイヤーが `effect_source_prevention_immunity` CE により、指定した発生源カードの
 * 効果を「相手の効果では防げない」扱いにされているか判定する
 * (engine-effect-prevention-immunity-tribes、BSSL01-X02[9,10]『自分の系統：「影」を
 * 持つ効果は、相手の効果では防げない』)。
 *
 * `preventionRestriction`/`preventionLevel` はカード定義側 (author-time) の静的
 * スコープでその効果自身にしか付与できないのに対し、本 CE は「今後発揮される」効果を
 * 発生源カードの実効系統 (`getEffectiveTribes`) で動的に判定する。paid_prevention_immunity
 * と同じ「宣言時に active stack / EffectActionContext の sourcePreventionLevel を
 * 上書きする」消費経路（無償・自動版）。
 */
export function isEffectSourceTribePreventionImmune(
  state: GameState,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const bypass = getEffectSourceTribePreventionBypass(
    state,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById
  );
  return bypass?.kind === "all_effects";
}

export function getEffectSourceTribePreventionBypass(
  state: GameState,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): TargetLockBypassProfile | undefined {
  return getEffectSourceTribeImmunityBypass(
    state,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    "prevention"
  );
}

export function isEffectSourceTribeStackNegateImmune(
  state: GameState,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  return isEffectSourceTribeImmunityActive(
    state,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    "stack_negate"
  );
}

export function resolveDynamicStackNegatePreventionLevel(options: {
  state: GameState;
  sourceInstanceId: string | undefined;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): EffectPreventionLevel | undefined {
  return isEffectSourceTribeStackNegateImmune(
    options.state,
    options.sourceInstanceId,
    options.actingPlayerId,
    options.getCardDefinitionById
  )
    ? "unpreventable"
    : undefined;
}

function isEffectSourceTribeImmunityActive(
  state: GameState,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  appliesTo: "prevention" | "stack_negate"
): boolean {
  return (
    getEffectSourceTribeImmunityBypass(
      state,
      sourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      appliesTo
    ) !== undefined
  );
}

function getEffectSourceTribeImmunityBypass(
  state: GameState,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  appliesTo: "prevention" | "stack_negate"
): TargetLockBypassProfile | undefined {
  if (!sourceInstanceId || !actingPlayerId) return undefined;
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceCard || !sourceDefinition) return undefined;
  const tribes = getEffectiveTribes(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById
  );
  if (tribes.length === 0) return undefined;
  const matchedRestrictedFilters: EffectSourceFilter[] = [];
  for (const ce of getCEsForTarget(state, actingPlayerId)) {
    if (ce.modifierTag !== "effect_source_prevention_immunity") continue;
    const metadata = ce.metadata as
      | {
          tribes?: readonly string[];
          appliesTo?: readonly ("prevention" | "stack_negate")[];
          preventionBypass?: TargetLockBypassProfile;
        }
      | undefined;
    const applies = metadata?.appliesTo ?? ["prevention"];
    if (!applies.includes(appliesTo)) continue;
    const scopeTribes = metadata?.tribes ?? [];
    if (scopeTribes.some((t) => tribes.includes(t))) {
      const bypass = metadata?.preventionBypass ?? { kind: "all_effects" };
      if (bypass.kind === "all_effects") return bypass;
      if (bypass.kind === "preventing_effect_filter") {
        matchedRestrictedFilters.push(bypass.filter);
      } else if (bypass.kind === "any_preventing_effect_filter") {
        matchedRestrictedFilters.push(...bypass.filters);
      }
    }
  }
  if (matchedRestrictedFilters.length === 0) return undefined;
  if (matchedRestrictedFilters.length === 1) {
    return {
      kind: "preventing_effect_filter",
      filter: matchedRestrictedFilters[0]!,
    };
  }
  return {
    kind: "any_preventing_effect_filter",
    filters: matchedRestrictedFilters,
  };
}

function effectHasPreventionImmunityClass(
  effect: Effect,
  effectClass: EffectParamOverrideClass
): boolean {
  const steps = [...effect.steps];
  while (steps.length > 0) {
    const step = steps.shift()!;
    steps.push(...(step.choice ?? []));
    const action = step.action as
      | {
          kind?: string;
          target?: { filter?: CardFilter };
        }
      | undefined;
    if (!action?.target?.filter) continue;
    if (
      action.kind !== "destroy" &&
      action.kind !== "vanish" &&
      action.kind !== "bounce" &&
      action.kind !== "prevent_battle" &&
      action.kind !== "exhaust"
    ) {
      continue;
    }
    if (
      deriveEffectParamOverrideClass(action.kind, action.target.filter) ===
      effectClass
    ) {
      return true;
    }
  }
  return false;
}

function effectSourceClassScopeMatches(options: {
  state: GameState;
  ce: ContinuousEffect;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  sourceInstanceId: string;
  sourceScope: "self" | "combined_host" | "combined_unit";
  sourceMinLevel: number | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const { state, ce, sourceCard, sourceInstanceId, sourceScope } = options;
  const grantSourceCard = getCardById(state, ce.sourceInstanceId);
  if (!grantSourceCard) return false;

  let scopeMatches = sourceInstanceId === ce.sourceInstanceId;
  if (sourceScope === "combined_host") {
    scopeMatches =
      grantSourceCard.attachedToInstanceId !== null &&
      sourceInstanceId === grantSourceCard.attachedToInstanceId;
  } else if (sourceScope === "combined_unit") {
    const hostId = grantSourceCard.attachedToInstanceId ?? ce.sourceInstanceId;
    scopeMatches =
      sourceInstanceId === hostId ||
      sourceInstanceId === ce.sourceInstanceId ||
      getCardById(state, sourceInstanceId)?.attachedToInstanceId === hostId;
  }
  if (!scopeMatches) return false;

  if (options.sourceMinLevel !== undefined) {
    const level =
      getEffectiveLevel(
        state,
        sourceCard,
        options.sourceDefinition,
        options.getCardDefinitionById
      ) ?? 0;
    if (level < options.sourceMinLevel) return false;
  }

  return true;
}

/**
 * `grant_effect_source_prevention_immunity` の effectClass scope が、宣言中の effect に
 * 適用可能かを判定する。effectClass は `effect_param_modify` と同じ分類関数を使う。
 */
export function getEffectClassSourcePreventionBypass(
  state: GameState,
  effect: Effect | undefined,
  sourceInstanceId: string | undefined,
  actingPlayerId: string | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  appliesTo: "prevention" | "stack_negate" = "prevention",
  descriptor?: SuppressionEffectDescriptor
): TargetLockBypassProfile | undefined {
  if (!sourceInstanceId || !actingPlayerId) return undefined;
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceCard || !sourceDefinition) return undefined;

  const matchedRestrictedFilters: EffectSourceFilter[] = [];
  for (const ce of getCEsForTarget(state, actingPlayerId)) {
    if (ce.modifierTag !== "effect_source_prevention_immunity") continue;
    const metadata = ce.metadata as
      | {
          effectClass?: EffectParamOverrideClass;
          effectFilter?: EffectTargetFilter;
          source?: "self" | "combined_host" | "combined_unit";
          sourceMinLevel?: number;
          appliesTo?: readonly ("prevention" | "stack_negate")[];
          preventionBypass?: TargetLockBypassProfile;
        }
      | undefined;
    if (!metadata?.source || (!metadata.effectClass && !metadata.effectFilter))
      continue;
    const applies = metadata.appliesTo ?? ["prevention"];
    if (!applies.includes(appliesTo)) continue;
    if (
      metadata.effectClass &&
      (!effect ||
        !effectHasPreventionImmunityClass(effect, metadata.effectClass))
    ) {
      continue;
    }
    if (
      metadata.effectFilter &&
      !matchesEffectTargetFilter(
        metadata.effectFilter,
        descriptor ??
          (effect
            ? deriveSuppressionEffectDescriptor(effect, {
                sourceDefinitionId: sourceDefinition.cardNo,
                sourceTextLines: sourceDefinition.textLines,
                ...(sourceDefinition.effects?.includes(effect)
                  ? { effectIndex: sourceDefinition.effects.indexOf(effect) }
                  : {}),
              })
            : undefined)
      )
    )
      continue;
    if (
      !effectSourceClassScopeMatches({
        state,
        ce,
        sourceCard,
        sourceDefinition,
        sourceInstanceId,
        sourceScope: metadata.source,
        sourceMinLevel: metadata.sourceMinLevel,
        getCardDefinitionById,
      })
    ) {
      continue;
    }
    const bypass = metadata.preventionBypass ?? { kind: "all_effects" };
    if (bypass.kind === "all_effects") return bypass;
    if (bypass.kind === "preventing_effect_filter") {
      matchedRestrictedFilters.push(bypass.filter);
    } else if (bypass.kind === "any_preventing_effect_filter") {
      matchedRestrictedFilters.push(...bypass.filters);
    }
  }
  if (matchedRestrictedFilters.length === 0) return undefined;
  if (matchedRestrictedFilters.length === 1) {
    return {
      kind: "preventing_effect_filter",
      filter: matchedRestrictedFilters[0]!,
    };
  }
  return {
    kind: "any_preventing_effect_filter",
    filters: matchedRestrictedFilters,
  };
}

/**
 * 宣言中の効果定義が【ソウルドライブ・S】型コスト
 * （`core_move`, `effectKind:"explicit_soul_core"`, `to.kind:"removed_from_game"`）を払い、
 * かつ相手のスピリット/アルティメットに離脱（破壊/コアシュートによる離脱）を及ぼす
 * ステップを含むかを判定する（BSLH01-C07 冥王珠、`getSoulDriveDeparturePreventionBypass` から
 * 消費）。判定基準は発生源カードでなく effect 自身（1 枚のカードが複数効果を持つ場合も
 * 誤爆しない）。
 */
export function effectHasSoulDriveDepartureCost(effect: Effect): boolean {
  const hasSoulDriveCost = effect.steps.some((step) => {
    const action = step.action as
      | { kind?: string; effectKind?: string; to?: { kind?: string } }
      | undefined;
    return (
      action?.kind === "core_move" &&
      action.effectKind === "explicit_soul_core" &&
      action.to?.kind === "removed_from_game"
    );
  });
  if (!hasSoulDriveCost) return false;

  return effect.steps.some((step) => {
    const action = step.action as
      | {
          kind?: string;
          target?: { player?: string };
          from?: { player?: string };
          to?: { kind?: string };
        }
      | undefined;
    if (!action) return false;
    if (
      action.kind === "destroy" ||
      action.kind === "send_to_deck" ||
      action.kind === "bounce"
    ) {
      return action.target?.player === "opponent";
    }
    if (action.kind === "core_move" && action.to?.kind === "trash") {
      return (
        action.target?.player === "opponent" ||
        action.from?.player === "opponent"
      );
    }
    return false;
  });
}

/**
 * `grant_effect_source_prevention_immunity` の `sourceScope:{soulDriveDeparture:true}` CE が、
 * 宣言中の effect に適用可能かを判定する。tribes 版 (`getEffectSourceTribeImmunityBypass`) と
 * 異なり判定基準が発生源カードでなく effect 自身のため、独立関数として実装する。
 * `usageLimit` が設定されている CE は `canUseEffectByUsageLimit` で消費可能かを確認する
 * （実際の消費記録は呼び出し側 `resolveEffectSourcePreventionLevel`/`executeEffect` が行う。
 * 本関数は読み取り専用）。
 */
export function getSoulDriveDeparturePreventionBypass(
  state: GameState,
  effect: Effect,
  actingPlayerId: string | undefined,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): { ce: ContinuousEffect } | undefined {
  if (!actingPlayerId) return undefined;
  if (!effectHasSoulDriveDepartureCost(effect)) return undefined;

  for (const ce of getCEsForTarget(state, actingPlayerId)) {
    if (ce.modifierTag !== "effect_source_prevention_immunity") continue;
    const metadata = ce.metadata as
      | {
          soulDriveDeparture?: boolean;
          appliesTo?: readonly ("prevention" | "stack_negate")[];
          usageLimit?: EffectUsageLimit;
        }
      | undefined;
    if (metadata?.soulDriveDeparture !== true) continue;
    const applies = metadata?.appliesTo ?? ["prevention"];
    if (!applies.includes("prevention")) continue;
    if (
      metadata.usageLimit &&
      !canUseEffectByUsageLimit({
        sourceEffect: getCardDefinitionById?.(ce.sourceDefinitionId)?.effects?.[
          ce.provenance?.effectIndex ?? -1
        ],
        state,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        getCardDefinitionById,
        effectLabel: "grant_effect_source_prevention_immunity",
        usageLimit: metadata.usageLimit,
      })
    ) {
      continue;
    }
    return { ce };
  }
  return undefined;
}

function isStackEffectSourceRestricted(
  state: GameState,
  sourceInstanceId: string | null | undefined,
  playerId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  descriptor?: SuppressionEffectDescriptor
): boolean {
  if (!sourceInstanceId || !getCardDefinitionById) return false;
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return false;
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);

  // P3-148: 創界神/導界者・創界石ネクサスは、対象選択系アクション（destroy/bp_modify 等）
  // と同じ matchesCardFilter の既定除外（targetsGrandwalker/targetsGrandstone 省略時 false）を
  // restrict_stack の effect_source 判定にも適用する（08d_grandwalker-nexus.md「フィールドでは
  // 『創界神ネクサス』を対象にした効果しか受けない」は capability restriction にも及ぶ、
  // needs-ruling.jsonl 62行目 2026-08-05 確定裁定）。opt-in filter を持たない無条件
  // restrict_stack はここで既定除外され、以降の CE 走査（明記オプトインが無い限り）に
  // 到達しない。
  if (sourceDef && !matchesCardFilter(sourceCard, sourceDef, {}, { state })) {
    return false;
  }

  return getCEsForTarget(state, playerId).some((ce) => {
    if (ce.modifierTag !== "restrict_stack") return false;
    if (ce.metadata?.targetScope !== "effect_source") return false;
    const effectFilter = ce.metadata?.effectFilter as
      | EffectTargetFilter
      | undefined;
    if (
      effectFilter !== undefined &&
      !matchesEffectTargetFilter(effectFilter, descriptor)
    ) {
      return false;
    }
    const sourceCardFilter = ce.metadata?.sourceCardFilter as
      | CardFilter
      | undefined;
    if (
      sourceCardFilter !== undefined &&
      (!sourceDef ||
        !matchesCardFilter(sourceCard, sourceDef, sourceCardFilter, {
          soulStateIds: getEffectiveSoulStateIds(state, getCardDefinitionById),
          effectiveColors: getEffectiveColors(state, sourceCard, sourceDef),
          effectiveTribes: getEffectiveTribes(
            state,
            sourceCard,
            sourceDef,
            getCardDefinitionById
          ),
          ...getCombinedUnitCostFilterOptions(
            state,
            sourceCard,
            sourceDef,
            getCardDefinitionById
          ),
          effectiveSymbolCount:
            sourceCard.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  sourceCard,
                  sourceDef,
                  getCardDefinitionById
                )
              : undefined,
          effectiveLevel:
            sourceCard.zone === "field"
              ? getEffectiveLevel(
                  state,
                  sourceCard,
                  sourceDef,
                  getCardDefinitionById
                )
              : undefined,
          effectiveBp:
            sourceCard.zone === "field"
              ? getCombinedUnitBp(
                  state,
                  sourceCard,
                  sourceDef,
                  getCardDefinitionById
                )
              : undefined,
          state,
        }))
    ) {
      return false;
    }

    const restrictSourceCard = getCardById(state, ce.sourceInstanceId);
    const restrictSourceDef = getCardDefinitionById(ce.sourceDefinitionId);
    const immunityDecision = resolveCardImmunityAffect(
      state,
      sourceCard,
      ce.actingPlayerId,
      "none",
      {
        instance: restrictSourceCard,
        ...(restrictSourceDef ? { definition: restrictSourceDef } : {}),
      }
    );
    return immunityDecision.kind !== "blocked";
  });
}

/**
 * 指定カードが、指定プレイヤーにとって stack 応答元として抑止されているか。
 * BSDB01-M02「このカード/スピリットは相手のスタックタイミング元にならない」。
 */
export function isStackSourceSuppressedForPlayer(
  state: GameState,
  sourceInstanceId: string | null | undefined,
  playerId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  stackSource?: ActiveStack | null,
  evaluateCondition?: (
    state: GameState,
    condition: import("../model").ConditionClause[],
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean
): boolean {
  if (!sourceInstanceId) return false;
  const ceSuppresses = getCEsForTarget(state, sourceInstanceId).some((ce) => {
    if (ce.modifierTag !== "suppress_stack_source") return false;
    if (ce.metadata?.suppressedPlayerId !== playerId) return false;
    const effectFilter = ce.metadata?.effectFilter as
      | EffectTargetFilter
      | undefined;
    return (
      effectFilter === undefined ||
      matchesEffectTargetFilter(
        effectFilter,
        stackSource?.suppressionEffectDescriptor
      )
    );
  });
  if (ceSuppresses) return true;

  if (!getCardDefinitionById) return false;
  const source = getCardById(state, sourceInstanceId);
  if (!source) return false;
  const sourceDef = getCardDefinitionById(source.definitionId);
  if (!sourceDef) return false;

  return (
    sourceDef.effects?.some((effect) => {
      if (effect.stub || effect.timing.kind !== "continuous") return false;
      if (
        !isTimingScopeActive(
          effect.timingScope,
          state.step,
          state.activePlayerId,
          source.controllerPlayerId
        )
      ) {
        return false;
      }
      if (
        effect.condition &&
        effect.condition.length > 0 &&
        (evaluateCondition === undefined ||
          !evaluateCondition(
            state,
            effect.condition,
            source.instanceId,
            source.controllerPlayerId,
            getCardDefinitionById
          ))
      ) {
        return false;
      }
      if (
        !evaluateEffectApplicabilityForCard({
          state,
          applicability: { zone: "field", ...effect.applicability },
          card: source,
          definition: sourceDef,
          getCardDefinitionById,
          getCurrentLevel: getEffectiveLevel,
        })
      )
        return false;
      return effect.steps.some((step) => {
        if (step.stepCondition) return false;
        const action = step.action;
        if (action.kind !== "suppress_stack_source") return false;
        if (action.target !== "self") return false;
        if (
          action.effectFilter !== undefined &&
          !matchesEffectTargetFilter(
            action.effectFilter,
            stackSource?.suppressionEffectDescriptor
          )
        ) {
          return false;
        }
        const suppressedPlayerId = resolveEffectPlayerForSource(
          state,
          source.controllerPlayerId,
          action.player
        );
        return suppressedPlayerId === playerId;
      });
    }) ?? false
  );
}

function resolveEffectPlayerForSource(
  state: GameState,
  sourceControllerPlayerId: string,
  player: "self" | "opponent" | "either"
): string | null {
  if (player === "self") return sourceControllerPlayerId;
  if (player === "opponent") {
    return (
      state.players.find(
        (candidate) => candidate.id !== sourceControllerPlayerId
      )?.id ?? null
    );
  }
  return null;
}

export function getResponseStackSourceInstanceId(
  windowState: { pendingStackAction: ActiveStack | null },
  fallbackSourceInstanceId?: string | null
): string | null | undefined {
  return (
    windowState.pendingStackAction?.cardInstanceId ?? fallbackSourceInstanceId
  );
}

export function getOpenStackResponseSourceInstanceId(
  state: GameState
): string | null | undefined {
  if (state.stackWindow) {
    return getResponseStackSourceInstanceId(state.stackWindow);
  }
  if (state.preDeclarationStackWindow) {
    return getResponseStackSourceInstanceId(
      state.preDeclarationStackWindow,
      state.preDeclarationStackWindow.sourceInstanceId
    );
  }
  const battleFlashWindow = state.activeAttack?.flashWindowState;
  if (battleFlashWindow?.pendingStackAction) {
    return getResponseStackSourceInstanceId(battleFlashWindow);
  }
  return undefined;
}

function getOpenStackResponseSourceStack(state: GameState): ActiveStack | null {
  if (state.stackWindow?.pendingStackAction) {
    return state.stackWindow.pendingStackAction;
  }
  if (state.preDeclarationStackWindow?.pendingStackAction) {
    return state.preDeclarationStackWindow.pendingStackAction;
  }
  const battleFlashWindow = state.activeAttack?.flashWindowState;
  return battleFlashWindow?.pendingStackAction ?? null;
}

export function isOpenStackResponseSuppressedForPlayer(
  state: GameState,
  playerId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  evaluateCondition?: (
    state: GameState,
    condition: import("../model").ConditionClause[],
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean
): boolean {
  return isStackSourceSuppressedForPlayer(
    state,
    getOpenStackResponseSourceInstanceId(state),
    playerId,
    getCardDefinitionById,
    getOpenStackResponseSourceStack(state),
    evaluateCondition
  );
}

/**
 * `getCurrentMagicActionTimings` が返す生タイミング配列から、
 * restrict_flash / restrict_stack CE によってブロックされるタイミングを除去する。
 */
export function filterRestrictedTimings(
  timings: Array<"main" | "flash" | "stack">,
  state: GameState,
  playerId: string,
  stackSourceInstanceId?: string | null,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  stackSource?: ActiveStack | null,
  sourceZone?: Zone,
  candidateSourceInstanceId?: string | null,
  candidateSuppressionEffectDescriptor?: SuppressionEffectDescriptor,
  evaluateCondition?: (
    state: GameState,
    condition: import("../model").ConditionClause[],
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean
): Array<"main" | "flash" | "stack"> {
  if (timings.length === 0) return timings;
  return timings.filter((t) => {
    const isLabeledEffect =
      candidateSuppressionEffectDescriptor?.activationLabel !== "none";
    if (
      isLabeledEffect &&
      t === "flash" &&
      isFlashRestricted(state, playerId, sourceZone)
    )
      return false;
    if (isLabeledEffect && t === "stack" && isStackRestricted(state, playerId))
      return false;
    if (
      isLabeledEffect &&
      t === "stack" &&
      isStackEffectSourceRestricted(
        state,
        candidateSourceInstanceId,
        playerId,
        getCardDefinitionById,
        candidateSuppressionEffectDescriptor
      )
    ) {
      return false;
    }
    if (
      t === "stack" &&
      isStackSourceSuppressedForPlayer(
        state,
        stackSourceInstanceId,
        playerId,
        getCardDefinitionById,
        stackSource,
        evaluateCondition
      )
    ) {
      return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════
// allow_simultaneous_attack CE 消費 — 複数体同時アタック許可 (P2-05)
// ════════════════════════════════════════════════════════════════

/**
 * 同時アタック許可の内容。`allow_simultaneous_attack` CE の metadata を型付きで返す。
 * blockerCapacity は Phase 2（複数ブロック）で消費する。
 */
export interface SimultaneousAttackGrant {
  /** 同時アタックに参加できるカードの条件。 */
  filter: CardFilter;
  /** 最大同時アタック数（印字値）。 */
  maxCount: number;
  /** 相手のブロック数上限。1 = 公式デフォルト (Q26724)、"participant_count" = 同時アタック数 (qa-022)。 */
  blockerCapacity: number | "participant_count";
  /** 許可を発揮しているカード。 */
  sourceInstanceId: string;
}

/**
 * playerId に有効な同時アタック許可 CE を返す。無ければ null。
 * 複数の許可が重複する場合は maxCount が最大のものを採用する。
 * timingScope（『自分のアタックステップ』等）は getCEsForTarget が解決する。
 */
/**
 * 「ターンの最初のバトル終了時、アタックステップは終了する」CE
 * (force_attack_step_end_after_first_battle) が playerId に有効か (P2-05 Phase 4b)。
 * timingScope（『自分のアタックステップ』等）は getCEsForTarget が解決する。
 */
export function hasForceAttackStepEndAfterFirstBattle(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "force_attack_step_end_after_first_battle"
  );
}

export function getSimultaneousAttackGrant(
  state: GameState,
  playerId: string
): SimultaneousAttackGrant | null {
  let best: SimultaneousAttackGrant | null = null;
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "allow_simultaneous_attack" || !ce.metadata) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    const maxCount = ce.metadata.maxCount as number | undefined;
    if (!filter || maxCount === undefined || maxCount < 2) continue;
    if (best === null || maxCount > best.maxCount) {
      best = {
        filter,
        maxCount,
        blockerCapacity:
          (ce.metadata.blockerCapacity as
            | number
            | "participant_count"
            | undefined) ?? 1,
        sourceInstanceId: ce.sourceInstanceId,
      };
    }
  }
  return best;
}

// ════════════════════════════════════════════════════════════════
// require_multi_block CE 消費 — 複数体ブロック強制 (P2-05 Phase 5, BSFT01-TR06(B))
// ════════════════════════════════════════════════════════════════

/**
 * 複数体ブロック強制の内容。`require_multi_block` CE の metadata を型付きで返す。
 */
export interface RequiredMultiBlockGrant {
  /** この付与の対象になるアタッカーの条件。 */
  filter: CardFilter;
  /** ブロックに必要な最小ブロッカー数（印字値。2以上）。 */
  requiredBlockerCount: number;
  /** 許可を発揮しているカード。 */
  sourceInstanceId: string;
}

/**
 * playerId (攻撃側) に有効な複数体ブロック強制 CE を返す。無ければ null。
 * 複数の許可が重複する場合は requiredBlockerCount が最大のものを採用する。
 */
export function getRequiredMultiBlockGrant(
  state: GameState,
  playerId: string
): RequiredMultiBlockGrant | null {
  let best: RequiredMultiBlockGrant | null = null;
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "require_multi_block" || !ce.metadata) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    const requiredBlockerCount = ce.metadata.requiredBlockerCount as
      | number
      | undefined;
    if (
      !filter ||
      requiredBlockerCount === undefined ||
      requiredBlockerCount < 2
    ) {
      continue;
    }
    if (best === null || requiredBlockerCount > best.requiredBlockerCount) {
      best = {
        filter,
        requiredBlockerCount,
        sourceInstanceId: ce.sourceInstanceId,
      };
    }
  }
  return best;
}

// ════════════════════════════════════════════════════════════════
// allow_mid_battle_join CE 消費 — 召喚した個体の途中合流許可 (P2-05 Phase 5)
// ════════════════════════════════════════════════════════════════

/** 途中合流許可の内容。`allow_mid_battle_join` CE の metadata を型付きで返す。 */
export interface MidBattleJoinGrant {
  /** 合流できるカードの条件。 */
  filter: CardFilter;
  /** 許可を発揮しているカード。 */
  sourceInstanceId: string;
}

/**
 * playerId に有効な途中合流許可 CE を返す。無ければ null。
 * timingScope（『自分のアタックステップ』等）は getCEsForTarget が解決する。
 */
export function getMidBattleJoinGrant(
  state: GameState,
  playerId: string
): MidBattleJoinGrant | null {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "allow_mid_battle_join" || !ce.metadata) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter) continue;
    return { filter, sourceInstanceId: ce.sourceInstanceId };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// allow_ignore_summon_condition CE 消費 — 召喚条件無視許可
// (BSAZ02-C11【アルティメット合体中】)
// ════════════════════════════════════════════════════════════════

/**
 * playerId に、`def` を召喚するとき summonCondition の判定をバイパスする許可 CE が
 * 有効かを判定する（`allow_ignore_summon_condition` CE の metadata.filter に `def` が
 * 一致するもの）。定義のみの静的照合（手札のカードは act_as_spirit 等の実効値を持たない
 * ため matchesCardFilterByDef で十分、getMidBattleJoinGrant と同じ消費パターン）。
 */
export function hasIgnoreSummonConditionGrant(
  state: GameState,
  playerId: string,
  def: CardDefinition
): boolean {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "allow_ignore_summon_condition" || !ce.metadata) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter) continue;
    if (matchesCardFilterByDef(def, filter)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// immune_to_game_loss CE 消費 — ゲーム敗北免除 (BSTH05.5-XX01【神域】)
// ════════════════════════════════════════════════════════════════

/**
 * playerId が、`immune_to_game_loss` CE によりゲームに敗北しない状態かを判定する。
 * ライフ0敗北判定 (applyLifeZeroDefeat, core-system.ts) とデッキ0敗北判定
 * (turn-system.ts 2箇所) の両方から共通で参照する SSOT。
 */
export { isPlayerImmuneToGameLoss } from "../core/core-system";

// ════════════════════════════════════════════════════════════════
// grant_declared_summon_alt_cost CE 消費 — 発揮元疲労で選べる代替コスト
// (BSAZ02-C08【月面基地】)
// ════════════════════════════════════════════════════════════════

export interface DeclaredSummonAltCostGrant {
  /** 疲労させることでこの代替コストを得る、CE の発揮元カード (ネクサス自身)。 */
  costGrantInstanceId: string;
  benefits: {
    ignoreSummonCondition?: boolean;
    fullReduction?: boolean;
  };
}

/**
 * playerId に、`def` を召喚するとき CE の発揮元 (このネクサス自身) を疲労させることで
 * 召喚条件無視/軽減シンボル全充足を選べる許可 CE を検索する
 * (`grant_declared_summon_alt_cost` CE の metadata.filter に `def` が一致するもの)。
 * hasIgnoreSummonConditionGrant と異なり、この許可は「発揮元を疲労させる」という
 * per-summon 任意コストで初めて有効になるため、発揮元が場に在り、かつ現在疲労可能
 * (`exhaustState:"recovered"`) なものだけを返す (既に疲労済み/場を離れていれば
 * この iteration では選べない＝候補から除外する)。timingScope は getCEsForTarget が
 * state.step/activePlayerId で自動フィルタする (hasIgnoreSummonConditionGrant と同じ
 * getCEsForTarget 経由の規約)。
 */
export function getDeclaredSummonAltCostGrant(
  state: GameState,
  playerId: string,
  def: CardDefinition
): DeclaredSummonAltCostGrant | null {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "grant_declared_summon_alt_cost" || !ce.metadata) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter || !matchesCardFilterByDef(def, filter)) continue;
    const grantSourceCard = getCardById(state, ce.sourceInstanceId);
    if (
      !grantSourceCard ||
      grantSourceCard.zone !== "field" ||
      grantSourceCard.exhaustState !== "recovered"
    ) {
      continue;
    }
    const benefits =
      (ce.metadata.benefits as
        | { ignoreSummonCondition?: boolean; fullReduction?: boolean }
        | undefined) ?? {};
    return { costGrantInstanceId: ce.sourceInstanceId, benefits };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// grant_summon_trash_core_placement CE 消費 — 召喚時トラッシュコア配置許可
// (BSLH01-T13「メルティライズ」)
// ════════════════════════════════════════════════════════════════

export interface SummonTrashCorePlacementGrant {
  /** トラッシュから置ける通常コアの上限数。 */
  amount: number;
}

/**
 * playerId に、`def` を召喚するとき維持コアをトラッシュからも(<ソウルコア>以外)
 * `amount` 個まで置ける許可 CE を検索する（`grant_summon_trash_core_placement` CE の
 * metadata.filter に `def` が一致するもの）。定義のみの静的照合
 * (hasIgnoreSummonConditionGrant と同じ消費パターン)。
 *
 * 消費側は playSummonAsAction/useSummonInStackContextAsAction
 * (play-card-system.ts) が、通常の手札召喚専用に構築する
 * `EnterFieldCorePlacementPolicy.allowedTrashNormalCoreCount` へこの amount を合流させる。
 * pendingMultiPlacement 経由 (BSSL01-X01/C06 の複数体同時召喚) には影響しない
 * (別 policy 構築経路、trashCoreMax 系フィールドで独立管理)。
 */
export function getSummonTrashCorePlacementGrant(
  state: GameState,
  playerId: string,
  def: CardDefinition
): SummonTrashCorePlacementGrant | null {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (
      ce.modifierTag !== "grant_summon_trash_core_placement" ||
      !ce.metadata
    ) {
      continue;
    }
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter || !matchesCardFilterByDef(def, filter)) continue;
    const amount = (ce.metadata.amount as number | undefined) ?? 0;
    if (amount <= 0) continue;
    return { amount };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// grant_flash_consecutive_use CE 消費 — フラッシュ優先権ループの連続使用回数拡張
// (BSLH01-T15「カラミティクロウ」、ENGINE-flash-priority-consecutive-use-grant)
// ════════════════════════════════════════════════════════════════

/**
 * playerId が能動フラッシュ使用を連続して行える回数上限を返す。
 * `grant_flash_consecutive_use` CE が無ければ既定の 1（= 10_rules/02
 * フラッシュ優先権ループ節の既定挙動、1 回使用ごとに相手へ優先権移譲）。
 * 複数 CE が重なる場合は最大値を採用する。
 *
 * 消費側は battle-actions.ts usePassBattleFlashAsAction の能動使用カスケード解決分岐
 * (BattleFlashWindowState.consecutiveActiveUseCount と比較)。
 */
export function getFlashConsecutiveUseLimitGrant(
  state: GameState,
  playerId: string
): number {
  let limit = 1;
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "grant_flash_consecutive_use" || !ce.metadata) {
      continue;
    }
    const ceLimit = ce.metadata.limit as number | undefined;
    if (ceLimit !== undefined && ceLimit > limit) limit = ceLimit;
  }
  return limit;
}

/**
 * 「待機状態を含まない自分の同名スピリットはフィールドに1体しか存在できない」
 * フィールド唯一性制限（`field_name_uniqueness` CE）により、`def` のスピリットを
 * `playerId` が新規召喚できない状態かを判定する（BSSG01 シンフォギア等）。
 *
 * CE は発揮元（自分）に紐付き（targetInstanceId = controllerPlayerId）、
 * `metadata.restrictedNames` に制限対象カード名を持つ。判定:
 *
 * 1. `playerId` 向けの `field_name_uniqueness` CE のうち、`def` が制限対象
 *    （`metadata.restrictedNames` にカード名を含む、または `metadata.restrictFilter`
 *    の系統 AND 等にマッチ）になるものを探す。1 つも無ければ制限なし（false）。
 * 2. 制限がある場合、その CE の実効上限（`metadata.maxCount` 省略時 1。
 *    `metadata.boostCondition` を満たすとき `metadata.boostedMaxCount` に引き上げ）と、
 *    `playerId` が支配する**離脱 pending でない**（待機状態でない）該当フィールド
 *    スピリット数を比べ、既に上限数いれば召喚不可（true）。
 *
 * 待機状態（`pendingLeaveKind !== null`）の既存個体はカウントから除外する
 * （場唯一性バイパス。`10_rules/04_state-based-rules.md`
 * 「待機状態中の場唯一性バイパス」[[project_pending_leave_uniqueness_bypass]]）。
 *
 * `evaluateCondition` は循環依存回避のため呼び出し側（legal-actions-availability）から
 * 注入する。未注入のときは boost 条件を評価できないため基本上限のみで判定する。
 */
export function isBlockedByFieldNameUniqueness(
  state: GameState,
  playerId: string,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  evaluateCondition?: (
    state: GameState,
    condition: import("../model").ConditionClause[],
    sourceInstanceId: string,
    actingPlayerId: string,
    getCardDefinitionById: (id: string) => CardDefinition | undefined
  ) => boolean
): boolean {
  const candidateName = def.name;
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "field_name_uniqueness" || !ce.metadata) continue;
    const names = ce.metadata.restrictedNames as string[] | undefined;
    const filter = ce.metadata.restrictFilter as CardFilter | undefined;
    // 召喚しようとしているカードがこの CE の制限対象か（名前 or フィルタ）。
    // 名前配列は各名が独立した唯一性プール（X03型「暁 切歌」/「月読 調」は別枠）。
    const nameRestricted = names !== undefined && names.includes(candidateName);
    const filterRestricted =
      filter !== undefined && matchesCardFilterByDef(def, filter);
    if (!nameRestricted && !filterRestricted) continue;

    // 実効上限を求める（boost 条件を満たせば引き上げ）。
    let max = (ce.metadata.maxCount as number | undefined) ?? 1;
    const boostCondition = ce.metadata.boostCondition as
      | import("../model").ConditionClause[]
      | undefined;
    const boostedMaxCount = ce.metadata.boostedMaxCount as number | undefined;
    if (
      boostCondition !== undefined &&
      boostedMaxCount !== undefined &&
      evaluateCondition !== undefined &&
      evaluateCondition(
        state,
        boostCondition,
        ce.sourceInstanceId,
        playerId,
        getCardDefinitionById
      )
    ) {
      max = boostedMaxCount;
    }

    // 静的（待機状態でない）該当スピリット数を数える。
    // 名前ベースは候補と同名のプールのみ、フィルタベースはフィルタ一致集合を数える。
    let count = 0;
    for (const card of state.cardInstances) {
      if (card.zone !== "field") continue;
      if (card.controllerPlayerId !== playerId) continue;
      if (card.pendingLeaveKind !== null) continue;
      const cardDef = getCardDefinitionById(card.definitionId);
      if (!cardDef) continue;
      const matches =
        (nameRestricted && cardDef.name === candidateName) ||
        (filterRestricted &&
          matchesCardReferenceFilter(card, cardDef, filter!, {
            state,
            effectiveColors: getEffectiveColors(state, card, cardDef),
            effectiveBp: getCombinedUnitBp(
              state,
              card,
              cardDef,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, card.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              card,
              cardDef,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              card,
              cardDef,
              getCardDefinitionById
            ),
          }));
      if (matches) count++;
    }
    if (count >= max) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// restrict_manifest CE 消費 — 効果発揮制限
// ════════════════════════════════════════════════════════════════

/**
 * プレイヤーのカードが効果を発揮することを restrict_manifest CE により
 * 制限されているか判定する。
 *
 * restrict_manifest CE は targetInstanceId = playerId でプレイヤーに紐付き、
 * metadata.filter でカード群を、metadata.effectFilter で効果種別を限定する。
 * effectFilter が未設定の場合はカードの全効果が発揮不可。
 */
export function isCardManifestRestricted(
  state: GameState,
  playerId: string,
  card: CardInstance,
  def: CardDefinition,
  /** field カードに対し effective-* 注入が必要なときに渡す (effectiveSymbolCount 等)。 */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  effectDescriptor?: SuppressionEffectDescriptor
): boolean {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "restrict_manifest" || !ce.metadata) continue;
    const filter = ce.metadata.filter as CardFilter | undefined;
    if (!filter) continue;
    const opts =
      card.zone === "field" && getCardDefinitionById
        ? {
            state,
            effectiveColors: getEffectiveColors(state, card, def),
            effectiveBp: getCombinedUnitBp(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, card.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              card,
              def,
              getCardDefinitionById
            ),
          }
        : undefined;
    if (!matchesCardFilter(card, def, filter, opts)) continue;
    const effectFilter = ce.metadata.effectFilter as
      | EffectTargetFilter
      | undefined;
    if (
      effectFilter &&
      !matchesEffectTargetFilter(effectFilter, effectDescriptor)
    )
      continue;
    return true;
  }
  return false;
}
