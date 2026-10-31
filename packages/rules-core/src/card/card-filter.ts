// ============================================================
// CardFilter マッチング — 統一カードフィルタの実行時評価
// ============================================================

import type {
  BattleEntity,
  CardCategory,
  CardColor,
  CardDefinition,
  CardInstance,
  Condition,
  ContinuousEffect,
  GameState,
  Zone,
} from "../model";
import {
  adventSourceIdsOf,
  cardDefinitionHasMechanic,
  cardHasPrintedBurstEffectHeader,
  countUniqueColors,
  grandwalkerKindMatches,
  getPrintedSymbolEntries,
  immuneProtectedCount,
  isGrandstoneNexus,
  isGrandwalkerOrGuidedNexus,
  matchesColorCount,
  underCardRoleTagsEqual,
} from "../model";
import type {
  CardFilter,
  CardNameMatch,
  CardNameMatchFromStepRef,
  CardNameMatchSource,
  CoreLocation,
  CostCEFilterFields,
  DynamicCount,
  DynamicCountSource,
  Effect,
  EffectStep,
  PlayerRef,
} from "../dsl-types";
import { getStepResult } from "../step-execution-context";
import type { StepExecutionContext } from "../step-execution-context";
import { getCEsForTarget, getGlobalCEs } from "./ce-lookup";
import { getCardById } from "./card-lookup";
import { matchesTribes } from "./tribe-filter";
import {
  getEffectiveCategories,
  getEffectiveCategory,
  isAttachedCombinedChild,
  resolveActAsSpiritLevelDefinitions,
} from "../mechanics/act-as-spirit";
import {
  getVirtualCombinedBraves,
  isEffectivelyCombined,
} from "../mechanics/virtual-combine";
import { effectMatchesCardEventLabel } from "../effect/effect-label-utils";
import { countEffectiveUnderCardRole } from "../mechanics/under-card-role";

export { matchesTribes, tribeContainsExcludedSubstring } from "./tribe-filter";

// ============================================================
// Public API
// ============================================================

/** 宣言前スタックと、その応答解決後の成立待ちを同じ基準で照合する。 */
export function matchesPendingBattleDeclaration(
  state: Partial<
    Pick<
      GameState,
      "preDeclarationStackWindow" | "pendingPreDeclarationConfirmation"
    >
  >,
  instanceId: string,
  declaration: "attack" | "block" | "in_battle"
): boolean {
  const win =
    state.preDeclarationStackWindow ?? state.pendingPreDeclarationConfirmation;
  if (!win) return false;
  const sourceIds = [
    win.sourceInstanceId,
    ...(win.additionalSourceInstanceIds ?? []),
  ];
  if (!sourceIds.includes(instanceId)) return false;
  if (declaration === "in_battle") return true;
  if (declaration === "attack")
    return win.kind === "attack" || win.kind === "join_active_attack";
  return win.kind === "block" || win.kind === "forced_block";
}

/**
 * 「契約カード」判定の SSOT。印字カード種類（契約スピリット / 契約ネクサス等）を
 * 正規化した keywordTags の "contract" だけで判定する。
 * adventData はそのカードが煌臨を宣言する側であることを表し、契約煌臨カードを
 * 契約カード本体として扱う根拠にはならない。card-filter (isContract:true) /
 * state-based-actions の契約特殊ルール / advent-system の契約煌臨判定 /
 * ConditionClause `contracts_only_mono_color` の全てがこの判定を共有する。
 */
export function isContractDefinition(def: CardDefinition): boolean {
  return def.keywordTags?.includes("contract") ?? false;
}

/**
 * 「契約カードの煌臨先(host)」判定の SSOT。対象カードの `underCards`
 * (role='advent_source') のいずれかが契約カード (`isContractDefinition`) であれば true。
 * `isContract`/`adventSourceScope` は煌臨元→契約カードの片方向判定のみで host 側からの
 * 逆引きを提供しないため新設 (ENGINE-persistent-recovery-block-with-advent-host-exclusion、
 * BSTH11-X01)。state/getCardDefinitionById が無い呼び出しは保守的に false を返す。
 */
export function isContractAdventHost(
  card: CardInstance,
  opts?: Pick<MatchCardFilterOptions, "state" | "getCardDefinitionById">
): boolean {
  if (!opts?.state || !opts.getCardDefinitionById) return false;
  const getCardDefinitionById = opts.getCardDefinitionById;
  const cardInstances = opts.state.cardInstances;
  return adventSourceIdsOf(card).some((instanceId) => {
    const underCard = cardInstances.find((c) => c.instanceId === instanceId);
    const underDef = underCard && getCardDefinitionById(underCard.definitionId);
    return underDef ? isContractDefinition(underDef) : false;
  });
}

/**
 * 「トークンカード」判定の SSOT。`maxTokenDeckCount` が設定されている
 * （デッキに入れられず、`from_token_pool` 召喚でのみ場に出せるカード）。
 * `getAvailableTokenSummonCount`（structured-summon.ts）と同じ判定基準を、
 * card-filter (CardFilter.isToken) 側から参照する。
 */
export function isCardDefinitionToken(def: CardDefinition): boolean {
  return def.maxTokenDeckCount !== undefined;
}

export type MainDeckValidationIssueKind =
  | "unavailable"
  | "too_many_copies"
  | "too_many_contract_types";

export interface MainDeckValidationIssue {
  kind: MainDeckValidationIssueKind;
  cardNo?: string;
  index?: number;
  reason?: string;
  count?: number;
  maxDeckCount?: number;
  contractCardNos?: string[];
}

const DEFAULT_MAIN_DECK_MAX_COUNT = 3;

export function getCardDefinitionMainDeckMaxCount(def: CardDefinition): number {
  if (isCardDefinitionToken(def)) return 0;
  const maxDeckCount = def.maxDeckCount ?? DEFAULT_MAIN_DECK_MAX_COUNT;
  if (!Number.isFinite(maxDeckCount)) return 0;
  return Math.max(0, Math.floor(maxDeckCount));
}

export function getCardDefinitionMainDeckUnavailableReason(
  def: CardDefinition
): string | null {
  if (isCardDefinitionToken(def)) return "token";
  if (getCardDefinitionMainDeckMaxCount(def) <= 0) return "maxDeckCount=0";
  return null;
}

/**
 * 通常デッキへ入れられるカード定義の SSOT。
 *
 * `maxDeckCount:0` は「通常デッキ投入不可」を表す。トークンカードは
 * `maxTokenDeckCount` で管理されるトークンプール専用カードなので、通常デッキ候補から
 * も除外する。
 */
export function isCardDefinitionMainDeckAllowed(def: CardDefinition): boolean {
  return getCardDefinitionMainDeckMaxCount(def) > 0;
}

export function validateMainDeckDefinitions(
  deck: readonly CardDefinition[]
): MainDeckValidationIssue[] {
  const issues: MainDeckValidationIssue[] = [];
  const counts = new Map<
    string,
    { def: CardDefinition; count: number; firstIndex: number }
  >();
  const contractCardNos: string[] = [];
  const seenContractCardNos = new Set<string>();

  deck.forEach((def, index) => {
    const unavailableReason = getCardDefinitionMainDeckUnavailableReason(def);
    if (unavailableReason) {
      issues.push({
        kind: "unavailable",
        cardNo: def.cardNo,
        index,
        reason: unavailableReason,
      });
    }

    const current = counts.get(def.cardNo);
    if (current) {
      current.count += 1;
    } else {
      counts.set(def.cardNo, { def, count: 1, firstIndex: index });
    }

    if (isContractDefinition(def) && !seenContractCardNos.has(def.cardNo)) {
      seenContractCardNos.add(def.cardNo);
      contractCardNos.push(def.cardNo);
    }
  });

  for (const [cardNo, entry] of counts) {
    const maxDeckCount = getCardDefinitionMainDeckMaxCount(entry.def);
    if (maxDeckCount > 0 && entry.count > maxDeckCount) {
      issues.push({
        kind: "too_many_copies",
        cardNo,
        index: entry.firstIndex,
        count: entry.count,
        maxDeckCount,
      });
    }
  }

  if (contractCardNos.length > 1) {
    issues.push({
      kind: "too_many_contract_types",
      cardNo: contractCardNos[1]!,
      contractCardNos,
    });
  }

  return issues;
}

export function describeMainDeckValidationIssue(
  issue: MainDeckValidationIssue
): string {
  switch (issue.kind) {
    case "unavailable":
      return `${issue.cardNo ?? "(unknown)"} is unavailable for main decks (${issue.reason ?? "unavailable"})`;
    case "too_many_copies":
      return `${issue.cardNo ?? "(unknown)"} has ${issue.count ?? 0} copies, maxDeckCount=${issue.maxDeckCount ?? 0}`;
    case "too_many_contract_types":
      return `contract cards must be one type per deck: ${(issue.contractCardNos ?? []).join(", ")}`;
  }
}

export function sanitizeMainDeckDefinitions(
  deck: readonly CardDefinition[]
): CardDefinition[] {
  const result: CardDefinition[] = [];
  const counts = new Map<string, number>();
  let selectedContractCardNo: string | null = null;

  for (const def of deck) {
    const maxDeckCount = getCardDefinitionMainDeckMaxCount(def);
    if (maxDeckCount <= 0) continue;
    if (isContractDefinition(def)) {
      if (
        selectedContractCardNo !== null &&
        selectedContractCardNo !== def.cardNo
      ) {
        continue;
      }
      selectedContractCardNo = def.cardNo;
    }

    const count = counts.get(def.cardNo) ?? 0;
    if (count >= maxDeckCount) continue;
    counts.set(def.cardNo, count + 1);
    result.push(def);
  }

  return result;
}

function resolveEffectiveCategoryOptions(
  state: NonNullable<MatchCardFilterOptions["state"]>,
  card: CardInstance,
  def: CardDefinition,
  opts?: Pick<
    MatchCardFilterOptions,
    "fieldCategoryContext" | "getCardDefinitionById" | "ignoreCategoryExclusion"
  >
): Pick<MatchCardFilterOptions, "effectiveCategory" | "effectiveCategories"> {
  const effectiveCategory = getEffectiveCategory(
    state,
    card,
    def,
    opts?.ignoreCategoryExclusion
  );
  if (effectiveCategory === undefined) {
    return { effectiveCategory };
  }
  const effectiveCategories: CardCategory[] =
    opts?.fieldCategoryContext === true
      ? getEffectiveCategories(
          state as Parameters<typeof getEffectiveCategories>[0],
          card,
          def,
          opts.getCardDefinitionById,
          opts.ignoreCategoryExclusion
        )
      : [effectiveCategory];
  if (
    isMagicCompatibleCardForm(card, def) &&
    !effectiveCategories.includes("magic")
  ) {
    effectiveCategories.push("magic");
  }
  return { effectiveCategory, effectiveCategories };
}

export function isMagicCompatibleDefinition(def: CardDefinition): boolean {
  return (
    def.printedCategory === "brave" &&
    (def.keywordTags?.includes("magic_compatible") ?? false)
  );
}

export function isArtsTokenMagicDefinition(def: CardDefinition): boolean {
  return (
    def.printedCategory === "magic" &&
    def.continuousSummonCondition === true &&
    def.summonCondition !== undefined &&
    isCardDefinitionToken(def)
  );
}

export function isMagicCompatibleCardForm(
  card: CardInstance,
  def: CardDefinition
): boolean {
  return (
    !card.faceDown && card.zone !== "field" && isMagicCompatibleDefinition(def)
  );
}

