import { calculateFullyPaidSummonRemainingCost } from "../mechanics/summon-cost-exclude-choice";
import { canPayRequiredEffectCosts } from "./required-effect-cost-gate";
import { calculateFreeSummonCost } from "../effect/summon-cost";
import { getCardById } from "../card/card-lookup";
import { scopeInnermostTriggerReactions } from "../effect/trigger-resolution-scope";
import {
  getAvailableCardCostPaymentSources,
  getAvailablePayCostCoreSources,
} from "../core/payment-system";
import { calculateFullReductionSummonCost } from "../core/cost-system";
import { isRuleStrengthBattlePrevented } from "../battle/battle-shared";
import { hasPendingBurstActivationSelections } from "../mechanics/burst-system";
import { getPendingPromptResolverPlayerIds } from "../current-actor";
import { measureTime } from "../perf";
import { revalidatePendingEffectTargets } from "./pending-effect-target-selection";
import type { EffectFilterTag } from "../state-based-actions";
import { getDeckRevealHandGainCost } from "./deck-reveal-hand-gain-cost";
import { getZoneSelectionHandGainCost } from "./zone-selection-hand-gain-cost";
import {
  getHandGainCostPaymentSources,
  getOwnEffectHandGainCost,
  type HandGainCostSource,
} from "../effect/hand-gain-cost";
import {
  getDeckRevealRemainderOrderCandidateIds,
  getDeckRevealOrderableRemainderIds,
  getDeckRevealSelectablePickCandidateIds,
  getDeckRevealExclusiveGroupBranches,
} from "./deck-reveal-pick-candidates";
import {
  getAvailableAttackLegalActions,
  getAvailableFlipInsteadOfAttackLegalActions,
  getAvailableBattleImmediateEffectLegalActions,
  getAvailableBlockLegalActions,
  getAvailableDeclineBlockLegalActions,
  getAvailableEndAttackStepLegalActions,
  getAvailableFlashFieldCardEffectLegalActions,
  getAvailableFieldCardEffectLegalActions,
  getCurrentMagicActionTimings,
  getAvailableHandActivatedEffectLegalActions,
  getAvailableHandSummonPermissionLegalActions,
  getAvailableHandCardLegalActions,
  getAvailableMagicLegalActions,
  getAvailableAccelLegalActions,
  getAvailableChangeLegalActions,
  getAvailableAdventLegalActions,
  getAvailableDualHostAdventLegalActions,
  getAvailableManifestLegalActions,
  getAvailableOpenBattleFlashLegalActions,
  getAvailablePassBattleFlashLegalActions,
  getAvailablePassStackLegalActions,
  getAvailablePassPreDeclarationStackLegalActions,
  getAvailablePendingBurstCheckLegalActions,
  getAvailablePrivateTriggeredEffectDeclarationLegalActions,
  getHighestTriggerPriority,
  getTriggerPriority,
  isDeferredFlashUsePrivateDeclaration,
  getAvailablePendingTriggeredEffectLegalActions,
  getPendingTriggeredEffectsForResolution,
  getAvailableSetBurstLegalActions,
  getAvailableBraveCombineLegalActions,
  getAvailableContractCombineLegalActions,
  getAvailableLinkAidLegalActions,
  getAvailableBraveSeparateLegalActions,
  getAvailableBraveSwapLegalActions,
  getAvailableSetMirageLegalActions,
  getAvailableSetQuartzLegalActions,
  getAvailableActivateSoulStateLegalActions,
  getAvailableDivineSkillLegalActions,
} from "./legal-actions-availability";
import { getFieldMagicPreCostTriggerOffer } from "./field-magic-pre-cost-trigger";
import { isHandGainPreventedByOwnEffect } from "../effect/effect-resistance-check";
import {
  canEnumerateMainHandCardActions,
  isOpenStackResponseSuppressedForPlayer,
  getMandatoryForcedTargetInclusionIds,
} from "./legal-actions-shared";
import type {
  GetLegalActionsOptions,
  LegalAction,
} from "./legal-actions-types";
import {
  getDeckRevealRevealedChoiceCandidateIds,
  getDeckRevealRevealedChoiceMaxPickCount,
} from "./deck-reveal-swap-helpers";

export * from "./legal-actions-types";
export * from "./legal-action-window-classification";
export {
  getAvailableJoinActiveAttackLegalActions,
  getAvailableAttackLegalActions,
  getAvailableFlipInsteadOfAttackLegalActions,
  getAvailableBattleImmediateEffectLegalActions,
  getAvailableBlockLegalActions,
  getAvailableDeclineBlockLegalActions,
  getAvailableEndAttackStepLegalActions,
  getAvailableFlashFieldCardEffectLegalActions,
  getAvailableFieldCardEffectLegalActions,
  getAvailableHandActivatedEffectLegalActions,
  getAvailableHandSummonPermissionLegalActions,
  getAvailableHandCardLegalActions,
  getAvailableMagicLegalActions,
  getAvailableAccelLegalActions,
  getAvailableChangeLegalActions,
  getAvailableAdventLegalActions,
  getAvailableDualHostAdventLegalActions,
  getAvailableManifestLegalActions,
  getAvailableOpenBattleFlashLegalActions,
  getAvailablePassBattleFlashLegalActions,
  getAvailablePassStackLegalActions,
  getAvailablePassPreDeclarationStackLegalActions,
  getAvailablePendingBurstCheckLegalActions,
  getAvailablePrivateTriggeredEffectDeclarationLegalActions,
  isDeferredFlashUsePrivateDeclaration,
  getAvailablePendingTriggeredEffectLegalActions,
  getAvailableSetBurstLegalActions,
  getAvailableSetMirageLegalActions,
  getAvailableSetQuartzLegalActions,
  getAvailableActivateSoulStateLegalActions,
  getAvailableBraveCombineLegalActions,
  getAvailableContractCombineLegalActions,
  getAvailableLinkAidLegalActions,
  getAvailableBraveSeparateLegalActions,
  getAvailableBraveSwapLegalActions,
  getAvailableDivineSkillLegalActions,
} from "./legal-actions-availability";
export { applyLegalAction, tryApplyLegalAction } from "./legal-actions-apply";

/**
 * BattleImmediateEffect と PendingTriggeredEffect の両方に存在する
 * simultaneousGroupId の集合を返す。空なら同時誘発グループは無い。
 */
function getSharedSimultaneousGroupIds(
  state: import("../model").GameState
): Set<string> {
  const battleGroupIds = new Set<string>();
  for (const e of state.battleImmediateEffects) {
    if (e.simultaneousGroupId) {
      battleGroupIds.add(e.simultaneousGroupId);
    }
  }
  if (battleGroupIds.size === 0) {
    return battleGroupIds; // 空
  }
  const shared = new Set<string>();
  for (const e of state.pendingTriggeredEffects) {
    if (e.simultaneousGroupId && battleGroupIds.has(e.simultaneousGroupId)) {
      shared.add(e.simultaneousGroupId);
    }
  }
  return shared;
}

import { getImmediateAttackJoinDecisions } from "./immediate-attack-join";
import { assertPendingTriggerChainIds } from "../chain-id";

export function getLegalActions(
  options: GetLegalActionsOptions
): LegalAction[] {
  assertPendingTriggerChainIds(options.state);
  return measureTime("getLegalActions", () => {
    const actions = collapseDeferredEffectStepChoiceDeclarations(
      getLegalActionsInner(options)
    );
    return actions.map((action) => {
      if (action.kind !== "use_magic") return action;
      const offer = getFieldMagicPreCostTriggerOffer(options, action);
      return offer ? { ...action, preCostTriggerOffer: offer } : action;
    });
  });
}

const DEFERRED_EFFECT_STEP_CHOICE_ACTION_KINDS = new Set<LegalAction["kind"]>([
  "use_magic",
  "use_field_card_effect",
  "use_hand_card_effect",
  "resolve_pending_triggered_effect",
  "resolve_pending_burst_check",
  "resolve_battle_immediate_effect",
]);

