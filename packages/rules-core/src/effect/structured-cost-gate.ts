// Cost-gate クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// コスト上書き/追加コスト/みなし/無効化のコスト・ゲート系実行。

import { getCardById } from "../card/card-lookup";
import type {
  EffectTarget,
  ContinuousEffect,
  ContinuousEffectTag,
  Duration,
  EffectPlayerRef,
  GameState,
  NegateAction,
  TimingScope,
  TreatAsAction,
} from "../model";
import type { ApplicabilityZone, CostCEFilterFields } from "../dsl-types";
import {
  isAdventSourceUnderCard,
  normalizeAsColors,
  resolveSelfReferenceCard,
} from "../model";
import { durationStr } from "./structured-effect-interpreter";
import { nextCeId } from "./structured-effect-sequences";

export function executeCostOverride(
  state: GameState,
  actingPlayerId: string,
  action: {
    player: EffectPlayerRef;
    filter?: CostCEFilterFields;
    costOverride: number;
    duration: Duration;
    targetInstanceId?: string;
    sourceApplicabilityZone?: ApplicabilityZone | readonly ApplicabilityZone[];
  },
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  // 適用対象 (player + filter) を targetFilter として保存し、
  // 消費側 (getApplicableCostOverrideCEs / cost-system.ts) が解釈する。
  // filter は消費側 matchesCostCEFilterClause が解釈するフィールドに限定した
  // CostCEFilterFields を素のスプレッドで渡す (guard-audit-card-filter-projection、
  // 2026-08-05 subset-type-unification)。旧実装はフィールド別 allowlist コピーで、
  // requiredKeywordTags 等の対応フィールドが黙って脱落していた。
  const targetFilter: NonNullable<ContinuousEffect["targetFilter"]> = {
    player: action.player,
    ...action.filter,
  };
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("cost_override"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "cost_override",
    modifierAmount: action.costOverride,
    targetFilter,
    ...(action.targetInstanceId
      ? { targetInstanceId: action.targetInstanceId }
      : {}),
    ...(action.sourceApplicabilityZone !== undefined
      ? {
          metadata: { sourceApplicabilityZone: action.sourceApplicabilityZone },
        }
      : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:cost_override:registered:${action.costOverride}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeAdditionalCost(
  state: GameState,
  actingPlayerId: string,
  action: {
    kind: "additional_cost";
    additionalCost: number;
    additionalPayment?: boolean;
    additionalCostDynamic?: import("../dsl-types").DynamicCount;
    /**
     * player+cardFilter 版 (ENGINE-cost-modify-additional-cost-value-player-path-dead)。
     * 指定時、単体カード (`targetInstanceId`) ではなく `player` のカード群 (targetFilter、
     * `cost_override` と同じ解決規約) に対する相対コスト加算/軽減として登録する
     * (「自分の導力器トークンマジックの使用コストを-1する」BSLH01 等)。
     * 消費側は `getApplicableAdditionalCostDeltaCEs` (card-filter.ts) が SSOT。
     */
    targetFilter?: { player: EffectPlayerRef } & CostCEFilterFields;
    duration?: Duration;
    sourceApplicabilityZone?: ApplicabilityZone | readonly ApplicabilityZone[];
  },
  sourceInstanceId: string | null,
  provenance?: { effectIndex: number; stepIndex: number },
  timingScope?: TimingScope
): GameState {
  const acSourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;
  // targetFilter は消費側 matchesCostCEFilterClause が解釈するフィールドに限定した
  // CostCEFilterFields を素のスプレッドで渡す (guard-audit-card-filter-projection、
  // 2026-08-05 subset-type-unification)。旧実装はフィールド別 allowlist コピーで、
  // requiredKeywordTags 等の対応フィールドが黙って脱落していた。
  const targetFilter = action.targetFilter satisfies
    | NonNullable<ContinuousEffect["targetFilter"]>
    | undefined;
  state.log.push(
    `effect:additional_cost:${targetFilter ? `filter:${JSON.stringify(targetFilter)}` : sourceInstanceId}:${action.additionalCost}`
  );
  const acEffect: ContinuousEffect = {
    effectId: nextCeId("additional_cost"),
    sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
    sourceDefinitionId: acSourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration ?? { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "additional_cost",
    modifierAmount: action.additionalCost,
    ...(action.additionalCostDynamic !== undefined
      ? { modifierAmountDynamic: action.additionalCostDynamic }
      : {}),
    ...(targetFilter
      ? { targetFilter }
      : sourceInstanceId
        ? { targetInstanceId: sourceInstanceId }
        : {}),
    metadata: {
      ...(action.sourceApplicabilityZone !== undefined
        ? { sourceApplicabilityZone: action.sourceApplicabilityZone }
        : {}),
      ...(action.additionalPayment ? { additionalPayment: true } : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, acEffect],
  };
}

/** 「このカード」と煌臨元の「このスピリット」を登録・再評価で同じ対象へ解決する。 */
export function resolveTreatAsTargetInstanceId(
  state: GameState,
  action: { appliesToCard?: boolean },
  sourceInstanceId: string
): string {
  const sourceCard = getCardById(state, sourceInstanceId);
  return sourceCard &&
    !action.appliesToCard &&
    isAdventSourceUnderCard(state, sourceCard)
    ? (resolveSelfReferenceCard(state, sourceInstanceId, true)?.instanceId ??
        sourceInstanceId)
    : sourceInstanceId;
}

export function executeTreatAs(
  state: GameState,
  actingPlayerId: string,
  action: TreatAsAction,
  sourceInstanceId: string,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  if (action.cardStateOnly) {
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);
  const tag = `treat_as_${action.aspect}` as ContinuousEffectTag;
  // 多色 treat_as: 列挙された全色を modifierSymbol に格納する (consumer 側で全色適用)。
  const asColors = normalizeAsColors(action.asColor);
  // 煌臨元の「このスピリット」は上カードを指す。発揮元と適用先を分け、
  // 発揮資格・失効は元カードの provenance に従う。「このカード」は転送しない。
  const targetInstanceId = resolveTreatAsTargetInstanceId(
    state,
    action,
    sourceInstanceId
  );
  // ソースカードの現在ゾーンに応じた duration scope (P3-119 根治)。
  // 旧実装は while_on_field 固定だったため、バースト/ミラージュにセットされた
  // カードから rebuildContinuousEffectsFromField 経由で登録される度に
  // recomputeContinuousEffects の while_on_field フィルタ (zone!=="field" で除去)
  // が即座に除去し、次の rebuild でまた「未登録」と判定されて再登録される
  // register/expire 無限往復 (fuzz gate ハングの真因) を起こしていた。
  // while_set / while_in_trash は既存の zone 連動 duration scope で、対称的に
  // 同じ zone に留まる限り除去されないため往復が止まる。
  const treatAsDuration: Duration =
    sourceCard?.zone === "burst" || sourceCard?.zone === "mirage"
      ? { scope: "while_set" }
      : sourceCard?.zone === "trash"
        ? { scope: "while_in_trash" }
        : { scope: "while_on_field" };
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("treat_as"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: treatAsDuration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    modifierSymbol: asColors,
    targetInstanceId,
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:treat_as:registered:${action.aspect}:${asColors.join("/")}:${sourceInstanceId}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeNegate(
  state: GameState,
  actingPlayerId: string,
  action: NegateAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  continuousDeclaration = false,
  chainId?: string | null
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (action.causedByThisEffect) {
    // 原因の解決 ID を固定する。ステップ持続・次のスタックへの単発予約ではない。
    // 収集側で各反応へ抑止を転写するので、原因の解決終了後もその反応だけは抑止される。
    if (!chainId) return state;
    const reactionNegation: ContinuousEffect = {
      effectId: nextCeId("negate-caused-reaction"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: { scope: "current_effect" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "negate_caused_reaction",
      metadata: { chainId, negateTarget: action.negateTarget },
      ...(provenance ? { provenance } : {}),
    };
    return {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        reactionNegation,
      ],
    };
  }
  const tag = `negate_${action.negateTarget}` as ContinuousEffectTag;
  // opponent_burst のみ抑制種別を CE に保持 (既定 "nullify")。consumer は
  // isBurstEffectNullifiedByOpponent が metadata.burstSuppressKind で分岐する。
  const burstSuppressKind =
    action.negateTarget === "opponent_burst"
      ? (action.burstSuppressKind ?? "nullify")
      : undefined;
  const negateMetadata =
    action.negateTarget === "opponent_burst"
      ? burstSuppressKind
        ? {
            burstSuppressKind,
            ...(action.targetFilter
              ? { targetFilter: action.targetFilter }
              : {}),
          }
        : undefined
      : {
          ...(continuousDeclaration ||
          action.duration?.scope === "while_on_field"
            ? { continuousStackNegate: true }
            : {}),
          ...(action.targetFilter ? { targetFilter: action.targetFilter } : {}),
          ...(action.targetController
            ? { targetController: action.targetController }
            : {}),
          ...(action.targetEffectTiming
            ? { targetEffectTiming: action.targetEffectTiming }
            : {}),
          ...(action.targetEffectFilter
            ? { targetEffectFilter: action.targetEffectFilter }
            : {}),
          ...(action.suppressMatchedEffect !== undefined
            ? { suppressMatchedEffect: action.suppressMatchedEffect }
            : {}),
        };
  // duration 既定は「このターンの間」。継続無効化 (常駐) は while_on_field を指定し、
  // 発動条件は effect.condition (recompute add/remove) + timingScope (消費時 live 評価) に委ねる。
  const duration: Duration = action.duration ?? { scope: "turn" };
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("negate"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    forceLevel: "prohibition",
    ...(timingScope ? { timingScope } : {}),
    ...(negateMetadata && Object.keys(negateMetadata).length > 0
      ? { metadata: negateMetadata }
      : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:negate:registered:${action.negateTarget}${burstSuppressKind ? `:${burstSuppressKind}` : ""}`
  );
  const queuesPendingStackNegate =
    action.negateTarget !== "opponent_burst" &&
    (negateMetadata as { continuousStackNegate?: boolean } | undefined)
      ?.continuousStackNegate !== true;
  const pendingStackNegateRequests = !queuesPendingStackNegate
    ? state.pendingStackNegateRequests
    : [
        ...state.pendingStackNegateRequests,
        {
          requestId: nextCeId("negate-request"),
          actingPlayerId,
          sourceInstanceId,
          negateTarget: action.negateTarget,
          createdAtStep: state.step,
          createdAtTurn: state.turnNumber,
          ...(action.duration ? { duration: action.duration } : {}),
          ...(action.targetFilter ? { targetFilter: action.targetFilter } : {}),
          ...(action.targetController
            ? { targetController: action.targetController }
            : {}),
          ...(action.targetEffectTiming
            ? { targetEffectTiming: action.targetEffectTiming }
            : {}),
          ...(action.targetEffectFilter
            ? { targetEffectFilter: action.targetEffectFilter }
            : {}),
          ...(action.suppressMatchedEffect !== undefined
            ? { suppressMatchedEffect: action.suppressMatchedEffect }
            : {}),
        },
      ];
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    pendingStackNegateRequests,
  };
}

// --- 煌臨条件コスト付与 (ContinuousEffect: advent_cost_override 登録) ---
// 「〜は、自分が【煌臨】するとき、コストはNとしても扱う」(BSTH02-C03 Lv2)。
// AdventCondition.minCost 判定にのみ影響する対象限定の実効コスト付与。additional_cost
// と異なり target で自分以外のカード群 (フィルタ一致するすべて) にも付与できる。
// 消費は matchesAdventCondition (advent-system.ts getAdventCostOverrides) 一本。

export function executeAdventCostOverride(
  state: GameState,
  actingPlayerId: string,
  action: {
    target: EffectTarget;
    costTreatedAs: number;
    duration: Duration;
  },
  sourceInstanceId: string | null,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;
  const isSelfTarget = action.target.selfCard === true;
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("advent_cost_override"),
    sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "advent_cost_override",
    modifierAmount: action.costTreatedAs,
    ...(isSelfTarget
      ? sourceInstanceId
        ? { targetInstanceId: sourceInstanceId }
        : {}
      : {
          targetFilter: {
            player: action.target.player,
            ...(action.target.category
              ? { category: action.target.category }
              : {}),
            ...(action.target.colors ? { colors: action.target.colors } : {}),
            ...(action.target.tribes ? { tribes: action.target.tribes } : {}),
            ...(action.target.tribesLogic
              ? { tribesLogic: action.target.tribesLogic }
              : {}),
            ...(action.target.noTribes
              ? { noTribes: action.target.noTribes }
              : {}),
            ...(action.target.maxCost !== undefined
              ? { maxCost: action.target.maxCost }
              : {}),
            ...(action.target.minCost !== undefined
              ? { minCost: action.target.minCost }
              : {}),
          },
        }),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:advent_cost_override:registered:${action.costTreatedAs}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}