export function isMagicLikeCardForm(
  card: CardInstance,
  def: CardDefinition
): boolean {
  return (
    def.printedCategory === "magic" || isMagicCompatibleCardForm(card, def)
  );
}

export interface MatchCardFilterOptions {
  /** このインスタンスを除外する（「自身以外」） */
  excludeInstanceId?: string;
  /** 魂状態インスタンスIDのセット。省略時は魂状態チェックをスキップ */
  soulStateIds?: ReadonlySet<string>;
  /**
   * アンダーカード（下に置かれたカード）の包含スコープ判定用 instanceId 集合
   * （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
   * `collectUnderCardScopeIds(state)`（model）を SSOT として呼び出し側が注入する。
   * 省略時はアンダーカードチェックをスキップ（場外カードのフィルタ等で不要なとき）。
   *   - `textRole` に含まれる instance は filter に関わらず**常に除外**（無印スコープ外）。
   *   - `adventSource` に含まれる instance は `filter.adventSourceScope === "include"`
   *     のときのみ対象に残す（「煌臨元を含む「X」」）。それ以外は除外。
   */
  underCardIds?: {
    adventSource: ReadonlySet<string>;
    textRole: ReadonlySet<string>;
  };
  /** 効果発動元カードの定義（cardName: "self" 解決用） */
  sourceDefinition?: CardDefinition;
  /** 「コストはXとしても扱う」による追加コスト値。印刷コストに加えてこれらの値でもフィルタ判定する */
  additionalCosts?: readonly number[];
  /**
   * 発揮前の未解決スタック等、カード提示時に固定済みの現在コスト。
   * 指定時は `costBasis:"printed"` 以外の minCost/maxCost 判定で印字コストの代わりに
   * この値を見る。`additionalCosts` は「コストはXとしても扱う」候補として併用する。
   * 公式Q26497: 効果発揮前までは使用時に下がったコストで無効化可。
   */
  effectiveCost?: number | undefined;
  /** 発揮元カードの使用時に実際に満たした軽減シンボル枠数。 */
  satisfiedReductionSymbolCount?: number | undefined;
  /** 発揮元カードの使用時に要求された軽減シンボル枠数（追加軽減シンボル込み）。 */
  requiredReductionSymbolCount?: number | undefined;
  /** バトルエンティティ情報。CardFilter.battleState 使用時に必要 */
  battleEntities?: readonly BattleEntity[];
  /**
   * 実効系統リスト。指定された場合 `def.tribe.split("・")` の代わりに用いる。
   * `getEffectiveTribes(state, card, def)` の結果を渡すことで CE 経由の付与系統
   * （例: 「系統:起幻 を持つ」の override_properties.addTribes）を反映させる。
   */
  effectiveTribes?: readonly string[];
  /**
   * 実効色リスト。指定された場合 `def.colors` の代わりに用いる (P3-33)。
   * `getEffectiveColors(state, card, def)` の結果を渡すことで `treat_as_color` /
   * `treat_as_color_and_symbol` (場), `appliesToCard:true` の treat_as (手札) を反映。
   */
  effectiveColors?: readonly CardColor[];
  /**
   * 実効 BP。指定された場合 `def.levelDefs[0].bp`（印字 Lv1 BP）の代わりに minBp/maxBp 判定へ用いる。
   * 場の対象選択/条件判定では `getCombinedUnitBp(state, card, def, getCardDefinitionById)` の結果を渡すことで
   * act_as_spirit token（分身）の本体追従 BP・現在レベル BP・bp_modifier / override・合体ブレイヴ BP+ を反映する。
   * フィールド上のカードに対してのみ渡すこと（場外カードは印字 Lv1 BP が正で undefined → 印字フォールバック）。
   */
  effectiveBp?: number | undefined;
  /**
   * カード上の合計コア数 (「コアN個以下/以上の〜」フィルタ用)。
   * 呼び出し側が `getTotalCoresOnCardById(state, card.instanceId)` (SSOT: 通常コア +
   * ソウルコア。10_rules/06_core-system.md L41「generic な『コア』はソウルコアを含む」)
   * で算出し注入する。effectiveBp と同型の scalar 注入で、leaf 側で count を再構築せず
   * SSOT helper の結果をそのまま使う。
   * 未指定 (場外カード等) のとき maxCores/minCores フィルタは適用されない。
   */
  coreCount?: number | undefined;
  /**
   * 実効Lv (minLevel/maxLevel フィルタ用)。
   * 呼び出し側が `getEffectiveLevel` 相当で算出して注入する。未指定時は安全側で不一致。
   */
  effectiveLevel?: number | undefined;
  /**
   * 実効シンボル数 (symbolCount / minSymbolCount フィルタ用)。
   * 指定された場合 `getPrintedSymbolEntries(def).length`（印字シンボル数）の代わりに用いる。
   * **SSOT helper は `getCombinedUnitSymbolCount(state, card, def, getCardDefinitionById)`**
   * (battle-shared.ts; SymbolBundle 単位の count 合算)。
   * `getCombinedUnitSymbols(...).length` (flat 版) は **使ってはいけない**:
   * dual-color treat_as (1 シンボルに `[red, blue]` 等) を多重展開してしまい、
   * 実効シンボル数 (= 1) ではなく色スロット数 (= 2) になる silent bug を生む。
   * 合体ユニット (host+attached brave) の合算シンボルと symbol_addition CE 由来の付与シンボルを
   * 反映する (memory project_combined_unit_symbol_and_bunshin / project_effective_bp_ssot
   * 同型の effective-injection)。
   * フィールド上のカードに対してのみ渡すこと (場外カードは印字シンボル数が正で undefined →
   * 印字フォールバック)。
   */
  effectiveSymbolCount?: number | undefined;
  /**
   * 実効 category (P3-47 F-2)。指定された場合 `def.printedCategory` の代わりに用いる。
   * `getEffectiveCategory(state, card, def)` の結果を渡すことで act_as_spirit token を
   * "spirit" として filter.category マッチに含める。
   * 渡されないかつ `state` も無い場合は def.printedCategory が使われる。
   * P3-69: 裏向き素性なしは `undefined`（どの category にもマッチしない）。
   */
  effectiveCategory?: CardDefinition["printedCategory"] | undefined;
  /**
   * 実効 category 群。鍵ブレイヴの「マジックカードとしても扱う」のように、
   * 1 枚が複数カテゴリ参照にマッチする場合に用いる。未指定時は effectiveCategory 互換。
   */
  effectiveCategories?: readonly CardCategory[] | undefined;
  /**
   * 場の対象/条件/候補列挙として category を照合する文脈。
   * true のときは `getEffectiveCategories()` を使い、スピリット状態のブレイヴ等の
   * 二重カテゴリを `filter.category` に反映する。召喚・出たとき等のイベント文脈では
   * brave 召喚が「スピリットを召喚したとき」を満たさないため true にしない。
   */
  fieldCategoryContext?: boolean;
  /** matchesSingleFilter へ現在評価中の実体カードを渡す内部用。 */
  currentCard?: CardInstance;
  /** `filter.zone` 判定用の評価文脈ゾーン。未指定時は zone 条件を安全側で不一致にする。 */
  cardZone?: Zone;
  /**
   * Runtime card condition evaluator. `card-filter` is imported by the structured
   * condition evaluator, so callers inject the SSOT evaluator instead of this
   * module importing it back and creating a cycle.
   */
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
   * GameState (P3-47 F-2)。`effectiveCategory` 未指定でも本フィールドを渡せば
   * matchesCardFilter 側で act_as_spirit を考慮した実効 category を導出する。
   */
  state?: Pick<
    GameState,
    | "activeContinuousEffects"
    | "activeAttack"
    | "battleEntities"
    | "cardInstances"
    | "declarationCountThisTurn"
  > &
    Partial<
      Pick<
        GameState,
        "preDeclarationStackWindow" | "pendingPreDeclarationConfirmation"
      >
    >;
  /** `CardFilter.attachedBrave.cardName.kind:"from_step_ref"` の参照元 step 実行文脈。 */
  stepContext?: StepExecutionContext;
  /** 合体中ブレイヴの定義解決、および step ref の参照カード定義解決に使う。 */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  /**
   * P3-105: 「一切の効果で防げない」等、target lock bypass を持つ効果では
   * 創界神/導界者/創界石ネクサスの専用対象ロックを無視し、後続の広義 category 判定へ渡す。
   */
  bypassSpecialNexusTargetLock?: boolean;
  /** QA-055: 全効果の対象制限を無視する解決時に限り、種類喪失 CE を無視する。 */
  ignoreCategoryExclusion?: boolean;
  /**
   * engine-grandwalker-nexus-self-exhaust-flag: 対象カードが、いま評価中の効果の
   * actingPlayerId に限り「導界者ネクサス」として扱われる opt-in
   * (`hasGrandwalkerExhaustOptIn`, mechanics/grandwalker-exhaust-opt-in.ts) を持つか。
   * 呼び出し側 (target-resolution.ts) が候補カードごとに解決して注入する
   * (effectiveCategory 等と同型の caller-injected scalar パターン、循環 import 回避)。
   * `CardFilter.includesGrandwalkerExhaustOptIn` を立てた消費側フィルタでのみ参照される。
   */
  grandwalkerExhaustOptIn?: boolean;
}

/**
 * `targetsGrandwalker:"only"` が admit した創界神/導界者ネクサスを、`grandwalkerKind`
 * 指定でさらに種別限定する（SSOT: `grandwalkerKindMatches`、`ConditionClause.grandwalkerKind`
 * と対称）。"any"/省略時は種別を問わない（従来どおり）。
 */
function matchesGrandwalkerKindFilter(
  filter: Pick<CardFilter, "grandwalkerKind">,
  def: CardDefinition
): boolean {
  if (!filter.grandwalkerKind || filter.grandwalkerKind === "any") return true;
  return grandwalkerKindMatches(def.grandwalkerData, filter.grandwalkerKind);
}

/**
 * `targetsGrandwalker:"only"` の admit 判定 (SSOT)。実際の創界神/導界者ネクサスに加えて、
 * `CardFilter.includesGrandwalkerExhaustOptIn:true` を明示した消費側フィルタに限り、
 * engine-grandwalker-nexus-self-exhaust-flag opt-in (`grandwalkerExhaustOptIn`, caller-injected)
 * を持つカードも「導界者ネクサス」種別として admit する (BSTH05.5-C20 型)。
 * opt-in カードは常に "guided" 種別扱い（"grandwalker" 限定フィルタには一致しない）。
 */
function admitsAsGrandwalkerOnlyTarget(
  def: CardDefinition,
  filter: Pick<
    CardFilter,
    "targetsGrandwalker" | "grandwalkerKind" | "includesGrandwalkerExhaustOptIn"
  >,
  grandwalkerExhaustOptIn: boolean | undefined
): boolean {
  if (filter.targetsGrandwalker !== "only") return true;
  if (isGrandwalkerOrGuidedNexus(def)) {
    return matchesGrandwalkerKindFilter(filter, def);
  }
  if (!filter.includesGrandwalkerExhaustOptIn || !grandwalkerExhaustOptIn) {
    return false;
  }
  return (
    !filter.grandwalkerKind ||
    filter.grandwalkerKind === "any" ||
    filter.grandwalkerKind === "guided"
  );
}

function isCardNameMatchFromStepRef(
  filter: CardNameMatchSource
): filter is CardNameMatchFromStepRef {
  return (
    typeof filter === "object" &&
    filter !== null &&
    "kind" in filter &&
    filter.kind === "from_step_ref"
  );
}

