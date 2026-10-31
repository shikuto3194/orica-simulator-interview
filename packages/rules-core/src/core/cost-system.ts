import { getCardById, getCardUseSourceZone } from "../card/card-lookup";
import { getCombinedUnitSymbolBundles } from "../battle/battle-shared";
import {
  getApplicableAdditionalCostDelta,
  matchesCardReferenceFilter,
  matchesCardFilterByDef,
} from "../card/card-filter";
import { getCEsForTarget } from "../card/ce-lookup";
import { getExtendedFieldSymbolSourceCards } from "../card/field-symbol-source-extension";
import { evaluateApplicability } from "../effect/effect-interpreter";
import {
  evaluateContinuousDynamicAmount,
  executeReevaluationCheck,
  getCardDefinitionForEffectiveFieldCard,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { deriveSuppressionEffectDescriptor } from "../effect/structured-effect-registrations";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import type { CardFilter, DSL } from "../dsl-types";
import {
  CARD_COLORS,
  collectUnderCardScopeIds,
  isCardTextCardState,
  normalizeAsColors,
  type BattleEntity,
  type CardColor,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type SymbolColor,
} from "../model";

export interface ReductionBreakdownEntry {
  color: CardColor;
  requested: number;
  available: number;
  applied: number;
}

/**
 * 1 つの物理シンボルが扱える色の組。
 * 単色シンボル: colors = ["red"]。
 * 多色シンボル (効果で「このシンボルは緑としても扱う」等): colors = ["red", "green"]。
 * 多色の場合、軽減時にはこのシンボルは 1 色しか使えない (片側使用ルール)。
 */
export interface SymbolColorEntry {
  colors: readonly SymbolColor[];
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
}

export interface FieldSymbolSource {
  sourceInstanceId: string;
  sourceDefinitionId: string;
  via: "card" | "battle_entity";
  /** 全シンボル色の flat view (UI・display 用)。 */
  symbolColors: SymbolColor[];
  /** 物理シンボル単位のグループ化。多色シンボルの片側使用制約を表現。 */
  symbolEntries: SymbolColorEntry[];
}

/**
 * 余分コスト (追加コスト) の 1 件。
 * 「Xコスト余分に支払わなければならない」等の効果で加算される。
 * 軽減後に適用されるため、軽減で減らすことはできない。
 */
export interface AdditionalCostModifier {
  /** 加算するコスト量。 */
  amount: number;
  /** 加算理由 (ログ/デバッグ用)。 */
  reason: string;
}

export interface ReductionResult {
  printedCost: number;
  /**
   * 発揮前/場入り前のカード cost filter が見る現在コスト。
   * 自己 cost override / fixed payment は反映し、通常のシンボル軽減は反映しない。
   */
  effectiveCost?: number | undefined;
  totalReduction: number;
  /** 実際に満たした軽減シンボル枠数。固定/無償コストの支払い額差分とは分離する。 */
  satisfiedReductionSymbolCount: number;
  /** この使用時点で要求された軽減シンボル枠数。追加軽減シンボル込み。 */
  requiredReductionSymbolCount: number;
  /** 軽減後コスト (= max(0, printedCost - totalReduction))。追加コスト加算前。 */
  reducedCost: number;
  /** 余分コストの合計。 */
  additionalCost: number;
  /** 最終支払いコスト (= reducedCost + additionalCost)。支払い検証はこの値を使う。 */
  finalCost: number;
  reductionBreakdown: ReductionBreakdownEntry[];
  fieldSymbolSources: FieldSymbolSource[];
  /** 適用された余分コスト修飾子。 */
  additionalCostModifiers: readonly AdditionalCostModifier[];
}

export interface CalculateReductionOptions {
  state: GameState;
  actingPlayerId: string;
  card: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** 軽減後に加算する余分コスト。省略時は空 (追加コストなし)。 */
  additionalCostModifiers?: readonly AdditionalCostModifier[];
  /**
   * 「このカードをコストNにする」型の一時的な総コスト上書き。
   * 継続 CE 由来の self cost override と同じく、軽減 / floor / 追加コストは
   * override 後の値に適用する。
   */
  baseCostOverride?: number;
  /**
   * 召喚しようとしているカードの instanceId。
   * `treat_as { appliesToCard: true, aspects 含 reduction_symbol }` の継続効果を、
   * 手札ゾーン (CE 未登録) でも要求側軽減シンボルに適用するため、
   * condition / applicability 評価のソースとして使用する。
   * 省略時は無条件 treat_as のみ適用。
   */
  sourceInstanceId?: string;
  /**
   * Effect mode currently being paid for. Used by card-side reduction-symbol
   * modifiers scoped to a specific magic/activated effect mode.
   */
  effectMode?: "main" | "flash" | "stack";
  /**
   * 軽減の供給側（フィールドシンボル）から除外する instanceId 群。
   * 逆転醒（B面→A面の裏返して配置/召喚, P3-98）は対象自身が既にフィールド上に
   * いるため、「自身のシンボルでは軽減不可」(08a §逆転醒) を表現するのに自身を除外する。
   * 通常召喚（手札起点）では対象が場に無いため指定不要。
   */
  excludeFieldInstanceIds?: readonly string[];
  /**
   * この召喚を発生させた原因（`SummonAction.summonCause` から伝播）。
   * `CardFilter.summonCause`（BSTH02-C02 型「バースト効果以外の効果で召喚するとき」タックス）
   * の判定に使う。通常召喚（手札からの legal action）や symbol 軽減のみの経路では未指定。
   */
  summonCause?: "effect" | "burst";
  /**
   * この軽減計算がどのカード使用手段 (`DSL.CardUseKind`) に対応するかを示す。
   * `prevent_cost_reduction` CE（BSTH07.8-C03「相手はネクサスを配置するとき、
   * 軽減できない」）の `restrictedKinds` 判定に使う。省略時は使用種別を問わず
   * 軽減無効化 CE の `restrictedKinds` 指定は成立しない（restrict_use と同じ
   * 「呼び出し元が明示しない限り種別限定は無効」規約、legal-actions-shared.ts の
   * isCardUseRestricted usageKind と同型）。
   */
  useKind?: DSL.CardUseKind;
}

function createEmptyColorCounter(): Record<CardColor, number> {
  return {
    red: 0,
    purple: 0,
    green: 0,
    white: 0,
    yellow: 0,
    blue: 0,
    black: 0,
  };
}

function isCardColor(color: SymbolColor): color is CardColor {
  return CARD_COLORS.includes(color as CardColor);
}

function createCardInstanceMap(state: GameState): Map<string, CardInstance> {
  return new Map(
    state.cardInstances.map((cardInstance) => [
      cardInstance.instanceId,
      cardInstance,
    ])
  );
}

function getBattleEntityRepresentativeInstanceId(
  battleEntity: BattleEntity,
  cardInstancesById: Map<string, CardInstance>
): string | null {
  const detachedMemberId = battleEntity.memberInstanceIds.find(
    (memberInstanceId) => {
      const cardInstance = cardInstancesById.get(memberInstanceId);

      return cardInstance?.attachedToInstanceId === null;
    }
  );

  if (detachedMemberId) {
    return detachedMemberId;
  }

  return (
    battleEntity.memberInstanceIds.find((memberInstanceId) =>
      cardInstancesById.has(memberInstanceId)
    ) ?? null
  );
}

function createBattleEntitySourceMap(
  state: GameState
): Map<string, BattleEntity> {
  const cardInstancesById = createCardInstanceMap(state);
  const battleEntitySourceMap = new Map<string, BattleEntity>();

  for (const battleEntity of state.battleEntities) {
    const representativeInstanceId = getBattleEntityRepresentativeInstanceId(
      battleEntity,
      cardInstancesById
    );

    if (!representativeInstanceId) {
      continue;
    }

    battleEntitySourceMap.set(representativeInstanceId, battleEntity);
  }

  return battleEntitySourceMap;
}

function getCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardDefinition {
  const definition = getCardDefinitionById(definitionId);

  if (!definition) {
    throw new Error(`Unknown card definition: ${definitionId}`);
  }

  return definition;
}

function getDynamicCountSourceTribes(
  state: GameState,
  sourceInstanceId: string | undefined,
  sourceDef: CardDefinition | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): string[] {
  const sourceCard = sourceInstanceId
    ? state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
    : undefined;

  return getEffectiveTribes(
    state,
    sourceCard,
    sourceDef,
    getCardDefinitionById
  );
}

function getFieldSymbolSource(
  cardInstance: CardInstance,
  battleEntitySourceMap: Map<string, BattleEntity>,
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): FieldSymbolSource | null {
  const battleEntity = battleEntitySourceMap.get(cardInstance.instanceId);

  // 軽減は現在の合体関係を参照する。過去のバトルmemberは合体/分離後に古くなりうる。
  const definition =
    getCardDefinitionForEffectiveFieldCard(
      cardInstance,
      getCardDefinitionById
    ) ??
    getCardDefinitionOrThrow(cardInstance.definitionId, getCardDefinitionById);
  const allBundles = getCombinedUnitSymbolBundles(
    state,
    cardInstance,
    definition,
    getCardDefinitionById
  );

  if (allBundles.length === 0) return null;

  // bundle.count を展開して 1 物理シンボル = 1 entry にする (多色シンボルの片側使用ルールは
  // calculateReduction 側 findOptimalMultiColorAllocation で扱われる)。
  const symbolEntries: SymbolColorEntry[] = [];
  for (const bundle of allBundles) {
    for (let i = 0; i < bundle.count; i++) {
      symbolEntries.push({ colors: [...bundle.colors] });
    }
  }

  // flat colors view: 多色シンボルは各色を独立にカウント (availableCounts 計算用)。
  const symbolColors: SymbolColor[] = symbolEntries.flatMap((e) => [
    ...e.colors,
  ]);

  return {
    sourceInstanceId: cardInstance.instanceId,
    sourceDefinitionId: cardInstance.definitionId,
    via: battleEntity ? "battle_entity" : "card",
    symbolColors,
    symbolEntries,
  };
}

/**
 * 支払い文脈限定 treat_as（`whenPayingForFilter` 付き）を反映して、供給側 field カードの
 * symbolEntries を加色する。
 *
 * 「自分が系統:「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを白/紫としても扱う」
 * (BSSA01-C01/C02/C03) のような効果は、無条件 CE を登録しない（`getEffectiveSymbolBundles` は
 * 素の実効シンボルのみ）。代わりに、支払い対象カード（`payingForCard`）がフィルタに一致するときだけ
 * この関数が source の各エントリへ加色する。`aspects` に `"symbol"` を含む treat_as が対象。
 *
 * フィールドゾーンの継続効果は手札のように DSL 直接読みできるとは限らないが、ここでは支払い時点で
 * source カードの `effects` を直接読む（CE 非登録のため）。SSOT として支払い経路のみで解決する。
 */
function applyPayingForTreatAsToSupply(
  state: GameState,
  source: FieldSymbolSource,
  payingForCard: CardDefinition,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColorEntry[] {
  const sourceDef = getCardDefinitionById(source.sourceDefinitionId);
  if (!sourceDef) return source.symbolEntries;
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === source.sourceInstanceId
  );
  if (!sourceCard) return source.symbolEntries;

  const addColors: SymbolColor[] = [];
  const effects = sourceDef.effects ?? [];
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = effects[effectIndex]!;
    if (effect.timing.kind !== "continuous") continue;
    if (
      !isPayingForTreatAsSourceEligible(
        state,
        sourceCard,
        sourceDef,
        effect,
        effectIndex,
        actingPlayerId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "treat_as") continue;
      if (!action.whenPayingForFilter) continue;
      if (!action.aspects.includes("symbol")) continue;
      if (!matchesCardFilterByDef(payingForCard, action.whenPayingForFilter)) {
        continue;
      }
      for (const c of normalizeAsColors(action.asColor ?? [])) {
        if (!addColors.includes(c)) addColors.push(c);
      }
    }
  }

  if (addColors.length === 0) return source.symbolEntries;

  return source.symbolEntries.map((entry) => {
    const colors = [...entry.colors];
    for (const c of addColors) {
      if (!colors.includes(c)) colors.push(c);
    }
    return { ...entry, colors };
  });
}

