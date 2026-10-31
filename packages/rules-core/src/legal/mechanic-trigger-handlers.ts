import { recordSemanticTriggerEvent } from "../effect/semantic-trigger-events";
import { trackPendingLeaveReactionChain } from "../state-based-actions";
// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import { openEffectDeclarationStackWindow } from "./legal-actions-apply";
import {
  canActivateDivineSkillEffect,
  canDeclareDivineSkillEffect,
  deriveDivineSkillSuppressionEffectDescriptor,
  getDivineSkillUsageKey,
} from "./divine-skill-usage";
import { canActivateNexusMechanicEffect } from "../mechanics/nexus-mechanic-suppression";
import type { DeferredStackResolverOptions } from "./stack-resolution-types";

import {
  resolveMagicStackDomainMechanic,
  resolveOracleMechanic,
  resolvePlacementOracleMechanic,
} from "../mechanics/oracle-system";
import {
  isSoulCoreOn,
  moveNormalCores,
  moveSoulCore,
  updateCard,
} from "../core/core-system";

import { finalizeEffectResolution } from "../effect/effect-resolution";
import {
  isLabeledStackEffectActivation,
  queueStackEffectUsedTriggers,
} from "../effect/trigger-system";

import type { ActiveStack, GameState, PendingTriggeredEffect } from "../model";

import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";

import type {
  ApplyLegalActionOptions,
  ApplyLegalActionResult,
  ResolveBraveCombineChoiceResult,
  ResolvePendingTriggeredEffectLegalAction,
} from "./legal-actions-types";
import type { ResolvePendingTriggeredEffectResult } from "../effect/trigger-system";
import { executeRebirth } from "../effect/structured-effect-interpreter";
import { applyRebirthCountBonus } from "../effect/structured-card-replacement";
import { resolveUnsealMechanic } from "../mechanics/grandstone-system";
import {
  splitCollectionGatedCondition,
  getGrantedTriggeredUsageOptions,
  isGrantedTriggeredUsageAvailable,
  canActivateGrantedEffect,
} from "../mechanics/grant-effect-system";

import { executeEffect } from "../effect/effect-interpreter";
import {
  getEffectiveColors,
  recordEffectUsageIfLimited,
  resolveDynamicStackNegatePreventionLevel,
} from "./legal-actions-shared";

import { getCardById } from "../card/card-lookup";
import { buildChargeCoresPendingCoreDistribution } from "../mechanics/core-charge-distribution";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { getValidBraveCombineHosts } from "./legal-actions-shared";
import { synthesizeBackFaceDefinition } from "../effect/structured-effect-registrations";

export function resolveMechanicTriggeredEffectCore(
  state: GameState,
  pendingEffect: PendingTriggeredEffect,
  accept: boolean,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  const mechanic = pendingEffect.mechanic!;
  const chainId = `trigger:${pendingEffect.pendingId}`;
  let resolvedState: GameState;
  switch (mechanic.kind) {
    case "oracle":
      resolvedState = resolveOracleMechanic(
        state,
        mechanic,
        pendingEffect.actingPlayerId,
        accept,
        options.getCardDefinitionById
      );
      break;
    case "placement_oracle":
      // 辞退（発揮しない）= デッキトラッシュを行わない。受諾でデッキ N 枚を
      // トラッシュ + コア配置の置く/置かない pending を立てる。
      if (!accept) {
        resolvedState = {
          ...state,
          log: [
            ...state.log,
            `[Oracle] ${pendingEffect.actingPlayerId} は配置時神託を発揮しない`,
          ],
        };
        break;
      }
      resolvedState = resolvePlacementOracleMechanic(
        state,
        mechanic,
        options.getCardDefinitionById
      );
      break;
    case "magic_stack_domain":
      resolvedState = resolveMagicStackDomainMechanic(
        state,
        mechanic,
        pendingEffect.actingPlayerId,
        accept,
        options.getCardDefinitionById
      );
      break;
    case "unseal":
      resolvedState = resolveUnsealMechanic(
        state,
        mechanic,
        pendingEffect.actingPlayerId,
        accept,
        options.getCardDefinitionById,
        chainId
      );
      break;
    case "stone_rebirth":
      resolvedState = resolveStoneRebirthMechanic(
        options,
        state,
        mechanic,
        pendingEffect.actingPlayerId,
        accept,
        chainId
      );
      break;
    case "granted_effect":
      resolvedState = resolveGrantedEffectMechanic(
        options,
        trackPendingLeaveReactionChain(state, pendingEffect, chainId),
        mechanic,
        pendingEffect.actingPlayerId,
        accept,
        pendingEffect.amount,
        chainId
      );
      break;
  }

  // 転醒・付与効果は各 resolver が固有の継続境界を確定する。
  // 神託・導域・解封も効果なので、CE 再計算だけで二次誘発を迂回しない。
  if (mechanic.kind !== "stone_rebirth" && mechanic.kind !== "granted_effect") {
    const sourceInstanceId =
      mechanic.kind === "unseal"
        ? mechanic.grandstoneInstanceId
        : mechanic.grandwalkerInstanceId;
    return finalizeEffectResolution({
      ...options,
      state: resolvedState,
      beforeState: state,
      chainId,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      endLogs: [],
      actingPlayerId: pendingEffect.actingPlayerId,
      causedBySourceInstanceId: sourceInstanceId,
      ...(pendingEffect.attackId !== null
        ? { battleEndDeferralAttackId: pendingEffect.attackId }
        : {}),
    });
  }
  return recomputeAndRebuildContinuousEffects(
    resolvedState,
    options.getCardDefinitionById
  );
}