function getStepRefCardNames(
  filter: CardNameMatchFromStepRef,
  opts: MatchCardFilterOptions | undefined
): string[] {
  if (!opts?.stepContext || !opts.state || !opts.getCardDefinitionById) {
    return [];
  }
  const result = getStepResult(opts.stepContext, filter.stepId);
  if (!result || !result.succeeded) return [];
  const ids =
    filter.result === "revealed"
      ? (result.revealedCardInstanceIds ?? [])
      : filter.result === "hand_added"
        ? (result.handAddedCardInstanceIds ?? [])
        : result.affectedCardInstanceIds;
  const names: string[] = [];
  for (const id of ids) {
    const card = opts.state.cardInstances.find((c) => c.instanceId === id);
    if (!card) continue;
    const def = opts.getCardDefinitionById(card.definitionId);
    if (def) names.push(def.name);
  }
  return names;
}

function matchesCardNameSource(
  cardName: string,
  nameFilter: CardNameMatchSource | CardNameMatchSource[],
  opts: MatchCardFilterOptions | undefined
): boolean {
  const filters = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
  return filters.some((filter) => {
    if (isCardNameMatchFromStepRef(filter)) {
      return getStepRefCardNames(filter, opts).includes(cardName);
    }
    return matchesCardName(cardName, filter, opts?.sourceDefinition);
  });
}