function isPayingForTreatAsSourceEligible(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  effect: NonNullable<CardDefinition["effects"]>[number],
  effectIndex: number,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (sourceCard.faceDown) return false;
  if (sourceCard.controllerPlayerId !== actingPlayerId) return false;

  const hasCondition = effect.condition && effect.condition.length > 0;
  const hasApplicability = effect.applicability !== undefined;
  if (!hasApplicability && sourceCard.zone !== "field") return false;
  if (
    hasCondition &&
    !evaluateCondition(
      state,
      effect.condition!,
      sourceCard.instanceId,
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    return false;
  }
  if (
    hasApplicability &&
    !evaluateApplicability(
      state,
      effect.applicability!,
      sourceCard.instanceId,
      getCardDefinitionById
    )
  ) {
    return false;
  }
  if (
    isPayingForTreatAsEffectSuppressed(
      state,
      sourceCard,
      sourceDefinition,
      effect,
      effectIndex,
      getCardDefinitionById
    )
  ) {
    return false;
  }
  return true;
}

function isPayingForTreatAsEffectSuppressed(
  state: GameState,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  effect: NonNullable<CardDefinition["effects"]>[number],
  effectIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    !state.activeContinuousEffects.some(
      (ce) => ce.modifierTag === "effect_suppression"
    )
  ) {
    return false;
  }
  const suppressionEffectDescriptor = deriveSuppressionEffectDescriptor(
    effect,
    {
      sourceDefinitionId: sourceDefinition.cardNo,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        sourceDefinition.printedCategory
      ),
      effectIndex,
      sourceTextLines: sourceDefinition.textLines,
    }
  );
  return !executeReevaluationCheck({
    state,
    checkKind: "effect_suppression",
    sourceInstanceId: sourceCard.instanceId,
    targetInstanceIds: [],
    sourcePreventionLevel: effect.preventionLevel ?? "none",
    ...(effect.targetLockBypass !== undefined
      ? { sourcePreventionBypass: effect.targetLockBypass }
      : {}),
    suppressionEffectDescriptor,
    getCardDefinitionById,
  });
}

/**
 * 支払い文脈限定 treat_as（`whenPayingForFilter` + aspects 含 `reduction_symbol` +
 * `waivesReductionRequirement:true|"all"`）の合計枠数を数える。継続効果を直接 DSL 読みし
 * （`applyPayingForTreatAsToSupply` と同じく whenPayingForFilter 系は CE 非登録のため）、
 * `payingForCard` がフィルタに一致するものだけ `count`（省略時1、`Amount` なら動的評価）を
 * 合算する。`"all"` は残り未充足枠数ぶんを満たす。実際の色供給と無関係に満たされる枠のため、
 * `calculateReduction` はマッチング結果とは別に `totalReduction` へ直接加算する。
 * `waiverColors` 指定時は `unmatchedEntries` のうち要求色がいずれか一致する枠だけを
 * 免除対象として数える（「その軽減シンボル赤/黄2つまでを満たす」型、BSTH003-C31/M02）。
 */
