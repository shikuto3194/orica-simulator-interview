// ============================================================
// optional-step-auto-resume.ts — 非対話的 optional step 自動 resume
// ============================================================
//
// borrow_magic_effect (effect-borrowing.ts) / retrigger (retrigger-system.ts) は、
// 他カードの Effect を `executeEffect` へ直接橋渡しする非対話的経路であり、
// legal-actions-apply.ts の `resolve_pending_step_optional_choice` のような
// プレイヤー選択待ちを経由しない。借用/再発火先の効果に `executionMode:"optional"`
// な step が含まれると、`executeEffect` はその場で `pendingStepOptionalChoice` を
// 積んで即 return するため (effect-interpreter.ts の該当ゲート)、誰にも resume
// されず当該 step 以降が永久に実行されない (ENGINE-borrow-retrigger-optional-step-no-resume)。
//
// 借用/再発火は「必ず発揮する」文脈のため、常に execute 側を選んで自動的に resume する。
// 循環 import 回避のため `executeEffect` は値として import せず、呼び出し元
// (effect-borrowing.ts / retrigger-system.ts) から関数注入する。

import type {
  CardDefinition,
  GameState,
  StepOptionalContinuation,
} from "../model";
import type { Effect } from "../dsl-types";
import type { ExecuteEffectOptions } from "./effect-interpreter";
import type {
  BurstActionRegistrationLookup,
  TriggeredEffectActionRegistrationLookup,
} from "./trigger-system";

function buildOptionalExecuteResumeOptions(
  cont: StepOptionalContinuation
): Partial<ExecuteEffectOptions> {
  return {
    startFromStepIndex: cont.stepIndex,
    restoredStepContext: cont.stepContext,
    optionalExecuteResumeStepIndex: cont.stepIndex,
    rangeAutoResolveStrategy: "max",
    ...(cont.chainId !== undefined && cont.chainId !== null
      ? { chainId: cont.chainId }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.effectActionKind !== undefined
      ? { effectActionKind: cont.effectActionKind }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(cont.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...cont.targetInstanceIds] }
      : {}),
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId }
      : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.eventAmount !== undefined
      ? { eventAmount: cont.eventAmount }
      : {}),
    ...(cont.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            cont.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(cont.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: cont.pendingEffectPendingId }
      : {}),
    ...(cont.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  };
}

function buildOptionalDeclineResumeOptions(
  cont: StepOptionalContinuation
): Partial<ExecuteEffectOptions> {
  return {
    startFromStepIndex: cont.stepIndex,
    restoredStepContext: cont.stepContext,
    declinedOptionalStepIndex: cont.stepIndex,
    rangeAutoResolveStrategy: "max",
    ...(cont.chainId !== undefined && cont.chainId !== null
      ? { chainId: cont.chainId }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.effectActionKind !== undefined
      ? { effectActionKind: cont.effectActionKind }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(cont.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...cont.targetInstanceIds] }
      : {}),
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId }
      : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.eventAmount !== undefined
      ? { eventAmount: cont.eventAmount }
      : {}),
    ...(cont.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            cont.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(cont.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: cont.pendingEffectPendingId }
      : {}),
    ...(cont.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  };
}

/**
 * `executeEffect` が `pendingStepOptionalChoice` を積んで中断した場合、実行可能な optional は
 * "execute" 側を選んで自動的に resume し続ける (借用/再発火先の optional 効果は「必ず発揮する」
 * 文脈のため、player 選択を待たない)。`canExecute=false` の optional は legal action 経路と
 * 同じく execute 不能として "decline" 側で resume する。同一効果内に複数の optional step が
 * あっても全て解消されるまでループする。
 *
 * `effect` は最初の `executeEffectFn` 呼び出しで渡したものと同一オブジェクトを渡すこと。
 * retrigger-system.ts の一時合成 Effect (steps を1本に絞った synthetic effect) は
 * カード定義の `effects[]` から再取得できないため、continuation の `sourceDefinitionId` +
 * `effectIndex` からの逆引きではなく、呼び出し元が保持する effect 参照をそのまま再利用する。
 *
 * 正源: needs-dsl.audit ENGINE-borrow-retrigger-optional-step-no-resume。
 */
export function autoResumePendingOptionalSteps(args: {
  state: GameState;
  effect: Effect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: BurstActionRegistrationLookup;
  executeEffectFn: (options: ExecuteEffectOptions) => GameState;
}): GameState {
  let currentState = args.state;
  while (currentState.pendingStepOptionalChoice) {
    const pending = currentState.pendingStepOptionalChoice;
    const cont = pending.continuation;
    const choice = pending.canExecute === false ? "decline" : "execute";
    currentState = {
      ...currentState,
      pendingStepOptionalChoice: null,
      log: [
        ...currentState.log,
        `effect:step-optional-${choice}:${pending.pendingId}:step=${cont.stepIndex}:auto-resume`,
      ],
    };
    const resumeState: GameState =
      cont.targetedDisclosureContinuation !== undefined
        ? {
            ...currentState,
            pendingTargetedDisclosureContinuation:
              cont.targetedDisclosureContinuation,
          }
        : currentState;
    currentState = args.executeEffectFn({
      state: resumeState,
      chainId: cont.chainId,
      effect: args.effect,
      effectIndex: cont.effectIndex,
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: args.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        args.getRegisteredTriggeredEffectActions,
      ...(args.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: args.getRegisteredBurstActions }
        : {}),
      ...(choice === "execute"
        ? buildOptionalExecuteResumeOptions(cont)
        : buildOptionalDeclineResumeOptions(cont)),
    });
  }
  return currentState;
}