function matchesAttachedBraveFilter(
  card: CardInstance,
  filter: NonNullable<CardFilter["attachedBrave"]>,
  opts: MatchCardFilterOptions | undefined
): boolean {
  if (!opts?.state || !opts.getCardDefinitionById) return false;
  for (const childId of card.attachedChildrenIds) {
    const child = opts.state.cardInstances.find(
      (c) => c.instanceId === childId
    );
    if (!child || child.zone !== "field") continue;
    if (child.attachedToInstanceId !== card.instanceId) continue;
    const childDef = opts.getCardDefinitionById(child.definitionId);
    if (!childDef || childDef.printedCategory !== "brave") continue;
    if (
      filter.cardName !== undefined &&
      !matchesCardNameSource(childDef.name, filter.cardName, opts)
    ) {
      continue;
    }
    return true;
  }
  for (const virtualBrave of getVirtualCombinedBraves(
    opts.state,
    card.instanceId
  )) {
    if (
      filter.cardName !== undefined &&
      (virtualBrave.cardName === undefined ||
        !matchesCardNameSource(virtualBrave.cardName, filter.cardName, opts))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * カードインスタンス + 定義が CardFilter にマッチするか判定する。
 *
 * filterOr が設定されている場合、他の直接フィールドは無視され、
 * filterOr 内のいずれかのサブフィルタに合致すればマッチ。
 */
export function matchesCardFilter(
  card: CardInstance,
  def: CardDefinition,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  // 除外チェック
  if (opts?.excludeInstanceId && card.instanceId === opts.excludeInstanceId) {
    return false;
  }

  // 魂状態チェック（デフォルトは除外）
  if (opts?.soulStateIds) {
    const isSoulState = opts.soulStateIds.has(card.instanceId);
    if (filter.soulState === "only" && !isSoulState) return false;
    if (filter.soulState == null && isSoulState) return false;
    // "include" → 魂状態を除外しない
  }

  // アンダーカード（下に置かれたカード）の包含スコープチェック
  // （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
  // アンダーカードはホスト離脱まで zone:"field" を保持するため、接頭句で opt-in
  // されない限り無印スコープ（通常フィールドに実体配備された個体のみ）から除外する。
  if (opts?.underCardIds) {
    // text_role（星霊衣/アルドノア/バレットエディット系）は常に対象外。
    if (opts.underCardIds.textRole.has(card.instanceId)) return false;
    // 煌臨元（advent_source）は「煌臨元を含む」opt-in のときのみ対象に残す。
    if (
      opts.underCardIds.adventSource.has(card.instanceId) &&
      filter.adventSourceScope !== "include"
    ) {
      return false;
    }
  }

  // 契約カードの煌臨先(host)逆引き判定 (ENGINE-persistent-recovery-block-with-advent-host-exclusion、
  // BSTH11-X01「煌臨元を含む契約カードとその煌臨先以外」)。matchesSingleFilter は def しか
  // 持たず instance 側の underCards を参照できないため、card instance を持つこの関数側で判定する。
  if (filter.isContractAdventDestination !== undefined) {
    if (
      filter.isContractAdventDestination !== isContractAdventHost(card, opts)
    ) {
      return false;
    }
  }

  const bypassSpecialNexusTargetLock =
    opts?.bypassSpecialNexusTargetLock === true;

  // 創界神/導界者・創界石ネクサスの既定除外。filterOr 経路では outer で全体ロックを掛けず、
  // 下記の filterOr 枝評価で**枝ごと**に opt-in を判定する (verifier 2026-06-23 round 13 lens 3
  // 補正: 旧実装は effectiveGrandwalkerOptIn を outer で立てて全枝の既定除外を外していたため、
  // targetsGrandwalker 未指定枝も grandwalker を admit してしまっていた)。
  const hasFilterOr = !!filter.filterOr?.length;
  if (
    !bypassSpecialNexusTargetLock &&
    !hasFilterOr &&
    !filter.targetsGrandwalker &&
    card.zone === "field" &&
    isGrandwalkerOrGuidedNexus(def)
  ) {
    return false;
  }

  // targetsGrandwalker:"only" → 創界神/導界者ネクサス**のみ**（opt-in カードを含む場合あり、
  // SSOT: admitsAsGrandwalkerOnlyTarget）。
  // 上の除外と対称で、grandwalker でない場のカードを top-level で弾く (filterOr 経路は枝側で評価)。
  // grandwalkerKind 指定時はさらに種別 (創界神/導界者) を限定する。
  if (
    !hasFilterOr &&
    card.zone === "field" &&
    !admitsAsGrandwalkerOnlyTarget(def, filter, opts?.grandwalkerExhaustOptIn)
  ) {
    return false;
  }

  // 創界石ネクサスフィルタ: 創界神とは別カテゴリ。「創界石ネクサス」を対象にした
  // 効果（targetsGrandstone）しか受けない（創界神対象の効果も受けない）。
  if (
    !bypassSpecialNexusTargetLock &&
    !hasFilterOr &&
    !filter.targetsGrandstone &&
    card.zone === "field" &&
    isGrandstoneNexus(def)
  ) {
    return false;
  }

  if (
    filter.pendingDeclaration &&
    (!opts?.state ||
      !matchesPendingBattleDeclaration(
        opts.state,
        card.instanceId,
        filter.pendingDeclaration
      ))
  )
    return false;

  // バトル状態チェック
  if (filter.battleState) {
    const battleEntities = opts?.battleEntities ?? opts?.state?.battleEntities;
    const entity = battleEntities?.find((e) =>
      e.memberInstanceIds.includes(card.instanceId)
    );
    const activeAttack = opts?.state?.activeAttack;
    const stateFromActiveAttack = entity
      ? activeAttack?.participantEntityIds?.includes(entity.entityId)
        ? "attacking"
        : activeAttack?.blockAssignments?.some((assignment) =>
              assignment.blockedByEntityIds.includes(entity.entityId)
            )
          ? "blocking"
          : undefined
      : undefined;
    const cardAttackState =
      entity?.attackState === "idle"
        ? stateFromActiveAttack
        : (entity?.attackState ?? stateFromActiveAttack);
    const isInBattle =
      cardAttackState === "attacking" || cardAttackState === "blocking";

    switch (filter.battleState) {
      case "in_battle":
        if (!isInBattle) return false;
        break;
      case "not_in_battle":
        if (isInBattle) return false;
        break;
      case "attacking":
        if (cardAttackState !== "attacking") return false;
        break;
      case "blocking":
        if (cardAttackState !== "blocking") return false;
        break;
    }
  }

  // 疲労状態チェック（「疲労状態の相手スピリット」等の対象限定）。
  // "exhausted" は回復状態でない（exhausted | heavily_exhausted）を指す。
  // "heavily_exhausted" は原文が「重疲労状態の」と明記する場合の狭い一致（軽疲労は含まない）。
  if (filter.exhaustState) {
    const isRecovered = card.exhaustState === "recovered";
    if (filter.exhaustState === "exhausted" && isRecovered) return false;
    if (filter.exhaustState === "recovered" && !isRecovered) return false;
    if (
      filter.exhaustState === "heavily_exhausted" &&
      card.exhaustState !== "heavily_exhausted"
    ) {
      return false;
    }
  }

  // 合体状態チェック（「合体していない〜」等）。Applicability.combined と同じ正準判定。
  if (filter.combined !== undefined) {
    const isCombined = opts?.state
      ? isEffectivelyCombined(opts.state, card)
      : card.attachedToInstanceId !== null ||
        card.attachedChildrenIds.length > 0;
    if (filter.combined !== isCombined) return false;
  }
  if (filter.attachedBrave !== undefined) {
    if (!matchesAttachedBraveFilter(card, filter.attachedBrave, opts)) {
      return false;
    }
  }

  if (filter.attachedToSource !== undefined) {
    const sourceId = opts?.stepContext?.sourceInstanceId;
    if (!sourceId) return false;
    if ((card.attachedToInstanceId === sourceId) !== filter.attachedToSource) {
      return false;
    }
  }

  // 宣言ギミックチェック（「〇〇と宣言しなければアタック/ブロックできない」等、BSLH01-C12）。
  // GameState.declarationCountThisTurn[controller] を直接参照する（coreCount 等と異なり
  // 呼び出し側の scalar 注入は不要）。state 未提供時は判定不能のため不一致扱い（安全側）。
  if (filter.declaredThisTurn !== undefined) {
    const hasDeclared =
      (opts?.state?.declarationCountThisTurn?.[card.controllerPlayerId] ?? 0) >
      0;
    if (hasDeclared !== filter.declaredThisTurn) return false;
  }

  // P3-47 F-2: effectiveCategory が未指定で state があれば act_as_spirit を考慮して導出
  const baseOpts: MatchCardFilterOptions | undefined = opts
    ? { cardZone: card.zone, ...opts, currentCard: card }
    : { currentCard: card, cardZone: card.zone };
  const resolvedOpts: MatchCardFilterOptions | undefined =
    baseOpts.effectiveCategory === undefined &&
    baseOpts.effectiveCategories === undefined &&
    baseOpts.state
      ? {
          ...baseOpts,
          ...resolveEffectiveCategoryOptions(baseOpts.state, card, def, {
            ignoreCategoryExclusion: baseOpts.ignoreCategoryExclusion === true,
            ...(baseOpts.fieldCategoryContext !== undefined
              ? { fieldCategoryContext: baseOpts.fieldCategoryContext }
              : {}),
            ...(baseOpts.getCardDefinitionById
              ? { getCardDefinitionById: baseOpts.getCardDefinitionById }
              : {}),
          }),
        }
      : baseOpts;

  if (
    resolvedOpts?.fieldCategoryContext === true &&
    resolvedOpts.state &&
    shouldExcludeAttachedCombinedChildForFieldCategoryFilter(
      resolvedOpts.state,
      card,
      def,
      filter,
      resolvedOpts
    )
  ) {
    return false;
  }

  // filterOr: OR結合フィルタ
  if (filter.filterOr && filter.filterOr.length > 0) {
    // 枝ごとに特殊ネクサス既定除外を判定する (verifier 2026-06-23 round 13 lens 3 補正)。
    // ある枝で grandwalker/grandstone を opt-in しても、他枝はその opt-in を継承しない。
    const orMatch = filter.filterOr.some((sub) => {
      const cardIsField = card.zone === "field";
      // 枝ローカル grandwalker exclusion
      if (
        !bypassSpecialNexusTargetLock &&
        !sub.targetsGrandwalker &&
        cardIsField &&
        isGrandwalkerOrGuidedNexus(def)
      ) {
        return false;
      }
      if (
        cardIsField &&
        !admitsAsGrandwalkerOnlyTarget(def, sub, opts?.grandwalkerExhaustOptIn)
      ) {
        return false;
      }
      // 枝ローカル grandstone exclusion
      if (
        !bypassSpecialNexusTargetLock &&
        !sub.targetsGrandstone &&
        cardIsField &&
        isGrandstoneNexus(def)
      ) {
        return false;
      }
      return matchesCardFilter(card, def, sub, resolvedOpts);
    });
    if (!orMatch) return false;
    // exclude は filterOr の結果に対しても適用
    if (
      filter.exclude &&
      matchesCardFilter(card, def, filter.exclude, resolvedOpts)
    ) {
      return false;
    }
    return true;
  }

  // 直接フィールドマッチ
  if (!matchesSingleFilter(def, filter, resolvedOpts)) return false;

  // exclude チェック
  if (
    filter.exclude &&
    matchesCardFilter(card, def, filter.exclude, resolvedOpts)
  ) {
    return false;
  }

  return true;
}

/**
 * 誘発条件・枚数などの参照用。公式エターナル Q1532: 創界神もネクサスとして参照できる。
 * 効果を受ける対象の既定ロックだけを外し、only・種別・魂状態等の条件は維持する。
 */
export function matchesCardReferenceFilter(
  card: CardInstance,
  def: CardDefinition,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  return matchesCardFilter(card, def, filter, {
    ...opts,
    bypassSpecialNexusTargetLock: true,
  });
}

function matchesAttachedCombinedChildOwnIdentityFilter(
  state: NonNullable<MatchCardFilterOptions["state"]>,
  card: CardInstance,
  def: CardDefinition,
  ownCategory: CardCategory | undefined,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  if (filter.filterOr && filter.filterOr.length > 0) {
    const orMatched = filter.filterOr.some((branch) =>
      matchesAttachedCombinedChildOwnIdentityFilter(
        state,
        card,
        def,
        ownCategory,
        branch,
        opts
      )
    );
    if (!orMatched) return false;
    return (
      filter.exclude === undefined ||
      !matchesAttachedCombinedChildOwnIdentityFilter(
        state,
        card,
        def,
        ownCategory,
        filter.exclude,
        opts
      )
    );
  }

  const ownIdentityOpts: MatchCardFilterOptions = {
    ...opts,
    state,
    currentCard: card,
    cardZone: card.zone,
    effectiveCategory: ownCategory,
    effectiveCategories:
      ownCategory === undefined ? undefined : ([ownCategory] as const),
  };
  if (!matchesSingleFilter(def, filter, ownIdentityOpts)) return false;
  return (
    filter.exclude === undefined ||
    !matchesAttachedCombinedChildOwnIdentityFilter(
      state,
      card,
      def,
      ownCategory,
      filter.exclude,
      opts
    )
  );
}

function filterCanMatchCombinedSpirit(filter: CardFilter): boolean {
  if (filter.filterOr && filter.filterOr.length > 0) {
    return filter.filterOr.some((branch) =>
      filterCanMatchCombinedSpirit(branch)
    );
  }
  return filter.category?.includes("spirit") === true;
}

/**
 * 合体済み child brave は単独カードとしては自身の実効 identity で対象化できる。
 * `fieldCategoryContext` により「合体スピリット」の spirit 性で一致しただけなら、
 * host と child を二重に対象候補へ出さない。
 */
export function shouldExcludeAttachedCombinedChildForFieldCategoryFilter(
  state: NonNullable<MatchCardFilterOptions["state"]>,
  card: CardInstance,
  def: CardDefinition,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  if (!isAttachedCombinedChild(state, card)) return false;
  const ownCategory = getEffectiveCategory(state, card, def);
  if (
    matchesAttachedCombinedChildOwnIdentityFilter(
      state,
      card,
      def,
      ownCategory,
      filter,
      opts
    )
  ) {
    return false;
  }
  return filterCanMatchCombinedSpirit(filter);
}

/**
 * `CardFilter.maxBpSource` を具体的な `maxBp` 数値へ解決する（SSOT: maxBpSource→maxBp の
 * 写像はここ一箇所のみ）。「このスピリットのBP以下の相手を破壊」型の動的比較破壊で、
 * 効果発動元の合体ユニット込み実効 BP（呼び出し側が getCombinedUnitBp で算出して `sourceEffectiveBp` に渡す）を
 * 上限 BP に注入する。静的 `maxBp` と併用時は厳しい方（Math.min）を採る。
 * 解決後は `maxBpSource` を取り除き、以降は通常の静的 maxBp 判定（matchesCardFilter）に委ねる。
 *
 * 源が場外などで実効 BP 不明（`undefined`）のときは閾値を 0 とし、何も対象に取らせない。
 * BP 参照効果は源が場のスピリットである前提のため permissive には倒さない。
 */
export function resolveSelfBpThreshold(
  filter: CardFilter,
  sourceEffectiveBp: number | undefined
): CardFilter {
  if (filter.maxBpSource !== "self_effective_bp") return filter;
  const threshold = sourceEffectiveBp ?? 0;
  const { maxBpSource: _omit, ...rest } = filter;
  return {
    ...rest,
    maxBp:
      filter.maxBp !== undefined
        ? Math.min(filter.maxBp, threshold)
        : threshold,
  };
}

/**
 * 誰にもマッチしない番兵系統トークン。参照カード不在（バトル外・ブロック未宣言等）で
 * `tribesMatchRef` を解決できないとき、fail-closed でこの値を `tribes` に設定する
 * （`tribes: []` は「制約なし=常にマッチ」と区別できないため、実在しえない文字列を使う）。
 */
const UNRESOLVED_TRIBES_MATCH_REF_SENTINEL = "__unresolved_tribes_match_ref__";

/**
 * `CardFilter.tribesMatchRef` を具体的な `tribes`（OR一致）へ解決する（SSOT:
 * tribesMatchRef→tribes の写像はここ一箇所のみ）。「ブロック宣言する相手と同じ系統を持つ
 * 他の…」型 (BSFT01-C01) の動的系統一致で、呼び出し側が参照カードの実効系統
 * （`getEffectiveTribes` の結果）を `refTribes` に渡す。静的 `tribes` は上書きする
 * （tribesMatchRef 使用カードは静的 tribes 併用を想定しないため maxBpSource の Math.min
 * のような併合はしない）。解決後は `tribesMatchRef` を取り除き、以降は通常の静的
 * tribes 判定（matchesCardFilter → matchesTribes）に委ねる。
 *
 * 参照カード不明（`undefined` または空配列 = 系統なしカードが参照）のときは
 * `UNRESOLVED_TRIBES_MATCH_REF_SENTINEL` を設定し、何も対象に取らせない（fail-closed、
 * maxBpSource と同じ方針）。
 */
export function resolveTribesMatchRefFilter(
  filter: CardFilter,
  refTribes: readonly string[] | undefined
): CardFilter {
  if (filter.tribesMatchRef === undefined) return filter;
  const { tribesMatchRef: _omit, ...rest } = filter;
  return {
    ...rest,
    tribes:
      refTribes && refTribes.length > 0
        ? [...refTribes]
        : [UNRESOLVED_TRIBES_MATCH_REF_SENTINEL],
    tribesLogic: "or",
  };
}

/**
 * `CardFilter.maxCostSource` を具体的な `maxCost` 数値へ解決する（SSOT: maxCostSource→maxCost の
 * 写像はここ一箇所のみ）。「このスピリットのコスト以下の相手を破壊」型の動的比較破壊で、
 * 効果発動元の本来コスト（呼び出し側が源の `def.cost` を渡す）を上限 `maxCost` に注入する。
 * 静的 `maxCost` と併用時は厳しい方（Math.min）を採る。解決後は `maxCostSource` を取り除き、
 * 以降は通常の静的 maxCost 判定（matchesCardFilter）に委ねる。
 *
 * 実効コストは `additional_cost` CE（「コストはXとしても扱う」）を含めた最大値で算出する。
 * 対象側 filter の costBasis 既定挙動（card-filter.ts: `costs = [def.cost, ...additionalCosts]`）
 * と SSOT 整合させ、源の `additional_cost` CE で広がった実効コストを閾値に反映する。
 * 軽減 CE はコスト属性を変えないため反映しない。
 *
 * 源が見つからずコスト不明（`undefined`）のときは閾値を 0 とし、何も対象に取らせない
 * （maxBpSource と同じ fail-closed。源は場のスピリットである前提のため permissive に倒さない）。
 */
function applyMaxCostSourceScale(
  threshold: number,
  scale: CardFilter["maxCostSourceScale"]
): number {
  if (!scale) return threshold;
  return threshold * (scale.multiplier ?? 1) + (scale.offset ?? 0);
}

export function resolveSelfCostThreshold(
  filter: CardFilter,
  sourceCost: number | undefined,
  sourceAdditionalCosts?: readonly number[]
): CardFilter {
  if (filter.maxCostSource !== "self_effective_cost") return filter;
  const rawThreshold =
    sourceCost === undefined
      ? undefined
      : sourceAdditionalCosts && sourceAdditionalCosts.length > 0
        ? Math.max(sourceCost, ...sourceAdditionalCosts)
        : sourceCost;
  const threshold =
    rawThreshold === undefined
      ? 0
      : applyMaxCostSourceScale(rawThreshold, filter.maxCostSourceScale);
  const {
    maxCostSource: _omit,
    maxCostSourceScale: _omitScale,
    ...rest
  } = filter;
  return {
    ...rest,
    maxCost:
      filter.maxCost !== undefined
        ? Math.min(filter.maxCost, threshold)
        : threshold,
  };
}

/**
 * `maxCostSource: "self_count"` / `maxCoresSource: "self_count"` を具体的な
 * `maxCost` / `maxCores` 数値へ解決する（SSOT: self_count→閾値 の写像はここ一箇所のみ）。
 * 「自分のカウント以下のコスト/コアの相手を破壊」型 (BSDB01-C02 maxCost / BSKB01-T01 maxCores)
 * の動的比較破壊で、効果発動元の所有プレイヤーのカウント値（呼び出し側が PlayerState.countValue
 * を保護控除込みで算出して `sourceCount` に渡す）を上限に注入する。
 *
 * 静的 `maxCost`/`maxCores` と併用時は厳しい方（Math.min）を採る。解決後はソース指定を
 * 取り除き、以降は通常の静的判定（matchesCardFilter）に委ねる。源のカウントが不明
 * （`undefined`）のときは閾値を 0 とし、何も対象に取らせない（maxBpSource と同じ fail-closed）。
 */
export function resolveSelfCountThreshold(
  filter: CardFilter,
  sourceCount: number | undefined
): CardFilter {
  const usesCost = filter.maxCostSource === "self_count";
  const usesCores = filter.maxCoresSource === "self_count";
  if (!usesCost && !usesCores) return filter;
  const coresThreshold = sourceCount ?? 0;
  const costThreshold =
    sourceCount === undefined
      ? 0
      : applyMaxCostSourceScale(sourceCount, filter.maxCostSourceScale);
  const {
    maxCostSource: _omitCost,
    maxCoresSource: _omitCores,
    maxCostSourceScale: _omitScale,
    ...rest
  } = filter;
  const resolved: CardFilter = { ...rest };
  // self_count 以外のソース指定は維持する（別ソースとの併用は想定しないが安全側）。
  if (filter.maxCostSource && filter.maxCostSource !== "self_count") {
    resolved.maxCostSource = filter.maxCostSource;
  }
  if (usesCost) {
    resolved.maxCost =
      filter.maxCost !== undefined
        ? Math.min(filter.maxCost, costThreshold)
        : costThreshold;
  }
  if (usesCores) {
    resolved.maxCores =
      filter.maxCores !== undefined
        ? Math.min(filter.maxCores, coresThreshold)
        : coresThreshold;
  }
  return resolved;
}

/**
 * 「自分のカウント」閾値の数値を算出する（SSOT: self_count 源のカウント解決はここ一箇所）。
 * 効果発動元カードの所有プレイヤーの `countValue` から、源の系統で保護カウントを控除して返す
 * （`count_value` 条件評価と同じ計算、structured-effect-interpreter.ts case "count_value"）。
 * 源が見つからないときは undefined（呼び出し側で fail-closed = 閾値 0 扱い）。
 */
export function getSelfCountThresholdValue(
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceDef: CardDefinition | undefined
): number | undefined {
  if (!sourceCard) return undefined;
  const player = state.players.find(
    (p) => p.id === sourceCard.controllerPlayerId
  );
  if (!player) return undefined;
  const sourceTribes = sourceDef?.tribe?.split("・") ?? [];
  return (
    player.countValue -
    immuneProtectedCount(player.protectedCounts, sourceTribes)
  );
}

/**
 * 動的自己閾値ソース (maxBpSource/maxCostSource/maxCoresSource) を、`filterOr` の
 * 各枝も含めて再帰的に具体値へ解決する（SSOT: filterOr 再帰はここ一箇所のみ）。
 *
 * 解決本体は resolveSelfBpThreshold/resolveSelfCostThreshold/resolveSelfCountThreshold
 * の3ヘルパーへ委譲する。呼び出し側（target-resolution.ts / native-target-resolution.ts /
 * legal-actions-shared.ts）はそれぞれ独自にトップレベル filter のみ解決していたため、
 * 「1体か…ネクサス1つ」のような filterOr の枝内 maxBpSource が黙って無視され、
 * BP 制約が実質無効化される silent bug があった (BSGE01-TX01(B) adversarial verifier
 * round3 で発見)。
 */
export function resolveDynamicThresholdsInFilter(
  filter: CardFilter,
  thresholds: {
    effectiveBp?: number | undefined;
    sourceCost?: number | undefined;
    additionalCosts?: readonly number[] | undefined;
    countValue?: number | undefined;
  }
): CardFilter {
  let result = filter;
  if (result.maxBpSource === "self_effective_bp") {
    result = resolveSelfBpThreshold(result, thresholds.effectiveBp);
  }
  if (result.maxCostSource === "self_effective_cost") {
    result = resolveSelfCostThreshold(
      result,
      thresholds.sourceCost,
      thresholds.additionalCosts
    );
  }
  if (
    result.maxCostSource === "self_count" ||
    result.maxCoresSource === "self_count"
  ) {
    result = resolveSelfCountThreshold(result, thresholds.countValue);
  }
  if (result.filterOr && result.filterOr.length > 0) {
    result = {
      ...result,
      filterOr: result.filterOr.map((branch) =>
        resolveDynamicThresholdsInFilter(branch, thresholds)
      ),
    };
  }
  return result;
}

// ============================================================
// 内部: 単一フィルタのフィールドマッチ
// ============================================================

/**
 * 定義（CardDefinition）のみで単一フィルタにマッチするか判定する。
 * インスタンスを必要としない判定（例: 場唯一性制限で「これから召喚するカードが
 * 制限対象か」を def だけで判定する）に使う。系統・カテゴリ・色など def 起点の
 * 条件のみを評価する（バトル状態・疲労状態等インスタンス依存の条件は評価しない）。
 */
export function matchesCardFilterByDef(
  def: CardDefinition,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  return matchesSingleFilter(def, filter, opts);
}

function matchesSingleFilter(
  def: CardDefinition,
  filter: CardFilter,
  opts?: MatchCardFilterOptions
): boolean {
  // カテゴリ (P3-47 F-2: effectiveCategory があればそちらを優先 — act_as_spirit token を反映)
  // P3-69: state 文脈では effectiveCategory が権威的。裏向き素性なしは undefined となり、
  // printedCategory にフォールバックせず category フィルタを満たさない (素性を漏らさない)。
  const effCategories =
    opts?.effectiveCategories ??
    (opts?.effectiveCategory !== undefined
      ? [opts.effectiveCategory]
      : opts?.state
        ? undefined
        : [def.printedCategory]);
  const effCategory =
    opts?.effectiveCategory !== undefined
      ? opts.effectiveCategory
      : opts?.state
        ? undefined
        : def.printedCategory;
  if (filter.zone && filter.zone.length > 0) {
    if (!opts?.cardZone || !filter.zone.includes(opts.cardZone)) {
      return false;
    }
  }
  if (filter.category) {
    if (
      effCategories === undefined ||
      !filter.category.some((category) => effCategories.includes(category))
    ) {
      return false;
    }
  }

  // P3-69: 裏向き素性なし (null identity) の信号。state 文脈で effCategory が undefined に
  // 解決された = 裏向き + act_as_spirit 付与無し。null identity カードは名前/色/シンボル/系統/
  // BP/コストといった *素性述語* に一切マッチしない (印字を漏らさない)。非素性述語
  // (zone / soulState / battleState 等) は別途評価済みなので、ここでは素性述語のみを落とす。
  // ※ no-state 文脈 (deck/hand を印字で絞る等) では effCategory が印字にフォールバックし
  //   isNullIdentity=false となるため、正当な face-up 印字読みは保持される。
  const isNullIdentity =
    opts?.state !== undefined &&
    effCategory === undefined &&
    effCategories === undefined;

  // 色 (P3-33: effectiveColors があればそちらを優先 — treat_as_color 等の継続効果を反映)
  // P3-69: null identity は色を持たない (effectiveColors 未指定でも空に倒す)。
  const effColors = opts?.effectiveColors ?? (isNullIdentity ? [] : def.colors);
  if (filter.colors) {
    // 既定 "or": 列挙色のいずれかを持てば成立。"and": 列挙色をすべて持つ
    // （多色カードの色保持判定。例「6色のカード」= 列挙された全色を持つ）。
    const matched =
      filter.colorsLogic === "and"
        ? filter.colors.every((c) => effColors.includes(c))
        : filter.colors.some((c) => effColors.includes(c));
    if (!matched) return false;
  }

  // excludeColors: 指定色を一切持たないカードにのみ一致する（否定版、colors の保持判定とは別軸）。
  // 多色カードは列挙色を1つでも持てば「持つ」扱いのため、単純な colors OR 列挙では
  // 除外色を併せ持つ多色カードを誤って対象化してしまう（例:「黄以外」判定で黄+赤の
  // 多色カードを誤対象化しない）。
  if (filter.excludeColors && filter.excludeColors.length > 0) {
    if (filter.excludeColors.some((c) => effColors.includes(c))) return false;
  }

  // 色数
  if (filter.colorCount) {
    if (filter.colorCount === "mono" || filter.colorCount === "multi") {
      const uniqueCount = countUniqueColors(effColors);
      if (filter.colorCount === "mono" && uniqueCount !== 1) return false;
      if (filter.colorCount === "multi" && uniqueCount < 2) return false;
    } else if (
      !matchesColorCount(
        effColors,
        filter.colorCount.min,
        filter.colorCount.max
      )
    ) {
      return false;
    }
  }

  // コスト（既定は「コストはXとしても扱う」対応。「本来のコスト」は printed を明示）
  if (filter.minCost !== undefined || filter.maxCost !== undefined) {
    if (isNullIdentity) return false; // null identity はコストを持たない
    const costs =
      filter.costBasis === "printed"
        ? [def.cost]
        : opts?.effectiveCost !== undefined
          ? [opts.effectiveCost, ...(opts?.additionalCosts ?? [])]
          : [def.cost, ...(opts?.additionalCosts ?? [])];
    if (
      !costs.some(
        (cost) =>
          (filter.minCost === undefined || cost >= filter.minCost) &&
          (filter.maxCost === undefined || cost <= filter.maxCost)
      )
    ) {
      return false;
    }
  }

  // excludeCosts: 指定コストのいずれかを持つカードを除外する（否定版、excludeColors と同じ
  // 「否定フィルタ」パターン）。
  if (filter.excludeCosts && filter.excludeCosts.length > 0) {
    if (isNullIdentity) return false;
    const costs =
      filter.costBasis === "printed"
        ? [def.cost]
        : opts?.effectiveCost !== undefined
          ? [opts.effectiveCost, ...(opts?.additionalCosts ?? [])]
          : [def.cost, ...(opts?.additionalCosts ?? [])];
    if (costs.some((c) => filter.excludeCosts!.includes(c))) return false;
  }

  if (filter.reductionSymbolsSatisfied === "all") {
    if (isNullIdentity) return false;
    if (opts?.satisfiedReductionSymbolCount === undefined) return false;
    if (opts.requiredReductionSymbolCount === undefined) return false;
    if (
      opts.satisfiedReductionSymbolCount < opts.requiredReductionSymbolCount
    ) {
      return false;
    }
  }

  // BP（既定は実効 BP 判定。effectiveBp 未指定時のみ印字 Lv1 BP にフォールバック）
  // 実効 BP は呼び出し側が文脈に応じて算出し opts.effectiveBp に注入する。
  // 場の対象選択/条件判定では合体ブレイヴ込みの getCombinedUnitBp を渡す。
  // 「本来のBP」原文は bpBasis:"printed" で明示し、effectiveBp を無視して印字 Lv1 BP のみ見る
  // (costBasis:"printed" と同型、SSOT)。
  if (filter.minBp !== undefined || filter.maxBp !== undefined) {
    if (isNullIdentity) return false; // null identity は BP を持たない
    // BP計算の数値フォールバック0は、BPを持たないカードへBPを与えない。
    // スピリット等として扱う分身・転神の実効BPはそのカテゴリで識別する。
    if (
      !def.levelDefs.some((level) => level.bp !== undefined) &&
      effCategory !== "spirit" &&
      effCategory !== "ultimate"
    ) {
      return false;
    }
    const bp =
      filter.bpBasis === "printed"
        ? def.levelDefs[0]?.bp
        : (opts?.effectiveBp ?? def.levelDefs[0]?.bp);
    // qa-031: BP のないカードは BP0 ではない。分身等の実効 BP 注入は維持する。
    if (bp === undefined) return false;
    if (filter.minBp !== undefined && bp < filter.minBp) return false;
    if (filter.maxBp !== undefined && bp > filter.maxBp) return false;
  }

  // コア数 (「コアN個以下/以上の〜」)。コアは場のカードにしか乗らないので、
  // coreCount が未注入なら判定不能としてフィルタを適用しない (場外カードは素通り)。
  // 値は呼び出し側が getTotalCoresOnCardById で算出した SSOT (通常 + soul) を注入する。
  if (filter.maxCores !== undefined || filter.minCores !== undefined) {
    const coreCount = opts?.coreCount;
    if (coreCount === undefined) return false;
    if (filter.minCores !== undefined && coreCount < filter.minCores) {
      return false;
    }
    if (filter.maxCores !== undefined && coreCount > filter.maxCores) {
      return false;
    }
  }
  if (filter.minLevel !== undefined || filter.maxLevel !== undefined) {
    if (isNullIdentity) return false;
    const level = opts?.effectiveLevel;
    if (level === undefined) return false;
    if (filter.minLevel !== undefined && level < filter.minLevel) return false;
    if (filter.maxLevel !== undefined && level > filter.maxLevel) return false;
  }

  // Relative Lv predicates use the publicly granted table when present. Keep
  // def.levelDefs unchanged: bpBasis:"printed" still means printed information.
  const ownLevelDefs =
    (filter.belowOwnMinimumLevel || filter.atOwnMaximumLevel !== undefined) &&
    opts?.state &&
    opts.currentCard &&
    opts.getCardDefinitionById
      ? (resolveActAsSpiritLevelDefinitions(
          opts.state,
          opts.currentCard,
          opts.getCardDefinitionById
        ) ?? def.levelDefs)
      : def.levelDefs;
  // 対象自身の levelDefs 最低Lvを実効Lvが下回っているか（対象ローカルな相対閾値、
  // minLevel/maxLevel の静的閾値とは別軸。BSTH08.5-X02「この効果で最低Lvより
  // 低くなった…消滅」）。
  if (filter.belowOwnMinimumLevel) {
    if (isNullIdentity) return false;
    const level = opts?.effectiveLevel;
    if (level === undefined) return false;
    const ownMinLevel = ownLevelDefs.reduce(
      (min, ld) => Math.min(min, ld.level),
      Infinity
    );
    if (!Number.isFinite(ownMinLevel) || level >= ownMinLevel) return false;
  }

  if (filter.atOwnMaximumLevel !== undefined) {
    if (isNullIdentity || opts?.effectiveLevel === undefined) return false;
    const maximumLevel = ownLevelDefs.reduce(
      (maximum, level) => Math.max(maximum, level.level),
      -Infinity
    );
    if (!Number.isFinite(maximumLevel)) return false;
    if ((opts.effectiveLevel === maximumLevel) !== filter.atOwnMaximumLevel)
      return false;
  }

  // シンボル数 (実効値で判定; effectiveSymbolCount があればそれ、未指定なら印字フォールバック)。
  // 実効値は合体ユニット (host+brave) や symbol_addition CE を反映する
  // (memory project_combined_unit_symbol_and_bunshin)。
  // `?? []`: mirage-system.ts getAvailableMiragePaymentSources の virtualCard
  // (`{cost, reductionSymbols} as CardDefinition`) のように symbolColors を持たない
  // 合成 CardDefinition が cost-system 経由 (applyPayingForTreatAsToSupply) でここに届くため。
  const printedSymbolCount = getPrintedSymbolEntries(def).length;
  const symCount = opts?.effectiveSymbolCount ?? printedSymbolCount;
  if (filter.symbolCount !== undefined) {
    if (isNullIdentity) return false; // null identity はシンボルを持たない
    if (symCount !== filter.symbolCount) return false;
  }
  if (filter.minSymbolCount !== undefined) {
    if (isNullIdentity) return false;
    if (symCount < filter.minSymbolCount) return false;
  }
  if (filter.maxSymbolCount !== undefined) {
    if (isNullIdentity) return false;
    if (symCount > filter.maxSymbolCount) return false;
  }
  // 印字シンボル数 (「本来のシンボルN つ」型テキスト用)。常に getPrintedSymbolEntries(def).length のみで
  // 判定し、effectiveSymbolCount 注入の影響を受けない。
  if (filter.printedSymbolCount !== undefined) {
    if (isNullIdentity) return false;
    if (printedSymbolCount !== filter.printedSymbolCount) return false;
  }
  if (filter.printedMinSymbolCount !== undefined) {
    if (isNullIdentity) return false;
    if (printedSymbolCount < filter.printedMinSymbolCount) return false;
  }

  // 系統（CE 経由の addTribes 反映用に effectiveTribes が指定されていればそちらを優先）
  // P3-69: null identity は系統を持たない (effectiveTribes=[] / tribe="" に倒す)。
  if (
    !matchesTribes(
      isNullIdentity ? "" : def.tribe,
      filter,
      isNullIdentity ? [] : opts?.effectiveTribes
    )
  )
    return false;

  // カード名
  if (filter.cardName !== undefined) {
    if (isNullIdentity) return false; // null identity は名前を持たない
    if (!matchesCardName(def.name, filter.cardName, opts?.sourceDefinition)) {
      return false;
    }
  }

  // カード名（除外版、excludeColors/excludeTribeSubstring と同じ否定フィルタパターン）
  if (filter.excludeCardName !== undefined && !isNullIdentity) {
    if (
      matchesCardName(def.name, filter.excludeCardName, opts?.sourceDefinition)
    ) {
      return false;
    }
  }

  // メカニクス
  if (filter.hasMechanic && filter.hasMechanic.length > 0) {
    if (!filter.hasMechanic.some((m) => cardDefinitionHasMechanic(def, m))) {
      return false;
    }
  }

  // targetsGrandwalker:"only" → 創界神/導界者ネクサスのみ（opt-in カードを含む場合あり、
  // SSOT: admitsAsGrandwalkerOnlyTarget）。
  // matchesCardFilter outer 段の対称（filterOr 枝で『創界神ネクサスのみ』を表現する用）。
  // matchesSingleFilter は def しか持たないので、zone check は呼び出し側に委ねる
  // （filterOr 枝の場合 outer matchesCardFilter で既に zone:"field" 文脈が確立済み、
  //  hand/deck/trash 等の場外カードに対するこの check は安全に「常に false」
  //  ＝ 創界神ネクサスは場外で存在しない ≈ no-op になる）。
  if (
    !admitsAsGrandwalkerOnlyTarget(def, filter, opts?.grandwalkerExhaustOptIn)
  ) {
    return false;
  }

  // 契約カード (SSOT = isContractDefinition)
  if (filter.isContract !== undefined) {
    if (filter.isContract !== isContractDefinition(def)) return false;
  }

  if (
    filter.requiredKeywordTags !== undefined &&
    !filter.requiredKeywordTags.every((tag) => def.keywordTags.includes(tag))
  ) {
    return false;
  }

  // トークンカード (SSOT = isCardDefinitionToken)
  if (filter.isToken !== undefined) {
    if (filter.isToken !== isCardDefinitionToken(def)) return false;
  }

  // 効果の記述を持つ／持たない（印字テキストベース。null identity は素性を漏らさない）
  if (filter.hasEffectText !== undefined) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    if (cardHasPrintedEffectText(def) !== filter.hasEffectText) return false;
  }

  // クォーツ印字保有（`quartz_set` の対象絞り込み用。null identity は素性を漏らさない）
  if (filter.hasQuartzData !== undefined) {
    if (isNullIdentity) return false;
    if ((def.quartzData !== undefined) !== filter.hasQuartzData) return false;
  }

  // ミラージュ印字保有（「ミラージュ効果を持つ」カードの対象絞り込み用。
  // null identity は素性を漏らさない）
  if (filter.hasMirageData !== undefined) {
    if (isNullIdentity) return false;
    if ((def.mirageData !== undefined) !== filter.hasMirageData) return false;
  }

  // 効果借用 (borrow_magic_effect) の借用元絞り込み。実装状態 (stub/steps) 非依存。
  if (
    filter.hasActivatedEffectMode &&
    filter.hasActivatedEffectMode.length > 0
  ) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    if (!cardHasActivatedEffectMode(def, filter.hasActivatedEffectMode)) {
      return false;
    }
  }

  // card_event 効果借用の借用元絞り込み。借用して実際に発揮するため、
  // 未実装/近似 stub や空 steps は候補にしない。
  if (filter.hasCardEventEffect && filter.hasCardEventEffect.length > 0) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    if (
      !cardHasCardEventEffect(def, filter.hasCardEventEffect, {
        card: opts?.currentCard,
        evaluateCondition: opts?.evaluateCondition,
        evaluateApplicability: opts?.evaluateApplicability,
      })
    ) {
      return false;
    }
  }

  // 印字バースト系ヘッダ保有。「burst 関連」タグや実装済み timing ではなく原文を見る。
  if (filter.hasBurstEffect !== undefined) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    if (cardHasBurstEffect(def) !== filter.hasBurstEffect) return false;
  }

  // text_role アンダーカード枠宣言 (【アルドノアドライブ：N】等 host 側キーワード) 絞り込み。
  if (filter.declaresUnderCardSlot !== undefined) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    if (!cardDeclaresUnderCardSlot(def, filter.declaresUnderCardSlot)) {
      return false;
    }
  }

  // text_role アンダーカード実配置絞り込み（実行時状態、declaresUnderCardSlot とは別軸）。
  if (filter.hasUnderCardRoleTag !== undefined) {
    if (
      !(opts?.state && opts.currentCard
        ? countEffectiveUnderCardRole(
            opts.state as GameState,
            opts.currentCard,
            filter.hasUnderCardRoleTag,
            opts.getCardDefinitionById
          ) > 0
        : opts?.currentCard?.underCards.some(
            (uc) =>
              uc.role === "text_role" &&
              underCardRoleTagsEqual(uc.roleTag, filter.hasUnderCardRoleTag)
          ))
    ) {
      return false;
    }
  }

  // Lv1 requiredCores フィルタ（「最低Lvコスト1の〜」型）。印字 levelDefs 基準。
  if (filter.lv1RequiredCores !== undefined) {
    if (isNullIdentity) return false; // null identity は印字を持たない
    const lv1 = def.levelDefs.find((l) => l.level === 1);
    if (!lv1 || lv1.requiredCores !== filter.lv1RequiredCores) return false;
  }

  // 累積コア配置履歴 (`CardInstance.everHadCorePlaced`、一方向ラッチ)。
  // 「ゲーム中にコア1個以上を置かれた〜」型 (BSTH02-C21 Lv2)。instance 未提供
  // (`matchesCardFilterByDef` 経由の def-only 判定等) のときは不一致として扱う
  // (安全側デフォルト、instance 依存のためカード定義だけでは判定不能)。
  if (filter.everHadCorePlaced !== undefined) {
    if (opts?.currentCard?.everHadCorePlaced !== filter.everHadCorePlaced) {
      return false;
    }
  }

  return true;
}