function getPayingForReductionWaiverCount(
  state: GameState,
  actingPlayerId: string,
  payingForCard: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  unmatchedEntries: readonly SymbolColorEntry[]
): number {
  let waiverCount = 0;
  // 〔重複不可〕(effect.usageLimit kind:"no_duplicate"): この関数は CE 非登録の
  // whenPayingForFilter 系を直接 DSL 読みするため、activeContinuousEffects ベースの
  // isContinuousNoDuplicateSkip (effect-interpreter.ts) の dedup 対象外。同名カードが
  // 複数枚いても加算は 1 回分に留める。split 効果は limitGroupId を共有して同能力として扱う。
  const noDuplicateCounted = new Set<string>();
  for (const cardInstance of state.cardInstances) {
    const sourceDef = getCardDefinitionById(cardInstance.definitionId);
    if (!sourceDef) continue;

    const effects = sourceDef.effects ?? [];
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
      const effect = effects[effectIndex]!;
      if (effect.timing.kind !== "continuous") continue;
      const usageLimits = effect.usageLimit
        ? Array.isArray(effect.usageLimit)
          ? effect.usageLimit
          : [effect.usageLimit]
        : [];
      const isNoDuplicate = usageLimits.some((l) => l.kind === "no_duplicate");
      const dedupeKey =
        effect.limitGroupId ?? `${sourceDef.cardNo}::${effectIndex}`;
      if (isNoDuplicate && noDuplicateCounted.has(dedupeKey)) continue;
      if (
        !isPayingForTreatAsSourceEligible(
          state,
          cardInstance,
          sourceDef,
          effect,
          effectIndex,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "treat_as") continue;
        if (!action.whenPayingForFilter) continue;
        if (!action.aspects.includes("reduction_symbol")) continue;
        if (!action.waivesReductionRequirement) continue;
        if (
          !matchesCardFilterByDef(payingForCard, action.whenPayingForFilter)
        ) {
          continue;
        }
        const eligibleUnmatchedCount = action.waiverColors
          ? unmatchedEntries.filter((e) =>
              e.colors.some((c) => action.waiverColors!.includes(c))
            ).length
          : unmatchedEntries.length;
        const requestedCount =
          action.waivesReductionRequirement === "all"
            ? eligibleUnmatchedCount
            : action.count === undefined
              ? 1
              : typeof action.count === "number"
                ? action.count
                : evaluateContinuousDynamicAmount(
                    state,
                    actingPlayerId,
                    action.count,
                    getCardDefinitionById,
                    {
                      sourceTribes: getDynamicCountSourceTribes(
                        state,
                        cardInstance.instanceId,
                        sourceDef,
                        getCardDefinitionById
                      ),
                    }
                  );
        const count = Math.min(requestedCount, eligibleUnmatchedCount);
        waiverCount += count;
        if (isNoDuplicate) noDuplicateCounted.add(dedupeKey);
      }
    }
  }
  return waiverCount;
}

/**
 * 支払い文脈限定 treat_as（`whenPayingForFilter` + aspects 含 `reduction_symbol` +
 * `overridesRequiredColor:true`）を探し、一致すれば要求側エントリの置き換え色を返す。
 * `getPayingForReductionWaiverCount`（無条件充足カウント）と同じ SSOT で field カードの
 * 継続効果を直接 DSL 読みするが、こちらは「色を問わず満たす」のではなく「要求色を
 * asColor へ置き換える」ため、`getEffectiveReductionSymbolEntries` が要求エントリを構築する
 * 最終段で使う。「自分が系統：「CB」を持つカードを召喚/配置するとき、その軽減シンボルを
 * <七>として扱う」(BSLH01-CX01) 型。最初に一致した treat_as の `asColor` を採用する
 * (現行カードで複数ソースが同時に一致する実例は無い)。
 */
function getPayingForReductionColorOverride(
  state: GameState,
  actingPlayerId: string,
  payingForCard: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): SymbolColor[] | undefined {
  for (const cardInstance of state.cardInstances) {
    if (cardInstance.zone !== "field") continue;
    if (cardInstance.controllerPlayerId !== actingPlayerId) continue;
    const sourceDef = getCardDefinitionById(cardInstance.definitionId);
    if (!sourceDef) continue;

    const effects = sourceDef.effects ?? [];
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
      const effect = effects[effectIndex]!;
      if (effect.timing.kind !== "continuous") continue;
      if (
        !isPayingForTreatAsSourceEligible(
          state,
          cardInstance,
          sourceDef,
          effect,
          effectIndex,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }

      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "treat_as") continue;
        if (!action.whenPayingForFilter) continue;
        if (!action.aspects.includes("reduction_symbol")) continue;
        if (!action.overridesRequiredColor) continue;
        if (
          !matchesCardFilterByDef(payingForCard, action.whenPayingForFilter)
        ) {
          continue;
        }
        const colors = normalizeAsColors(action.asColor ?? []);
        if (colors.length > 0) return colors;
      }
    }
  }
  return undefined;
}

type ReductionTreatAsAction = DSL.TreatAsAction;

/** 使用対象の自己修飾だけを読む。場の同名カードや外部付与効果は走査しない。 */
function* getSelfReductionTreatAsActions(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  effectMode: "main" | "flash" | "stack" | undefined
): Generator<ReductionTreatAsAction> {
  const sourceCard = sourceInstanceId
    ? state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
    : undefined;
  const sourceIsCardState = sourceCard
    ? isCardTextCardState(sourceCard, state)
    : true;

  for (const [effectIndex, effect] of (card.effects ?? []).entries()) {
    if (effect.timing.kind !== "continuous") continue;

    const hasCondition = effect.condition && effect.condition.length > 0;
    const hasApplicability = effect.applicability !== undefined;
    if (hasCondition || hasApplicability) {
      // condition / applicability 評価には sourceInstanceId が必要
      // (state.cardInstances から source カードを引くため)。
      // 省略時は条件付き treat_as をスキップ (保守的フォールバック)。
      if (!sourceInstanceId) continue;
      if (
        hasCondition &&
        !evaluateCondition(
          state,
          effect.condition!,
          sourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        hasApplicability &&
        !evaluateApplicability(
          state,
          effect.applicability!,
          sourceInstanceId,
          getCardDefinitionById,
          getCardById(state, sourceInstanceId)
            ? getCardUseSourceZone(getCardById(state, sourceInstanceId)!)
            : undefined
        )
      ) {
        continue;
      }
    }

    if (
      sourceCard &&
      isPayingForTreatAsEffectSuppressed(
        state,
        sourceCard,
        card,
        effect,
        effectIndex,
        getCardDefinitionById
      )
    )
      continue;

    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "treat_as") continue;
      if (action.whenPayingForFilter) continue;
      if (!action.appliesToCard && !action.cardStateOnly) continue;
      if (action.cardStateOnly && !sourceIsCardState) continue;
      if (!action.aspects.includes("reduction_symbol")) continue;
      if (
        action.whenUsingEffectMode !== undefined &&
        action.whenUsingEffectMode !== effectMode
      ) {
        continue;
      }

      yield action;
    }
  }
}

