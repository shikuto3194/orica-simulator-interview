import { isCardInEffectZone } from "./card-access-rules";
// ============================================================
// TargetSpec / DynamicCount 解決 — 対象指定を実行時に解決
// ============================================================

import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingLeaveKind,
  PendingTriggeredEffect,
  Zone,
} from "../model";
import { collectUnderCardScopeIds, resolveSelfReferenceCard } from "../model";
import type {
  TargetSpec,
  Count,
  Amount,
  DynamicCount,
  DynamicCountSource,
  CardFilter,
  CoreLocation,
} from "../dsl-types";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
  getSelfCountThresholdValue,
  resolveDynamicThresholdsInFilter,
  resolveTribesMatchRefFilter,
} from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import type { MatchCardFilterOptions } from "../card/card-filter";
import {
  type DynamicCountEvaluationContext,
  evaluateStatelessSourceCount,
  getCardDefinitionForEffectiveFieldCard,
  getEffectiveColors,
  getEffectiveTribes,
  getCombinedUnitCost,
  getCombinedUnitCostFilterOptions,
  getCombinedUnitEffectiveOrAdditionalCost,
  isEligibleBraveCombineHost,
  isEligibleBraveSeparationTarget,
  resolveDeclaredBlockerTribes,
  selectExtremalInstanceIds,
} from "../legal/legal-actions-shared";
import {
  getCombinedUnitBp,
  getEffectiveLevel,
  getCombinedUnitSymbolCount,
} from "../battle/battle-shared";
import { getTotalCoresOnCardById } from "../core/core-system";
import { resolvePlayerRef } from "./structured-effect-interpreter";
import { getStepResult } from "../step-execution-context";
import type { StepExecutionContext } from "../step-execution-context";
import {
  applyEffectParamOverridesToFilter,
  deriveEffectParamOverrideClass,
} from "./effect-param-override";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import {
  hasCannotCombineRestriction,
  matchesActAsSpiritSourceScope,
} from "../mechanics/act-as-spirit";
import { hasPreventBraveSeparationRestriction } from "../mechanics/brave-separation-restriction";
import { hasGrandwalkerExhaustOptIn } from "../mechanics/grandwalker-exhaust-opt-in";
import {
  countTextRoleUnderCards,
  isStarGarmentTargetEligible,
} from "../mechanics/star-garment-utils";
import { getVirtualCombinedBraveLimitCount } from "../mechanics/virtual-combine";
import { evaluateApplicability } from "./effect-applicability";
import { evaluateCondition } from "./structured-condition-eval";
import { getExpandEffectTargetCountBonus } from "./expand-effect-target-count";

// ============================================================
// TargetSpec 解決
// ============================================================

function cardFilterUsesBattleState(filter: CardFilter | undefined): boolean {
  if (filter === undefined) return false;
  if (filter.battleState !== undefined) return true;
  if (filter.filterOr?.some((branch) => cardFilterUsesBattleState(branch))) {
    return true;
  }
  return cardFilterUsesBattleState(filter.exclude);
}

function resolvedSourceKeysContain(
  resolvedKeys: Set<string>,
  sourceKey: string
): boolean {
  if (resolvedKeys.has(sourceKey)) return true;
  const sourceInstanceId = sourceKey.split("#", 1)[0];
  return sourceInstanceId !== undefined && resolvedKeys.has(sourceInstanceId);
}

function hasUnresolvedLeaveFieldReplacementSourceKey(
  pending: PendingTriggeredEffect
): boolean {
  const sourceKeys = pending.registeredLeaveFieldStayOnFieldSourceKeys;
  if (!sourceKeys || sourceKeys.length === 0) return false;
  const resolvedKeys = new Set(pending.resolvedSourceRegistrationKeys ?? []);
  return sourceKeys.some(
    (sourceKey) => !resolvedSourceKeysContain(resolvedKeys, sourceKey)
  );
}

function isPendingEffectRelatedToInstance(
  pending: PendingTriggeredEffect,
  instanceId: string
): boolean {
  if (pending.relatedInstanceId === instanceId) return true;
  if (pending.relatedInstanceIds?.includes(instanceId)) return true;
  if (pending.relatedInstanceIdsBySourceRegistrationKey !== undefined) {
    return Object.values(
      pending.relatedInstanceIdsBySourceRegistrationKey
    ).some((ids) => ids.includes(instanceId));
  }
  return false;
}

function hasPendingLeaveFieldReplacementReaction(
  state: GameState,
  instanceId: string,
  leaveKind: PendingLeaveKind
): boolean {
  return state.pendingTriggeredEffects.some(
    (pending) =>
      pending.eventKind === leaveKind &&
      isPendingEffectRelatedToInstance(pending, instanceId) &&
      hasUnresolvedLeaveFieldReplacementSourceKey(pending)
  );
}

function refCardActuallyLeftFieldWithKind(
  state: GameState,
  instanceId: string,
  leaveKind: PendingLeaveKind
): boolean {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  const isMatchingPendingLeave = card?.pendingLeaveKind === leaveKind;
  if (
    isMatchingPendingLeave &&
    hasPendingLeaveFieldReplacementReaction(state, instanceId, leaveKind)
  ) {
    return false;
  }
  return !card || card.zone !== "field" || isMatchingPendingLeave;
}

