import { getDiscardableBurstStates } from "../mechanics/burst-system";
import { deriveEffectAspectForImmunity } from "./effect-aspect";
// P2-14 inc6: effect-interpreter god-file 分解。DSL Action のターゲット解決クラスタ
// (resolveTargets / convertTargetSpecToEffectTarget / selectSequentialActionTargets 他 23 関数)
// を兄弟ファイルへ抽出。registry/dispatcher を逆参照しない leaf のため一方向 import。barrel/振る舞い不変。

import { getCardById } from "../card/card-lookup";
import {
  getSelfCountThresholdValue,
  matchesCardFilter,
  type MatchCardFilterOptions,
  resolveDynamicThresholdsInFilter,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import { getEffectiveTribe } from "../mechanics/act-as-spirit";
import {
  filterTargetsByTargetAcquisitionGate,
  getCardDefinitionForEffectiveFieldCard,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
} from "../legal/legal-actions-shared";
import { resolveSelfReferenceCard } from "../model";
import { stackMatchesNegateAction } from "../stack/stack-negate";
import {
  applyEffectParamOverridesToFilter,
  deriveEffectParamOverrideClass,
} from "./effect-param-override";
import { evaluateCondition } from "./structured-condition-eval";
import { evaluateApplicability } from "./effect-applicability";
import { resolveCardImmunityAffect } from "./effect-affect-adapter";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import { resolvePlayerRef } from "./structured-effect-interpreter";
import {
  resolveAmount,
  resolveCount,
  resolveCountBound,
  resolveTargetSpec,
} from "./target-resolution";
import { getExpandEffectTargetCountBonus } from "./expand-effect-target-count";
import { arePreSelectedTargetRefsPreserved } from "./preselected-target-ref-context";
import type { Action, Amount, CardFilter, TargetSpec } from "../dsl-types";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  EffectCoreLocation,
  EffectPlayerRef,
  EffectTarget,
  GameState,
  PendingEffectTargetGroup,
} from "../model";
import { getStepResult } from "../step-execution-context";
import type { StepExecutionContext } from "../step-execution-context";
import {
  convertCoreLocation,
  resolveCountToNumber,
} from "./native-action-shared";
import type { CoreLocation } from "../dsl-types";
import type { StackNegateActionLike } from "../stack/stack-negate";

// ============================================================
// DSL Action → ターゲット解決
// ============================================================

/** `native-action-registry.ts` set_exhaust_state ハンドラの解決コンテキスト。 */
export interface SetExhaustStateResolveContext {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepContext: StepExecutionContext;
}

