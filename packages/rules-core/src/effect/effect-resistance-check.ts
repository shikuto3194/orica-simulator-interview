/**
 * 効果耐性 (cannot_*) consumer。
 *
 * 効果耐性 CE (modifierTag: "cannot_be_destroyed" 等) を読み取り、
 * 離脱系アクション (executeDestroy/Bounce/Vanish/SendToDeck/RemoveFromGame) で
 * 「相手の効果による離脱を阻止すべきか」を判定する。
 *
 * source 判定:
 *   - "opponent_effect": actingPlayerId !== card.controllerPlayerId のときのみ阻止
 *   - "opponent": 直接効果では "opponent_effect" と同じ。battle を含む差は pendingLeave consumer 側で扱う
 *   - "all": 常に阻止
 * source は CE.metadata.source に格納されている (executeEffectResistance 参照)。
 *
 * P3-43: 攻撃側効果が `unpreventable` (「防げない」) のとき、
 * `cannot_*` 効果耐性は貫通される (公式裁定: 「『防げない』破壊効果は、
 * 相手の『装甲』を含む効果・『効果を受けない』・『破壊されない』・
 * 『手札/デッキに戻らない』・コア除去対策などを無視する」)。
 * `sourcePreventionLevel === "unpreventable"` のとき check 全体を bypass する。
 */
import type { DSL } from "../dsl-types";
import type {
  CardColor,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  EffectActivationTiming,
  EffectPreventionLevel,
  GameState,
  SymbolColor,
  Zone,
} from "../model";
import { isCardTextCardState, isGrandwalkerOrGuidedNexus } from "../model";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbols,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
  getEffectiveLevelWithLocalOverridesOnly,
} from "../battle/battle-shared";
import { getCardById } from "../card/card-lookup";
import { getExtendedFieldSymbolSourceCards } from "../card/field-symbol-source-extension";
import { getCEsForTarget, getGlobalCEs } from "../card/ce-lookup";
import {
  cardHasBurstEffect,
  matchesCardName,
  matchesCardFilter,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  buildEffectSourceIdentity,
  canEffectPenetrateDefense,
  comparePreventionLevel,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
  getEffectiveTribes,
  getOverriddenProperties,
  getCardDefinitionForEffectiveFieldCard,
  cardFilterNeedsEffectiveBp,
  cardFilterNeedsEffectiveLevel,
  cardFilterNeedsEffectiveSymbolCount,
  type EffectivePropertyEvaluationOptions,
} from "../legal/legal-actions-shared";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import {
  isCombinedBrave,
  isEffectivelyCombined,
} from "../mechanics/virtual-combine";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import { getCardsByZone } from "../zone/zone-partition";
import {
  doesEffectResistanceSourceApplyToController,
  doesBypassFilterApply,
  type EffectSourceIdentity,
  type EffectResistanceSourceScope,
  type TargetLockBypassProfile,
} from "./target-affect-gate";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import { effectResistanceTagForOutcome } from "./effect-resistance-tags";

export interface EffectResistanceFilterOptions {
  readonly includeGlobalOverrideProperties?: boolean;
}

export interface EffectResistanceEvaluationOptions {
  readonly filterOptions?: EffectResistanceFilterOptions;
  readonly sourceIdentityOptions?: EffectivePropertyEvaluationOptions;
  /** 実際に防いだ耐性の根拠。候補列挙では状態を変更しない。 */
  readonly onBlockingEffect?: (effect: ContinuousEffect) => void;
}

function cardEffectRelationPlayerId(card: CardInstance): string {
  // Field cards are controlled; private/non-field zones are owned. Keep this
  // aligned with CardFilter cards_in_zone counting semantics.
  return card.zone === "field" ? card.controllerPlayerId : card.ownerPlayerId;
}

/**
 * `holderOwnerId` から見た相手フィールドの全カードの実効シンボル色の和集合を返す。
 * `immunitySourceScope.colorsFromOpponentFieldSymbols` (BSTH05.5-M01) 用。
 * holderOwnerId 不明時は空集合 (保守的に免疫を成立させない)。
 */
function getOpponentFieldSymbolColors(
  state: GameState,
  holderOwnerId: string | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): SymbolColor[] {
  if (holderOwnerId === undefined) return [];
  const opponentId = state.players.find((p) => p.id !== holderOwnerId)?.id;
  if (opponentId === undefined) return [];
  const colors = new Set<SymbolColor>();
  const soulStateIds = getEffectiveSoulStateIds(
    state,
    getCardDefinitionById ?? (() => undefined)
  );
  const candidates = new Map(
    state.cardInstances
      .filter(
        (card) =>
          card.zone === "field" && card.controllerPlayerId === opponentId
      )
      .map((card) => [card.instanceId, card])
  );
  // 支払い対象を渡さないため、X01自身の召喚コスト限定拡張は含まない。
  for (const card of getExtendedFieldSymbolSourceCards(
    state,
    opponentId,
    getCardDefinitionById ?? (() => undefined)
  )) {
    candidates.set(card.instanceId, card);
  }
  for (const card of candidates.values()) {
    const def = getCardDefinitionById?.(card.definitionId);
    if (
      card.zone === "field" &&
      (isCombinedBrave(state, card, def) ||
        isCardTextCardState(card, state) ||
        soulStateIds.has(card.instanceId))
    )
      continue;
    for (const c of getCombinedUnitSymbols(
      state,
      card,
      def,
      getCardDefinitionById
    )) {
      colors.add(c);
    }
  }
  return [...colors];
}

/**
 * 離脱系アクションの種別。`executeDestroy` 等から渡される。
 * `cannot_leave_field` はすべての outcome に該当する包括的タグ。
 */
export type LeaveOutcome =
  | "destroy"
  | "bounce"
  | "send_to_deck"
  | "vanish"
  | "remove_from_game";

/**
 * 当該 outcome を阻止する CE タグ集合。
 * `cannot_leave_field` は全 outcome を阻止する包括的タグ。
 *
 * P3-74: `pierceCannotLeaveField=true` のとき `cannot_leave_field` のみ集合から外す。
 * `suppressDestroyedEffects` を伴う離脱効果 (レミリア BSTH01-X03 等) は Q19 裁定により
 * 「離れない」常時効果を貫通する。outcome-specific な `cannot_be_destroyed` 等は
 * Q19 で言及されないため貫通対象外 (保守的スコープ)。
 */
function getBlockingTags(
  outcome: LeaveOutcome,
  pierceCannotLeaveField: boolean
): readonly ContinuousEffectTag[] {
  const specificTag = effectResistanceTagForOutcome(outcome);
  if (pierceCannotLeaveField) {
    return [specificTag];
  }
  return [specificTag, "cannot_leave_field"];
}

/**
 * CE の source 設定 ("opponent_effect" | "opponent" | "all") を読む。
 * cannot_* CE は metadata.source に格納されている。
 */
function readCESource(ce: ContinuousEffect): EffectResistanceSourceScope {
  const meta = ce.metadata as
    | { source?: EffectResistanceSourceScope }
    | undefined;
  return meta?.source ?? "all";
}

export type ResistanceSourceCause = "effect" | "battle" | "bp_compare";

/**
 * ルール強度耐性かを読む (10_rules/07b §71 スピリット状態ブレイヴ class)。
 * true のとき `sourcePreventionLevel === "unpreventable"` (「防げない」) 効果でも
 * 当該 CE を貫通させない (effect-level の cannot_* タグとは別扱い)。
 */