export interface ResolveTargetSpecOptions {
  state: GameState;
  targetSpec: TargetSpec;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepContext: StepExecutionContext;
  /** GUI からの事前選択ターゲット */
  preSelectedIds?: string[];
  /**
   * true のとき、`preSelectedIds` が filter target の候補プールと count 範囲に
   * 収まることを実行時にも検証する。`targetSelectionTiming:"on_step"` の
   * 直接注入/再開経路向け。redirect_effect_target 継続のように元 filter と
   * 一致しない置換対象を許す経路では未指定のままにする。
   */
  validatePreSelectedAgainstPool?: boolean;
  /** 効果発動元カードの定義（cardName: "self" 解決用） */
  sourceDefinition?: CardDefinition;
  /** 実際の効果発生源 instance。対象耐性・対象ロックの発生源 identity に使う。 */
  effectSourceInstanceId?: string;
  /**
   * `source_card` 参照だけを sourceInstanceId から差し替える明示 override。
   * 通常の借用効果では source_card は host/sourceInstanceId を指すため、
   * effectSourceInstanceId とは分離する。
   */
  sourceCardReferenceInstanceId?: string;
  /**
   * P3-14 A-7: `effect_param_override` CE を適用するための呼び出し元 action 種別。
   * destroy / vanish / bounce / prevent_battle / exhaust のいずれかを指定すると、
   * ターゲットフィルタの `maxBp` / `maxCost` / `category` に CE 由来の delta を
   * 適用してから候補抽出する。
   */
  paramOverrideActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust";
  /** P3-105: target lock bypass 効果では特殊ネクサスの専用対象ロックを候補抽出で無視する。 */
  bypassSpecialNexusTargetLock?: boolean;
  ignoreCategoryExclusion?: boolean;
  /** 対象候補を効果発動元 host に合体中の child card だけに絞る。 */
  sourceAttachedChildrenOnly?: boolean;
  /** 星霊衣で下に置ける B面持ちブレイヴだけを対象候補にする。 */
  starGarmentTargetEligibleOnly?: boolean;
  /**
   * brave_combine_effect 用: 対象候補を「発動元カード自身が braveCondition/多重合体上限/
   * cannot_combine 制約を満たして合体できるスピリット/アルティメット」だけに絞る
   * (ENGINE-bsft01-tr-rebirth-brave-combine-branch)。`sourceDefinition` が braveCondition
   * の源になるため必須（未指定時は候補 0 件）。
   */
  braveCombineHostOnly?: boolean;
  /**
   * ENGINE-brave-combine-third-party-target: `braveCombineHostOnly` の braveCondition/
   * maxCombinedBraves 判定基準を、`sourceDefinition`（効果発動元カード）ではなく指定した
   * ブレイヴの定義にする。`brave_combine_effect.source` (前段 step ref) で合体元を発動元
   * カード自身以外にする場合に使う。未指定時は従来どおり `sourceDefinition` を基準にする
   * （既存 BSFT01 系との後方互換）。
   */
  braveCombineIncomingBraveDefinition?: CardDefinition;
  /**
   * `braveCombineHostOnly` の合体元ブレイヴ instanceId。合体元自身に cannot_combine
   * 制約がある場合、host 候補全体を空にする。
   */
  braveCombineIncomingBraveInstanceId?: string;
  /**
   * `brave_separate_effect` 用: 対象候補を「分離後、維持コア (Lv1 requiredCores) を
   * 補填できるブレイヴ」だけに絞る (isEligibleBraveSeparationTarget が SSOT)。
   * 未絞り込みだと moveNormalCoresForBraveSeparation の無条件 throw が対象解決を
   * すり抜けて未捕捉例外になる (getAvailableBraveSeparateLegalActions の GUI 経路と
   * 同じガードを効果発動経路にも適用する)。
   */
  braveSeparationSolvencyOnly?: boolean;
  /**
   * `true` のとき count 解決をスキップして候補プール (filter / extremal 適用後・
   * slice 前) をそのまま返す。`preSelectedIds` 経路はそのまま動作する。プレイヤー
   * 対象選択窓 (PendingStepOptionalTargetSelection 等) の候補列挙に使う。
   */
  returnFullPool?: boolean;
  /** CardFilter.hasCardEventEffect 等、条件付き印字効果フィルタの評価に使う。 */
  evaluateCondition?: MatchCardFilterOptions["evaluateCondition"];
  /** CardFilter.hasCardEventEffect 等、applicability 付き印字効果フィルタの評価に使う。 */
  evaluateApplicability?: MatchCardFilterOptions["evaluateApplicability"];
  /** true のとき filter target の候補に離脱待機中カードを含める。 */
  includePendingLeave?: boolean;
}

