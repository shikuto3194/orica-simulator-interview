import { getExtendedFieldSymbolSourceCards } from "../card/field-symbol-source-extension";
import { getDeckHandCards, isCardInEffectZone } from "./card-access-rules";
// Condition 評価クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
import { hasEffectiveAdventVariant } from "../mechanics/advent-variant";
/**
 * 共有アクション実行エンジン。
 * 個別の execute* 関数（executeDestroy / executeSummon など）を export し、
 * effect-interpreter.ts:executeNativeAction から直接呼び出される形で利用される。
 */
import type {
  CardCategory,
  CardDefinition,
  CardInstance,
  Condition,
  ConditionClause,
  GameState,
  QuartzAttribute,
  Step,
} from "../model";
import {
  countUniqueColors,
  grandwalkerKindMatches,
  immuneProtectedCount,
  adventSourceIdsOf,
  collectUnderCardScopeIds,
  resolveSelfReferenceCard,
} from "../model";

/**
 * トリガーイベントのコンテキスト情報。
 * evaluateConditionClause で trigger_colors / trigger_from_zone の評価に使用。
 */
import {
  getPlayerLifeCoreCount,
  getTotalCoresOnCardById,
  isLifeDamageInterceptionUseCostGateUsedThisTurn,
} from "../core/core-system";
import { getCardById } from "../card/card-lookup";

import {
  getCombinedUnitBp,
  getEffectiveLevel,
  getCombinedUnitSymbols,
  getCombinedUnitSymbolCount,
  getBattleEntityByMemberInstanceId,
} from "../battle/battle-shared";

import { wouldQueueOracleChoices } from "../mechanics/oracle-system";
import { countTextRoleUnderCards } from "../mechanics/star-garment-utils";
import {
  getQuartzAttributeSum,
  QUARTZ_ATTRIBUTES,
} from "../mechanics/quartz-system";