function readCERuleStrength(ce: ContinuousEffect): boolean {
  const meta = ce.metadata as { ruleStrength?: boolean } | undefined;
  return meta?.ruleStrength === true;
}

function readCEExcludedCauses(
  ce: ContinuousEffect
): readonly ResistanceSourceCause[] {
  const meta = ce.metadata as
    | { excludedCauses?: ResistanceSourceCause[] }
    | undefined;
  return meta?.excludedCauses ?? [];
}

/**
 * Phase B (動的 filter) 用: グローバル CE のうち、targetFilter が card にマッチするものを
 * 抽出する。Phase A 時点では targetFilter 未設定の CE のみ存在するため空を返すが、
 * Phase B で executeEffectResistance を filter 化したときに有効化される。
 */
function getGlobalEffectResistanceCEsAffectingCard(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options: EffectResistanceFilterOptions = {}
): readonly ContinuousEffect[] {
  const result: ContinuousEffect[] = [];
  for (const ce of getGlobalCEs(state)) {
    if (!isEffectResistanceTag(ce.modifierTag)) continue;
    if (!ce.targetFilter) continue;
    if (
      matchesEffectResistanceFilter(
        state,
        ce,
        card,
        getCardDefinitionById,
        options
      )
    ) {
      result.push(ce);
    }
  }
  return result;
}

function isEffectResistanceTag(tag: ContinuousEffectTag): boolean {
  return (
    tag === "cannot_leave_field" ||
    tag === "cannot_be_destroyed" ||
    tag === "cannot_be_bounced" ||
    tag === "cannot_be_sent_to_deck" ||
    tag === "cannot_be_vanished" ||
    tag === "cannot_be_removed_from_game" ||
    tag === "cannot_be_exhausted" ||
    tag === "cannot_reduce_cores_below" ||
    tag === "cannot_be_targeted" ||
    tag === "cannot_include" ||
    tag === "cannot_be_destroyed_by_bp_compare" ||
    tag === "cannot_enter_zone"
  );
}

export function isEffectResistanceTargetLockTag(
  tag: ContinuousEffectTag
): tag is "cannot_be_targeted" | "cannot_include" {
  return tag === "cannot_be_targeted" || tag === "cannot_include";
}

/**
 * targetFilter (player + category + tribes + colors) を card にマッチさせる。
 * 既存の `matchesOverridePropertiesGlobalCE` (legal-actions-shared.ts) と同じ
 * 比較セマンティクスを採用する。
 * checkFieldExitReplacement (state-based-actions.ts) が置換効果 (replace_field_exit)
 * のクラス全体対象 (dynamic filter CE) を照合するために export する。
 */
export function matchesEffectResistanceFilter(
  state: GameState,
  ce: ContinuousEffect,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options: EffectResistanceFilterOptions = {}
): boolean {
  const filter = ce.targetFilter;
  if (!filter) return false;

  const ownerId = ce.actingPlayerId;
  const opponentId = state.players.find((p) => p.id !== ownerId)?.id;
  const expectedPlayerId =
    filter.player === "self"
      ? ownerId
      : filter.player === "opponent"
        ? opponentId
        : undefined;
  if (
    expectedPlayerId &&
    cardEffectRelationPlayerId(card) !== expectedPlayerId
  ) {
    return false;
  }

  const actualCard = getCardById(state, card.instanceId);
  // Global public resistance must survive viewer masking just like global BP.
  // Only a real face-down field card can use the shared null printed identity.
  // The supplied CardInstance may be an engine projection; its definition is
  // authoritative outside the concealed-field boundary.
  const def =
    actualCard && card.faceDown && card.zone === "field"
      ? getCardDefinitionForEffectiveFieldCard(card, getCardDefinitionById, {
          state,
          filter,
          ...options,
        })
      : getCardDefinitionById(card.definitionId);
  if (!def) return false;

  const sourceDefinition = getCardDefinitionById(ce.sourceDefinitionId);
  const { cardName, ...filterWithoutCardName } = filter;
  if (
    !matchesCardFilter(
      card,
      def,
      cardName === undefined ? filter : filterWithoutCardName,
      {
        state,
        ...(sourceDefinition ? { sourceDefinition } : {}),
        fieldCategoryContext: true,
        getCardDefinitionById,
        effectiveColors: getEffectiveColors(state, card, def),
        effectiveBp:
          card.zone === "field" && cardFilterNeedsEffectiveBp(filter)
            ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
            : undefined,
        effectiveSymbolCount:
          card.zone === "field" && cardFilterNeedsEffectiveSymbolCount(filter)
            ? getCombinedUnitSymbolCount(
                state,
                card,
                def,
                getCardDefinitionById
              )
            : undefined,
        effectiveLevel:
          card.zone === "field" && cardFilterNeedsEffectiveLevel(filter)
            ? (options.includeGlobalOverrideProperties === false
                ? getEffectiveLevelWithLocalOverridesOnly
                : getEffectiveLevel)(state, card, def, getCardDefinitionById)
            : undefined,
        effectiveTribes: getEffectiveTribes(
          state,
          card,
          def,
          getCardDefinitionById,
          options
        ),
        coreCount: getTotalCoresOnCardById(state, card.instanceId),
        cardZone: card.zone,
        ...getCombinedUnitCostFilterOptions(
          state,
          card,
          def,
          getCardDefinitionById,
          options
        ),
      }
    )
  ) {
    return false;
  }

  if (cardName !== undefined) {
    const overridden = getOverriddenProperties(
      state,
      card.instanceId,
      getCardDefinitionById,
      options.includeGlobalOverrideProperties
    );
    const names = [def.name, overridden?.cardName].filter(
      (name): name is string => typeof name === "string"
    );
    if (
      !names.some((name) => matchesCardName(name, cardName, sourceDefinition))
    ) {
      return false;
    }
  }

  return true;
}

/**
 * 当該カードに対して、当該 outcome を阻止する効果耐性 CE が存在し、
 * かつ source 条件 (opponent_effect / all) を満たすかを判定する。
 *
 * @param state ゲーム状態
 * @param card 離脱対象カード
 * @param outcome 離脱の種別 (destroy/bounce/...)
 * @param actingPlayerId 離脱を引き起こしたプレイヤー (null = state-based / system 起因)
 * @param getCardDefinitionById Phase B 動的 filter 用 (Phase A は未使用でも渡しておく)
 * @param sourcePreventionLevel 攻撃側効果の防止レベル。`"unpreventable"` のとき
 *   `cannot_*` 効果耐性を貫通する (P3-43)。省略時は `"none"` 扱い。
 * @param pierceCannotLeaveField `suppressDestroyedEffects` を伴う離脱効果 (レミリア型)
 *   の場合 true。Q19 裁定により `cannot_leave_field` 常時効果のみ貫通する
 *   (outcome-specific な `cannot_be_destroyed` 等は貫通しない)。省略時 false (P3-74)。
 */