/**
 * P3-99 §3: grant_effect で付与された誘発効果を解決する。
 *
 * 受諾で付与 CE（grantCeEffectId）の metadata.grantedEffect を引き、被付与カード
 * （grantee）を source として executeEffect で steps を実行 → finalizeEffectResolution
 * （SBA / CE 再計算 / 二次トリガー収集 / pending leave flush）。辞退は no-op。
 *
 * 付与効果は被付与カードの効果として発火する（発揮元のイベントではない）。CE が既に
 * 消えている（発揮元離脱で while_on_field 停止 / turn 満了）場合は no-op で drain。
 */
export function resolveGrantedEffectMechanic(
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >,
  state: GameState,
  mechanic: Extract<
    import("../model").TriggeredMechanic,
    { kind: "granted_effect" }
  >,
  actingPlayerId: string,
  accept: boolean,
  eventAmount: number | null | undefined,
  chainId: string
): GameState {
  if (!accept) {
    return {
      ...state,
      log: [
        ...state.log,
        `[GrantEffect] ${actingPlayerId} は付与された誘発効果を発揮しない`,
      ],
    };
  }

  const ce = state.activeContinuousEffects.find(
    (c) => c.effectId === mechanic.grantCeEffectId
  );
  const grantedEffect = ce?.metadata?.grantedEffect as
    | import("../dsl-types").Effect
    | undefined;
  const grantee = getCardById(state, mechanic.granteeInstanceId);
  const isTurnReservation = ce?.metadata?.turnReservation === true;
  if (
    !ce ||
    !grantedEffect ||
    !grantee ||
    (!isTurnReservation && grantee.zone !== "field")
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `[GrantEffect] 付与 CE / 被付与カードが不在のため発揮できない（no-op）`,
      ],
    };
  }

  if (
    !isGrantedTriggeredUsageAvailable(
      state,
      ce,
      grantee,
      options.getCardDefinitionById
    )
  )
    return state;
  const granteeDefinition = options.getCardDefinitionById(grantee.definitionId);
  const beforeState = state;
  state = recordEffectUsageIfLimited(
    getGrantedTriggeredUsageOptions(
      state,
      ce,
      grantee,
      options.getCardDefinitionById
    )
  );

  // スコープ条件（in_battle 等）は検出時（grant-effect-system, バトル reset 前）に評価済み。
  // 解決時はバトル reset 後で transient state が消えているため、再評価すると常に false に
  // なってしまう（『このスピリットのアタック時』バトル終了時型）。検出時ゲート済みの
  // スコープ条件を除外し、value 系条件のみ executeEffect で再評価する（SSOT:
  // splitCollectionGatedCondition）。
  const { rest: resolutionCondition } = splitCollectionGatedCondition(
    grantedEffect.condition
  );
  const grantedEffectForResolution: import("../dsl-types").Effect = {
    ...grantedEffect,
    condition: resolutionCondition,
  };

  let currentState = executeEffect({
    state,
    effect: grantedEffectForResolution,
    chainId,
    sourceInstanceId: mechanic.granteeInstanceId,
    actingPlayerId,
    ...(eventAmount != null ? { eventAmount } : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
  });

  currentState = finalizeEffectResolution({
    state: currentState,
    beforeState,
    chainId,
    endLogs: [`[GrantEffect] ${actingPlayerId} が付与された誘発効果を発揮`],
    actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(currentState, grantee, granteeDefinition),
    causedBySourceInstanceId: mechanic.granteeInstanceId,
    enterFieldCausedByPlayerId: actingPlayerId,
  });

  return currentState;
}

/**
 * P3-99 起動権 variant: grant_effect で付与された「起動効果」の deferred 解決
 * (スタック窓クローズ後)。付与 CE.metadata.grantedEffect を被付与カード (grantee =
 * resolvedStack.cardInstanceId) を source として executeEffect + finalizeEffectResolution
 * で実行する。誘発 variant の resolveGrantedEffectMechanic と同じ実行核を、能動発揮
 * (legal action 起点) のスタック解決経路向けに切り出したもの。
 *
 * CE 消失 (発揮元離脱で while_on_field 停止 / turn 満了) / grantee 離脱は no-op。
 * usageLimit は宣言時 (apply) に CE スコープで消費済みのため、ここでは消費しない。
 */
export function resolveDeferredGrantedActivatedEffectStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  const grantCeId = resolvedStack.grantedEffectCeId;
  const ce = state.activeContinuousEffects.find(
    (c) => c.effectId === grantCeId
  );
  const grantedEffect = ce?.metadata?.grantedEffect as
    | import("../dsl-types").Effect
    | undefined;
  const grantee = getCardById(state, resolvedStack.cardInstanceId);
  if (!ce || !grantedEffect || !grantee || grantee.zone !== "field") {
    return {
      ...state,
      log: [
        ...state.log,
        `[GrantEffect] 付与起動効果の CE / 被付与カードが不在のため発揮できない（no-op）`,
      ],
    };
  }

  if (resolvedStack.isNullified) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:nullified:${resolvedStack.chainId}:${resolvedStack.cardInstanceId}`,
      ],
    };
  }

  const granteeDefinition = options.getCardDefinitionById(grantee.definitionId);
  const beforeState = state;

  if (
    !canActivateGrantedEffect(state, ce, grantee, options.getCardDefinitionById)
  )
    return state;

  let currentState = executeEffect({
    state,
    effect: grantedEffect,
    chainId: resolvedStack.chainId,
    sourceInstanceId: resolvedStack.cardInstanceId,
    actingPlayerId: resolvedStack.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
  });

  currentState = finalizeEffectResolution({
    state: currentState,
    beforeState,
    chainId: resolvedStack.chainId,
    endLogs: [
      `[GrantEffect] ${resolvedStack.actingPlayerId} が付与された起動効果を発揮`,
    ],
    actingPlayerId: resolvedStack.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(currentState, grantee, granteeDefinition),
    causedBySourceInstanceId: resolvedStack.cardInstanceId,
    enterFieldCausedByPlayerId: resolvedStack.actingPlayerId,
  });

  // ENGINE-stack-activation-reactivation-trigger: 付与された起動効果 (grant_effect の
  // grantedEffect) が見出しラベル位置の【スタック】タイミングで完全解決した後にも、
  // magic-system.ts / card-effect-system.ts の同型フックと同じ「相手がスタック効果を
  // 発揮したとき」誘発 (BSTH02.7-X01 effects[1]) を発火する。現状 mode:"stack" の
  // grantedEffect を持つ shipped card は無いが、legal-actions-availability.ts が
  // grantedEffect.timing.mode==="stack" を明示的に legal action 化しており到達可能な
  // 経路のため、他 2 経路 (マジック/フィールドカード自身) と同じ扱いにする。P3-114:
  // activationLabel:"none"(本文中利用)は isLabeledStackEffectActivation で除外する。
  if (isLabeledStackEffectActivation(resolvedStack)) {
    return queueStackEffectUsedTriggers({
      chainId: resolvedStack.chainId,
      state: currentState,
      stackSourceInstanceId: resolvedStack.cardInstanceId,
      userPlayerId: resolvedStack.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  return currentState;
}

/**
 * P3-92: mechanic 付き誘発任意効果 (神託/解封/創界石転醒) の宣言を適用する。
 * skipOptionalEffect / skipOnly で辞退、それ以外で発揮宣言。
 *
 * - 辞退 = 「任意効果の不使用」: スタック窓は開かない（02:199）。同期で pending 除去のみ。
 * - 受諾 = 「常時以外の効果発揮」: スタック窓を開き（02:186 / P3-34 と同型）、
 *   窓クローズ後に resolveDeferredTriggeredEffectStack の mechanic 分岐で解決する。
 */
export function applyMechanicTriggeredEffect(
  options: ApplyLegalActionOptions,
  pendingEffect: PendingTriggeredEffect,
  action: ResolvePendingTriggeredEffectLegalAction
): ResolvePendingTriggeredEffectResult {
  const mechanic = pendingEffect.mechanic!;
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingTriggeredEffects: options.state.pendingTriggeredEffects.filter(
      (p) => p.pendingId !== action.pendingId
    ),
  };
  const accept = !(
    action.skipOnly === true ||
    (options.skipOptionalEffect && action.executionMode === "optional")
  );

  if (!accept) {
    const newState = resolveMechanicTriggeredEffectCore(
      stateWithoutPending,
      pendingEffect,
      false,
      options
    );
    return { state: newState, pendingId: action.pendingId, skipped: true };
  }

  // ソース消失 (通常は legal-actions が skipOnly 化するため到達しない防御):
  // 発揮できない効果は不発のため窓を開かず graceful no-op で drain する。
  const mechanicSourceInstanceId =
    mechanic.kind === "oracle" ||
    mechanic.kind === "placement_oracle" ||
    mechanic.kind === "magic_stack_domain"
      ? mechanic.grandwalkerInstanceId
      : mechanic.kind === "granted_effect"
        ? mechanic.granteeInstanceId
        : mechanic.grandstoneInstanceId;
  const sourceCard = getCardById(options.state, mechanicSourceInstanceId);
  const grantCe =
    mechanic.kind === "granted_effect"
      ? options.state.activeContinuousEffects.find(
          (ce) => ce.effectId === mechanic.grantCeEffectId
        )
      : undefined;
  if (
    !sourceCard ||
    sourceCard.zone !== "field" ||
    (mechanic.kind === "granted_effect" &&
      (!grantCe ||
        !canActivateGrantedEffect(
          options.state,
          grantCe,
          sourceCard,
          options.getCardDefinitionById
        ))) ||
    (mechanic.kind !== "granted_effect" &&
      !canActivateNexusMechanicEffect(
        options.state,
        mechanicSourceInstanceId,
        mechanic.kind,
        options.getCardDefinitionById
      ))
  ) {
    const newState = resolveMechanicTriggeredEffectCore(
      stateWithoutPending,
      pendingEffect,
      true,
      options
    );
    return { state: newState, pendingId: action.pendingId };
  }

  const triggeredChainId = `trigger:${pendingEffect.pendingId}`;
  const mechanicActiveStack: ActiveStack = {
    stackId: `stack:${triggeredChainId}`,
    actionKind: "triggered_effect",
    chainId: triggeredChainId,
    actingPlayerId: action.actingPlayerId,
    cardInstanceId: sourceCard.instanceId,
    cardDefinitionId: sourceCard.definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    triggeredPendingSnapshot: pendingEffect,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const stateAfterDeclaration: GameState = {
    ...trackPendingLeaveReactionChain(
      stateWithoutPending,
      pendingEffect,
      triggeredChainId
    ),
    log: [
      ...stateWithoutPending.log,
      `trigger:declared:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${action.actingPlayerId}`,
    ],
  };
  return {
    state: openEffectDeclarationStackWindow({
      baseState: options.state,
      stateAfterDeclaration,
      activeStack: mechanicActiveStack,
      actingPlayerId: action.actingPlayerId,
    }),
    pendingId: action.pendingId,
  };
}

export let divineSkillStackSequence = 0;

/**
 * 創界石の転醒（コア閾値到達）mechanic を解決する。
 * accept=false で裏返さない。受諾で:
 * 1. postRebirth があれば executeRebirth が仮想転醒 pending を立てる
 * 2. pending が無い場合のみ実 flip 済みとして finalizeEffectResolution へ進む
 * 3. pending 経路では選択確定時に実 flip + SBA + CE 再構築 + 『転醒時』トリガー収集 + flush
 */
export function resolveStoneRebirthMechanic(
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >,
  stateWithoutPending: GameState,
  mechanic: Extract<
    import("../model").TriggeredMechanic,
    { kind: "stone_rebirth" }
  >,
  actingPlayerId: string,
  accept: boolean,
  chainId: string
): GameState {
  let currentState = stateWithoutPending;

  if (!accept) {
    return {
      ...currentState,
      log: [
        ...currentState.log,
        `[StoneRebirth] ${actingPlayerId} は転醒を辞退`,
      ],
    };
  }

  const stone = getCardById(currentState, mechanic.grandstoneInstanceId);
  const def = stone
    ? options.getCardDefinitionById(stone.definitionId)
    : undefined;
  const data = def?.grandstoneData;
  if (
    !stone ||
    stone.zone !== "field" ||
    !def ||
    !data ||
    !def.isDoubleSided ||
    !def.backFace
  ) {
    return {
      ...currentState,
      log: [
        ...currentState.log,
        `[StoneRebirth] 創界石がフィールドにないため転醒できない`,
      ],
    };
  }

  if (
    !canActivateNexusMechanicEffect(
      currentState,
      stone.instanceId,
      "stone_rebirth",
      options.getCardDefinitionById
    )
  )
    return currentState;

  // 再検証: コア閾値・カウント条件（キュー後に状況が変わっている可能性がある）
  if (
    data.rebirthCoreThreshold != null &&
    stone.normalCoreCount < data.rebirthCoreThreshold
  ) {
    return {
      ...currentState,
      log: [
        ...currentState.log,
        `[StoneRebirth] コアが転醒閾値未満のため転醒できない`,
      ],
    };
  }

  const beforeState = currentState;
  const retainCores = data.rebirthRetainCores ?? 0;

  currentState = executeRebirth(
    { ...currentState, log: [...currentState.log] },
    actingPlayerId,
    {
      kind: "rebirth",
      maxCount: data.rebirthMaxCount ?? Number.POSITIVE_INFINITY,
      triggerDescription: `このネクサスのコアが${data.rebirthCoreThreshold ?? 0}個以上になったとき`,
      retainCores,
      returnedCoresDest: "void",
      ...(data.postRebirth === "combine_with_own_spirit"
        ? {
            postRebirthChoice: {
              kind: "brave_combine" as const,
              optional: true,
            },
          }
        : data.postRebirth === "charge_cores_from_field_reserve"
          ? {
              postRebirthChoice: {
                kind: "core_distribute" as const,
              },
            }
          : {}),
    },
    mechanic.grandstoneInstanceId,
    options.getCardDefinitionById,
    chainId
  );
  // 08a:83 + ユーザー裁定 2026-06-10: 裏返してコア不足（retainCores < B面最低Lv）の場合、
  // 表面の転醒時効果は発揮できるが転醒は成功せず消滅・カウント増えず（executeRebirth が
  // lv-deficit で flip せず中断）。現行の創界石 B 面は全て requiredCores:0 のため不足は生じない。

  if (
    currentState.pendingStoneFlipCombine?.rebirthCompletion
      ?.sourceInstanceId === mechanic.grandstoneInstanceId ||
    (currentState.pendingCoreDistribution?.rebirthCompletion?.deferredAction &&
      currentState.pendingCoreDistribution.rebirthCompletion
        .sourceInstanceId === mechanic.grandstoneInstanceId)
  ) {
    return currentState;
  }

  // SBA + CE 再構築 + 『転醒時』トリガー収集（B 面 card_event:rebirth）+ flush。
  // 解封の rebirth 条件を持つ他の創界石もこの delta フックで発火する。
  currentState = finalizeEffectResolution({
    state: currentState,
    beforeState,
    chainId,
    endLogs: [],
    actingPlayerId: actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId: mechanic.grandstoneInstanceId,
  });

  return currentState;
}

/**
 * 転醒内蔵 postRebirthChoice の合体/コア配置選択を適用する。
 * chosenHostInstanceId 指定でそのホストへ合体（コアはブレイヴ→ホストへ移動）、
 * null で corePlacementChoice へ進むか、任意合体を辞退して転醒を確定する。
 */
export function applyStoneFlipCombineAction(
  options: ApplyLegalActionOptions
): ResolveBraveCombineChoiceResult {
  if (options.action.kind !== "resolve_brave_combine_choice") {
    throw new Error("Expected resolve_brave_combine_choice action");
  }
  const pending = options.state.pendingStoneFlipCombine;
  if (!pending) {
    throw new Error("No pending stone flip combine to resolve");
  }
  const chosenHost = options.action.chosenHostInstanceId;
  if (
    chosenHost === null &&
    !pending.corePlacementChoice &&
    pending.allowNoCombineChoice === false
  ) {
    throw new Error(
      "resolve_brave_combine_choice(rebirth): combine is required"
    );
  }
  if (
    chosenHost !== null &&
    !pending.hostCandidateInstanceIds.includes(chosenHost)
  ) {
    throw new Error(
      `resolve_brave_combine_choice(stone): invalid combine host ${chosenHost}`
    );
  }

  if (chosenHost === null && pending.corePlacementChoice) {
    const pendingBrave = getCardById(options.state, pending.braveInstanceId);
    const pendingCore = buildChargeCoresPendingCoreDistribution(
      options.state,
      pending.actingPlayerId,
      pending.braveInstanceId,
      pending.braveDefinitionId ?? pendingBrave?.definitionId ?? "",
      options.getCardDefinitionById,
      "rebirth-post-combine-core",
      {
        sourceScope: pending.corePlacementChoice.sourceScope,
        minTotal: pending.corePlacementChoice.minTotal,
        ...(pending.braveDefinitionId !== undefined
          ? { candidateDefinitionId: pending.braveDefinitionId }
          : {}),
      }
    );
    if (!pendingCore) {
      throw new Error(
        `resolve_brave_combine_choice(rebirth): core placement route is no longer available for ${pending.braveInstanceId}`
      );
    }
    return {
      state: {
        ...options.state,
        pendingStoneFlipCombine: null,
        pendingCoreDistribution: {
          ...pendingCore,
          minTotal: pending.corePlacementChoice.minTotal,
          maxTotal: pending.corePlacementChoice.maxTotal,
          rollbackIfBelowMinTotal: {
            minTotal: pending.corePlacementChoice.minTotal,
            reason: "rebirth_minimum_core",
          },
          ...(pending.rebirthCompletion
            ? { rebirthCompletion: pending.rebirthCompletion }
            : {}),
          priorStateSnapshot: pending.priorStateSnapshot ?? options.state,
        },
        log: [
          ...options.state.log,
          `stone:flip-combine:resolved:${pending.braveInstanceId}:core-placement`,
        ],
      },
    };
  }

  const beforeState = pending.priorStateSnapshot ?? options.state;
  let currentState: GameState = {
    ...options.state,
    pendingStoneFlipCombine: null,
    log: [
      ...options.state.log,
      `stone:flip-combine:resolved:${pending.braveInstanceId}:${chosenHost ?? "spirit-state"}`,
    ],
  };

  const deferredRebirthAction = pending.rebirthCompletion?.deferredAction;
  if (deferredRebirthAction && pending.rebirthCompletion) {
    const completion = pending.rebirthCompletion;
    currentState = executeRebirth(
      currentState,
      completion.actingPlayerId,
      deferredRebirthAction,
      completion.sourceInstanceId,
      options.getCardDefinitionById,
      completion.chainId,
      completion.rebirthTimingWindowId
    );
  }

  const rebirthCompleted =
    !deferredRebirthAction ||
    getCardById(currentState, pending.braveInstanceId)?.definitionId ===
      pending.braveDefinitionId;

  const countAction = {
    kind: "rebirth" as const,
    maxCount: Number.POSITIVE_INFINITY,
    triggerDescription: "rebirth completion",
    ...(pending.rebirthCompletion?.countBonusMode !== undefined
      ? { countBonusMode: pending.rebirthCompletion.countBonusMode }
      : {}),
  };

  if (rebirthCompleted && chosenHost !== null) {
    const brave = getCardById(currentState, pending.braveInstanceId)!;
    const frontDefinition = options.getCardDefinitionById(
      brave.originalDefinitionId
    );
    const braveDefinition =
      options.getCardDefinitionById(
        pending.braveDefinitionId ?? brave.definitionId
      ) ??
      (frontDefinition?.backFace
        ? synthesizeBackFaceDefinition(
            frontDefinition,
            frontDefinition.backFace
          )
        : undefined);
    // count 条件は転醒成立後の値で評価する（候補提示と同じ）。
    // 保留時の候補IDだけを信用せず、現盤面の生存・合体制限を共通判定する。
    const combineState = pending.rebirthCompletion
      ? {
          ...currentState,
          players: currentState.players.map((player) =>
            player.id === pending.rebirthCompletion!.actingPlayerId
              ? applyRebirthCountBonus(player, countAction)
              : player
          ),
        }
      : currentState;
    if (
      !braveDefinition ||
      !getValidBraveCombineHosts(
        combineState,
        braveDefinition,
        pending.actingPlayerId,
        options.getCardDefinitionById,
        pending.braveInstanceId
      ).some((host) => host.instanceId === chosenHost)
    ) {
      throw new Error(
        `resolve_brave_combine_choice(rebirth): invalid current combine host ${chosenHost}`
      );
    }
    const braveId = pending.braveInstanceId;
    const braveCores = brave?.normalCoreCount ?? 0;
    const braveSoul = brave ? isSoulCoreOn(currentState, braveId) : false;

    if (braveCores > 0) {
      currentState = moveNormalCores(
        currentState,
        { kind: "card", instanceId: braveId },
        { kind: "card", instanceId: chosenHost },
        braveCores,
        options.getCardDefinitionById
      );
    }
    if (braveSoul) {
      currentState = moveSoulCore(
        currentState,
        pending.actingPlayerId,
        { kind: "card", instanceId: braveId },
        { kind: "card", instanceId: chosenHost }
      );
    }
    currentState = updateCard(currentState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: chosenHost,
    }));
    currentState = updateCard(currentState, chosenHost, (c) => ({
      ...c,
      attachedChildrenIds: [...c.attachedChildrenIds, braveId],
    }));
    currentState = recordSemanticTriggerEvent(currentState, {
      eventKind: "brave_combined",
      relatedInstanceId: braveId,
      triggerRelatedCombinedHostInstanceId: chosenHost,
    });
  }

  if (rebirthCompleted && pending.rebirthCompletion) {
    const completion = pending.rebirthCompletion;
    currentState = {
      ...currentState,
      players: currentState.players.map((player) =>
        player.id === completion.actingPlayerId
          ? applyRebirthCountBonus(player, countAction)
          : player
      ),
      log: [
        ...currentState.log,
        `effect:rebirth:${completion.sourceInstanceId}:completion:count`,
      ],
    };
  }

  // スピリット状態選択時の Lv1 コア不足消滅などを SBA で判定する
  currentState = finalizeEffectResolution({
    state: currentState,
    beforeState,
    chainId:
      pending.rebirthCompletion?.chainId ??
      `stone-flip-combine:${pending.braveInstanceId}`,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId: pending.braveInstanceId,
  });

  return { state: currentState };
}

/**
 * 神技/導技/界放/契約技 — コア消費起動効果を適用する。
 * ネクサス上のコアをボイドに移動し、ターン制限キーを記録する。
 * 効果文内コストとDSL効果はスタック窓後に解決する。
 */
export function applyDivineSkillAction(
  options: ApplyLegalActionOptions
): ApplyLegalActionResult {
  if (options.action.kind !== "use_divine_skill") {
    throw new Error("Expected use_divine_skill action");
  }
  const { sourceInstanceId, skillIndex, coreCost, label } = options.action;

  if (
    !canDeclareDivineSkillEffect(
      options.state,
      sourceInstanceId,
      skillIndex,
      options.getCardDefinitionById
    )
  ) {
    throw new Error(
      `Divine skill source missing or effect suppressed: ${sourceInstanceId}`
    );
  }

  const gw = options.state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId && c.zone === "field"
  );
  if (!gw) {
    throw new Error(`Divine skill source not on field: ${sourceInstanceId}`);
  }

  const def = options.getCardDefinitionById(gw.definitionId);
  const skill = def?.grandwalkerData?.divineSkills?.[skillIndex];

  // ターン制限キーを宣言時点で記録（スタック窓中の二重宣言を防ぐ）
  const turnLimitKey = getDivineSkillUsageKey({
    sourceInstanceId,
    controllerPlayerId: gw.controllerPlayerId,
    sourceCardNo: def?.cardNo ?? gw.definitionId,
    skillIndex,
    turnLimit: skill?.turnLimit ?? "once",
  });

  // 神技は「常時以外の効果発揮」(02:186) なので発揮宣言でスタック窓を開く。
  // 「創界神上のコアをボイドに置く」は使用コストではなく効果文内（発揮コスト）のため、
  // コア消費・effects 実行はいずれも窓クローズ後の deferred 解決
  // (resolveDeferredDivineSkillStack) で行う。窓は発揮宣言の 1 枚のみ。
  const chainId = `divine-skill:${sourceInstanceId}:${skillIndex}:${divineSkillStackSequence++}`;
  const divineSkillNegatePreventionLevel =
    resolveDynamicStackNegatePreventionLevel({
      state: options.state,
      sourceInstanceId,
      actingPlayerId: gw.controllerPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  const divineSkillActiveStack: ActiveStack = {
    stackId: `stack:${chainId}`,
    actionKind: "divine_skill",
    chainId,
    actingPlayerId: gw.controllerPlayerId,
    cardInstanceId: sourceInstanceId,
    cardDefinitionId: gw.definitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    suppressionEffectDescriptor: deriveDivineSkillSuppressionEffectDescriptor({
      sourceDefinitionId: gw.definitionId,
      sourceKind: def
        ? getEffectDescriptorSourceKindForPrintedCategory(def.printedCategory)
        : "nexus",
      effectIndex: skillIndex,
      label,
      timing: skill?.timing,
      effects: skill?.effects,
    }),
    divineSkillIndex: skillIndex,
    ...(typeof skill?.coreCost === "number"
      ? { divineSkillCoreCost: coreCost }
      : {}),
    divineSkillLabel: label,
    ...(divineSkillNegatePreventionLevel !== undefined
      ? { negatePreventionLevel: divineSkillNegatePreventionLevel }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  const stateAfterDeclaration: GameState = {
    ...recordEffectUsageIfLimited({
      state: options.state,
      sourceInstanceId,
      sourceDefinitionId: gw.definitionId,
      playerId: gw.controllerPlayerId,
      effectLabel: `divine_skill:${skillIndex}`,
      usageLimit: skill?.usageLimit,
    }),
    usedDivineSkillKeysThisTurn: [
      ...options.state.usedDivineSkillKeysThisTurn,
      turnLimitKey,
    ],
    log: [
      ...options.state.log,
      `[DivineSkill] ${gw.controllerPlayerId} が【${label}：${typeof skill?.coreCost === "object" ? `${skill.coreCost.min}～${skill.coreCost.max}` : coreCost}】を発揮宣言（${gw.definitionId}）`,
    ],
  };

  return {
    ok: true,
    state: openEffectDeclarationStackWindow({
      baseState: options.state,
      stateAfterDeclaration,
      activeStack: divineSkillActiveStack,
      actingPlayerId: gw.controllerPlayerId,
    }),
  };
}

/**
 * 神技/界放/契約技/導技 (divine_skill) の deferred 解決（発揮宣言→スタック窓クローズ後）。
 * 「創界神上のコアをボイドに置く」発揮コスト（効果文内）を支払い、skill.effects を実行する。
 */
export function prepareDivineSkillCorePayment(
  state: GameState,
  stack: ActiveStack,
  options: DeferredStackResolverOptions
): { state: GameState; stack: ActiveStack; pending: boolean } {
  const unchanged = { state, stack, pending: false };
  if (stack.isNullified || stack.divineSkillCoreCostPaid) return unchanged;
  const source = getCardById(state, stack.cardInstanceId);
  const skill = options.getCardDefinitionById(stack.cardDefinitionId)
    ?.grandwalkerData?.divineSkills?.[stack.divineSkillIndex ?? 0];
  if (typeof skill?.coreCost !== "object") return unchanged;
  if (
    !source ||
    source.zone !== "field" ||
    source.normalCoreCount < skill.coreCost.min
  ) {
    return { ...unchanged, stack: { ...stack, isNullified: true } };
  }
  const maximum = Math.min(skill.coreCost.max, source.normalCoreCount);
  if (stack.divineSkillCoreCost === undefined) {
    return {
      stack,
      pending: true,
      state: {
        ...state,
        pendingCoreSourceAllocation: {
          pendingId: `divine-payment:${stack.chainId}`,
          actingPlayerId: stack.actingPlayerId,
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: source.definitionId,
          minimumTotal: skill.coreCost.min,
          requiredTotal: maximum,
          candidates: [
            {
              instanceId: source.instanceId,
              available: source.normalCoreCount,
              normalAvailable: source.normalCoreCount,
              hasSoulCore: false,
            },
          ],
          toLocation: { kind: "void", player: "self" },
          effectTiming: { kind: "activated", mode: "flash" },
          deferredStack: stack,
        },
      },
    };
  }
  const amount = stack.divineSkillCoreCost;
  if (
    !Number.isInteger(amount) ||
    amount < skill.coreCost.min ||
    amount > maximum
  ) {
    throw new Error(
      `Divine skill payment ${amount} is outside ${skill.coreCost.min}..${maximum}`
    );
  }
  return {
    pending: false,
    stack: { ...stack, divineSkillCoreCostPaid: true },
    state: moveNormalCores(
      state,
      { kind: "card", instanceId: source.instanceId },
      { kind: "void", playerId: stack.actingPlayerId },
      amount
    ),
  };
}

export function resolveDeferredDivineSkillStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  // 無効化された場合は効果・コストともスキップ（神技のコアは効果文内のため）。
  if (resolvedStack.isNullified) return state;

  if (
    !canActivateDivineSkillEffect(
      state,
      resolvedStack.cardInstanceId,
      resolvedStack.divineSkillIndex ?? 0,
      options.getCardDefinitionById
    )
  )
    return state;

  const gw = getCardById(state, resolvedStack.cardInstanceId);
  // ソース消失（窓中に創界神が離脱）= 不発（コア支払い・effects とも行わない）。
  if (!gw || gw.zone !== "field") {
    return {
      ...state,
      log: [
        ...state.log,
        `[DivineSkill] 創界神が離脱したため不発: ${resolvedStack.cardInstanceId}`,
      ],
    };
  }

  const def = options.getCardDefinitionById(gw.definitionId);
  const skillIndex = resolvedStack.divineSkillIndex ?? 0;
  const skill = def?.grandwalkerData?.divineSkills?.[skillIndex];
  const coreCost = resolvedStack.divineSkillCoreCost ?? 0;

  // ENGINE-external-rebirth-finalize: 通常 rebirth 経路 (resolveStoneRebirthMechanic
  // L12076) と同型に、効果実行後 SBA + CE 再構築 + 二次トリガー収集 + pending leave
  // flush を行うため beforeState を取る。神技 effects に rebirth/destroy/place 等の
  // 盤面遷移を含む場合 (BSSA01-XX01 神技4 等) に finalize 漏れによる silent gap を防ぐ。
  const beforeState = state;

  // 発揮コスト: ネクサス上 → ボイド（効果文内）
  let newState =
    coreCost > 0 && !resolvedStack.divineSkillCoreCostPaid
      ? moveNormalCores(
          state,
          { kind: "card", instanceId: resolvedStack.cardInstanceId },
          { kind: "void", playerId: gw.controllerPlayerId },
          coreCost
        )
      : state;

  // 神技/界放の effects を DSL インタプリタで実行（スキル内 effectIndex で識別）。
  if (skill?.effects && skill.effects.length > 0) {
    for (
      let effectIndex = 0;
      effectIndex < skill.effects.length;
      effectIndex++
    ) {
      const effect = skill.effects[effectIndex]!;
      newState = executeEffect({
        state: newState,
        effect,
        effectIndex,
        divineSkillIndex: skillIndex,
        chainId: resolvedStack.chainId,
        sourceInstanceId: resolvedStack.cardInstanceId,
        actingPlayerId: gw.controllerPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        // 範囲コスト神技 (ENGINE-divine-skill-variable-core-cost-range) の
        // 「減らしたコアN個につき」型スケール用に、実際に支払ったコア数を
        // DynamicCount.cost_paid_this_effect から参照可能にする。
        costPaidThisEffect: coreCost,
        // 窓後対象選択 (lookupRegistrationForStack の divine_skill case) で確定した
        // 対象を本体 effect へ渡す。未確定 (機械選択なし) の経路では空配列。
        ...(resolvedStack.targetInstanceIds.length > 0
          ? { targetInstanceIds: resolvedStack.targetInstanceIds }
          : {}),
        ...(resolvedStack.targetSelectionResolved === true
          ? { targetSelectionResolved: true }
          : {}),
        ...(resolvedStack.preservePreSelectedTargetRefs === true
          ? { preservePreSelectedTargetRefs: true }
          : {}),
        // スタック終了後の pending で確定した choice 分岐（「または」二択等）。
        ...(resolvedStack.divineSkillChoiceIndex !== undefined
          ? { choiceIndex: resolvedStack.divineSkillChoiceIndex }
          : {}),
        promptUnresolvedChoice: true,
      });
      if (
        newState.pendingStepChoice !== null ||
        newState.pendingStepOptionalChoice !== null ||
        newState.pendingDeckReveal !== null ||
        newState.pendingZoneSelection !== null ||
        newState.pendingEffectTargetSelection !== null ||
        newState.pendingAsIfSoulCoreChoice !== null ||
        newState.pendingEffectOptionalRepeatChoice !== null ||
        newState.pendingEffectOptionalRepeatCountSelection !== null
      ) {
        break;
      }
    }
  }

  // 効果実行後の SBA + CE 再構築 + 二次トリガー収集 + pending leave flush。
  // chainId は発揮宣言時に確定した resolvedStack.chainId を使い、子孫トリガーを同一鎖に紐付ける。
  // causedBySourceInstanceId は創界石の解封（手札増加系）が「原因効果の発揮元カード」で
  // 判定するため必須（10_rules/08c §解封; grandstone-system.ts:97 で fail-closed）。
  // 神技の発揮元 = 創界神ネクサス自身（resolvedStack.cardInstanceId）。
  newState = finalizeEffectResolution({
    state: newState,
    beforeState,
    chainId: resolvedStack.chainId,
    endLogs: [],
    actingPlayerId: gw.controllerPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(newState, gw, def),
    causedBySourceInstanceId: resolvedStack.cardInstanceId,
    enterFieldCausedByPlayerId: gw.controllerPlayerId,
  });

  return newState;
}