function runtimeCardFilterEvaluators(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Pick<MatchCardFilterOptions, "evaluateCondition" | "evaluateApplicability"> {
  return {
    evaluateCondition: (
      condition,
      sourceId: string,
      conditionActingPlayerId: string
    ) =>
      evaluateCondition(
        state,
        condition,
        sourceId,
        conditionActingPlayerId,
        getCardDefinitionById
      ),
    evaluateApplicability: (applicability, sourceId: string) =>
      evaluateApplicability(
        state,
        applicability,
        sourceId,
        getCardDefinitionById
      ),
  };
}

/**
 * set_exhaust_state の実効 state を解決する (SSOT)。`matchExhaustStateOf` 指定時は
 * `resolveTargetSpec` で解決した参照カード (先頭1件) の現在の exhaustState を返す
 * （参照カードが解決できない、または resolveCtx 未指定なら undefined）。
 * 未指定時は `action.state` をそのまま返す。native-action-registry.ts の実行ハンドラから呼ぶ
 * (SSOT、P3-105 verifier 指摘対応)。
 */
export function resolveSetExhaustStateValue(
  action: Extract<Action, { kind: "set_exhaust_state" }>,
  resolveCtx?: SetExhaustStateResolveContext
): "recovered" | "exhausted" | "heavily_exhausted" | undefined {
  if (!action.matchExhaustStateOf || !resolveCtx) return action.state;
  const refCard = resolveTargetSpec({
    state: resolveCtx.state,
    targetSpec: action.matchExhaustStateOf,
    actingPlayerId: resolveCtx.actingPlayerId,
    sourceInstanceId: resolveCtx.sourceInstanceId,
    getCardDefinitionById: resolveCtx.getCardDefinitionById,
    stepContext: resolveCtx.stepContext,
  })[0];
  return refCard?.exhaustState;
}

/**
 * P3-14 A-7: destroy / vanish / bounce / prevent_battle / exhaust のみ
 * effect_param_override の適用対象。対象解決のすべての経路（メイン解決 /
 * conditional_cost 検証 / 逐次選択検証）で同じ overrideKind を resolveTargetSpec に
 * 渡すための SSOT。これを各所で渡さないと、合体ブレイヴ等の「BP破壊上限+N」
 * (effect_param_modify) が経路ごとに片側だけ適用され、候補列挙では合法な対象が
 * conditional_cost 検証で「対象不足」と誤判定される
 * （BSTH01-X04 フランドール＋X09 レーヴァテイン合体時の destroy ロールバック）。
 * exhaust は BSLH01-M01 (engine-cost-cap-modifier-ability-category) で追加。
 */
export function deriveParamOverrideActionKind(
  action: Action
): "destroy" | "vanish" | "bounce" | "prevent_battle" | "exhaust" | undefined {
  return action.kind === "destroy" ||
    action.kind === "vanish" ||
    action.kind === "bounce" ||
    action.kind === "prevent_battle" ||
    action.kind === "exhaust"
    ? action.kind
    : undefined;
}

export function selectorIntentForActionTarget(
  target: TargetSpec,
  preSelectedIds?: readonly string[]
): import("./target-affect-gate").TargetAcquireContext["selectorIntent"] {
  if (target.kind === "filter") {
    return target.count === "all" ? "include_all" : "explicit_target";
  }
  if (preSelectedIds && preSelectedIds.length > 0) return "explicit_target";
  return "auto";
}

export function applyActionTargetCount(
  ids: readonly string[],
  target: TargetSpec,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: readonly string[],
  /**
   * retrigger-system.ts / effect-borrowing.ts のように pendingEffectTargetSelection を
   * 経由しない直接再実行経路向け (ENGINE-retrigger-range-count-target-fallback)。
   * 範囲ターゲット ({min,max}) の自動解決 (preSelectedIds 無し) 時、既定の静的 min
   * (=常に0選択の無音no-op) ではなく max (静的数値 or DynamicCount、resolveCountBound で
   * 解決) を採用する。未指定時は従来通り min。
   */
  rangeAutoResolveStrategy?: "min" | "max",
  /**
   * ENGINE-target-count-expand-modifier Step3 補正: 発動元カードの instanceId。
   * 渡された場合のみ expand_effect_target_count CE による対象数 +N を適用する
   * (BSLH01-TR02(A))。resolveTargets() の標準 filter 経路は常に returnFullPool:true で
   * resolveTargetSpec を呼ぶため、対象数の実スライスはここが唯一の chokepoint
   * (resolveTargetSpec 内 resolveCount 分岐は CE 登録ハンドラ等の別経路専用で、
   * この標準経路には到達しない)。
   */
  sourceInstanceId?: string
): string[] {
  if (target.kind !== "filter") return [...ids];
  if (preSelectedIds && preSelectedIds.length > 0) return [...ids];
  if (
    rangeAutoResolveStrategy === "max" &&
    typeof target.count === "object" &&
    target.count !== null &&
    "max" in target.count &&
    target.count.max !== undefined
  ) {
    const maxCount = resolveCountBound(
      target.count.max,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    return ids.slice(0, Math.max(0, maxCount));
  }
  const count = resolveCount(
    target.count,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  if (count === -1) return [...ids];
  const expandBonus = sourceInstanceId
    ? getExpandEffectTargetCountBonus({
        state,
        actingPlayerId,
        sourceInstanceId,
        candidatePool: ids
          .map((id) => state.cardInstances.find((c) => c.instanceId === id))
          .filter((c): c is CardInstance => c !== undefined),
        getCardDefinitionById,
        stepContext: stepCtx,
      })
    : 0;
  return ids.slice(0, Math.max(0, count + expandBonus));
}

function shouldIncludePendingLeaveForOverrideProperties(
  action: Action
): boolean {
  if (action.kind !== "override_properties") return false;
  const keys = Object.keys(action.properties);
  return (
    keys.length === 1 &&
    Object.prototype.hasOwnProperty.call(action.properties, "levelCostDelta") &&
    action.properties.levelCostDelta !== undefined
  );
}

export function resolveTargets(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  preSelectedIds?: string[],
  sourceDefinition?: CardDefinition,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  targetSelectionResolved?: boolean,
  sourceEffectIndex?: number,
  sourceTargetStepId?: string,
  rangeAutoResolveStrategy?: "min" | "max",
  effectSourceInstanceId?: string,
  effectSourceDefinition?: CardDefinition,
  skipPreSelectedFilterRevalidation?: boolean,
  excludedTargetInstanceIds?: readonly string[],
  validatePreSelectedAgainstPool?: boolean,
  sourceCardReferenceInstanceId?: string,
  preservePreSelectedTargetRefs?: boolean
): string[] | undefined {
  const target = getActionTargetSpec(action);
  if (action.kind === "core_move" && !target) {
    return resolveCoreMoveFieldCardTargetIds(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      preSelectedIds,
      sourceDefinition,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      true,
      sourceEffectIndex,
      sourceTargetStepId,
      stepCtx.effectActivationTiming,
      effectSourceInstanceId,
      effectSourceDefinition
    );
  }
  if (action.kind === "discard_set_burst" && !action.target) {
    const targetPlayerId = resolvePlayerRef(
      actingPlayerId,
      action.player ?? "opponent",
      state
    );
    const setBurstIds = getDiscardableBurstStates(state, targetPlayerId).map(
      (s) => s.cardInstanceId
    );
    // ENGINE-composite-heterogeneous-removal-budget: count が {min,max}（範囲）で未解決の
    // ときは native-action-registry.ts discard_set_burst ハンドラが
    // pendingDiscardSetBurstCountSelection を生成してプレイヤーに枚数を選ばせるため、
    // ここでは resolveCountToNumber の min 丸めを使わず undefined を返して未解決を伝える
    // (pending 解決は executeDiscardSetBurst を直接呼び、この関数を再度経由しない)。
    if (
      preSelectedIds === undefined &&
      targetSelectionResolved !== true &&
      typeof action.count === "object" &&
      action.count !== null &&
      "min" in action.count
    ) {
      return undefined;
    }
    // ENGINE-composite-heterogeneous-removal-budget: count は number 固定値のほか
    // DynamicCount（単一の動的値、例: 前段 step の残り予算参照）を取れる。resolveCountToNumber
    // は共通 SSOT (target-resolution.ts resolveCount) を経由し、"all" は -1 センチネルを
    // 返す規約 (resolveTargets 冒頭の `if (count === -1)` と同じ)。
    const resolvedCountRaw = resolveCountToNumber(
      action.count,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    const resolvedCount =
      resolvedCountRaw === -1 ? setBurstIds.length : resolvedCountRaw;
    if (preSelectedIds !== undefined) {
      const set = new Set(setBurstIds);
      return preSelectedIds.filter((id) => set.has(id)).slice(0, resolvedCount);
    }
    if (targetSelectionResolved === true) return [];
    return setBurstIds.slice(0, resolvedCount);
  }
  if (!target) {
    if (
      ((action.kind === "summon" || action.kind === "put") &&
        action.target.kind === "from_zone") ||
      action.kind === "search_zone"
    ) {
      return preSelectedIds;
    }
    return undefined;
  }

  if (
    targetSelectionResolved === true &&
    preSelectedIds !== undefined &&
    preSelectedIds.length === 0 &&
    validatePreSelectedAgainstPool !== true
  ) {
    return [];
  }

  // 03b:112-115: targeted disclosure で一度確定した TargetRef は、応答後に
  // target acquisition をやり直さない。continuation 側で instance の存在と
  // disclosure 時の zone は再検証済みなので、ここではその surviving refs を
  // そのまま action の affect gate に渡す。
  const skipPreSelectedTargetAcquisition =
    preSelectedIds !== undefined &&
    (preservePreSelectedTargetRefs === true ||
      arePreSelectedTargetRefsPreserved(preSelectedIds));

  const overrideKind = deriveParamOverrideActionKind(action);
  const sourceAttachedChildrenOnly =
    targetRequiresSourceAttachedChildren(action);
  const braveCombineHostOnly =
    targetRequiresBraveCombineHostEligibility(action);
  const braveSeparationSolvencyOnly =
    targetRequiresBraveSeparationSolvency(action);
  const shouldGateFullPool =
    target.kind === "filter" &&
    (!preSelectedIds || preSelectedIds.length === 0);
  // ENGINE-brave-combine-third-party-target: source 指定時は合体元ブレイヴが
  // sourceInstanceId 自身ではないため、host 適格性 (braveCondition 等) は
  // このブレイヴの定義を基準にする（未指定/未解決時は従来どおり sourceDefinition を使う）。
  const braveCombineIncomingBraveDefinition = braveCombineHostOnly
    ? resolveBraveCombineIncomingBraveDefinition(
        action,
        state,
        stepCtx,
        getCardDefinitionById
      )
    : undefined;
  const braveCombineIncomingBraveInstanceId = braveCombineHostOnly
    ? (resolveBraveCombineIncomingBraveInstanceId(action, stepCtx) ??
      sourceInstanceId)
    : undefined;

  const targetSpecOptions = {
    state,
    targetSpec: target,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId }
      : {}),
    ...(sourceDefinition ? { sourceDefinition } : {}),
    ...(overrideKind ? { paramOverrideActionKind: overrideKind } : {}),
    ...(sourceTargetLockBypass !== undefined &&
    sourceTargetLockBypass.kind !== "none"
      ? {
          bypassSpecialNexusTargetLock: true,
          ignoreCategoryExclusion:
            sourceTargetLockBypass.kind === "all_effects",
        }
      : {}),
    ...(sourceAttachedChildrenOnly ? { sourceAttachedChildrenOnly: true } : {}),
    ...(sourceAttachedChildrenOnly
      ? { starGarmentTargetEligibleOnly: true }
      : {}),
    ...(braveCombineHostOnly ? { braveCombineHostOnly: true } : {}),
    ...(braveCombineIncomingBraveDefinition
      ? { braveCombineIncomingBraveDefinition }
      : {}),
    ...(braveCombineIncomingBraveInstanceId
      ? { braveCombineIncomingBraveInstanceId }
      : {}),
    ...(braveSeparationSolvencyOnly
      ? { braveSeparationSolvencyOnly: true }
      : {}),
    ...(shouldIncludePendingLeaveForOverrideProperties(action)
      ? { includePendingLeave: true }
      : {}),
    ...(validatePreSelectedAgainstPool
      ? { validatePreSelectedAgainstPool: true }
      : {}),
    ...runtimeCardFilterEvaluators(state, getCardDefinitionById),
  };
  const cards = skipPreSelectedTargetAcquisition
    ? preSelectedIds.flatMap((instanceId) => {
        const card = getCardById(state, instanceId);
        return card ? [card] : [];
      })
    : resolveTargetSpec({
        ...targetSpecOptions,
        ...(preSelectedIds ? { preSelectedIds } : {}),
        ...(shouldGateFullPool ? { returnFullPool: true } : {}),
      });

  const baseIds =
    cards.length > 0
      ? cards.map((c) => c.instanceId)
      : (target.kind === "filter" &&
            (target.sourceUnderCardRole !== undefined ||
              target.stepId !== undefined)) ||
          target.kind === "ref" ||
          target.kind === "trigger_related_instance" ||
          target.kind === "trigger_related_combined_host" ||
          target.kind === "trigger_related_instances" ||
          target.kind === "pending_leave_caused_by_effect_source"
        ? []
        : preSelectedIds;
  if (!baseIds || baseIds.length === 0) return baseIds;
  const afterTargetSpecGate =
    preSelectedIds &&
    preSelectedIds.length > 0 &&
    !skipPreSelectedTargetAcquisition &&
    target.kind === "filter" &&
    action.kind === "override_properties" &&
    skipPreSelectedFilterRevalidation !== true
      ? (() => {
          const validIds = new Set(
            resolveTargetSpec({
              ...targetSpecOptions,
              returnFullPool: true,
            }).map((card) => card.instanceId)
          );
          return baseIds.filter((id) => validIds.has(id));
        })()
      : baseIds;

  // カード対象の「相手の効果を受けない」(defense_immune) を実行時に除外する。
  // GUI 候補列挙 (getCandidateTargetInstanceIds) は防御レベルで既に除外済だが、
  // "all"/ref/preSelected など候補選択を経ない経路はここで初めて塞がれる。
  // self/opponent/any の範囲は共通免疫adapterで判定する。
  const immunityEffectAspect = deriveEffectAspectForImmunity(action);
  const affectSourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    ...(sourceDefinition !== undefined ? { sourceDefinition } : {}),
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(effectSourceDefinition !== undefined ? { effectSourceDefinition } : {}),
    getCardDefinitionById,
  });
  // 03b:112-115: 対象指定と affect は別判定。targeted disclosure 後に再開する
  // 宣言済み TargetRef は対象取得し直さず、action 固有の affect gate に委ねる。
  // effect immunity は対象取得ではなく affect 判定なので、TargetRef 再開でも
  // 継続して対象ごとに適用する。
  // 選択専用 step と破棄は実行側で耐性を判定する。非公開の耐性を
  // 選択前に除外すると、証明の公開も選択数の消費も失われる。
  const deferImmunity =
    action.kind === "noop" ||
    action.kind === "discard" ||
    action.kind === "discard_set_burst" ||
    action.kind === "reveal_hand";
  const afterImmunityGate = deferImmunity
    ? afterTargetSpecGate
    : afterTargetSpecGate.filter((id) => {
        const card = getCardById(state, id);
        return (
          !card ||
          resolveCardImmunityAffect(
            state,
            card,
            actingPlayerId,
            sourcePreventionLevel,
            {
              ...(affectSourceIdentity.instance
                ? { instance: affectSourceIdentity.instance }
                : {}),
              ...(affectSourceIdentity.definition
                ? { definition: affectSourceIdentity.definition }
                : {}),
              ...(sourceEffectIndex !== undefined
                ? { effectIndex: sourceEffectIndex }
                : {}),
              ...(sourceTargetStepId !== undefined
                ? { targetStepId: sourceTargetStepId }
                : {}),
              ...(stepCtx.effectActivationTiming !== undefined
                ? { effectActivationTiming: stepCtx.effectActivationTiming }
                : {}),
            },
            getCardDefinitionById,
            sourcePreventionBypass,
            immunityEffectAspect
          ).kind === "allowed"
        );
      });
  const afterAcquisitionGate = skipPreSelectedTargetAcquisition
    ? afterImmunityGate
    : filterTargetsByTargetAcquisitionGate(
        state,
        afterImmunityGate,
        {
          actingPlayerId,
          // Match candidate/affect gates: text-role uses its provider, whereas
          // combined brave text keeps the host identity through the same SSOT.
          sourceInstanceId: affectSourceIdentity.instanceId,
          ...(affectSourceIdentity.definitionId !== undefined
            ? { sourceDefinitionId: affectSourceIdentity.definitionId }
            : {}),
          prevention: {
            resistance: sourcePreventionLevel ?? "none",
            targetLockBypass: sourceTargetLockBypass ?? { kind: "none" },
          },
          cause: "effect",
        },
        selectorIntentForActionTarget(target, preSelectedIds),
        getCardDefinitionById
      );
  const afterActionDomainGate = filterActionTargetDomain(
    action,
    state,
    actingPlayerId,
    afterAcquisitionGate
  );
  const afterRepeatDuplicateGate =
    excludedTargetInstanceIds && excludedTargetInstanceIds.length > 0
      ? afterActionDomainGate.filter(
          (id) => !excludedTargetInstanceIds.includes(id)
        )
      : afterActionDomainGate;
  return applyActionTargetCount(
    afterRepeatDuplicateGate,
    target,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById,
    action.kind === "override_properties" ? undefined : preSelectedIds,
    rangeAutoResolveStrategy,
    sourceInstanceId
  );
}

