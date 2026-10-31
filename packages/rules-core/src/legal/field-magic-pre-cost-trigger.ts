// engine-magic-field-pre-cost-payment-trigger (BSAZ01-C12「戦力投入」)。
//
// 「自分が[tribeFilter]を持つマジックカードを使用するとき、そのコストを支払う前に、
// ただちに[triggerEffectIndex]の効果を使用できる」cross-card pre-cost トリガー。
// 他カードのコスト支払いに割り込む語法は全カード中このカードのみ (2026-07-09/07-10
// grep確認、既存 primitive 前例なし)。P2-11 god-file 分解の慣例に従い専用ファイルに分離する。
//
// 設計:
// - 割り込み (tryInterceptFieldMagicPreCostTrigger): use_magic 宣言のコスト支払い直前
//   (legal-actions-apply.ts の use_magic ハンドラ先頭) で、offer_magic_pre_cost_trigger CE
//   があり usageLimit (per_card_name/turn) 未消費なら、コスト支払いを含む use_magic 呼び出し
//   全体を `pendingFieldMagicPreCostTrigger.interruptedMagicUse` として中断保存する。
// - 解決 (applyResolveFieldMagicPreCostTriggerAction): decline は中断した use_magic 呼び出しを
//   即座に再開する。trigger は usageLimit を消費し、triggerEffectIndex の効果を
//   通常の use_magic として宣言・支払い・スタック解決する。
// - 再開 (resumeFieldMagicPreCostTriggerIfReady): trigger 側の効果自体が内部 pending
//   (core_distribute 等) を生む場合、それらが汎用パイプラインで解決され尽くした時点で
//   中断元を現在の盤面で再列挙する。支払えるなら新しい通常 use_magic action を提示し、
//   支払えなければ元カードを使用扱いにせず元ゾーンへ残す。
import type {
  ApplyLegalActionOptions,
  ApplyLegalActionResult,
  UseMagicLegalAction,
} from "./legal-actions-types";
import {
  getTotalPaymentAmount,
  type CardCostPaymentSource,
} from "../core/payment-system";
import type { DeferredStackResolverOptions } from "./stack-resolution-types";
import type { GameState, InterruptedMagicUse } from "../model";
import { getCardById } from "../card/card-lookup";
import { matchesTribes } from "../card/card-filter";
import {
  canUseEffectByUsageLimit,
  getEffectiveTribes,
  recordEffectUsageIfLimited,
  resolvePaymentSources,
} from "./legal-actions-shared";
import { getAvailableMagicPaymentSources } from "../mechanics/magic-system";
import { getAvailableMagicLegalActions } from "./legal-actions-availability";
import { hasPendingTargetedDisclosureCleanupCarrier } from "./stack-resolution-core";
import { applyUseMagicAction } from "./legal-actions-apply";

const FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL = "field_magic_pre_cost_trigger";

export interface FieldMagicPreCostTriggerOffer {
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectIndex: number;
}

function isPaymentFailureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "Payment does not match final cost:",
    "Reserve payment exceeds available cores:",
    "Card payment source is not legal:",
    "Card payment exceeds available cores:",
    "Soul core is not available for payment source:",
  ].some((prefix) => error.message.startsWith(prefix));
}

/**
 * ApplyLegalActionOptions からシリアライズ不可 (function 値) の callback 系を除いた
 * `InterruptedMagicUse` を取り出す。除外キーは model.ts の `InterruptedMagicUse` 型定義
 * (Omit 元) と同一の 16 callback フィールドに揃える。
 */
function toInterruptedMagicUse(
  options: ApplyLegalActionOptions
): InterruptedMagicUse {
  const {
    getCardDefinitionById: _getCardDefinitionById,
    getRegisteredTriggeredEffectActions: _getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: _getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions:
      _getRegisteredBattleImmediateEffectActions,
    getRegisteredFieldCardEffectActions: _getRegisteredFieldCardEffectActions,
    getRegisteredHandActivatedEffectActions:
      _getRegisteredHandActivatedEffectActions,
    getRegisteredMagicActions: _getRegisteredMagicActions,
    getHandWrittenBurstPostResolutionPolicy:
      _getHandWrittenBurstPostResolutionPolicy,
    resolveFieldCardEffect: _resolveFieldCardEffect,
    getHandWrittenEffectResolver: _getHandWrittenEffectResolver,
    getConditionalCostCanExecuteCheck: _getConditionalCostCanExecuteCheck,
    getConditionalResultSuccessCheck: _getConditionalResultSuccessCheck,
    resolvePendingTriggeredEffect: _resolvePendingTriggeredEffect,
    getPendingTriggeredEffectResolver: _getPendingTriggeredEffectResolver,
    resolvePendingBurstCheck: _resolvePendingBurstCheck,
    getPendingBurstCheckResolver: _getPendingBurstCheckResolver,
    state: _state,
    ...interruptedMagicUse
  } = options;
  return interruptedMagicUse;
}

