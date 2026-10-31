import {
  getImmediateAttackJoinDecisions,
  isImmediateAttackJoinReady,
} from "./legal/immediate-attack-join";
import { scopeInnermostTriggerReactions } from "./effect/trigger-resolution-scope";
/**
 * P3-64 Phase A: 現在のアクター判定
 *
 * `PUT /api/room/:id/state` で送信元プレイヤーの正当性検証 (priority-gated PUT) に使用する。
 * 「今この瞬間に state を変更する権利を持つプレイヤー」の集合を state から純粋関数として導出する。
 *
 * **優先順位は `legal-actions.ts` の `getLegalActionsInner()` の評価順を正とし、それを鏡写しにする
 * (P3-91)。** 順序がズレると「actor 集合に居るプレイヤーには legal action が無く、legal action を
 * 持つプレイヤーは actor 集合に居ない」というデッドロックが起きる (例: stack window 開放中に
 * pendingBurstChecks を先に判定すると、スタック responder が pass できない)。
 *
 * 優先順位 (上から先に判定 — getLegalActionsInner と同順):
 * 1. `preGame !== null` → 両プレイヤー (じゃんけん / マリガンは並行更新を許す)
 * 2. pending UI prompts (brave leave / brave attack continuation / soul state / advent source /
 *    set-aside exit replacement / deck reveal / zone selection / step choices / cost gates /
 *    enter field placement / brave combine / swap choices / summon gates / core choices /
 *    target redirects / core distribution / multi placement) → 該当 owner。
 *    P3-92: 神託/解封/創界石転醒は mechanic 付き pendingTriggeredEffects に統合され #6 で判定。
 * 3. 最高優先度が immediate の `pendingPrivateDeclarations`
 *    (同 `simultaneousGroupId` + 同 `triggerPriority` の全 owner を許可)。
 *    deferred flash-use 宣言 (P3-86 案X) は surface しないため除外して判定する。
 * 4. `pendingBurstChecks` → stackWindow が無く immediate 誘発も無いとき、
 *    防御側優先で次に発動可否を選ぶプレイヤー
 *    (activationSelected 済みの発動宣言窓待ちバーストは除外)
 * 5. normal priority の `pendingPrivateDeclarations`
 * 6. `stackWindow` → `priorityPlayerId`
 * 7. `activeAttack.flashWindowState.pendingStackAction` (戦闘フラッシュ sub-stack 窓)
 *    → `priorityPlayerId`
 * 8. `pendingTriggeredEffects` → ターンプレイヤー + 選択済み effect の owner と相手
 *    (chooser=opponent 変種があるため両者を許可。実際の絞り込みは legal-actions 側)
 * 9. `battleImmediateEffects` → 各 effect owner と相手 (chooser=opponent 変種)
 * 10. `preDeclarationStackWindow` → `priorityPlayerId`
 * 11. `activeAttack.flashWindowState` → `priorityPlayerId`
 * 12. ブロック宣言ウィンドウ → defender
 * 13. それ以外 → `activePlayerId`
 *
 * Returns: 操作を許可されるプレイヤー ID の Set。判定不能時もデフォルトとして
 * `activePlayerId` を含めるため空 Set にはならない。
 */

import type { GameState } from "./model";
import type { GetLegalActionsOptions } from "./legal/legal-actions-types";
import { canDeclareMoreBlocks } from "./battle/battle-availability";
import {
  getHighestTriggerPriority,
  getPendingTriggeredEffectsForResolution,
  getTriggerPriority,
  isDeferredFlashUsePrivateDeclaration,
} from "./legal/legal-actions-availability";
import { hasPendingBurstActivationSelections } from "./mechanics/burst-system";

/** 2 人対戦前提で playerId の相手を返す (居なければ undefined)。 */
function opponentOf(state: GameState, playerId: string): string | undefined {
  return state.players.find((p) => p.id !== playerId)?.id;
}