export function resolveTargetCandidateIds(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  sourceDefinition?: CardDefinition,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinition?: CardDefinition
): string[] | undefined {
  const target = getActionTargetSpec(action);
  if (action.kind === "core_move" && !target) {
    return resolveCoreMoveFieldCardTargetIds(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      undefined,
      sourceDefinition,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      false,
      undefined,
      undefined,
      undefined,
      effectSourceInstanceId,
      effectSourceDefinition
    );
  }
  if (action.kind === "discard_set_burst" && !action.target) {
    const targetPlayerId = resolvePlayerRef(
      actingPlayerId,
      action.player ?? "opponent",
      state
    );
    return getDiscardableBurstStates(state, targetPlayerId).map(
      (s) => s.cardInstanceId
    );
  }
  if (!target) return undefined;

  const overrideKind = deriveParamOverrideActionKind(action);
  const sourceAttachedChildrenOnly =
    targetRequiresSourceAttachedChildren(action);
  const cards = resolveTargetSpec({
    state,
    targetSpec: target,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
    ...(sourceDefinition ? { sourceDefinition } : {}),
    ...(overrideKind ? { paramOverrideActionKind: overrideKind } : {}),
    ...(sourceTargetLockBypass !== undefined &&
    sourceTargetLockBypass.kind !== "none"
      ? {
          bypassSpecialNexusTargetLock: true,
          ignoreCategoryExclusion:
            sourceTargetLockBypass.kind === "all_effects",
        }
      : {}),
    ...(sourceAttachedChildrenOnly ? { sourceAttachedChildrenOnly: true } : {}),
    ...(sourceAttachedChildrenOnly
      ? { starGarmentTargetEligibleOnly: true }
      : {}),
    returnFullPool: true,
    ...runtimeCardFilterEvaluators(state, getCardDefinitionById),
  });
  const baseIds = filterActionTargetDomain(
    action,
    state,
    actingPlayerId,
    cards.map((card) => card.instanceId)
  );
  const affectSourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    sourceDefinition,
    effectSourceInstanceId,
    effectSourceDefinition,
    getCardDefinitionById,
  });
  return filterTargetsByTargetAcquisitionGate(
    state,
    baseIds,
    {
      actingPlayerId,
      sourceInstanceId: affectSourceIdentity.instanceId,
      ...(affectSourceIdentity.definitionId !== undefined
        ? { sourceDefinitionId: affectSourceIdentity.definitionId }
        : {}),
      prevention: {
        resistance: sourcePreventionLevel ?? "none",
        targetLockBypass: sourceTargetLockBypass ?? { kind: "none" },
      },
      cause: "effect",
    },
    selectorIntentForActionTarget(target),
    getCardDefinitionById
  );
}

/** セット中バーストの操作には発動中などの同ゾーンカードを混ぜない。 */
function filterActionTargetDomain(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  ids: string[]
): string[] {
  if (action.kind !== "discard_set_burst") return ids;
  const playerId = resolvePlayerRef(
    actingPlayerId,
    action.player ?? "opponent",
    state
  );
  const setIds = new Set(
    getDiscardableBurstStates(state, playerId).map((s) => s.cardInstanceId)
  );
  return ids.filter((id) => setIds.has(id));
}