/** 自己充足候補を既存要求枠数で上限化する。物理シンボル供給には加えない。 */
function getSelfReductionWaiverEntries(
  options: CalculateReductionOptions,
  requestedEntries: readonly SymbolColorEntry[],
  selfActions: readonly ReductionTreatAsAction[]
): SymbolColorEntry[] {
  const source = options.sourceInstanceId
    ? getCardById(options.state, options.sourceInstanceId)
    : undefined;
  if (
    !source ||
    source.definitionId !== options.card.cardNo ||
    source.controllerPlayerId !== options.actingPlayerId ||
    source.faceDown
  )
    return [];
  const entries: SymbolColorEntry[] = [];
  for (const action of selfActions) {
    if (!action.waivesReductionRequirement) continue;
    const colors = action.waiverColors ?? [
      ...new Set(requestedEntries.flatMap((entry) => entry.colors)),
    ];
    const eligibleCount = requestedEntries.filter((entry) =>
      entry.colors.some((color) => colors.includes(color))
    ).length;
    const requested =
      action.waivesReductionRequirement === "all"
        ? eligibleCount
        : action.count === undefined
          ? 1
          : typeof action.count === "number"
            ? action.count
            : evaluateContinuousDynamicAmount(
                options.state,
                options.actingPlayerId,
                action.count,
                options.getCardDefinitionById,
                {
                  sourceTribes: getDynamicCountSourceTribes(
                    options.state,
                    source.instanceId,
                    options.card,
                    options.getCardDefinitionById
                  ),
                }
              );
    for (
      let i = 0;
      i < Math.min(eligibleCount, Math.max(0, Math.floor(requested)));
      i++
    )
      entries.push({ colors });
  }
  return entries;
}

/**
 * 召喚カードの軽減シンボルに、`treat_as { appliesToCard: true, aspects 含 reduction_symbol }`
 * の継続効果を適用して要求側 SymbolColorEntry を構築する。
 *
 * 手札ゾーンの continuous CE は `rebuildContinuousEffectsFromField` の対象外なので、
 * `card.effects` から DSL 直接読みで treat_as を抽出する。
 * condition / applicability があれば sourceInstanceId を使って評価し、不成立ならスキップ。
 *
 * 例: 軽減白×4 + treat_as red appliesToCard → 各 entry が `[white, red]` 多色エントリ化。
 */
export function getEffectiveReductionSymbolEntries(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  effectMode: "main" | "flash" | "stack" | undefined
): SymbolColorEntry[] {
  return buildEffectiveReductionSymbolEntries(
    card,
    state,
    actingPlayerId,
    getCardDefinitionById,
    sourceInstanceId,
    [
      ...getSelfReductionTreatAsActions(
        card,
        state,
        actingPlayerId,
        getCardDefinitionById,
        sourceInstanceId,
        effectMode
      ),
    ]
  );
}

function buildEffectiveReductionSymbolEntries(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  selfActions: readonly ReductionTreatAsAction[]
): SymbolColorEntry[] {
  const entries: SymbolColor[][] = card.reductionSymbols.map((c) => [c]);
  for (const action of selfActions) {
    if (action.waivesReductionRequirement) continue;
    for (const addColor of normalizeAsColors(action.asColor ?? [])) {
      if (action.addsReductionSymbol) {
        const addCount =
          action.count === undefined
            ? 1
            : typeof action.count === "number"
              ? action.count
              : evaluateContinuousDynamicAmount(
                  state,
                  actingPlayerId,
                  action.count,
                  getCardDefinitionById,
                  {
                    sourceTribes: getDynamicCountSourceTribes(
                      state,
                      sourceInstanceId,
                      card,
                      getCardDefinitionById
                    ),
                  }
                );
        for (let i = 0; i < addCount; i++) {
          entries.push([addColor]);
        }
        continue;
      }
      for (const [index, entry] of entries.entries()) {
        if (
          action.reductionSymbolBaseColors !== undefined &&
          action.reductionSymbolBaseColors.length > 0 &&
          !action.reductionSymbolBaseColors.includes(
            card.reductionSymbols[index]!
          )
        ) {
          continue;
        }
        if (!entry.includes(addColor)) entry.push(addColor);
      }
    }
  }

  // 支払い文脈限定 treat_as (whenPayingForFilter, overridesRequiredColor) は要求側の各枠の
  // 色を asColor へ置き換える (BSLH01-CX01「その軽減シンボルを<七>として扱う」型)。
  const colorOverride = getPayingForReductionColorOverride(
    state,
    actingPlayerId,
    card,
    getCardDefinitionById
  );
  // 印字・追加・置換のどの経路でも、六/七は1枠で複数色を受け付ける。
  // 展開は要求側だけに限定し、物理シンボルの数は変えない。
  return entries.map((colors) => ({
    colors: [
      ...new Set(
        (colorOverride?.length ? colorOverride : colors).flatMap((color) => {
          if (color === "seven") return [...CARD_COLORS];
          if (color === "six") return CARD_COLORS.filter((c) => c !== "black");
          return [color];
        })
      ),
    ],
  }));
}

/**
 * 自カードの継続 `cost_modify` 自己ステップから「コスト軽減下限（floor）」を収集する。
 *
 * 「このカードの配置コストは0にならない」= floor:1 /
 * 「Nコスト以上支払わなければ召喚できない」= floor:N を表現する継続自己修飾。
 * 軽減シンボル（getEffectiveReductionSymbolEntries）と同様、プレイ対象カードは
 * 手札ゾーンで CE 未登録のため `card.effects` を DSL 直接読みで抽出する。
 * 複数指定があれば最も厳しい（最大の）floor を採用。floor は印字コストを超えない。
 *
 * condition / applicability があれば sourceInstanceId を使って評価し、不成立ならスキップ。
 * 正源: 10_rules/03a §コスト軽減下限。
 */
export function getEffectiveCostFloor(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  effectMode?: "main" | "flash" | "stack"
): number {
  let floor = 0;

  for (const effect of card.effects ?? []) {
    if (effect.timing.kind !== "continuous") continue;

    const hasCondition = effect.condition && effect.condition.length > 0;
    const hasApplicability = effect.applicability !== undefined;
    if (hasCondition || hasApplicability) {
      if (!sourceInstanceId) continue;
      if (
        hasCondition &&
        !evaluateCondition(
          state,
          effect.condition!,
          sourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        hasApplicability &&
        !evaluateApplicability(
          state,
          effect.applicability!,
          sourceInstanceId,
          getCardDefinitionById,
          getCardById(state, sourceInstanceId)
            ? getCardUseSourceZone(getCardById(state, sourceInstanceId)!)
            : undefined
        )
      ) {
        continue;
      }
    }

    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "cost_modify") continue;
      if (
        action.whenUsingEffectMode !== undefined &&
        action.whenUsingEffectMode !== effectMode
      ) {
        continue;
      }
      // 自己対象のみ（player/filter ベースは他カードへの修飾で floor 対象外）。
      if (action.target?.kind !== "self") continue;
      const mod = action.modifier;
      if (typeof mod === "object" && "floor" in mod) {
        floor = Math.max(floor, mod.floor);
      }
    }
  }

  // floor は印字コストを超えない（印字 2 で floor 3 は無意味）。
  return Math.min(floor, card.cost);
}