/**
 * コスト支払い前の任意誘発が最終コストを下げたとき、既に選ばれていた支払い元の
 * 優先順を保ったまま、現在必要な合計へ縮める。支払いはまだ一切実行していないため、
 * 余剰分を払うのではなく未使用の選択として外す。コストが上がった場合は新たな支払い元を
 * 捏造せず、再開前に使用不能として扱う。
 */
function trimInterruptedPaymentSourcesToFinalCost(
  paymentSources: readonly CardCostPaymentSource[] | undefined,
  finalCost: number
): readonly CardCostPaymentSource[] | undefined {
  if (finalCost === 0) return [];
  if (!paymentSources) return undefined;

  let remaining = finalCost;
  const trimmed: CardCostPaymentSource[] = [];
  for (const source of paymentSources) {
    if (remaining === 0) break;
    const amount = Math.min(source.amount, remaining);
    if (amount > 0) trimmed.push({ ...source, amount });
    remaining -= amount;
  }
  return remaining === 0 ? trimmed : paymentSources;
}

function returnInterruptedMagicToOrigin(
  state: GameState,
  sourceInstanceId: string
): ApplyLegalActionResult {
  // この経路は applyUseMagicAction の前なので、元カードはまだ宣言時のゾーン
  // （通常は hand）を離れていない。pending のみを閉じ、事前コスト効果の結果は保持する。
  return {
    state: {
      ...state,
      pendingFieldMagicPreCostTrigger: null,
      log: [
        ...state.log,
        `magic:pre-cost-trigger:unpayable:return-to-origin:${sourceInstanceId}`,
      ],
    },
  };
}

/**
 * use_magic 宣言 (action) がコスト支払い前トリガーの対象かを判定し、対象なら
 * コスト支払いを含む呼び出し全体を中断して pending を立てる。対象外なら null。
 */
export function tryInterceptFieldMagicPreCostTrigger(
  options: ApplyLegalActionOptions,
  action: UseMagicLegalAction
): ApplyLegalActionResult | null {
  const offer = getFieldMagicPreCostTriggerOffer(options, action);
  if (!offer) return null;
  const pendingId = `field-magic-pre-cost-trigger:${offer.sourceInstanceId}:${action.sourceInstanceId}`;
  const nextState: GameState = {
    ...options.state,
    pendingFieldMagicPreCostTrigger: {
      pendingId,
      actingPlayerId: action.actingPlayerId,
      triggerSourceInstanceId: offer.sourceInstanceId,
      triggerSourceDefinitionId: offer.sourceDefinitionId,
      triggerEffectIndex: offer.effectIndex,
      triggered: false,
      interruptedMagicUse: toInterruptedMagicUse(options),
    },
    log: [
      ...options.state.log,
      `effect:offer_magic_pre_cost_trigger:offered:${offer.sourceInstanceId}:${action.sourceInstanceId}`,
    ],
  };
  return { state: nextState };
}

/**
 * 現在の use_magic が pre-cost 使用権の対象になるかを、legal action 表示と apply の両方で
 * 同じ条件から判定する。返値は UI の先払い抑止用 metadata にも使うが、実際の中断は必ず
 * `tryInterceptFieldMagicPreCostTrigger` がこの関数を再実行して確定する。
 */