export function isLeaveOutcomeBlockedByResistance(
  state: GameState,
  card: CardInstance,
  outcome: LeaveOutcome,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  pierceCannotLeaveField: boolean = false,
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile,
  onBlockingEffect?: (effect: ContinuousEffect) => void
): boolean {
  const blockingTags = new Set<ContinuousEffectTag>(
    getBlockingTags(outcome, pierceCannotLeaveField)
  );

  // 対象別 CE (per-target snapshot 経路) + Phase B 動的 filter CE
  const directCEs = getCEsForTarget(state, card.instanceId);
  const filterCEs = getGlobalEffectResistanceCEsAffectingCard(
    state,
    card,
    getCardDefinitionById
  );

  let blocked = false;
  for (const ce of [...directCEs, ...filterCEs]) {
    if (!blockingTags.has(ce.modifierTag)) continue;
    if (readCEExcludedCauses(ce).includes(sourceCause)) continue;
    const source = readCESource(ce);
    if (
      doesEffectResistanceSourceApplyToController(
        source,
        actingPlayerId,
        card.controllerPlayerId,
        sourceCause
      )
    ) {
      if (
        canSourceBypassResistanceCE(
          state,
          ce,
          getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        )
      ) {
        continue;
      }
      if (!onBlockingEffect) return true;
      blocked = true;
      onBlockingEffect(ce);
    }
  }

  return blocked;
}

/**
 * qa-020 (BSTH01-XX02) marker: この CE は「防げる条件が 1 つでも存在するなら
 * 自動的にそれを満たす」（＝真の blanket 以外では bypass されない）。
 * `executeEffectImmunity` が `EffectImmunityAction.satisfiesPreventionRestriction`
 * から `metadata.satisfiesPreventionRestriction` へ転写する。P3-141。
 */
function readCESatisfiesPreventionRestriction(ce: ContinuousEffect): boolean {
  const meta = ce.metadata as
    | { satisfiesPreventionRestriction?: boolean }
    | undefined;
  return meta?.satisfiesPreventionRestriction === true;
}

export function canSourceBypassResistanceCE(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  sourceIdentityOptions: EffectivePropertyEvaluationOptions = {}
): boolean {
  if (readCESatisfiesPreventionRestriction(ce)) {
    // qa-020 formula: 防げる条件（スコープ付き filter、または「相手の効果では防げない」
    // のような player-relation のみの bare unpreventable）が 1 つでも存在するなら、
    // この CE はそれを無条件に満たす（＝ bypass されない）。実際の識別子照合はしない。
    // 真の blanket（お互い/一切、条件が一切存在しない）だけが bypass する。
    return (
      sourcePreventionBypass?.kind === "all_effects" ||
      sourcePreventionBypass?.kind === "blanket_affect_immunity"
    );
  }
  // P3-43: 攻撃側 unpreventable は cannot_* 効果耐性を貫通する。
  if (sourcePreventionLevel === "unpreventable") return true;
  if (!sourcePreventionBypass) return false;
  switch (sourcePreventionBypass.kind) {
    case "none":
      return false;
    case "all_effects":
      return true;
    case "blanket_affect_immunity":
      return true;
    case "preventing_effect_filter": {
      const identity = getResistanceCESourceIdentity(
        state,
        ce,
        getCardDefinitionById,
        sourceIdentityOptions
      );
      return (
        identity !== undefined &&
        doesBypassFilterApply(identity, sourcePreventionBypass.filter)
      );
    }
    case "any_preventing_effect_filter": {
      const identity = getResistanceCESourceIdentity(
        state,
        ce,
        getCardDefinitionById,
        sourceIdentityOptions
      );
      return (
        identity !== undefined &&
        sourcePreventionBypass.filters.some((filter) =>
          doesBypassFilterApply(identity, filter)
        )
      );
    }
  }
}