export function resolveCoreMoveFieldCardTargetIds(
  action: Extract<Action, { kind: "core_move" }>,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: readonly string[],
  sourceDefinition?: CardDefinition,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  applyImmunityGate = true,
  sourceEffectIndex?: number,
  sourceTargetStepId?: string,
  effectActivationTiming?: import("../model").EffectActivationTiming,
  effectSourceInstanceId?: string,
  effectSourceDefinition?: CardDefinition
): string[] | undefined {
  if (action.from.kind !== "field_card") return undefined;
  if (!action.to) return undefined;
  const from = action.from;
  const to = action.to;
  const runtimeTo = to as EffectCoreLocation;
  const fromPlayerId = resolvePlayerRef(actingPlayerId, from.player, state);
  const destinationCardInstanceId =
    to.kind === "this_card"
      ? sourceInstanceId
      : runtimeTo.kind === "card_instance"
        ? runtimeTo.instanceId
        : undefined;
  const destinationCardOwnerId =
    destinationCardInstanceId !== undefined
      ? state.cardInstances.find(
          (card) => card.instanceId === destinationCardInstanceId
        )?.ownerPlayerId
      : undefined;
  const canMoveSoulCore =
    (to.kind === "this_card" || runtimeTo.kind === "card_instance") &&
    destinationCardOwnerId !== undefined &&
    destinationCardOwnerId === fromPlayerId;
  const hasMovableSoulCore = (instanceId: string): boolean =>
    canMoveSoulCore &&
    state.players.some(
      (player) =>
        player.id === fromPlayerId &&
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === instanceId
    );
  const availableIds = state.cardInstances
    .filter((card) => {
      if (card.controllerPlayerId !== fromPlayerId) return false;
      if (card.zone !== "field") return false;
      if (card.pendingLeaveKind !== null) return false;
      if (card.normalCoreCount <= 0 && !hasMovableSoulCore(card.instanceId)) {
        return false;
      }
      const def = getCardDefinitionForEffectiveFieldCard(
        card,
        getCardDefinitionById,
        { state, filter: from.filter ?? {} }
      );
      if (!def) return false;
      return matchesCardFilter(card, def, from.filter, {
        state,
        fieldCategoryContext: true,
        getCardDefinitionById,
        effectiveColors: getEffectiveColors(state, card, def),
        effectiveBp: getCombinedUnitBp(state, card, def, getCardDefinitionById),
        coreCount: getTotalCoresOnCardById(state, card.instanceId),
        effectiveLevel: getEffectiveLevel(
          state,
          card,
          def,
          getCardDefinitionById
        ),
        ...getCombinedUnitCostFilterOptions(
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
        ...runtimeCardFilterEvaluators(state, getCardDefinitionById),
        effectiveTribes: getEffectiveTribe(
          state,
          card,
          def,
          getCardDefinitionById
        )
          .split("・")
          .filter(Boolean),
      });
    })
    .map((card) => card.instanceId);
  const baseIds =
    preSelectedIds !== undefined
      ? preSelectedIds.filter((id) => availableIds.includes(id))
      : availableIds;
  const immunitySourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    sourceDefinition,
    effectSourceInstanceId,
    effectSourceDefinition,
    getCardDefinitionById,
  });
  const afterImmunityGate = applyImmunityGate
    ? (() => {
        return baseIds.filter((id) => {
          const card = getCardById(state, id);
          return (
            !card ||
            resolveCardImmunityAffect(
              state,
              card,
              actingPlayerId,
              sourcePreventionLevel,
              {
                ...(immunitySourceIdentity.instance
                  ? { instance: immunitySourceIdentity.instance }
                  : {}),
                ...(immunitySourceIdentity.definition
                  ? { definition: immunitySourceIdentity.definition }
                  : {}),
                ...(sourceEffectIndex !== undefined
                  ? { effectIndex: sourceEffectIndex }
                  : {}),
                ...(sourceTargetStepId !== undefined
                  ? { targetStepId: sourceTargetStepId }
                  : {}),
                ...(effectActivationTiming !== undefined
                  ? { effectActivationTiming }
                  : {}),
              },
              getCardDefinitionById,
              sourcePreventionBypass
            ).kind === "allowed"
          );
        });
      })()
    : baseIds;
  return filterTargetsByTargetAcquisitionGate(
    state,
    afterImmunityGate,
    {
      actingPlayerId,
      sourceInstanceId: immunitySourceIdentity.instanceId,
      ...(immunitySourceIdentity.definitionId !== undefined
        ? { sourceDefinitionId: immunitySourceIdentity.definitionId }
        : {}),
      prevention: {
        resistance: sourcePreventionLevel ?? "none",
        targetLockBypass: sourceTargetLockBypass ?? { kind: "none" },
      },
      cause: "effect",
    },
    "auto",
    getCardDefinitionById
  );
}

export function isConditionalCostTargetShortage(
  action: Action,
  resolvedTargetIds: readonly string[] | undefined,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const target = getActionTargetSpec(action);
  if (!target || target.kind !== "filter") return false;
  const selected = resolvedTargetIds?.length ?? 0;
  if (typeof target.count === "number") {
    return selected < target.count;
  }
  // count: { min, max } (可変選択) 形式。「ことで」連結ステップでは双方向チェック
  // (10_rules/03c §「○○することで△△する」) により「対象 0 体 = △△ 不発 → ○○ も
  // 不発」となるため、min=0 でも 0 体選択はロールバック扱いとする。
  // min が DynamicCount のときは盤面で解決した実効最小数を採用する。
  if (
    target.count !== null &&
    typeof target.count === "object" &&
    "min" in target.count
  ) {
    const resolvedMin =
      typeof target.count.min === "number"
        ? target.count.min
        : resolveCountBound(
            target.count.min,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById
          );
    const effectiveMin = Math.max(resolvedMin, 1);
    return selected < effectiveMin;
  }
  return false;
}

export function hasInvalidConditionalCostExplicitTargets(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  preSelectedIds: readonly string[] | undefined,
  sourceDefinition?: CardDefinition,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile
): boolean {
  if (!preSelectedIds || preSelectedIds.length === 0) return false;
  const target = getActionTargetSpec(action);
  if (!target || target.kind !== "filter") return false;

  const validationTarget: TargetSpec = { ...target, count: "all" };
  // P3-14 A-7: メイン解決 (resolveTargets) と同じ overrideKind を渡し、合体ブレイヴ等の
  // BP破壊上限+N (effect_param_modify) を検証経路でも適用する。これを欠くと候補列挙・
  // メイン解決では合法な事前選択対象が、素の閾値で「対象不足」と誤判定されロールバックする。
  const overrideKind = deriveParamOverrideActionKind(action);
  const sourceAttachedChildrenOnly =
    targetRequiresSourceAttachedChildren(action);
  const validIds = new Set(
    resolveTargetSpec({
      state,
      targetSpec: validationTarget,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepContext: stepCtx,
      ...(sourceDefinition ? { sourceDefinition } : {}),
      ...(overrideKind ? { paramOverrideActionKind: overrideKind } : {}),
      ...(sourceTargetLockBypass !== undefined &&
      sourceTargetLockBypass.kind !== "none"
        ? {
            bypassSpecialNexusTargetLock: true,
            ignoreCategoryExclusion:
              sourceTargetLockBypass.kind === "all_effects",
          }
        : {}),
      ...(sourceAttachedChildrenOnly
        ? { sourceAttachedChildrenOnly: true }
        : {}),
      ...(sourceAttachedChildrenOnly
        ? { starGarmentTargetEligibleOnly: true }
        : {}),
      ...runtimeCardFilterEvaluators(state, getCardDefinitionById),
    }).map((card) => card.instanceId)
  );
  return preSelectedIds.some((id) => !validIds.has(id));
}