export function getFieldMagicPreCostTriggerOffer(
  options: Pick<ApplyLegalActionOptions, "state" | "getCardDefinitionById">,
  action: UseMagicLegalAction
): FieldMagicPreCostTriggerOffer | null {
  const pending = options.state.pendingFieldMagicPreCostTrigger;
  const interruptedAction = pending?.interruptedMagicUse.action;
  // 戦力投入の使用・応答が完了した後は、同じ use_magic を現在の盤面で再選択して
  // 支払いへ進める。ここで再度 offer すると無限に割り込むため、この再開 1 回だけを通す。
  if (
    pending?.triggered === true &&
    interruptedAction?.kind === "use_magic" &&
    interruptedAction.sourceInstanceId === action.sourceInstanceId &&
    interruptedAction.timing === action.timing &&
    interruptedAction.effectIndex === action.effectIndex
  ) {
    return null;
  }
  const magicDefinition = options.getCardDefinitionById(
    action.sourceDefinitionId
  );
  const magicCard = getCardById(options.state, action.sourceInstanceId);
  // SSOT: tribes overwrite / addTribes CE (act_as_spirit 等) を反映した実効系統で判定する
  // (印字 tribe 直読みは治具 CE 適用カードで誤判定する)。
  const magicTribes = getEffectiveTribes(
    options.state,
    magicCard,
    magicDefinition,
    options.getCardDefinitionById
  );
  if (magicTribes.length === 0) return null;

  for (const ce of options.state.activeContinuousEffects) {
    if (ce.modifierTag !== "offer_magic_pre_cost_trigger") continue;
    if (ce.targetInstanceId !== action.actingPlayerId) continue;
    const tribeFilter = ce.metadata?.["tribeFilter"] as string[] | undefined;
    const triggerEffectIndex = ce.metadata?.["triggerEffectIndex"] as
      | number
      | undefined;
    if (!tribeFilter || triggerEffectIndex === undefined) continue;
    if (!matchesTribes(undefined, { tribes: tribeFilter }, magicTribes))
      continue;
    if (
      !canUseEffectByUsageLimit({
        state: options.state,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
        effectLabel: FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL,
        usageLimit: { kind: "per_card_name", duration: "turn" },
      })
    ) {
      continue;
    }

    return {
      sourceInstanceId: ce.sourceInstanceId,
      sourceDefinitionId: ce.sourceDefinitionId,
      effectIndex: triggerEffectIndex,
    };
  }

  return null;
}