/**
 * カードが指定 `timing.mode` の起動効果 (`timing.kind:"activated"`) を
 * `effects[]` に持つか。`effect.stub` / `effect.steps.length` は見ない
 * （`cardHasPrintedEffectText` と同じ実装状態非依存の原則）。
 */
export function cardHasActivatedEffectMode(
  def: CardDefinition,
  modes: readonly ("main" | "flash" | "stack")[]
): boolean {
  return (def.effects ?? []).some(
    (e) =>
      e.timing.kind === "activated" &&
      e.timing.mode !== "any" &&
      modes.includes(e.timing.mode)
  );
}

/**
 * カードが指定 `card_event` 効果を `effects[]` に持つか。
 * borrow_card_event_effect の借用候補用なので、未実装/近似 stub や空 steps は除外する。
 */
export function cardHasCardEventEffect(
  def: CardDefinition,
  events: readonly import("../model").CardEventType[],
  opts?: {
    card?: CardInstance | undefined;
    evaluateCondition?: MatchCardFilterOptions["evaluateCondition"];
    evaluateApplicability?: MatchCardFilterOptions["evaluateApplicability"];
  }
): boolean {
  return (def.effects ?? []).some((e) => {
    if (e.stub !== undefined || e.steps.length === 0) return false;
    if (
      !effectMatchesCardEventLabel(e, def.textLines, events, {
        requireSelfReference: true,
      })
    ) {
      return false;
    }
    const card = opts?.card;
    if (e.condition && e.condition.length > 0) {
      if (!card || !opts?.evaluateCondition) return false;
      if (
        !opts.evaluateCondition(
          e.condition,
          card.instanceId,
          card.controllerPlayerId
        )
      ) {
        return false;
      }
    }
    if (e.applicability) {
      if (!card || !opts?.evaluateApplicability) return false;
      if (!opts.evaluateApplicability(e.applicability, card.instanceId)) {
        return false;
      }
    }
    return true;
  });
}