type ChoiceDeclarationLegalAction = LegalAction & {
  choiceIndex?: number;
  choiceLabel?: string;
  deferredChoiceIndexes?: readonly number[];
  targetMode: "none" | "manual";
  requiredTargetCount: number;
  maxTargetCount?: number;
  chooserPlayerId?: string;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  candidateTargetZones?: readonly import("../model").Zone[];
  targetGroups?: readonly unknown[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  requiredPayCostAmount?: number;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  availableChosenLifeCoreKinds: import("../model").LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
  playsSourceCardWithoutCostAfterResolve?: boolean;
  usesSourceCardWithoutCostAfterResolve?: boolean;
  playsTargetCardWithoutCostAfterResolve?: boolean;
  usesTargetCardWithoutCostAfterResolve?: boolean;
  targetFollowUpMagicOptions?: unknown[];
  targetEnterFieldCorePlacementOptions?: unknown[];
  requiresEnterFieldCorePlacements?: boolean;
};

function handOrSetAsideDestinationChoices(
  state: import("../model").GameState,
  recipientPlayerId: string,
  effectActingPlayerId: string,
  handGainCostGateApplies: boolean,
  source: HandGainCostSource,
  getDefinition: GetLegalActionsOptions["getCardDefinitionById"]
): Array<"hand" | "set_aside"> {
  if (
    isHandGainPreventedByOwnEffect(
      state,
      recipientPlayerId,
      effectActingPlayerId
    )
  ) {
    return ["set_aside"];
  }
  // BSRK01-C02 は「相手は、相手の効果で」なので、別プレイヤーの効果で
  // 相手の手札を増やす場合には課さない。手札の受益者自身が発揮者のときだけ
  // reserve を見て、支払えなければ手元選択だけを公開する。
  if (!handGainCostGateApplies || recipientPlayerId !== effectActingPlayerId) {
    return ["hand", "set_aside"];
  }
  const externalHandGainCost = getOwnEffectHandGainCost(
    state,
    recipientPlayerId,
    effectActingPlayerId
  );
  return externalHandGainCost > 0 &&
    getHandGainCostPaymentSources(
      state,
      { ...source, actingPlayerId: recipientPlayerId },
      getDefinition
    ).totalAvailableCoreAmount < externalHandGainCost
    ? ["set_aside"]
    : ["hand", "set_aside"];
}

function deckRevealFreeDestinationChoices(
  state: import("../model").GameState,
  pending: import("../model").PendingDeckReveal,
  getDefinition: GetLegalActionsOptions["getCardDefinitionById"]
): Array<"hand" | "set_aside"> {
  return handOrSetAsideDestinationChoices(
    state,
    pending.targetPlayerId ?? pending.actingPlayerId,
    pending.actingPlayerId,
    true,
    pending,
    getDefinition
  );
}

function isChoiceDeclarationLegalAction(
  action: LegalAction
): action is ChoiceDeclarationLegalAction {
  return (
    DEFERRED_EFFECT_STEP_CHOICE_ACTION_KINDS.has(action.kind) &&
    "choiceIndex" in action &&
    typeof action.choiceIndex === "number"
  );
}

function makeDeferredChoiceDeclaration(
  action: ChoiceDeclarationLegalAction
): ChoiceDeclarationLegalAction {
  const neutral = { ...action };
  delete neutral.choiceIndex;
  delete neutral.choiceLabel;
  delete neutral.maxTargetCount;
  delete neutral.chooserPlayerId;
  delete neutral.candidateTargetZones;
  delete neutral.targetGroups;
  delete neutral.targetStepId;
  delete neutral.allowDuplicateTargets;
  delete neutral.requiredPayCostAmount;
  delete neutral.requiredCountCostAmount;
  delete neutral.requiredCountCostPlayer;
  neutral.actionId = neutral.actionId.replace(/:choice:\d+/, "");
  neutral.deferredChoiceIndexes = [action.choiceIndex!];
  neutral.targetMode = "none";
  neutral.requiredTargetCount = 0;
  neutral.targetEffectFilterTags = [];
  neutral.candidateTargetInstanceIds = [];
  neutral.availableChosenLifeCoreKinds = [];
  neutral.requiresChosenLifeCoreKind = false;

  return neutral;
}

/**
 * EffectStep.choice はカード本文上ひとつの効果であり、枝ごとの宣言 action に分割しない。
 * availability は従来どおり枝単位で合法性を評価し、その結果だけを一つの宣言へ集約する。
 */
export function collapseDeferredEffectStepChoiceDeclarations(
  actions: readonly LegalAction[]
): LegalAction[] {
  const collapsed: LegalAction[] = [];
  const indexByBaseActionId = new Map<string, number>();

  for (const action of actions) {
    if (!isChoiceDeclarationLegalAction(action)) {
      collapsed.push(action);
      continue;
    }
    const baseActionId = action.actionId.replace(/:choice:\d+/, "");
    const groupKey = `${action.kind}:${baseActionId}`;
    const existingIndex = indexByBaseActionId.get(groupKey);
    if (existingIndex === undefined) {
      indexByBaseActionId.set(groupKey, collapsed.length);
      collapsed.push(makeDeferredChoiceDeclaration(action));
      continue;
    }
    const existing = collapsed[existingIndex] as ChoiceDeclarationLegalAction;
    collapsed[existingIndex] = {
      ...existing,
      deferredChoiceIndexes: [
        ...(existing.deferredChoiceIndexes ?? []),
        action.choiceIndex!,
      ],
    } as LegalAction;
  }

  return collapsed;
}

/**
 * P3-35: 開いている stack window の responder（priorityPlayerId）に
 * 「能動的なスタック選択肢」が 1 件以上存在するかを返す。
 *
 * - `pass_stack` は数えない（常時存在するため判定に意味がない）。
 * - UI のボタン出し分け用。auto-pass には使わない（PvP timing tell 防止 — `pass_stack`
 *   ボタンは選択肢の有無に関わらず常時表示する設計）。
 *
 * stack window が開いていない場合は false を返す。
 */
export function hasActiveStackOptions(
  options: GetLegalActionsOptions
): boolean {
  const stackWindow = options.state.stackWindow;
  if (stackWindow === null) return false;
  const responderId = stackWindow.priorityPlayerId;
  const responderOptions: GetLegalActionsOptions =
    options.actingPlayerId === responderId
      ? options
      : { ...options, actingPlayerId: responderId };
  if (isStackResponseSuppressed(responderOptions)) return false;
  if (getAvailableFlashFieldCardEffectLegalActions(responderOptions).length > 0)
    return true;
  if (getAvailableMagicLegalActions(responderOptions).length > 0) return true;
  if (getAvailableAccelLegalActions(responderOptions).length > 0) return true;
  if (getAvailableChangeLegalActions(responderOptions).length > 0) return true;
  if (
    getAvailableHandActivatedEffectLegalActions(
      responderOptions,
      getCurrentMagicActionTimings(responderOptions)
    ).length > 0
  )
    return true;
  if (getAvailableAdventLegalActions(responderOptions).length > 0) return true;
  if (getAvailableDualHostAdventLegalActions(responderOptions).length > 0)
    return true;
  if (getAvailableManifestLegalActions(responderOptions).length > 0)
    return true;
  if (getAvailableDivineSkillLegalActions(responderOptions).length > 0)
    return true;
  return false;
}

function isStackResponseSuppressed(options: GetLegalActionsOptions): boolean {
  return isOpenStackResponseSuppressedForPlayer(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
}

function getLegalActionsInner(options: GetLegalActionsOptions): LegalAction[] {
  // ゲーム終了後はアクション不可
  if (options.state.gameResult !== null) {
    return [];
  }

  // プレゲーム (じゃんけん / マリガン) 中はゲーム内アクション不可。
  // preGame は pregame_complete 確定時に null 化されるため、非 null = ゲーム未開始。
  // じゃんけん/マリガンは applyPregameUpdate (別経路) で進行するため getLegalActions は空でよい。
  // これがないと T1 スタートステップ中のマリガン中に、start-step スコープの手札起動効果
  // (例: BSTH01-M01 パチュリー) やステップ送り等が誤って候補列挙される。
  if (options.state.preGame !== null) {
    return [];
  }

  // pending UI prompt (対象選択系: コア配分・ゾーン選択・対象リダイレクト等) の resolve_*
  // アクションは「解決者本人」にだけ返す。これがないと room モードで各クライアントが
  // 自分視点で getLegalActions したとき、解決者でない相手にも resolve_* が返り、
  // 相手にも対象選択モーダルが表示されて相手が解決できてしまう (BSTH01-R05 アクセルの
  // コア配分等)。サーバ /action も getCurrentActorPlayerIds で同じ gate をしている。
  // 注意: アタック中のブロック宣言 / flash / end_attack_step 等の「非アクティブ側が
  // 正当に行える操作」は pending prompt ではないので、ここでは gate しない (それらを
  // 含む getCurrentActorPlayerIds の top-level gate は防御側を消すため使わない)。
  const me = options.actingPlayerId;
  const pendingPromptLock = options.state.pendingPromptLock;
  if (
    pendingPromptLock !== null &&
    pendingPromptLock !== undefined &&
    !pendingPromptLock.resolverPlayerIds.includes(me)
  ) {
    return [];
  }
  const promptResolver = getPendingPromptResolverPlayerIds(options.state);
  if (promptResolver !== null && !promptResolver.has(me)) {
    return [];
  }

  // 合体スピリット破壊時のブレイヴ選択
  if (options.state.pendingBraveLeaveChoice !== null) {
    return getAvailableBraveLeaveChoiceLegalActions(options.state);
  }

  // アタック中ホスト離脱後のブレイヴ継続選択
  if (options.state.pendingBraveAttackContinuation !== null) {
    return getAvailableBraveAttackContinuationLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // 契約カードの魂状態置換選択 (相手起因でフィールドを離れる契約カードを「魂状態で残す /
  // 通常通り離れる」の二択, 08a_advent-rebirth-contract.md L126「相手によってフィールドを
  // 離れるとき、魂状態で残す選択可（ルールであり効果ではない）」)。flushPendingLeaves 内
  // checkSoulStateReplacement が pendingSoulStateReplacement を立てて当該離脱を保留するため、
  // 解決しないと deadlock する (resolveSoulStateReplacement は本番経路から未配線だった)。
  if (options.state.pendingSoulStateReplacement !== null) {
    return getAvailableSoulStateReplacementLegalActions(options.state);
  }

  // 煌臨元への追加置換選択 (相手起因でフィールドを離れる煌臨元候補カードの「煌臨元へ追加 /
  // トラッシュ」選択, 08a_advent-rebirth-contract.md L36 の逆操作)。flushPendingLeaves が
  // pendingAdventSourceReplacement を立てて当該離脱を保留するため、解決しないと deadlock する。
  if (options.state.pendingAdventSourceReplacement !== null) {
    return getAvailableAdventSourceReplacementLegalActions(options.state);
  }

  // 手元カード自己除外の置換選択 (「自分がこのカードを除外するとき、かわりに手札に戻せる」,
  // ENGINE-set-aside-exit-replacement-choice)。structured-card-replacement.ts の
  // executeRemoveFromGame 非フィールド分岐が pendingSetAsideExitReplacementChoice を立てて
  // 当該除外を保留するため、解決しないと deadlock する。
  if (
    options.state.pendingSetAsideExitReplacementChoice !== null &&
    options.state.pendingCoreSourceAllocation?.purpose !==
      "set_aside_exit_replacement"
  ) {
    return getAvailableSetAsideExitReplacementChoiceLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // DeckReveal pending は効果解決中に発生するため最優先
  if (options.state.pendingDeckReveal !== null) {
    return getAvailablePendingDeckRevealLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // ZoneSelection pending（search_deck, return_from_trash 等）
  if (options.state.pendingZoneSelection !== null) {
    return getAvailablePendingZoneSelectionLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // StepOptionalChoice (EffectStep.executionMode === "optional") の execute/decline 選択待ち
  if (options.state.pendingStepOptionalChoice !== null) {
    return getAvailablePendingStepOptionalChoiceLegalActions(options.state);
  }

  // EffectStep.choice の分岐選択待ち
  if (options.state.pendingStepChoice !== null) {
    return getAvailablePendingStepChoiceLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // ENGINE-battle-connect-repeat: 連続バトル続行/終了選択待ち (BSTH06-X03【三歩必殺】)。
  // バトル解決 (BP比較/ライフダメージ/バースト) 完了後、battle_end 誘発の前に立つため
  // 他 pending より先に解決させる。
  if (options.state.pendingConnectBattleDecision !== null) {
    return getAvailableConnectBattleDecisionLegalActions(options.state);
  }

  // grant_optional_deck_reveal_count_boost CE の apply/decline 選択待ち (BSLH01-X09)
  if (options.state.pendingDeckRevealCountBoostChoice !== null) {
    return getAvailablePendingDeckRevealCountBoostChoiceLegalActions(
      options.state
    );
  }

  // optional step 自身の target 選択待ち (execute 解決後に立つ)
  if (options.state.pendingStepOptionalTargetSelection !== null) {
    return getAvailablePendingStepOptionalTargetSelectionLegalActions(
      options.state
    );
  }

  // コスト先払い型ドロー枚数修正の任意コスト支払い判断（BSSL01-C03 等）。
  // ドローステップを中断して立てる pending。支払い or 辞退でシステムドローを再開する。
  if (options.state.pendingDrawStepCostChoice !== null) {
    return getAvailablePendingDrawStepCostChoiceLegalActions(options.state);
  }

  // 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』の可変枚数選択待ち
  // (BSTH02.7-M01 effects[0] 等)。解決後に additionalCostModifiers 付きで summon を再開する。
  if (options.state.pendingSummonCostExcludeChoice !== null) {
    return getAvailablePendingSummonCostExcludeChoiceLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを支払わずに
  // 召喚する』代替コスト支払い選択待ち (BSSL01-M02 effects[0,1])。解決後に
  // additionalCostModifiers 付きで summon を再開する。
  if (options.state.pendingSummonCostCoreMoveChoice !== null) {
    return getAvailablePendingSummonCostCoreMoveChoiceLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // 複数対象召喚のグループ化コストオーバーライド選択待ち (BSTH02.7-C06 branch2 等)。
  if (options.state.pendingGroupedSummonCostOverrideChoice !== null) {
    return getAvailablePendingGroupedSummonCostOverrideChoiceLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // ライフダメージ破棄コストゲート（discardCostGate。BSTH02.7-C05[1] 等）の pay/decline 選択待ち。
  if (options.state.pendingLifeDamageDiscardChoice !== null) {
    return getAvailablePendingLifeDamageDiscardChoiceLegalActions(
      options.state
    );
  }

  // 「自分の効果で自分のライフが増えるとき、増やす代わりに...」置換 pending
  // (life_gain_replacement CE。BSTH02.7-X03 effects[3])。replace/decline 選択待ち。
  if (options.state.pendingLifeGainReplacementChoice !== null) {
    return getAvailablePendingLifeGainReplacementChoiceLegalActions(
      options.state
    );
  }

  // CoreShoot pending（フィールドからのコアシュート対象選択）
  if (options.state.pendingCoreShootSelection !== null) {
    return getAvailablePendingCoreShootLegalActions(options.state);
  }

  // 効果対象選択 pending（コスト支払い + スタック窓クローズ後の効果対象選択、種別非依存）
  if (options.state.pendingEffectTargetSelection !== null) {
    return getAvailablePendingEffectTargetLegalActions(options.state);
  }

  if (options.state.pendingAsIfSoulCoreChoice !== null) {
    return getAvailablePendingAsIfSoulCoreChoiceLegalActions(options.state);
  }

  if (options.state.pendingEffectOptionalRepeatChoice !== null) {
    return getAvailablePendingEffectOptionalRepeatChoiceLegalActions(
      options.state
    );
  }

  if (options.state.pendingEffectOptionalRepeatCountSelection !== null) {
    return getAvailablePendingEffectOptionalRepeatCountLegalActions(
      options.state
    );
  }

  if (options.state.pendingBorrowedEffectChoice !== null) {
    return getAvailableBorrowedEffectChoiceLegalActions(options.state);
  }

  if (options.state.pendingBorrowedEffectTargetSelection !== null) {
    return getAvailableBorrowedEffectTargetLegalActions(options.state);
  }

  // pay-to-act コアゲート pending（フラッシュ/スタック効果発揮の前提コア除去、解決直前）
  if (options.state.pendingPayToActCoreGate !== null) {
    return getAvailablePendingPayToActCoreGateLegalActions(options.state);
  }

  if (options.state.pendingPayToActHandDiscardGate !== null) {
    return getAvailablePendingPayToActHandDiscardGateLegalActions(
      options.state
    );
  }

  // フィールドマジック使用前トリガー pending（BSAZ01-C12「戦力投入」、コスト支払い直前）。
  // trigger 済みの間は、戦力投入自身が通常マジック使用として in_use にいる間の
  // stack/core_distribute を先に完走する。完走後は中断元の use_magic を現在の盤面で
  // 再列挙し、支払い元を新たに選ばせる。
  const fieldMagicPreCostPending =
    options.state.pendingFieldMagicPreCostTrigger;
  const triggerMagicInUse =
    fieldMagicPreCostPending?.triggered === true &&
    getCardById(options.state, fieldMagicPreCostPending.triggerSourceInstanceId)
      ?.zone === "in_use";
  if (fieldMagicPreCostPending !== null && !triggerMagicInUse) {
    return getAvailablePendingFieldMagicPreCostTriggerLegalActions(options);
  }

  if (options.state.pendingEnterFieldPlacement !== null) {
    return getAvailablePendingEnterFieldPlacementLegalActions(options.state);
  }

  if (options.state.pendingBraveCombineChoice !== null) {
    return getAvailablePendingBraveCombineChoiceLegalActions(options.state);
  }

  // 手札/手元⇔トラッシュの1対1入替待ち（engine-atomic-hand-trash-swap-legal-action）
  if (options.state.pendingHandTrashSwapChoice !== null) {
    return getAvailableHandTrashSwapLegalActions(options.state);
  }

  if (options.state.pendingFieldHandSwapChoice !== null) {
    return getAvailableFieldHandSwapLegalActions(options.state);
  }

  // 転召（召喚手順内ステップ）の強制コア消費の対象選択（スタック窓クローズ後・場入り前）
  if (options.state.pendingTenshoSummon !== null) {
    return getAvailablePendingTenshoSummonLegalActions(options.state);
  }

  // 逆転醒 pattern2（裏返して配置/召喚）の支払い + 維持コア配置の選択
  if (options.state.pendingReverseRebirthSummon !== null) {
    return getAvailablePendingReverseRebirthSummonLegalActions(options.state);
  }

  // 転醒内蔵 postRebirthChoice の合体/コア配置選択。
  if (options.state.pendingStoneFlipCombine !== null) {
    return getAvailableStoneFlipCombineLegalActions(
      options.state,
      options.getCardDefinitionById
    );
  }

  // CoreSplit pending（複数移動先への配分選択: 小悪魔アクセル等）
  if (options.state.pendingCoreSplitSelection !== null) {
    return getAvailablePendingCoreSplitLegalActions(options.state);
  }

  // SplitSummonChoice pending（トークン体数+ゾーン具体カード集合の複合選択:
  // BSSL01-X01[5,6] 等, ENGINE-sequential-slot-choice）
  if (options.state.pendingSplitSummonChoice !== null) {
    return getAvailablePendingSplitSummonChoiceLegalActions(options.state);
  }

  // CoreCount pending（「コアN個まで」の数選択: BSTH01-X08 等, P3-88）
  if (options.state.pendingCoreCountSelection !== null) {
    return getAvailablePendingCoreCountSelectionLegalActions(options.state);
  }

  // CountSelection pending（「カウントを好きなだけ減らす」の数選択:
  // BSGE01-M02 等, ENGINE-cost-modify-additional-cost-value-dynamic-amount）
  if (options.state.pendingCountSelection !== null) {
    return getAvailablePendingCountSelectionLegalActions(options.state);
  }

  // DiscardSetBurstCountSelection pending（「バーストN個まで」の枚数選択:
  // BSTH09-X01 等, ENGINE-composite-heterogeneous-removal-budget）
  if (options.state.pendingDiscardSetBurstCountSelection !== null) {
    return getAvailablePendingDiscardSetBurstCountSelectionLegalActions(
      options.state
    );
  }

  // LifeCoreSelection pending（ライフ→任意先で通常/ソウル混在の持ち主選択）
  if (options.state.pendingLifeCoreSelection !== null) {
    return getAvailablePendingLifeCoreSelectionLegalActions(options.state);
  }

  // CoreSourceAllocation pending（field_card コスト支払い配分: BSTH05-C11/C12 等）
  if (options.state.pendingCoreSourceAllocation !== null) {
    return getAvailableCoreSourceAllocationLegalActions(options.state);
  }

  // LinkAidCostSourceChoice pending（【リンクエイド】の効果文内コスト支払い元選択）
  if (options.state.pendingLinkAidCostSourceChoice !== null) {
    return getAvailablePendingLinkAidCostSourceChoiceLegalActions(
      options.state
    );
  }

  // EffectSummonCostPayment pending（効果文内 summon のコスト支払い元選択）
  if (options.state.pendingEffectSummonCostPayment !== null) {
    return getAvailablePendingEffectSummonCostPaymentLegalActions(
      options.state
    );
  }

  // P3-47 F-4: 効果対象リダイレクト prompt
  if (options.state.pendingTargetRedirects.length > 0) {
    return getAvailablePendingTargetRedirectLegalActions(options.state);
  }

  // Change cleanup pending（チェンジ効果後の破棄 / 入れ替え選択）
  if (options.state.pendingChangeCleanupChoice !== null) {
    return getAvailablePendingChangeCleanupChoiceLegalActions(options.state);
  }

  // CoreDistribution pending（トラッシュ→フィールド配分選択: BSTH01-M01 等）
  if (options.state.pendingCoreDistribution !== null) {
    return getAvailablePendingCoreDistributionLegalActions(options.state);
  }

  // P3-49: MultiPlacement pending（複数体同時召喚の per-target 配置選択）
  if (options.state.pendingMultiPlacement !== null) {
    return getAvailablePendingMultiPlacementLegalActions(options.state);
  }

  // P3-92: 神託/解封/創界石転醒は mechanic 付き pendingTriggeredEffects に統合され、
  // 下の getAvailablePendingTriggeredEffectLegalActions が resolve/skip を提示する。

  const scopedState = scopeInnermostTriggerReactions(options.state);
  // 未成立の観測記録は同時誘発の操作数/順序選択に数えない。実状態には保持する。
  const resolutionState = {
    ...scopedState,
    pendingTriggeredEffects: getPendingTriggeredEffectsForResolution(options),
  };
  const nonDeferredPrivateDeclarations =
    resolutionState.pendingPrivateDeclarations.filter(
      (declaration) =>
        !isDeferredFlashUsePrivateDeclaration(options.state, declaration)
    );
  const highestPendingTriggerPriority = getHighestTriggerPriority([
    ...nonDeferredPrivateDeclarations,
    ...resolutionState.pendingTriggeredEffects,
  ]);
  const hasPriorityPrivateDeclarations = nonDeferredPrivateDeclarations.some(
    (declaration) =>
      getTriggerPriority(declaration) === highestPendingTriggerPriority
  );
  const isImmediateTriggerPriority =
    highestPendingTriggerPriority === "immediate";

  const privateDeclarationActions =
    getAvailablePrivateTriggeredEffectDeclarationLegalActions(options);

  if (isImmediateTriggerPriority) {
    if (privateDeclarationActions.length > 0) {
      return privateDeclarationActions;
    }
    if (hasPriorityPrivateDeclarations) {
      return [];
    }
  }

  if (options.state.stackWindow === null && !isImmediateTriggerPriority) {
    const pendingBurstCheckActions =
      getAvailablePendingBurstCheckLegalActions(options);

    if (pendingBurstCheckActions.length > 0) {
      return pendingBurstCheckActions;
    }

    if (hasPendingBurstActivationSelections(options.state)) {
      return [];
    }
  }

  if (!isImmediateTriggerPriority && privateDeclarationActions.length > 0) {
    return privateDeclarationActions;
  }

  // P3-86 案X: 発揮前無効化誘発 (flash-use) が対象フラッシュの応答窓中で deferred な間は、
  // ここで [] を返さず下の窓分岐 (スタックパス等) へ fall-through する。
  // deferred でない宣言 (他カード / 相手の宣言待ち) があるときのみ [] で待機する。
  if (!isImmediateTriggerPriority && hasPriorityPrivateDeclarations) {
    return [];
  }

  // P3-34: stack window が開いている間は stack 関連アクションのみ合法。
  // 同時誘発グループの未消化分や pendingTriggeredEffects はこの窓のクローズ後に再開する。
  // バースト発動時の stack window もこの分岐で扱う (pendingBurstChecks 残っていても pass を返す)。
  if (options.state.stackWindow !== null) {
    if (isStackResponseSuppressed(options)) {
      return getAvailablePassStackLegalActions(options);
    }
    return [
      ...getAvailableFlashFieldCardEffectLegalActions(options),
      ...getAvailableMagicLegalActions(options),
      ...getAvailableAccelLegalActions(options),
      ...getAvailableChangeLegalActions(options),
      ...getAvailableHandActivatedEffectLegalActions(
        options,
        getCurrentMagicActionTimings(options)
      ),
      // 非即時型の自己召喚/配置 permission。フラッシュ/スタック見出しの即時型は
      // getAvailableHandActivatedEffectLegalActions 側で扱う。
      ...getAvailableHandSummonPermissionLegalActions(options),
      ...getAvailableAdventLegalActions(options),
      ...getAvailableDualHostAdventLegalActions(options),
      ...getAvailableManifestLegalActions(options),
      ...getAvailableDivineSkillLegalActions(options),
      ...getAvailablePassStackLegalActions(options),
    ];
  }

  // 戦闘中のスタック応答も、残りの同時誘発より先に処理する。
  // 発揮宣言済みの効果への応答が終わるまで、次の効果は選択・宣言できない。
  if (
    options.state.activeAttack?.flashWindowState?.pendingStackAction != null
  ) {
    if (isStackResponseSuppressed(options)) {
      return getAvailablePassBattleFlashLegalActions(options);
    }
    return [
      ...getAvailableFlashFieldCardEffectLegalActions(options),
      ...getAvailableMagicLegalActions(options),
      ...getAvailableAccelLegalActions(options),
      ...getAvailableChangeLegalActions(options),
      ...getAvailableHandActivatedEffectLegalActions(
        options,
        getCurrentMagicActionTimings(options)
      ),
      // 非即時型の自己召喚/配置 permission。フラッシュ/スタック見出しの即時型は
      // getAvailableHandActivatedEffectLegalActions 側で扱う。
      ...getAvailableHandSummonPermissionLegalActions(options),
      ...getAvailableAdventLegalActions(options),
      ...getAvailableDualHostAdventLegalActions(options),
      ...getAvailableManifestLegalActions(options),
      ...getAvailableDivineSkillLegalActions(options),
      ...getAvailablePassBattleFlashLegalActions(options),
    ];
  }

  // 同時誘発グループ: BattleImmediateEffect と PendingTriggeredEffect が
  // 同じ simultaneousGroupId を共有する場合、両方を選択肢として提示する。
  const sharedSimultaneousGroupIds =
    getSharedSimultaneousGroupIds(resolutionState);

  if (sharedSimultaneousGroupIds.size > 0) {
    const pendingTriggeredEffectActions =
      getAvailablePendingTriggeredEffectLegalActions(options);
    const battleImmediateEffectActions =
      getAvailableBattleImmediateEffectLegalActions(options);
    const combined = [
      ...pendingTriggeredEffectActions,
      ...battleImmediateEffectActions,
    ];
    if (combined.length > 0) {
      return combined;
    }
    // 両方とも actions が空なら通常の優先順位に fallthrough
  }

  const pendingTriggeredEffectActions =
    getAvailablePendingTriggeredEffectLegalActions(options);

  if (pendingTriggeredEffectActions.length > 0) {
    return pendingTriggeredEffectActions;
  }

  if (resolutionState.pendingTriggeredEffects.length > 0) {
    return [];
  }

  const battleImmediateEffectActions =
    getAvailableBattleImmediateEffectLegalActions(options);

  if (battleImmediateEffectActions.length > 0) {
    return battleImmediateEffectActions;
  }

  if (resolutionState.battleImmediateEffects.length > 0) {
    return [];
  }

  if (options.state.preDeclarationStackWindow !== null) {
    if (isStackResponseSuppressed(options)) {
      return getAvailablePassPreDeclarationStackLegalActions(options);
    }
    return [
      ...getAvailableFlashFieldCardEffectLegalActions(options),
      ...getAvailableMagicLegalActions(options),
      ...getAvailableAccelLegalActions(options),
      ...getAvailableChangeLegalActions(options),
      ...getAvailableHandActivatedEffectLegalActions(
        options,
        getCurrentMagicActionTimings(options)
      ),
      // 非即時型の自己召喚/配置 permission。フラッシュ/スタック見出しの即時型は
      // getAvailableHandActivatedEffectLegalActions 側で扱う。
      ...getAvailableHandSummonPermissionLegalActions(options),
      ...getAvailableAdventLegalActions(options),
      ...getAvailableDualHostAdventLegalActions(options),
      ...getAvailableManifestLegalActions(options),
      ...getAvailableDivineSkillLegalActions(options),
      ...getAvailablePassPreDeclarationStackLegalActions(options),
    ];
  }

  const immediateAttackJoins = getImmediateAttackJoinDecisions(options);
  if (immediateAttackJoins.length > 0) {
    return immediateAttackJoins.filter(
      (action) => action.actingPlayerId === options.actingPlayerId
    );
  }

  const flashFieldCardEffectActions =
    getAvailableFlashFieldCardEffectLegalActions(options);
  const magicLegalActions = getAvailableMagicLegalActions(options);
  const passBattleFlashActions =
    getAvailablePassBattleFlashLegalActions(options);

  if (options.state.activeAttack?.flashWindowState) {
    return [
      ...flashFieldCardEffectActions,
      ...magicLegalActions,
      ...getAvailableAccelLegalActions(options),
      ...getAvailableHandActivatedEffectLegalActions(
        options,
        getCurrentMagicActionTimings(options)
      ),
      // 非即時型の自己召喚/配置 permission。フラッシュ見出しの「召喚/配置できる」は
      // getAvailableHandActivatedEffectLegalActions 側で扱う。
      ...getAvailableHandSummonPermissionLegalActions(options),
      // 「フラッシュ【契約合体：…『お互いのアタックステップ』】」(BSGE01-C06/C08 等)。
      // 上記と同型: timingScope で自己限定するためフラッシュ窓でも提示する (P3-111 S2)。
      ...getAvailableContractCombineLegalActions(options),
      // 「【リンクエイド】フラッシュ『お互いのアタックステップ』」(BSGE01-CX01〜CX04/R01〜R05)。
      // 上記と同型: timingScope で自己限定するためフラッシュ窓でも提示する (P3-111 S6)。
      ...getAvailableLinkAidLegalActions(options),
      ...getAvailableChangeLegalActions(options),
      ...getAvailableAdventLegalActions(options),
      ...getAvailableDualHostAdventLegalActions(options),
      ...getAvailableManifestLegalActions(options),
      ...getAvailableDivineSkillLegalActions(options),
      ...passBattleFlashActions,
    ];
  }

  const openBattleFlashActions =
    getAvailableOpenBattleFlashLegalActions(options);

  if (openBattleFlashActions.length > 0) {
    return openBattleFlashActions;
  }

  return [
    ...flashFieldCardEffectActions,
    ...magicLegalActions,
    ...getAvailableAccelLegalActions(options),
    ...getAvailableChangeLegalActions(options),
    ...getAvailableAdventLegalActions(options),
    ...getAvailableDualHostAdventLegalActions(options),
    ...getAvailableManifestLegalActions(options),
    ...(canEnumerateMainHandCardActions(options.state, options.actingPlayerId)
      ? getAvailableFieldCardEffectLegalActions(options)
      : []),
    // 手札起動効果は timingScope で自らステップを限定するため main 限定ゲートを通さない。
    ...getAvailableHandSummonPermissionLegalActions(options),
    ...getAvailableHandActivatedEffectLegalActions(options),
    ...getAvailableSetBurstLegalActions(options),
    ...getAvailableSetMirageLegalActions(options),
    ...getAvailableSetQuartzLegalActions(options),
    ...getAvailableActivateSoulStateLegalActions(options),
    ...getAvailableHandCardLegalActions(options),
    ...getAvailableAttackLegalActions(options),
    ...getAvailableFlipInsteadOfAttackLegalActions(options),
    ...getAvailableBlockLegalActions(options),
    ...getAvailableDeclineBlockLegalActions(options),
    ...getAvailableEndAttackStepLegalActions(options),
    ...getAvailableBraveCombineLegalActions(options),
    ...getAvailableContractCombineLegalActions(options),
    ...getAvailableLinkAidLegalActions(options),
    ...getAvailableBraveSeparateLegalActions(options),
    ...getAvailableBraveSwapLegalActions(options),
    ...getAvailableDivineSkillLegalActions(options),
  ];
}

/**
 * pendingDeckReveal がある場合の LegalAction を返す。
 */
function getAvailablePendingDeckRevealLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: (
    id: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingDeckReveal;
  if (!pending) return [];
  const handGainCost =
    pending.handGainCostDecision === "declined"
      ? 0
      : getDeckRevealHandGainCost(state, pending);

  if (pending.phase === "revealed_choice") {
    // revealed 自動手札追加の選択フェーズ
    const candidates = getDeckRevealRevealedChoiceCandidateIds({
      state,
      pending,
      getCardDefinitionById,
    });
    return [
      {
        kind: "resolve_pending_deck_reveal_pick" as const,
        actionId: `dr-revealed-choice`,
        can: true as const,
        reason: "deck_reveal_revealed_choice",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        pickIndex: -1,
        handGainCost,
        candidateCardInstanceIds: candidates,
        maxPickCount: getDeckRevealRevealedChoiceMaxPickCount({
          state,
          pending,
          candidateIds: candidates,
          getCardDefinitionById,
        }),
        canSkip: true,
      },
    ];
  }

  if (pending.phase === "picking") {
    const pick = pending.picks[pending.currentPickIndex];
    if (!pick) {
      // picks が空 or 全グループ完了 → ordering フェーズへ遷移
      const remainingIds = pending.revealedCardInstanceIds.filter(
        (id) => !pending.pickedCardInstanceIds.includes(id)
      );
      const orderCandidateIds = getDeckRevealRemainderOrderCandidateIds(
        pending,
        remainingIds
      );
      const orderableRemainingIds = getDeckRevealOrderableRemainderIds(
        state,
        pending,
        getCardDefinitionById,
        orderCandidateIds
      );
      return [
        {
          kind: "resolve_pending_deck_reveal_order" as const,
          actionId: "dr-order",
          can: true as const,
          reason: "deck_reveal_order_remainder",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          remainingCardInstanceIds: orderableRemainingIds,
          remainder: pending.remainder,
        },
      ];
    }
    if (pick.exclusiveGroup) {
      const branches = getDeckRevealExclusiveGroupBranches(
        state,
        pending,
        pending.currentPickIndex,
        getCardDefinitionById
      );
      const candidateIds = [
        ...new Set(branches.flatMap((b) => b.candidateIds)),
      ];
      const groupIsMandatory = branches.some((b) => b.pick.mandatory);
      const allEmpty = branches.every((b) => b.candidateIds.length === 0);
      const requiresFreeDestinationChoice = branches.some(
        (b) => b.pick.destination === "hand_or_set_aside_choice"
      );
      const freeDestinationChoices = requiresFreeDestinationChoice
        ? deckRevealFreeDestinationChoices(
            state,
            pending,
            getCardDefinitionById
          )
        : undefined;
      return [
        {
          kind: "resolve_pending_deck_reveal_pick" as const,
          actionId: `dr-pick-${pending.currentPickIndex}`,
          can: true as const,
          reason: `deck_reveal_pick_group_${pending.currentPickIndex}`,
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          pickIndex: pending.currentPickIndex,
          candidateCardInstanceIds: candidateIds,
          maxPickCount: Math.max(0, ...branches.map((b) => b.requiredCount)),
          canSkip:
            !groupIsMandatory ||
            allEmpty ||
            (handGainCost > 0 &&
              branches.some(
                (b) =>
                  (b.pick.destination ?? "hand") === "hand" &&
                  b.candidateIds.length > 0
              )),
          handGainCost: branches.some(
            (b) =>
              (b.pick.destination ?? "hand") === "hand" &&
              b.candidateIds.length > 0
          )
            ? handGainCost
            : 0,
          exclusiveGroupBranches: branches.map((b) => ({
            count: b.requiredCount,
            candidateCardInstanceIds: b.candidateIds,
            ...(b.pick.costGate !== undefined
              ? { costGate: b.pick.costGate }
              : {}),
          })),
          requiresFreeDestinationChoice,
          ...(freeDestinationChoices?.length === 1
            ? { freeDestinationChoices }
            : {}),
        },
      ];
    }

    const candidates = getDeckRevealSelectablePickCandidateIds(
      state,
      pending,
      pick,
      getCardDefinitionById
    );
    const requiresFreeDestinationChoice =
      pick.destination === "hand_or_set_aside_choice";
    const freeDestinationChoices = requiresFreeDestinationChoice
      ? deckRevealFreeDestinationChoices(state, pending, getCardDefinitionById)
      : undefined;

    return [
      {
        kind: "resolve_pending_deck_reveal_pick" as const,
        actionId: `dr-pick-${pending.currentPickIndex}`,
        can: true as const,
        reason: `deck_reveal_pick_group_${pending.currentPickIndex}`,
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        pickIndex: pending.currentPickIndex,
        candidateCardInstanceIds: candidates,
        maxPickCount: pick.count < 0 ? candidates.length : pick.count,
        canSkip:
          !pick.mandatory ||
          candidates.length === 0 ||
          (handGainCost > 0 && (pick.destination ?? "hand") === "hand"),
        handGainCost:
          candidates.length > 0 &&
          ((pick.destination ?? "hand") === "hand" ||
            pick.destination === "hand_or_set_aside_choice")
            ? handGainCost
            : 0,
        requiresFreeDestinationChoice,
        ...(freeDestinationChoices?.length === 1
          ? { freeDestinationChoices }
          : {}),
      },
    ];
  }

  // ordering フェーズ
  const remainingIds = pending.revealedCardInstanceIds.filter(
    (id) => !pending.pickedCardInstanceIds.includes(id)
  );
  const orderCandidateIds = getDeckRevealRemainderOrderCandidateIds(
    pending,
    remainingIds
  );
  const orderableRemainingIds = getDeckRevealOrderableRemainderIds(
    state,
    pending,
    getCardDefinitionById,
    orderCandidateIds
  );
  return [
    {
      kind: "resolve_pending_deck_reveal_order" as const,
      actionId: `dr-order`,
      can: true as const,
      reason: "deck_reveal_order_remainder",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      remainingCardInstanceIds: orderableRemainingIds,
      remainder: pending.remainder,
    },
  ];
}

function getAvailablePendingZoneSelectionLegalActions(
  state: import("../model").GameState,
  getDefinition: GetLegalActionsOptions["getCardDefinitionById"]
): LegalAction[] {
  const pending = state.pendingZoneSelection;
  if (!pending) return [];

  const perCardDestinationChoices =
    pending.destination === "hand_or_set_aside_choice"
      ? (Object.fromEntries(
          pending.candidateCardInstanceIds.map((id) => {
            const card = getCardById(state, id);
            const recipientPlayerId =
              pending.targetPlayerId ??
              card?.ownerPlayerId ??
              pending.actingPlayerId;
            return [
              id,
              handOrSetAsideDestinationChoices(
                state,
                recipientPlayerId,
                pending.effectActingPlayerId ?? pending.actingPlayerId,
                getZoneSelectionHandGainCost(state, pending, [id]) > 0,
                pending,
                getDefinition
              ),
            ];
          })
        ) as Record<string, Array<"hand" | "set_aside">>)
      : undefined;

  return [
    {
      kind: "resolve_pending_zone_selection" as const,
      actionId: `zs-${pending.actionKind}`,
      can: true as const,
      reason: `zone_selection_${pending.actionKind}`,
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      actionKind: pending.actionKind,
      candidateCardInstanceIds: pending.candidateCardInstanceIds,
      maxCount: pending.maxCount,
      canSkip: pending.canSkip ?? true,
      handGainCost: getZoneSelectionHandGainCost(state, pending),
      ...(pending.swapAllowsPlacementChoice === true
        ? { swapPlacementOptions: ["top" as const, "bottom" as const] }
        : {}),
      ...(pending.destination === "hand_or_set_aside_choice"
        ? {
            requiresPerCardDestinationChoice: true,
            perCardDestinationChoices: perCardDestinationChoices!,
          }
        : {}),
      ...(pending.alternateSelections && pending.alternateSelections.length > 0
        ? { alternateSelections: pending.alternateSelections }
        : {}),
    },
  ];
}

function getAvailablePendingStepOptionalChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingStepOptionalChoice;
  if (!pending) return [];
  // execute / decline は同じ pending に対する 2 択。choice フィールドが SSOT で、
  // GUI / API passthrough は action.choice をそのまま読む (actionId suffix を解釈しない)。
  // chooser='opponent' のとき choosingPlayerId は相手プレイヤーになり、apply 時の
  // 権限検証もこの ID で照合する (PendingStepOptionalTargetSelection §750 と同 SSOT)。
  const base = {
    kind: "resolve_pending_step_optional_choice" as const,
    can: true as const,
    actingPlayerId: pending.choosingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    effectIndex: pending.effectIndex,
    stepIndex: pending.stepIndex,
    ...(pending.stepLabel !== undefined
      ? { stepLabel: pending.stepLabel }
      : {}),
    ...(pending.prompt !== undefined ? { prompt: pending.prompt } : {}),
    ...(pending.optionalQuantity !== undefined
      ? {
          minAmount: pending.optionalQuantity.min,
          maxAmount: pending.optionalQuantity.max,
          quantityKind: pending.optionalQuantity.kind,
        }
      : {}),
  };
  const actions: LegalAction[] = [];
  if (pending.canExecute !== false) {
    const maxAmount = pending.optionalQuantity?.max;
    if (pending.optionalQuantity !== undefined) {
      for (
        let amount = Math.max(1, pending.optionalQuantity.min);
        amount < pending.optionalQuantity.max;
        amount++
      ) {
        actions.push({
          ...base,
          actionId: `pso-${pending.pendingId}:amount-${amount}`,
          reason: "pending_step_optional_choice_execute_quantity",
          choice: "execute",
          selectedAmount: amount,
        });
      }
    }
    actions.push({
      ...base,
      actionId: `pso-${pending.pendingId}:execute`,
      reason: "pending_step_optional_choice_execute",
      choice: "execute",
      ...(maxAmount !== undefined ? { selectedAmount: maxAmount } : {}),
    });
  }
  if (pending.canDecline !== false) {
    actions.push({
      ...base,
      actionId: `pso-${pending.pendingId}:decline`,
      reason: "pending_step_optional_choice_decline",
      choice: "decline",
    });
  }
  return actions;
}

function getAvailablePendingStepChoiceLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: GetLegalActionsOptions["getCardDefinitionById"]
): LegalAction[] {
  const pending = state.pendingStepChoice;
  if (!pending) return [];
  return pending.choices
    .filter((choice) =>
      canPayRequiredEffectCosts(
        state,
        pending.actingPlayerId,
        choice,
        getCardDefinitionById,
        [],
        {},
        {
          sourceInstanceId: pending.sourceInstanceId,
          sourceDefinitionId: pending.sourceDefinitionId,
          effectIndex: pending.effectIndex,
          continuation: pending.continuation,
        }
      )
    )
    .map((choice) => ({
      kind: "resolve_pending_step_choice" as const,
      actionId: `psc-${pending.pendingId}:choice-${choice.choiceIndex}`,
      can: true as const,
      reason: "pending_step_choice",
      actingPlayerId: pending.choosingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      effectIndex: pending.effectIndex,
      stepIndex: pending.stepIndex,
      choiceIndex: choice.choiceIndex,
      choiceLabel: choice.label,
      ...(choice.requiredPayCostAmount !== undefined
        ? { requiredPayCostAmount: choice.requiredPayCostAmount }
        : {}),
      ...(pending.stepLabel !== undefined
        ? { stepLabel: pending.stepLabel }
        : {}),
      ...(pending.prompt !== undefined ? { prompt: pending.prompt } : {}),
      ...(choice.prompt !== undefined ? { choicePrompt: choice.prompt } : {}),
    }));
}

/**
 * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 連続バトル続行/終了選択待ち
 * (BSTH06-X03【三歩必殺】)。continue=続行, end=終了 の 2 択。choice フィールドが SSOT。
 */
function getAvailableConnectBattleDecisionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingConnectBattleDecision;
  if (!pending) return [];
  const base = {
    kind: "resolve_connect_battle_decision" as const,
    can: true as const,
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    remainingUses: pending.remainingUses,
  };
  return [
    {
      ...base,
      actionId: `cbd-${pending.pendingId}:continue`,
      reason: "connect_battle_decision_continue",
      choice: "continue",
    },
    {
      ...base,
      actionId: `cbd-${pending.pendingId}:end`,
      reason: "connect_battle_decision_end",
      choice: "end",
    },
  ];
}

function getAvailablePendingDeckRevealCountBoostChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingDeckRevealCountBoostChoice;
  if (!pending) return [];
  const base = {
    kind: "resolve_pending_deck_reveal_count_boost_choice" as const,
    can: true as const,
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    effectIndex: pending.effectIndex,
    stepIndex: pending.stepIndex,
    bonusAmount: pending.bonusAmount,
  };
  return [
    {
      ...base,
      actionId: `drcb-${pending.pendingId}:apply`,
      reason: "pending_deck_reveal_count_boost_apply",
      choice: "apply",
    },
    {
      ...base,
      actionId: `drcb-${pending.pendingId}:decline`,
      reason: "pending_deck_reveal_count_boost_decline",
      choice: "decline",
    },
  ];
}

function getAvailablePendingStepOptionalTargetSelectionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingStepOptionalTargetSelection;
  if (!pending) return [];
  // forced_target_inclusion タウント: apply 側 (pending-action-handlers.ts) と同じ
  // actingPlayerId (= effect 発動者。choosingPlayerId とは別) で必須対象を求め、GUI/AI が
  // 選択前に「除外できない候補」を知れるようにする (legal-actions 列挙側への配線)。
  const mandatoryTargetInstanceIds = getMandatoryForcedTargetInclusionIds(
    state,
    pending.actingPlayerId,
    pending.candidateInstanceIds,
    pending.maxTargetCount
  );
  return [
    {
      kind: "resolve_pending_step_optional_target_selection" as const,
      actionId: `psots-${pending.pendingId}`,
      can: true as const,
      reason: "pending_step_optional_target_selection",
      // chooser='opponent' のとき choosingPlayerId は相手プレイヤーになり、apply 時の
      // 権限検証もこの ID で照合する。effect 発動者 (actingPlayerId) は pending 本体に保持。
      actingPlayerId: pending.choosingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      effectIndex: pending.effectIndex,
      stepIndex: pending.stepIndex,
      requiredTargetCount: pending.requiredTargetCount,
      maxTargetCount: pending.maxTargetCount,
      ...(pending.bpBudgetAmount !== undefined
        ? { bpBudgetAmount: pending.bpBudgetAmount }
        : {}),
      ...(pending.costBudgetAmount !== undefined
        ? { costBudgetAmount: pending.costBudgetAmount }
        : {}),
      ...(pending.symbolBudgetAmount !== undefined
        ? { symbolBudgetAmount: pending.symbolBudgetAmount }
        : {}),
      candidateTargetInstanceIds: pending.candidateInstanceIds,
      ...(pending.stepLabel !== undefined
        ? { stepLabel: pending.stepLabel }
        : {}),
      ...(mandatoryTargetInstanceIds.length > 0
        ? { mandatoryTargetInstanceIds }
        : {}),
    },
  ];
}

function getAvailablePendingDrawStepCostChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingDrawStepCostChoice;
  if (!pending) return [];
  const entry = pending.entries[0];
  if (!entry) return [];

  return [
    {
      kind: "resolve_pending_draw_step_cost_choice" as const,
      actionId: `dscc-${entry.sourceInstanceId}-${entry.effectIndex}`,
      can: true as const,
      reason: "pending_draw_step_cost_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: entry.sourceInstanceId,
      candidateCardInstanceIds: entry.candidateCardInstanceIds,
      bonus: entry.bonus,
    },
  ];
}

function getAvailablePendingSummonCostExcludeChoiceLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: (
    definitionId: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingSummonCostExcludeChoice;
  if (!pending) return [];
  const sourceCard = getCardById(state, pending.sourceInstanceId);
  const sourceDefinition = getCardDefinitionById(pending.sourceDefinitionId);
  if (!sourceCard || !sourceDefinition) return [];

  const paymentSources = getAvailableCardCostPaymentSources({
    state,
    actingPlayerId: pending.actingPlayerId,
    card: sourceDefinition,
    getCardDefinitionById,
    sourceInstanceId: sourceCard.instanceId,
    ...(pending.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
      : {}),
  });

  return [
    {
      kind: "resolve_pending_summon_cost_exclude_choice" as const,
      actionId: `scec-${pending.sourceInstanceId}-${pending.effectIndex}`,
      can: true as const,
      reason: "pending_summon_cost_exclude_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      sourceCardNo: sourceDefinition.cardNo,
      candidateCardInstanceIds: pending.candidateCardInstanceIds,
      maxCount: pending.maxCount,
      ...(pending.minCount !== undefined ? { minCount: pending.minCount } : {}),
      discountPerCard: pending.discountPerCard,
      ...(pending.fullCostPaid
        ? {
            fullCostPaid: true,
            remainingPaymentCost: calculateFullyPaidSummonRemainingCost(
              state,
              pending.actingPlayerId,
              sourceDefinition,
              sourceCard,
              getCardDefinitionById,
              pending.effectSummonActivationZone ? "effect" : undefined
            ),
          }
        : {}),
      printedCost: paymentSources.reduction.printedCost,
      reducedCost: paymentSources.reduction.reducedCost,
      ...(pending.fullReduction
        ? {
            fullReduction: true as const,
            fullReductionCost: calculateFullReductionSummonCost({
              state,
              actingPlayerId: pending.actingPlayerId,
              definition: sourceDefinition,
              sourceInstanceId: sourceCard.instanceId,
              getCardDefinitionById,
            }),
          }
        : {}),
      availableReserveCoreAmount:
        paymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
      availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
      ...(pending.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
        : {}),
    },
  ];
}

function getAvailablePendingSummonCostCoreMoveChoiceLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: (
    definitionId: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingSummonCostCoreMoveChoice;
  if (!pending) return [];
  const sourceCard = getCardById(state, pending.sourceInstanceId);
  const sourceDefinition = getCardDefinitionById(pending.sourceDefinitionId);
  if (!sourceCard || !sourceDefinition) return [];

  const paymentSources = getAvailableCardCostPaymentSources({
    state,
    actingPlayerId: pending.actingPlayerId,
    card: sourceDefinition,
    getCardDefinitionById,
    sourceInstanceId: sourceCard.instanceId,
    ...(pending.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
      : {}),
  });

  return [
    {
      kind: "resolve_pending_summon_cost_core_move_choice" as const,
      actionId: `sccmc-${pending.sourceInstanceId}-${pending.effectIndex}`,
      can: true as const,
      reason: "pending_summon_cost_core_move_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      sourceCardNo: sourceDefinition.cardNo,
      minCount: pending.minCount,
      availableCoreCount: pending.availableCoreCount,
      costOffset: pending.costOffset,
      ...(pending.grantsFreeSummon
        ? {
            grantsFreeSummon: true,
            remainingPaymentCost: calculateFreeSummonCost({
              state,
              actingPlayerId: pending.actingPlayerId,
              definition: sourceDefinition,
              sourceInstanceId: sourceCard.instanceId,
              getCardDefinitionById,
              ...(pending.effectSummonActivationZone !== undefined
                ? { summonCause: "effect" as const }
                : {}),
            }),
          }
        : {}),
      printedCost: paymentSources.reduction.printedCost,
      reducedCost: paymentSources.reduction.reducedCost,
      fieldDestinationCandidateInstanceIds:
        pending.fieldDestinationCandidateInstanceIds,
      ...(pending.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
        : {}),
    },
  ];
}

function getAvailablePendingGroupedSummonCostOverrideChoiceLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: (
    definitionId: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingGroupedSummonCostOverrideChoice;
  if (!pending) return [];
  const sourceDefinition = getCardDefinitionById(pending.sourceDefinitionId);
  if (!sourceDefinition) return [];

  return [
    {
      kind: "resolve_pending_grouped_summon_cost_override_choice" as const,
      actionId: `gscoc-${pending.pendingId}`,
      can: true as const,
      reason: "pending_grouped_summon_cost_override_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      sourceCardNo: sourceDefinition.cardNo,
      candidateCardInstanceIds: pending.candidateCardInstanceIds,
      maxCount: pending.maxCount,
      groupSize: pending.groupSize,
      overrideCost: pending.overrideCost,
      summonTargetInstanceIds: [...pending.summonTargetInstanceIds],
    },
  ];
}

function getAvailablePendingLifeDamageDiscardChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingLifeDamageDiscardChoice;
  if (!pending) return [];
  const entry = pending.entries[0];
  if (!entry) return [];

  return [
    {
      kind: "resolve_pending_life_damage_discard_choice" as const,
      actionId: `ldc-${entry.sourceInstanceId}`,
      can: true as const,
      reason: "pending_life_damage_discard_choice",
      actingPlayerId: pending.decidingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: entry.sourceInstanceId,
      pendingAmount: pending.pendingAmount,
      ...(entry.costKind ? { costKind: entry.costKind } : {}),
    },
  ];
}

function getAvailablePendingLifeGainReplacementChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingLifeGainReplacementChoice;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_life_gain_replacement_choice" as const,
      actionId: `lgr-${pending.pendingId}`,
      can: true as const,
      reason: "pending_life_gain_replacement_choice",
      actingPlayerId: pending.decidingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      amount: pending.amount,
    },
  ];
}

function getAvailablePendingCoreShootLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCoreShootSelection;
  if (!pending) return [];

  // forced_target_inclusion タウント: apply 側 (effect-target-handlers.ts) と同じ
  // totalAmount 相当 (=各対象へ最低1個ずつ割り振れる必要がある枠) で必須対象を求める。
  const mandatoryTargetInstanceIds = Array.from(
    new Set([
      ...(pending.mandatoryTargetInstanceIds ?? []),
      ...getMandatoryForcedTargetInclusionIds(
        state,
        pending.actingPlayerId,
        pending.candidates.map((c) => c.instanceId),
        pending.totalAmount
      ),
    ])
  );

  return [
    {
      kind: "resolve_pending_core_shoot" as const,
      actionId: `cs-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_shoot_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      candidates: pending.candidates,
      ...(pending.sourceGroupMinimums
        ? { sourceGroupMinimums: pending.sourceGroupMinimums }
        : {}),
      totalAmount: pending.totalAmount,
      ...(pending.minTotal !== undefined ? { minTotal: pending.minTotal } : {}),
      fromPlayerId: pending.fromPlayerId,
      ...(mandatoryTargetInstanceIds.length > 0
        ? { mandatoryTargetInstanceIds }
        : {}),
    },
  ];
}

function getAvailablePendingEffectTargetLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  if (!state.pendingEffectTargetSelection) return [];
  const pending = revalidatePendingEffectTargets(
    state,
    state.pendingEffectTargetSelection
  );
  const targetEffectFilterTags =
    pending.targetEffectFilterTags as readonly EffectFilterTag[];
  const candidateInstanceIds = pending.candidateInstanceIds;

  // forced_target_inclusion タウント: apply 側 (effect-target-handlers.ts) と同じ
  // actingPlayerId/candidateInstanceIds/maxTargetCount で必須対象を求め、GUI/AI が選択前に
  // 「除外できない候補」を知れるようにする (legal-actions 列挙側への配線)。
  const mandatoryTargetInstanceIds = getMandatoryForcedTargetInclusionIds(
    state,
    pending.actingPlayerId,
    candidateInstanceIds,
    pending.maxTargetCount
  );

  return [
    {
      kind: "resolve_pending_effect_target" as const,
      actionId: `et-${pending.pendingId}`,
      can: true as const,
      reason: "pending_effect_target_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      targetMode: "manual" as const,
      requiredTargetCount: pending.requiredTargetCount,
      ...(pending.maxTargetCount > pending.requiredTargetCount
        ? { maxTargetCount: pending.maxTargetCount }
        : {}),
      ...(pending.allowDuplicateTargets === true
        ? { allowDuplicateTargets: true }
        : {}),
      targetEffectFilterTags,
      candidateTargetInstanceIds: [...candidateInstanceIds],
      ...(pending.targetGroups !== undefined
        ? { targetGroups: pending.targetGroups }
        : {}),
      ...(mandatoryTargetInstanceIds.length > 0
        ? { mandatoryTargetInstanceIds }
        : {}),
    },
  ];
}

function getAvailablePendingAsIfSoulCoreChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingAsIfSoulCoreChoice;
  if (!pending) return [];

  return pending.options.map((option) => ({
    kind: "resolve_pending_as_if_soul_core_choice" as const,
    actionId: `as-if-soul-core-${pending.pendingId}-${option.choiceId}`,
    can: true as const,
    reason: "pending_as_if_soul_core_choice",
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    choiceId: option.choiceId,
    choiceLabel: option.label,
  }));
}

function getAvailablePendingEffectOptionalRepeatChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingEffectOptionalRepeatChoice;
  if (!pending) return [];

  return pending.choices.map((choice) => ({
    kind: "resolve_pending_effect_optional_repeat_choice" as const,
    actionId: `eorc-${pending.pendingId}:${choice.choiceIndex}`,
    can: true as const,
    reason: "pending_effect_optional_repeat_choice",
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    effectIndex: pending.effectIndex,
    repeatStepIndex: pending.repeatStepIndex,
    choiceIndex: choice.choiceIndex,
    choiceLabel: choice.label,
    maxAdditionalCount: pending.maxAdditionalCount,
  }));
}

function getAvailablePendingEffectOptionalRepeatCountLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingEffectOptionalRepeatCountSelection;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_effect_optional_repeat_count" as const,
      actionId: `eorcnt-${pending.pendingId}`,
      can: true as const,
      reason: "pending_effect_optional_repeat_count_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      effectIndex: pending.effectIndex,
      repeatStepIndex: pending.repeatStepIndex,
      targetPlayerId: pending.actingPlayerId,
      selectionMode: pending.selectionMode,
      min: pending.min,
      max: pending.max,
    },
  ];
}

function getAvailableBorrowedEffectChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingBorrowedEffectChoice;
  if (!pending) return [];
  return pending.candidates.map((candidate) => ({
    kind: "resolve_borrowed_effect_choice" as const,
    actionId: `bec-${pending.pendingId}:${candidate.effectIndex}:${candidate.grantedEffectCeId ?? candidate.effectSourceInstanceId ?? "printed"}`,
    can: true as const,
    reason: "pending_borrowed_effect_choice",
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    targetInstanceId: pending.targetInstanceId,
    targetDefinitionId: pending.targetDefinitionId,
    borrowedEffectIndex: candidate.effectIndex,
    ...(candidate.grantedEffectCeId !== undefined
      ? { grantedEffectCeId: candidate.grantedEffectCeId }
      : {}),
    ...(candidate.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: candidate.effectSourceInstanceId }
      : {}),
    ...(candidate.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: candidate.effectSourceDefinitionId }
      : {}),
    candidateEffects: pending.candidates,
  }));
}

function getAvailableBorrowedEffectTargetLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingBorrowedEffectTargetSelection;
  if (!pending) return [];
  const mandatoryTargetInstanceIds = getMandatoryForcedTargetInclusionIds(
    state,
    pending.actingPlayerId,
    pending.candidateInstanceIds,
    pending.maxTargetCount
  );
  return [
    {
      kind: "resolve_borrowed_effect_target" as const,
      actionId: `bet-${pending.pendingId}`,
      can: true as const,
      reason: "pending_borrowed_effect_target_selection",
      actingPlayerId: pending.choosingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      targetInstanceId: pending.targetInstanceId,
      targetDefinitionId: pending.targetDefinitionId,
      borrowedEffectIndex: pending.borrowedEffectIndex,
      ...(pending.grantedEffectCeId !== undefined
        ? { grantedEffectCeId: pending.grantedEffectCeId }
        : {}),
      ...(pending.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: pending.effectSourceInstanceId }
        : {}),
      ...(pending.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: pending.effectSourceDefinitionId }
        : {}),
      targetMode: "manual" as const,
      requiredTargetCount: pending.requiredTargetCount,
      ...(pending.maxTargetCount > pending.requiredTargetCount
        ? { maxTargetCount: pending.maxTargetCount }
        : {}),
      targetEffectFilterTags: [],
      candidateTargetInstanceIds: [...pending.candidateInstanceIds],
      ...(pending.bpBudgetAmount !== undefined
        ? { bpBudgetAmount: pending.bpBudgetAmount }
        : {}),
      ...(pending.costBudgetAmount !== undefined
        ? { costBudgetAmount: pending.costBudgetAmount }
        : {}),
      ...(pending.symbolBudgetAmount !== undefined
        ? { symbolBudgetAmount: pending.symbolBudgetAmount }
        : {}),
      ...(mandatoryTargetInstanceIds.length > 0
        ? { mandatoryTargetInstanceIds }
        : {}),
    },
  ];
}

function getAvailablePendingPayToActCoreGateLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingPayToActCoreGate;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pay_to_act_core_gate" as const,
      actionId: `pag-${pending.pendingId}`,
      can: true as const,
      reason: "pending_pay_to_act_core_gate",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.gateSourceInstanceId,
      sourceDefinitionId: pending.gateSourceDefinitionId,
      candidateContainerIds: pending.candidates.map((c) => c.containerId),
    },
  ];
}

function getAvailablePendingPayToActHandDiscardGateLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingPayToActHandDiscardGate;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pay_to_act_hand_discard_gate" as const,
      actionId: `pahd-${pending.pendingId}`,
      can: true as const,
      reason: "pending_pay_to_act_hand_discard_gate",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.gateSourceInstanceId,
      sourceDefinitionId: pending.gateSourceDefinitionId,
      requiredCount: pending.requiredCount,
      candidateCardInstanceIds: pending.candidateCardInstanceIds,
    },
  ];
}

function getAvailablePendingFieldMagicPreCostTriggerLegalActions(
  options: GetLegalActionsOptions
): LegalAction[] {
  const { state } = options;
  const pending = state.pendingFieldMagicPreCostTrigger;
  if (!pending) return [];

  if (pending.triggered) {
    const originalAction = pending.interruptedMagicUse.action;
    if (originalAction.kind !== "use_magic") return [];
    const resumedMagicActions = getAvailableMagicLegalActions(options).filter(
      (action) =>
        action.sourceInstanceId === originalAction.sourceInstanceId &&
        action.timing === originalAction.timing &&
        action.effectIndex === originalAction.effectIndex &&
        action.costMode === originalAction.costMode
    );
    if (resumedMagicActions.length > 0) return resumedMagicActions;
    // 再列挙した同一 costMode の action がなければ、元マジックは支払い前なので
    // 使用扱いにせず元ゾーンへ戻す。スタック後不発の処理とは混同しない。
    return [
      {
        kind: "resolve_field_magic_pre_cost_trigger" as const,
        actionId: `fmpc-cancel-${pending.pendingId}`,
        can: true as const,
        reason: "pending_field_magic_pre_cost_trigger_unpayable",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.triggerSourceInstanceId,
        sourceDefinitionId: pending.triggerSourceDefinitionId,
      },
    ];
  }

  const triggerMagicUseActions = getAvailableMagicLegalActions({
    ...options,
    fieldMagicUsePermission: {
      sourceInstanceId: pending.triggerSourceInstanceId,
      effectIndex: pending.triggerEffectIndex,
    },
  }).filter(
    (action) =>
      action.sourceInstanceId === pending.triggerSourceInstanceId &&
      action.effectIndex === pending.triggerEffectIndex
  );

  if (triggerMagicUseActions.length > 0) {
    return triggerMagicUseActions.map((triggerMagicUse) => ({
      kind: "resolve_field_magic_pre_cost_trigger" as const,
      actionId: `fmpc-${pending.pendingId}:${triggerMagicUse.actionId}`,
      can: true as const,
      reason: "pending_field_magic_pre_cost_trigger",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.triggerSourceInstanceId,
      sourceDefinitionId: pending.triggerSourceDefinitionId,
      triggerMagicUse,
    }));
  }

  return [
    {
      kind: "resolve_field_magic_pre_cost_trigger" as const,
      actionId: `fmpc-${pending.pendingId}`,
      can: true as const,
      reason: "pending_field_magic_pre_cost_trigger",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.triggerSourceInstanceId,
      sourceDefinitionId: pending.triggerSourceDefinitionId,
    },
  ];
}

function getAvailablePendingMultiPlacementLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingMultiPlacement;
  if (!pending) return [];

  const actions: LegalAction[] = [
    {
      ...(pending.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: pending.fieldCoreSourceMinimum }
        : {}),
      kind: "resolve_pending_multi_placement" as const,
      actionId: `mp-${pending.pendingId}`,
      can: true as const,
      reason: "pending_multi_placement",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      targets: pending.targets.map((t) => ({
        instanceId: t.instanceId,
        definitionId: t.definitionId,
        minimumCoreCount: t.minimumCoreCount,
        maximumCoreCount: t.maximumCoreCount,
        ...(t.voidNormalCoreMax !== undefined
          ? { voidNormalCoreMax: t.voidNormalCoreMax }
          : {}),
      })),
      ...(pending.trashNormalCoreMax !== undefined
        ? { trashNormalCoreMax: pending.trashNormalCoreMax }
        : {}),
      ...(pending.trashCoreMax !== undefined
        ? { trashCoreMax: pending.trashCoreMax }
        : {}),
    },
  ];

  if (pending.priorStateSnapshot && pending.canAbort !== false) {
    actions.push({
      kind: "abort_pending_multi_placement" as const,
      actionId: `mp-abort-${pending.pendingId}`,
      can: true as const,
      reason: "pending_multi_placement_abort",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
    });
  }

  return actions;
}

function getAvailablePendingEnterFieldPlacementLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingEnterFieldPlacement;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_enter_field_placement" as const,
      actionId: `efp-${pending.pendingId}`,
      can: true as const,
      reason: "pending_enter_field_placement",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      sourceCardNo: pending.sourceDefinitionId,
      minimumCoreCount: pending.minimumCoreCount,
      maximumCoreCount: pending.maximumCoreCount,
    },
  ];
}

function getAvailablePendingBraveCombineChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingBraveCombineChoice;
  if (!pending) return [];

  const actions: LegalAction[] = [];
  // 各候補ホストへの直接合体。
  for (const hostId of pending.hostCandidateInstanceIds) {
    const host = state.cardInstances.find((c) => c.instanceId === hostId);
    actions.push({
      kind: "resolve_brave_combine_choice" as const,
      actionId: `bcc-${pending.pendingId}-${hostId}`,
      can: true as const,
      reason: "brave_combine_choice_host",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      braveInstanceId: pending.braveInstanceId,
      braveCardNo: pending.braveDefinitionId,
      chosenHostInstanceId: hostId,
      ...(host ? { hostCardNo: host.definitionId } : {}),
    });
  }
  // スピリット状態で場入り (合体しない)。Lv1 コアを支払える場合のみ選択肢にする
  // (支払えないのにスピリット状態を選ぶと場入りコア配置で詰むため)。
  if (pending.spiritStateAffordable) {
    actions.push({
      kind: "resolve_brave_combine_choice" as const,
      actionId: `bcc-${pending.pendingId}-spirit`,
      can: true as const,
      reason: "brave_combine_choice_spirit",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      braveInstanceId: pending.braveInstanceId,
      braveCardNo: pending.braveDefinitionId,
      chosenHostInstanceId: null,
    });
  }
  return actions;
}

/**
 * 手札/手元⇔トラッシュの1対1入替待ち（engine-atomic-hand-trash-swap-legal-action）。
 * pending 生成時にスナップショットした両側候補一覧の cross product を列挙し、
 * 発揮・step任意の選択は既に完了しているため、ここで辞退を追加しない（03c）。
 */
function getAvailableHandTrashSwapLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingHandTrashSwapChoice;
  if (!pending) return [];

  const actions: LegalAction[] = [];
  for (const outgoingId of pending.outgoingCandidateInstanceIds) {
    const outgoing = state.cardInstances.find(
      (c) => c.instanceId === outgoingId
    );
    if (!outgoing) continue;
    for (const incomingId of pending.incomingCandidateInstanceIds) {
      const incoming = state.cardInstances.find(
        (c) => c.instanceId === incomingId
      );
      if (!incoming) continue;
      actions.push({
        kind: "swap_hand_trash" as const,
        actionId: `hts-${pending.pendingId}-${outgoingId}-${incomingId}`,
        can: true as const,
        reason: "hand_trash_swap_choice",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceCardNo: pending.sourceDefinitionId,
        outgoingCardInstanceId: outgoingId,
        outgoingCardNo: outgoing.definitionId,
        incomingCardInstanceId: incomingId,
        incomingCardNo: incoming.definitionId,
      });
    }
  }
  return actions;
}

/**
 * フィールドの発動元カード⇔手札カードの1対1入替待ち。
 * pending 生成時にスナップショットした手札候補を列挙する。発揮後の辞退はない。
 */
function getAvailableFieldHandSwapLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingFieldHandSwapChoice;
  if (!pending) return [];

  const actions: LegalAction[] = [];
  for (const incomingId of pending.incomingCandidateInstanceIds) {
    const incoming = state.cardInstances.find(
      (c) => c.instanceId === incomingId
    );
    if (!incoming) continue;
    actions.push({
      kind: "swap_field_hand" as const,
      actionId: `fhs-${pending.pendingId}-${incomingId}`,
      can: true as const,
      reason: "field_hand_swap_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceCardNo: pending.sourceDefinitionId,
      incomingCardInstanceId: incomingId,
      incomingCardNo: incoming.definitionId,
    });
  }
  return actions;
}

/**
 * 転召（召喚手順内ステップ）の強制コア消費の対象選択。各候補スピリットを別アクションとして列挙する。
 * 強制ステップのため「やめる」選択肢は無い（対象は必ず1体選ぶ）。コストは召喚宣言時に支払い済み。
 */
function getAvailablePendingTenshoSummonLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingTenshoSummon;
  if (!pending) return [];

  const actions: LegalAction[] = [];
  for (const targetId of pending.targetCandidateInstanceIds) {
    const target = state.cardInstances.find((c) => c.instanceId === targetId);
    actions.push({
      kind: "resolve_tensho_summon" as const,
      actionId: `tensho-${pending.pendingId}-${targetId}`,
      can: true as const,
      reason: "tensho_summon_target",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      summoningInstanceId: pending.summoningInstanceId,
      chosenTargetInstanceId: targetId,
      ...(target ? { targetCardNo: target.definitionId } : {}),
    });
  }
  return actions;
}

/**
 * 逆転醒 pattern2（裏返して配置/召喚）の解決。支払いソース + 維持コア配置は
 * `summonPaymentSources` / `summonEnterFieldCorePlacements`（既存 summon 同経路）で渡す。
 * 単一アクション（resolve_reverse_rebirth_summon）。任意/強制はトリガー側で決まり、
 * ここまで来た時点で「逆転醒を行う」確定済み。
 */
function getAvailablePendingReverseRebirthSummonLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingReverseRebirthSummon;
  if (!pending) return [];
  return [
    {
      kind: "resolve_reverse_rebirth_summon" as const,
      actionId: `reverse-rebirth-${pending.pendingId}`,
      can: true as const,
      reason: "reverse_rebirth_summon",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      frontDefinitionId: pending.frontDefinitionId,
      costToPay: pending.costToPay,
      minimumCoreCount: pending.minimumCoreCount,
    },
  ];
}

/**
 * 転醒内蔵 postRebirthChoice の合体/コア配置選択。
 * 召喚時合体選択と同じ resolve_brave_combine_choice kind を流用する（GUI 共用）。
 * corePlacementChoice がある場合の null は「合体せず、コア配置ルートへ進む」選択。
 */
function getAvailableStoneFlipCombineLegalActions(
  state: import("../model").GameState,
  _getCardDefinitionById: (
    id: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingStoneFlipCombine;
  if (!pending) return [];

  const brave = state.cardInstances.find(
    (c) => c.instanceId === pending.braveInstanceId
  );
  if (!brave) return [];
  const braveDefinitionId = pending.braveDefinitionId ?? brave.definitionId;

  const actions: LegalAction[] = [];
  for (const hostId of pending.hostCandidateInstanceIds) {
    const host = state.cardInstances.find((c) => c.instanceId === hostId);
    actions.push({
      kind: "resolve_brave_combine_choice" as const,
      actionId: `sfc-${pending.pendingId}-${hostId}`,
      can: true as const,
      reason: "stone_flip_combine_host",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      braveInstanceId: pending.braveInstanceId,
      braveCardNo: braveDefinitionId,
      chosenHostInstanceId: hostId,
      ...(host ? { hostCardNo: host.definitionId } : {}),
    });
  }
  if (pending.corePlacementChoice || pending.allowNoCombineChoice !== false) {
    actions.push({
      kind: "resolve_brave_combine_choice" as const,
      actionId: `sfc-${pending.pendingId}-${pending.corePlacementChoice ? "core" : "spirit"}`,
      can: true as const,
      reason: pending.corePlacementChoice
        ? "rebirth_post_choice_core"
        : "stone_flip_combine_spirit",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      braveInstanceId: pending.braveInstanceId,
      braveCardNo: braveDefinitionId,
      chosenHostInstanceId: null,
    });
  }
  return actions;
}

function getAvailablePendingChangeCleanupChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingChangeCleanupChoice;
  if (!pending) return [];

  const baseAction = {
    kind: "resolve_pending_change_cleanup_choice",
    can: true,
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.cardInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    swapCandidateInstanceIds: pending.swapCandidateInstanceIds,
  } satisfies Omit<
    Extract<LegalAction, { kind: "resolve_pending_change_cleanup_choice" }>,
    "actionId" | "reason" | "outcome" | "swapTargetInstanceId"
  >;

  const actions: LegalAction[] = [
    {
      ...baseAction,
      actionId: `change-cleanup-trash-${pending.pendingId}`,
      reason: "pending_change_cleanup_choice_trash",
      outcome: "trash",
    },
  ];
  for (const swapTargetInstanceId of pending.swapCandidateInstanceIds) {
    actions.push({
      ...baseAction,
      actionId: `change-cleanup-swap-${pending.pendingId}:${swapTargetInstanceId}`,
      reason: "pending_change_cleanup_choice_swap",
      outcome: "swap",
      swapTargetInstanceId,
    });
  }
  return actions;
}

function getAvailablePendingCoreDistributionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCoreDistribution;
  if (!pending) return [];

  const actions: LegalAction[] = [
    {
      kind: "resolve_pending_core_distribution" as const,
      actionId: `cd-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_distribution",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      candidates: pending.candidates,
      totalNormalCores: pending.totalNormalCores,
      hasSoulCore: pending.hasSoulCore,
      ...(pending.totalSoulCores !== undefined
        ? { totalSoulCores: pending.totalSoulCores }
        : {}),
      fromKind: pending.fromKind,
      ...(pending.allowedSources !== undefined
        ? { allowedSources: pending.allowedSources }
        : {}),
      ...(pending.sourceAvailable !== undefined
        ? { sourceAvailable: pending.sourceAvailable }
        : {}),
      ...(pending.soulSourceAvailable !== undefined
        ? { soulSourceAvailable: pending.soulSourceAvailable }
        : {}),
      ...(pending.sourceTotalAvailable !== undefined
        ? { sourceTotalAvailable: pending.sourceTotalAvailable }
        : {}),
      ...(pending.targetTotalSelection !== undefined
        ? { targetTotalSelection: pending.targetTotalSelection }
        : {}),
      ...(pending.minTotal !== undefined ? { minTotal: pending.minTotal } : {}),
      ...(pending.maxTotal !== undefined ? { maxTotal: pending.maxTotal } : {}),
      ...(pending.mustPlaceSoulCore
        ? { mustPlaceSoulCore: true as const }
        : {}),
      ...(pending.maxPerCandidate !== undefined
        ? { maxPerCandidate: pending.maxPerCandidate }
        : {}),
      ...(pending.allocationGroups !== undefined
        ? { allocationGroups: pending.allocationGroups }
        : {}),
      fromPlayerId: pending.fromPlayerId,
      toPlayerId: pending.toPlayerId,
    },
  ];

  // P3-48 follow-up: priorStateSnapshot があり、後続 continuation を持たない場合のみ abort を提示。
  // 旧 snapshot (snapshot 機能導入前に save された state を import したケース) では
  // priorStateSnapshot が undefined になるため、abort を出さず resolve のみ提示する。
  // BSKB01-R02 のような連続ステップ内の core_distribute は、0個配分も resolve として
  // 後続 step を再開する必要があるため、abort は提示しない。
  if (pending.priorStateSnapshot && pending.continuation === undefined) {
    actions.push({
      kind: "abort_pending_core_distribution" as const,
      actionId: `cd-abort-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_distribution_abort",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
    });
  }

  return actions;
}

/**
 * P3-47 F-4: pendingTargetRedirects の先頭エントリに対する confirm/decline 候補を返す。
 *
 * 現状は配列の先頭のみ legal にする (FIFO 順)。複数 redirect が同時にマッチした場合は
 * 1 つずつ消化する。candidateTokenInstanceIds が空のエントリは生成側で除外されている前提
 * (Step 2 findApplicableTargetRedirects で 0 件は skip 済)。
 */
function getAvailablePendingTargetRedirectLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingTargetRedirects[0];
  if (!pending) return [];

  const actions: LegalAction[] = [];

  const redirectableInstanceIds = pending.redirectableInstanceIds ?? [
    pending.redirectableInstanceId,
  ];
  const candidateChooserPlayerId =
    pending.candidateChooserPlayerId ?? pending.promptedPlayerId;
  const awaitsCandidateChoice =
    pending.decisionConfirmed === true &&
    candidateChooserPlayerId !== pending.promptedPlayerId;
  const replacementSelectionRequired =
    candidateChooserPlayerId === pending.promptedPlayerId ||
    awaitsCandidateChoice;
  const replacementMode = pending.replacementMode ?? "collapse";
  const replacementTargetCount =
    replacementMode === "reselect" ? redirectableInstanceIds.length : 1;
  const confirmActingPlayerId = awaitsCandidateChoice
    ? candidateChooserPlayerId
    : pending.promptedPlayerId;

  // forced_target_inclusion タウント: redirectableInstanceIds のいずれかが強制対象なら、
  // confirm (=redirectableInstanceIds を対象集合から外す) は apply 側
  // (legal-actions-apply.ts applyTargetRedirectAction) で常に throw するため legal に含めない
  // (decline のみ提示。「legal な action は必ず適用できる」契約を維持する)。
  const sourceEffectCard = getCardById(state, pending.sourceEffectInstanceId);
  const redirectAwayIsForced =
    sourceEffectCard !== undefined &&
    getMandatoryForcedTargetInclusionIds(
      state,
      sourceEffectCard.controllerPlayerId,
      redirectableInstanceIds,
      redirectableInstanceIds.length
    ).some((id) => redirectableInstanceIds.includes(id));

  if (!redirectAwayIsForced) {
    actions.push({
      kind: "confirm_target_redirect" as const,
      actionId: `redirect-confirm-${pending.pendingId}`,
      can: true as const,
      reason: "pending_target_redirect",
      actingPlayerId: confirmActingPlayerId,
      pendingId: pending.pendingId,
      originalResolvedInstanceIds: [...pending.originalResolvedInstanceIds],
      redirectableInstanceId: pending.redirectableInstanceId,
      redirectableInstanceIds: [...redirectableInstanceIds],
      candidateTokenInstanceIds: replacementSelectionRequired
        ? [...pending.candidateTokenInstanceIds]
        : [],
      replacementMode,
      replacementTargetCount: replacementSelectionRequired
        ? replacementTargetCount
        : 0,
      maxReplacementTargetCount: replacementSelectionRequired
        ? replacementTargetCount
        : 0,
      candidateChooserPlayerId,
      replacementSelectionRequired,
      sourceEffectInstanceId: pending.sourceEffectInstanceId,
      sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
    });
  }
  if (!awaitsCandidateChoice) {
    actions.push({
      kind: "decline_target_redirect" as const,
      actionId: `redirect-decline-${pending.pendingId}`,
      can: true as const,
      reason: "pending_target_redirect",
      actingPlayerId: pending.promptedPlayerId,
      pendingId: pending.pendingId,
    });
  }
  return actions;
}

function getAvailableBraveLeaveChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingBraveLeaveChoice;
  if (!pending) return [];
  const actions: LegalAction[] = [
    {
      kind: "resolve_brave_leave_choice" as const,
      actionId: `brave-leave-keep-${pending.hostInstanceId}`,
      can: true as const,
      reason: "pending_brave_leave_choice",
      actingPlayerId: pending.choosingPlayerId,
      hostInstanceId: pending.hostInstanceId,
      braveInstanceIds: [...pending.braveInstanceIds],
      choice: "keep" as const,
    },
    {
      kind: "resolve_brave_leave_choice" as const,
      actionId: `brave-leave-send-${pending.hostInstanceId}`,
      can: true as const,
      reason: "pending_brave_leave_choice",
      actingPlayerId: pending.choosingPlayerId,
      hostInstanceId: pending.hostInstanceId,
      braveInstanceIds: [...pending.braveInstanceIds],
      choice: "send_with_host" as const,
    },
  ];
  if (pending.soulStateInheritance) {
    actions.push({
      kind: "resolve_brave_leave_choice" as const,
      actionId: `brave-leave-inherit-soul-state-${pending.hostInstanceId}`,
      can: true as const,
      reason: "pending_brave_leave_choice",
      actingPlayerId: pending.choosingPlayerId,
      hostInstanceId: pending.hostInstanceId,
      braveInstanceIds: [...pending.braveInstanceIds],
      choice: "inherit_soul_state" as const,
    });
  }
  return actions;
}

function getAvailableSoulStateReplacementLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingSoulStateReplacement;
  if (!pending) return [];

  // 二択 (host を取らないバイナリ): 「魂状態で残す」/「通常通り離れる」。
  // どちらを選んでも pending は解消するため deadlock しない。
  const keepAction = {
    kind: "resolve_soul_state_replacement" as const,
    actionId: `soul-state-keep-${pending.cardInstanceId}`,
    can: true as const,
    reason: "pending_soul_state_replacement",
    actingPlayerId: pending.choosingPlayerId,
    cardInstanceId: pending.cardInstanceId,
    choice: "keep" as const,
  };
  if (pending.forceKeepDueToSoulStateInheritance) {
    return [keepAction];
  }
  return [
    keepAction,
    {
      kind: "resolve_soul_state_replacement" as const,
      actionId: `soul-state-decline-${pending.cardInstanceId}`,
      can: true as const,
      reason: "pending_soul_state_replacement",
      actingPlayerId: pending.choosingPlayerId,
      cardInstanceId: pending.cardInstanceId,
      choice: "decline" as const,
    },
  ];
}

function getAvailableSetAsideExitReplacementChoiceLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById: GetLegalActionsOptions["getCardDefinitionById"]
): LegalAction[] {
  const pending = state.pendingSetAsideExitReplacementChoice;
  if (!pending) return [];

  // 通常の効果コストと同じ原資・制限を照会する。実配分は受諾後の共通HUDで選ぶ。
  const canReplace =
    pending.replacement.kind !== "pay_cost" ||
    (() => {
      const available = getAvailablePayCostCoreSources(
        state,
        pending.choosingPlayerId,
        getCardDefinitionById
      );
      return (
        available.reduce((sum, source) => sum + source.available, 0) >=
        pending.replacement.amount
      );
    })();

  // 二択 (host を取らないバイナリ): 「置換先へ移動/コスト支払い」/「通常通り除外する」。
  // どちらを選んでも pending は解消するため deadlock しない。
  const actions: LegalAction[] = [];
  if (canReplace) {
    actions.push({
      kind: "resolve_set_aside_exit_replacement_choice" as const,
      actionId: `set-aside-exit-replacement-replace-${pending.cardInstanceId}`,
      can: true as const,
      reason: "pending_set_aside_exit_replacement_choice",
      actingPlayerId: pending.choosingPlayerId,
      cardInstanceId: pending.cardInstanceId,
      choice: "replace" as const,
      replacementKind: pending.replacement.kind,
    });
  }
  actions.push({
    kind: "resolve_set_aside_exit_replacement_choice" as const,
    actionId: `set-aside-exit-replacement-decline-${pending.cardInstanceId}`,
    can: true as const,
    reason: "pending_set_aside_exit_replacement_choice",
    actingPlayerId: pending.choosingPlayerId,
    cardInstanceId: pending.cardInstanceId,
    choice: "decline" as const,
  });
  return actions;
}

function getAvailableAdventSourceReplacementLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingAdventSourceReplacement;
  if (!pending) return [];

  const hosts = [...pending.candidateHostInstanceIds];
  const actions: LegalAction[] = [];

  // 「煌臨元へ追加」: 追加先 host ごとに 1 アクション (ブレイヴ離脱選択と同方式)。
  // 複数 host があるときはプレイヤーがどれに追加するかをここで選ぶ。
  for (const hostInstanceId of hosts) {
    actions.push({
      kind: "resolve_advent_source_replacement" as const,
      actionId: `advent-source-add-${pending.cardInstanceId}-${hostInstanceId}`,
      can: true as const,
      reason: "pending_advent_source_replacement",
      actingPlayerId: pending.choosingPlayerId,
      cardInstanceId: pending.cardInstanceId,
      choice: "advent_source" as const,
      hostInstanceId,
      candidateHostInstanceIds: hosts,
    });
  }

  // 「トラッシュに置く」: host を取らない 1 アクション。
  actions.push({
    kind: "resolve_advent_source_replacement" as const,
    actionId: `advent-source-trash-${pending.cardInstanceId}`,
    can: true as const,
    reason: "pending_advent_source_replacement",
    actingPlayerId: pending.choosingPlayerId,
    cardInstanceId: pending.cardInstanceId,
    choice: "trash" as const,
    candidateHostInstanceIds: hosts,
  });

  return actions;
}

function getAvailableBraveAttackContinuationLegalActions(
  state: import("../model").GameState,
  getCardDefinitionById?: (
    definitionId: string
  ) => import("../model").CardDefinition | undefined
): LegalAction[] {
  const pending = state.pendingBraveAttackContinuation;
  if (!pending) return [];
  const entity = state.battleEntities.find(
    (e) => e.entityId === pending.entityId
  );
  const attackState = entity?.attackState ?? "attacking";
  const continuableBraves = pending.braveInstanceIds.filter((braveId) => {
    const card = getCardById(state, braveId);
    return (
      card !== undefined &&
      card.zone === "field" &&
      card.pendingLeaveKind === null &&
      card.zoneRoleName === "brave" &&
      !isRuleStrengthBattlePrevented(
        state,
        braveId,
        attackState,
        getCardDefinitionById
      )
    );
  });
  return [
    ...(continuableBraves.length > 0
      ? [
          {
            kind: "resolve_brave_attack_continuation" as const,
            actionId: `brave-attack-continue-${pending.entityId}`,
            can: true as const,
            reason: "pending_brave_attack_continuation",
            actingPlayerId: pending.choosingPlayerId,
            entityId: pending.entityId,
            braveInstanceIds: [...continuableBraves],
            choice: "continue" as const,
          },
        ]
      : []),
    {
      kind: "resolve_brave_attack_continuation" as const,
      actionId: `brave-attack-end-${pending.entityId}`,
      can: true as const,
      reason: "pending_brave_attack_continuation",
      actingPlayerId: pending.choosingPlayerId,
      entityId: pending.entityId,
      braveInstanceIds: [...pending.braveInstanceIds],
      choice: "end_attack" as const,
    },
  ];
}

function getAvailablePendingCoreSplitLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCoreSplitSelection;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_core_split" as const,
      actionId: `cms-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_split_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      totalAmount: pending.totalAmount,
      destinations: pending.destinations.map((d) => ({
        locationKind: d.location.kind,
        ...("player" in d.location && typeof d.location.player === "string"
          ? { locationPlayerId: d.location.player }
          : {}),
        ...(d.cap !== undefined ? { cap: d.cap } : {}),
      })),
    },
  ];
}

function getAvailablePendingSplitSummonChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingSplitSummonChoice;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_split_summon_choice" as const,
      actionId: `ssc-${pending.pendingId}`,
      can: true as const,
      reason: "pending_split_summon_choice",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      totalCount: pending.totalCount,
      maxTokenCount: pending.maxTokenCount,
      zoneCandidateInstanceIds: pending.zoneCandidateInstanceIds,
    },
  ];
}

function getAvailablePendingCoreCountSelectionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCoreCountSelection;
  if (!pending) return [];

  const locInfo = (loc: import("../model").EffectCoreLocation) => ({
    kind: loc.kind,
    ...("player" in loc && typeof loc.player === "string"
      ? { playerId: loc.player }
      : {}),
  });
  const from = locInfo(pending.fromLocation);
  const to = locInfo(pending.toLocation);

  return [
    {
      kind: "resolve_pending_core_count" as const,
      actionId: `ccs-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_count_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      min: pending.min,
      max: pending.max,
      fromKind: from.kind,
      ...(from.playerId ? { fromPlayerId: from.playerId } : {}),
      toKind: to.kind,
      ...(to.playerId ? { toPlayerId: to.playerId } : {}),
    },
  ];
}

function getAvailablePendingCountSelectionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCountSelection;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_count_decrease" as const,
      actionId: `cnts-${pending.pendingId}`,
      can: true as const,
      reason: "pending_count_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      targetPlayerId: pending.targetPlayerId,
      min: pending.min,
      max: pending.max,
    },
  ];
}

function getAvailablePendingDiscardSetBurstCountSelectionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingDiscardSetBurstCountSelection;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_discard_set_burst_count" as const,
      actionId: `dsbcs-${pending.pendingId}`,
      can: true as const,
      reason: "pending_discard_set_burst_count_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      targetPlayerId: pending.targetPlayerId,
      min: pending.min,
      max: pending.max,
    },
  ];
}

function getAvailablePendingLifeCoreSelectionLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingLifeCoreSelection;
  if (!pending) return [];

  const locInfo = (loc: import("../model").EffectCoreLocation) => ({
    kind: loc.kind,
    ...("player" in loc && typeof loc.player === "string"
      ? { playerId: loc.player }
      : {}),
  });
  const from = locInfo(pending.fromLocation);
  const to = locInfo(pending.toLocation);

  return [
    {
      kind: "resolve_pending_life_core_selection" as const,
      actionId: `lcs-${pending.pendingId}`,
      can: true as const,
      reason: "pending_life_core_selection",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      normalAvailable: pending.normalAvailable,
      soulAvailable: pending.soulAvailable,
      totalAmount: pending.totalAmount,
      fromKind: from.kind,
      ...(from.playerId ? { fromPlayerId: from.playerId } : {}),
      toKind: to.kind,
      ...(to.playerId ? { toPlayerId: to.playerId } : {}),
    },
  ];
}

function getAvailableCoreSourceAllocationLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingCoreSourceAllocation;
  if (!pending) return [];

  return [
    {
      kind: "resolve_core_source_allocation" as const,
      actionId: `csa-${pending.pendingId}`,
      can: true as const,
      reason: "pending_core_source_allocation",
      ...(pending.canDecline ? { canDecline: true } : {}),
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      candidates: pending.candidates.map((c) => ({
        instanceId: c.instanceId,
        available: c.available,
        ...(c.normalAvailable !== undefined
          ? { normalAvailable: c.normalAvailable }
          : {}),
        ...(c.hasSoulCore !== undefined ? { hasSoulCore: c.hasSoulCore } : {}),
      })),
      requiredTotal: pending.requiredTotal,
      ...(pending.minimumTotal !== undefined
        ? { minimumTotal: pending.minimumTotal }
        : {}),
      toKind: pending.toLocation.kind,
    },
  ];
}

function getAvailablePendingLinkAidCostSourceChoiceLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingLinkAidCostSourceChoice;
  if (!pending) return [];

  return pending.candidates.map((candidate) => ({
    kind: "resolve_pending_link_aid_cost_source_choice" as const,
    actionId: `lac-${pending.pendingId}:${candidate.costSourceInstanceId}`,
    can: true as const,
    reason: "pending_link_aid_cost_source_choice",
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    soulStateCardInstanceId: pending.soulStateCardInstanceId,
    soulStateCardNo: pending.soulStateCardNo,
    costSourceInstanceId: candidate.costSourceInstanceId,
    ...(candidate.costSourceCardNo !== undefined
      ? { costSourceCardNo: candidate.costSourceCardNo }
      : {}),
    availableNormalCoreCount: candidate.availableNormalCoreCount,
  }));
}

function getAvailablePendingEffectSummonCostPaymentLegalActions(
  state: import("../model").GameState
): LegalAction[] {
  const pending = state.pendingEffectSummonCostPayment;
  if (!pending) return [];

  return [
    {
      kind: "resolve_pending_effect_summon_cost_payment" as const,
      actionId: `escp-${pending.pendingId}`,
      can: true as const,
      reason: "pending_effect_summon_cost_payment",
      actingPlayerId: pending.actingPlayerId,
      pendingId: pending.pendingId,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      summonTargetInstanceId: pending.summonTargetInstanceId,
      summonTargetDefinitionId: pending.summonTargetDefinitionId,
      requiredCost: pending.requiredCost,
      availableReserveCoreAmount: pending.availableReserveCoreAmount,
      availableReserveNormalCoreAmount:
        pending.availableReserveNormalCoreAmount,
      availableOnBoardCoreSources: [...pending.availableOnBoardCoreSources],
      availableSoulCoreOnlySources: [...pending.availableSoulCoreOnlySources],
    },
  ];
}