/** 中断していた use_magic 呼び出しを、渡された callback 一式で再投入する。 */
function replayInterruptedMagicUse(
  interruptedMagicUse: InterruptedMagicUse,
  state: GameState,
  callbacks: DeferredStackResolverOptions
): ApplyLegalActionResult {
  const replayOptions: ApplyLegalActionOptions = {
    ...callbacks,
    ...interruptedMagicUse,
    state: { ...state, pendingFieldMagicPreCostTrigger: null },
  };
  const originalAction = interruptedMagicUse.action as UseMagicLegalAction;
  // GUI は pre-cost offer を先に engine へ渡すため、元マジックの支払い入力をまだ
  // 持たない。この場合の decline は「使用中止」ではなく pending を閉じて現在の
  // use_magic action を再提示し、既存の支払い UI をそこから開く。
  if (
    originalAction.costMode === "paid" &&
    interruptedMagicUse.paymentSources === undefined
  ) {
    return {
      state: {
        ...state,
        pendingFieldMagicPreCostTrigger: null,
      },
    };
  }
  // コストはまだ支払っていない。事前コスト誘発の効果が field / continuous effect を
  // 変え得るため、ここで宣言時の cost snapshot をそのまま使うと実コストとの不一致を
  // 起こす。再列挙は現在の window では元の flash action を出せないことがあるので、
  // 元の合法 action の宣言内容を保持したまま支払い候補だけを現在 state で再評価する。
  const refreshedPaymentSources = getAvailableMagicPaymentSources({
    state: replayOptions.state,
    actingPlayerId: originalAction.actingPlayerId,
    magicInstanceId: originalAction.sourceInstanceId,
    getCardDefinitionById: replayOptions.getCardDefinitionById,
    effectMode: originalAction.timing,
    ...(originalAction.allowedSourceZones !== undefined
      ? { allowedSourceZones: originalAction.allowedSourceZones }
      : {}),
    ...(originalAction.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: originalAction.onBoardCoreSourceFilter }
      : {}),
  });
  // `free` / `override` / zone-cost の action は availability 側が別の cost model を
  // 持つため、通常の有償使用だけをここで置換する。特別コストは従来どおり action 固有の
  // model で apply 側に再検証させる。
  const refreshedAction: UseMagicLegalAction =
    originalAction.costMode === "paid"
      ? {
          ...originalAction,
          reducedCost: refreshedPaymentSources.reduction.reducedCost,
          additionalCost: refreshedPaymentSources.reduction.additionalCost,
          finalCost: refreshedPaymentSources.reduction.finalCost,
          totalReduction: refreshedPaymentSources.reduction.totalReduction,
          availableReserveCoreAmount:
            refreshedPaymentSources.reserveSource.availableCoreAmount,
          availableOnBoardCoreSources:
            refreshedPaymentSources.onBoardCoreSources,
          availableSoulCoreOnlySources:
            refreshedPaymentSources.soulCoreOnlySources,
        }
      : originalAction;

  // トリガー提示前に選ばれた支払いは未実行なので、下がった最終コストに合わせて
  // 余剰分を外す。現在の候補に対する有効性は apply 側であらためて検証する。
  const paymentSources =
    originalAction.costMode === "paid"
      ? trimInterruptedPaymentSourcesToFinalCost(
          interruptedMagicUse.paymentSources,
          refreshedAction.finalCost
        )
      : interruptedMagicUse.paymentSources;

  // 公式 Q&A BSC45 Q27695 はコストを支払えないカードを「使用できない」とし、
  // BS63 Q10336 は提示後に使用不能になったカードを支払い前に手札へ戻す。
  // applyUseMagicAction と同じ支払い候補の SSOT で再確認する。ここではまだ再投入前
  // なので、pending だけを閉じれば元カードは元のゾーン（通常は hand）に残り、
  // C12 側の効果結果も保持される。
  // コスト上昇で不足した分の支払い元は捏造しない。なおこの判定を action 再評価後に
  // 行うことで、提示時点では 0 コストだったため支払い元を持たなかった正常な use_magic
  // を、通常の入力不備と混同せず取消し経路へ送れる。
  if (
    originalAction.costMode === "paid" &&
    getTotalPaymentAmount(paymentSources ?? []) !== refreshedAction.finalCost
  ) {
    return returnInterruptedMagicToOrigin(
      replayOptions.state,
      originalAction.sourceInstanceId
    );
  }

  try {
    resolvePaymentSources(refreshedAction, paymentSources);
  } catch (error) {
    if (!isPaymentFailureError(error)) throw error;
    return returnInterruptedMagicToOrigin(
      replayOptions.state,
      originalAction.sourceInstanceId
    );
  }

  // override/free/zone discount は action 固有の cost model を apply 側が再構築する。
  // ここで paid 専用の snapshot に押し込まず、再投入先の fresh payment validation が
  // 検出した支払い不能だけを同じ Q&A の取消し経路へ送る。
  try {
    return applyUseMagicAction(
      {
        ...replayOptions,
        ...(paymentSources !== undefined ? { paymentSources } : {}),
      },
      refreshedAction
    );
  } catch (error) {
    if (!isPaymentFailureError(error)) throw error;
    return returnInterruptedMagicToOrigin(
      replayOptions.state,
      originalAction.sourceInstanceId
    );
  }
}

/**
 * `resolve_field_magic_pre_cost_trigger` legal action を解決する。
 * - decline (既定): 中断していた use_magic 呼び出しをそのまま再開しコストを支払う。
 * - trigger: usageLimit を消費し、triggerEffectIndex を通常の use_magic として
 *   宣言・支払い・応答・解決する。効果自体が内部 pending を生む場合は
 *   `resumeFieldMagicPreCostTriggerIfReady` が再提示または取消しを行う。
 */
export function applyResolveFieldMagicPreCostTriggerAction(
  options: ApplyLegalActionOptions,
  action: import("./legal-actions-types").ResolveFieldMagicPreCostTriggerLegalAction
): ApplyLegalActionResult {
  const pending = options.state.pendingFieldMagicPreCostTrigger;
  if (!pending) {
    throw new Error("No pending field magic pre-cost trigger to resolve");
  }

  if (options.fieldMagicPreCostTriggerDecision !== "trigger") {
    return replayInterruptedMagicUse(
      pending.interruptedMagicUse,
      options.state,
      options
    );
  }

  if (!action.triggerMagicUse) {
    throw new Error(
      "Field magic pre-cost trigger has no payable magic-use action"
    );
  }

  const stateAfterUsage = recordEffectUsageIfLimited({
    state: options.state,
    sourceInstanceId: pending.triggerSourceInstanceId,
    sourceDefinitionId: pending.triggerSourceDefinitionId,
    effectLabel: FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL,
    usageLimit: { kind: "per_card_name", duration: "turn" },
  });

  const stateAfterTriggerChoice: GameState = {
    ...stateAfterUsage,
    pendingFieldMagicPreCostTrigger: { ...pending, triggered: true },
  };

  // `triggerMagicUse` は getAvailableMagicLegalActions が生成した action そのもの。
  // ここで useFieldCardEffect... を直結せず、既存 use_magic の支払い・in_use・
  // スタック窓・後処理を一括で通す。
  return applyUseMagicAction(
    {
      ...options,
      state: stateAfterTriggerChoice,
      action: action.triggerMagicUse,
    },
    action.triggerMagicUse
  );
}