function getBudgetMetricValue(args: {
  metric: "bp" | "cost" | "symbol";
  state: GameState;
  card: CardInstance;
  def: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): number {
  const { metric, state, card, def, getCardDefinitionById } = args;
  if (metric === "bp") {
    return getCombinedUnitBp(state, card, def, getCardDefinitionById);
  }
  if (metric === "cost") {
    return getCombinedUnitEffectiveOrAdditionalCost(
      state,
      card,
      def,
      getCardDefinitionById
    );
  }
  return getCombinedUnitSymbolCount(state, card, def, getCardDefinitionById);
}

function getTargetFilterCostOptions(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Pick<MatchCardFilterOptions, "effectiveCost" | "additionalCosts"> {
  return getCombinedUnitCostFilterOptions(
    state,
    card,
    def,
    getCardDefinitionById
  );
}

/** 候補数が本文の指定枚数に足りない場合も、選択待ちと実行で同じ上限を使う。 */
export function resolveTargetCountBounds(args: {
  count: Count;
  state: GameState;
  actingPlayerId: string;
  stepContext: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  candidateCount: number;
}): { min: number; max: number } {
  const {
    count,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById,
    candidateCount,
  } = args;
  if (count === "all") return { min: candidateCount, max: candidateCount };
  const min = resolveCount(
    count,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById
  );
  const max =
    typeof count === "object" && "min" in count
      ? count.max === undefined
        ? candidateCount
        : resolveCountBound(
            count.max,
            state,
            actingPlayerId,
            stepContext,
            getCardDefinitionById
          )
      : min;
  return {
    min: Math.min(Math.max(0, min), candidateCount),
    max: Math.min(Math.max(0, max), candidateCount),
  };
}

function validatePreSelectedFilterTarget(args: {
  targetSpec: Extract<TargetSpec, { kind: "filter" }>;
  pool: readonly CardInstance[];
  preSelectedIds: readonly string[];
  selectedCards: readonly CardInstance[];
  state: GameState;
  actingPlayerId: string;
  stepContext: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  validatePreSelectedAgainstPool?: boolean;
}): void {
  const { targetSpec, pool, selectedCards } = args;
  const mustValidatePool =
    args.validatePreSelectedAgainstPool === true ||
    targetSpec.excludeStepId !== undefined ||
    targetSpec.budget !== undefined;
  if (!mustValidatePool) return;

  const poolIds = new Set(pool.map((card) => card.instanceId));
  const duplicateIds = args.preSelectedIds.filter(
    (id, index) => args.preSelectedIds.indexOf(id) !== index
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate preselected target(s): ${Array.from(new Set(duplicateIds)).join(",")}`
    );
  }

  const outOfPool = args.preSelectedIds.filter((id) => !poolIds.has(id));
  if (outOfPool.length > 0) {
    throw new Error(
      `Preselected target(s) not in candidate pool: ${outOfPool.join(",")}`
    );
  }

  const bounds = resolveTargetCountBounds({
    count: targetSpec.count,
    state: args.state,
    actingPlayerId: args.actingPlayerId,
    stepContext: args.stepContext,
    getCardDefinitionById: args.getCardDefinitionById,
    candidateCount: pool.length,
  });
  if (
    args.preSelectedIds.length < bounds.min ||
    args.preSelectedIds.length > bounds.max
  ) {
    throw new Error(
      `Preselected target count ${args.preSelectedIds.length} outside allowed range ${bounds.min}-${bounds.max}`
    );
  }

  if (targetSpec.budget === undefined) return;
  const budgetAmount = resolveAmount(
    targetSpec.budget.amount,
    args.state,
    args.actingPlayerId,
    args.stepContext,
    args.getCardDefinitionById
  );
  const selectedTotal = selectedCards.reduce((sum, card) => {
    const def = args.getCardDefinitionById(card.definitionId);
    if (!def) return sum;
    return (
      sum +
      getBudgetMetricValue({
        metric: targetSpec.budget!.metric,
        state: args.state,
        card,
        def,
        getCardDefinitionById: args.getCardDefinitionById,
      })
    );
  }, 0);
  if (selectedTotal > budgetAmount) {
    throw new Error(
      `Preselected target ${targetSpec.budget.metric} total ${selectedTotal} exceeds budget ${budgetAmount}`
    );
  }
}

/**
 * TargetSpec を解決してカードインスタンスの配列を返す。
 */
export function resolveTargetSpec(
  opts: ResolveTargetSpecOptions
): CardInstance[] {
  const {
    state,
    targetSpec,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext,
  } = opts;

  switch (targetSpec.kind) {
    // P3-145 SSOT: zone 許容は structured-effect-interpreter.ts の
    // collectTargetCardCandidates (selfCard 分岐) と揃える (field / in_use / set_aside)。
    // 使用中マジック自身の自己参照・手元常駐効果の自己参照 (ENGINE-set-aside-exit-
    // replacement-choice) はどちらの resolver 経由でも同じ判定になる必要がある。
    // 変更する場合は両実装を同時に揃えること。
    case "self": {
      const self = resolveSelfReferenceCard(state, sourceInstanceId);
      if (
        (self?.zone !== "field" &&
          self?.zone !== "in_use" &&
          self?.zone !== "set_aside") ||
        self.pendingLeaveKind !== null
      )
        return [];
      return self ? [self] : [];
    }

    case "source_card": {
      // resolveSelfReferenceCard の host redirect を経由しない、発動元カード自身の
      // instance 直参照 (合体中でも合体先ホストへは redirect しない)。
      const sourceCardInstanceId =
        opts.sourceCardReferenceInstanceId ?? sourceInstanceId;
      const src = state.cardInstances.find(
        (card) => card.instanceId === sourceCardInstanceId
      );
      if (
        !src ||
        (src.zone !== "field" &&
          src.zone !== "in_use" &&
          src.zone !== "set_aside") ||
        src.pendingLeaveKind !== null
      )
        return [];
      return [src];
    }

    case "filter": {
      const targetPlayerIds =
        targetSpec.player === "either"
          ? state.players.map((player) => player.id)
          : [resolvePlayerRef(actingPlayerId, targetSpec.player, state)];
      const zones = targetSpec.zone
        ? Array.isArray(targetSpec.zone)
          ? targetSpec.zone
          : [targetSpec.zone]
        : ["field" as const];

      // 魂状態IDセット
      const soulStateIds = getEffectiveSoulStateIds(
        state,
        getCardDefinitionById
      );
      // アンダーカード包含スコープ集合（SSOT: collectUnderCardScopeIds, model）。
      // 無印スコープでは煌臨元・text_role アンダーカードを対象候補から除外する
      // （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
      const underCardIds = collectUnderCardScopeIds(state);

      const filterOpts: MatchCardFilterOptions = {
        ...(targetSpec.excludeSelf
          ? { excludeInstanceId: sourceInstanceId }
          : {}),
        soulStateIds,
        underCardIds,
        ...(opts.sourceDefinition
          ? { sourceDefinition: opts.sourceDefinition }
          : {}),
      };

      // P3-14 A-7: effect_param_override CE による filter 拡張を適用。
      // paramOverrideActionKind が destroy/vanish/bounce のときのみ delta を計算する。
      let effectiveFilter = targetSpec.filter;
      if (opts.paramOverrideActionKind) {
        const effectClass = deriveEffectParamOverrideClass(
          opts.paramOverrideActionKind,
          targetSpec.filter
        );
        if (effectClass !== null) {
          effectiveFilter = applyEffectParamOverridesToFilter(
            targetSpec.filter,
            effectClass,
            sourceInstanceId,
            state,
            getCardDefinitionById
          );
        }
      }

      // 動的自己閾値ソース (maxBpSource/maxCostSource/maxCoresSource) を効果発動元の
      // 値へ解決する。filterOr の各枝にネストしたソースも再帰的に解決する
      // (SSOT: resolveDynamicThresholdsInFilter、BSGE01-TX01(B) adversarial verifier
      // round3 で filterOr 内 maxBpSource が黙って無視される silent bug を発見)。
      {
        const src = resolveSelfReferenceCard(state, sourceInstanceId);
        const srcDef = src
          ? getCardDefinitionById(src.definitionId)
          : undefined;
        const srcBp =
          src && src.zone === "field" && srcDef
            ? getCombinedUnitBp(state, src, srcDef, getCardDefinitionById)
            : undefined;
        const srcCostOptions =
          src && srcDef
            ? getTargetFilterCostOptions(
                state,
                src,
                srcDef,
                getCardDefinitionById
              )
            : undefined;
        effectiveFilter = resolveDynamicThresholdsInFilter(effectiveFilter, {
          effectiveBp: srcBp,
          sourceCost: srcCostOptions?.effectiveCost,
          additionalCosts: srcCostOptions?.additionalCosts,
          countValue: getSelfCountThresholdValue(state, src, srcDef),
        });
      }
      // 動的 tribes（「ブロック宣言する相手と同じ系統を持つ」）を解決する。BSFT01-C01 型。
      // 「他の」= 参照カード自身（ブロック中）の除外は呼び出し側 filter の
      // `exclude: { battleState: "blocking" }` に委ねる（既存 battleState 除外機構の再利用、
      // 新規 exclusion 機構は設けない）。
      if (effectiveFilter.tribesMatchRef === "declared_blocker") {
        effectiveFilter = resolveTribesMatchRefFilter(
          effectiveFilter,
          resolveDeclaredBlockerTribes(state, getCardDefinitionById)
        );
      }
      const filterNeedsBattleStateContext =
        cardFilterUsesBattleState(effectiveFilter);

      const sourceUnderCardIds =
        targetSpec.sourceUnderCardRole === undefined
          ? null
          : new Set(
              (getCardById(state, sourceInstanceId)?.underCards ?? [])
                .filter(
                  (entry) => entry.role === targetSpec.sourceUnderCardRole
                )
                .map((entry) => entry.cardInstanceId)
            );
      // フィルタにマッチするカードを収集
      const sourceAttachedChildIds =
        opts.sourceAttachedChildrenOnly === true
          ? new Set(
              state.cardInstances.find(
                (card) => card.instanceId === sourceInstanceId
              )?.attachedChildrenIds ?? []
            )
          : null;
      // `TargetSpec.kind:"filter".stepId` 指定時、候補を前段 step の
      // affectedCardInstanceIds にさらに絞り込む（BSKB01-R03「破棄した中の1枚」型）。
      const sourceStepCandidateIds = targetSpec.stepId
        ? new Set(
            getStepResult(stepContext, targetSpec.stepId)
              ?.affectedCardInstanceIds ?? []
          )
        : null;
      const excludedStepCandidateIds = targetSpec.excludeStepId
        ? new Set(
            getStepResult(stepContext, targetSpec.excludeStepId)
              ?.affectedCardInstanceIds ?? []
          )
        : null;
      const candidates = state.cardInstances.filter((c) => {
        if (!targetPlayerIds.includes(c.controllerPlayerId)) return false;
        if (
          sourceUnderCardIds !== null &&
          !sourceUnderCardIds.has(c.instanceId)
        )
          return false;
        if (
          !isCardInEffectZone(
            state,
            c,
            zones as readonly Zone[],
            actingPlayerId,
            getCardDefinitionById
          )
        )
          return false;
        if (c.pendingLeaveKind !== null && opts.includePendingLeave !== true) {
          return false;
        }
        if (
          sourceAttachedChildIds !== null &&
          !sourceAttachedChildIds.has(c.instanceId)
        ) {
          return false;
        }
        if (
          sourceStepCandidateIds !== null &&
          !sourceStepCandidateIds.has(c.instanceId)
        ) {
          return false;
        }
        if (
          excludedStepCandidateIds !== null &&
          excludedStepCandidateIds.has(c.instanceId)
        ) {
          return false;
        }
        const def = getCardDefinitionForEffectiveFieldCard(
          c,
          getCardDefinitionById,
          {
            state,
            filter: effectiveFilter,
          }
        );
        if (!def) return false;
        // Star-garment eligibility concerns the physical card's B face, not
        // its current field identity. Keep name/value predicates on `def`.
        const starGarmentDefinition =
          opts.starGarmentTargetEligibleOnly === true
            ? getCardDefinitionById(c.definitionId)
            : undefined;
        if (
          opts.starGarmentTargetEligibleOnly === true &&
          (!starGarmentDefinition ||
            !isStarGarmentTargetEligible(starGarmentDefinition))
        ) {
          return false;
        }
        if (opts.braveCombineHostOnly === true) {
          const incomingBraveInstanceId =
            opts.braveCombineIncomingBraveInstanceId ?? sourceInstanceId;
          if (c.instanceId === incomingBraveInstanceId) return false;
          const incomingBraveDef =
            opts.braveCombineIncomingBraveDefinition ??
            opts.sourceDefinition ??
            (() => {
              const incomingBrave = state.cardInstances.find(
                (card) => card.instanceId === incomingBraveInstanceId
              );
              return incomingBrave
                ? getCardDefinitionById(incomingBrave.definitionId)
                : undefined;
            })();
          if (!incomingBraveDef) return false;
          const incomingBrave = getCardById(state, incomingBraveInstanceId);
          if (
            hasCannotCombineRestriction(
              state,
              incomingBraveInstanceId,
              incomingBraveDef
            )
          ) {
            return false;
          }
          if (
            !isEligibleBraveCombineHost({
              state,
              host: c,
              hostDefinition: def,
              incomingBraveCondition: incomingBraveDef.braveCondition,
              ...(incomingBrave ? { incomingBrave } : {}),
              incomingBraveDef,
              getCardDefinitionById,
            })
          ) {
            return false;
          }
        }
        if (
          opts.braveSeparationSolvencyOnly === true &&
          (!isEligibleBraveSeparationTarget(state, c, getCardDefinitionById) ||
            (c.attachedToInstanceId !== null &&
              hasPreventBraveSeparationRestriction(
                state,
                c.attachedToInstanceId
              )))
        ) {
          return false;
        }
        // act_as_spirit トークン限定 (`CardFilter.actAsSpiritOnly`/`actAsSpiritSourceSelf`)。
        // GameState + 発動元 sourceInstanceId を要するため matchesCardFilter 内では評価せず、
        // cardNameEffective と同じ「呼び出し側の caller-evaluated field」パターンで判定する
        // (SSOT: matchesActAsSpiritSourceScope、field_has 側と共有)。
        if (
          (effectiveFilter.actAsSpiritOnly ||
            effectiveFilter.actAsSpiritSourceSelf) &&
          !matchesActAsSpiritSourceScope(
            state,
            c.instanceId,
            sourceInstanceId,
            {
              only: effectiveFilter.actAsSpiritOnly,
              sourceSelf: effectiveFilter.actAsSpiritSourceSelf,
            }
          )
        ) {
          return false;
        }
        return matchesCardFilter(c, def, effectiveFilter, {
          ...filterOpts,
          state,
          ignoreCategoryExclusion: opts.ignoreCategoryExclusion === true,
          ...(filterNeedsBattleStateContext
            ? { battleEntities: state.battleEntities }
            : {}),
          ...(opts.bypassSpecialNexusTargetLock
            ? { bypassSpecialNexusTargetLock: true }
            : {}),
          evaluateCondition:
            opts.evaluateCondition ??
            ((condition, sourceId, conditionActingPlayerId) =>
              evaluateCondition(
                state,
                condition,
                sourceId,
                conditionActingPlayerId,
                getCardDefinitionById
              )),
          evaluateApplicability:
            opts.evaluateApplicability ??
            ((applicability, sourceId) =>
              evaluateApplicability(
                state,
                applicability,
                sourceId,
                getCardDefinitionById
              )),
          ...getTargetFilterCostOptions(state, c, def, getCardDefinitionById),
          ...(opts.starGarmentTargetEligibleOnly === true &&
          sourceAttachedChildIds !== null
            ? { effectiveCategory: starGarmentDefinition?.printedCategory }
            : { fieldCategoryContext: true }),
          ...(effectiveFilter.includesGrandwalkerExhaustOptIn
            ? {
                grandwalkerExhaustOptIn: hasGrandwalkerExhaustOptIn(
                  state,
                  c.instanceId,
                  actingPlayerId
                ),
              }
            : {}),
          effectiveColors: getEffectiveColors(state, c, def),
          effectiveTribes: getEffectiveTribes(
            state,
            c,
            def,
            getCardDefinitionById
          ),
          effectiveBp:
            c.zone === "field"
              ? getCombinedUnitBp(state, c, def, getCardDefinitionById)
              : undefined,
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
              ? getCombinedUnitSymbolCount(state, c, def, getCardDefinitionById)
              : undefined,
          stepContext,
          getCardDefinitionById,
        });
      });

      // 極値セレクタ（「最もBP/コストの低い相手1体」）。候補を極値のものだけに絞る。
      // 候補列挙（legal-actions-shared）と同じ selectExtremalInstanceIds を通し、選べる
      // 対象と取れる対象を一致させる。タイは全候補を残し count 選択に委ねる。
      const pool = effectiveFilter.extremal
        ? (() => {
            const ids = new Set(
              selectExtremalInstanceIds(
                state,
                candidates.map((c) => c.instanceId),
                effectiveFilter.extremal!,
                getCardDefinitionById
              )
            );
            return candidates.filter((c) => ids.has(c.instanceId));
          })()
        : candidates;

      // GUI 事前選択があればそちらを使用。
      // redirect_effect_target の継続では置換先が元 filter と一致しないことがあるため、
      // 汎用 target 解決では filter 再検証しない。ことで構文の支払い後再検証は
      // effect-interpreter の conditional_cost 専用ガードで行う。
      if (
        opts.preSelectedIds !== undefined &&
        (opts.preSelectedIds.length > 0 ||
          opts.validatePreSelectedAgainstPool === true)
      ) {
        // ENGINE-target-count-expand-modifier Step4: 手動選択 (GUI) 経路の実行時確定。
        // 選択数自体は legal-action 層 (候補数上限 = 宣言的な
        // getExpandEffectTargetCountBonusDeclarative 込みの値) で既に確定済みなので
        // 戻り値の bonus は使わないが、auto-resolve 経路と同じ「評価したら1回消費」の
        // 意味論を揃えるため usageLimit 消費予約の push だけを目的に呼ぶ (副作用のみ)。
        getExpandEffectTargetCountBonus({
          state,
          actingPlayerId,
          sourceInstanceId,
          candidatePool: pool,
          getCardDefinitionById,
          stepContext,
        });
        const selectedCards = opts.preSelectedIds
          .map((id) => state.cardInstances.find((c) => c.instanceId === id))
          .filter((c): c is CardInstance => c !== undefined);
        validatePreSelectedFilterTarget({
          targetSpec,
          pool,
          preSelectedIds: opts.preSelectedIds,
          selectedCards,
          state,
          actingPlayerId,
          stepContext,
          getCardDefinitionById,
          ...(opts.validatePreSelectedAgainstPool
            ? { validatePreSelectedAgainstPool: true }
            : {}),
        });
        if (
          targetSpec.sourceUnderCardRole !== undefined ||
          opts.braveCombineHostOnly === true ||
          opts.braveSeparationSolvencyOnly === true
        ) {
          const poolIds = new Set(pool.map((c) => c.instanceId));
          return selectedCards.filter((c) => poolIds.has(c.instanceId));
        }
        return selectedCards;
      }

      // 候補列挙モード: count 解決をスキップして pool をそのまま返す。
      if (opts.returnFullPool) return pool;

      // count 解決
      const count = resolveCount(
        targetSpec.count,
        state,
        actingPlayerId,
        stepContext,
        getCardDefinitionById
      );
      if (count === -1) return pool; // "all"
      // ENGINE-target-count-expand-modifier Step2/3: expand_effect_target_count CE による
      // 対象数拡張 (auto-resolve 経路のみ、BSLH01-TR02(A))。stepContext を渡すことで
      // usageLimit 消費予約を push する (Step3、実記録は effect-interpreter.ts 側)。
      const expandBonus = getExpandEffectTargetCountBonus({
        state,
        actingPlayerId,
        sourceInstanceId,
        candidatePool: pool,
        getCardDefinitionById,
        stepContext,
      });
      return pool.slice(0, count + expandBonus);
    }

    case "ref": {
      const result = getStepResult(stepContext, targetSpec.stepId);
      if (!result) return [];
      const ids =
        targetSpec.result === "bp_became_zero"
          ? (result.bpBecameZeroCardInstanceIds ?? [])
          : result.affectedCardInstanceIds;
      const idSet = new Set(ids);
      return state.cardInstances.filter((c) => idSet.has(c.instanceId));
    }

    case "trigger_related_instance": {
      const relatedId = stepContext.triggerRelatedInstanceId;
      if (!relatedId) return [];
      const card = state.cardInstances.find((c) => c.instanceId === relatedId);
      if (!card) return [];
      if (card.zone !== "field") return [];
      if (
        targetSpec.includePendingLeave !== true &&
        card.pendingLeaveKind !== null
      )
        return [];
      return [card];
    }

    case "trigger_related_combined_host": {
      const relatedId = stepContext.triggerRelatedInstanceId;
      if (!relatedId) return [];
      const hostId = stepContext.triggerRelatedCombinedHostInstanceId;
      if (!hostId) return [];
      const host = state.cardInstances.find((c) => c.instanceId === hostId);
      if (!host) return [];
      if (host.zone !== "field") return [];
      if (
        targetSpec.includePendingLeave !== true &&
        host.pendingLeaveKind !== null
      )
        return [];
      if (
        targetSpec.player !== undefined &&
        host.controllerPlayerId !==
          resolvePlayerRef(actingPlayerId, targetSpec.player, state)
      ) {
        return [];
      }
      if (targetSpec.filter !== undefined) {
        const hostDef = getCardDefinitionById(host.definitionId);
        if (!hostDef) return [];
        if (
          !matchesCardFilter(host, hostDef, targetSpec.filter, {
            state,
            soulStateIds: getEffectiveSoulStateIds(
              state,
              getCardDefinitionById
            ),
            underCardIds: collectUnderCardScopeIds(state),
            ...(opts.sourceDefinition
              ? { sourceDefinition: opts.sourceDefinition }
              : {}),
            evaluateCondition:
              opts.evaluateCondition ??
              ((condition, sourceId, conditionActingPlayerId) =>
                evaluateCondition(
                  state,
                  condition,
                  sourceId,
                  conditionActingPlayerId,
                  getCardDefinitionById
                )),
            evaluateApplicability:
              opts.evaluateApplicability ??
              ((applicability, sourceId) =>
                evaluateApplicability(
                  state,
                  applicability,
                  sourceId,
                  getCardDefinitionById
                )),
            ...getTargetFilterCostOptions(
              state,
              host,
              hostDef,
              getCardDefinitionById
            ),
            fieldCategoryContext: true,
            getCardDefinitionById,
            effectiveColors: getEffectiveColors(state, host, hostDef),
            effectiveTribes: getEffectiveTribes(
              state,
              host,
              hostDef,
              getCardDefinitionById
            ),
            effectiveBp: getCombinedUnitBp(
              state,
              host,
              hostDef,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, host.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              host,
              hostDef,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              host,
              hostDef,
              getCardDefinitionById
            ),
            stepContext,
          })
        ) {
          return [];
        }
      }
      return [host];
    }

    case "trigger_related_instances": {
      const relatedIds =
        stepContext.triggerRelatedInstanceIds ??
        (stepContext.triggerRelatedInstanceId
          ? [stepContext.triggerRelatedInstanceId]
          : []);
      const idSet = new Set(relatedIds);
      const pool = state.cardInstances.filter(
        (card) =>
          idSet.has(card.instanceId) &&
          card.zone === "field" &&
          (targetSpec.includePendingLeave === true ||
            card.pendingLeaveKind === null)
      );
      if (targetSpec.count === undefined) return pool;
      if (opts.preSelectedIds !== undefined) {
        const selectedCards = pool.filter((c) =>
          opts.preSelectedIds!.includes(c.instanceId)
        );
        validatePreSelectedFilterTarget({
          targetSpec: {
            kind: "filter",
            player: "either",
            filter: {},
            count: targetSpec.count,
          },
          pool,
          preSelectedIds: opts.preSelectedIds,
          selectedCards,
          state,
          actingPlayerId,
          stepContext,
          getCardDefinitionById,
          validatePreSelectedAgainstPool: true,
        });
        return selectedCards;
      }
      if (opts.returnFullPool) return pool;
      const count = resolveCount(
        targetSpec.count,
        state,
        actingPlayerId,
        stepContext,
        getCardDefinitionById
      );
      return count === -1 ? pool : pool.slice(0, count);
    }

    case "pending_leave_caused_by_effect_source": {
      const causedIds = new Set(
        state.pendingLeaveEntities
          .filter(
            (pendingLeave) =>
              pendingLeave.causedByEffectSourceInstanceId ===
                sourceInstanceId && pendingLeave.blockedByResistance !== true
          )
          .map((pendingLeave) => pendingLeave.instanceId)
      );
      if (causedIds.size === 0) return [];
      return state.cardInstances.filter(
        (card) =>
          causedIds.has(card.instanceId) && card.pendingLeaveKind !== null
      );
    }
  }
}

// ============================================================
// Count / Amount 解決
// ============================================================

/**
 * Count を数値に解決する。
 * "all" → -1、DynamicCount → 計算値、{ min, max } → min（自動選択時）。
 */
export function resolveCount(
  count: Count,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  if (typeof count === "number") return count;
  if (count === "all") return -1;
  if ("min" in count) {
    // 範囲指定: 自動選択時は min を使用（min が動的なら解決）
    return resolveCountBound(
      count.min,
      state,
      actingPlayerId,
      stepContext,
      getCardDefinitionById
    );
  }
  // DynamicCount
  return resolveDynamicCount(
    count as DynamicCount,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById
  );
}

/**
 * `Count` 範囲境界 (`min` / `max`) を数値へ解決する。固定値はそのまま、
 * `DynamicCount` は実行時の盤面で評価する（「自分のカウント2につき1体まで」等の
 * 動的*上限*レンジ）。
 */
export function resolveCountBound(
  bound: import("../dsl-types").CountBound,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  if (typeof bound === "number") return bound;
  return resolveDynamicCount(
    bound,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById
  );
}

/**
 * Amount を数値に解決する。
 */
export function resolveAmount(
  amount: Amount,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  if (typeof amount === "number") return amount;
  return resolveDynamicCount(
    amount,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById
  );
}

// ============================================================
// DynamicCount 解決
// ============================================================

/**
 * `DynamicCountSource` を現在の盤面で数値に集計する。`source` と `subtract` で共用する
 * 単一 chokepoint（SSOT）。乗除・offset・cap・差分は呼び出し元の `resolveDynamicCount` が担う。
 */
function resolveSourceCount(
  src: DynamicCountSource,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  let baseCount = 0;
  const sourceCountContext = getDynamicCountEvaluationContext(
    state,
    stepContext,
    getCardDefinitionById
  );

  switch (src.kind) {
    // 盤面のみで解決できる stateless 種別は leaf の SSOT 実装へ委譲する
    // （継続修飾 bp_modifier 等と単一実装を共有）。
    case "cards_in_zone":
    case "count_value":
    case "declaration_count_this_turn":
    case "field_bp_total": {
      baseCount = evaluateStatelessSourceCount(
        state,
        actingPlayerId,
        src,
        getCardDefinitionById,
        sourceCountContext
      );
      break;
    }

    // cores_on は reserve/life/trash なら stateless 実装へ委譲するが、
    // this_card/target_card/ref は継続修飾に存在しない stepContext (sourceInstanceId /
    // 選択済み対象 / ステップ結果参照) を要するため、ここ (通常 step 実行の
    // chokepoint) でのみ解決する。継続修飾側 (evaluateContinuousDynamicAmount) は
    // 引き続き 0 を返す (stateless、context 依存種別は使われない前提)。
    case "cores_on": {
      baseCount = resolveCoresOnSourceCount(
        src.location,
        state,
        actingPlayerId,
        stepContext,
        getCardDefinitionById
      );
      break;
    }

    case "cards_from_ref": {
      const result = getStepResult(stepContext, src.stepId);
      if (!result) break;
      const refIds =
        src.result === "revealed"
          ? (result.revealedCardInstanceIds ?? [])
          : result.affectedCardInstanceIds;
      const physicallyFilteredRefIds =
        src.leftFieldKind === undefined
          ? refIds
          : refIds.filter(
              (id) =>
                result.leftFieldKindsByCardId?.[id] === src.leftFieldKind &&
                refCardActuallyLeftFieldWithKind(state, id, src.leftFieldKind!)
            );
      const filteredRefIds = physicallyFilteredRefIds.filter(
        (id) =>
          src.establishedLeaveKind === undefined ||
          result.establishedLeaveKindsByCardId?.[id] ===
            src.establishedLeaveKind
      );
      if (src.filter) {
        const refFilter = src.filter;
        const filterNeedsBattleStateContext =
          cardFilterUsesBattleState(refFilter);
        baseCount = filteredRefIds.filter((id) => {
          const card = state.cardInstances.find((c) => c.instanceId === id);
          if (!card) return false;
          const def = getCardDefinitionById(card.definitionId);
          if (!def) return false;
          return matchesCardReferenceFilter(card, def, refFilter, {
            state,
            ...(filterNeedsBattleStateContext
              ? { battleEntities: state.battleEntities }
              : {}),
            underCardIds: collectUnderCardScopeIds(state),
            ...getTargetFilterCostOptions(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            fieldCategoryContext: true,
            getCardDefinitionById,
            effectiveColors: getEffectiveColors(state, card, def),
            effectiveTribes: getEffectiveTribes(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            effectiveBp:
              card.zone === "field"
                ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
                : undefined,
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
            stepContext,
          });
        }).length;
      } else {
        baseCount = filteredRefIds.length;
      }
      break;
    }

    // 前ステップの affected カード（filter 絞り込み可）のコストを合算する。
    // 「戻したアルティメットの本来のコスト1につき…」(BSAZ02-C18) のように、
    // cards_from_ref (枚数) では表現できない「参照カードのコスト値そのもの」を使う。
    case "cost_from_ref": {
      const result = getStepResult(stepContext, src.stepId);
      if (!result) break;
      const refIds = result.affectedCardInstanceIds;
      const costBasis = src.costBasis ?? "printed";
      baseCount = refIds.reduce((sum, id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        if (!card) return sum;
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return sum;
        if (src.filter) {
          const filterNeedsBattleStateContext = cardFilterUsesBattleState(
            src.filter
          );
          const matches = matchesCardReferenceFilter(card, def, src.filter, {
            state,
            ...(filterNeedsBattleStateContext
              ? { battleEntities: state.battleEntities }
              : {}),
            underCardIds: collectUnderCardScopeIds(state),
            ...getTargetFilterCostOptions(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            fieldCategoryContext: true,
            getCardDefinitionById,
            effectiveColors: getEffectiveColors(state, card, def),
            effectiveTribes: getEffectiveTribes(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            effectiveLevel:
              card.zone === "field"
                ? getEffectiveLevel(state, card, def, getCardDefinitionById)
                : undefined,
            stepContext,
          });
          if (!matches) return sum;
        }
        const cost =
          costBasis === "printed"
            ? def.cost
            : getCombinedUnitEffectiveOrAdditionalCost(
                state,
                card,
                def,
                getCardDefinitionById
              );
        return sum + cost;
      }, 0);
      break;
    }

    // 複数 step (category 別の破壊等) の参照カード群の実効シンボル数を合算する。
    // 「シンボル2つにつき」は破壊直前の合体ブレイヴ追加シンボルも含む。
    case "symbol_count_from_ref": {
      const refIds = src.stepIds.flatMap((stepId) => {
        const result = getStepResult(stepContext, stepId);
        return result ? result.affectedCardInstanceIds : [];
      });
      baseCount = refIds.reduce((sum, id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        if (!card) return sum;
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return sum;
        if (src.filter) {
          const filterNeedsBattleStateContext = cardFilterUsesBattleState(
            src.filter
          );
          const matches = matchesCardReferenceFilter(card, def, src.filter, {
            state,
            ...(filterNeedsBattleStateContext
              ? { battleEntities: state.battleEntities }
              : {}),
            underCardIds: collectUnderCardScopeIds(state),
            ...getTargetFilterCostOptions(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            fieldCategoryContext: true,
            getCardDefinitionById,
            effectiveColors: getEffectiveColors(state, card, def),
            effectiveTribes: getEffectiveTribes(
              state,
              card,
              def,
              getCardDefinitionById
            ),
            stepContext,
          });
          if (!matches) return sum;
        }
        return (
          sum +
          getCombinedUnitSymbolCount(state, card, def, getCardDefinitionById)
        );
      }, 0);
      break;
    }

    case "source_effective_cost": {
      const sourceId = stepContext.sourceInstanceId;
      const source = sourceId
        ? state.cardInstances.find((c) => c.instanceId === sourceId)
        : undefined;
      if (!source) break;
      const sourceDef = getCardDefinitionById(source.definitionId);
      if (!sourceDef) break;
      baseCount = getCombinedUnitCost(
        state,
        source,
        sourceDef,
        getCardDefinitionById
      );
      break;
    }

    case "source_effective_bp": {
      const sourceId = stepContext.sourceInstanceId;
      const source = sourceId
        ? state.cardInstances.find((c) => c.instanceId === sourceId)
        : undefined;
      if (!source) break;
      const sourceDef = getCardDefinitionById(source.definitionId);
      if (!sourceDef) break;
      baseCount = getCombinedUnitBp(
        state,
        source,
        sourceDef,
        getCardDefinitionById
      );
      break;
    }

    case "source_effective_level": {
      const source = stepContext.sourceInstanceId
        ? getCardById(state, stepContext.sourceInstanceId)
        : undefined;
      const definition = source
        ? getCardDefinitionById(source.definitionId)
        : undefined;
      if (source && definition)
        baseCount = getEffectiveLevel(
          state,
          source,
          definition,
          getCardDefinitionById
        );
      break;
    }

    case "selected_targets": {
      if (src.stepId !== undefined) {
        const selectedCountOverride =
          stepContext.selectedTargetCountOverrides?.[src.stepId];
        if (selectedCountOverride !== undefined) {
          baseCount = selectedCountOverride;
          break;
        }
        const groupedIds =
          stepContext.selectedTargetInstanceIdsByStepId?.[src.stepId];
        if (groupedIds !== undefined) {
          baseCount = groupedIds.length;
          break;
        }
        if (
          stepContext.selectedTargetStepId !== undefined &&
          stepContext.selectedTargetStepId !== src.stepId
        ) {
          break;
        }
      }
      baseCount = stepContext.selectedTargetInstanceIds?.length ?? 0;
      break;
    }

    case "step_numeric_amount": {
      baseCount = getStepResult(stepContext, src.stepId)?.numericAmount ?? 0;
      break;
    }

    case "trigger_related_instances": {
      const relatedIds =
        stepContext.triggerRelatedInstanceIds ??
        (stepContext.triggerRelatedInstanceId
          ? [stepContext.triggerRelatedInstanceId]
          : []);
      const idSet = new Set(relatedIds);
      baseCount = state.cardInstances.filter(
        (card) =>
          idSet.has(card.instanceId) &&
          card.zone === "field" &&
          card.pendingLeaveKind === null
      ).length;
      break;
    }

    case "trigger_related_instances_count": {
      // trigger_related_instances と異なりフィールド在圏フィルタを掛けない
      // (leave_field 等、対象が既にフィールドを離れている型のスケール源)。
      baseCount =
        stepContext.triggerRelatedInstanceIds?.length ??
        (stepContext.triggerRelatedInstanceId ? 1 : 0);
      break;
    }

    case "event_amount": {
      baseCount = stepContext.eventAmount ?? 0;
      break;
    }

    case "cost_paid_this_effect": {
      baseCount = stepContext.costPaidThisEffect ?? 0;
      break;
    }

    case "braves_on_source": {
      // 発動元カードに合体しているブレイヴの数（フィールド上 / printedCategory:"brave"）。
      // SSOT: `combined` / combine-limit と同じ物理 attached + 仮想合体判定で数える。
      const srcId = stepContext.sourceInstanceId;
      if (!srcId) break;
      const physicalCount = state.cardInstances.filter((c) => {
        if (c.attachedToInstanceId !== srcId) return false;
        if (c.zone !== "field") return false;
        const def = getCardDefinitionById(c.definitionId);
        return def?.printedCategory === "brave";
      }).length;
      baseCount =
        physicalCount + getVirtualCombinedBraveLimitCount(state, srcId);
      break;
    }

    case "self_under_card_count": {
      // 発動元カード自身が現在持つ text_role アンダーカード枚数。SSOT:
      // ConditionClause の同名 kind と同じ `countTextRoleUnderCards`。
      const srcId = stepContext.sourceInstanceId;
      if (!srcId) break;
      const source = state.cardInstances.find((c) => c.instanceId === srcId);
      if (!source) break;
      baseCount = countTextRoleUnderCards(
        source,
        src.roleTag,
        state,
        getCardDefinitionById
      );
      break;
    }
  }

  return baseCount;
}

/**
 * `cores_on` の `CoreLocation` を実 step 実行文脈で解決する。reserve/life/trash は
 * stateless 実装 (継続修飾と共用) へ委譲し、this_card/target_card/ref は
 * stepContext から実カードを特定して `getTotalCoresOnCardById` で数える。
 * 「Lv4になるように…コアを置くことで発動。amount は動的=維持コア数-現在のコア数」
 * (BSTH01-XX02 effects[1]) 等、動的量が発動元/解決済み対象カードの現在コア数を
 * 参照する型を表現するための chokepoint。
 */
function resolveCoresOnSourceCount(
  location: CoreLocation,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  switch (location.kind) {
    case "this_card": {
      const instanceId = stepContext.sourceInstanceId;
      return instanceId ? getTotalCoresOnCardById(state, instanceId) : 0;
    }
    case "target_card": {
      const instanceId = stepContext.selectedTargetInstanceIds?.[0];
      return instanceId ? getTotalCoresOnCardById(state, instanceId) : 0;
    }
    case "ref": {
      const result = getStepResult(stepContext, location.stepId);
      const instanceId = result?.affectedCardInstanceIds?.[0];
      return instanceId ? getTotalCoresOnCardById(state, instanceId) : 0;
    }
    default:
      return evaluateStatelessSourceCount(
        state,
        actingPlayerId,
        { kind: "cores_on", location },
        getCardDefinitionById,
        getDynamicCountEvaluationContext(
          state,
          stepContext,
          getCardDefinitionById
        )
      );
  }
}

function getDynamicCountEvaluationContext(
  state: GameState,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): DynamicCountEvaluationContext | undefined {
  const sourceId = stepContext.sourceInstanceId;
  const source = sourceId
    ? state.cardInstances.find((card) => card.instanceId === sourceId)
    : undefined;
  if (!source) return undefined;
  const sourceDef = getCardDefinitionById(source.definitionId);
  if (!sourceDef) return undefined;
  return { sourceTribes: sourceDef.tribe?.split("・").filter(Boolean) ?? [] };
}

function resolveDynamicCount(
  dc: DynamicCount,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const multiplier = dc.multiplier ?? 1;
  const baseCount =
    resolveSourceCount(
      dc.source,
      state,
      actingPlayerId,
      stepContext,
      getCardDefinitionById
    ) + (dc.preOffset ?? 0);

  const offset = dc.offset ?? 0;
  const divisor = dc.divisor ?? 1;
  const groupMultiplier = dc.groupMultiplier ?? 1;
  // 適用順: value = floor(((base + preOffset) * multiplier) / divisor) * groupMultiplier + offset。
  // divisor=1（既定）なら従来どおり (base + preOffset) * multiplier + offset。
  // 「Xにつき1」=「破壊数÷2(端数切捨)」型を floor 後 offset 加算で表現する。
  // preOffset は除算前に加算するため「切り上げ」除算 (ceil(base/2) = floor((base+1)/2)) を表現できる。
  let value =
    Math.floor((baseCount * multiplier) / divisor) * groupMultiplier + offset;
  // 下限クランプ（minValue 指定時のみ、cap の下限版）。除算・preOffset の組み合わせで
  // 理論上 0 未満になり得る値に mandatory な最低保証を与える。
  if (dc.minValue !== undefined) {
    value = Math.max(value, dc.minValue);
  }
  // 差分減算（subtract 指定時のみ）。「手札が相手と同じ枚数になるようドロー」=
  // 相手手札 − 自分手札。差分が負なら 0 にクランプ（ドロー数は非負）。
  if (dc.subtract !== undefined) {
    const subtractCount = resolveSourceCount(
      dc.subtract,
      state,
      actingPlayerId,
      stepContext,
      getCardDefinitionById
    );
    value = Math.max(0, value - subtractCount);
  }
  // 上限クランプ（cap 指定時のみ）。「最大15枚」「最大3体」等の印字上限を抑える。
  return dc.cap !== undefined ? Math.min(value, dc.cap) : value;
}