/**
 * 自カードの継続 `cost_modify` 自己ステップから「コスト上書き（override）」を収集する。
 *
 * 「自分のカウント5以上のとき、手札/トラッシュ/煌臨元にあるこのカードをコスト5にする」
 * のような、盤面条件付きで *召喚/使用前の自カードコストを別の値に固定する* 効果を表現する。
 * `getEffectiveCostFloor` と同じく、プレイ対象カードは手札/トラッシュ等で CE 未登録のため
 * `card.effects` を DSL 直接読みで抽出し、condition / applicability を評価してゲートする。
 *
 * 複数の override 自己修飾が同時成立した場合は **最も小さい値**（コントローラー有利＝
 * 最安）を採用する。override が 1 つも成立しなければ `undefined` を返す
 * （呼び出し側が印字コストを使う）。03a §コスト軽減下限 L22「軽減シンボル/override/free
 * すべてを通した結果が floor を下回らない」を SSOT で満たすため、override の結果も
 * 後段の floor クランプを通す。
 */
function getEffectiveBaseCostOverride(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  effectMode?: "main" | "flash" | "stack"
): number | undefined {
  let override: number | undefined;

  for (const effect of card.effects ?? []) {
    if (effect.timing.kind !== "continuous") continue;

    const hasCondition = effect.condition && effect.condition.length > 0;
    const hasApplicability = effect.applicability !== undefined;
    if (hasCondition || hasApplicability) {
      if (!sourceInstanceId) continue;
      if (
        hasCondition &&
        !evaluateCondition(
          state,
          effect.condition!,
          sourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        hasApplicability &&
        !evaluateApplicability(
          state,
          effect.applicability!,
          sourceInstanceId,
          getCardDefinitionById,
          getCardById(state, sourceInstanceId)
            ? getCardUseSourceZone(getCardById(state, sourceInstanceId)!)
            : undefined
        )
      ) {
        continue;
      }
    }

    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "cost_modify") continue;
      if (
        action.whenUsingEffectMode !== undefined &&
        action.whenUsingEffectMode !== effectMode
      ) {
        continue;
      }
      // 自己対象のみ（player/filter ベースは他カードへの修飾で base override 対象外）。
      if (action.target?.kind !== "self") continue;
      const mod = action.modifier;
      if (typeof mod === "object" && "override" in mod) {
        override =
          override === undefined
            ? mod.override
            : Math.min(override, mod.override);
      }
    }
  }

  return override;
}

/**
 * 自カードの継続 `cost_modify` 自己ステップから「相対コスト加算/軽減
 * (`additionalCostValue`)」のうち **盤面依存の `DynamicCount` 指定分のみ** を収集する。
 *
 * 「アタック/ブロックしている系統：「妖精」を持つスピリット1体につき、このカードの
 * コストを-1する」(BSTH07.8-R04/X01) のような、印字コストからの相対減算を毎クエリ
 * ライブ評価する必要がある型に使う。target:self の additional_cost CE
 * (`executeAdditionalCost`) は登録時点の値を固定し (`isAlreadyRegistered` dedup で
 * 再実行されないため battleState 変化を追わない)、手札等 CE 未登録ゾーンでも動くよう
 * `getEffectiveBaseCostOverride`/`getEffectiveCostFloor` と同じ direct-read 方式で
 * `card.effects` を毎回再評価する。
 *
 * **固定値 (`number`) の additionalCostValue はここで扱わない**（既存 CE 経路
 * (`executeAdditionalCost` → `getApplicableAdditionalCostDeltaCEs` の
 * `targetInstanceId` 除外) に委ねる）。固定値の target:self additional_cost は
 * 意図的に召喚/使用コスト計算から除外されている既存カードがある
 * (BSTH01-C01「このカード/スピリットのコストは3としても扱う。ただし、召喚コストは
 * 変化しない。」)。ここで固定値も汎用的に加算すると、そのような「召喚コストには
 * 影響しない」既存カードへ意図しない加算が回帰する。DynamicCount のみ扱う本関数は
 * BSTH07.8-R04/X01 等の新規パターンでのみ発火し、既存の固定値カードには影響しない。
 */
function getEffectiveBaseCostAdditionalDelta(
  card: CardDefinition,
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string | undefined,
  effectMode?: "main" | "flash" | "stack"
): number {
  let delta = 0;

  for (const effect of card.effects ?? []) {
    if (effect.timing.kind !== "continuous") continue;

    const hasCondition = effect.condition && effect.condition.length > 0;
    const hasApplicability = effect.applicability !== undefined;
    if (hasCondition || hasApplicability) {
      if (!sourceInstanceId) continue;
      if (
        hasCondition &&
        !evaluateCondition(
          state,
          effect.condition!,
          sourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        hasApplicability &&
        !evaluateApplicability(
          state,
          effect.applicability!,
          sourceInstanceId,
          getCardDefinitionById,
          getCardById(state, sourceInstanceId)
            ? getCardUseSourceZone(getCardById(state, sourceInstanceId)!)
            : undefined
        )
      ) {
        continue;
      }
    }

    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind !== "cost_modify") continue;
      // 自己対象のみ（player/filter ベースは既存 additional_cost CE 経路が扱う）。
      if (action.target?.kind !== "self") continue;
      if (
        action.whenUsingEffectMode !== undefined &&
        action.whenUsingEffectMode !== effectMode
      ) {
        continue;
      }
      // useCostPayment 併用 (可変枚数除外/破棄等) の additionalCostValue は
      // 1件あたりの単価であり、選択枚数との乗算は各専用ハンドラ
      // (summon-cost-exclude-choice.ts 等) が既に additionalCostModifiers として
      // 個別に積む。ここで単価をそのまま加算すると、選択が未確定の場合でも
      // 固定で1件分適用してしまい二重計上になる (BSTH02.7-M01/X02 等)。
      if (action.useCostPayment !== undefined) continue;
      const mod = action.modifier;
      if (typeof mod !== "object" || !("additionalCostValue" in mod)) continue;
      const { additionalCostValue } = mod;
      // 固定値 (number) は既存 CE 経路 (targetInstanceId 除外) に委ねる。DynamicCount
      // のみここで direct-read する（本関数冒頭のコメント参照）。
      if (typeof additionalCostValue === "number") continue;
      delta += evaluateContinuousDynamicAmount(
        state,
        actingPlayerId,
        additionalCostValue,
        getCardDefinitionById
      );
    }
  }

  return delta;
}

interface ReductionMatch {
  requestIdx: number;
  supplyIdx: number;
  // 導(guide)/神(god) など特殊シンボルも軽減シンボルとして成立しうるため SymbolColor。
  pivotColor: SymbolColor;
}

interface ReductionSourceLimit {
  sourceFilter: CardFilter;
  maxSymbols: number;
}

/**
 * 要求側エントリ × 供給側エントリ の最大二部マッチングを求める。
 * 各 entry は 1 色しか使えない (片側使用ルール)。マッチ数 = 軽減量。
 *
 * バックトラック + pruning。要求側 / 供給側ともに通常 ≤ 8 程度なので十分高速。
 * pivot 色は両 entry の色集合の共通要素から、要求 entry に最初に出現する色を採用
 * (= printed reductionSymbol を優先)。
 */