/**
 * 「trigger」済みの pendingFieldMagicPreCostTrigger を、効果チェーン完全解決後に再評価する。
 * P3-86 案X の resumeStackCascadeIfReady と同じ箇所から呼ばれる第3のフック。
 * 他に何も pending が残っていないことを確認してから中断していた use_magic 呼び出しを
 * 再提示する (= コスト支払いへ戻る)。支払えないなら元カードは使用扱いにせず戻す。
 */
export function resumeFieldMagicPreCostTriggerIfReady(
  state: GameState,
  options: DeferredStackResolverOptions
): GameState {
  const pending = state.pendingFieldMagicPreCostTrigger;
  if (!pending || !pending.triggered) return state;
  if (
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    state.pendingCoreDistribution !== null ||
    state.pendingChangeCleanupChoice !== null ||
    hasPendingTargetedDisclosureCleanupCarrier(state)
  ) {
    return state;
  }
  const originalAction = pending.interruptedMagicUse.action;
  if (originalAction.kind !== "use_magic") return state;
  // battle flash / 通常 stack 内での再提示は、後段で action を返すだけでは足りない。
  // 候補列挙そのものが現在の優先権を gate するため、先に中断元の使用者へ
  // 一時的な提示権を戻した state で共通 availability を通す。親 stack は C12 の
  // core_distribute 完了まで残しておき、元マジックをその上へ再提示する（03a）。
  const flashWindowState = state.activeAttack?.flashWindowState;
  const stackWindow = state.stackWindow;
  const stateForResumption =
    flashWindowState !== null && flashWindowState !== undefined
      ? {
          ...state,
          activeAttack: {
            ...state.activeAttack!,
            flashWindowState: {
              ...flashWindowState,
              priorityPlayerId: originalAction.actingPlayerId,
              consecutivePassCount: 0,
              // 親 stack がないフラッシュ本体では、C12 解決後の通常ループが相手を
              // stack 応答 source にしている。中断元が flash 使用だった場合はここも
              // 使用者へ戻さないと候補が stack timing と誤判定され、flash action を
              // 再提示できない。親 stack が残る場合はその応答 source を保持する。
              ...(flashWindowState.pendingStackAction === null
                ? {
                    stackResponseSourcePlayerId: originalAction.actingPlayerId,
                  }
                : {}),
            },
          },
        }
      : stackWindow !== null && state.window === "stack"
        ? {
            ...state,
            stackWindow: {
              ...stackWindow,
              priorityPlayerId: originalAction.actingPlayerId,
              consecutivePassCount: 0,
            },
          }
        : state;
  const resumedMagicActions = options.getRegisteredMagicActions
    ? getAvailableMagicLegalActions({
        state: stateForResumption,
        actingPlayerId: originalAction.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredMagicActions: options.getRegisteredMagicActions,
        getRegisteredFieldCardEffectActions:
          options.getRegisteredFieldCardEffectActions ?? (() => []),
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options.getRegisteredBattleImmediateEffectActions
          ? {
              getRegisteredBattleImmediateEffectActions:
                options.getRegisteredBattleImmediateEffectActions,
            }
          : {}),
        ...(options.getRegisteredHandActivatedEffectActions
          ? {
              getRegisteredHandActivatedEffectActions:
                options.getRegisteredHandActivatedEffectActions,
            }
          : {}),
      }).filter(
        (candidate) =>
          candidate.sourceInstanceId === originalAction.sourceInstanceId &&
          candidate.timing === originalAction.timing &&
          candidate.effectIndex === originalAction.effectIndex &&
          candidate.costMode === originalAction.costMode
      )
    : [];
  // C12 解決後は、保存済みの支払い指定を再利用せず、現在の候補を legal action として
  // 再提示する。元 action の全コストモードを再列挙した結果がゼロのときだけ、元の使用を
  // 未使用のまま取り消す。
  if (resumedMagicActions.length === 0) {
    return returnInterruptedMagicToOrigin(
      stateForResumption,
      originalAction.sourceInstanceId
    ).state;
  }
  return stateForResumption;
}