export function getPendingPromptResolverPlayerIds(
  state: GameState
): ReadonlySet<string> | null {
  if (state.pendingBraveLeaveChoice) {
    return new Set([state.pendingBraveLeaveChoice.choosingPlayerId]);
  }
  if (state.pendingBraveAttackContinuation) {
    return new Set([state.pendingBraveAttackContinuation.choosingPlayerId]);
  }
  if (state.pendingSoulStateReplacement) {
    return new Set([state.pendingSoulStateReplacement.choosingPlayerId]);
  }
  if (state.pendingAdventSourceReplacement) {
    return new Set([state.pendingAdventSourceReplacement.choosingPlayerId]);
  }
  if (state.pendingSetAsideExitReplacementChoice) {
    return new Set([
      state.pendingSetAsideExitReplacementChoice.choosingPlayerId,
    ]);
  }
  if (state.pendingDeckReveal) {
    return new Set([state.pendingDeckReveal.actingPlayerId]);
  }
  if (state.pendingZoneSelection) {
    return new Set([state.pendingZoneSelection.actingPlayerId]);
  }
  if (state.pendingStepOptionalChoice) {
    return new Set([state.pendingStepOptionalChoice.choosingPlayerId]);
  }
  if (state.pendingStepChoice) {
    return new Set([state.pendingStepChoice.choosingPlayerId]);
  }
  if (state.pendingConnectBattleDecision) {
    return new Set([state.pendingConnectBattleDecision.actingPlayerId]);
  }
  if (state.pendingDeckRevealCountBoostChoice) {
    return new Set([state.pendingDeckRevealCountBoostChoice.actingPlayerId]);
  }
  if (state.pendingStepOptionalTargetSelection) {
    return new Set([state.pendingStepOptionalTargetSelection.choosingPlayerId]);
  }
  if (state.pendingDrawStepCostChoice) {
    return new Set([state.pendingDrawStepCostChoice.actingPlayerId]);
  }
  if (state.pendingSummonCostExcludeChoice) {
    return new Set([state.pendingSummonCostExcludeChoice.actingPlayerId]);
  }
  if (state.pendingSummonCostCoreMoveChoice) {
    return new Set([state.pendingSummonCostCoreMoveChoice.actingPlayerId]);
  }
  if (state.pendingGroupedSummonCostOverrideChoice) {
    return new Set([
      state.pendingGroupedSummonCostOverrideChoice.actingPlayerId,
    ]);
  }
  if (state.pendingLifeDamageDiscardChoice) {
    return new Set([state.pendingLifeDamageDiscardChoice.decidingPlayerId]);
  }
  if (state.pendingLifeGainReplacementChoice) {
    return new Set([state.pendingLifeGainReplacementChoice.decidingPlayerId]);
  }
  if (state.pendingCoreShootSelection) {
    return new Set([state.pendingCoreShootSelection.actingPlayerId]);
  }
  if (state.pendingEffectTargetSelection) {
    return new Set([state.pendingEffectTargetSelection.actingPlayerId]);
  }
  if (state.pendingAsIfSoulCoreChoice) {
    return new Set([state.pendingAsIfSoulCoreChoice.actingPlayerId]);
  }
  if (state.pendingEffectOptionalRepeatChoice) {
    return new Set([state.pendingEffectOptionalRepeatChoice.actingPlayerId]);
  }
  if (state.pendingEffectOptionalRepeatCountSelection) {
    return new Set([
      state.pendingEffectOptionalRepeatCountSelection.actingPlayerId,
    ]);
  }
  if (state.pendingBorrowedEffectChoice) {
    return new Set([state.pendingBorrowedEffectChoice.actingPlayerId]);
  }
  if (state.pendingBorrowedEffectTargetSelection) {
    return new Set([
      state.pendingBorrowedEffectTargetSelection.choosingPlayerId,
    ]);
  }
  if (state.pendingPayToActCoreGate) {
    return new Set([state.pendingPayToActCoreGate.actingPlayerId]);
  }
  if (state.pendingPayToActHandDiscardGate) {
    return new Set([state.pendingPayToActHandDiscardGate.actingPlayerId]);
  }
  if (
    state.pendingFieldMagicPreCostTrigger &&
    !state.pendingFieldMagicPreCostTrigger.triggered
  ) {
    return new Set([state.pendingFieldMagicPreCostTrigger.actingPlayerId]);
  }
  if (state.pendingEnterFieldPlacement) {
    return new Set([state.pendingEnterFieldPlacement.actingPlayerId]);
  }
  if (state.pendingBraveCombineChoice) {
    return new Set([state.pendingBraveCombineChoice.actingPlayerId]);
  }
  if (state.pendingHandTrashSwapChoice) {
    return new Set([state.pendingHandTrashSwapChoice.actingPlayerId]);
  }
  if (state.pendingFieldHandSwapChoice) {
    return new Set([state.pendingFieldHandSwapChoice.actingPlayerId]);
  }
  if (state.pendingTenshoSummon) {
    return new Set([state.pendingTenshoSummon.actingPlayerId]);
  }
  if (state.pendingReverseRebirthSummon) {
    return new Set([state.pendingReverseRebirthSummon.actingPlayerId]);
  }
  if (state.pendingStoneFlipCombine) {
    return new Set([state.pendingStoneFlipCombine.actingPlayerId]);
  }
  if (state.pendingCoreSplitSelection) {
    return new Set([state.pendingCoreSplitSelection.actingPlayerId]);
  }
  if (state.pendingSplitSummonChoice) {
    return new Set([state.pendingSplitSummonChoice.actingPlayerId]);
  }
  if (state.pendingCoreCountSelection) {
    return new Set([state.pendingCoreCountSelection.actingPlayerId]);
  }
  if (state.pendingCountSelection) {
    return new Set([state.pendingCountSelection.actingPlayerId]);
  }
  if (state.pendingDiscardSetBurstCountSelection) {
    return new Set([state.pendingDiscardSetBurstCountSelection.actingPlayerId]);
  }
  if (state.pendingLifeCoreSelection) {
    return new Set([state.pendingLifeCoreSelection.actingPlayerId]);
  }
  if (state.pendingCoreSourceAllocation) {
    return new Set([state.pendingCoreSourceAllocation.actingPlayerId]);
  }
  if (state.pendingLinkAidCostSourceChoice) {
    return new Set([state.pendingLinkAidCostSourceChoice.actingPlayerId]);
  }
  if (state.pendingEffectSummonCostPayment) {
    return new Set([state.pendingEffectSummonCostPayment.actingPlayerId]);
  }
  if ((state.pendingTargetRedirects?.length ?? 0) > 0) {
    const redirect = state.pendingTargetRedirects[0]!;
    const actorId =
      redirect.decisionConfirmed === true
        ? (redirect.candidateChooserPlayerId ?? redirect.promptedPlayerId)
        : redirect.promptedPlayerId;
    return new Set([actorId]);
  }
  if (state.pendingChangeCleanupChoice) {
    return new Set([state.pendingChangeCleanupChoice.actingPlayerId]);
  }
  if (state.pendingCoreDistribution) {
    return new Set([state.pendingCoreDistribution.actingPlayerId]);
  }
  if (state.pendingMultiPlacement) {
    return new Set([state.pendingMultiPlacement.actingPlayerId]);
  }
  return null;
}