function findMaxReductionMatching(
  requests: readonly SymbolColorEntry[],
  supplies: readonly SymbolColorEntry[],
  supplyLimitIndexes: readonly (readonly number[])[] = [],
  sourceLimits: readonly ReductionSourceLimit[] = []
): ReductionMatch[] {
  const supplyUsed = new Array<boolean>(supplies.length).fill(false);
  const sourceLimitCounts = new Map<string, number>();
  const current: ReductionMatch[] = [];
  let best: ReductionMatch[] = [];

  const limitCountKey = (limitIndex: number, supplyIndex: number): string => {
    const sourceId = supplies[supplyIndex]?.sourceInstanceId ?? supplyIndex;
    return `${limitIndex}:${sourceId}`;
  };

  function backtrack(reqIdx: number): void {
    // Pruning: 残り全部マッチしても best を超えないなら打ち切り
    if (current.length + (requests.length - reqIdx) <= best.length) return;

    if (reqIdx === requests.length) {
      if (current.length > best.length) best = [...current];
      return;
    }

    const req = requests[reqIdx]!;

    for (let s = 0; s < supplies.length; s++) {
      if (supplyUsed[s]) continue;
      const supply = supplies[s]!;
      // pivot は要求 entry と供給 entry の共通シンボル。導/神 等の特殊シンボルも
      // そのまま軽減シンボルとして成立する (isCardColor で絞ると 導↔導 が不成立になる)。
      let pivot: SymbolColor | undefined;
      for (const c of req.colors) {
        if (supply.colors.includes(c)) {
          pivot = c;
          break;
        }
      }
      if (pivot === undefined) continue;
      const limitIndexes = supplyLimitIndexes[s] ?? [];
      if (
        limitIndexes.some((limitIndex) => {
          const key = limitCountKey(limitIndex, s);
          return (
            (sourceLimitCounts.get(key) ?? 0) >=
            sourceLimits[limitIndex]!.maxSymbols
          );
        })
      ) {
        continue;
      }
      supplyUsed[s] = true;
      for (const limitIndex of limitIndexes) {
        const key = limitCountKey(limitIndex, s);
        sourceLimitCounts.set(key, (sourceLimitCounts.get(key) ?? 0) + 1);
      }
      current.push({ requestIdx: reqIdx, supplyIdx: s, pivotColor: pivot });
      backtrack(reqIdx + 1);
      current.pop();
      for (const limitIndex of limitIndexes) {
        const key = limitCountKey(limitIndex, s);
        const next = (sourceLimitCounts.get(key) ?? 0) - 1;
        if (next <= 0) sourceLimitCounts.delete(key);
        else sourceLimitCounts.set(key, next);
      }
      supplyUsed[s] = false;
    }

    // この要求をスキップ
    backtrack(reqIdx + 1);
  }

  backtrack(0);
  return best;
}

/**
 * 軽減が最大限に適用されていることを検証する。
 * ルール: 「軽減できるなら必ず軽減する」。
 * 各色で applied は requested と available の上限を超えない。
 * 多色シンボルの片側使用制約がある場合、色ごとの applied が
 * min(requested, available) 未満になることがあるが、全体の
 * totalReduction は calculateReduction() の最適割当で保証される。
 */
export function assertReductionIsMaximal(reduction: ReductionResult): void {
  for (const entry of reduction.reductionBreakdown) {
    if (entry.applied > Math.min(entry.requested, entry.available)) {
      throw new Error(
        `Reduction exceeds limits: color=${entry.color} applied=${entry.applied} max=${Math.min(entry.requested, entry.available)} (requested=${entry.requested} available=${entry.available})`
      );
    }

    if (entry.applied < 0) {
      throw new Error(
        `Reduction applied must be non-negative: color=${entry.color} applied=${entry.applied}`
      );
    }
  }
}

/**
 * `prevent_cost_reduction` CE（BSTH07.8-C03 Lv2「相手はネクサスを配置するとき、
 * 軽減できない」）が actingPlayerId のこの支払いを軽減無効化しているか判定する。
 * `restrict_use`（使用そのものを禁止）とは別軸: これは symbol matching / waiver
 * だけを無効化し、additionalCost / costFloor / baseCostOverride には影響しない。
 */
function isCostReductionBlocked(
  state: GameState,
  actingPlayerId: string,
  card: CardDefinition,
  useKind: DSL.CardUseKind | undefined
): boolean {
  const candidateCEs = getCEsForTarget(state, actingPlayerId);
  for (const ce of candidateCEs) {
    if (ce.modifierTag !== "prevent_cost_reduction" || !ce.metadata) continue;
    const filter = ce.metadata.filter as
      | Parameters<typeof matchesCardFilterByDef>[1]
      | undefined;
    if (!filter) continue;
    const restrictedKinds = ce.metadata.restrictedKinds as
      | DSL.CardUseKind[]
      | undefined;
    // useKind 不明時は restrict_use と同じ既定 (legal-actions-shared.ts の
    // isCardUseRestricted usageKind 判定と同型): 種別限定 CE は不成立とみなし
    // 軽減をブロックしない (fail-open)。呼び出し元ごとに printedCategory から
    // 当て推量すると、restrict_use のコストフィルタ計算等 useKind と無関係な
    // calculateReduction 呼び出しまで誤って汚染する (round2 verifier 指摘)。
    if (restrictedKinds && (!useKind || !restrictedKinds.includes(useKind))) {
      continue;
    }
    if (matchesCardFilterByDef(card, filter)) return true;
  }
  return false;
}

function getCostReductionSourceLimits(
  state: GameState,
  actingPlayerId: string,
  useKind: DSL.CardUseKind | undefined
): ReductionSourceLimit[] {
  const limits: ReductionSourceLimit[] = [];
  const candidateCEs = getCEsForTarget(state, actingPlayerId);
  for (const ce of candidateCEs) {
    if (ce.modifierTag !== "limit_cost_reduction" || !ce.metadata) continue;
    const sourceFilter = ce.metadata.sourceFilter as CardFilter | undefined;
    const maxSymbols = ce.metadata.maxSymbols;
    if (!sourceFilter || typeof maxSymbols !== "number") continue;
    const restrictedKinds = ce.metadata.restrictedKinds as
      | DSL.CardUseKind[]
      | undefined;
    if (restrictedKinds && (!useKind || !restrictedKinds.includes(useKind))) {
      continue;
    }
    limits.push({
      sourceFilter,
      maxSymbols: Math.max(0, Math.floor(maxSymbols)),
    });
  }
  return limits;
}

function sourceEntryMatchesReductionLimit(
  entry: SymbolColorEntry,
  limit: ReductionSourceLimit,
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  if (!entry.sourceInstanceId) return false;
  const sourceCard = state.cardInstances.find(
    (cardInstance) => cardInstance.instanceId === entry.sourceInstanceId
  );
  if (!sourceCard) return false;
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return false;
  // 軽減に使うシンボルの供給元を参照する。供給元ネクサスへの作用ではない。
  return matchesCardReferenceFilter(sourceCard, sourceDef, limit.sourceFilter, {
    state,
    getCardDefinitionById,
    cardZone: sourceCard.zone,
    effectiveColors: getEffectiveColors(state, sourceCard, sourceDef),
    effectiveTribes: getEffectiveTribes(
      state,
      sourceCard,
      sourceDef,
      getCardDefinitionById
    ),
  });
}

function getSupplyLimitIndexes(
  supplyEntries: readonly SymbolColorEntry[],
  sourceLimits: readonly ReductionSourceLimit[],
  state: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): readonly number[][] {
  return supplyEntries.map((entry) => {
    const indexes: number[] = [];
    for (let i = 0; i < sourceLimits.length; i++) {
      if (
        sourceEntryMatchesReductionLimit(
          entry,
          sourceLimits[i]!,
          state,
          getCardDefinitionById
        )
      ) {
        indexes.push(i);
      }
    }
    return indexes;
  });
}

/** フィールド参照シンボルの正源。非fieldの拡張はカードを移動せず一度だけ加える。
 * 支払い限定拡張は sourceInstanceId を明示した文脈だけで有効。
 */