/** カードが印字バースト系ヘッダ（【バースト】/Sバースト/バースト転召）を持つか。 */
export function cardHasBurstEffect(def: CardDefinition): boolean {
  return cardHasPrintedBurstEffectHeader(def);
}

/**
 * カードが指定 roleTag の text_role アンダーカード枠を宣言しているか
 * underCardSlots の宣言属性、または既存の配置・入替 DSL を参照する。
 * 星霊衣/バレットエディットの定義へ並行する資格フラグを追加しない。
 */
export function cardDeclaresUnderCardSlot(
  def: CardDefinition,
  roleTag: string
): boolean {
  if (
    (def.underCardSlots ?? []).some((s) =>
      underCardRoleTagsEqual(s.roleTag, roleTag)
    )
  )
    return true;
  // 星霊衣・バレットエディットの既存定義は配置/入替アクションでギミックを宣言する。
  const declaresInSteps = (steps: readonly EffectStep[]): boolean =>
    steps.some((step) => {
      const action = step.action;
      const actionRole =
        action?.kind === "place_star_garment" ||
        action?.kind === "swap_star_garment"
          ? (action.roleTag ?? "星霊衣")
          : action?.kind === "bullet_edit" ||
              action?.kind === "swap_bullet_edit"
            ? (action.roleTag ?? "バレットエディット")
            : undefined;
      return (
        (actionRole !== undefined &&
          underCardRoleTagsEqual(actionRole, roleTag)) ||
        (step.choice !== undefined && declaresInSteps(step.choice))
      );
    });
  return (def.effects ?? []).some((effect) => declaresInSteps(effect.steps));
}