export function getActionTargetSpec(action: Action): TargetSpec | undefined {
  switch (action.kind) {
    case "reveal_hand":
    case "turn_face_down":
      return action.target;
    case "destroy":
    case "vanish":
    case "suppress_pending_leave_effects":
    case "bp_compare_destroy":
    case "designate_attack":
    case "bounce":
    case "send_to_deck":
    case "remove_from_game":
    case "recover":
    case "exhaust":
    case "prevent_next_recovery":
    case "set_exhaust_state":
    case "stay_on_field":
    case "bp_modify":
    case "symbol_add":
    case "under_card_slot_capacity_grant":
    case "under_card_role_grant":
    case "under_card_trigger_inherit":
    case "override_properties":
    case "prevent_battle":
    case "require_battle_cost":
    case "require_attack_exhaust_cost":
    case "require_battle_destroy_cost":
    case "unblockable":
    case "allow_block_while_exhausted":
    case "allow_attack_while_exhausted":
    case "allow_tapless_battle_declare":
    case "block_unblockable":
    case "effect_immunity":
    case "effect_resistance":
    case "suppress_effect":
    case "register_act_as_spirit":
    case "grant_effect":
    case "grant_paid_prevention_immunity":
    case "grant_paid_leave_suppression_immunity":
    case "place_star_garment":
    case "swap_star_garment":
    case "bullet_edit":
    case "swap_bullet_edit":
      return action.target;
    case "core_move":
      // 単一対象コアシュート（target?: 指定時のみ）。未指定 core_move は従来どおり
      // 対象選択を経由しない（field コアシュートは from.filter 側が担う）。
      return action.target;
    case "rebirth":
      // 外部転醒（action.target 指定時のみ）。未指定 rebirth は従来どおり
      // sourceInstanceId 自身を flip するため対象選択を経由しない。
      // BSSA01-XX01 神技4「夜錆の転醒前1つの【転醒】を発揮する」型で使用。
      return action.target;
    case "cost_modify":
    case "restrict_recovery":
      return action.target; // undefined when player-based
    case "life_damage_interception":
      // attackerSelectedTarget 型のみ target を持つ（指定なしは対象選択を経ない）。
      return action.target;
    case "move_card":
      return action.target;
    case "search_zone":
      return action.target;
    case "borrow_magic_effect":
      // 借用元カード1枚の選択。structured-effect-registrations.getActionTarget と
      // SSOT を揃える。
      return action.target;
    case "borrow_card_event_effect":
      // card_event 効果借用の借用元カード1枚の選択。
      return action.target;
    case "core_distribute":
      // コア配置の to:TargetSpec を対象選択経路に expose
      // ({min,max} 型の「N体まで」可変選択 / 候補>N の player choice 化)。
      // structured-effect-registrations.getActionTarget と SSOT を揃える。
      return action.to;
    case "core_set_to_level":
      return action.target;
    case "discard_set_burst":
    case "discard":
      return action.target;
    case "replace_attack_declaration":
      // 新アタッカー候補の選択のみ対象選択パイプラインを経由する。forcedBlocker は
      // handler 内で resolveTargetSpec により直接解決する (redirect_target の to と同様)。
      return action.target;
    case "brave_combine_effect":
      // 合体先候補（自分のスピリット/アルティメット）。braveCombineHostOnly 絞り込みは
      // resolveTargetSpec / getCandidateTargetInstanceIds 側で自動適用する
      // (targetRequiresBraveCombineHostEligibility)。
      return action.target;
    case "brave_separate_effect":
      // 分離対象（合体中のブレイヴ1体）。brave_combine_effect と異なり合体条件の
      // 再検査は不要なため、TargetSpec.filter の静的宣言 (combined:true 等) のみで足りる。
      return action.target;
    case "noop":
      // 選択専用 step（ENGINE-brave-combine-third-party-target）。target 指定時のみ
      // 対象選択を経由し、後続 step が {kind:"ref"} で参照できるよう StepResult に記録される。
      return action.target;
    case "quartz_set":
      // クォーツとしてセットするカード1枚の選択（host/スロットは quartz-system.ts 側で自動解決）。
      return action.target;
    case "set_burst":
    case "set_self_as_mirage":
      // ENGINE-mirage-set-target-primitive: target 省略時は発揮元カード自身（従来通り）。
      // 指定時のみ他カードをコストなしミラージュセットの対象にできる。
      return action.target;
    case "advent":
      // ENGINE-effect-triggered-advent-declare: 煌臨させるカード1枚の選択（zone: "hand" | "trash"
      // + cardName フィルタ）。host は常に sourceInstanceId 固定のため対象選択を経由しない。
      return action.target;
    default:
      return undefined;
  }
}

export function targetRequiresSourceAttachedChildren(action: Action): boolean {
  return (
    action.kind === "place_star_garment" || action.kind === "swap_star_garment"
  );
}

/**
 * ENGINE-bsft01-tr-rebirth-brave-combine-branch: brave_combine_effect の合体先候補は
 * 発動元カード自身の braveCondition/maxCombinedBraves/cannot_combine 制約で絞り込む必要がある。
 * card-data 側で braveCondition を再宣言させない（SSOT: 発動元定義から自動導出）ため、
 * TargetSpec.filter の静的宣言ではなく action.kind から導出するフラグとして扱う
 * (targetRequiresSourceAttachedChildren と同じ設計)。
 */
export function targetRequiresBraveCombineHostEligibility(
  action: Action
): boolean {
  return action.kind === "brave_combine_effect";
}

/**
 * ENGINE-brave-combine-third-party-target: `brave_combine_effect.source` (前段 step の ref)
 * が指定されているとき、そのブレイヴの定義を解決する。合体先候補 (host) の braveCondition/
 * maxCombinedBraves 絞り込みは本来「合体元ブレイヴ自身の定義」を基準にする必要があるが、
 * `source` 省略時 (既存 BSFT01 系) は sourceInstanceId 自身がブレイヴのため、呼び出し側が
 * 従来どおり sourceDefinition をそのまま使えば良い（この関数は undefined を返す）。
 * `source` 指定時は前段 step の StepResult から実際のブレイヴ instance を特定し、その定義を返す。
 * 参照先が未解決/対象が存在しない場合は undefined（呼び出し側は候補 0 件として扱う）。
 */
export function resolveBraveCombineIncomingBraveDefinition(
  action: Action,
  state: GameState,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  if (action.kind !== "brave_combine_effect" || !action.source) {
    return undefined;
  }
  const result = getStepResult(stepCtx, action.source.stepId);
  const braveInstanceId = result?.affectedCardInstanceIds?.[0];
  if (!braveInstanceId) return undefined;
  const brave = getCardById(state, braveInstanceId);
  return brave ? getCardDefinitionById(brave.definitionId) : undefined;
}

export function resolveBraveCombineIncomingBraveInstanceId(
  action: Action,
  stepCtx: StepExecutionContext
): string | undefined {
  if (action.kind !== "brave_combine_effect" || !action.source) {
    return undefined;
  }
  const result = getStepResult(stepCtx, action.source.stepId);
  return result?.affectedCardInstanceIds?.[0];
}

/**
 * brave_separate_effect の分離対象候補は「分離後、維持コア (Lv1 requiredCores) を
 * 補填できるブレイヴ」だけに絞る (adversarial verifier round1 refute 対応)。
 * 未絞り込みだと moveNormalCoresForBraveSeparation の無条件 throw が対象解決を
 * すり抜けて未捕捉例外になる (getAvailableBraveSeparateLegalActions の GUI 経路と
 * 同じガードを効果発動経路にも適用する、targetRequiresBraveCombineHostEligibility と同じ設計)。
 */
export function targetRequiresBraveSeparationSolvency(action: Action): boolean {
  return action.kind === "brave_separate_effect";
}