import {
  isContractDefinition,
  isMagicCompatibleCardForm,
  matchesCardReferenceFilter,
  matchesPendingBattleDeclaration,
  matchesTribes,
  shouldExcludeAttachedCombinedChildForFieldCategoryFilter,
  type MatchCardFilterOptions,
} from "../card/card-filter";
import {
  getEffectiveCardName,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import {
  getEffectiveCategories,
  getEffectiveCategory,
  getEffectiveTribe,
  matchesActAsSpiritSourceScope,
} from "../mechanics/act-as-spirit";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import {
  getVirtualCombinedBraves,
  isCombinedBrave,
  isEffectivelyCombined,
} from "../mechanics/virtual-combine";

import { resolvePlayerRef } from "./structured-effect-interpreter";
import { evaluateApplicability } from "./effect-applicability";
import type { CardFilter, CardNameMatch } from "../dsl-types";
import type { TriggerContext } from "./structured-effect-interpreter";

function conditionCardFilterEvaluators(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext?: TriggerContext,
  sourceContext?: ConditionSourceContext
): Pick<MatchCardFilterOptions, "evaluateCondition" | "evaluateApplicability"> {
  return {
    evaluateCondition: (condition, sourceInstanceId, actingPlayerId) =>
      evaluateCondition(
        state,
        condition,
        sourceInstanceId,
        actingPlayerId,
        getCardDefinitionById,
        triggerContext,
        sourceContext
      ),
    evaluateApplicability: (applicability, sourceInstanceId) =>
      evaluateApplicability(
        state,
        applicability,
        sourceInstanceId,
        getCardDefinitionById
      ),
  };
}

export interface ConditionSourceContext {
  /**
   * For effects provided by a combined brave, condition clauses use the brave
   * text source but host-relative clauses must inspect the current host chosen
   * by the caller. This also covers imagin right-combine, where attachedTo still
   * points at the left host.
   */
  combinedBraveHostSourceInstanceId?: string;
}

function resolveConditionClauseSourceInstanceId(
  sourceInstanceId: string,
  clause: ConditionClause,
  sourceContext?: ConditionSourceContext
): string {
  if (
    clause.kind === "min_level" &&
    sourceContext?.combinedBraveHostSourceInstanceId !== undefined
  ) {
    return sourceContext.combinedBraveHostSourceInstanceId;
  }
  return sourceInstanceId;
}

function getCombinedHostCardForCondition(
  state: GameState,
  sourceCard: CardInstance | undefined,
  sourceContext?: ConditionSourceContext
): CardInstance | undefined {
  const hostInstanceId =
    sourceContext?.combinedBraveHostSourceInstanceId ??
    sourceCard?.attachedToInstanceId ??
    undefined;
  return hostInstanceId ? getCardById(state, hostInstanceId) : undefined;
}

function getCardFilterEffectiveBp(
  state: GameState,
  card: CardInstance,
  def: CardDefinition | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | undefined {
  return card.zone === "field"
    ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
    : undefined;
}

export function getCardCurrentLevel(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  return getEffectiveLevel(state, card, def, getCardDefinitionById);
}

function getConditionEffectiveCategories(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): readonly CardCategory[] {
  const effectiveCategory = getEffectiveCategory(state, card, def);
  if (effectiveCategory === undefined) return [];
  const categories = getEffectiveCategories(
    state,
    card,
    def,
    getCardDefinitionById
  );
  if (isMagicCompatibleCardForm(card, def)) {
    return categories.includes("magic") ? categories : [...categories, "magic"];
  }
  return categories;
}

function matchesConditionCategories(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  categories: readonly CardCategory[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    shouldExcludeAttachedCombinedChildForFieldCategoryFilter(state, card, def, {
      category: [...categories],
    })
  ) {
    return false;
  }
  const effectiveCategories = getConditionEffectiveCategories(
    state,
    card,
    def,
    getCardDefinitionById
  );
  return categories.some((category) => effectiveCategories.includes(category));
}

function matchesCardNameMatch(cardName: string, match: CardNameMatch): boolean {
  if (match === "self") return false;
  return "exact" in match
    ? cardName === match.exact
    : cardName.includes(match.contains);
}

function countSummonedThisTurnColors(
  state: GameState,
  actingPlayerId: string,
  clause: Extract<ConditionClause, { kind: "summoned_this_turn_color_count" }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext?: TriggerContext
): number {
  const playerIds = new Set(
    resolveConditionPlayerIds(actingPlayerId, clause.player, state)
  );
  let total = 0;
  for (const ref of state.turnSummonedCardRefs ?? []) {
    if (!playerIds.has(ref.playerId)) continue;
    const card = getCardById(state, ref.instanceId);
    const def = getCardDefinitionById(ref.definitionId);
    if (!card || !def) continue;
    if (
      clause.filter &&
      !matchesCardReferenceFilter(card, def, clause.filter, {
        ...conditionCardFilterEvaluators(
          state,
          getCardDefinitionById,
          triggerContext
        ),
        currentCard: card,
        cardZone: card.zone,
        state,
        getCardDefinitionById,
        effectiveColors: ref.colors,
        effectiveCategory: ref.category,
        effectiveCategories:
          ref.category !== undefined ? [ref.category] : undefined,
        effectiveTribes: ref.tribes,
        effectiveBp: getCardFilterEffectiveBp(
          state,
          card,
          def,
          getCardDefinitionById
        ),
        coreCount:
          card.zone === "field"
            ? getTotalCoresOnCardById(state, card.instanceId)
            : undefined,
        effectiveLevel:
          card.zone === "field"
            ? getEffectiveLevel(state, card, def, getCardDefinitionById)
            : undefined,
        effectiveSymbolCount:
          card.zone === "field"
            ? getCombinedUnitSymbolCount(
                state,
                card,
                def,
                getCardDefinitionById
              )
            : undefined,
      })
    ) {
      continue;
    }
    total += countUniqueColors(ref.colors);
  }
  return total;
}

function getCountAsMultipleWeights(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  soulStateIds: ReadonlySet<string>,
  adventSourceIds: ReadonlySet<string>,
  textRoleUnderIds: ReadonlySet<string>
): number[] {
  let weight = 1;
  const optionalWeights: number[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "count_as_multiple") continue;
    if (ce.targetInstanceId !== actingPlayerId) continue;
    const metadata = ce.metadata as
      | { filter?: CardFilter; multiplier?: unknown; optionalCount?: boolean }
      | undefined;
    const multiplier =
      typeof metadata?.multiplier === "number"
        ? Math.floor(metadata.multiplier)
        : 1;
    if (multiplier <= weight) continue;
    const filter = metadata?.filter;
    if (
      filter &&
      !matchesCardReferenceFilter(card, def, filter, {
        state,
        soulStateIds,
        underCardIds: {
          adventSource: adventSourceIds,
          textRole: textRoleUnderIds,
        },
        effectiveBp: getCardFilterEffectiveBp(
          state,
          card,
          def,
          getCardDefinitionById
        ),
        effectiveLevel:
          card.zone === "field"
            ? getEffectiveLevel(state, card, def, getCardDefinitionById)
            : undefined,
        ...conditionCardFilterEvaluators(state, getCardDefinitionById),
      })
    ) {
      continue;
    }
    if (metadata?.optionalCount) optionalWeights.push(multiplier);
    else weight = multiplier;
  }
  return [
    ...new Set([
      weight,
      ...optionalWeights.map((value) => Math.max(weight, value)),
    ]),
  ];
}

function getFieldHasCounts(
  state: GameState,
  matched: readonly CardInstance[],
  clause: Extract<ConditionClause, { kind: "field_has" }>,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  soulStateIds: ReadonlySet<string>,
  adventSourceIds: ReadonlySet<string>,
  textRoleUnderIds: ReadonlySet<string>
): number[] {
  if (!clause.cardNames || clause.cardNames.length === 0)
    return [matched.length];
  let counts = new Set([0]);
  for (const card of matched) {
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    const weights = getCountAsMultipleWeights(
      state,
      card,
      def,
      actingPlayerId,
      getCardDefinitionById,
      soulStateIds,
      adventSourceIds,
      textRoleUnderIds
    );
    const next = new Set<number>();
    for (const count of counts)
      for (const weight of weights) next.add(count + weight);
    counts = next;
  }
  return [...counts];
}

function resolveConditionPlayerIds(
  actingPlayerId: string,
  ref: import("../model").EffectPlayerRef,
  state: GameState
): string[] {
  if (ref === "either") return state.players.map((player) => player.id);
  return [resolvePlayerRef(actingPlayerId, ref, state)];
}

/**
 * 単一の ConditionClause を評価する。
 */
export function evaluateConditionClause(
  state: GameState,
  clause: ConditionClause,
  sourceInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext?: TriggerContext,
  sourceContext?: ConditionSourceContext
): boolean {
  sourceInstanceId = resolveConditionClauseSourceInstanceId(
    sourceInstanceId,
    clause,
    sourceContext
  );
  const sourceCard = getCardById(state, sourceInstanceId);

  switch (clause.kind) {
    case "min_level": {
      if (!sourceCard) return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def) return false;
      return (
        getCardCurrentLevel(state, sourceCard, def, getCardDefinitionById) >=
        clause.value
      );
    }

    case "combined": {
      if (!sourceCard) return false;
      // 「合体中」= 合体ユニットの一員。
      return isEffectivelyCombined(state, sourceCard);
    }

    case "combined_host_category": {
      // ブレイヴ側のみ意味を持つ (自身がホストに合体している間、そのホストの category を見る)。
      // 非合体中・スピリット側 (自身がホスト) は false。
      const hostCard = getCombinedHostCardForCondition(
        state,
        sourceCard,
        sourceContext
      );
      if (!hostCard) return false;
      const hostDef = getCardDefinitionById(hostCard.definitionId);
      if (!hostDef) return false;
      // getEffectiveCategory の undefined は「素性なし/このカテゴリではない扱い」を
      // 明示的に表す (裏向き+act_as_spirit無し、excludeCategory override 等)。
      // printedCategory へフォールバックすると「印字カテゴリを漏らさない」不変条件を破り、
      // 本来 false になるべきケースを誤って true 化する (line 99-104 の
      // getConditionEffectiveCategories と同じ規約: undefined = マッチしない)。
      const effectiveCategory = getEffectiveCategory(state, hostCard, hostDef);
      if (effectiveCategory === undefined) return false;
      return clause.categories.includes(effectiveCategory);
    }

    case "combined_host_tribes": {
      // ブレイヴ側のみ意味を持つ (自身がホストに合体している間、そのホストの系統を見る)。
      const hostCard = getCombinedHostCardForCondition(
        state,
        sourceCard,
        sourceContext
      );
      if (!hostCard) return false;
      const hostDef = getCardDefinitionById(hostCard.definitionId);
      const hostTribes = getEffectiveTribes(
        state,
        hostCard,
        hostDef,
        getCardDefinitionById
      );
      return matchesTribes(undefined, clause, hostTribes);
    }

    case "combined_host_card_name": {
      // ブレイヴ側のみ意味を持つ (自身がホストに合体している間、そのホストの名前を見る)。
      const hostCard = getCombinedHostCardForCondition(
        state,
        sourceCard,
        sourceContext
      );
      if (!hostCard) return false;
      const hostDef = getCardDefinitionById(hostCard.definitionId);
      if (!hostDef) return false;
      const hostName = getEffectiveCardName(
        state,
        hostCard,
        hostDef,
        getCardDefinitionById
      );
      return clause.cardNames.some((m) => matchesCardNameMatch(hostName, m));
    }

    case "combined_host_advent_source_card_name": {
      // ブレイヴ側のみ意味を持つ (自身がホストに合体している間、そのホストの煌臨元を見る)。
      const hostCard = getCombinedHostCardForCondition(
        state,
        sourceCard,
        sourceContext
      );
      if (!hostCard) return false;
      if (clause.requireContractAdventVariant) {
        const hostDef = getCardDefinitionById(hostCard.definitionId);
        if (
          !hasEffectiveAdventVariant(state, hostCard.instanceId, hostDef, [
            "contract",
          ])
        )
          return false;
      }
      const adventSourceNames = adventSourceIdsOf(hostCard)
        .map((id) => getCardById(state, id))
        .filter((c): c is CardInstance => c !== undefined)
        .map((c) => getCardDefinitionById(c.definitionId)?.name)
        .filter((n): n is string => n !== undefined);
      return clause.cardNames.some((m) =>
        adventSourceNames.some((name) => matchesCardNameMatch(name, m))
      );
    }

    case "trigger_source_is_combined_host": {
      if (!sourceCard || sourceCard.attachedToInstanceId === null) {
        return false;
      }
      return (
        triggerContext?.sourceInstanceId === sourceCard.attachedToInstanceId
      );
    }

    case "combined_guest_tribes": {
      // ホスト側のみ意味を持つ (自身にブレイヴが合体している間、そのブレイヴの系統を見る)。
      // 複数体合体していればいずれか1体が一致すれば true。
      if (!sourceCard) return false;
      const guestCards = state.cardInstances.filter(
        (c) => c.attachedToInstanceId === sourceInstanceId && c.zone === "field"
      );
      return (
        guestCards.some((guestCard) => {
          const guestDef = getCardDefinitionById(guestCard.definitionId);
          const guestTribes = getEffectiveTribes(
            state,
            guestCard,
            guestDef,
            getCardDefinitionById
          );
          return matchesTribes(undefined, clause, guestTribes);
        }) ||
        getVirtualCombinedBraves(state, sourceInstanceId).some((guest) =>
          matchesTribes(undefined, clause, guest.tribes ?? [])
        )
      );
    }

    case "self_state": {
      const conditionCard =
        clause.reference === "self"
          ? resolveSelfReferenceCard(state, sourceInstanceId, true)
          : sourceCard;
      if (!conditionCard) return false;
      if (clause.filter) {
        const definition = getCardDefinitionById(conditionCard.definitionId);
        if (
          !definition ||
          !matchesCardReferenceFilter(
            conditionCard,
            definition,
            clause.filter,
            {
              ...conditionCardFilterEvaluators(
                state,
                getCardDefinitionById,
                triggerContext
              ),
              state,
              getCardDefinitionById,
              currentCard: conditionCard,
              cardZone: conditionCard.zone,
              effectiveLevel: getEffectiveLevel(
                state,
                conditionCard,
                definition,
                getCardDefinitionById
              ),
              soulStateIds: getEffectiveSoulStateIds(
                state,
                getCardDefinitionById
              ),
              underCardIds: collectUnderCardScopeIds(state),
              effectiveCategory: getEffectiveCategory(
                state,
                conditionCard,
                definition
              ),
              effectiveCategories: getEffectiveCategories(
                state,
                conditionCard,
                definition
              ),
            }
          )
        )
          return false;
      }
      if (
        clause.battleState !== undefined ||
        clause.pendingDeclaration !== undefined
      ) {
        const battleEntity = getBattleEntityByMemberInstanceId(
          state,
          conditionCard.instanceId
        );
        const matchesBattleState =
          clause.battleState === undefined
            ? false
            : clause.battleState === "in_battle"
              ? battleEntity?.attackState === "attacking" ||
                battleEntity?.attackState === "blocking"
              : battleEntity?.attackState === clause.battleState;
        const matchesPendingDeclaration =
          clause.pendingDeclaration !== undefined &&
          matchesPendingBattleDeclaration(
            state,
            conditionCard.instanceId,
            clause.pendingDeclaration
          );
        if (!matchesBattleState && !matchesPendingDeclaration) {
          return false;
        }
      }
      if (clause.state === "on_field") return conditionCard.zone === "field";
      // 【煌臨中】= 表向き煌臨元≧1（10_rules/08a L34、adventSourceIdsOf を正源 helper として経由）。
      if (clause.state === "advented")
        return adventSourceIdsOf(conditionCard).length > 0;
      // 【契約煌臨元】継続ゲート: 自身が他カードの煌臨元（role='advent_source'）として
      // 下に置かれている間だけ true。SSOT は collectUnderCardScopeIds（model）。
      if (clause.state === "in_advent_source") {
        const { adventSource } = collectUnderCardScopeIds(state);
        return adventSource.has(conditionCard.instanceId);
      }
      // ENGINE-accel-tribe-cost-override: 「〜に置かれたターンの間」ゲート。
      // moveCardZone がゾーン変更時にスタンプする zoneEnteredAtTurn と現在ターンを比較する。
      if (clause.state === "zone_entered_this_turn") {
        return conditionCard.zoneEnteredAtTurn === state.turnNumber;
      }
      return conditionCard.exhaustState === clause.state;
    }

    case "correlated_pending_trigger_active": {
      // P3-129: 効果発生源自身が記録した相関 pendingId のいずれかが、現在も
      // state.pendingTriggeredEffects に存在するか (=相手側誘発が未解決か) を判定する。
      // 書き込みは correlate_pending_trigger Action のみ (SSOT)。
      if (!sourceCard) return false;
      const correlatedIds = sourceCard.pendingTriggerCorrelations?.[clause.key];
      if (!correlatedIds || correlatedIds.length === 0) return false;
      return state.pendingTriggeredEffects.some((pending) =>
        correlatedIds.includes(pending.pendingId)
      );
    }

    case "trigger_related_instance_off_field": {
      // ENGINE-targeted-disclosure-offfield-source: trigger の relatedInstanceId が
      // 評価時点で zone!=="field" か。TriggerContext.relatedInstanceZone 未注入
      // (対象なし/このイベント種別では relatedInstanceId が無い等) は fail-closed。
      if (triggerContext?.relatedInstanceZone === undefined) return false;
      return triggerContext.relatedInstanceZone !== "field";
    }

    case "self_name": {
      const conditionCard =
        clause.reference === "self"
          ? resolveSelfReferenceCard(state, sourceInstanceId)
          : sourceCard;
      if (!conditionCard) return false;
      const def = getCardDefinitionById(conditionCard.definitionId);
      if (!def) return false;
      return clause.names.some((m) =>
        m === "self"
          ? true
          : "exact" in m
            ? def.name === m.exact
            : def.name.includes(m.contains)
      );
    }

    case "self_bp": {
      if (!sourceCard || sourceCard.zone !== "field") return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def) return false;
      const bp = getCombinedUnitBp(
        state,
        sourceCard,
        def,
        getCardDefinitionById
      );
      if (clause.min !== undefined && bp < clause.min) return false;
      if (clause.max !== undefined && bp > clause.max) return false;
      return true;
    }

    case "self_core_count": {
      if (!sourceCard) return false;
      const cores = getTotalCoresOnCardById(state, sourceCard.instanceId);
      if (clause.min !== undefined && cores < clause.min) return false;
      if (clause.max !== undefined && cores > clause.max) return false;
      return true;
    }

    case "self_under_card_count": {
      if (!sourceCard) return false;
      const minCount = clause.minCount ?? 1;
      return (
        countTextRoleUnderCards(
          sourceCard,
          clause.roleTag,
          state,
          getCardDefinitionById
        ) >= minCount
      );
    }

    case "self_advent_source_names": {
      if (!sourceCard) return false;
      const sourceNames = adventSourceIdsOf(sourceCard)
        .map((id) => getCardById(state, id))
        .filter((c): c is CardInstance => c !== undefined)
        .map((c) => getCardDefinitionById(c.definitionId)?.name)
        .filter((n): n is string => n !== undefined);
      const matchesOne = (m: (typeof clause.names)[number]) =>
        sourceNames.some((name) => matchesCardNameMatch(name, m));
      return clause.logic === "or"
        ? clause.names.some(matchesOne)
        : clause.names.every(matchesOne);
    }

    case "field_has": {
      // "either" = 自分のフィールド OR 相手のフィールドのいずれかが単独で条件を満たす
      // (既定、needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C、2026-07-17)。resolveConditionPlayerIds
      // で両プレイヤーの playerId をまとめて filter すると minCount 等の閾値が両者合算判定に
      // なってしまう（field-has-either-player.test.ts で明示的に禁止）ため、self/opponent
      // それぞれに解決した同一 clause を再帰評価して OR する。`sumAcrossPlayers:true` の
      // ときはこの OR 分岐をバイパスし、下の一般パスへ流す（resolveConditionPlayerIds が
      // 両プレイヤーの playerId をまとめて返すため、matched が両者合算の1リストになり
      // minCount/maxCount が合算枚数に対して判定される、BSTH02-X01-self-count 裁定）。
      if (clause.player === "either" && !clause.sumAcrossPlayers) {
        const selfClause = { ...clause, player: "self" as const };
        const opponentClause = { ...clause, player: "opponent" as const };
        return (
          evaluateConditionClause(
            state,
            selfClause,
            sourceInstanceId,
            actingPlayerId,
            getCardDefinitionById,
            triggerContext
          ) ||
          evaluateConditionClause(
            state,
            opponentClause,
            sourceInstanceId,
            actingPlayerId,
            getCardDefinitionById,
            triggerContext
          )
        );
      }
      const playerIds = new Set(
        resolveConditionPlayerIds(actingPlayerId, clause.player, state)
      );
      const targetZone = clause.zone ?? "field";
      const extendedSymbolIds = getConditionExtendedSymbolIds(
        state,
        clause,
        playerIds,
        getCardDefinitionById
      );
      // 名前参照の包含スコープ（10_rules/08a, 裁定 2026-06-13）。魂状態・アンダーカードは
      // 通常フィールドゾーンに留まるため、接頭句で opt-in されない限り除外する。
      // アンダーカードの集合は collectUnderCardScopeIds（model）を SSOT として共有する
      // （reference 経路 = target-resolution の候補列挙も同じ集合を使う）。
      const soulStateIds = getEffectiveSoulStateIds(
        state,
        getCardDefinitionById
      );
      const { adventSource: adventSourceIds, textRole: textRoleUnderIds } =
        collectUnderCardScopeIds(state);
      const matched = state.cardInstances.filter((c) => {
        if (c.zone !== targetZone && !extendedSymbolIds.has(c.instanceId))
          return false;
        if (!playerIds.has(c.controllerPlayerId)) return false;
        if (clause.excludeSelf && c.instanceId === sourceInstanceId)
          return false;
        // text_role アンダーカード（星霊衣/アルドノア等）は常に数えない。
        if (textRoleUnderIds.has(c.instanceId)) return false;
        if (
          soulStateIds.has(c.instanceId) &&
          !clause.includeSoulState &&
          !clause.soulStateOnly
        )
          return false;
        if (adventSourceIds.has(c.instanceId) && !clause.includeAdventSource)
          return false;
        if (clause.soulStateOnly && !soulStateIds.has(c.instanceId))
          return false;
        // 枚数・ゾーンは公開情報。viewer 状態では山札等の定義が伏せられるので、
        // 定義を必要とする条件だけで def を要求する（単なる枚数条件には不要）。
        const def = getCardDefinitionById(c.definitionId);
        // field_has のコスト条件は CardFilter と同じ語彙だが、存在量化では場の実効コスト
        // 追従を明示しない限り「本来のコスト」を基準にする。
        if (clause.minCost !== undefined && (!def || def.cost < clause.minCost))
          return false;
        if (clause.maxCost !== undefined && (!def || def.cost > clause.maxCost))
          return false;
        if (clause.category && clause.category.length > 0) {
          if (!def) return false;
          if (
            !matchesConditionCategories(
              state,
              c,
              def,
              clause.category,
              getCardDefinitionById
            )
          )
            return false;
        }
        if (clause.colors && clause.colors.length > 0) {
          if (!def) return false;
          const effColors = getEffectiveColors(state, c, def);
          if (!effColors.some((col) => clause.colors!.includes(col)))
            return false;
        }
        // 合体先を1体としてシンボル色を参照し、合体子を別の供給源として数えない。
        // 「自分の青シンボルがあるとき」型: カード色（colors）ではなく実効シンボルに
        // 指定色のいずれかが含まれるかを判定する（BSTH07-転醒R01(B)[1] 等）。
        if (clause.symbolColors && clause.symbolColors.length > 0) {
          if (!def) return false;
          if (isCombinedBrave(state, c, def)) return false;
          const effSymbols = getCombinedUnitSymbols(
            state,
            c,
            def,
            getCardDefinitionById
          );
          if (!effSymbols.some((sym) => clause.symbolColors!.includes(sym)))
            return false;
        }
        // 色数条件（「青1色のネクサス」= 単色青、10_rules 標準カード解釈）。
        if (clause.colorCount) {
          if (!def) return false;
          const uniqueColors = new Set(getEffectiveColors(state, c, def));
          if (clause.colorCount === "mono" && uniqueColors.size !== 1)
            return false;
          if (clause.colorCount === "multi" && uniqueColors.size < 2)
            return false;
        }
        if (
          (clause.tribes && clause.tribes.length > 0) ||
          (clause.tribesRequired && clause.tribesRequired.length > 0)
        ) {
          if (!def) return false;
          const effectiveTribe = getEffectiveTribe(
            state,
            c,
            def,
            getCardDefinitionById
          );
          if (
            !matchesTribes(effectiveTribe, {
              tribes: clause.tribes ?? [],
              tribesRequired: clause.tribesRequired ?? [],
            })
          )
            return false;
        }
        if (clause.isContract && (!def || !isContractDefinition(def)))
          return false;
        if (
          clause.requiredKeywordTags !== undefined &&
          !clause.requiredKeywordTags.every((tag) =>
            def?.keywordTags.includes(tag)
          )
        ) {
          return false;
        }
        // カード名一致 (「自分の『剣心』がいる」等)。
        if (clause.cardNames && clause.cardNames.length > 0) {
          if (!def) return false;
          const selfName =
            sourceCard && getCardDefinitionById(sourceCard.definitionId)?.name;
          const matchesName = clause.cardNames.some((m) =>
            m === "self"
              ? selfName !== undefined && def.name === selfName
              : "exact" in m
                ? def.name === m.exact
                : def.name.includes(m.contains)
          );
          if (!matchesName) return false;
        }
        // カード名一致の除外フィルタ (「『オルテュギア』以外の…」等)。
        // act_as_spirit/override_properties によるカード名固定上書き (BSAZ02-X03 の
        // 自己生成分身トークン等) も除外判定に反映するため実効名 (getEffectiveCardName) で
        // 照合する (`cardNames` 包含フィルタは既存カード群の raw def.name 依存を崩さぬよう
        // 据え置き、`excludeCardNames` は新設フィールドのため実効名を正とする)。
        if (clause.excludeCardNames && clause.excludeCardNames.length > 0) {
          if (!def) return false;
          const effectiveName = getEffectiveCardName(
            state,
            c,
            def,
            getCardDefinitionById
          );
          const matchesExcluded = clause.excludeCardNames.some((m) =>
            m === "self"
              ? sourceCard !== undefined &&
                effectiveName ===
                  getCardDefinitionById(sourceCard.definitionId)?.name
              : "exact" in m
                ? effectiveName === m.exact
                : effectiveName.includes(m.contains)
          );
          if (matchesExcluded) return false;
        }
        // カード名一致の実効名版 (`cardNames` の姉妹フィールド、excludeCardNames と同じ
        // getEffectiveCardName 照合経路。act_as_spirit/override_properties でカード名を
        // 上書きされた自己生成トークンを INCLUDE 側で拾う用途、BSAZ02-X03【分身：1】上限)。
        if (clause.cardNamesEffective && clause.cardNamesEffective.length > 0) {
          if (!def) return false;
          const effectiveName = getEffectiveCardName(
            state,
            c,
            def,
            getCardDefinitionById
          );
          const matchesEffective = clause.cardNamesEffective.some((m) =>
            m === "self"
              ? sourceCard !== undefined &&
                effectiveName ===
                  getCardDefinitionById(sourceCard.definitionId)?.name
              : "exact" in m
                ? effectiveName === m.exact
                : effectiveName.includes(m.contains)
          );
          if (!matchesEffective) return false;
        }
        // act_as_spirit トークン限定 (印字上の実カードと同名になるトークンを区別する用途、
        // round2 adversarial verifier 指摘 BSAZ02-X03【分身：1】上限ゲート)。SSOT:
        // matchesActAsSpiritSourceScope (act-as-spirit.ts、CardFilter.actAsSpiritOnly/
        // actAsSpiritSourceSelf の消費先 target-resolution.ts と共有)。
        if (
          clause.actAsSpiritOnly &&
          !matchesActAsSpiritSourceScope(
            state,
            c.instanceId,
            sourceInstanceId,
            {
              only: clause.actAsSpiritOnly,
              sourceSelf: clause.actAsSpiritSourceSelf,
            }
          )
        ) {
          return false;
        }
        // バトル状態 (「地霊スピリットがアタックしている間」等)。
        // "in_battle" はアタック中/ブロック中いずれかを許容 (BSAZ02-C17 型)。
        if (clause.battleState) {
          const be = getBattleEntityByMemberInstanceId(state, c.instanceId);
          if (!be) return false;
          if (clause.battleState === "in_battle") {
            if (be.attackState === "idle") return false;
          } else if (be.attackState !== clause.battleState) {
            return false;
          }
        }
        // 煌臨状態 (「煌臨中の自分のスピリットがいるとき」)。表向き煌臨元≧1 = 【煌臨中】
        // （10_rules/08a L34、adventSourceIdsOf を正源 helper として経由）。
        if (clause.adventState === "advented") {
          if (adventSourceIdsOf(c).length === 0) return false;
        }
        if (clause.minCores !== undefined) {
          if (getTotalCoresOnCardById(state, c.instanceId) < clause.minCores)
            return false;
        }
        if (clause.minLevel !== undefined || clause.maxLevel !== undefined) {
          if (!def) return false;
          const level = getEffectiveLevel(state, c, def, getCardDefinitionById);
          if (clause.minLevel !== undefined && level < clause.minLevel)
            return false;
          if (clause.maxLevel !== undefined && level > clause.maxLevel)
            return false;
        }
        // 創界神/導界者種別フィルタ: "grandwalker" = 創界神のみ, "guided" = 導界者のみ, "any" = 両方
        if (clause.grandwalkerKind) {
          if (!def?.grandwalkerData) return false;
          if (
            clause.grandwalkerKind !== "any" &&
            !grandwalkerKindMatches(def.grandwalkerData, clause.grandwalkerKind)
          )
            return false;
        }
        return true;
      });
      const minCount = clause.minCount ?? 1;
      const counts = getFieldHasCounts(
        state,
        matched,
        clause,
        actingPlayerId,
        getCardDefinitionById,
        soulStateIds,
        adventSourceIds,
        textRoleUnderIds
      );
      return counts.some(
        (count) =>
          count >= minCount &&
          (clause.maxCount === undefined || count <= clause.maxCount)
      );
    }

    case "field_lacks": {
      const playerIds = new Set(
        resolveConditionPlayerIds(actingPlayerId, clause.player, state)
      );
      const targetZone = clause.zone ?? "field";
      const extendedSymbolIds = getConditionExtendedSymbolIds(
        state,
        clause,
        playerIds,
        getCardDefinitionById
      );
      const sourceName =
        clause.cardName === "self" && sourceCard
          ? getCardDefinitionById(sourceCard.definitionId)?.name
          : undefined;
      if (clause.cardName === "self" && !sourceName) return true;
      const soulStateIds = getEffectiveSoulStateIds(
        state,
        getCardDefinitionById
      );
      const { adventSource: adventSourceIds, textRole: textRoleUnderIds } =
        collectUnderCardScopeIds(state);
      return !state.cardInstances.some((c) => {
        if (c.zone !== targetZone && !extendedSymbolIds.has(c.instanceId))
          return false;
        if (!playerIds.has(c.controllerPlayerId)) return false;
        if (clause.excludeSelf && c.instanceId === sourceInstanceId)
          return false;
        if (textRoleUnderIds.has(c.instanceId)) return false;
        if (soulStateIds.has(c.instanceId)) return false;
        if (adventSourceIds.has(c.instanceId)) return false;
        const def = getCardDefinitionById(c.definitionId);
        if (!def) return false;
        if (clause.category && clause.category.length > 0) {
          if (
            !matchesConditionCategories(
              state,
              c,
              def,
              clause.category,
              getCardDefinitionById
            )
          )
            return false;
        }
        if (clause.colors && clause.colors.length > 0) {
          const effColors = getEffectiveColors(state, c, def);
          if (!effColors.some((col) => clause.colors!.includes(col)))
            return false;
        }
        if (clause.symbolColors && clause.symbolColors.length > 0) {
          if (isCombinedBrave(state, c, def)) return false;
          const effSymbols = getCombinedUnitSymbols(
            state,
            c,
            def,
            getCardDefinitionById
          );
          if (!effSymbols.some((sym) => clause.symbolColors!.includes(sym)))
            return false;
        }
        if (clause.tribes && clause.tribes.length > 0) {
          const effectiveTribe = getEffectiveTribe(
            state,
            c,
            def,
            getCardDefinitionById
          );
          if (!matchesTribes(effectiveTribe, { tribes: clause.tribes }))
            return false;
        }
        if (sourceName !== undefined && def.name !== sourceName) return false;
        // カード名一致 (「自分の『月読 調』がいないとき」等)。field_has と対称。
        if (clause.cardNames && clause.cardNames.length > 0) {
          const selfName =
            sourceCard && getCardDefinitionById(sourceCard.definitionId)?.name;
          const matchesName = clause.cardNames.some((m) =>
            m === "self"
              ? selfName !== undefined && def.name === selfName
              : "exact" in m
                ? def.name === m.exact
                : def.name.includes(m.contains)
          );
          if (!matchesName) return false;
        }
        // 創界神/導界者種別フィルタ
        if (clause.grandwalkerKind) {
          if (!def.grandwalkerData) return false;
          if (
            clause.grandwalkerKind !== "any" &&
            !grandwalkerKindMatches(def.grandwalkerData, clause.grandwalkerKind)
          )
            return false;
        }
        return true;
      });
    }

    case "field_all_match": {
      // 全称量化 (∀card:P(card))。field_lacks (¬∃card:P(card)) と対称の「満たすべき条件」を
      // filter に直接書ける版 (ENGINE-universal-field-condition)。「filter を満たさないカードが
      // 場に1枚も無い」= 「全カードが filter を満たす」を matchesCardReferenceFilter (SSOT) で判定する。
      const playerIds = new Set(
        resolveConditionPlayerIds(actingPlayerId, clause.player, state)
      );
      const targetZone = clause.zone ?? "field";
      const soulStateIds = getEffectiveSoulStateIds(
        state,
        getCardDefinitionById
      );
      const { adventSource: adventSourceIds, textRole: textRoleUnderIds } =
        collectUnderCardScopeIds(state);
      return !state.cardInstances.some((c) => {
        if (c.zone !== targetZone) return false;
        if (!playerIds.has(c.controllerPlayerId)) return false;
        if (clause.excludeSelf && c.instanceId === sourceInstanceId)
          return false;
        if (textRoleUnderIds.has(c.instanceId)) return false;
        if (soulStateIds.has(c.instanceId)) return false;
        if (adventSourceIds.has(c.instanceId)) return false;
        const def = getCardDefinitionById(c.definitionId);
        if (!def) return false;
        const effectiveTribe = getEffectiveTribe(
          state,
          c,
          def,
          getCardDefinitionById
        );
        return !matchesCardReferenceFilter(c, def, clause.filter, {
          ...conditionCardFilterEvaluators(state, getCardDefinitionById),
          effectiveColors: getEffectiveColors(state, c, def),
          effectiveTribes: effectiveTribe
            ? effectiveTribe.split("・").filter(Boolean)
            : [],
          effectiveBp: getCardFilterEffectiveBp(
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
        });
      });
    }

    case "hand_count": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return false;
      const count =
        player.handCount +
        (playerId === actingPlayerId
          ? getDeckHandCards(state, playerId, getCardDefinitionById).length
          : 0);
      if (clause.min !== undefined && count < clause.min) return false;
      if (clause.max !== undefined && count > clause.max) return false;
      return true;
    }

    case "burst_set_count": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const count = state.setBurstStates.filter(
        (setBurstState) => setBurstState.playerId === playerId
      ).length;
      if (clause.min !== undefined && count < clause.min) return false;
      if (clause.max !== undefined && count > clause.max) return false;
      return true;
    }

    case "completed_battle_count": {
      const count = Math.max(
        0,
        (state.battlesEndedThisTurn ?? 0) -
          new Set(state.pendingBattleEndFinalizeAttackIds).size
      );
      return (
        (clause.min === undefined || count >= clause.min) &&
        (clause.max === undefined || count <= clause.max)
      );
    }

    case "count_value": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return false;
      // 保護カウントは、この条件を評価する効果ソースの系統に応じて数える/数えない。
      const sourceTribes =
        (sourceCard &&
          getCardDefinitionById(sourceCard.definitionId)?.tribe?.split("・")) ||
        [];
      const val =
        player.countValue -
        immuneProtectedCount(player.protectedCounts, sourceTribes);
      if (clause.min !== undefined && val < clause.min) return false;
      if (clause.max !== undefined && val > clause.max) return false;
      return true;
    }

    case "quartz_attribute": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      // host 単位の合計は getQuartzAttributeSum が SSOT（quartz-system.ts）。
      // 同一プレイヤーが制御する host が複数あり得るため host ごとに合算する。
      const hostIds = new Set(
        state.quartzSetStates
          .filter(
            (q) =>
              getCardById(state, q.hostInstanceId)?.controllerPlayerId ===
              playerId
          )
          .map((q) => q.hostInstanceId)
      );
      const sumForAttribute = (attr: QuartzAttribute): number => {
        let sum = 0;
        for (const hostId of hostIds) {
          sum += getQuartzAttributeSum(
            state,
            hostId,
            attr,
            getCardDefinitionById
          );
        }
        return sum;
      };
      // attribute:"any" = 「属性値のいずれか1種の合計が」型（BSLH01-X10）: 属性を跨いで合算せず、
      // 7種それぞれの合計を個別に min/max 判定し、1種でも満たせば true。
      if (clause.attribute === "any") {
        return QUARTZ_ATTRIBUTES.some((attr) => {
          const sum = sumForAttribute(attr);
          if (clause.min !== undefined && sum < clause.min) return false;
          if (clause.max !== undefined && sum > clause.max) return false;
          return true;
        });
      }
      const sum = sumForAttribute(clause.attribute);
      if (clause.min !== undefined && sum < clause.min) return false;
      if (clause.max !== undefined && sum > clause.max) return false;
      return true;
    }

    case "any_of": {
      return clause.groups.some((group) =>
        group.every((inner) =>
          evaluateConditionClause(
            state,
            inner,
            sourceInstanceId,
            actingPlayerId,
            getCardDefinitionById,
            triggerContext,
            sourceContext
          )
        )
      );
    }

    case "life_value": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return false;
      // 純粋な読み取り専用の閾値比較 (状態変更なし) のため count ベース (SSOT:
      // getPlayerLifeCoreCount) を使う安全 (adversarial verifier round2:
      // withSoulCoreLocation 経由の move を伴う箇所とは異なる)。
      const life = getPlayerLifeCoreCount(player);
      if (clause.min !== undefined && life < clause.min) return false;
      if (clause.max !== undefined && life > clause.max) return false;
      return true;
    }

    case "life_reduced_this_turn": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      return ((state.lifeReductionCappedThisTurn ?? {})[playerId] ?? 0) > 0;
    }

    case "life_damage_interception_use_cost_gate_paid_this_turn": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      if (!sourceCard) return false;
      return isLifeDamageInterceptionUseCostGateUsedThisTurn(
        state,
        playerId,
        sourceCard.instanceId
      );
    }

    case "field_card_count": {
      // P3-63: 純カード枚数 (filter なし) の min/max 判定。
      // sourceCard 自身を除外するかは excludeSelf で制御。
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const count = state.cardInstances.filter((c) => {
        if (c.zone !== "field") return false;
        if (c.controllerPlayerId !== playerId) return false;
        if (clause.excludeSelf && c.instanceId === sourceInstanceId)
          return false;
        return true;
      }).length;
      if (clause.min !== undefined && count < clause.min) return false;
      if (clause.max !== undefined && count > clause.max) return false;
      return true;
    }

    case "field_core_sum_both_players": {
      // 自分・相手それぞれの field+reserve コア合計 (通常+ソウル) を独立集計し、
      // 両者とも min 以上のとき成立 (AND)。grandwalker/grandstone 除外は
      // 該当カードの定義 (grandwalkerData/grandstoneData 有無) で判定する。
      const sumForPlayer = (playerId: string): number => {
        const player = state.players.find((p) => p.id === playerId);
        let total = player
          ? player.reserveNormalCoreCount + player.reserveSoulCoreCount
          : 0;
        for (const c of state.cardInstances) {
          if (c.zone !== "field" || c.controllerPlayerId !== playerId) continue;
          if (clause.excludeGrandwalker || clause.excludeGrandstone) {
            const def = getCardDefinitionById(c.definitionId);
            if (def) {
              if (clause.excludeGrandwalker && def.grandwalkerData) continue;
              if (clause.excludeGrandstone && def.grandstoneData) continue;
            }
          }
          total += c.normalCoreCount + c.soulCoreCount;
        }
        return total;
      };
      return state.players.every((p) => sumForPlayer(p.id) >= clause.min);
    }

    case "cards_in_zone": {
      // 任意ゾーン (trash/reserve 等) の CardFilter 一致枚数を min/max 判定。
      // 集計は value source `cards_in_zone` (target-resolution.ts) と同一ロジック。
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const clauseZones = Array.isArray(clause.zone)
        ? clause.zone
        : [clause.zone];
      const count = state.cardInstances.filter((c) => {
        const zonePlayerId =
          c.zone === "field" ? c.controllerPlayerId : c.ownerPlayerId;
        if (zonePlayerId !== playerId) return false;
        if (
          !isCardInEffectZone(
            state,
            c,
            clauseZones,
            actingPlayerId,
            getCardDefinitionById
          )
        )
          return false;
        if (clause.filter) {
          const def = getCardDefinitionById(c.definitionId);
          if (!def) return false;
          return matchesCardReferenceFilter(c, def, clause.filter, {
            ...conditionCardFilterEvaluators(state, getCardDefinitionById),
            effectiveColors: getEffectiveColors(state, c, def),
            effectiveBp: getCardFilterEffectiveBp(
              state,
              c,
              def,
              getCardDefinitionById
            ),
            coreCount:
              c.zone === "field"
                ? getTotalCoresOnCardById(state, c.instanceId)
                : undefined,
            effectiveLevel:
              c.zone === "field"
                ? getEffectiveLevel(state, c, def, getCardDefinitionById)
                : undefined,
            effectiveSymbolCount:
              c.zone === "field"
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
      if (clause.min !== undefined && count < clause.min) return false;
      if (clause.max !== undefined && count > clause.max) return false;
      return true;
    }

    case "summoned_this_turn_color_count": {
      const colorCount = countSummonedThisTurnColors(
        state,
        actingPlayerId,
        clause,
        getCardDefinitionById,
        triggerContext
      );
      if (clause.min !== undefined && colorCount < clause.min) return false;
      if (clause.max !== undefined && colorCount > clause.max) return false;
      return true;
    }

    case "no_same_name_on_field": {
      if (!sourceCard) return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def) return false;
      return !state.cardInstances.some(
        (c) =>
          c.zone === "field" &&
          c.instanceId !== sourceInstanceId &&
          c.controllerPlayerId === actingPlayerId &&
          getCardDefinitionById(c.definitionId)?.name === def.name
      );
    }

    case "no_presented_contract_card": {
      // 08a2 / qa-041: 本文がゲーム開始時の提示を明示する場合だけ提示情報を見る。
      const playerId = resolvePlayerRef(
        actingPlayerId,
        clause.player ?? "self",
        state
      );
      const player = state.players.find((p) => p.id === playerId);
      const result = !player?.contractCardNo;
      return clause.negate ? !result : result;
    }

    case "no_contract_card": {
      const playerId = resolvePlayerRef(
        actingPlayerId,
        clause.player ?? "self",
        state
      );
      const player = state.players.find((p) => p.id === playerId);
      // 08a2: 提示を明示しない契約参照はデッキ採用レベルで判定する。
      // 提示済みの情報も採用の証拠だが、未提示の所有カードを落とさない。
      // 面が変わっていても元の印字契約を参照し、コントロール変更に左右されない。
      const result =
        !player?.contractCardNo &&
        !state.cardInstances.some((card) => {
          if (card.ownerPlayerId !== playerId) return false;
          const def = getCardDefinitionById(
            card.originalDefinitionId ?? card.definitionId
          );
          return def !== undefined && isContractDefinition(def);
        });
      return clause.negate ? !result : result;
    }

    case "owns_contract_card": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const sourceDef = sourceCard
        ? getCardDefinitionById(sourceCard.definitionId)
        : undefined;
      const expectedCardNo = clause.cardNo ?? sourceDef?.cardNo;
      if (!expectedCardNo) return false;
      return state.cardInstances.some((card) => {
        if (card.ownerPlayerId !== playerId) return false;
        const def = getCardDefinitionById(card.definitionId);
        return def?.cardNo === expectedCardNo && isContractDefinition(def);
      });
    }

    case "contracts_only_mono_color": {
      // BSGE01-C14/C15 errata 2026-06-26: 「自分が <color>1色以外と契約していなければ」
      // 裁定: デッキ採用レベル判定 (memory project_contract_state_deck_vs_presentation)。
      // player の全 cardInstance を走査し、契約カード定義 (isContractDefinition) を抽出。
      // 全契約カードの **印字色 (def.colors)** が指定色 1 色のみであれば true。1 枚でも
      // 他色を含む契約カードが採用されていれば false。契約 0 枚は true (no_contract_card
      // と同じく「契約していない」扱い)。
      //
      // 印字色を使うのは「デッキ採用レベル」裁定のため: getEffectiveColors は field/mirage/
      // burst zone で treat_as_color CE を適用するため、フィールド上で別色化された契約
      // スピリットが意図せず gate を変えてしまう。デッキ採用時点の素性が SSOT。
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const ownedCards = state.cardInstances.filter(
        (c) => c.ownerPlayerId === playerId
      );
      for (const card of ownedCards) {
        const def = getCardDefinitionById(card.definitionId);
        if (!def) continue;
        if (!isContractDefinition(def)) continue;
        // 印字色のみで判定 (zone CE / treat_as_color は無視)
        const printedColors = def.colors ?? [];
        if (printedColors.length !== 1 || printedColors[0] !== clause.color) {
          return false;
        }
      }
      return true;
    }

    case "presented_contract_color": {
      // BSGE01-C07「自分がゲーム開始時に提示した契約カードが緑のとき、かわりに〜」。
      // 提示レベル (player.contractCardNo、単一) の印字色のみを見る
      // (contracts_only_mono_color のデッキ採用レベル横断判定とは別軸)。
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const player = state.players.find((p) => p.id === playerId);
      const contractCardNo = player?.contractCardNo;
      const def = contractCardNo
        ? getCardDefinitionById(contractCardNo)
        : undefined;
      const matches = !!def?.colors?.includes(clause.color);
      return clause.negate ? !matches : matches;
    }

    case "trigger_colors": {
      // triggerContext.sourceColors があればそれを使う。なければ sourceCard の色にフォールバック
      const colors = triggerContext?.sourceColors;
      if (colors && colors.length > 0) {
        return colors.some((c) => clause.colors.includes(c));
      }
      if (!sourceCard) return false;
      const tcDef = getCardDefinitionById(sourceCard.definitionId);
      if (!tcDef) return false;
      const effColors = getEffectiveColors(state, sourceCard, tcDef);
      return effColors.some((c) => clause.colors.includes(c));
    }

    case "trigger_tribes": {
      // トリガーを引き起こした効果のソースカードの系統で判定する。
      // sourceCard（＝この効果を持つカード自身＝回収対象）へはフォールバックしない
      // （自カードの系統が一致すると誤発火するため）。
      const tribes = triggerContext?.sourceTribes;
      if (!tribes || tribes.length === 0) return false;
      if (
        clause.excludeSelfSource &&
        triggerContext?.sourceInstanceId !== undefined &&
        triggerContext.sourceInstanceId === sourceInstanceId
      ) {
        return false;
      }
      return matchesTribes(undefined, clause, tribes);
    }

    case "trigger_source_match": {
      // 名前/系統の OR 発生源条件。sourceCard（回収対象）へはフォールバックしない。
      const sourceName = triggerContext?.sourceCardName;
      const nameMatches =
        !!sourceName &&
        !!clause.cardNames?.some((m) => matchesCardNameMatch(sourceName, m));
      const sourceTribes = triggerContext?.sourceTribes;
      const clauseTribes = clause.tribes;
      const tribeMatches =
        !!sourceTribes &&
        sourceTribes.length > 0 &&
        !!clauseTribes &&
        clauseTribes.length > 0 &&
        matchesTribes(undefined, { tribes: clauseTribes }, sourceTribes);
      return nameMatches || tribeMatches;
    }

    case "trigger_source_player": {
      // トリガー原因 (sourceCard) のコントローラーが actingPlayerId と一致するかで
      // self/opponent を判定する。sourceCard 不明（context 未注入）の場合はマッチ不成立。
      const sourcePlayerId = triggerContext?.sourcePlayerId;
      if (!sourcePlayerId) return false;
      const isSelf = sourcePlayerId === actingPlayerId;
      return clause.player === "self" ? isSelf : !isSelf;
    }

    case "trigger_cause":
      return (
        triggerContext?.cause !== undefined &&
        clause.causes.includes(triggerContext.cause)
      );

    case "trigger_from_zone": {
      if (!triggerContext?.fromZone) return false;
      return clause.zones.includes(triggerContext.fromZone);
    }

    case "trigger_physical_from_zone": {
      // 直前 state を持たない既存の直接トリガーは fromZone を物理起点として渡す。
      // deck_reveal 後の移動は processMovedToTrashEffects が physicalFromZone を必ず注入し、
      // 論理起点とは区別される。
      const physicalFromZone =
        triggerContext?.physicalFromZone ?? triggerContext?.fromZone;
      return (
        physicalFromZone !== undefined &&
        clause.zones.includes(physicalFromZone)
      );
    }

    case "trigger_source_category": {
      // トリガー原因 (sourceCard) の印字カテゴリで限定する。sourceCard 不明
      // （context 未注入）の場合はマッチ不成立 (誤発火防止)。sourceCard へは
      // フォールバックしない（自カードのカテゴリが一致して誤発火するため）。
      const category = triggerContext?.sourceCategory;
      if (!category) return false;
      if (clause.include && clause.include.length > 0) {
        if (!clause.include.includes(category)) return false;
      }
      if (clause.exclude && clause.exclude.length > 0) {
        if (clause.exclude.includes(category)) return false;
      }
      return true;
    }

    case "colors": {
      if (!sourceCard) return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def) return false;
      const effColors = getEffectiveColors(state, sourceCard, def);
      return effColors.some((c) => clause.colors.includes(c));
    }

    case "tribes": {
      if (!sourceCard) return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def || !def.tribe) return false;
      return matchesTribes(def.tribe, clause);
    }

    case "self_color_count": {
      if (!sourceCard) return false;
      const def = getCardDefinitionById(sourceCard.definitionId);
      if (!def) return false;
      const effColors = getEffectiveColors(state, sourceCard, def);
      const colorCount = countUniqueColors(effColors);
      if (clause.min !== undefined && colorCount < clause.min) return false;
      if (clause.max !== undefined && colorCount > clause.max) return false;
      return true;
    }

    case "self_soul_state": {
      if (!sourceCard) return false;
      return getEffectiveSoulStateIds(state, getCardDefinitionById).has(
        sourceInstanceId
      );
    }

    case "grandwalker_core_count": {
      // 効果の発生源カード（創界神/導界者ネクサス）上のコア数で判定
      if (!sourceCard) return false;
      const cores = sourceCard.normalCoreCount;
      if (clause.min !== undefined && cores < clause.min) return false;
      if (clause.max !== undefined && cores > clause.max) return false;
      return true;
    }

    case "soul_core_zone": {
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return false;
      const present = clause.zones.some((zone) => {
        if (zone === "field") {
          return state.cardInstances.some(
            (c) =>
              c.zone === "field" &&
              c.controllerPlayerId === playerId &&
              c.soulCoreCount > 0
          );
        }
        if (zone === "reserve") return player.reserveSoulCoreCount > 0;
        if (zone === "trash") return player.trashSoulCoreCount > 0;
        return player.lifeSoulCoreCount > 0; // "life"
      });
      return clause.negate ? !present : present;
    }

    case "in_battle": {
      if (!sourceCard) return false;
      const battleEntity = state.battleEntities.find((e) =>
        e.memberInstanceIds.includes(sourceInstanceId)
      );
      if (!battleEntity || battleEntity.attackState === "idle") return false;
      if (clause.state && battleEntity.attackState !== clause.state)
        return false;
      return true;
    }

    case "turn_player": {
      // ターンプレイヤー判定 (「自分のターンなら」「自分のターンしか発揮されない」等)。
      // player:self = 効果コントローラーのターン, opponent = 相手のターン。
      // ルール: 10_rules/02 L105 (ターンプレイヤー = state.activePlayerId)。
      const playerId = resolvePlayerRef(actingPlayerId, clause.player, state);
      return state.activePlayerId === playerId;
    }

    case "step_phase": {
      // 現在のステップ判定 (「アタックステップなら」等)。state.step との一致 + whose で
      // ターンプレイヤー軸を絞る。ルール: 10_rules/02 のステップ分類 (STEP_ORDER)。
      if (state.step !== clause.step) return false;
      const whose = clause.whose ?? "either";
      if (whose === "either") return true;
      const playerId = resolvePlayerRef(actingPlayerId, whose, state);
      return state.activePlayerId === playerId;
    }

    case "flash_used": {
      // P3-14 C-1: フラッシュ効果の使用/発揮履歴参照。
      // target で "card_usage" (フラッシュカードの使用) か "effect_activation" (フラッシュ効果の発揮) を選ぶ。
      // scope で参照範囲を絞り、player で対象プレイヤーを選ぶ。cardFilter で特定カードに限定可能。
      // negate=true で「〜していない」判定（= 履歴にマッチするエントリが無い）。
      // 裁定ソース: memory/project_flash_usage_ruling.md (2026-04-16 ユーザー裁定)。
      const targetPlayerId = resolvePlayerRef(
        actingPlayerId,
        clause.player,
        state
      );
      const currentAttackId = state.activeAttack?.attackId ?? null;

      const inScope = (entry: {
        turnNumber: number;
        step: Step;
        attackId: string | null;
      }): boolean => {
        switch (clause.scope) {
          case "latest":
            return (
              entry.turnNumber === state.turnNumber &&
              entry.step === state.step &&
              entry.attackId === currentAttackId
            );
          case "game":
            return true;
          case "turn":
            return entry.turnNumber === state.turnNumber;
          case "step":
            return (
              entry.turnNumber === state.turnNumber && entry.step === state.step
            );
          case "battle":
            // battle スコープは現在バトル中でなければマッチしない（null 同士を同一視しない）。
            return (
              currentAttackId !== null && entry.attackId === currentAttackId
            );
          default:
            return false;
        }
      };

      const matchesCard = (
        cardInstanceId: string,
        cardDefinitionId: string
      ): boolean => {
        if (!clause.cardFilter) return true;
        const card = getCardById(state, cardInstanceId);
        const def = getCardDefinitionById(cardDefinitionId);
        if (!card || !def) return false;
        return matchesCardReferenceFilter(card, def, clause.cardFilter, {
          ...conditionCardFilterEvaluators(
            state,
            getCardDefinitionById,
            triggerContext
          ),
          battleEntities: state.battleEntities,
          effectiveColors: getEffectiveColors(state, card, def),
          effectiveBp: getCardFilterEffectiveBp(
            state,
            card,
            def,
            getCardDefinitionById
          ),
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(state, card, def, getCardDefinitionById)
              : undefined,
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  card,
                  def,
                  getCardDefinitionById
                )
              : undefined,
        });
      };

      let hasMatch: boolean;
      if (clause.target === "card_usage") {
        // mode 未指定は既定 "flash"（既存カード/テストとの後方互換）。
        // BSAZ01-C08/C09 のような「スタック効果使用後以外で」判定は mode:"stack" を渡す。
        // 「カードを使用後」のように見出し種別を問わない条件は mode:"any" で全 usage を拾う。
        const wantedMode = clause.mode ?? "flash";
        const wantedCompletion = clause.completion ?? "any";
        const usageMatches = (
          entry: (typeof state.flashCardUsageLog)[number]
        ) =>
          entry.playerId === targetPlayerId &&
          (wantedMode === "any" || (entry.mode ?? "flash") === wantedMode) &&
          (wantedCompletion === "any" ||
            (entry.completion ?? "declared") === wantedCompletion) &&
          (clause.sameInstanceAsSource !== true ||
            entry.cardInstanceId === sourceInstanceId) &&
          matchesCard(entry.cardInstanceId, entry.cardDefinitionId);
        if (clause.scope === "latest") {
          const latestEntry = state.flashCardUsageLog.filter(inScope).at(-1);
          hasMatch = latestEntry !== undefined && usageMatches(latestEntry);
        } else {
          hasMatch = state.flashCardUsageLog.some(
            (entry) => inScope(entry) && usageMatches(entry)
          );
        }
      } else {
        // "effect_activation"
        const activationMatches = (
          entry: (typeof state.flashEffectActivationLog)[number]
        ) =>
          entry.playerId === targetPlayerId &&
          matchesCard(entry.sourceInstanceId, entry.sourceDefinitionId);
        if (clause.scope === "latest") {
          const latestEntry = state.flashEffectActivationLog
            .filter(inScope)
            .at(-1);
          hasMatch =
            latestEntry !== undefined && activationMatches(latestEntry);
        } else {
          hasMatch = state.flashEffectActivationLog.some(
            (entry) => inScope(entry) && activationMatches(entry)
          );
        }
      }

      return clause.negate ? !hasMatch : hasMatch;
    }

    case "attack_occurred": {
      // 独自拡張: 他カードのアタック宣言履歴参照 (flash_used と対称構造)。
      // 「自分の系統：○○を持つスピリットがアタックしたとき、下の効果を発揮できる」型
      // (BSSL01-M01 等) の発揮解禁ゲート。cardFilter は attack 宣言カードの現在の実効状態
      // (色/BP/コア数等) を引き直して照合する (flash_used の matchesCard と同型)。
      const targetPlayerId = resolvePlayerRef(
        actingPlayerId,
        clause.player,
        state
      );
      const currentAttackId = state.activeAttack?.attackId ?? null;

      const inScope = (entry: {
        turnNumber: number;
        step: Step;
        attackId: string | null;
      }): boolean => {
        switch (clause.scope) {
          case "game":
            return true;
          case "turn":
            return entry.turnNumber === state.turnNumber;
          case "step":
            return (
              entry.turnNumber === state.turnNumber && entry.step === state.step
            );
          case "battle":
            return (
              currentAttackId !== null && entry.attackId === currentAttackId
            );
          default:
            return false;
        }
      };

      const matchesCard = (
        cardInstanceId: string,
        cardDefinitionId: string,
        effectiveTribesAtDeclaration?: string[]
      ): boolean => {
        if (!clause.cardFilter) return true;
        const card = getCardById(state, cardInstanceId);
        const def = getCardDefinitionById(cardDefinitionId);
        if (!card || !def) return false;
        return matchesCardReferenceFilter(card, def, clause.cardFilter, {
          ...conditionCardFilterEvaluators(
            state,
            getCardDefinitionById,
            triggerContext
          ),
          battleEntities: state.battleEntities,
          effectiveColors: getEffectiveColors(state, card, def),
          effectiveTribes:
            effectiveTribesAtDeclaration ??
            getEffectiveTribes(state, card, def, getCardDefinitionById),
          effectiveBp: getCardFilterEffectiveBp(
            state,
            card,
            def,
            getCardDefinitionById
          ),
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(state, card, def, getCardDefinitionById)
              : undefined,
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  card,
                  def,
                  getCardDefinitionById
                )
              : undefined,
        });
      };

      const matchesTargetFilter = (
        designatedTargetInstanceId: string | null | undefined,
        designatedTargetDefinitionId: string | null | undefined
      ): boolean => {
        if (!clause.targetFilter) return true;
        if (
          designatedTargetInstanceId === null ||
          designatedTargetInstanceId === undefined ||
          designatedTargetDefinitionId === null ||
          designatedTargetDefinitionId === undefined
        ) {
          return false;
        }
        const card = getCardById(state, designatedTargetInstanceId);
        const def = getCardDefinitionById(designatedTargetDefinitionId);
        if (!card || !def) return false;
        return matchesCardReferenceFilter(card, def, clause.targetFilter, {
          ...conditionCardFilterEvaluators(
            state,
            getCardDefinitionById,
            triggerContext
          ),
          battleEntities: state.battleEntities,
          effectiveColors: getEffectiveColors(state, card, def),
          effectiveBp: getCardFilterEffectiveBp(
            state,
            card,
            def,
            getCardDefinitionById
          ),
          coreCount:
            card.zone === "field"
              ? getTotalCoresOnCardById(state, card.instanceId)
              : undefined,
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(state, card, def, getCardDefinitionById)
              : undefined,
          effectiveSymbolCount:
            card.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  card,
                  def,
                  getCardDefinitionById
                )
              : undefined,
        });
      };

      const matchesTargetControllerLifeAtDeclaration = (
        life: number | null | undefined
      ): boolean => {
        if (!clause.targetControllerLifeAtDeclaration) return true;
        if (life === null || life === undefined) return false;
        const { min, max } = clause.targetControllerLifeAtDeclaration;
        if (min !== undefined && life < min) return false;
        if (max !== undefined && life > max) return false;
        return true;
      };

      const matchingDeclarations = state.attackDeclarationLog.filter(
        (entry) =>
          entry.playerId === targetPlayerId &&
          inScope(entry) &&
          matchesCard(
            entry.cardInstanceId,
            entry.cardDefinitionId,
            clause.currentBattleOrdinal !== undefined
              ? entry.effectiveTribesAtDeclaration
              : undefined
          ) &&
          matchesTargetFilter(
            entry.designatedTargetInstanceId,
            entry.designatedTargetDefinitionId
          ) &&
          matchesTargetControllerLifeAtDeclaration(
            entry.designatedTargetControllerLifeAtDeclaration
          )
      );

      if (clause.currentBattleOrdinal !== undefined) {
        const pending = state.preDeclarationStackWindow;
        // 宣言に対する応答窓は、attackDeclarationLog へ成立を記録するより前に開く。
        // 常時効果はこの時点で評価し、誘発キューや応答窓自体を抑止しない。
        if (pending?.kind === "attack") {
          const attacker = getCardById(state, pending.sourceInstanceId);
          const target = pending.targetInstanceId
            ? getCardById(state, pending.targetInstanceId)
            : undefined;
          const targetPlayer = state.players.find(
            (player) => player.id === target?.controllerPlayerId
          );
          const pendingMatches =
            pending.actingPlayerId === targetPlayerId &&
            attacker !== undefined &&
            matchesCard(attacker.instanceId, attacker.definitionId) &&
            matchesTargetFilter(
              pending.targetInstanceId,
              target?.definitionId
            ) &&
            matchesTargetControllerLifeAtDeclaration(
              targetPlayer ? getPlayerLifeCoreCount(targetPlayer) : undefined
            );
          const matchesOrdinal =
            pendingMatches &&
            matchingDeclarations.length + 1 === clause.currentBattleOrdinal;
          return clause.negate ? !matchesOrdinal : matchesOrdinal;
        }
        const declaration =
          matchingDeclarations[clause.currentBattleOrdinal - 1];
        const matchesOrdinal =
          declaration?.attackId != null &&
          (declaration.attackId === currentAttackId ||
            state.pendingBattleEndFinalizeAttackIds.includes(
              declaration.attackId
            ));
        return clause.negate ? !matchesOrdinal : matchesOrdinal;
      }

      const hasMatch = matchingDeclarations.length > 0;
      return clause.negate ? !hasMatch : hasMatch;
    }

    case "mirage_draw_occurred": {
      // 独自拡張: 【セット中】効果由来ドロー履歴参照 (attack_occurred と対称構造)。
      // 「このターン、自分がミラージュ効果でドローしていなければ」型の排他ゲート
      // (BSGE01-C03/C10 等)。scope は "turn"/"game" のみ (mirageSetDrawLog に
      // step/attackId を持たせていないため battle/step スコープは非対応)。
      const targetPlayerId = resolvePlayerRef(
        actingPlayerId,
        clause.player,
        state
      );
      const hasMatch = state.mirageSetDrawLog.some(
        (entry) =>
          entry.playerId === targetPlayerId &&
          (clause.scope === "game" || entry.turnNumber === state.turnNumber)
      );
      return clause.negate ? !hasMatch : hasMatch;
    }

    case "oracle_would_trigger": {
      // 「このカードの召喚/煌臨等で【神託/導託】していないとき」判定 (BSTH02-C01 effects[0] 等)。
      // sourceInstanceId をトリガーカードとして、実際に enqueue せず判定する
      // (oracle-system.wouldQueueOracleChoices が checkAndQueueOracleChoices と共有する SSOT)。
      const wouldTrigger = wouldQueueOracleChoices(
        state,
        sourceInstanceId,
        clause.triggerKind,
        getCardDefinitionById
      );
      return clause.negate ? !wouldTrigger : wouldTrigger;
    }

    case "battle_was_blocked": {
      // fireBattleEndDeferrals からのみ渡される triggerContext.battleWasBlocked を参照。
      // 通常の condition 評価 (triggerContext 省略) では常に false。
      return triggerContext?.battleWasBlocked === true;
    }

    case "battle_life_reduced": {
      // fireBattleEndDeferrals からのみ渡される triggerContext.battleLifeReduced を参照。
      // 通常の condition 評価 (triggerContext 省略) では常に false ( = 減っていない扱い)。
      const reduced = triggerContext?.battleLifeReduced === true;
      return clause.negate ? !reduced : reduced;
    }

    default:
      // 未知の条件種別 → 安全のため true（条件なし扱い）
      return true;
  }
}