/**
 * カードが「効果の記述を持つ」か（印字テキストベースの SSOT 判定）。
 *
 * BS の「効果の記述を持つスピリット/アルティメット」= 印字テキストに効果の記述があるカード
 * （バニラ＝効果なしカードを除く）。判定はシミュレーターの effects 実装有無ではなく
 * **印字テキスト**（`def.textLines` に非空の効果記述行があるか）に基づく。未実装で
 * `effects:[]` のカードでも印字テキストを持つため、effects 配列では判定しない
 * （実装状態に挙動が依存しないことを保証）。
 */
export function cardHasPrintedEffectText(def: CardDefinition): boolean {
  return (def.textLines ?? []).some((line) => line.trim().length > 0);
}

// ============================================================
// カード名マッチング
// ============================================================

export function matchesCardName(
  cardName: string,
  nameFilter: CardNameMatch | CardNameMatch[],
  sourceDefinition?: CardDefinition
): boolean {
  const filters = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
  // OR: いずれかに合致すればマッチ
  return filters.some((f) => {
    if (f === "self") {
      return sourceDefinition ? cardName === sourceDefinition.name : false;
    }
    if ("contains" in f) {
      return cardName.includes(f.contains);
    }
    if ("exact" in f) {
      return cardName === f.exact;
    }
    return false;
  });
}

// ============================================================
// additional_cost CE ユーティリティ
// ============================================================

/**
 * カードインスタンスに紐づく additional_cost CE の値一覧を取得する。
 * 「コストはXとしても扱う」で登録された追加コスト値を返す。
 */
export function getAdditionalCosts(
  state: GameState,
  cardInstanceId: string
): number[] {
  return state.activeContinuousEffects
    .filter(
      (ce) =>
        ce.modifierTag === "additional_cost" &&
        ce.targetInstanceId === cardInstanceId
    )
    .map((ce) => ce.modifierAmount!)
    .filter((v): v is number => v !== undefined);
}

function resolveDynamicCountPlayer(
  state: GameState,
  actingPlayerId: string,
  player: PlayerRef
): string {
  if (player === "self") return actingPlayerId;
  return (
    state.players.find((p) => p.id !== actingPlayerId)?.id ?? actingPlayerId
  );
}

function continuousAdditionalCostCoreLocationCount(
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
      return (
        state.players.find((p) => p.id === pid)?.reserveNormalCoreCount ?? 0
      );
    }
    case "life": {
      const pid = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        location.player
      );
      return state.players.find((p) => p.id === pid)?.lifeNormalCoreCount ?? 0;
    }
    case "trash": {
      const pid = resolveDynamicCountPlayer(
        state,
        actingPlayerId,
        location.player
      );
      return state.players.find((p) => p.id === pid)?.trashNormalCoreCount ?? 0;
    }
    case "card_instance": {
      const card = getCardById(state, location.instanceId);
      return card ? card.normalCoreCount + card.soulCoreCount : 0;
    }
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

function continuousAdditionalCostSourceCount(
  state: GameState,
  actingPlayerId: string,
  src: DynamicCountSource,
  sourceTribes: readonly string[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  switch (src.kind) {
    case "count_value": {
      const pid = resolveDynamicCountPlayer(state, actingPlayerId, src.player);
      const player = state.players.find((p) => p.id === pid);
      if (!player) return 0;
      return Math.max(
        0,
        player.countValue -
          immuneProtectedCount(player.protectedCounts, sourceTribes)
      );
    }
    case "declaration_count_this_turn": {
      const pid = resolveDynamicCountPlayer(state, actingPlayerId, src.player);
      return state.declarationCountThisTurn[pid] ?? 0;
    }
    case "cores_on":
      return continuousAdditionalCostCoreLocationCount(
        state,
        actingPlayerId,
        src.location
      );
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
        if (c.zone !== src.zone) return false;
        if (!src.filter) return true;
        const def = getCardDefinitionById?.(c.definitionId);
        if (!def) return false;
        return matchesCardReferenceFilter(c, def, src.filter, {
          state,
          battleEntities: state.battleEntities,
          additionalCosts: getAdditionalCosts(state, c.instanceId),
        });
      }).length;
    }
    case "field_bp_total":
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

function evaluateContinuousAdditionalCostAmount(
  state: GameState,
  actingPlayerId: string,
  dynamicAmount: DynamicCount,
  sourceTribes: readonly string[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const baseCount = continuousAdditionalCostSourceCount(
    state,
    actingPlayerId,
    dynamicAmount.source,
    sourceTribes,
    getCardDefinitionById
  );
  const multiplier = dynamicAmount.multiplier ?? 1;
  const divisor = dynamicAmount.divisor ?? 1;
  const groupMultiplier = dynamicAmount.groupMultiplier ?? 1;
  const offset = dynamicAmount.offset ?? 0;
  let value =
    Math.floor((baseCount * multiplier) / divisor) * groupMultiplier + offset;
  if (dynamicAmount.subtract !== undefined) {
    const subtractCount = continuousAdditionalCostSourceCount(
      state,
      actingPlayerId,
      dynamicAmount.subtract,
      sourceTribes,
      getCardDefinitionById
    );
    value = Math.max(0, value - subtractCount);
  }
  return dynamicAmount.cap !== undefined
    ? Math.min(value, dynamicAmount.cap)
    : value;
}

function getAdditionalCostModifierAmount(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  if (ce.modifierAmountDynamic !== undefined) {
    const sourceDefinitionId =
      ce.provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId;
    const sourceTribes =
      getCardDefinitionById?.(sourceDefinitionId)?.tribe?.split("・") ?? [];
    return evaluateContinuousAdditionalCostAmount(
      state,
      ce.actingPlayerId,
      ce.modifierAmountDynamic,
      sourceTribes,
      getCardDefinitionById
    );
  }
  return ce.modifierAmount ?? 0;
}

// ============================================================
// cost_override CE ユーティリティ
// ============================================================

const COST_CE_FILTER_FIELD_KEYS = [
  "category",
  "colors",
  "tribes",
  "tribesLogic",
  "tribesRequired",
  "noTribes",
  "excludeTribeSubstring",
  "isToken",
  "zone",
  "usingEffectMode",
  "summonCause",
  "cardName",
  "filterOr",
  "hasMechanic",
  "hasBurstEffect",
  "requiredKeywordTags",
] as const satisfies readonly (keyof CostCEFilterFields)[];

/**
 * 汎用 `CardFilter`（DSL 入力、`CostModifyAction.cardFilter` 等）から、
 * `matchesCostCEFilterClause` が実際に解釈するフィールドだけを抽出する。
 * `cost_override` / `additional_cost`(player+filter 版) への変換境界
 * （native-action-registry.ts の `cost_modify` player 経路）はここを経由すること。
 * CardFilter は構造的に `CostCEFilterFields` を包含するため、型注釈を
 * `CostCEFilterFields` に変えるだけでは対応外フィールド（maxCost 等）の代入を
 * コンパイルエラーで防げない（フレッシュでないオブジェクトへの excess property
 * check は働かない）。実際に値を落とす本関数が唯一の防御線
 * (guard-audit-card-filter-projection 敵対的検証 2026-08-05 Lens 2 で反証)。
 */
export function pickCostCEFilterFields(filter: CardFilter): CostCEFilterFields {
  const picked: CostCEFilterFields = {};
  for (const key of COST_CE_FILTER_FIELD_KEYS) {
    if (key === "filterOr") {
      if (filter.filterOr && filter.filterOr.length > 0) {
        picked.filterOr = filter.filterOr.map(pickCostCEFilterFields);
      }
      continue;
    }
    const value = filter[key];
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 上の COST_CE_FILTER_FIELD_KEYS allowlist で型は保証済み
      (picked as any)[key] = value;
    }
  }
  return picked;
}

/**
 * `ContinuousEffect.targetFilter` (player + category/colors/tribes) が指定カードに
 * 適用できるかの共通判定。`cost_override` / `additional_cost`(player+filter 版) の
 * 両消費経路が共有する SSOT（並行実装しない）。
 */