export function selectSequentialActionTargets(
  targetInstanceIds: readonly string[],
  consumedTargetIndexes: ReadonlySet<number>,
  count: number,
  action: Action,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  fallbackCursor: number,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile
): { ids: string[]; indexes: number[] } {
  if (count <= 0) return { ids: [], indexes: [] };
  const targetSpec = getActionTargetSpec(action);
  if (!targetSpec) {
    const selected = targetInstanceIds
      .map((id, index) => ({ id, index }))
      .filter(({ index }) => !consumedTargetIndexes.has(index))
      .slice(fallbackCursor, fallbackCursor + count);
    return {
      ids: selected.map(({ id }) => id),
      indexes: selected.map(({ index }) => index),
    };
  }

  // P3-14 A-7: メイン解決と同じ overrideKind を渡し、検証経路でも BP破壊上限+N を適用する。
  const overrideKind = deriveParamOverrideActionKind(action);
  const sourceAttachedChildrenOnly =
    targetRequiresSourceAttachedChildren(action);
  const braveCombineHostOnly =
    targetRequiresBraveCombineHostEligibility(action);
  const braveSeparationSolvencyOnly =
    targetRequiresBraveSeparationSolvency(action);
  const braveCombineIncomingBraveDefinition = braveCombineHostOnly
    ? resolveBraveCombineIncomingBraveDefinition(
        action,
        state,
        stepCtx,
        getCardDefinitionById
      )
    : undefined;
  const braveCombineIncomingBraveInstanceId = braveCombineHostOnly
    ? (resolveBraveCombineIncomingBraveInstanceId(action, stepCtx) ??
      sourceInstanceId)
    : undefined;
  const validIds = new Set(
    resolveTargetSpec({
      state,
      targetSpec:
        targetSpec.kind === "filter"
          ? { ...targetSpec, count: "all" }
          : targetSpec,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepContext: stepCtx,
      ...(overrideKind ? { paramOverrideActionKind: overrideKind } : {}),
      ...(sourceTargetLockBypass !== undefined &&
      sourceTargetLockBypass.kind !== "none"
        ? {
            bypassSpecialNexusTargetLock: true,
            ignoreCategoryExclusion:
              sourceTargetLockBypass.kind === "all_effects",
          }
        : {}),
      ...(sourceAttachedChildrenOnly
        ? { sourceAttachedChildrenOnly: true }
        : {}),
      ...(sourceAttachedChildrenOnly
        ? { starGarmentTargetEligibleOnly: true }
        : {}),
      ...(braveCombineHostOnly ? { braveCombineHostOnly: true } : {}),
      ...(braveCombineIncomingBraveDefinition
        ? { braveCombineIncomingBraveDefinition }
        : {}),
      ...(braveCombineIncomingBraveInstanceId
        ? { braveCombineIncomingBraveInstanceId }
        : {}),
      ...(braveSeparationSolvencyOnly
        ? { braveSeparationSolvencyOnly: true }
        : {}),
      ...runtimeCardFilterEvaluators(state, getCardDefinitionById),
    }).map((card) => card.instanceId)
  );
  const selected = targetInstanceIds
    .map((id, index) => ({ id, index }))
    .filter(
      ({ id, index }) => !consumedTargetIndexes.has(index) && validIds.has(id)
    );
  if (selected.length < count) {
    throw new Error(
      `Sequential target selection is missing required target(s): action=${action.kind} required=${count} selected=${selected.length}`
    );
  }
  const slice = selected.slice(0, count);
  return {
    ids: slice.map(({ id }) => id),
    indexes: slice.map(({ index }) => index),
  };
}

export interface GroupedTargetAllocationByStep {
  idsByStepId: Map<string, string[]>;
  indexesByStepId: Map<string, number[]>;
  groupIndexByTargetIndex: Map<number, number>;
}

export function allocateGroupedTargetsByStep(options: {
  targetInstanceIds: readonly string[];
  targetGroups: readonly PendingEffectTargetGroup[];
  allowDuplicateTargets?: boolean;
}): GroupedTargetAllocationByStep {
  const idsByStepId = new Map<string, string[]>();
  const indexesByStepId = new Map<string, number[]>();
  const groupIndexByTargetIndex = new Map<number, number>();

  const groupCounts = Array.from(
    { length: options.targetGroups.length },
    () => 0
  );
  const assignedGroupIndexes: number[] = [];

  const canAssignRemainingRequired = (nextTargetIndex: number): boolean => {
    for (
      let groupIndex = 0;
      groupIndex < options.targetGroups.length;
      groupIndex++
    ) {
      const group = options.targetGroups[groupIndex]!;
      const requiredRemaining =
        group.requiredTargetCount - groupCounts[groupIndex]!;
      if (requiredRemaining <= 0) continue;
      let available = 0;
      for (
        let targetIndex = nextTargetIndex;
        targetIndex < options.targetInstanceIds.length;
        targetIndex++
      ) {
        if (
          group.candidateTargetInstanceIds.includes(
            options.targetInstanceIds[targetIndex]!
          )
        ) {
          available++;
        }
      }
      if (available < requiredRemaining) return false;
    }
    return true;
  };

  const assignTarget = (targetIndex: number): boolean => {
    if (targetIndex >= options.targetInstanceIds.length) {
      return options.targetGroups.every(
        (group, groupIndex) =>
          groupCounts[groupIndex]! >= group.requiredTargetCount
      );
    }
    const targetId = options.targetInstanceIds[targetIndex]!;
    const candidateGroupIndexes = options.targetGroups
      .map((group, groupIndex) => ({ group, groupIndex }))
      .filter(({ group, groupIndex }) => {
        const maxTargetCount =
          group.maxTargetCount ?? group.requiredTargetCount;
        return (
          groupCounts[groupIndex]! < maxTargetCount &&
          group.candidateTargetInstanceIds.includes(targetId)
        );
      })
      .sort((a, b) => {
        const aRequiredRemaining =
          a.group.requiredTargetCount - groupCounts[a.groupIndex]!;
        const bRequiredRemaining =
          b.group.requiredTargetCount - groupCounts[b.groupIndex]!;
        const requiredDelta =
          (bRequiredRemaining > 0 ? 1 : 0) - (aRequiredRemaining > 0 ? 1 : 0);
        if (requiredDelta !== 0) return requiredDelta;
        const candidateDelta =
          a.group.candidateTargetInstanceIds.length -
          b.group.candidateTargetInstanceIds.length;
        if (candidateDelta !== 0) return candidateDelta;
        return a.groupIndex - b.groupIndex;
      });

    for (const { groupIndex } of candidateGroupIndexes) {
      assignedGroupIndexes[targetIndex] = groupIndex;
      groupCounts[groupIndex] = groupCounts[groupIndex]! + 1;
      if (
        canAssignRemainingRequired(targetIndex + 1) &&
        assignTarget(targetIndex + 1)
      ) {
        return true;
      }
      groupCounts[groupIndex] = groupCounts[groupIndex]! - 1;
      assignedGroupIndexes.pop();
    }
    return false;
  };

  if (!assignTarget(0)) {
    throw new Error("Grouped target allocation could not satisfy targetGroups");
  }

  for (
    let targetIndex = 0;
    targetIndex < options.targetInstanceIds.length;
    targetIndex++
  ) {
    const groupIndex = assignedGroupIndexes[targetIndex];
    if (groupIndex === undefined) continue;
    groupIndexByTargetIndex.set(targetIndex, groupIndex);
    const group = options.targetGroups[groupIndex]!;
    if (!group.targetStepId) continue;
    const currentIds = idsByStepId.get(group.targetStepId) ?? [];
    currentIds.push(options.targetInstanceIds[targetIndex]!);
    idsByStepId.set(group.targetStepId, currentIds);
    const currentIndexes = indexesByStepId.get(group.targetStepId) ?? [];
    currentIndexes.push(targetIndex);
    indexesByStepId.set(group.targetStepId, currentIndexes);
  }

  for (const group of options.targetGroups) {
    if (group.targetStepId && !idsByStepId.has(group.targetStepId)) {
      idsByStepId.set(group.targetStepId, []);
      indexesByStepId.set(group.targetStepId, []);
    }
  }

  return { idsByStepId, indexesByStepId, groupIndexByTargetIndex };
}