/**
 * Condition (ConditionClause の AND 配列) を評価する。
 * 全句が true → true、1つでも false → false。
 * 空配列は「条件なし」で true。
 */
export function evaluateCondition(
  state: GameState,
  condition: Condition,
  sourceInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext?: TriggerContext,
  sourceContext?: ConditionSourceContext
): boolean {
  if (condition.length === 0) return true;
  return condition.every((clause) =>
    evaluateConditionClause(
      state,
      clause,
      sourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      triggerContext,
      sourceContext
    )
  );
}

// 系統マッチの SSOT は `matchesTribes`（card/tribe-filter.ts）。
// かつてここに OR 固定の `tribeMatches` があったが、logic 引数を取らないため
// AND 指定（tribesLogic:"and" / tribesRequired）が黙って OR に落ちる事故源だった。
// OR 判定が欲しい場合も `matchesTribes(tribe, { tribes })`（tribes 既定 = OR）を使う。

/** 「場にシンボルがある/ない」だけの条件。カードの存在条件へは拡張しない。 */
function getConditionExtendedSymbolIds(
  state: GameState,
  clause: ConditionClause,
  playerIds: ReadonlySet<string>,
  getDefinition: (id: string) => CardDefinition | undefined
): Set<string> {
  if (clause.kind !== "field_has" && clause.kind !== "field_lacks")
    return new Set();
  if ((clause.zone ?? "field") !== "field" || !clause.symbolColors?.length)
    return new Set();
  const symbolReferenceKeys = new Set([
    "kind",
    "player",
    "zone",
    "symbolColors",
    "minCount",
    "maxCount",
    "excludeSelf",
    "sumAcrossPlayers",
  ]);
  if (Object.keys(clause).some((key) => !symbolReferenceKeys.has(key)))
    return new Set();
  return new Set(
    [...playerIds].flatMap((playerId) =>
      getExtendedFieldSymbolSourceCards(state, playerId, getDefinition).map(
        (card) => card.instanceId
      )
    )
  );
}