function matchesCostCETargetFilter(
  ce: ContinuousEffect,
  actingPlayerId: string,
  cardDefinition: CardDefinition,
  options?: {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
    effectiveTribes?: readonly string[];
    effectiveColors?: readonly CardColor[];
    /**
     * 支払い対象カードの現在ゾーン。`filter.zone`（「手札/手元のカード」等）の判定に使う
     * (ENGINE-cost-modify-additional-cost-value-dynamic-amount Step3)。未指定時、
     * `filter.zone` が設定されていればマッチしない（安全側デフォルト）。
     */
    cardZone?: Zone;
    /**
     * 支払い対象カードが現在使用しようとしている起動効果モード。`filter.usingEffectMode`
     * （「マジックカードのスタック効果を使うとき」等）の判定に使う。未指定時、
     * `filter.usingEffectMode` が設定されていればマッチしない（`cardZone` と同じ安全側デフォルト。
     * 召喚/配置等モード文脈の無いコスト計算経路では常に不一致になる）。
     */
    cardEffectMode?: "main" | "flash" | "stack" | "accel";
    /**
     * この召喚を発生させた原因。`filter.summonCause`（BSTH02-C02「相手がバースト効果以外の
     * 効果でスピリットカードを召喚するとき」タックス）の判定に使う。未指定時、
     * `filter.summonCause` が設定されていればマッチしない（`cardZone` と同じ安全側デフォルト。
     * 召喚以外のコスト計算経路 — マジック使用/アクセル等 — では常に不一致になる）。
     */
    summonCause?: "effect" | "burst";
    /**
     * `filter.cardName` の "self" 解決に使う発生源カード定義の lookup
     * (ENGINE-conditional-free-magic-use-on-event)。未指定時、`filter.cardName` が
     * 設定されていてもマッチしない（安全側デフォルト、誤爆よりは無反応を優先）。
     */
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): boolean {
  const filter = ce.targetFilter;
  if (!filter) return false;
  if (ce.targetInstanceId !== undefined) {
    if (options?.card?.instanceId !== ce.targetInstanceId) return false;
  }

  // player ref を実プレイヤーIDに解決。filterOr のサブフィルタ (CardFilter) は
  // player を持たないため、この判定は再帰対象外で1回だけ行う。
  if (filter.player === "self") {
    if (ce.actingPlayerId !== actingPlayerId) return false;
  } else if (filter.player === "opponent") {
    if (ce.actingPlayerId === actingPlayerId) return false;
  }
  // "either" は両プレイヤー対象。チェック不要。

  return matchesCostCEFilterClause(
    filter,
    ce,
    actingPlayerId,
    cardDefinition,
    options
  );
}

function resolveCostCETargetDefinition(
  cardDefinition: CardDefinition,
  options:
    | {
        card?: CardInstance;
        getCardDefinitionById?: (id: string) => CardDefinition | undefined;
      }
    | undefined
): CardDefinition {
  return (
    (options?.card
      ? options.getCardDefinitionById?.(options.card.definitionId)
      : undefined) ?? cardDefinition
  );
}

function withCostCEEffectiveCategories<
  T extends {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
  },
>(
  state: GameState,
  cardDefinition: CardDefinition,
  options: T | undefined
): T | (T & { effectiveCategories: readonly CardCategory[] }) | undefined {
  if (options?.effectiveCategories !== undefined) {
    return options as T & { effectiveCategories: readonly CardCategory[] };
  }
  const targetDefinition = resolveCostCETargetDefinition(
    cardDefinition,
    options
  );
  if (options?.card !== undefined) {
    const effectiveCategory = getEffectiveCategory(
      state,
      options.card,
      targetDefinition
    );
    if (effectiveCategory === undefined) {
      return { ...options, effectiveCategories: [] };
    }
    const effectiveCategories = [effectiveCategory];
    if (isMagicCompatibleCardForm(options.card, targetDefinition)) {
      effectiveCategories.push("magic");
    }
    return { ...options, effectiveCategories };
  }
  return options;
}

/**
 * `matchesCostCETargetFilter` の再帰可能な内部本体（player 判定を除くカード形状判定）。
 * `filterOr`（「マジックカード/【アクセル】」のような OR 結合フィルタ、BSAZ02-C12
 * precedent）はサブフィルタ毎に本関数を再帰適用し、いずれか1つが合致すればマッチとする
 * （他の直接フィールドは無視、matchesCardFilter の filterOr 意味論と同一）。
 * `hasMechanic`（【アクセル】等の MechanicName 判定）は cardDefinitionHasMechanic に
 * 委譲（SSOT、並行実装しない）。
 */
function matchesCostCEFilterClause(
  filter: CardFilter,
  ce: ContinuousEffect,
  actingPlayerId: string,
  cardDefinition: CardDefinition,
  options?: {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
    effectiveTribes?: readonly string[];
    effectiveColors?: readonly CardColor[];
    cardZone?: Zone;
    cardEffectMode?: "main" | "flash" | "stack" | "accel";
    summonCause?: "effect" | "burst";
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): boolean {
  const targetDefinition = resolveCostCETargetDefinition(
    cardDefinition,
    options
  );
  if (filter.filterOr && filter.filterOr.length > 0) {
    return filter.filterOr.some((sub) =>
      matchesCostCEFilterClause(
        sub,
        ce,
        actingPlayerId,
        cardDefinition,
        options
      )
    );
  }

  // メカニクス判定（【アクセル】等）。cardDefinitionHasMechanic (SSOT) に委譲。
  if (filter.hasMechanic && filter.hasMechanic.length > 0) {
    if (
      !filter.hasMechanic.some((m) =>
        cardDefinitionHasMechanic(targetDefinition, m)
      )
    ) {
      return false;
    }
  }
  if (
    filter.requiredKeywordTags !== undefined &&
    !filter.requiredKeywordTags.every((tag) =>
      targetDefinition.keywordTags.includes(tag)
    )
  ) {
    return false;
  }
  if (filter.hasBurstEffect !== undefined) {
    if (cardHasBurstEffect(targetDefinition) !== filter.hasBurstEffect) {
      return false;
    }
  }

  // カード名（instance/カード名単位の scoping。「手札にあるこのカードは〜」等、
  // class-wide filter だけでは同色/同系統の他カードを巻き込む誤爆を防ぐ）
  if (filter.cardName !== undefined) {
    const sourceDefinition = options?.getCardDefinitionById?.(
      ce.sourceDefinitionId
    );
    if (
      !matchesCardName(targetDefinition.name, filter.cardName, sourceDefinition)
    ) {
      return false;
    }
  }

  // カテゴリ
  const effectiveCategories = options?.effectiveCategories ?? [];
  if (filter.category && filter.category.length > 0) {
    if (options?.effectiveCategories === undefined) {
      if (
        !matchesCardFilterByDef(targetDefinition, { category: filter.category })
      )
        return false;
    } else if (
      !filter.category.some((category) =>
        effectiveCategories.includes(category)
      )
    ) {
      return false;
    }
  }

  // ゾーン（「手札/手元のカード」等）
  if (filter.zone && filter.zone.length > 0) {
    if (!options?.cardZone || !filter.zone.includes(options.cardZone)) {
      return false;
    }
  }

  // 使用中の起動効果モード（「マジックカードのスタック効果を使うとき」等）
  if (filter.usingEffectMode && filter.usingEffectMode.length > 0) {
    if (
      !options?.cardEffectMode ||
      !filter.usingEffectMode.includes(options.cardEffectMode)
    ) {
      return false;
    }
  }

  // 召喚原因（「バースト効果以外の効果で召喚するとき」等、BSTH02-C02）
  if (filter.summonCause && filter.summonCause.length > 0) {
    if (
      !options?.summonCause ||
      !filter.summonCause.includes(options.summonCause)
    ) {
      return false;
    }
  }

  // 色 (どれか1つでも一致)
  const colors = options?.effectiveColors ?? targetDefinition.colors;
  if (filter.colors && filter.colors.length > 0) {
    if (!filter.colors.some((c) => colors.includes(c))) {
      return false;
    }
  }

  // 系統判定は matchesTribes (SSOT) に委譲。並行実装しない
  // (tribesRequired/tribesLogic/excludeTribeSubstring も同一意味論で追従)。
  if (
    !matchesTribes(targetDefinition.tribe, filter, options?.effectiveTribes)
  ) {
    return false;
  }

  // トークンカード判定 (isToken)。isCardDefinitionToken (SSOT) に委譲。
  if (filter.isToken !== undefined) {
    if (isCardDefinitionToken(targetDefinition) !== filter.isToken)
      return false;
  }

  return true;
}

/**
 * 指定マジック/カードの使用に対し有効な cost_override CE を返す。
 *
 * cost_override CE は targetFilter (player + category/colors/tribes) を持つ。
 * 「自分は系統:紅魔/導魔のマジックをコストを支払わずに使える」(パチュリー) のように
 * 「player のこの種類のカード」に適用される動的フィルタ型 CE である。
 *
 * 戻り値は modifierAmount に "上書き後コスト" を持つ CE 一覧。
 * パチュリーのような「無料化」では modifierAmount === 0。
 */
export function getApplicableCostOverrideCEs(
  state: GameState,
  actingPlayerId: string,
  cardDefinition: CardDefinition,
  options?: {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
    effectiveTribes?: readonly string[];
    effectiveColors?: readonly CardColor[];
    cardZone?: Zone;
    cardEffectMode?: "main" | "flash" | "stack" | "accel";
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): readonly ContinuousEffect[] {
  const filterOptions = withCostCEEffectiveCategories(
    state,
    cardDefinition,
    options
  );
  const ces =
    options?.card !== undefined
      ? [
          ...getGlobalCEs(state),
          ...getCEsForTarget(state, options.card.instanceId),
        ]
      : getGlobalCEs(state);
  return ces.filter((ce) => {
    if (ce.modifierTag !== "cost_override") return false;
    if (ce.modifierAmount === undefined) return false;
    return matchesCostCETargetFilter(
      ce,
      actingPlayerId,
      cardDefinition,
      filterOptions
    );
  });
}

// ============================================================
// additional_cost (player+filter 版) CE ユーティリティ
// ============================================================

/**
 * 指定カードの支払いコストに対し有効な additional_cost CE (player+filter 版) を返す。
 * 「自分の導力器トークンマジックの使用コストを-1する」(BSLH01) 等、cost_override
 * (絶対値上書き) とは異なり印字コストへの相対加算/軽減を表す。単体カード対象版
 * (`targetInstanceId`、「このカードのコストはXとしても扱う」) は既存 `getAdditionalCosts`
 * が引き続き担当するため、ここでは `targetFilter` 版のみを対象にする
 * (ENGINE-cost-modify-additional-cost-value-player-path-dead)。
 */
export function getApplicableAdditionalCostDeltaCEs(
  state: GameState,
  actingPlayerId: string,
  cardDefinition: CardDefinition,
  options?: {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
    effectiveTribes?: readonly string[];
    effectiveColors?: readonly CardColor[];
    cardZone?: Zone;
    cardEffectMode?: "main" | "flash" | "stack" | "accel";
    summonCause?: "effect" | "burst";
    onlyAdditionalPayment?: boolean;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): readonly ContinuousEffect[] {
  const filterOptions = withCostCEEffectiveCategories(
    state,
    cardDefinition,
    options
  );
  return getGlobalCEs(state).filter((ce) => {
    if (ce.modifierTag !== "additional_cost") return false;
    if (
      options?.onlyAdditionalPayment &&
      ce.metadata?.additionalPayment !== true
    )
      return false;
    if (
      ce.modifierAmount === undefined &&
      ce.modifierAmountDynamic === undefined
    ) {
      return false;
    }
    if (ce.targetInstanceId !== undefined) return false;
    return matchesCostCETargetFilter(
      ce,
      actingPlayerId,
      cardDefinition,
      filterOptions
    );
  });
}

/**
 * `getApplicableAdditionalCostDeltaCEs` の合計 delta（複数重複時は加算）。
 * `calculateReduction` (cost-system.ts) が全コスト計算経路
 * (summon/place_nexus/set_mirage/use_magic/accel/change) で自動合流させる。
 */
export function getApplicableAdditionalCostDelta(
  state: GameState,
  actingPlayerId: string,
  cardDefinition: CardDefinition,
  options?: {
    card?: CardInstance;
    effectiveCategories?: readonly CardCategory[];
    effectiveTribes?: readonly string[];
    effectiveColors?: readonly CardColor[];
    cardZone?: Zone;
    cardEffectMode?: "main" | "flash" | "stack" | "accel";
    summonCause?: "effect" | "burst";
    onlyAdditionalPayment?: boolean;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): number {
  return getApplicableAdditionalCostDeltaCEs(
    state,
    actingPlayerId,
    cardDefinition,
    options
  ).reduce(
    (sum, ce) =>
      sum +
      getAdditionalCostModifierAmount(
        state,
        ce,
        options?.getCardDefinitionById
      ),
    0
  );
}