export function allocateGroupedTargetIdsByStep(options: {
  targetInstanceIds: readonly string[];
  targetGroups: readonly PendingEffectTargetGroup[];
  allowDuplicateTargets?: boolean;
}): Map<string, string[]> {
  return allocateGroupedTargetsByStep(options).idsByStepId;
}

export function getExplicitTargetCountForAction(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  stepContext: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | null {
  const target = getActionTargetSpec(action);
  if (!target || target.kind !== "filter") return null;
  const count = resolveCount(
    target.count,
    state,
    actingPlayerId,
    stepContext,
    getCardDefinitionById
  );
  return count >= 0 ? count : null;
}

// ============================================================
// TargetSpec → v1 EffectTarget 変換
// ============================================================

/**
 * DSL TargetSpec を v1 EffectTarget に変換する。
 *
 * `paramOverrideContext` を渡すと、destroy/vanish/bounce 等のフィルタに対して
 * `effect_param_override` CE による delta (`maxBp` / `maxCost` / `category` 拡張)
 * を反映した EffectTarget を返す (P3-14 A-7)。
 */
/**
 * EffectTarget へ畳み込む直前に、動的自己閾値ソース
 * (maxBpSource / maxCostSource / maxCoresSource) を効果発動元の値で具体化する。
 *
 * 三系統あるターゲット解決経路 (resolveTargetSpec / 候補列挙 / resolveTargetCards の
 * 自動選択) のうち、EffectTarget の静的フィールドを読む候補収集経路でも
 * 閾値が効くようにするためのブリッジ。値の写像・filterOr 再帰はすべて card-filter.ts の
 * SSOT ヘルパー (resolveDynamicThresholdsInFilter) に委譲する。源が場外などで値不明なら
 * fail-closed (閾値 0 = 対象 0) に倒す。
 */
export function resolveSelfThresholdSourcesForEffectTarget(
  filter: CardFilter,
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): CardFilter {
  const sourceCard: CardInstance | undefined = resolveSelfReferenceCard(
    state,
    sourceInstanceId
  );
  const sourceDef = sourceCard
    ? getCardDefinitionById?.(sourceCard.definitionId)
    : undefined;
  const bp =
    sourceCard && sourceDef && getCardDefinitionById
      ? getCombinedUnitBp(state, sourceCard, sourceDef, getCardDefinitionById)
      : undefined;
  const costOptions =
    sourceCard && sourceDef
      ? getCombinedUnitCostFilterOptions(
          state,
          sourceCard,
          sourceDef,
          getCardDefinitionById
        )
      : undefined;

  return resolveDynamicThresholdsInFilter(filter, {
    effectiveBp: bp,
    sourceCost: costOptions?.effectiveCost,
    additionalCosts: costOptions?.additionalCosts,
    countValue: getSelfCountThresholdValue(state, sourceCard, sourceDef),
  });
}

export function convertTargetSpecToEffectTarget(
  target: TargetSpec,
  paramOverrideContext?: {
    state: GameState;
    sourceInstanceId: string;
    actionKind?: "destroy" | "vanish" | "bounce" | "prevent_battle" | "exhaust";
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): EffectTarget {
  switch (target.kind) {
    case "self":
    case "source_card":
      return { selfCard: true, player: "self", count: 1 };

    case "filter": {
      let effectiveFilter = target.filter;
      if (paramOverrideContext?.actionKind) {
        const effectClass = deriveEffectParamOverrideClass(
          paramOverrideContext.actionKind,
          target.filter
        );
        if (effectClass !== null) {
          effectiveFilter = applyEffectParamOverridesToFilter(
            target.filter,
            effectClass,
            paramOverrideContext.sourceInstanceId,
            paramOverrideContext.state,
            paramOverrideContext.getCardDefinitionById
          );
        }
      }
      if (paramOverrideContext) {
        // 動的自己閾値ソース (maxBpSource / maxCostSource / maxCoresSource) を
        // ここで具体値へ解決する。preSelectedIds が無い自動解決経路
        // (executeDestroy / executeSendToDeck 等 → resolveTargetCards →
        // collectTargetCardCandidates) は EffectTarget の静的 maxBp/maxCost/maxCores
        // しか読まないため、ソース指定を残すと閾値フィルタが脱落する。
        // effect_param_override 適用は actionKind 付き経路だけだが、閾値解決は
        // context があれば action kind に依存せず card-filter.ts の SSOT へ委譲する。
        effectiveFilter = resolveSelfThresholdSourcesForEffectTarget(
          effectiveFilter,
          paramOverrideContext.state,
          paramOverrideContext.sourceInstanceId,
          paramOverrideContext.getCardDefinitionById
        );
      }
      return {
        player: target.player as EffectPlayerRef,
        filter: effectiveFilter,
        // preSelectedIds が無い自動解決 (AI / 空撃ち / max=0) 時の既定対象数。
        // resolveCount の規約 (「{ min, max } → min（自動選択時）」, target-resolution.ts)
        // に合わせ、可変選択は静的 min を採用する。動的 min はここでは盤面文脈が無いため
        // 1 に縮退 (実害は no-pending 経路のみ。pending 生成時は preSelectedIds が優先)。
        count:
          typeof target.count === "number"
            ? target.count
            : target.count === "all"
              ? -1
              : typeof target.count === "object" &&
                  target.count !== null &&
                  "min" in target.count &&
                  typeof target.count.min === "number"
                ? target.count.min
                : 1,
        // EffectTarget の同名フラット化フィールド (category/colors/tribes/... 等) は
        // CardFilter を丸ごと素のスプレッドで写す (guard-audit-card-filter-projection、
        // 2026-08-05 subset-type-unification)。旧実装はフィールド別 allowlist コピーで、
        // tribesRequired 等の新フィールドが黙って脱落していた。これらのフラット化
        // フィールドは `filter` (CardFilter 全体) と別に、structured-cost-gate.ts /
        // structured-modifiers.ts / structured-state-grants.ts が `.filter` にフォール
        // バックせず直接読むため、削除ではなく維持する (dead code ではない)。
        ...effectiveFilter,
        ...(effectiveFilter.soulState === "include"
          ? { includeSoulState: true }
          : {}),
        ...(effectiveFilter.targetsGrandwalker
          ? { includeGrandwalker: true }
          : {}),
        // CardFilter.targetsGrandwalker:"only" は inclusion に加えて exclusivity を要求する。
        // includeGrandwalker:true で grandwalker は admit され、grandwalkerOnly:true で
        // 非 grandwalker (通常 spirit/nexus) を排除する (verifier 2026-06-23 round 8 lens 2)。
        ...(effectiveFilter.targetsGrandwalker === "only"
          ? { grandwalkerOnly: true }
          : {}),
        ...(effectiveFilter.targetsGrandstone
          ? { includeGrandstone: true }
          : {}),
        ...(target.zone
          ? { zone: Array.isArray(target.zone) ? target.zone : [target.zone] }
          : {}),
      };
    }

    case "ref":
      // ref は pre-resolved IDs で渡されるため、ダミーのターゲットを返す。count は -1（"all"）
      // にしない: effect_resistance/effect_immunity の CE 登録は count===-1 を「再評価する
      // 動的 filter」の合図として使うため、-1 のままだと ref で凍結したはずの特定 instanceId
      // 集合が「フィルタ再一致する全カード」へ意図せず拡大してしまう
      // (engine-token-summon-primitive, BSSL01-C06 で顕在化)。preSelectedIds が渡された経路は
      // count 値に関わらず最優先で解決されるため、-1 以外の値なら何でもよい。
      return { selfCard: false, player: "self", count: 1 };

    case "trigger_related_instance":
      // 主語 Y は resolveTargetSpec が stepContext.triggerRelatedInstanceId から
      // 1 体だけ動的に解決する。v1 EffectTarget 経路には載せないためダミーで返す。
      return { selfCard: false, player: "self", count: 1 };

    case "trigger_related_combined_host":
      // 主語 Y の合体先 host は resolveTargetSpec が動的に解決する。
      return { selfCard: false, player: "self", count: 1 };

    case "trigger_related_instances":
      return { selfCard: false, player: "self", count: -1 };

    case "pending_leave_caused_by_effect_source":
      // pre-resolved IDs (resolveTargetSpec) で渡されるため、ダミーのターゲットを返す。
      return { selfCard: false, player: "self", count: -1 };
  }
}

export function isDynamicBpModifyTargetSpecEligible(
  target: TargetSpec
): boolean {
  if (target.kind !== "filter") return false;
  if (target.count !== "all" && target.count !== -1) return false;
  if (target.player !== "self" && target.player !== "opponent") return false;
  if (
    target.excludeSelf === true ||
    target.zone !== undefined ||
    target.budget !== undefined
  ) {
    return false;
  }
  const eligibleFilter = (filter: CardFilter): boolean =>
    Object.keys(filter).every(
      (key) =>
        [
          "category",
          "colors",
          "tribes",
          "tribesRequired",
          "tribesLogic",
          "noTribes",
          "cardName",
          "targetsGrandwalker",
        ].includes(key) ||
        (key === "filterOr" && (filter.filterOr ?? []).every(eligibleFilter))
    );
  return eligibleFilter(target.filter ?? {});
}

// ============================================================
// CoreLocation → v1 EffectCoreLocation 変換
// ============================================================

/**
 * 単一対象コアシュート用: `target_card` コアロケーション (源 from もしくは移動先 to) を、
 * 解決済みの対象1体 (resolvedTargetIds[0]) を指す `card_instance` へ束ねる。
 * 対象未確定 / target_card 以外はそのまま返す。
 *
 * - 源 (from): 「相手1体のコアを…」型 (BSSL01-C05 等)。
 * - 移動先 (to): 「相手のコアを相手のスピリット1体に置く」型 (BSKB01-CX01 等)。
 *   置いた対象を後続の `{ kind: "ref" }` で参照し BP比べ破壊に繋げられる。
 */
/**
 * `CoreLocation` (DSL 生値) → `EffectCoreLocation` 変換の SSOT 入口。
 * `kind: "ref"` (同一効果内の先行 step で移動/配置したカードをコア移動先/元にする、
 * BSAZ02-X03「デッキ1枚を裏向きでフィールドに置き、ボイドからコア1個を置く」等) を
 * `stepCtx` の step 結果 (`affectedCardInstanceIds` の先頭1件) で `card_instance` へ解決する。
 * `convertCoreLocation` 単体 (状態非依存の pure 変換) は `ref` を解決できず `this_card`
 * にフォールバックする (発動元カード自身へ誤って移動する) ため、state 依存の解決が必要な
 * 呼び出し元 (native-action-registry.ts core_move ハンドラ) は本関数を経由する。
 * `ref` 以外は従来どおり `convertCoreLocation` → `resolveTargetCardCoreLocation` に委譲する。
 * `targetIndex` (省略時 0): 複数対象コアシュート (engine-coreshoot-multi-target-void) で
 * `resolvedTargetIds` の何番目を束ねるか。呼び出し元が対象ごとにループする前提。
 */
export function resolveCoreLocationForStep(
  loc: CoreLocation,
  stepCtx: StepExecutionContext,
  resolvedTargetIds?: string[],
  targetIndex = 0
): EffectCoreLocation {
  if (loc.kind === "union") {
    return {
      kind: "union",
      sources: loc.sources.map((source) =>
        resolveCoreLocationForStep(
          source,
          stepCtx,
          resolvedTargetIds,
          targetIndex
        )
      ),
    };
  }
  if (loc.kind === "ref") {
    const result = getStepResult(stepCtx, loc.stepId);
    const instanceId = result?.affectedCardInstanceIds?.[0];
    if (instanceId) return { kind: "card_instance", instanceId };
  }
  return resolveTargetCardCoreLocation(
    convertCoreLocation(loc),
    resolvedTargetIds,
    targetIndex
  );
}

/**
 * `targetIndex` (省略時 0、既存呼び出しは全て resolvedTargetIds[0] のまま非破壊)。
 * 複数対象コアシュートの呼び出し元は対象ごとに index を進めてループする。
 */
export function resolveTargetCardCoreLocation(
  loc: EffectCoreLocation,
  resolvedTargetIds?: string[],
  targetIndex = 0
): EffectCoreLocation {
  if (loc.kind === "target_card" && resolvedTargetIds?.[targetIndex]) {
    return {
      kind: "card_instance",
      instanceId: resolvedTargetIds[targetIndex],
    };
  }
  return loc;
}

// ============================================================
// Count / Amount ヘルパー
// ============================================================

export function resolveAmountToNumber(
  amount: Amount,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  return resolveAmount(
    amount,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
}

// ============================================================
// 影響カード検出
// ============================================================

export function detectAffectedCards(
  preSet: Set<string>,
  postSet: Set<string>,
  state: GameState,
  resolvedTargetIds?: string[]
): string[] {
  // ターゲット指定がある場合はそれを返す
  if (resolvedTargetIds && resolvedTargetIds.length > 0) {
    return resolvedTargetIds;
  }
  // ゾーン変更があったカードを検出（既存 instanceId の zone 変化）+
  // 新規生成された instanceId（token-summon 等、preSet 時点で存在しなかったカード）。
  // instanceId は単調増加で使い回されない（cardInstances は要素を削除しない）ため、
  // 新規追加分を対称差分で拾っても既存カードの検出結果に影響しない。
  const affected: string[] = [];
  const seen = new Set<string>();
  for (const entry of preSet) {
    if (!postSet.has(entry)) {
      const id = entry.split(":")[0]!;
      if (!seen.has(id)) {
        seen.add(id);
        affected.push(id);
      }
    }
  }
  for (const entry of postSet) {
    if (!preSet.has(entry)) {
      const id = entry.split(":")[0]!;
      if (!seen.has(id)) {
        seen.add(id);
        affected.push(id);
      }
    }
  }
  return affected;
}

export function resolveNegateStepAffectedCardIds(options: {
  action: Extract<Action, { kind: "negate" }>;
  state: GameState;
  candidate: ActiveStack | null | undefined;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceCard?: CardInstance | undefined;
  sourceDefinition?: CardDefinition | undefined;
}): string[] {
  const candidate = options.candidate;
  if (!candidate || candidate.isNullified === true) return [];
  const request: StackNegateActionLike = {
    negateTarget: options.action.negateTarget,
    ...(options.action.targetFilter !== undefined
      ? { targetFilter: options.action.targetFilter }
      : {}),
    ...(options.action.targetController !== undefined
      ? { targetController: options.action.targetController }
      : {}),
    ...(options.action.targetEffectTiming !== undefined
      ? { targetEffectTiming: options.action.targetEffectTiming }
      : {}),
    ...(options.action.targetEffectFilter !== undefined
      ? { targetEffectFilter: options.action.targetEffectFilter }
      : {}),
  };
  if (
    !stackMatchesNegateAction({
      state: options.state,
      stack: candidate,
      request,
      actingPlayerId: options.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceCard: options.sourceCard,
      sourceDefinition: options.sourceDefinition,
    })
  ) {
    return [];
  }
  return [candidate.cardInstanceId];
}

export function detectBpBecameZeroTransitions(
  pre: GameState,
  post: GameState,
  targetInstanceIds: readonly string[] | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  if (!targetInstanceIds || targetInstanceIds.length === 0) return [];
  return targetInstanceIds.filter((id) => {
    const preCard = getCardById(pre, id);
    const postCard = getCardById(post, id);
    if (!preCard || !postCard) return false;
    const preDef = getCardDefinitionById(preCard.definitionId);
    const postDef = getCardDefinitionById(postCard.definitionId);
    return (
      getCombinedUnitBp(pre, preCard, preDef, getCardDefinitionById) > 0 &&
      getCombinedUnitBp(post, postCard, postDef, getCardDefinitionById) <= 0
    );
  });
}

export function dedupePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