function getResistanceCESourceIdentity(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): EffectSourceIdentity | undefined {
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

/**
 * 「BP比べでは破壊されない」(cannot_be_destroyed_by_bp_compare) 耐性判定。
 *
 * バトルの BP比べ (queueBattleResolutionDestroys) と効果の bp_compare_destroy の
 * 両 BP比較破壊サイトからのみ呼ぶ。両サイトとも「この破壊は BP比べによる」ことが
 * 自明なため、cause を pendingLeave に plumbing せず呼び出し側で直接判定する。
 * 通常の効果破壊・離脱 (cannot_be_destroyed 等) には一切影響しない
 * (04_state-based-rules.md §BP比べ破壊の cause 分類)。
 *
 * @param actingPlayerId BP比べ破壊を引き起こしたプレイヤー
 *   (バトルでは破壊される側の対戦相手 = 勝者、効果では効果コントローラー)。null = system。
 * @param getCardDefinitionById 動的 filter CE 照合用 (per-target snapshot のみのときは
 *   undefined 可。その場合 filter ベース CE はスキップする)。
 * @param sourcePreventionLevel 「防げない」効果は本耐性を貫通する (03c:28 / P3-43)。
 */
export function isImmuneToBpCompareDestroy(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  const directCEs = getCEsForTarget(state, card.instanceId);
  const filterCEs = getCardDefinitionById
    ? getGlobalEffectResistanceCEsAffectingCard(
        state,
        card,
        getCardDefinitionById
      )
    : [];

  for (const ce of [...directCEs, ...filterCEs]) {
    if (ce.modifierTag !== "cannot_be_destroyed_by_bp_compare") continue;
    if (
      canSourceBypassResistanceCE(
        state,
        ce,
        getCardDefinitionById ?? (() => undefined),
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    const source = readCESource(ce);
    if (source === "all") return true;
    // "opponent_effect": 破壊を引き起こしたのが対戦相手のときのみ阻止。
    if (actingPlayerId !== null && actingPlayerId !== card.controllerPlayerId) {
      return true;
    }
  }
  return false;
}

function readCECoreMinimum(
  ce: ContinuousEffect,
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const meta = ce.metadata as
    | {
        coreMinimum?: unknown;
        coreMinimumSource?: {
          kind?: unknown;
          level?: unknown;
        };
      }
    | undefined;
  if (
    typeof meta?.coreMinimum === "number" &&
    Number.isFinite(meta.coreMinimum)
  ) {
    return Math.max(0, Math.floor(meta.coreMinimum));
  }
  const source = meta?.coreMinimumSource;
  if (
    source?.kind === "own_level_required_cores" &&
    typeof source.level === "number" &&
    getCardDefinitionById
  ) {
    const def = getCardDefinitionById(card.definitionId);
    const levelDef = def?.levelDefs.find((l) => l.level === source.level);
    if (levelDef) return Math.max(0, levelDef.requiredCores);
  }
  return 0;
}

/**
 * 「コアがN個より少なくならない」効果耐性が要求する最小残存コア数。
 *
 * core_move の候補列挙/実行から呼び、対象カードの通常コア + ソウルコア合計が
 * ここで返した値を下回る移動を抑止する。`unpreventable` は cannot_* 耐性と同じく貫通。
 */
export function getCoreMinimumProtectedByResistance(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): number {
  const candidates = [
    ...getCEsForTarget(state, card.instanceId),
    ...(getCardDefinitionById
      ? getGlobalEffectResistanceCEsAffectingCard(
          state,
          card,
          getCardDefinitionById
        )
      : []),
  ];

  let minimum = 0;
  for (const ce of candidates) {
    if (ce.modifierTag !== "cannot_reduce_cores_below") continue;
    if (
      canSourceBypassResistanceCE(
        state,
        ce,
        getCardDefinitionById ?? (() => undefined),
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    const source = readCESource(ce);
    const applies = doesEffectResistanceSourceApplyToController(
      source,
      actingPlayerId,
      card.controllerPlayerId,
      "effect"
    );
    if (!applies) continue;
    minimum = Math.max(
      minimum,
      readCECoreMinimum(ce, card, getCardDefinitionById)
    );
  }
  return minimum;
}

export interface PaidPreventionImmunityOffer {
  cost: DSL.GrantPaidPreventionImmunityAction["cost"];
  scope?: { effectIndex: number };
  effectId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceEffectIndex?: number;
  sourceStepIndex?: number;
}

/**
 * host (card) が `grant_paid_prevention_immunity` CE による「効果発揮時、
 * 対価を支払うことでその効果は相手の効果で防げなくなる」権利を持つ場合、
 * cost と effect source を返す。持たない場合は null。
 *
 * count cost の BSGE01-R04 型は、宣言 variant ではなく stack 窓後・対象選択前の
 * `PendingStepChoice` で消費する。`resource:"card"` の BSKB01-X01 型は既存の
 * 宣言時 card-cost variant が consumer。
 */
export function getPaidPreventionImmunityOffer(
  state: GameState,
  hostInstanceId: string,
  effectIndex?: number
): PaidPreventionImmunityOffer | null {
  const candidates = getCEsForTarget(state, hostInstanceId);
  for (const ce of candidates) {
    if (ce.modifierTag !== "paid_prevention_immunity_offer") continue;
    const meta = ce.metadata as
      | {
          cost?: DSL.GrantPaidPreventionImmunityAction["cost"];
          scope?: { effectIndex: number };
        }
      | undefined;
    if (meta?.scope !== undefined && meta.scope.effectIndex !== effectIndex) {
      continue;
    }
    const cost = meta?.cost;
    if (!cost || typeof cost.amount !== "number") continue;
    if (cost.resource === "count") {
      return {
        cost: { resource: "count", amount: cost.amount },
        ...(meta?.scope !== undefined ? { scope: meta.scope } : {}),
        effectId: ce.effectId,
        sourceInstanceId:
          ce.provenance?.effectSourceInstanceId ?? ce.sourceInstanceId,
        sourceDefinitionId:
          ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId,
        ...(ce.provenance?.effectIndex !== undefined
          ? { sourceEffectIndex: ce.provenance.effectIndex }
          : {}),
        ...(ce.provenance?.stepIndex !== undefined
          ? { sourceStepIndex: ce.provenance.stepIndex }
          : {}),
      };
    }
    if (cost.resource === "card" && cost.zone) {
      const cardCost = {
        resource: "card" as const,
        amount: cost.amount,
        zone: cost.zone,
        ...(cost.filter ? { filter: cost.filter } : {}),
      };
      return {
        cost: cardCost,
        ...(meta?.scope !== undefined ? { scope: meta.scope } : {}),
        effectId: ce.effectId,
        sourceInstanceId:
          ce.provenance?.effectSourceInstanceId ?? ce.sourceInstanceId,
        sourceDefinitionId:
          ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId,
        ...(ce.provenance?.effectIndex !== undefined
          ? { sourceEffectIndex: ce.provenance.effectIndex }
          : {}),
        ...(ce.provenance?.stepIndex !== undefined
          ? { sourceStepIndex: ce.provenance.stepIndex }
          : {}),
      };
    }
  }
  return null;
}

export function getPaidPreventionImmunityCost(
  state: GameState,
  hostInstanceId: string,
  effectIndex?: number
): DSL.GrantPaidPreventionImmunityAction["cost"] | null {
  return (
    getPaidPreventionImmunityOffer(state, hostInstanceId, effectIndex)?.cost ??
    null
  );
}

/**
 * ENGINE-paid-prevention-immunity-card-cost Step2: `getPaidPreventionImmunityCost`
 * が `resource: "card"` variant を返したとき、`playerId` が実際にその対価を
 * 支払えるか (= `cost.zone` に `cost.filter` へ一致するカードが `cost.amount` 枚
 * 以上あるか) を判定するための候補カード一覧を返す。
 *
 * legal-actions-availability.ts の afford 判定 (候補数 >= amount) と、将来の
 * legal-actions-apply.ts の支払い実行 (候補から amount 枚を選んで
 * removed_from_game へ、候補数 > amount のときは player 選択が必要) の両方で
 * この候補集合を SSOT として使う想定 (Step3 未配線)。
 */
export function getPaidPreventionImmunityCardCostCandidates(
  state: GameState,
  playerId: string,
  cost: Extract<
    DSL.GrantPaidPreventionImmunityAction["cost"],
    { resource: "card" }
  >,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardInstance[] {
  return getCardsByZone(state, cost.zone).filter((candidate) => {
    if (candidate.ownerPlayerId !== playerId) return false;
    if (!cost.filter) return true;
    const def = getCardDefinitionById(candidate.definitionId);
    if (!def) return false;
    return matchesCardFilter(candidate, def, cost.filter, {
      state,
      effectiveTribes: getEffectiveTribes(
        state,
        candidate,
        def,
        getCardDefinitionById
      ),
    });
  });
}

export interface PaidLeaveSuppressionImmunityOffer {
  cost: { resource: "count"; amount: number };
  effectId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceEffectIndex?: number;
  sourceStepIndex?: number;
}

export function getPaidLeaveSuppressionImmunityOffer(
  state: GameState,
  hostInstanceId: string
): PaidLeaveSuppressionImmunityOffer | null {
  const candidates = getCEsForTarget(state, hostInstanceId);
  for (const ce of candidates) {
    if (ce.modifierTag !== "paid_leave_suppression_immunity_offer") continue;
    const meta = ce.metadata as
      | { cost?: { resource?: unknown; amount?: unknown } }
      | undefined;
    const amount = meta?.cost?.amount;
    if (meta?.cost?.resource === "count" && typeof amount === "number") {
      return {
        cost: { resource: "count", amount },
        effectId: ce.effectId,
        sourceInstanceId:
          ce.provenance?.effectSourceInstanceId ?? ce.sourceInstanceId,
        sourceDefinitionId:
          ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId,
        ...(ce.provenance?.effectIndex !== undefined
          ? { sourceEffectIndex: ce.provenance.effectIndex }
          : {}),
        ...(ce.provenance?.stepIndex !== undefined
          ? { sourceStepIndex: ce.provenance.stepIndex }
          : {}),
      };
    }
  }
  return null;
}

export function getPaidLeaveSuppressionImmunityCost(
  state: GameState,
  hostInstanceId: string
): { resource: "count"; amount: number } | null {
  return (
    getPaidLeaveSuppressionImmunityOffer(state, hostInstanceId)?.cost ?? null
  );
}

/**
 * `cards` から「effect_resistance で阻止されるカード」を除外して返す。
 * destroy / bounce / vanish / send_to_deck / remove_from_game の各 executor から呼ぶ。
 *
 * @param sourcePreventionLevel 攻撃側効果の防止レベル。`"unpreventable"` のとき
 *   `cannot_*` 効果耐性を貫通し、全カードが `allowed` に入る (P3-43)。
 * @param pierceCannotLeaveField `suppressDestroyedEffects` を伴う離脱効果のとき true。
 *   `cannot_leave_field` 常時効果のみ貫通する (Q19 / P3-74)。省略時 false。
 */
export function filterOutResistantCards<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  outcome: LeaveOutcome,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  pierceCannotLeaveField: boolean = false,
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile
): { allowed: T[]; blocked: T[] } {
  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const c of cards) {
    if (
      isLeaveOutcomeBlockedByResistance(
        state,
        c,
        outcome,
        actingPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        pierceCannotLeaveField,
        sourceCause,
        sourcePreventionBypass
      )
    ) {
      blocked.push(c);
    } else {
      allowed.push(c);
    }
  }
  return { allowed, blocked };
}

export function isExhaustBlockedByResistance(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  const candidates = [
    ...getCEsForTarget(state, card.instanceId),
    ...getGlobalEffectResistanceCEsAffectingCard(
      state,
      card,
      getCardDefinitionById
    ),
  ];

  // P3-43: `unpreventable` (「防げない」) は effect-level の `cannot_*` 耐性を貫通する。
  // ただし rule-strength (10_rules/07b §71 スピリット状態ブレイヴ class) は「ルール由来の不可」
  // のため貫通させない。よって rule-strength CE のみは unpreventable 短絡前に評価する。
  for (const ce of candidates) {
    if (ce.modifierTag !== "cannot_be_exhausted") continue;
    if (!readCERuleStrength(ce)) continue;
    const source = readCESource(ce);
    if (source === "all") return true;
    if (actingPlayerId !== null && actingPlayerId !== card.controllerPlayerId) {
      return true;
    }
  }

  if (sourcePreventionLevel === "unpreventable") return false;

  for (const ce of candidates) {
    if (ce.modifierTag !== "cannot_be_exhausted") continue;
    if (readCERuleStrength(ce)) continue; // 上で評価済み
    const source = readCESource(ce);
    const applies =
      source === "all" ||
      (actingPlayerId !== null && actingPlayerId !== card.controllerPlayerId);
    if (!applies) continue;
    if (
      canSourceBypassResistanceCE(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    if (source === "all") return true;
    if (actingPlayerId !== null && actingPlayerId !== card.controllerPlayerId) {
      return true;
    }
  }
  return false;
}

/**
 * 当該カードを取得して resistance 判定するヘルパ (instanceId のみ既知の場面用)。
 * pendingLeave 経路など、CardInstance 全体を取得済みでない場所から使う。
 *
 * @param sourcePreventionLevel 攻撃側効果の防止レベル (P3-43)。
 * @param pierceCannotLeaveField `cannot_leave_field` 貫通 (Q19 / P3-74)。省略時 false。
 */
export function isLeaveOutcomeBlockedById(
  state: GameState,
  instanceId: string,
  outcome: LeaveOutcome,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  pierceCannotLeaveField: boolean = false
): boolean {
  const card = getCardById(state, instanceId);
  if (!card) return false;
  return isLeaveOutcomeBlockedByResistance(
    state,
    card,
    outcome,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField
  );
}

function readCEEntryZone(ce: ContinuousEffect): Zone | undefined {
  const meta = ce.metadata as { entryZone?: Zone } | undefined;
  return meta?.entryZone;
}

/**
 * `card` を `zone` へ移動させることを阻止する `cannot_enter_zone` 効果耐性 CE を判定する。
 *
 * `isLeaveOutcomeBlockedByResistance` (離脱軸: destroy/bounce/send_to_deck 等) と異なり、
 * 移動先ゾーンそのものを区別する destination-zone-scoped resistance
 * (ENGINE-set-aside-entry-restriction, BSTH08.5-X04「このカードの効果以外で手元に
 * 置けない」)。bounce(destination) や return_from_trash(destination)、deck_reveal
 * pick(destination) など、第三者ゾーン移動効果の実行前に候補から除外する consumer が使う。
 *
 * @param zone 判定対象の移動先ゾーン。CE.metadata.entryZone と一致するときのみ阻止する。
 * @param actingPlayerId 移動を引き起こしたプレイヤー (null = state-based/system 起因)。
 * @param sourcePreventionLevel 攻撃側効果の防止レベル。`"unpreventable"` のとき貫通する (P3-43)。
 */
export function isZoneEntryBlockedByResistance(
  state: GameState,
  card: CardInstance,
  zone: Zone,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  const directCEs = getCEsForTarget(state, card.instanceId);
  const filterCEs = getGlobalEffectResistanceCEsAffectingCard(
    state,
    card,
    getCardDefinitionById
  );

  for (const ce of [...directCEs, ...filterCEs]) {
    if (ce.modifierTag !== "cannot_enter_zone") continue;
    if (readCEEntryZone(ce) !== zone) continue;
    const source = readCESource(ce);
    if (
      doesEffectResistanceSourceApplyToController(
        source,
        actingPlayerId,
        card.controllerPlayerId,
        "effect"
      )
    ) {
      if (
        canSourceBypassResistanceCE(
          state,
          ce,
          getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        )
      ) {
        continue;
      }
      return true;
    }
  }

  return false;
}

/**
 * P3-77 節②: 当該プレイヤーが「相手の効果を受けない」(player_effect_immunity) 状態かを判定する。
 *
 * プレイヤーを対象とする効果 (人称+読点で判定。例「相手は、〜できない」) の executor が、
 * 解決前にこのヘルパで対象プレイヤーの耐性を確認し、相手起因 (actingPlayerId !== targetPlayerId)
 * かつ免疫中なら効果を no-op にする。手札/コア/フィールドのカードを対象とする効果は
 * プレイヤー対象ではないため、このヘルパでは判定しない (カード対象は defense_immune 側)。
 *
 * @param actingPlayerId 効果発動元。null (system/SBA) または対象プレイヤー自身なら免疫対象外。
 */
export function isPlayerImmuneToOpponentEffect(
  state: GameState,
  targetPlayerId: string,
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none"
): boolean {
  // 自分起因・system 起因は「相手の効果」ではないため免疫対象外。
  if (actingPlayerId === null || actingPlayerId === targetPlayerId)
    return false;
  if (canEffectPenetrateDefense(sourcePreventionLevel, "immune")) return false;
  return state.activeContinuousEffects.some(
    (ce) =>
      ce.modifierTag === "player_effect_immunity" &&
      ce.targetInstanceId === targetPlayerId
  );
}

/**
 * `hand_gain_cost_gate` CE (engine-opponent-hand-gain-paid-tax-gate, BSRK01-C02[3,4])
 * が `playerId` に課す「デッキ/トラッシュ/オープンから手札を増やす」ときの必要対価を返す。
 * 該当 CE が無ければ 0。`getCEsForTarget` 経由 (timingScope 「相手のターン」等を尊重、
 * P3-77 節②の `isPlayerImmuneToOpponentEffect` と異なりこちらはターン限定効果のため必須)。
 *
 * consumer: `hand-gain-cost.ts` の共通判定。各取得経路はそちらを経由する。
 */
export function getHandGainCostGateAmount(
  state: GameState,
  playerId: string
): number {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag !== "hand_gain_cost_gate") continue;
    if (isPlayerImmuneToOpponentEffect(state, playerId, ce.actingPlayerId))
      continue;
    const amount = ce.metadata?.["costAmount"];
    return typeof amount === "number" ? amount : 1;
  }
  return 0;
}

/**
 * `hand_gain_prevention` CE (engine-restrict-hand-gain-bsrk01-x01, BSRK01-X01 合体結誓)
 * が `playerId` に課す「手札を増やす」禁止の有無を返す。
 */
export function isHandGainPrevented(
  state: GameState,
  playerId: string
): boolean {
  for (const ce of getCEsForTarget(state, playerId)) {
    if (ce.modifierTag === "hand_gain_prevention") return true;
  }
  return false;
}

/**
 * 「(player)は、(player)の効果で手札を増やせない」の source-scoped consumer。
 *
 * 制約対象自身が発揮した効果による純増だけを止める。別プレイヤーが発揮した
 * 効果で対象カードが手札へ戻る場合は許可する（公式 Q12300/Q12301）。hand_swap
 * のように純増しない移動は caller が acquisition として渡さない。
 */
export function isHandGainPreventedByOwnEffect(
  state: GameState,
  recipientPlayerId: string,
  effectControllerPlayerId: string
): boolean {
  return (
    recipientPlayerId === effectControllerPlayerId &&
    isHandGainPrevented(state, recipientPlayerId)
  );
}

type SoulCoreImmunitySourcePlayerScope = "self" | "opponent" | "any";

function readSoulCoreImmunitySourcePlayerScope(
  ce: ContinuousEffect
): SoulCoreImmunitySourcePlayerScope {
  const meta = ce.metadata as
    | { sourcePlayerScope?: SoulCoreImmunitySourcePlayerScope }
    | undefined;
  return meta?.sourcePlayerScope ?? "self";
}

function doesSoulCoreImmunitySourcePlayerScopeApply(
  scope: SoulCoreImmunitySourcePlayerScope,
  soulCoreOwnerId: string,
  actingPlayerId: string | null
): boolean {
  if (actingPlayerId === null) return false;
  if (scope === "any") return true;
  if (scope === "opponent") return actingPlayerId !== soulCoreOwnerId;
  return actingPlayerId === soulCoreOwnerId;
}

/**
 * Q8962 型: 保護対象プレイヤーのソウルコアが、ソウルコアを指定した効果を受けないか。
 *
 * `soul_core_effect_immunity` はカードではなくソウルコアそのものを守る player-scoped CE。
 * ただし Q8964 に合わせ、ソウルコアが載っているカードがこの CE の発揮元効果を受けない
 * 場合は、その CE によるソウルコア保護も適用しない。
 */
export function isSoulCoreImmuneToSpecifiedEffect(
  state: GameState,
  soulCoreOwnerId: string,
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  options?: {
    soulCard?: CardInstance | undefined;
    getCardDefinitionById?:
      | ((id: string) => CardDefinition | undefined)
      | undefined;
  }
): boolean {
  if (canEffectPenetrateDefense(sourcePreventionLevel, "immune")) {
    return false;
  }
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "soul_core_effect_immunity") continue;
    if (ce.targetInstanceId !== soulCoreOwnerId) continue;
    if (
      !doesSoulCoreImmunitySourcePlayerScopeApply(
        readSoulCoreImmunitySourcePlayerScope(ce),
        soulCoreOwnerId,
        actingPlayerId
      )
    ) {
      continue;
    }

    if (options?.soulCard) {
      const ceSourceCard = getCardById(state, ce.sourceInstanceId);
      const ceSourceDefinition = options.getCardDefinitionById?.(
        ceSourceCard?.definitionId ?? ce.sourceDefinitionId
      );
      if (
        isCardImmuneToOpponentEffect(
          state,
          options.soulCard,
          ce.actingPlayerId,
          "none",
          {
            instance: ceSourceCard,
            definition: ceSourceDefinition,
          },
          options.getCardDefinitionById
        )
      ) {
        continue;
      }
    }

    return true;
  }
  return false;
}

/**
 * カード対象の「相手の効果を受けない」(`defense_immune` / `defense_suppress`) 判定。
 *
 * `effect_immunity` action が登録する `defense_immune` CE 等を読み、当該カードが
 * 相手起因の効果を受けないかを判定する汎用述語。コアシュート (`core_move`) や
 * 実行時のカード対象解決 (`resolveTargets`) など、候補列挙の防御レベルフィルタ
 * (`filterTargetsByPreventionLevel`) を経由しない経路から呼ぶ。
 *
 * 判定:
 *   1. `actingPlayerId` が null (system/SBA) なら、カード効果ではないため免疫対象外 (`false`)。
 *   2. 対象カードの最強防御レベルを取得する。このとき通常の `defense_immune` は
 *      opponent-only として扱い、`immunityPlayerScope:"self"` は自分起因のみ、
 *      `"any"` は自分/相手どちらにも適用する。
 *   3. 攻撃側 `sourcePreventionLevel` が貫通できる (`canEffectPenetrateDefense` が true。
 *      例「防げない」) なら免疫対象外 (`false`)。
 *   4. それ以外は免疫 (`true`)。
 *
 * プレイヤー対象効果は [isPlayerImmuneToOpponentEffect] 側で判定する (別系統)。
 */
export function isCardImmuneToOpponentEffect(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: {
    /**
     * 効果の発生源カード（「相手のスピリットの効果を受けない」等の発生源スコープ照合用）。
     * `instance` を渡すと実効値（カラー変更 treat_as_color / category 変更 act_as_spirit）で
     * 照合する。`definition` のみのときは印字値フォールバック。
     */
    instance?: CardInstance | undefined;
    definition?: CardDefinition | undefined;
    effectIndex?: number | undefined;
    targetStepId?: string | undefined;
    /**
     * 発生源効果が発動したタイミング (main/flash/stack)。
     * `immunitySourceScope.activatedTimings` (「スタックの効果を受けない」等) の照合に使う。
     * ENGINE-immunity-source-activation-timing。
     */
    effectActivationTiming?: EffectActivationTiming | undefined;
  },
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectAspect?: string,
  options: EffectResistanceEvaluationOptions = {}
): boolean {
  if (actingPlayerId === null) {
    return false;
  }
  const relationPlayerId = cardEffectRelationPlayerId(card);
  const sourcePlayerRelation =
    actingPlayerId === relationPlayerId ? "self" : "opponent";
  const defenseLevel = getStrongestDefenseLevelForSource(
    state,
    card.instanceId,
    effectSource?.instance,
    effectSource?.definition,
    effectSource?.effectIndex,
    effectSource?.targetStepId,
    sourcePlayerRelation,
    sourcePreventionLevel,
    getCardDefinitionById,
    effectSource?.effectActivationTiming,
    sourcePreventionBypass,
    effectAspect,
    options
  );
  if (canEffectPenetrateDefense(sourcePreventionLevel, defenseLevel)) {
    return false;
  }
  return true;
}

/**
 * 「相手の効果を受けない」(`defense_immune` / `defense_suppress`) の防御レベルを、
 * 発生源スコープ (`immunitySourceScope`) を考慮して算出する。
 *
 * - スコープ無しの CE (`immunitySourceScope` 未設定) は発生源カード種別を問わず数える。
 *   ただし `immunityPlayerScope` 省略時は opponent-only。
 *   "self" は自分起因のみ、"any" は自分/相手どちらも数える。
 * - スコープ付きの CE (「相手のスピリットの効果を受けない」等) は、効果の発生源カード
 *   がスコープ (category / colors / maxCost) に **実効値で** 一致するときのみ数える。
 *   発生源が不明 (`sourceDefinition` 未提供) の場合は **保守的に数えない** ＝過剰免疫を防ぐ。
 *
 * `getStrongestDefenseLevel` (全 defense_immune を blanket 集計) の発生源スコープ版。
 */
function getStrongestDefenseLevelForSource(
  state: GameState,
  targetInstanceId: string,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition | undefined,
  sourceEffectIndex: number | undefined,
  sourceTargetStepId: string | undefined,
  sourcePlayerRelation: "opponent" | "self",
  sourcePreventionLevel: EffectPreventionLevel,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourceEffectActivationTiming?: EffectActivationTiming,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectAspect?: string,
  options: EffectResistanceEvaluationOptions = {}
): EffectPreventionLevel {
  // getCEsForTarget は timingScope（『自分のアタックステップ』等）でも filter する
  // SSOT。raw state.activeContinuousEffects を直接舐めると BSTH07.8-X01 のような
  // 「Lv2-Lv3『自分のアタックステップ』sourceScope.categories」型 CE が常時有効と
  // 誤解されるため、必ず getCEsForTarget 経由で取得する。
  let strongest: EffectPreventionLevel = "none";
  // 耐性は現在そのカードがある場所で評価する。移動先の耐性を先取りしない。
  const targetCard = getCardById(state, targetInstanceId);
  const ces = [
    ...getCEsForTarget(state, targetInstanceId),
    ...(targetCard && getCardDefinitionById
      ? getGlobalCEs(state).filter(
          (ce) =>
            (ce.modifierTag === "defense_immune" ||
              ce.modifierTag === "defense_suppress") &&
            ce.targetFilter !== undefined &&
            matchesEffectResistanceFilter(
              state,
              ce,
              targetCard,
              getCardDefinitionById,
              options.filterOptions
            )
        )
      : []),
  ];
  const ceDefinitionLookup = getCardDefinitionById ?? (() => undefined);
  for (const ce of ces) {
    if (
      ce.modifierTag !== "defense_immune" &&
      ce.modifierTag !== "defense_suppress"
    ) {
      continue;
    }
    const playerScope = ce.immunityPlayerScope ?? "opponent";
    if (playerScope !== "any" && playerScope !== sourcePlayerRelation) {
      continue;
    }
    if (
      ce.duration.scope === "current_effect" &&
      !currentEffectBindingMatches(
        ce,
        sourceCard,
        sourceDefinition,
        sourceEffectIndex,
        sourceTargetStepId
      )
    ) {
      continue;
    }
    // 発生源スコープ付き免疫は、発生源カードがスコープに一致するときのみ数える。
    if (ce.immunitySourceScope !== undefined) {
      // restrictedAspects: 発生源カードの属性ではなく「効果自身が何を書き換えるか」で
      // 絞る直交した軸。呼び出し元が effectAspect を渡さない、または一覧に含まれない
      // 場合はこの CE は適用対象外（効果は素通り）。ENGINE-symbol-lock-self-effect-immunity。
      if (
        ce.immunitySourceScope.restrictedAspects !== undefined &&
        (effectAspect === undefined ||
          !ce.immunitySourceScope.restrictedAspects.includes(effectAspect))
      ) {
        continue;
      }
      if (
        ce.immunitySourceScope.excludeSelf &&
        sourceCard !== undefined &&
        sourceCard.instanceId === ce.sourceInstanceId
      ) {
        continue;
      }
      if (
        !immunitySourceMatches(
          ce.immunitySourceScope,
          state,
          sourceCard,
          sourceDefinition,
          sourceEffectActivationTiming,
          effectAspect,
          getCardDefinitionById,
          ce.actingPlayerId,
          options.sourceIdentityOptions
        )
      ) {
        continue;
      }
    }
    if (
      canSourceBypassResistanceCE(
        state,
        ce,
        ceDefinitionLookup,
        sourcePreventionLevel,
        sourcePreventionBypass,
        options.sourceIdentityOptions
      )
    ) {
      continue;
    }
    // qa-020 marker: 実 identity 照合をスキップして満たしたと判定した CE
    // (`canSourceBypassResistanceCE` の marker 分岐で bypass されなかった場合) は、
    // 通常の "immune"/"suppress" ランクではなく "unpreventable" 相当として扱う。
    // ここで昇格させないと、この後の `canEffectPenetrateDefense`（防止ラダー本体、
    // rank 比較のみで CE 単位の bypass 判定を見ない）が「防げない(rank3) > 受けない(rank2)」
    // で無条件に貫通させてしまい、CE 単位で「満たした」と判定した意味が失われる。
    // ラダー関数自体は変更せず、marker CE の実効ランクだけを引き上げる。P3-141。
    const level: EffectPreventionLevel = readCESatisfiesPreventionRestriction(
      ce
    )
      ? "unpreventable"
      : ce.modifierTag === "defense_immune"
        ? "immune"
        : "suppress";
    if (!canEffectPenetrateDefense(sourcePreventionLevel, level)) {
      options.onBlockingEffect?.(ce);
    }
    if (comparePreventionLevel(level, strongest) > 0) {
      strongest = level;
    }
  }
  return strongest;
}

function currentEffectBindingMatches(
  ce: ContinuousEffect,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition | undefined,
  sourceEffectIndex: number | undefined,
  sourceTargetStepId: string | undefined
): boolean {
  const metadata = ce.metadata ?? {};
  const boundSourceInstanceId = metadata.currentEffectSourceInstanceId;
  const boundSourceDefinitionId = metadata.currentEffectSourceDefinitionId;
  const boundEffectIndex = metadata.currentEffectIndex;
  const boundTargetStepId = metadata.currentEffectTargetStepId;
  const boundTargetStepIds = metadata.currentEffectTargetStepIds;
  const matchesTargetStep =
    boundTargetStepIds !== undefined
      ? Array.isArray(boundTargetStepIds) &&
        boundTargetStepIds.every((id) => typeof id === "string") &&
        sourceTargetStepId !== undefined &&
        boundTargetStepIds.includes(sourceTargetStepId)
      : typeof boundTargetStepId === "string" &&
        sourceTargetStepId === boundTargetStepId;
  if (
    typeof boundSourceInstanceId !== "string" ||
    typeof boundSourceDefinitionId !== "string" ||
    typeof boundEffectIndex !== "number" ||
    sourceEffectIndex !== boundEffectIndex ||
    !matchesTargetStep
  ) {
    return false;
  }
  if (sourceCard?.instanceId !== boundSourceInstanceId) {
    return false;
  }
  const sourceDefinitionId =
    sourceDefinition?.cardNo ?? sourceCard.definitionId;
  return sourceDefinitionId === boundSourceDefinitionId;
}

function getEffectiveSourceCostForImmunityScope(
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: EffectivePropertyEvaluationOptions = {}
): number {
  if (!sourceCard) return sourceDefinition.cost ?? 0;
  return getCombinedUnitCostFilterOptions(
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById,
    options
  ).effectiveCost;
}

/**
 * 発生源カードがスコープ (category / colors / maxCost / hasBurstEffect / keywords / activatedTimings) に一致するか。
 * 発生源不明 (`sourceDefinition` undefined) は不一致扱い (保守的に免疫を成立させない)。
 *
 * category / colors / maxCost / hasBurstEffect / keywords は互いに AND (従来挙動。keywords は
 * `sourceDefinition.keywordTags` のいずれか1つ以上一致で可、`EffectSourceFilter.keywords` と
 * 同じ判定。「相手のバースト効果を持つスピリット/アルティメットの効果を受けない」BSTH02-R03)。
 * `activatedTimings` (発生源効果の
 * 発動タイミング main/flash/stack) が指定されているときは、category/colors/maxCost の
 * AND 結果と **OR** 結合する (「相手のスピリット/…/ネクサスの効果を受けない」+「スタックの
 * 効果を受けない」= カテゴリ一致 OR スタック発動、のいずれかで免疫成立。
 * BSTH02.7-C02 / ENGINE-immunity-source-activation-timing)。
 *
 * category / colors は **実効値** で照合する（発生源 instance がある場合）:
 * - colors: `getEffectiveColors`（treat_as_color 等の継続効果で変わった色を反映、実効色 SSOT）。
 * - category: `getEffectiveCategory`（act_as_spirit 付与・裏向きを反映）。
 * - maxCost: `getCombinedUnitCost`（コスト上書き・合体単位を反映）。発生源 instance
 *   未提供時だけ印字値へフォールバックする。
 *
 * activatedTimings は発生源カード種別と無関係のため、発生源カテゴリ判定
 * (categories/colors/maxCost) より先に単独で判定する。
 */
function immunitySourceMatches(
  scope: NonNullable<ContinuousEffect["immunitySourceScope"]>,
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceDefinition: CardDefinition | undefined,
  sourceEffectActivationTiming?: EffectActivationTiming,
  effectAspect?: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  holderOwnerId?: string,
  options: EffectivePropertyEvaluationOptions = {}
): boolean {
  if (effectAspect && scope.excludedAspects?.includes(effectAspect)) {
    return false;
  }
  // excludeCombined: 合体状態の発生源は他条件の一致に関わらず scope 対象から除外する
  // （「合体スピリット/マジック以外の効果を受けない」型、BSAZ02-C04）。card-filter.ts の
  // `CardFilter.combined` 判定と同一基準。発生源不明時は判定不能のため除外しない。
  if (scope.excludeCombined && sourceCard) {
    const isCombined = isEffectivelyCombined(state, sourceCard);
    const combinedHost = sourceCard.attachedToInstanceId
      ? (state.cardInstances.find(
          (c) => c.instanceId === sourceCard.attachedToInstanceId
        ) ?? sourceCard)
      : sourceCard;
    const combinedDefinition =
      combinedHost.instanceId === sourceCard.instanceId
        ? sourceDefinition
        : getCardDefinitionById?.(combinedHost.definitionId);
    const combinedCategory = combinedDefinition
      ? getEffectiveCategory(state, combinedHost, combinedDefinition)
      : undefined;
    if (
      isCombined &&
      (!scope.excludeCombinedCategories ||
        (combinedCategory !== undefined &&
          scope.excludeCombinedCategories.includes(combinedCategory)))
    )
      return false;
  }
  // excludeGrandwalkerOrGuided: 発生源が創界神/導界者ネクサス (神託/導託持ち) なら
  // scope 対象から除外する (BSAZ02-M03「【神託】/【導託】以外の…効果を受けない」)。
  if (
    scope.excludeGrandwalkerOrGuided &&
    sourceDefinition &&
    isGrandwalkerOrGuidedNexus(sourceDefinition)
  ) {
    return false;
  }
  // excludeTribes: 発生源の実効系統がこの一覧に一致すれば scope 対象から除外する
  // (BSLH01アーツ T07-T17「系統：「CB」/「導力器」を持たない自分の効果を受けない」)。
  // 発生源不明時は判定不能のため除外しない (excludeCombined と同じ安全側)。
  if (
    scope.excludeTribes &&
    scope.excludeTribes.length > 0 &&
    sourceDefinition
  ) {
    const effTribes = getEffectiveTribes(
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById,
      options
    );
    if (scope.excludeTribes.some((t) => effTribes.includes(t))) {
      return false;
    }
  }
  if (
    scope.activatedTimings &&
    scope.activatedTimings.length > 0 &&
    sourceEffectActivationTiming !== undefined &&
    scope.activatedTimings.includes(sourceEffectActivationTiming)
  ) {
    return true;
  }
  const hasDefinitionScopedPositiveFilter =
    (scope.categories?.length ?? 0) > 0 ||
    (scope.colors?.length ?? 0) > 0 ||
    scope.colorsFromOpponentFieldSymbols === true ||
    scope.maxCost !== undefined ||
    scope.hasBurstEffect !== undefined ||
    (scope.keywords?.length ?? 0) > 0;
  const hasActivationTimingFilter = (scope.activatedTimings?.length ?? 0) > 0;
  if (!sourceDefinition) {
    return !hasDefinitionScopedPositiveFilter && !hasActivationTimingFilter;
  }
  if (scope.categories && scope.categories.length > 0) {
    const effCategory = sourceCard
      ? getEffectiveCategory(state, sourceCard, sourceDefinition)
      : sourceDefinition.printedCategory;
    if (effCategory === undefined || !scope.categories.includes(effCategory)) {
      return false;
    }
  }
  if (
    (scope.colors && scope.colors.length > 0) ||
    scope.colorsFromOpponentFieldSymbols === true
  ) {
    const effColors = sourceCard
      ? getEffectiveColors(state, sourceCard, sourceDefinition)
      : (sourceDefinition.colors ?? []);
    const dynamicColors = scope.colorsFromOpponentFieldSymbols
      ? getOpponentFieldSymbolColors(
          state,
          holderOwnerId,
          getCardDefinitionById
        )
      : [];
    const matchColors: readonly (CardColor | SymbolColor)[] = [
      ...(scope.colors ?? []),
      ...dynamicColors,
    ];
    if (!matchColors.some((c) => effColors.includes(c as CardColor))) {
      return false;
    }
  }
  if (scope.maxCost !== undefined) {
    if (
      getEffectiveSourceCostForImmunityScope(
        state,
        sourceCard,
        sourceDefinition,
        getCardDefinitionById,
        options
      ) > scope.maxCost
    ) {
      return false;
    }
  }
  if (scope.hasBurstEffect !== undefined) {
    if (cardHasBurstEffect(sourceDefinition) !== scope.hasBurstEffect) {
      return false;
    }
  }
  if (scope.keywords && scope.keywords.length > 0) {
    if (
      !scope.keywords.some((k) => sourceDefinition.keywordTags?.includes(k))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * `cards` から「相手起因の効果を受けないカード」を除外して返す。
 * [filterOutResistantCards] (cannot_* 系) と同形の `{ allowed, blocked }` を返し、
 * コアシュート候補や実行時ターゲット列のふるい分けに使う。
 */
export function filterOutImmuneCards<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: {
    instance?: CardInstance | undefined;
    definition?: CardDefinition | undefined;
    effectIndex?: number | undefined;
    targetStepId?: string | undefined;
    effectActivationTiming?: EffectActivationTiming | undefined;
  },
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectAspect?: string,
  options: EffectResistanceEvaluationOptions = {}
): { allowed: T[]; blocked: T[] } {
  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const c of cards) {
    if (
      isCardImmuneToOpponentEffect(
        state,
        c,
        actingPlayerId,
        sourcePreventionLevel,
        effectSource,
        getCardDefinitionById,
        sourcePreventionBypass,
        effectAspect,
        options
      )
    ) {
      blocked.push(c);
    } else {
      allowed.push(c);
    }
  }
  return { allowed, blocked };
}