export type CurrentActorOptions = Pick<
  GetLegalActionsOptions,
  "getCardDefinitionById" | "getRegisteredTriggeredEffectActions"
>;

export function getCurrentActorPlayerIds(
  state: GameState,
  options?: CurrentActorOptions
): ReadonlySet<string> {
  // viewer-safe stateでは秘匿済みpendingから操作権を再推測しない。
  if (state.pendingPromptLock) {
    return new Set(state.pendingPromptLock.resolverPlayerIds);
  }
  // 1. preGame は両者並行更新を許可
  if (state.preGame) {
    return new Set(state.playerOrder);
  }

  // 2. pending UI prompts — getLegalActionsInner のチェーンと同順
  const pendingPromptResolvers = getPendingPromptResolverPlayerIds(state);
  if (pendingPromptResolvers !== null) {
    return pendingPromptResolvers;
  }

  state = {
    ...scopeInnermostTriggerReactions(state),
    pendingTriggeredEffects: getPendingTriggeredEffectsForResolution({
      state,
      ...options,
    }),
  };
  // 3. private declaration: immediate は burst より先に surface する。
  // normal priority は getLegalActionsInner と同じく pendingBurstChecks の後で扱う。
  // (同 simultaneousGroupId + 同 triggerPriority の全 owner を許可)。
  // deferred flash-use 宣言 (応答窓中は surface しない, P3-86 案X) は除外し、
  // legal-actions と同じく窓側の判定 (#5 以降) へ fall through する。
  const activeDeclarations = state.pendingPrivateDeclarations.filter(
    (decl) => !isDeferredFlashUsePrivateDeclaration(state, decl)
  );
  const highestPendingTriggerPriority = getHighestTriggerPriority([
    ...activeDeclarations,
    ...state.pendingTriggeredEffects,
  ]);
  const priorityDeclarations = activeDeclarations.filter(
    (decl) => getTriggerPriority(decl) === highestPendingTriggerPriority
  );
  const privateDeclarationActors = (): ReadonlySet<string> | null => {
    const firstDecl = priorityDeclarations[0];
    if (!firstDecl) return null;
    const ids = new Set<string>();
    const groupId = firstDecl.simultaneousGroupId;
    if (groupId) {
      for (const decl of priorityDeclarations) {
        if (
          decl.simultaneousGroupId === groupId &&
          getTriggerPriority(decl) === getTriggerPriority(firstDecl)
        ) {
          ids.add(decl.ownerPlayerId);
        }
      }
    } else {
      ids.add(firstDecl.ownerPlayerId);
    }
    return ids;
  };
  if (highestPendingTriggerPriority === "immediate") {
    const ids = privateDeclarationActors();
    if (ids) return ids;
  }

  // 4. burst check: immediate 誘発が無いとき、防御側優先で次に発動可否を選ぶプレイヤー。
  // activationSelected 済みのバーストは発動宣言窓待ちであり、再選択しない。
  // (getAvailablePendingBurstCheckLegalActions の nextActingPlayerId と同じ規約)。
  if (
    state.stackWindow === null &&
    highestPendingTriggerPriority !== "immediate" &&
    hasPendingBurstActivationSelections(state)
  ) {
    const pendingActivationChecks = state.pendingBurstChecks.filter(
      (check) => check.activationSelected !== true
    );
    const defenseSidePlayerId = opponentOf(state, state.activePlayerId);
    const hasDefenseSideBurst =
      defenseSidePlayerId !== undefined &&
      pendingActivationChecks.some(
        (check) => check.actingPlayerId === defenseSidePlayerId
      );
    const nextActingPlayerId = hasDefenseSideBurst
      ? defenseSidePlayerId
      : pendingActivationChecks[0]?.actingPlayerId;
    if (nextActingPlayerId) {
      return new Set([nextActingPlayerId]);
    }
  }

  const privateIds = privateDeclarationActors();
  if (privateIds) {
    return privateIds;
  }

  // 5. stack window: priority holder。pendingTriggeredEffects / pendingBurstChecks が
  // 残っていても、窓が開いている間はスタック応答 (pass_stack 等) のみ合法
  // (getLegalActionsInner P3-34 分岐と同順)。
  if (state.stackWindow) {
    return new Set([state.stackWindow.priorityPlayerId]);
  }

  // 6. 戦闘フラッシュ sub-stack 窓 (pendingStackAction 保持中): responder が
  // pass_battle_flash / stack 応答系を持つ (getLegalActionsInner と同順、未解決の誘発より先)。
  if (state.activeAttack?.flashWindowState?.pendingStackAction != null) {
    return new Set([state.activeAttack.flashWindowState.priorityPlayerId]);
  }

  // 7. pendingTriggeredEffects: turn player が解決順 select、selected effect の owner が resolve。
  // chooser=opponent 変種 (D-2 Phase 2) があるため owner の相手も許可する
  // (per-action の絞り込みは getAvailablePendingTriggeredEffectLegalActions が行う)。
  if (state.pendingTriggeredEffects.length > 0) {
    const ids = new Set<string>([state.activePlayerId]);
    const priorityTriggeredEffects = state.pendingTriggeredEffects.filter(
      (effect) => getTriggerPriority(effect) === highestPendingTriggerPriority
    );
    const selectedEffects = priorityTriggeredEffects.filter(
      (effect) => effect.selectedByTurnPlayer
    );
    if (selectedEffects.length === 0 && priorityTriggeredEffects.length === 1) {
      selectedEffects.push(priorityTriggeredEffects[0]!);
    }
    for (const effect of selectedEffects) {
      ids.add(effect.actingPlayerId);
      const opp = opponentOf(state, effect.actingPlayerId);
      if (opp) ids.add(opp);
    }
    return ids;
  }

  // 8. battle immediate effects: 各 effect owner が resolve。
  // chooser=opponent 変種 (D-2 Phase 2) があるため owner の相手も許可する。
  if (state.battleImmediateEffects.length > 0) {
    const ids = new Set<string>();
    for (const prompt of state.battleImmediateEffects) {
      ids.add(prompt.actingPlayerId);
      const opp = opponentOf(state, prompt.actingPlayerId);
      if (opp) ids.add(opp);
    }
    return ids;
  }

  // 9. pre-declaration stack window: priority holder
  if (state.preDeclarationStackWindow) {
    return new Set([state.preDeclarationStackWindow.priorityPlayerId]);
  }

  if (
    options?.getCardDefinitionById &&
    getImmediateAttackJoinDecisions({
      state,
      actingPlayerId: state.activePlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
    }).length > 0
  )
    return new Set([state.activePlayerId]);

  // lookup無しの呼び出しでは、安定点で検証済みの参加機会を使う。
  if (
    !options?.getCardDefinitionById &&
    isImmediateAttackJoinReady(state) &&
    state.pendingImmediateAttackJoins?.some(
      (entry) => entry.attackId === state.activeAttack?.attackId
    )
  ) {
    return new Set([state.activePlayerId]);
  }

  // 10. battle flash window (アタック中の flash before/after block)
  if (state.activeAttack?.flashWindowState) {
    return new Set([state.activeAttack.flashWindowState.priorityPlayerId]);
  }

  // 11. ブロック宣言ウィンドウ: flash_before_block 閉鎖済 + flash_after_block 未開始 +
  // ブロック未確定 + バトル解決前。ルール正源では `declare_block` 小窓
  // (`10_rules/02_turn-flow-and-timing.md` 138-145, 217: 最初の優先権は非アクティブ
  // プレイヤー = ブロック側) で defender が actor。
  // `window` フィールドは `closeBattleFlashWindow` の慣習上 "declare_attack" のまま
  // 残るため、`activeAttack.flash*Completed` と `blockAssignments` で判定する。
  if (
    state.activeAttack &&
    state.activeAttack.flashBeforeBlockCompleted &&
    !state.activeAttack.flashAfterBlockCompleted &&
    state.battleResolutionGroup === null &&
    (state.activeAttack.blockAssignments.every(
      (assignment) => assignment.blockedByEntityIds.length === 0
    ) ||
      canDeclareMoreBlocks(state))
  ) {
    const target = state.activeAttack.target;
    if (target.kind === "player") {
      return new Set([target.playerId]);
    }
    if (target.kind === "battle_entity") {
      const battleEntity = state.battleEntities.find(
        (entity) => entity.entityId === target.entityId
      );
      if (battleEntity) {
        for (const instanceId of battleEntity.memberInstanceIds) {
          const card = state.cardInstances.find(
            (instance) => instance.instanceId === instanceId
          );
          if (card) {
            return new Set([card.controllerPlayerId]);
          }
        }
      }
    }
  }

  // 12. fallback: ターンプレイヤー
  return new Set([state.activePlayerId]);
}

/**
 * `actor` が現在 state の操作権限を持つかを判定する。
 * `getCurrentActorPlayerIds(state).has(actor)` の薄いラッパー。
 */
export function isCurrentActor(
  state: GameState,
  actor: string,
  options?: CurrentActorOptions
): boolean {
  return getCurrentActorPlayerIds(state, options).has(actor);
}