export function getFieldSymbolSources({
  state,
  actingPlayerId,
  getCardDefinitionById,
  sourceInstanceId,
  excludeFieldInstanceIds,
}: Pick<
  CalculateReductionOptions,
  | "state"
  | "actingPlayerId"
  | "getCardDefinitionById"
  | "sourceInstanceId"
  | "excludeFieldInstanceIds"
>): FieldSymbolSource[] {
  const battleEntitySourceMap = createBattleEntitySourceMap(state);
  const underCardIds = collectUnderCardScopeIds(state);
  // 魂状態のカードはシンボルで軽減不可
  const soulStateIds = getEffectiveSoulStateIds(state, getCardDefinitionById);
  const fieldSymbolSources = state.cardInstances
    .filter((cardInstance) => cardInstance.zone === "field")
    .filter(
      (cardInstance) => cardInstance.controllerPlayerId === actingPlayerId
    )
    // Ver.17.0: 待機状態でもシンボルで軽減可能（pendingLeaveKind による除外を撤廃）
    .filter((cardInstance) => cardInstance.attachedToInstanceId === null)
    .filter((cardInstance) => cardInstance.imaginRightCombinedWith === null)
    // 煌臨元などは zone:field / attachedToInstanceId:null でも独立した供給源ではない。
    // 本文による下のカードのシンボル追加は host の symbol bundle 側で反映する。
    .filter(
      (cardInstance) =>
        !underCardIds.adventSource.has(cardInstance.instanceId) &&
        !underCardIds.textRole.has(cardInstance.instanceId)
    )
    .filter((cardInstance) => !soulStateIds.has(cardInstance.instanceId))
    // 逆転醒（自身が場にいる）の「自身のシンボルでは軽減不可」(08a §逆転醒)。
    .filter(
      (cardInstance) =>
        !excludeFieldInstanceIds?.includes(cardInstance.instanceId)
    )
    .map((cardInstance) =>
      getFieldSymbolSource(
        cardInstance,
        battleEntitySourceMap,
        state,
        getCardDefinitionById
      )
    )
    .filter((source): source is FieldSymbolSource => source !== null);

  const seen = new Set(
    fieldSymbolSources.map((source) => source.sourceInstanceId)
  );
  for (const card of getExtendedFieldSymbolSourceCards(
    state,
    actingPlayerId,
    getCardDefinitionById,
    sourceInstanceId
  )) {
    if (
      seen.has(card.instanceId) ||
      excludeFieldInstanceIds?.includes(card.instanceId)
    )
      continue;
    const source = getFieldSymbolSource(
      card,
      battleEntitySourceMap,
      state,
      getCardDefinitionById
    );
    if (source) {
      fieldSymbolSources.push(source);
      seen.add(card.instanceId);
    }
  }
  return fieldSymbolSources;
}

export function calculateReduction(
  options: CalculateReductionOptions
): ReductionResult {
  const fieldSymbolSources = getFieldSymbolSources(options);

  // 要求側エントリ: card.reductionSymbols に treat_as { appliesToCard:true,
  // aspects 含 reduction_symbol } の継続効果を適用して multi-color 化
  // (例: 軽減白×4 + treat_as red → 各 entry が [white, red])。
  const selfActions = [
    ...getSelfReductionTreatAsActions(
      options.card,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.sourceInstanceId,
      options.effectMode
    ),
  ];
  const requestedEntries = buildEffectiveReductionSymbolEntries(
    options.card,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId,
    selfActions
  );

  // 供給側エントリ (field カードの実効シンボル, 既に getEffectiveSymbolBundles で
  // treat_as / symbol_addition / override を反映済み)。
  // 支払い文脈限定 treat_as (whenPayingForFilter, 例 BSSA01-C01 夜錆召喚/配置時に白/紫) は
  // CE 非登録なので、支払い対象カード (options.card) との照合をここで解決して加色する。
  const supplyEntries = fieldSymbolSources.flatMap((source) => {
    const entries = applyPayingForTreatAsToSupply(
      options.state,
      source,
      options.card,
      options.actingPlayerId,
      options.getCardDefinitionById
    );
    return entries.map((entry) => ({
      ...entry,
      sourceInstanceId: source.sourceInstanceId,
      sourceDefinitionId: source.sourceDefinitionId,
    }));
  });

  // limit_cost_reduction CE (BSTH07-転醒R01(A) Lv2) は供給源カード単位の
  // 軽減シンボル使用数上限。単純な entries.slice(0, cap) では多色/複数制限の
  // 最適割当を落とし得るため、matching 中に source ごとの cap を評価する。
  const sourceLimits = getCostReductionSourceLimits(
    options.state,
    options.actingPlayerId,
    options.useKind
  );
  const supplyLimitIndexes = getSupplyLimitIndexes(
    supplyEntries,
    sourceLimits,
    options.state,
    options.getCardDefinitionById
  );

  const selfWaiverEntries = getSelfReductionWaiverEntries(
    options,
    requestedEntries,
    selfActions
  );
  // 自己充足と通常供給を同時に割り当てる。M01の黄免除を残して複合供給を白へ回す等、
  // 通常供給だけの先行割当では落とす最大軽減を保つ。自己充足は既存枠しか消費しない。
  // 二部マッチング: 各要求エントリ × 各供給エントリで色集合の共通要素を介してマッチ。
  // マッチ数 = 軽減量。要求 / 供給ともに片側使用ルール (1 entry = 1 マッチ)。
  const matches = findMaxReductionMatching(
    requestedEntries,
    [...supplyEntries, ...selfWaiverEntries],
    supplyLimitIndexes,
    sourceLimits
  );

  // prevent_cost_reduction CE (BSTH07.8-C03 Lv2) が成立していれば、要求/供給の
  // 内訳表示 (breakdown) は残しつつ、実際の軽減適用 (applied / totalReduction /
  // waiver) だけを 0 にする。additionalCost / costFloor / baseCostOverride は
  // 軽減とは独立した別要素のため対象外。
  const reductionBlocked = isCostReductionBlocked(
    options.state,
    options.actingPlayerId,
    options.card,
    options.useKind
  );

  // 色別カウント (UI / 旧 breakdown 互換)。
  // requested[c] = 「色 c として要求しうる entry 数」(multi-color entry は重複カウントされる)
  // available[c] = 「色 c として供給しうる entry 数」(同上)
  // applied[c]   = pivot 色が c だったマッチ数 (sum = totalReduction)
  const requestedCounts = createEmptyColorCounter();
  const availableCounts = createEmptyColorCounter();
  const appliedCounts = createEmptyColorCounter();

  for (const entry of requestedEntries) {
    for (const c of entry.colors) {
      if (isCardColor(c)) requestedCounts[c]++;
    }
  }
  for (const entry of supplyEntries) {
    for (const c of entry.colors) {
      if (isCardColor(c)) availableCounts[c]++;
    }
  }
  if (!reductionBlocked) {
    for (const m of matches) {
      if (m.supplyIdx >= supplyEntries.length) continue;
      // appliedCounts は基本色のみ (breakdown は CARD_COLORS ベース)。
      // 特殊シンボル pivot のマッチは totalReduction(matches.length) に算入されるが
      // 色別 breakdown には現れない。
      if (isCardColor(m.pivotColor)) appliedCounts[m.pivotColor]++;
    }
  }

  const reductionBreakdown = CARD_COLORS.map((color) => ({
    color,
    requested: requestedCounts[color],
    available: availableCounts[color],
    applied: appliedCounts[color],
  })).filter((entry) => entry.requested > 0 || entry.available > 0);

  // 支払い文脈限定 treat_as (whenPayingForFilter, waivesReductionRequirement) は色供給と
  // 無関係に枠を満たすため、通常マッチングの結果とは別に加算する。マッチ済み枠を除いた
  // 残り未充足枠だけを免除対象候補にする（printed 軽減シンボル枠数を超えて軽減しない）。
  // `waiverColors` 指定時、この未充足エントリの `.colors` で色一致を判定する
  // (getPayingForReductionWaiverCount 側)。
  const matchedRequestIndexes = new Set(matches.map((m) => m.requestIdx));
  const unmatchedRequestedEntries = requestedEntries.filter(
    (_, i) => !matchedRequestIndexes.has(i)
  );
  const waiverCount = getPayingForReductionWaiverCount(
    options.state,
    options.actingPlayerId,
    options.card,
    options.getCardDefinitionById,
    unmatchedRequestedEntries
  );
  const cappedWaiverCount = reductionBlocked
    ? 0
    : Math.max(
        0,
        Math.min(waiverCount, requestedEntries.length - matches.length)
      );
  const totalReduction = reductionBlocked
    ? 0
    : matches.length + cappedWaiverCount;

  // 盤面条件付きの自カードコスト上書き（override）: 「カウント5以上のとき手札/トラッシュ/
  // 煌臨元のこのカードをコスト5にする」型。成立時は印字コストの代わりに override 値を
  // base コストとして使い、軽減 / floor / 追加コストは override 後の値に適用する
  // （03a §コスト軽減下限 L22「軽減シンボル/override/free すべてを通した結果が floor を
  // 下回らない」）。SSOT のため availability / resolution / accel 全経路に反映。
  const baseCostOverride =
    options.baseCostOverride ??
    getEffectiveBaseCostOverride(
      options.card,
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById,
      options.sourceInstanceId,
      options.effectMode
    );
  const baseCost = baseCostOverride ?? options.card.cost;

  // コスト軽減下限（floor）: 「0にならない」= floor:1 / 「Nコスト以上」= floor:N。
  // 軽減後コストを floor 未満に下げない（03a §コスト軽減下限、SSOT）。
  const costFloor = getEffectiveCostFloor(
    options.card,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId,
    options.effectMode
  );
  const reducedCost = Math.max(
    costFloor,
    Math.max(0, baseCost - totalReduction)
  );
  // player/filter 指定の相対コスト加算/軽減 (additional_cost CE の targetFilter 版、
  // 例 BSLH01「自分の導力器トークンマジックの使用コストを-1する」)。cost_override と異なり
  // 加算元は支払い対象カード自身ではなく player 全体に及ぶ grand-scope CE のため、
  // 呼び出し側の additionalCostModifiers 手動配線を不要にしここで自動合流させる
  // (全コスト計算経路: summon/place_nexus/set_mirage/use_magic/accel/change)。
  const sourceCardInstance = options.sourceInstanceId
    ? options.state.cardInstances.find(
        (c) => c.instanceId === options.sourceInstanceId
      )
    : undefined;
  const sourceCardDefinition = sourceCardInstance
    ? options.getCardDefinitionById(sourceCardInstance.definitionId)
    : undefined;
  const continuousEffectDelta = getApplicableAdditionalCostDelta(
    options.state,
    options.actingPlayerId,
    options.card,
    {
      ...(sourceCardInstance ? { card: sourceCardInstance } : {}),
      effectiveColors: getEffectiveColors(
        options.state,
        sourceCardInstance,
        sourceCardDefinition ?? options.card
      ),
      effectiveTribes: getEffectiveTribes(
        options.state,
        sourceCardInstance,
        sourceCardDefinition ?? options.card,
        options.getCardDefinitionById
      ),
      ...(sourceCardInstance ? { cardZone: sourceCardInstance.zone } : {}),
      ...(options.effectMode !== undefined
        ? { cardEffectMode: options.effectMode }
        : {}),
      ...(options.summonCause !== undefined
        ? { summonCause: options.summonCause }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
  // 自カード継続 cost_modify 自己ステップの相対加算/軽減 (additionalCostValue、
  // DynamicCount 対応)。手札等 CE 未登録ゾーンでも毎クエリ direct-read で再評価する
  // (getEffectiveBaseCostAdditionalDelta 参照)。
  const selfAdditionalCostDelta = getEffectiveBaseCostAdditionalDelta(
    options.card,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId,
    options.effectMode
  );
  const modifiers = [
    ...(options.additionalCostModifiers ?? []),
    ...(continuousEffectDelta !== 0
      ? [
          {
            amount: continuousEffectDelta,
            reason: "continuous_effect:additional_cost",
          },
        ]
      : []),
    ...(selfAdditionalCostDelta !== 0
      ? [
          {
            amount: selfAdditionalCostDelta,
            reason: "self_cost_modify:additional_cost",
          },
        ]
      : []),
  ];
  const additionalCost = modifiers.reduce((sum, m) => sum + m.amount, 0);

  return {
    printedCost: baseCost,
    effectiveCost: baseCost,
    totalReduction,
    satisfiedReductionSymbolCount: totalReduction,
    requiredReductionSymbolCount: requestedEntries.length,
    reducedCost,
    additionalCost,
    finalCost: Math.max(0, reducedCost + additionalCost),
    reductionBreakdown,
    fieldSymbolSources,
    additionalCostModifiers: modifiers,
  };
}

/**
 * 「コストを支払わずに使用できる」「N コストで使用できる」型の特殊
 * base cost に、通常コスト計算と同じ floor + additional_cost 順序を適用する。
 */
export function calculateSpecialCostFinalCost(
  costFloor: number,
  specialBaseCost: number,
  additionalCost: number
): number {
  const reducedCost = Math.max(costFloor, Math.max(0, specialBaseCost));
  return Math.max(0, reducedCost + additionalCost);
}

/**
 * 「軽減シンボルすべてを満たしたもの」として召喚コストを計算する
 * (`SummonAction.costModifier:"full_reduction"` / BSAZ02-C08【月面基地】発揮元疲労代替コスト
 * 等、実際の色供給に関わらず印字済み軽減シンボル枠を全て消化したとみなす経路の共通 SSOT)。
 * calculateReduction の実マッチング結果 (reductionBreakdown) ではなく、印字済み軽減シンボル
 * 枠数 (getEffectiveReductionSymbolEntries) をそのまま差し引く点が通常軽減と異なる。
 * additionalCost (使用時コスト等の加算) は通常軽減と同様 calculateReduction から引き継ぐ。
 */
export function calculateFullReductionSummonCost(options: {
  state: GameState;
  actingPlayerId: string;
  definition: CardDefinition;
  sourceInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  summonCause?: "effect" | "burst";
}): number {
  const reduction = calculateReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.definition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    ...(options.summonCause !== undefined
      ? { summonCause: options.summonCause }
      : {}),
  });
  const requestedSlotCount = getEffectiveReductionSymbolEntries(
    options.definition,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId,
    undefined
  ).length;
  const floor = getEffectiveCostFloor(
    options.definition,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId
  );
  const baseCost = reduction.effectiveCost ?? reduction.printedCost;
  const reducedCost = Math.max(
    floor,
    Math.max(0, baseCost - requestedSlotCount)
  );
  return Math.max(0, reducedCost + reduction.additionalCost);
}
