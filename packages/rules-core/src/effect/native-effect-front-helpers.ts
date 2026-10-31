import { requireTriggerChainId } from "../chain-id";
import { deriveEffectAspectForImmunity } from "./effect-aspect";
import { buildSummonActionCostModifier } from "./summon-cost";
import { collectEstablishedLeaveOutcomes } from "./leave-outcome";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
// P2-14 inc9: effect-interpreter god-file 分解。executeEffect 前段 helper 群
// (状態変化検出 / targeted disclosure 予約 / usage 払い戻し / optional step 判定 /
// step target 選択構築 / trigger delta clone 他) を兄弟へ抽出。ExecuteEffectOptions 型のみ
// 親から type import (実行時循環なし)。他は leaf。barrel/振る舞い不変。

import { getBurstSetBlockReason } from "../mechanics/burst-system";
import { immuneProtectedCount } from "../model";
import { isInstanceInOpenResponseWindowOrPendingCascade } from "../stack/stack-window-shared";
import {
  resolveCount,
  resolveCountBound,
  resolveTargetSpec,
  resolveTargetCountBounds,
} from "./target-resolution";
import {
  evaluateCondition,
  resolvePlayerRef,
} from "./structured-effect-interpreter";
import { evaluateApplicability } from "./effect-applicability";
import {
  derivePreventionProfile,
  evaluateBraveCombineAsSummonGate,
  getCandidateTargetInstanceIds,
  getEffectiveTribes,
  isEligibleBraveCombineHost,
  refundEffectUsageIfRecorded,
} from "../legal/legal-actions-shared";
import { hasCannotCombineRestriction } from "../mechanics/act-as-spirit";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "./trigger-system";
import {
  getActionTargetSpec,
  isConditionalCostTargetShortage,
  resolveAmountToNumber,
  resolveBraveCombineIncomingBraveDefinition,
  resolveBraveCombineIncomingBraveInstanceId,
  resolveSetExhaustStateValue,
  resolveTargets,
  targetRequiresBraveCombineHostEligibility,
  targetRequiresSourceAttachedChildren,
} from "./native-target-resolution";
import {
  canAutoExecuteSummonFromZoneCandidate,
  getMaxAutoExecutableSummonFromZoneSelectionCount,
  normalizeSummonFromZoneZone,
  resolveSummonFromZoneCandidates,
} from "./summon-from-zone-candidates";
import {
  resolveHandTrashSearchCandidates,
  resolveHandTrashSwapCandidates,
} from "./zone-search-candidates";
import { canExecuteMoveCardAction } from "./native-move-core-handlers";
import { previewConditionalCoreCost } from "./conditional-cost-core-preview";
import {
  resolveCardExhaustAffect,
  resolveCardImmunityAffect,
} from "./effect-affect-adapter";
import { drawCardsToHand } from "../zone/card-instance-state";
import { isRestrictedToTopOnlyDraw } from "./native-ce-registration-handlers";
import { isHandGainPreventedByOwnEffect } from "./effect-resistance-check";
import { isCardRecoveryRestricted } from "./recovery-restriction";
import { getStepResult, serializeStepContext } from "../step-execution-context";
import { hasPendingLeaveIdentityChanged } from "../state-based-actions";
import { isCardExhaustionForbidden } from "../mechanics/brave-spirit-state-recovery";
import type {
  ActiveStack,
  CardInstance,
  CardDefinition,
  EffectActivationTiming,
  EffectPlayerRef,
  EffectResolutionActionKind,
  GameState,
  PendingEffectTargetGroup,
  PendingTriggeredEffect,
  PostResolutionOracleTrigger,
  ReturnFromTrashAction,
  SummonAction,
  TargetedDisclosureContinuation,
  Zone,
} from "../model";
import type {
  Action,
  Count,
  Effect,
  EffectStep,
  TargetSpec,
} from "../dsl-types";
import type {
  LegalActionTargetPlayerScope,
  RegisteredTargetedEffectActionBase,
} from "../legal/legal-actions-types";
import type { CollectedTriggerEvent } from "./trigger-system";
import type {
  SerializedStepContext,
  StepExecutionContext,
} from "../step-execution-context";
import { mergeTargetLockBypassProfiles } from "./target-affect-gate";
import { snapshotTargetedDisclosureTargetZones } from "./targeted-disclosure-target-snapshot";

function didPendingLeaveStateChange(pre: GameState, post: GameState): boolean {
  if (pre.pendingLeaveEntities.length !== post.pendingLeaveEntities.length) {
    return true;
  }
  const postPendingByInstanceId = new Map(
    post.pendingLeaveEntities.map((pending) => [pending.instanceId, pending])
  );
  if (
    pre.pendingLeaveEntities.some((pending) => {
      const next = postPendingByInstanceId.get(pending.instanceId);
      return (
        next === undefined ||
        hasPendingLeaveIdentityChanged(pending, next) ||
        pending.deferZoneMoveUntilChainEnd !== next.deferZoneMoveUntilChainEnd
      );
    })
  ) {
    return true;
  }
  return pre.cardInstances.some((card, i) => {
    const next = post.cardInstances[i];
    return (
      next !== undefined &&
      card.instanceId === next.instanceId &&
      (card.pendingLeaveKind !== next.pendingLeaveKind ||
        card.pendingLeaveCause !== next.pendingLeaveCause ||
        card.pendingLeaveChainId !== next.pendingLeaveChainId ||
        card.deferZoneMoveUntilChainEnd !== next.deferZoneMoveUntilChainEnd)
    );
  });
}

export function didNonCardActionChangeState(
  actionKind: string,
  pre: GameState,
  post: GameState,
  /**
   * ENGINE-brave-combine-third-party-target: `noop` の `target` 指定時（選択専用 step）は
   * この関数では成否を判定できない（対象解決結果は resolvedTargetIds/affected 側にある）。
   * `null` を返し、呼び出し側の `affected.length > 0` フォールバックに委ねる
   * （対象を解決できていれば succeeded=true になる）。target 未指定時は従来どおり
   * 常に false（何もしない純粋な no-op）。
   */
  hasResolvedTarget?: boolean
): boolean | null {
  switch (actionKind) {
    case "noop":
      return hasResolvedTarget ? null : false;
    case "count_decrease":
    case "count_increase":
    case "count_set":
      return pre.players.some(
        (p, i) => p.countValue !== post.players[i]?.countValue
      );
    case "declare_gimmick":
      return pre.declarationCountThisTurn !== post.declarationCountThisTurn;
    case "correlate_pending_trigger":
      // P3-129: pendingId 相関 append。既に含まれる pendingId や pendingEffectPendingId
      // 未指定時は no-op (exhaust/recover と同型の succeeded 判定)。
      return pre.cardInstances.some((c, i) => {
        const q = post.cardInstances[i];
        return (
          !!q &&
          c.instanceId === q.instanceId &&
          c.pendingTriggerCorrelations !== q.pendingTriggerCorrelations
        );
      });
    case "core_move":
    case "pay_cost":
      return (
        pre.players.some((p, i) => {
          const q = post.players[i]!;
          const preSoul = p.soulCoreLocation;
          const postSoul = q.soulCoreLocation;
          return (
            p.reserveNormalCoreCount !== q.reserveNormalCoreCount ||
            p.reserveSoulCoreCount !== q.reserveSoulCoreCount ||
            p.voidNormalCoreCount !== q.voidNormalCoreCount ||
            p.lifeNormalCoreCount !== q.lifeNormalCoreCount ||
            p.lifeSoulCoreCount !== q.lifeSoulCoreCount ||
            p.trashNormalCoreCount !== q.trashNormalCoreCount ||
            p.trashSoulCoreCount !== q.trashSoulCoreCount ||
            preSoul?.kind !== postSoul?.kind ||
            (preSoul?.kind === "card" &&
              postSoul?.kind === "card" &&
              preSoul.instanceId !== postSoul.instanceId)
          );
        }) ||
        pre.cardInstances.some(
          (c, i) =>
            c.normalCoreCount !== post.cardInstances[i]?.normalCoreCount ||
            c.soulCoreCount !== post.cardInstances[i]?.soulCoreCount
        )
      );
    case "move_self":
    case "move_card": {
      // Field-origin movement queues pendingLeave first, so zones may not change
      // until the leave chain is flushed.
      if (didPendingLeaveStateChange(pre, post)) return true;
      // A field card can move into an under-card role without changing its
      // runtime zone. That is a real move, unlike selecting an unchanged card.
      if (actionKind === "move_card") {
        const afterById = new Map(
          post.cardInstances.map((card) => [card.instanceId, card])
        );
        if (
          pre.cardInstances.some((card) => {
            const after = afterById.get(card.instanceId);
            return (
              after &&
              (card.attachedToInstanceId !== after.attachedToInstanceId ||
                card.underCards.length !== after.underCards.length ||
                card.underCards.some(
                  (entry, i) =>
                    entry.cardInstanceId !==
                      after.underCards[i]?.cardInstanceId ||
                    entry.role !== after.underCards[i]?.role ||
                    entry.roleTag !== after.underCards[i]?.roleTag
                ))
            );
          })
        )
          return true;
      }
      // Hidden deck/hand movement changes only player counters, not instance zones.
      // Visible card movement still falls back to zone-diff affected detection.
      const countChanged = pre.players.some((p, i) => {
        const q = post.players[i];
        return (
          !!q && (p.deckCount !== q.deckCount || p.handCount !== q.handCount)
        );
      });
      return countChanged ? true : null;
    }
    case "life_damage":
    case "life_fill":
      return pre.players.some(
        (p, i) => p.lifeNormalCoreCount !== post.players[i]?.lifeNormalCoreCount
      );
    case "end_single_battle":
      return (
        pre.activeAttack !== post.activeAttack ||
        pre.battleResolutionGroup !== post.battleResolutionGroup ||
        pre.battlesEndedThisTurn !== post.battlesEndedThisTurn
      );
    case "end_attack_step":
      return (
        pre.step !== post.step ||
        pre.window !== post.window ||
        pre.activeAttack !== post.activeAttack ||
        pre.pendingAttackStepEndFinalizations.length !==
          post.pendingAttackStepEndFinalizations.length
      );
    case "end_turn":
      return (
        pre.step !== post.step ||
        pre.window !== post.window ||
        pre.activeAttack !== post.activeAttack ||
        pre.pendingTurnEndFinalizations.length !==
          post.pendingTurnEndFinalizations.length
      );
    case "set_burst":
      return pre.setBurstStates !== post.setBurstStates;
    case "set_self_as_mirage":
      return (
        pre.mirageSetStates.length !== post.mirageSetStates.length ||
        pre.mirageSetStates.some(
          (s, i) =>
            s.playerId !== post.mirageSetStates[i]?.playerId ||
            s.cardInstanceId !== post.mirageSetStates[i]?.cardInstanceId
        ) ||
        pre.cardInstances.some(
          (c, i) =>
            c.zone !== post.cardInstances[i]?.zone ||
            c.zoneRoleName !== post.cardInstances[i]?.zoneRoleName
        )
      );
    case "place_text_role_under_card":
      // engine-aldnoah-drive-under-card-keyword: 配置成功時は置かれたカードの
      // attachedToInstanceId が host へ変わる。既に host.zone==="field" 由来のカードは
      // zone 自体が変化しない（"field"→"field"）ため、zone 差分のみに頼る既定の
      // detectAffectedCards では検出漏れになる（【アルドノアドライブ】の「フィールドの
      // このカード」= 既にスピリット状態で場にいるケース）。attachedToInstanceId の
      // 変化を直接見ることで手札/フィールドいずれの発火元でも正しく succeeded を判定する。
      return pre.cardInstances.some(
        (c, i) =>
          c.attachedToInstanceId !== post.cardInstances[i]?.attachedToInstanceId
      );
    case "enter_soul_state":
      return pre.players.some((p, i) => {
        const q = post.players[i]!;
        return p.soulStateInstanceIds.length !== q.soulStateInstanceIds.length;
      });
    case "quartz_set":
      // resolvedTargetIds が非空なら常に affected 扱いする既定フォールバック
      // (detectAffectedCards) では、duplicate_name/no_eligible_host/no_open_slot/
      // unaffordable の no-op (state 不変・log 追記のみ) を「成功」と誤判定してしまう
      // 入れ替えは総枚数が変わらないため、新規セットinstanceの存在で判定する。
      return post.quartzSetStates.some(
        (q) =>
          !pre.quartzSetStates.some(
            (old) => old.quartzInstanceId === q.quartzInstanceId
          )
      );
    case "advent":
      // ENGINE-effect-triggered-advent-declare: executeAdvent は事前検証
      // (condition-not-met/no-soul-core/target-not-controlled 等) で早期 return する
      // ことがあり、その場合 state は log 追記のみで不変。resolvedTargetIds (対象候補の
      // 選択成否) が非空なら常に affected 扱いする既定フォールバックでは、この no-op を
      // 「成功」と誤判定してしまう (adversarial verifier round1 refute)。煌臨カードが
      // 実際に zone を移動した (hand/trash → field) かで判定する。
      return pre.cardInstances.some(
        (c, i) => c.zone !== post.cardInstances[i]?.zone
      );
    case "brave_combine_effect":
      // trigger_related_instance など固定対象経路では resolvedTargetIds が非空でも、
      // braveCondition / cannot_combine / 多重合体上限で executeBraveCombine が no-op
      // になることがある。実際に attach されたかで ref_succeeded を判定する。
      return pre.cardInstances.some((c, i) => {
        const q = post.cardInstances[i];
        return (
          !!q &&
          c.instanceId === q.instanceId &&
          (c.zone !== q.zone ||
            c.attachedToInstanceId !== q.attachedToInstanceId ||
            c.attachedChildrenIds.length !== q.attachedChildrenIds.length)
        );
      });
    case "effect_immunity":
    case "grant_deck_hand_access":
    case "grant_magic_use":
    case "require_effect_cost":
    case "unblockable":
    case "allow_block_while_exhausted":
    case "allow_attack_while_exhausted":
    case "allow_tapless_battle_declare":
    case "block_unblockable":
    case "allow_simultaneous_attack":
    case "allow_mid_battle_join":
    case "allow_ignore_summon_condition":
    case "grant_game_loss_immunity":
    case "grant_declared_summon_alt_cost":
    case "grant_summon_trash_core_placement":
    case "grant_link_aid_cost_override":
    case "grant_optional_deck_reveal_count_boost":
    case "require_multi_block":
    case "require_block_if_able":
    case "offer_magic_pre_cost_trigger":
    case "force_attack_step_end_after_first_battle":
    case "prevent_battle":
    case "prevent_normal_core_move":
    case "require_battle_cost":
    case "require_attack_exhaust_cost":
    case "require_battle_destroy_cost":
    case "require_hand_gain_cost":
    case "hand_gain_prevention":
    case "prevent_life_damage":
    case "grant_life_damage_source_prevention_immunity":
    case "life_damage_interception":
    case "effect_resistance":
    case "draw_modify":
    case "effect_param_modify":
    case "restrict_end_attack_step":
    case "restrict_end_battle":
    case "restrict_end_step":
    case "restrict_end_turn":
    case "restrict_flash":
    case "restrict_stack":
    case "restrict_burst_activation":
    case "restrict_advent":
    case "restrict_reserve_cost_payment":
    case "restrict_field_cost_payment":
    case "suppress_effect":
    case "suppress_stack_source":
    case "force_first_attacker":
    case "forced_target_inclusion":
    case "gate_flash_stack_core":
    case "gate_flash_stack_hand_discard":
    case "restrict_core_placement":
    case "life_gain_replacement":
    case "life_gain_prevention":
    case "core_move_destination_replacement":
    case "restrict_recovery":
    case "negate":
    case "treat_as":
    case "cost_modify":
    case "count_as_multiple":
    case "override_properties":
      // CE 登録系: activeContinuousEffects の長さ変化で成功判定
      // (no-targets / 未分岐 modifier の場合は CE が登録されずに succeeded=false)
      return (
        pre.activeContinuousEffects.length !==
        post.activeContinuousEffects.length
      );
    case "rebirth":
      // 転醒成功時は definitionId / normalCoreCount / countValue が変わる
      // (not-on-field / no-back-face / count-over / pre-flip lv-deficit / same-timing ブロックで no-op)
      return (
        pre.cardInstances.some(
          (c, i) => c.definitionId !== post.cardInstances[i]?.definitionId
        ) ||
        pre.players.some((p, i) => p.countValue !== post.players[i]?.countValue)
      );
    case "reverse_rebirth":
      // flip は definitionId を即時に戻す。pattern2 summon は支払い/維持コア配置 pending を
      // 立て、resolve_reverse_rebirth_summon 後に新しい A 面 instance へ置換するため、pending
      // の新規作成を action 成功として扱う（後続 step は continuation が待機する）。
      return (
        pre.cardInstances.some(
          (c, i) => c.definitionId !== post.cardInstances[i]?.definitionId
        ) ||
        (pre.pendingReverseRebirthSummon === null &&
          post.pendingReverseRebirthSummon !== null)
      );
    case "stay_on_field":
      // stay_on_field 成功時は対象の exhaustState 更新 + pendingLeaveEntities からの除去
      // (no-targets の場合は state 無変化 → succeeded=false)
      return (
        pre.pendingLeaveEntities.length !== post.pendingLeaveEntities.length ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return (
            !!q &&
            c.instanceId === q.instanceId &&
            c.exhaustState !== q.exhaustState
          );
        })
      );
    case "destroy":
    case "vanish":
    case "bp_compare_destroy":
      // queuePendingLeave 経由で pendingLeaveEntities に追加される（zone は未変化）
      // (no-targets / 全 target 保護の場合は state 無変化 → succeeded は resolvedTargetIds に従う)
      // bp_compare_destroy も比較結果で源/対象の少なくとも一方を queuePendingLeave する。
      return Object.keys(collectEstablishedLeaveOutcomes(pre, post)).length > 0;
    case "suppress_pending_leave_effects":
      return (
        pre.pendingLeaveEntities.some((pendingLeave, i) => {
          const next = post.pendingLeaveEntities[i];
          return (
            next !== undefined &&
            pendingLeave.instanceId === next.instanceId &&
            pendingLeave.suppressDestroyedEffects !==
              next.suppressDestroyedEffects
          );
        }) ||
        pre.pendingTriggeredEffects.some((pending, i) => {
          const next = post.pendingTriggeredEffects[i];
          return (
            next !== undefined &&
            pending.pendingId === next.pendingId &&
            (pending.suppressedSourceInstanceIds !==
              next.suppressedSourceInstanceIds ||
              pending.effectSuppressed !== next.effectSuppressed)
          );
        }) ||
        pre.pendingTriggeredEffects.length !==
          post.pendingTriggeredEffects.length ||
        pre.pendingTriggeredEffects.some(
          (pending, i) =>
            post.pendingTriggeredEffects[i]?.pendingId !== pending.pendingId
        ) ||
        pre.pendingBurstChecks.some((pending, i) => {
          const next = post.pendingBurstChecks[i];
          return (
            next !== undefined &&
            pending.checkId === next.checkId &&
            pending.effectSuppressed !== next.effectSuppressed
          );
        }) ||
        pre.pendingBurstChecks.length !== post.pendingBurstChecks.length ||
        pre.pendingBurstChecks.some(
          (pending, i) =>
            post.pendingBurstChecks[i]?.checkId !== pending.checkId
        )
      );
    case "remove_from_game":
      // フィールド上の対象は queuePendingLeave 経由、フィールド外は直接 removed_from_game へ移動。
      // どちらも「そうしたとき」/ ref_succeeded から成功として見える必要がある。
      return (
        pre.pendingLeaveEntities.length !== post.pendingLeaveEntities.length ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
        })
      );
    case "bounce":
      // field 起点は pendingLeave 経由、field 外は直接 zone 変更
      // （bounce→hand）。bounce は cardInstances 配列を並べ替えないため index 直接比較で安全。
      // 既存 pending の destroy/vanish などを bounce へ遷移する場合は zone/件数が
      // 変わらないため、pendingLeave の中身も成功判定へ含める。
      // (no-targets の場合は state 無変化 → succeeded=false)
      return (
        didPendingLeaveStateChange(pre, post) ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
        })
      );
    case "send_to_deck": {
      // field 起点は pendingLeave 経由、field 外は直接 zone 変更（send_to_deck→deck）。
      // 直接経路は所有者ごとの deck ゾーン塊にグルーピングするため cardInstances 配列を
      // 並べ替える（同一 instanceId が別 index に移動しうる）。index 直接比較では
      // reorder を誤って「無変化」と検出するため、instanceId ベースで pre/post の
      // zone を突き合わせる（ENGINE-send-to-deck-reorder-succeeded-index-bug、
      // BSAZ02-C04 effects[1] の ref_succeeded ゲートで顕在化）。
      // (no-targets の場合は state 無変化 → succeeded は resolvedTargetIds に従う)
      if (
        pre.pendingLeaveEntities.length !== post.pendingLeaveEntities.length
      ) {
        return true;
      }
      const preZoneById = new Map(
        pre.cardInstances.map((c) => [c.instanceId, c.zone])
      );
      return post.cardInstances.some((q) => {
        const preZone = preZoneById.get(q.instanceId);
        return preZone !== undefined && preZone !== q.zone;
      });
    }
    case "bullet_edit":
    case "swap_bullet_edit":
      // P3-116: host 不在/スロット競合等で no-op しても resolvedTargetIds は
      // 非空のまま渡り得るため（detectAffectedCards の resolvedTargetIds 短絡）、
      // 「そうしたとき」ドローの ref_succeeded ゲートを正しく効かせるには
      // 実際の zone 変化 (手札→field の下カード化) を見る必要がある。
      return pre.cardInstances.some((c, i) => {
        const q = post.cardInstances[i];
        return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
      });
    case "discard":
      // 即時破棄時は zone 変化 (hand→trash)、候補超過時は pendingZoneSelection 生成
      // (no-matching / no-op の場合は state 無変化 → succeeded=false)
      return (
        pre.pendingZoneSelection !== post.pendingZoneSelection ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
        })
      );
    case "deck_reveal":
      // 全 mandatory 消化時は zone 変化 (deck→hand/field)、optional/選択待ち時は pendingDeckReveal 生成
      // (revealCount=0 / deck=empty の no-op 時は state 無変化 → succeeded=false)
      return (
        pre.pendingDeckReveal !== post.pendingDeckReveal ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
        })
      );
    case "search_zone":
      // 自動選択時は zone 変化 (deck→hand/field, trash→hand/field/set_aside)、候補超過時は pendingZoneSelection 生成
      // (no-matching / 未対応 zone の no-op 時は state 無変化 → succeeded=false)
      return (
        pre.pendingZoneSelection !== post.pendingZoneSelection ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return !!q && c.instanceId === q.instanceId && c.zone !== q.zone;
        })
      );
    case "summon":
    case "put":
    case "place":
      // 召喚/「出す」成功時は zone 変化 (hand/set_aside/trash → field)
      // 魂状態召喚は field 据え置きで soulState/role/cores だけが変わる。
      // (no-targets / 対象外 zone の no-op 時は state 無変化 → succeeded=false)
      return (
        pre.cardInstances.length !== post.cardInstances.length ||
        pre.players.some((p, i) => {
          const q = post.players[i]!;
          return (
            p.reserveNormalCoreCount !== q.reserveNormalCoreCount ||
            p.trashNormalCoreCount !== q.trashNormalCoreCount ||
            p.soulStateInstanceIds.length !== q.soulStateInstanceIds.length
          );
        }) ||
        pre.cardInstances.some((c, i) => {
          const q = post.cardInstances[i];
          return (
            !!q &&
            c.instanceId === q.instanceId &&
            (c.zone !== q.zone ||
              c.normalCoreCount !== q.normalCoreCount ||
              c.zoneRoleName !== q.zoneRoleName ||
              c.minimumRequiredCores !== q.minimumRequiredCores)
          );
        })
      );
    case "divine_transform":
      // 転神成功時は対象カードの divineTransformState フィールドが null → object に変化
      // (no-targets / 対象外の no-op 時は state 無変化 → succeeded=false)
      return pre.cardInstances.some((c, i) => {
        const q = post.cardInstances[i];
        return (
          !!q &&
          c.instanceId === q.instanceId &&
          c.divineTransformState !== q.divineTransformState
        );
      });
    case "grant_extra_turn":
      return (
        pre.extraTurnState !== post.extraTurnState ||
        pre.pendingExtraTurn !== post.pendingExtraTurn
      );
    case "grant_extra_steps":
      // ENGINE-extra-turn-step-insertion: pendingExtraSteps キューへの追記で成否判定。
      return (
        (pre.pendingExtraSteps?.length ?? 0) !==
        (post.pendingExtraSteps?.length ?? 0)
      );
    case "skip_next_turn":
      // ENGINE-opponent-turn-skip: pendingTurnSkips キューへの追記で成否判定。
      return (
        (pre.pendingTurnSkips?.length ?? 0) !==
        (post.pendingTurnSkips?.length ?? 0)
      );
    case "reveal_hand":
      // 純粋な閲覧アクション。ゾーン移動は伴わず、log push のみ。
      // マッチング手札 0 枚時は executeRevealHand 側で no-op にする（log 不変 → succeeded=false）。
      return pre.log.length !== post.log.length;
    case "peek_deck":
      // デッキ閲覧アクション。ゾーン移動は伴わず、log push のみ。
      // 0 枚時は executePeekDeck 側で no-op (log 不変 → succeeded=false)。
      return pre.log.length !== post.log.length;
    case "shuffle_zone":
      // ゾーン内シャッフル。zone は変わらないが cardInstances の並びが変化する。
      // 0/1 枚時は no-op (log 不変 → succeeded=false)。
      return pre.log.length !== post.log.length;
    case "set_exhaust_state":
      if (
        post.log
          .slice(pre.log.length)
          .some((entry) => entry.startsWith("field-position:"))
      )
        return true;
    // falls through
    case "exhaust":
    case "recover":
      // 疲労状態アクション: 対象の exhaustState に変化があれば succeeded=true。
      // 既に目的の状態なら no-op (state 不変 → succeeded=false → conditional_cost ロールバック)。
      return pre.cardInstances.some((c, i) => {
        const q = post.cardInstances[i];
        return (
          !!q &&
          c.instanceId === q.instanceId &&
          c.exhaustState !== q.exhaustState
        );
      });
    case "discard_set_burst":
      // バースト破棄成功時は setBurstStates が短くなる（zone も burst→trash）。
      // 対象 setBurstStates が空の no-op 時は state 不変 → succeeded=false。
      return pre.setBurstStates.length !== post.setBurstStates.length;
    default:
      return null; // Not a non-card-moving action — use card zone detection
  }
}

export function didCountDecreasePayFullAmount(
  action: Extract<Action, { kind: "count_decrease" }>,
  pre: GameState,
  post: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  // ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: amount が {min,max}
  // (「好きなだけ減らせる」型) のときは native-action-registry の count_decrease ハンドラが
  // pendingCountSelection を生成するのみで state は未変化 (pre===post)。この呼び出し結果は
  // 直後の newCountSelectionPending 検出で早期 return されるため未使用 (安全に true を返す)。
  if (
    typeof action.amount === "object" &&
    action.amount !== null &&
    "min" in action.amount
  ) {
    return true;
  }
  const requested = resolveAmountToNumber(
    action.amount,
    pre,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  if (requested <= 0) return true;

  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player as EffectPlayerRef,
    pre
  );
  const before = pre.players.find((player) => player.id === targetPlayerId);
  const after = post.players.find((player) => player.id === targetPlayerId);
  if (!before || !after) return false;
  return before.countValue - after.countValue >= requested;
}

export function hasImplementedTargetedResponder(options: {
  state: GameState;
  event: CollectedTriggerEvent;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: import("./trigger-system").BurstActionRegistrationLookup;
}): boolean {
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: `targeted-probe:${options.event.chainId ?? "none"}:${options.event.relatedInstanceId ?? "none"}`,
    actingPlayerId: options.event.actingPlayerId,
    eventKind: "targeted",
    event: {
      family: "targeting",
      ...(options.event.cause !== undefined
        ? { cause: options.event.cause }
        : {}),
      ...(options.event.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.event.effectActivationTiming }
        : {}),
      validationMode: "require_related_instance_on_field",
    },
    source: options.event.source,
    chainId: requireTriggerChainId(options.event.chainId),
    attackId: options.event.attackId,
    relatedPlayerId: options.event.relatedPlayerId,
    relatedInstanceId: options.event.relatedInstanceId,
    ...(options.event.cause !== undefined
      ? { cause: options.event.cause }
      : {}),
    amount: options.event.amount,
    step: options.state.step,
    window: options.state.window,
    resolvedSourceInstanceIds: [],
    ...(options.event.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.event.effectSourceInstanceId }
      : {}),
    ...(options.event.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.event.effectSourceDefinitionId }
      : {}),
    ...(options.event.effectActionKind !== undefined
      ? { effectActionKind: options.event.effectActionKind }
      : {}),
    ...(options.event.effectActivationTiming !== undefined
      ? { effectActivationTiming: options.event.effectActivationTiming }
      : {}),
  };
  const choices = getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  return choices.some((choice) => {
    const effectIndex = choice.actionRegistration.effectIndex;
    const effect =
      effectIndex !== undefined
        ? choice.sourceEffectDefinition.effects?.[effectIndex]
        : undefined;
    if (!effect) return false;
    return !(effect.stub && effect.steps.length === 0);
  });
}

export function queueTargetedDisclosureForStep(options: {
  state: GameState;
  selectedTargetInstanceIds: readonly string[];
  resumeTargetInstanceIds?: readonly string[];
  resumeTargetGroups?: readonly PendingEffectTargetGroup[];
  resumeSequentialTargetConsumption?: boolean;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectActionKind?: EffectResolutionActionKind;
  effectActivationTiming?: EffectActivationTiming;
  chainId?: string | null;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は divineSkills 側 (`grandwalkerData.divineSkills[divineSkillIndex]
   * .effects[]`) を指す（top-level `effects[]` ではない）。省略時 = 従来通り top-level `effects[]`。
   * ENGINE-divine-skill-nested-effect-continuation 参照。
   */
  divineSkillIndex?: number;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す。 */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  resumeStepIndex: number;
  /** optional step の execute 選択後に中断した場合の resume 用 bypass index。 */
  optionalExecuteResumeStepIndex?: number;
  targetStepId: string;
  stepContext: SerializedStepContext;
  /** on_step repeat の対象化開示後に同じ追加巡を再開するための状態。 */
  repeatResume?: import("../model").EffectStepRepeatResume;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: import("./trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions?: import("./trigger-system").BurstActionRegistrationLookup;
  choiceIndex?: number;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  battleEndDeferralAttackId?: string;
  effectResolutionBeforeState?: GameState;
  disclosureTargetStart?: number;
  disclosureTargetCount?: number;
  targetCandidateInstanceIds?: readonly string[];
  coreDistributionPending?: NonNullable<GameState["pendingCoreDistribution"]>;
  coreDistributionAllocations?: Record<string, number>;
  coreDistributionSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreInstanceId?: string;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  targetedEventSourceInstanceId?: string;
  targetedEventSourceDefinitionId?: string;
  /** P3-131層2: negate 照合用の元 ActiveStack スナップショット (model.ts TargetedDisclosureContinuation 参照)。 */
  negateIdentitySnapshot?: ActiveStack;
}): { state: GameState; queued: boolean } {
  if (options.selectedTargetInstanceIds.length === 0) {
    return { state: options.state, queued: false };
  }

  const uniqueTargetInstanceIds: string[] = [];
  const seenTargetInstanceIds = new Set<string>();
  for (const targetInstanceId of options.selectedTargetInstanceIds) {
    if (seenTargetInstanceIds.has(targetInstanceId)) continue;
    seenTargetInstanceIds.add(targetInstanceId);
    uniqueTargetInstanceIds.push(targetInstanceId);
  }

  // Each step and activation starts a distinct reaction interval. Reusing an
  // event ID lets an older completion hide its new trigger as an outer one.
  // Keep the continuation's body chain unchanged; namespace only its events.
  const disclosureEventChainId =
    options.chainId != null
      ? `${options.chainId}:step:${options.resumeStepIndex}:activation:${options.repeatResume ? options.repeatResume.nextAdditionalIndex + 1 : 0}`
      : options.chainId;
  const events: CollectedTriggerEvent[] = [];
  for (const [
    targetIndex,
    targetInstanceId,
  ] of uniqueTargetInstanceIds.entries()) {
    // ENGINE-targeted-disclosure-offfield-source: フィールド外で自身の効果が
    // 発揮中 (= 開いている応答窓の保留 ActiveStack 鎖に自身の instanceId が乗って
    // いる) の対象も disclosure に含める (BSLH01-T14 型)。effect-target-handlers.ts
    // の同型ゲートと同じ isInstanceInOpenResponseWindowOrPendingCascade を使う (SSOT)。
    const target = options.state.cardInstances.find(
      (card) =>
        card.instanceId === targetInstanceId &&
        (card.zone === "field" ||
          isInstanceInOpenResponseWindowOrPendingCascade(
            options.state,
            targetInstanceId
          ))
    );
    if (!target) continue;
    const targetOccurrenceIndex =
      (options.disclosureTargetStart ?? 0) + targetIndex;
    const cause =
      target.controllerPlayerId === options.actingPlayerId
        ? "self_effect"
        : "opponent_effect";
    events.push({
      actingPlayerId: target.controllerPlayerId,
      eventKind: "targeted",
      source: "action_resolution",
      chainId:
        disclosureEventChainId !== undefined && disclosureEventChainId !== null
          ? `${disclosureEventChainId}:target:${targetOccurrenceIndex}`
          : null,
      attackId: options.state.activeAttack?.attackId ?? null,
      relatedPlayerId: target.controllerPlayerId,
      relatedInstanceId: target.instanceId,
      cause,
      amount: 1,
      effectSourceInstanceId:
        options.targetedEventSourceInstanceId ?? options.sourceInstanceId,
      effectSourceDefinitionId:
        options.targetedEventSourceDefinitionId ?? options.sourceDefinitionId,
      ...(options.effectActionKind !== undefined
        ? { effectActionKind: options.effectActionKind }
        : {}),
      ...(options.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.effectActivationTiming }
        : {}),
      // P3-130: queue 時点 (窓がまだ開いている) のスナップショット。declare 時点は
      // P3-34 により窓が必ず閉じるため、宣言可否判定側はこれを優先する。
      relatedInstanceOffFieldActivating: target.zone !== "field",
    });
  }

  const implementedEvents = events.filter((event) =>
    hasImplementedTargetedResponder({
      state: options.state,
      event,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    })
  );
  if (implementedEvents.length === 0) {
    return { state: options.state, queued: false };
  }

  const beforePendingCount =
    options.state.pendingTriggeredEffects.length +
    options.state.pendingPrivateDeclarations.length +
    options.state.pendingBurstChecks.length;
  const queuedState = queuePendingReactionsFromTriggerEvents(
    options.state,
    implementedEvents,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
  const afterPendingCount =
    queuedState.pendingTriggeredEffects.length +
    queuedState.pendingPrivateDeclarations.length +
    queuedState.pendingBurstChecks.length;
  if (afterPendingCount <= beforePendingCount) {
    return { state: queuedState, queued: false };
  }

  const pendingId = `targeted-disclosure:${disclosureEventChainId ?? options.sourceInstanceId}:${options.resumeStepIndex}:${queuedState.pendingTriggeredEffects.length}`;
  const previousContinuation =
    options.state.pendingTargetedDisclosureContinuation;
  const continuation: TargetedDisclosureContinuation = {
    pendingId,
    chainId: requireTriggerChainId(options.chainId),
    sourceDefinitionId: options.sourceDefinitionId,
    effectIndex: options.effectIndex,
    ...(options.divineSkillIndex !== undefined
      ? { divineSkillIndex: options.divineSkillIndex }
      : {}),
    ...(options.isAccelData !== undefined
      ? { isAccelData: options.isAccelData }
      : {}),
    ...(options.isChangeData !== undefined
      ? { isChangeData: options.isChangeData }
      : {}),
    sourceInstanceId: options.sourceInstanceId,
    ...(options.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.effectSourceInstanceId }
      : {}),
    ...(options.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.effectSourceDefinitionId }
      : {}),
    ...(options.effectActionKind !== undefined
      ? { effectActionKind: options.effectActionKind }
      : {}),
    ...(options.effectActivationTiming !== undefined
      ? { effectActivationTiming: options.effectActivationTiming }
      : {}),
    actingPlayerId: options.actingPlayerId,
    resumeStepIndex: options.resumeStepIndex,
    ...(options.optionalExecuteResumeStepIndex !== undefined
      ? {
          optionalExecuteResumeStepIndex:
            options.optionalExecuteResumeStepIndex,
        }
      : {}),
    stepContext: options.stepContext,
    ...(options.repeatResume !== undefined
      ? { repeatResume: options.repeatResume }
      : {}),
    targetInstanceIds: [
      ...(options.resumeTargetInstanceIds ?? options.selectedTargetInstanceIds),
    ],
    targetZonesByInstanceId: snapshotTargetedDisclosureTargetZones(
      queuedState,
      options.resumeTargetInstanceIds ?? options.selectedTargetInstanceIds
    ),
    ...(options.targetCandidateInstanceIds !== undefined
      ? { targetCandidateInstanceIds: [...options.targetCandidateInstanceIds] }
      : {}),
    ...(options.coreDistributionPending !== undefined
      ? { coreDistributionPending: options.coreDistributionPending }
      : {}),
    ...(options.coreDistributionAllocations !== undefined
      ? {
          coreDistributionAllocations: {
            ...options.coreDistributionAllocations,
          },
        }
      : {}),
    ...(options.coreDistributionSourceAllocations !== undefined
      ? {
          coreDistributionSourceAllocations: {
            ...options.coreDistributionSourceAllocations,
          },
        }
      : {}),
    ...(options.coreDistributionSoulCoreSourceAllocations !== undefined
      ? {
          coreDistributionSoulCoreSourceAllocations: {
            ...options.coreDistributionSoulCoreSourceAllocations,
          },
        }
      : {}),
    ...(options.coreDistributionSoulCoreAllocations !== undefined
      ? {
          coreDistributionSoulCoreAllocations: {
            ...options.coreDistributionSoulCoreAllocations,
          },
        }
      : {}),
    ...(options.coreDistributionSoulCoreInstanceId !== undefined
      ? {
          coreDistributionSoulCoreInstanceId:
            options.coreDistributionSoulCoreInstanceId,
        }
      : {}),
    ...(options.resumeTargetGroups !== undefined
      ? { targetGroups: [...options.resumeTargetGroups] }
      : {}),
    ...(options.resumeSequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    targetStepId: options.targetStepId,
    ...(options.disclosureTargetStart !== undefined
      ? { skipTargetedDisclosureTargetStart: options.disclosureTargetStart }
      : {}),
    ...(options.disclosureTargetCount !== undefined
      ? { skipTargetedDisclosureTargetCount: options.disclosureTargetCount }
      : {}),
    remainingStacks: [],
    ...(options.negateIdentitySnapshot !== undefined
      ? { negateIdentitySnapshot: options.negateIdentitySnapshot }
      : {}),
    ...(options.effectResolutionBeforeState !== undefined
      ? { effectResolutionBeforeState: options.effectResolutionBeforeState }
      : {}),
    ...(options.choiceIndex !== undefined
      ? { choiceIndex: options.choiceIndex }
      : {}),
    ...(options.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: options.sourcePreventionLevel }
      : {}),
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: options.costPaidThisEffect }
      : {}),
    ...(options.postResolutionOracle !== undefined
      ? { postResolutionOracle: options.postResolutionOracle }
      : {}),
    ...(options.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: options.battleEndDeferralAttackId }
      : {}),
    ...(previousContinuation !== null
      ? { previousTargetedDisclosureContinuation: previousContinuation }
      : {}),
  };

  return {
    state: {
      ...queuedState,
      pendingTargetedDisclosureContinuation: continuation,
      log: [
        ...queuedState.log,
        `effect:target-disclosure:queued:${options.chainId ?? options.sourceInstanceId}:${options.selectedTargetInstanceIds.join(",")}`,
      ],
    },
    queued: true,
  };
}

/**
 * P3-62 払い戻しを recordedUsage の全エントリ (主記録 + extraRecords) へ対称に適用する。
 * choice 変種別ラベル (「1回ずつ」) が共有ラベルと併存していても取りこぼさない。
 */
export function refundAllRecordedUsage(
  state: GameState,
  sourceInstanceId: string,
  recordedUsage: import("../model").RecordedEffectUsage
): GameState {
  const entries: readonly import("../model").RecordedEffectUsageEntry[] = [
    recordedUsage,
    ...(recordedUsage.extraRecords ?? []),
  ];
  let current = state;
  for (const entry of entries) {
    current = refundEffectUsageIfRecorded({
      state: current,
      sourceInstanceId: entry.sourceInstanceId ?? sourceInstanceId,
      effectLabel: entry.effectLabel,
      usageLimit: entry.usageLimit as
        | import("../model").EffectUsageLimit
        | import("../model").EffectUsageLimit[],
      ...(entry.groupId ? { groupId: entry.groupId } : {}),
      ...(entry.relatedInstanceId
        ? { relatedInstanceId: entry.relatedInstanceId }
        : {}),
      ...(entry.triggerEventScopeKey
        ? { triggerEventScopeKey: entry.triggerEventScopeKey }
        : {}),
    });
  }
  return current;
}

export function shouldRefundRecordedUsageForConditionalCostRollback(
  stepCtx: StepExecutionContext
): boolean {
  return stepCtx.conditionalCostSnapshotHadPriorSuccess !== true;
}

function resolveRequiredOptionalActionCount(args: {
  count: Count;
  state: GameState;
  actingPlayerId: string;
  stepCtx: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): number {
  const { count } = args;
  if (count === "all") return 1;
  if (typeof count === "number") return Math.max(0, count);
  if (typeof count === "object" && count !== null && "min" in count) {
    const min =
      typeof count.min === "number"
        ? count.min
        : resolveCountBound(
            count.min,
            args.state,
            args.actingPlayerId,
            args.stepCtx,
            args.getCardDefinitionById
          );
    return Math.max(0, min);
  }
  return Math.max(
    0,
    resolveCount(
      count,
      args.state,
      args.actingPlayerId,
      args.stepCtx,
      args.getCardDefinitionById
    )
  );
}

export function canExecuteOptionalStep(args: {
  /** 対価ではない固定数破壊は、対象が不足していても可能な限り実行する。 */
  allowPartialTargetCount?: boolean;
  /** 任意発揮を選ぶ場面では空撃ちも選べる。強制の対象0体は呼出元が自動不発にする。 */
  allowEmptyTargets?: boolean;
  action: Action;
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  sourceDefinition?: CardDefinition;
  effectSourceInstanceId?: string;
  effectSourceDefinition?: CardDefinition;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  effectActionKind?: EffectResolutionActionKind;
  sourceCardReferenceInstanceId?: string;
  effect?: Effect;
  effectIndex?: number | undefined;
  targetStepId?: string;
}): boolean {
  // Availability callers can start from an empty step context. Source-relative
  // filters still need the same source identity as real step execution.
  if (args.stepCtx.sourceInstanceId === undefined) {
    args = {
      ...args,
      stepCtx: { ...args.stepCtx, sourceInstanceId: args.sourceInstanceId },
    };
  }
  if (args.action.kind === "core_move" && args.action.requireFullCount) {
    const preview = previewConditionalCoreCost({
      ...args,
      effectSourceDefinitionId: args.effectSourceDefinition?.cardNo,
    });
    if (preview) return preview.paid;
  }
  const exhaustStateExecutable = canExecuteExhaustStateChangeStep(args);
  if (exhaustStateExecutable !== undefined) {
    return exhaustStateExecutable;
  }

  if (args.action.kind === "count_decrease") {
    // ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: amount が {min,max}
    // (「好きなだけ減らせる」型) は min=0 (通常) を選べるため常に実行可能。native-action-registry
    // の count_decrease ハンドラが pendingCountSelection 経由で実際の選択範囲を判定する。
    if (
      typeof args.action.amount === "object" &&
      args.action.amount !== null &&
      "min" in args.action.amount
    ) {
      return true;
    }
    const requested = resolveAmountToNumber(
      args.action.amount,
      args.state,
      args.actingPlayerId,
      args.stepCtx,
      args.getCardDefinitionById
    );
    if (requested <= 0) return true;
    const targetPlayerId = resolvePlayerRef(
      args.actingPlayerId,
      args.action.player as EffectPlayerRef,
      args.state
    );
    const targetPlayer = args.state.players.find(
      (player) => player.id === targetPlayerId
    );
    if (!targetPlayer) return false;
    const effectSourceInstanceId =
      args.effectSourceInstanceId ?? args.sourceInstanceId;
    const effectSourceCard = args.state.cardInstances.find(
      (card) => card.instanceId === effectSourceInstanceId
    );
    const effectSourceDefinition =
      args.effectSourceDefinition ??
      (effectSourceCard
        ? args.getCardDefinitionById(effectSourceCard.definitionId)
        : args.sourceDefinition);
    const sourceTribes = getEffectiveTribes(
      args.state,
      effectSourceCard,
      effectSourceDefinition,
      args.getCardDefinitionById
    );
    const protectedCount = immuneProtectedCount(
      targetPlayer.protectedCounts,
      sourceTribes
    );
    const reducible = Math.max(0, targetPlayer.countValue - protectedCount);
    return reducible >= requested;
  }
  if (args.action.kind === "deck_reveal") {
    const revealCount = resolveAmountToNumber(
      args.action.revealCount,
      args.state,
      args.actingPlayerId,
      args.stepCtx,
      args.getCardDefinitionById
    );
    if (revealCount <= 0) return false;
    const targetPlayerId = resolvePlayerRef(
      args.actingPlayerId,
      (args.action.player ?? "self") as EffectPlayerRef,
      args.state
    );
    return args.state.cardInstances.some(
      (card) => card.ownerPlayerId === targetPlayerId && card.zone === "deck"
    );
  }
  if (args.action.kind === "draw") {
    const drawPlayerId = resolvePlayerRef(
      args.actingPlayerId,
      (args.action.player ?? "self") as EffectPlayerRef,
      args.state
    );
    const drawCount =
      args.action.targetHandSize !== undefined
        ? Math.max(
            0,
            args.action.targetHandSize -
              (args.state.players.find((player) => player.id === drawPlayerId)
                ?.handCount ?? 0)
          )
        : resolveCount(
            args.action.count,
            args.state,
            drawPlayerId,
            args.stepCtx,
            args.getCardDefinitionById
          );
    if (drawCount <= 0) return false;
    // ことで構文の結果が事前に不可能なら、対価だけを宣言させない (03c:56)。
    // 共通draw primitiveの純粋previewで、実解決と同じ範囲・部分耐性を照合する。
    if (
      isHandGainPreventedByOwnEffect(
        args.state,
        drawPlayerId,
        args.actingPlayerId
      )
    )
      return false;
    const sourceIdentity = resolveAffectSourceIdentity({
      state: args.state,
      sourceInstanceId: args.sourceInstanceId,
      sourceDefinition: args.sourceDefinition,
      effectSourceInstanceId: args.effectSourceInstanceId,
      effectSourceDefinition: args.effectSourceDefinition,
      getCardDefinitionById: args.getCardDefinitionById,
    });
    const definitionIndex = args.effect
      ? (
          args.effectSourceDefinition ?? args.sourceDefinition
        )?.effects?.indexOf(args.effect)
      : undefined;
    const effectActivationTiming =
      args.stepCtx.effectActivationTiming ??
      (args.effect?.timing.kind === "activated" &&
      args.effect.timing.mode !== "any"
        ? args.effect.timing.mode
        : undefined);
    const position = isRestrictedToTopOnlyDraw(args.state, drawPlayerId)
      ? "top"
      : args.action.position;
    return (
      drawCardsToHand(
        args.state,
        drawPlayerId,
        drawCount,
        position,
        (card) =>
          resolveCardImmunityAffect(
            args.state,
            card,
            args.actingPlayerId,
            args.sourcePreventionLevel ?? "none",
            {
              instance: sourceIdentity.instance,
              definition: sourceIdentity.definition,
              effectIndex:
                args.effectIndex ??
                (definitionIndex !== undefined && definitionIndex >= 0
                  ? definitionIndex
                  : undefined),
              targetStepId: args.targetStepId,
              effectActivationTiming,
            },
            args.getCardDefinitionById,
            args.sourcePreventionBypass
          ).kind === "allowed"
      ).amount > 0
    );
  }
  if (args.action.kind === "place") {
    const card = args.state.cardInstances.find(
      (c) => c.instanceId === args.sourceInstanceId
    );
    const definition = card
      ? args.getCardDefinitionById(card.definitionId)
      : undefined;
    if (!card || !definition || definition.printedCategory !== "nexus") {
      return false;
    }
    const isSoulState = args.state.players.some((player) =>
      player.soulStateInstanceIds.includes(card.instanceId)
    );
    return card.zone !== "field" || isSoulState;
  }
  if (args.action.kind === "brave_combine_effect") {
    let incomingBraveInstanceId = args.sourceInstanceId;
    let incomingBraveDefinition = args.sourceDefinition;
    let incomingBraveCard = args.state.cardInstances.find(
      (card) => card.instanceId === incomingBraveInstanceId
    );
    if (args.action.source) {
      const sourceResult = getStepResult(
        args.stepCtx,
        args.action.source.stepId
      );
      const refInstanceId = sourceResult?.affectedCardInstanceIds?.[0];
      if (!refInstanceId) return false;
      incomingBraveInstanceId = refInstanceId;
      const refCard = args.state.cardInstances.find(
        (card) => card.instanceId === refInstanceId
      );
      incomingBraveCard = refCard;
      incomingBraveDefinition = refCard
        ? args.getCardDefinitionById(refCard.definitionId)
        : undefined;
    }
    if (
      hasCannotCombineRestriction(
        args.state,
        incomingBraveInstanceId,
        incomingBraveDefinition
      )
    ) {
      return false;
    }
    if (args.action.asSummon === true) {
      if (!incomingBraveCard || !incomingBraveDefinition) return false;
      const summonGate = evaluateBraveCombineAsSummonGate({
        state: args.state,
        brave: incomingBraveCard,
        braveDef: incomingBraveDefinition,
        getCardDefinitionById: args.getCardDefinitionById,
        evaluateCondition,
      });
      if (summonGate.kind !== "allowed") return false;
    }
    const hostIds = resolveTargets(
      args.action,
      args.state,
      args.actingPlayerId,
      args.sourceInstanceId,
      args.getCardDefinitionById,
      args.stepCtx,
      undefined,
      args.sourceDefinition,
      args.sourcePreventionLevel,
      args.sourceTargetLockBypass,
      args.sourcePreventionBypass
    );
    if (!hostIds || hostIds.length === 0) return false;
    return hostIds.every((hostId) => {
      const host = args.state.cardInstances.find(
        (card) => card.instanceId === hostId
      );
      const hostDefinition = host
        ? args.getCardDefinitionById(host.definitionId)
        : undefined;
      return (
        host !== undefined &&
        hostDefinition !== undefined &&
        incomingBraveDefinition !== undefined &&
        isEligibleBraveCombineHost({
          state: args.state,
          host,
          hostDefinition,
          incomingBraveCondition: incomingBraveDefinition.braveCondition,
          ...(incomingBraveCard ? { incomingBrave: incomingBraveCard } : {}),
          incomingBraveDef: incomingBraveDefinition,
          getCardDefinitionById: args.getCardDefinitionById,
        })
      );
    });
  }
  if (
    (args.action.kind === "summon" || args.action.kind === "put") &&
    args.action.target.kind === "from_zone" &&
    args.action.target.filter?.soulState !== "only"
  ) {
    const required = resolveRequiredOptionalActionCount({
      count: args.action.target.count,
      state: args.state,
      actingPlayerId: args.actingPlayerId,
      stepCtx: args.stepCtx,
      getCardDefinitionById: args.getCardDefinitionById,
    });
    if (required <= 0) return true;
    const candidates = resolveSummonFromZoneCandidates(
      args.state,
      args.actingPlayerId,
      {
        zone: args.action.target.zone,
        ...(args.action.target.filter
          ? { filter: args.action.target.filter }
          : {}),
        ...(args.action.target.includeAdventSource
          ? { includeAdventSource: true }
          : {}),
        ...(args.action.target.includeSoulState
          ? { includeSoulState: true }
          : {}),
        ...(args.action.costModifier === "full_reduction"
          ? { fullReduction: true }
          : {}),
        // engine-advent-source-leave-summon (BSSG01-C08 Lv2)
        ...(args.action.target.restrictToTriggerLeaveAdventSource
          ? {
              restrictToInstanceIds:
                args.stepCtx.triggerAdventSourceInstanceIds ?? [],
            }
          : {}),
      },
      args.getCardDefinitionById
    );
    const nativeAction: SummonAction = {
      ...(args.action.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: args.action.fieldCoreSourceMinimum }
        : {}),
      kind: "summon",
      target: "other",
      zone: normalizeSummonFromZoneZone(args.action.target.zone),
      count: required,
      summonCause:
        args.effectActionKind === "burst_activation" ? "burst" : "effect",
      ...(args.action.target.filter
        ? { filter: args.action.target.filter }
        : {}),
      ...buildSummonActionCostModifier(args.action.costModifier),
      ...(args.action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: args.action.onBoardCoreSourceFilter }
        : {}),
      ...(args.action.trashCoreMax !== undefined
        ? { trashCoreMax: args.action.trashCoreMax }
        : {}),
      ...(args.action.trashCoreKind !== undefined
        ? { trashCoreKind: args.action.trashCoreKind }
        : {}),
      ...("ignoreSummonCondition" in args.action &&
      args.action.ignoreSummonCondition
        ? { ignoreSummonCondition: true }
        : {}),
      ...(args.action.target.includeAdventSource
        ? { includeAdventSource: true }
        : {}),
      ...(args.action.target.includeSoulState
        ? { includeSoulState: true }
        : {}),
    };
    const executableCandidates = candidates.filter((candidate) =>
      canAutoExecuteSummonFromZoneCandidate({
        state: args.state,
        actingPlayerId: args.actingPlayerId,
        action: nativeAction,
        candidate,
        getCardDefinitionById: args.getCardDefinitionById,
      })
    );
    const maxExecutableSelectionCount =
      getMaxAutoExecutableSummonFromZoneSelectionCount({
        state: args.state,
        actingPlayerId: args.actingPlayerId,
        action: nativeAction,
        candidates: executableCandidates,
        getCardDefinitionById: args.getCardDefinitionById,
      });
    return maxExecutableSelectionCount >= required;
  }
  if (args.action.kind === "search_zone") {
    const zones = Array.isArray(args.action.zone)
      ? args.action.zone
      : [args.action.zone];
    if (zones.every((zone) => zone === "hand" || zone === "trash")) {
      const required = resolveRequiredOptionalActionCount({
        count: args.action.count,
        state: args.state,
        actingPlayerId: args.actingPlayerId,
        stepCtx: args.stepCtx,
        getCardDefinitionById: args.getCardDefinitionById,
      });
      if (required <= 0) return true;
      const zoneOwnerId = resolvePlayerRef(
        args.actingPlayerId,
        args.action.player ?? "self",
        args.state
      );
      const effectSourceCard = args.state.cardInstances.find(
        (card) =>
          card.instanceId ===
          (args.effectSourceInstanceId ?? args.sourceInstanceId)
      );
      const effectSource: {
        instance?: CardInstance;
        definition?: CardDefinition;
      } = {
        ...(effectSourceCard ? { instance: effectSourceCard } : {}),
        ...(args.effectSourceDefinition
          ? { definition: args.effectSourceDefinition }
          : {}),
      };
      const returnDestination:
        | ReturnFromTrashAction["destination"]
        | undefined =
        zones.length === 1 && zones[0] === "trash"
          ? args.action.destination === "hand" ||
            args.action.destination === "field" ||
            args.action.destination === "set_aside" ||
            args.action.destination === "deck" ||
            args.action.destination === "removed_from_game"
            ? args.action.destination
            : undefined
          : undefined;
      const candidates = resolveHandTrashSearchCandidates({
        state: args.state,
        actingPlayerId: args.actingPlayerId,
        zoneOwnerId,
        zones: zones as readonly ("hand" | "trash")[],
        ...(args.action.filter ? { filter: args.action.filter } : {}),
        getCardDefinitionById: args.getCardDefinitionById,
        ...(args.effectSourceDefinition !== undefined
          ? { sourceDefinition: args.effectSourceDefinition }
          : args.sourceDefinition !== undefined
            ? { sourceDefinition: args.sourceDefinition }
            : {}),
        ...(args.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: args.sourcePreventionLevel }
          : {}),
        effectSource,
        ...(args.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: args.sourcePreventionBypass }
          : {}),
        ...(returnDestination !== undefined
          ? { returnFromTrashDestination: returnDestination }
          : {}),
      });
      return candidates.length >= required;
    }
  }
  if (args.action.kind === "queue_hand_trash_swap") {
    const effectSourceCard = args.state.cardInstances.find(
      (card) =>
        card.instanceId ===
        (args.effectSourceInstanceId ?? args.sourceInstanceId)
    );
    const effectSource =
      effectSourceCard || args.effectSourceDefinition
        ? {
            ...(effectSourceCard ? { instance: effectSourceCard } : {}),
            ...(args.effectSourceDefinition
              ? { definition: args.effectSourceDefinition }
              : {}),
          }
        : undefined;
    const { outgoingCandidates, incomingCandidates } =
      resolveHandTrashSwapCandidates({
        state: args.state,
        sourceInstanceId: args.sourceInstanceId,
        actingPlayerId: args.actingPlayerId,
        action: args.action,
        getCardDefinitionById: args.getCardDefinitionById,
        ...(args.effectSourceDefinition !== undefined
          ? { sourceDefinition: args.effectSourceDefinition }
          : args.sourceDefinition !== undefined
            ? { sourceDefinition: args.sourceDefinition }
            : {}),
        ...(args.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: args.sourcePreventionLevel }
          : {}),
        ...(effectSource !== undefined ? { effectSource } : {}),
        ...(args.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: args.sourcePreventionBypass }
          : {}),
      });
    return outgoingCandidates.length > 0 && incomingCandidates.length > 0;
  }
  if (args.action.kind === "move_card" && !args.action.target) {
    return canExecuteMoveCardAction({
      action: args.action,
      state: args.state,
      actingPlayerId: args.actingPlayerId,
      sourceInstanceId: args.sourceInstanceId,
      getCardDefinitionById: args.getCardDefinitionById,
      stepCtx: args.stepCtx,
      ...(args.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: args.sourcePreventionLevel }
        : {}),
      ...(args.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: args.sourcePreventionBypass }
        : {}),
    });
  }
  const target = getActionTargetSpec(args.action);
  if (!target) return true;
  const resolvedTargetIds = resolveTargets(
    args.action,
    args.state,
    args.actingPlayerId,
    args.sourceInstanceId,
    args.getCardDefinitionById,
    args.stepCtx,
    undefined,
    args.sourceDefinition,
    args.sourcePreventionLevel,
    args.sourceTargetLockBypass,
    args.sourcePreventionBypass,
    undefined,
    undefined,
    undefined,
    undefined,
    args.effectSourceInstanceId,
    args.effectSourceDefinition,
    undefined,
    undefined,
    undefined,
    args.sourceCardReferenceInstanceId
  );
  if (args.allowEmptyTargets === false && !resolvedTargetIds?.length)
    return false;
  if (
    target.kind === "filter" &&
    target.count !== null &&
    typeof target.count === "object" &&
    "min" in target.count
  ) {
    const min =
      typeof target.count.min === "number"
        ? target.count.min
        : resolveCountBound(
            target.count.min,
            args.state,
            args.actingPlayerId,
            args.stepCtx,
            args.getCardDefinitionById
          );
    if (min <= 0) return true;
  }
  if (args.action.kind === "set_burst") {
    return (resolvedTargetIds ?? []).some(
      (sourceInstanceId) =>
        getBurstSetBlockReason({
          state: args.state,
          actingPlayerId: args.actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById: args.getCardDefinitionById,
          settingMode: "effect",
        }) === null
    );
  }
  if (args.allowPartialTargetCount && args.action.kind === "destroy") {
    return (
      args.allowEmptyTargets === true || (resolvedTargetIds?.length ?? 0) > 0
    );
  }
  if (resolvedTargetIds !== undefined && resolvedTargetIds.length === 0) {
    return false;
  }
  if (
    args.action.kind === "move_card" &&
    !canExecuteMoveCardAction({
      ...args,
      action: args.action,
      ...(resolvedTargetIds !== undefined ? { resolvedTargetIds } : {}),
    })
  ) {
    return false;
  }
  return !isConditionalCostTargetShortage(
    args.action,
    resolvedTargetIds,
    args.state,
    args.actingPlayerId,
    args.stepCtx,
    args.getCardDefinitionById
  );
}

function canExecuteExhaustStateChangeStep(
  args: Parameters<typeof canExecuteOptionalStep>[0]
): boolean | undefined {
  type ExhaustStateChangeAction = Extract<
    Action,
    { kind: "recover" | "exhaust" | "set_exhaust_state" }
  >;

  let targetState: "recovered" | "exhausted" | "heavily_exhausted";
  switch (args.action.kind) {
    case "recover":
      targetState = "recovered";
      break;
    case "exhaust":
      targetState =
        args.action.degree === "heavy_exhaust"
          ? "heavily_exhausted"
          : "exhausted";
      break;
    case "set_exhaust_state": {
      const resolvedState = resolveSetExhaustStateValue(args.action, {
        state: args.state,
        actingPlayerId: args.actingPlayerId,
        sourceInstanceId: args.sourceInstanceId,
        getCardDefinitionById: args.getCardDefinitionById,
        stepContext: args.stepCtx,
      });
      if (resolvedState === undefined) return false;
      targetState = resolvedState;
      break;
    }
    default:
      return undefined;
  }

  const target = getActionTargetSpec(args.action);
  const required =
    target?.kind === "filter"
      ? resolveRequiredOptionalActionCount({
          count: target.count,
          state: args.state,
          actingPlayerId: args.actingPlayerId,
          stepCtx: args.stepCtx,
          getCardDefinitionById: args.getCardDefinitionById,
        })
      : 1;
  if (required <= 0) return true;

  const targetResolvingAction: ExhaustStateChangeAction =
    target?.kind === "filter"
      ? ({
          ...args.action,
          target: { ...target, count: "all" },
        } as ExhaustStateChangeAction)
      : args.action;
  const candidateTargetIds = resolveTargets(
    targetResolvingAction,
    args.state,
    args.actingPlayerId,
    args.sourceInstanceId,
    args.getCardDefinitionById,
    args.stepCtx,
    undefined,
    args.sourceDefinition,
    args.sourcePreventionLevel,
    args.sourceTargetLockBypass,
    args.sourcePreventionBypass,
    undefined,
    undefined,
    undefined,
    undefined,
    args.effectSourceInstanceId,
    args.effectSourceDefinition,
    undefined,
    undefined,
    undefined,
    args.sourceCardReferenceInstanceId
  );
  // resolveTargets uses undefined for an empty unselected filter pool too.
  // A recovery/exhaustion needs an actual eligible card, including in cost previews.
  if (!candidateTargetIds || candidateTargetIds.length === 0) return false;

  const executableTargetCount = candidateTargetIds.filter((targetId) => {
    const card = args.state.cardInstances.find(
      (candidate) => candidate.instanceId === targetId
    );
    if (!card) return false;
    if (
      args.action.kind === "set_exhaust_state" &&
      args.action.placement &&
      card.exhaustState === targetState
    )
      return true;
    if (targetState === "recovered") {
      return (
        card.exhaustState !== "recovered" &&
        !isCardRecoveryRestricted(
          args.state,
          card,
          args.getCardDefinitionById,
          args.action.kind === "recover" ? "one_step" : "fully"
        )
      );
    }

    const canChangeToTargetState =
      targetState === "heavily_exhausted"
        ? card.exhaustState !== "heavily_exhausted"
        : card.exhaustState === "recovered" ||
          (args.action.kind === "set_exhaust_state" &&
            card.exhaustState === "heavily_exhausted");
    if (!canChangeToTargetState) return false;
    if (
      isCardExhaustionForbidden(
        card,
        args.getCardDefinitionById(card.definitionId)
      )
    ) {
      return false;
    }
    return (
      resolveCardExhaustAffect(
        args.state,
        card,
        args.actingPlayerId,
        args.getCardDefinitionById,
        args.sourcePreventionLevel,
        args.sourcePreventionBypass
      ).kind === "allowed"
    );
  }).length;
  return executableTargetCount >= required;
}

export function resolveStepTargetCounts(args: {
  target: Extract<TargetSpec, { kind: "filter" }>;
  state: GameState;
  actingPlayerId: string;
  stepCtx: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  candidateCount: number;
}): {
  requiredTargetCount: number;
  maxTargetCount: number;
  bpBudgetAmount?: number;
  costBudgetAmount?: number;
  symbolBudgetAmount?: number;
} | null {
  const { target } = args;
  if (target.count === "all") return null;
  const budgetAmount =
    target.budget !== undefined
      ? resolveAmountToNumber(
          target.budget.amount,
          args.state,
          args.actingPlayerId,
          args.stepCtx,
          args.getCardDefinitionById
        )
      : undefined;
  const bpBudgetAmount =
    target.budget?.metric === "bp" ? budgetAmount : undefined;
  const costBudgetAmount =
    target.budget?.metric === "cost" ? budgetAmount : undefined;
  const symbolBudgetAmount =
    target.budget?.metric === "symbol" ? budgetAmount : undefined;
  const { min: requiredTargetCount, max: maxTargetCount } =
    resolveTargetCountBounds({
      count: target.count,
      state: args.state,
      actingPlayerId: args.actingPlayerId,
      stepContext: args.stepCtx,
      getCardDefinitionById: args.getCardDefinitionById,
      candidateCount: args.candidateCount,
    });
  if (maxTargetCount <= 0) return null;
  return {
    requiredTargetCount,
    maxTargetCount,
    ...(bpBudgetAmount !== undefined ? { bpBudgetAmount } : {}),
    ...(costBudgetAmount !== undefined ? { costBudgetAmount } : {}),
    ...(symbolBudgetAmount !== undefined ? { symbolBudgetAmount } : {}),
  };
}

export function tryBuildStepTargetSelection(args: {
  state: GameState;
  effect: Effect;
  step: EffectStep;
  stepIndex: number;
  activeAction: Action;
  activeChooser?: import("../dsl-types").PlayerRef;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  sourceDefinition?: CardDefinition;
  effectIndex: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `grandwalkerData.divineSkills[
   * divineSkillIndex].effects[]` を指す（top-level `effects[]` ではない）。継続 resume 解決側
   * (`resolveContinuationEffect`) が参照する (ENGINE-divine-skill-nested-effect-continuation)。
   */
  divineSkillIndex?: number;
  /**
   * 指定時、`effectIndex` は `sourceDefinitionId` カードの `accelData.effects[]` を指す
   * (top-level `effects[]` ではない)。継続 resume 解決側 (`resolveContinuationEffect`) が参照する
   * (ENGINE-move-card-actual-count-amount、divineSkillIndex と同型パターン)。
   */
  isAccelData?: boolean;
  /** 指定時、`effectIndex` は `sourceDefinitionId` カードの `changeData.effects[]` を指す。 */
  isChangeData?: boolean;
  actingPlayerId: string;
  stepCtx: StepExecutionContext;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  targetIdsConsumed: boolean;
  targetInstanceIds?: readonly string[];
  targetStepId?: string;
  /**
   * 呼び出し元 (`resumeStepOptional`) が対象選択を確定済みと明示するフラグ。
   * `targetInstanceIds` が空配列 (0 体選択、`requiredTargetCount:0` の「好きなだけ」) でも
   * 再度候補を集計してpendingを立て直さないようにする
   * (ENGINE-cumulative-bp-budget-destroy: on_step 対象選択で 0 体選択が確定しないバグの修正)。
   */
  targetSelectionResolved?: boolean;
  choiceIndex?: number;
  effectActionKind?: EffectResolutionActionKind;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  sourceCardReferenceInstanceId?: string;
  costPaidThisEffect?: number;
  postResolutionOracle?: PostResolutionOracleTrigger;
  chainId?: string | null;
  battleEndDeferralAttackId?: string;
  recordedUsage?: import("../model").RecordedEffectUsage;
  eventAmount?: number;
  pendingEffectSimultaneousGroupId?: string;
  pendingEffectPendingId?: string;
  targetSelectionBypassesPreventionGate?: boolean;
  /** on_step 対象選択が反復途中なら、選択後にこの反復位置から再開する。 */
  repeatResume?: import("../model").EffectStepRepeatResume;
}): import("../model").PendingStepOptionalTargetSelection | null {
  const summonFromZoneTarget =
    args.activeAction.kind === "summon" &&
    args.activeAction.target.kind === "from_zone"
      ? args.activeAction.target
      : undefined;
  const actionTarget = getActionTargetSpec(args.activeAction);
  const relatedTarget =
    actionTarget?.kind === "trigger_related_instances" &&
    actionTarget.count !== undefined
      ? actionTarget
      : undefined;
  const target =
    summonFromZoneTarget !== undefined
      ? ({
          kind: "filter",
          player: "self",
          filter: summonFromZoneTarget.filter ?? {},
          count: summonFromZoneTarget.count,
          zone: summonFromZoneTarget.zone,
        } satisfies Extract<TargetSpec, { kind: "filter" }>)
      : relatedTarget !== undefined
        ? ({
            kind: "filter",
            player: "either",
            filter: {},
            count: relatedTarget.count!,
          } satisfies Extract<TargetSpec, { kind: "filter" }>)
        : actionTarget;
  if (!target || target.kind !== "filter" || target.count === "all") {
    return null;
  }
  const stepId = args.step.id ?? `__step_${args.stepIndex}`;
  if (
    args.targetInstanceIds !== undefined &&
    (args.targetInstanceIds.length > 0 ||
      args.targetSelectionResolved === true) &&
    (args.targetStepId === undefined || args.targetStepId === stepId)
  ) {
    return null;
  }

  const playerScope: LegalActionTargetPlayerScope =
    summonFromZoneTarget !== undefined
      ? "acting_player"
      : target.player === "self"
        ? "acting_player"
        : target.player === "opponent"
          ? "opponent"
          : "any";
  const candidateZones = target.zone
    ? Array.isArray(target.zone)
      ? target.zone
      : [target.zone]
    : (["field"] as readonly Zone[]);
  const actionKind = args.activeAction.kind;
  const targetCardFilterActionKind:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover"
    | undefined =
    actionKind === "destroy" ||
    actionKind === "vanish" ||
    actionKind === "bounce" ||
    actionKind === "prevent_battle" ||
    actionKind === "exhaust" ||
    actionKind === "recover"
      ? actionKind
      : undefined;
  const effectProfile = derivePreventionProfile(
    args.effect as {
      preventionLevel?: import("../model").EffectPreventionLevel;
      preventionRestriction?: unknown;
      targetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile;
    }
  );
  const effectPreventionLevel =
    args.sourcePreventionLevel ?? effectProfile?.resistance;
  const effectTargetLockBypass = mergeTargetLockBypassProfiles(
    effectProfile?.targetLockBypass,
    args.sourceTargetLockBypass
  );
  const targetCardFilter =
    summonFromZoneTarget !== undefined &&
    (summonFromZoneTarget.includeAdventSource ||
      summonFromZoneTarget.includeSoulState)
      ? {
          ...target.filter,
          ...(summonFromZoneTarget.includeAdventSource
            ? { adventSourceScope: "include" as const }
            : {}),
          ...(summonFromZoneTarget.includeSoulState
            ? { soulState: "include" as const }
            : {}),
        }
      : target.filter;
  const targetEffectAspect = deriveEffectAspectForImmunity(args.activeAction);
  const sourceAttachedChildrenOnly = targetRequiresSourceAttachedChildren(
    args.activeAction
  );
  const syntheticRegistration: RegisteredTargetedEffectActionBase = {
    ...(targetEffectAspect !== undefined ? { targetEffectAspect } : {}),
    candidateTargetZones: candidateZones,
    candidateTargetPlayerScope: playerScope,
    targetSelectionBypassesPreventionGate:
      args.targetSelectionBypassesPreventionGate ?? false,
    ...(targetCardFilter && Object.keys(targetCardFilter).length > 0
      ? { targetCardFilter }
      : {}),
    ...(target.excludeSelf ? { targetExcludeSelf: true } : {}),
    ...(target.sourceUnderCardRole !== undefined
      ? { sourceUnderCardRole: target.sourceUnderCardRole }
      : {}),
    ...(targetCardFilterActionKind !== undefined
      ? { targetCardFilterActionKind }
      : {}),
    ...(summonFromZoneTarget?.includeAdventSource
      ? { candidateIncludeAdventSource: true }
      : {}),
    ...(summonFromZoneTarget?.includeSoulState
      ? { candidateIncludeSoulState: true }
      : {}),
    ...(effectPreventionLevel !== undefined && effectPreventionLevel !== "none"
      ? { preventionLevel: effectPreventionLevel }
      : {}),
    ...(effectTargetLockBypass !== undefined &&
    effectTargetLockBypass.kind !== "none"
      ? { targetLockBypass: effectTargetLockBypass }
      : {}),
    ...(targetRequiresBraveCombineHostEligibility(args.activeAction)
      ? { braveCombineHostOnly: true }
      : {}),
    ...(sourceAttachedChildrenOnly
      ? {
          sourceAttachedChildrenOnly: true,
          starGarmentTargetEligibleOnly: true,
        }
      : {}),
  };
  // ENGINE-brave-combine-third-party-target: source 指定時は前段 step が選んだブレイヴを
  // host 適格性判定の基準にする（native-target-resolution.ts の resolveTargets と同じ SSOT）。
  const braveCombineIncomingBraveDefinition =
    targetRequiresBraveCombineHostEligibility(args.activeAction)
      ? resolveBraveCombineIncomingBraveDefinition(
          args.activeAction,
          args.state,
          args.stepCtx,
          args.getCardDefinitionById
        )
      : undefined;
  const braveCombineIncomingBraveInstanceId =
    targetRequiresBraveCombineHostEligibility(args.activeAction)
      ? (resolveBraveCombineIncomingBraveInstanceId(
          args.activeAction,
          args.stepCtx
        ) ?? args.sourceInstanceId)
      : undefined;
  let summonFromZoneCandidateCountBeforeAutoGate: number | undefined;
  let summonFromZoneExecutableCandidateCount: number | undefined;
  let summonFromZoneExecutableCandidates: CardInstance[] | undefined;
  let summonFromZoneNativeAction: SummonAction | undefined;
  const rawCandidateInstanceIds =
    relatedTarget !== undefined
      ? resolveTargetSpec({
          state: args.state,
          targetSpec: relatedTarget,
          actingPlayerId: args.actingPlayerId,
          sourceInstanceId: args.sourceInstanceId,
          stepContext: args.stepCtx,
          getCardDefinitionById: args.getCardDefinitionById,
          returnFullPool: true,
        }).map((card) => card.instanceId)
      : summonFromZoneTarget !== undefined &&
          args.activeAction.kind === "summon"
        ? (() => {
            // native-action-registry.ts の summon handler と同じ分類。from_zone の
            // on_step 候補判定も実行時と同じ追加コスト CE を見る。
            const summonCause: "effect" | "burst" =
              args.effectActionKind === "burst_activation" ? "burst" : "effect";
            const nativeAction: SummonAction = {
              ...(args.activeAction.fieldCoreSourceMinimum !== undefined
                ? {
                    fieldCoreSourceMinimum:
                      args.activeAction.fieldCoreSourceMinimum,
                  }
                : {}),
              kind: "summon",
              target: "other",
              zone: normalizeSummonFromZoneZone(summonFromZoneTarget.zone),
              count: 1,
              summonCause,
              ...(summonFromZoneTarget.filter
                ? { filter: summonFromZoneTarget.filter }
                : {}),
              ...buildSummonActionCostModifier(args.activeAction.costModifier),
              ...(args.activeAction.onBoardCoreSourceFilter !== undefined
                ? {
                    onBoardCoreSourceFilter:
                      args.activeAction.onBoardCoreSourceFilter,
                  }
                : {}),
              ...(args.activeAction.trashCoreMax !== undefined
                ? { trashCoreMax: args.activeAction.trashCoreMax }
                : {}),
              ...(args.activeAction.trashCoreKind !== undefined
                ? { trashCoreKind: args.activeAction.trashCoreKind }
                : {}),
              ...(args.activeAction.ignoreSummonCondition
                ? { ignoreSummonCondition: true }
                : {}),
              ...(summonFromZoneTarget.includeAdventSource
                ? { includeAdventSource: true }
                : {}),
              ...(summonFromZoneTarget.includeSoulState
                ? { includeSoulState: true }
                : {}),
            };
            summonFromZoneNativeAction = nativeAction;
            const candidates = resolveSummonFromZoneCandidates(
              args.state,
              args.actingPlayerId,
              {
                zone: summonFromZoneTarget.zone,
                ...(summonFromZoneTarget.filter
                  ? { filter: summonFromZoneTarget.filter }
                  : {}),
                ...(summonFromZoneTarget.includeAdventSource
                  ? { includeAdventSource: true }
                  : {}),
                ...(summonFromZoneTarget.includeSoulState
                  ? { includeSoulState: true }
                  : {}),
                ...(args.activeAction.costModifier === "full_reduction"
                  ? { fullReduction: true }
                  : {}),
                ...(summonFromZoneTarget.restrictToTriggerLeaveAdventSource
                  ? {
                      restrictToInstanceIds:
                        args.stepCtx.triggerAdventSourceInstanceIds ?? [],
                    }
                  : {}),
              },
              args.getCardDefinitionById
            );
            summonFromZoneCandidateCountBeforeAutoGate = candidates.length;
            const executableCandidates = candidates.filter((candidate) =>
              canAutoExecuteSummonFromZoneCandidate({
                state: args.state,
                actingPlayerId: args.actingPlayerId,
                action: nativeAction,
                candidate,
                getCardDefinitionById: args.getCardDefinitionById,
              })
            );
            summonFromZoneExecutableCandidates = executableCandidates;
            summonFromZoneExecutableCandidateCount =
              executableCandidates.length;
            return executableCandidates.map(
              (candidate) => candidate.instanceId
            );
          })()
        : getCandidateTargetInstanceIds(
            args.state,
            args.actingPlayerId,
            syntheticRegistration,
            {
              getCardDefinitionById: args.getCardDefinitionById,
              sourceInstanceId: args.sourceInstanceId,
              affectSourceIdentity: resolveAffectSourceIdentity({
                state: args.state,
                sourceInstanceId: args.sourceInstanceId,
                sourceDefinition: args.sourceDefinition,
                effectSourceInstanceId: args.effectSourceInstanceId,
                effectSourceDefinitionId: args.effectSourceDefinitionId,
                getCardDefinitionById: args.getCardDefinitionById,
              }),
              ...(args.sourceDefinition
                ? { sourceDefinition: args.sourceDefinition }
                : {}),
              ...(braveCombineIncomingBraveDefinition
                ? { braveCombineIncomingBraveDefinition }
                : {}),
              ...(braveCombineIncomingBraveInstanceId
                ? { braveCombineIncomingBraveInstanceId }
                : {}),
              ...(args.sourcePreventionBypass !== undefined
                ? { sourcePreventionBypass: args.sourcePreventionBypass }
                : {}),
              evaluateCondition: (
                condition,
                sourceInstanceId,
                actingPlayerId
              ) =>
                evaluateCondition(
                  args.state,
                  condition,
                  sourceInstanceId,
                  actingPlayerId,
                  args.getCardDefinitionById
                ),
              evaluateApplicability: (applicability, sourceInstanceId) =>
                evaluateApplicability(
                  args.state,
                  applicability,
                  sourceInstanceId,
                  args.getCardDefinitionById
                ),
            }
          );
  // 新規 filter 対象は離脱待機中を除く。イベント主語からの選択は
  // resolveTargetSpec で includePendingLeave を評価済み。
  const sourceStepCandidateIds = target.stepId
    ? new Set(
        getStepResult(args.stepCtx, target.stepId)?.affectedCardInstanceIds ??
          []
      )
    : null;
  const excludedStepCandidateIds = target.excludeStepId
    ? new Set(
        getStepResult(args.stepCtx, target.excludeStepId)
          ?.affectedCardInstanceIds ?? []
      )
    : null;
  const candidateInstanceIds = rawCandidateInstanceIds.filter((instanceId) => {
    const card = args.state.cardInstances.find(
      (candidate) => candidate.instanceId === instanceId
    );
    if (
      sourceStepCandidateIds !== null &&
      !sourceStepCandidateIds.has(instanceId)
    ) {
      return false;
    }
    if (excludedStepCandidateIds?.has(instanceId)) return false;
    return relatedTarget !== undefined || card?.pendingLeaveKind === null;
  });
  const staticTargetMaxCountHint =
    typeof target.count === "number"
      ? target.count
      : typeof target.count === "object" &&
          target.count !== null &&
          "min" in target.count &&
          typeof target.count.max === "number"
        ? target.count.max
        : undefined;
  const candidateCountForTargetBounds =
    summonFromZoneExecutableCandidates && summonFromZoneNativeAction
      ? getMaxAutoExecutableSummonFromZoneSelectionCount({
          state: args.state,
          actingPlayerId: args.actingPlayerId,
          action: summonFromZoneNativeAction,
          candidates: summonFromZoneExecutableCandidates.filter((candidate) =>
            candidateInstanceIds.includes(candidate.instanceId)
          ),
          getCardDefinitionById: args.getCardDefinitionById,
          ...(staticTargetMaxCountHint !== undefined
            ? { maxCountHint: staticTargetMaxCountHint }
            : {}),
        })
      : candidateInstanceIds.length;
  const counts = resolveStepTargetCounts({
    target,
    state: args.state,
    actingPlayerId: args.actingPlayerId,
    stepCtx: args.stepCtx,
    getCardDefinitionById: args.getCardDefinitionById,
    candidateCount: candidateCountForTargetBounds,
  });
  if (!counts) return null;
  const requiresExplicitTargetInjection =
    (summonFromZoneTarget !== undefined &&
      args.activeAction.kind === "summon" &&
      summonFromZoneCandidateCountBeforeAutoGate !==
        summonFromZoneExecutableCandidateCount) ||
    // 公開中のカードは候補が1枚でも、確認してから選択を確定する。
    // 0候補は従来どおり不発として進め、count:"all" は上流で処理する。
    (candidateInstanceIds.length > 0 &&
      candidateInstanceIds.every(
        (id) =>
          args.state.cardInstances.find((card) => card.instanceId === id)
            ?.zone === "revealed"
      ));
  if (
    !requiresExplicitTargetInjection &&
    counts.requiredTargetCount === counts.maxTargetCount &&
    candidateInstanceIds.length === counts.requiredTargetCount
  ) {
    return null;
  }

  let choosingPlayerId = args.actingPlayerId;
  if (args.activeChooser === "opponent") {
    const opponentId = args.state.playerOrder.find(
      (id) => id !== args.actingPlayerId
    );
    if (opponentId) choosingPlayerId = opponentId;
  }
  const continuation: import("../model").StepOptionalContinuation = {
    sourceDefinitionId: args.sourceDefinitionId,
    effectIndex: args.effectIndex,
    ...(args.divineSkillIndex !== undefined
      ? { divineSkillIndex: args.divineSkillIndex }
      : {}),
    ...(args.isAccelData !== undefined
      ? { isAccelData: args.isAccelData }
      : {}),
    ...(args.isChangeData !== undefined
      ? { isChangeData: args.isChangeData }
      : {}),
    sourceInstanceId: args.sourceInstanceId,
    actingPlayerId: args.actingPlayerId,
    stepIndex: args.stepIndex,
    stepContext: serializeStepContext(args.stepCtx),
    ...(args.choiceIndex !== undefined
      ? { choiceIndex: args.choiceIndex }
      : {}),
    ...(args.effectActionKind !== undefined
      ? { effectActionKind: args.effectActionKind }
      : {}),
    ...(effectPreventionLevel !== undefined
      ? { sourcePreventionLevel: effectPreventionLevel }
      : {}),
    ...(args.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: args.effectSourceInstanceId }
      : {}),
    ...(args.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: args.effectSourceDefinitionId }
      : {}),
    ...(args.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: args.sourceCardReferenceInstanceId }
      : {}),
    ...(args.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: args.costPaidThisEffect }
      : {}),
    ...(args.postResolutionOracle !== undefined
      ? { postResolutionOracle: args.postResolutionOracle }
      : {}),
    chainId: requireTriggerChainId(args.chainId),
    ...(args.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: args.battleEndDeferralAttackId }
      : {}),
    ...(!args.targetIdsConsumed && args.targetInstanceIds !== undefined
      ? { targetInstanceIds: args.targetInstanceIds }
      : {}),
    ...(!args.targetIdsConsumed && args.targetStepId !== undefined
      ? { targetStepId: args.targetStepId }
      : {}),
    ...(args.repeatResume !== undefined
      ? { repeatResume: args.repeatResume }
      : {}),
    ...(args.recordedUsage !== undefined
      ? { recordedUsage: args.recordedUsage }
      : {}),
    ...(args.eventAmount !== undefined
      ? { eventAmount: args.eventAmount }
      : {}),
    ...(args.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            args.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(args.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: args.pendingEffectPendingId }
      : {}),
  };
  return {
    pendingId: `pst:${args.sourceInstanceId}:${args.effectIndex}:${args.stepIndex}`,
    actingPlayerId: args.actingPlayerId,
    choosingPlayerId,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: args.sourceDefinitionId,
    effectIndex: args.effectIndex,
    stepIndex: args.stepIndex,
    stepLabel: stepId,
    requiredTargetCount: counts.requiredTargetCount,
    maxTargetCount: counts.maxTargetCount,
    ...(counts.bpBudgetAmount !== undefined
      ? { bpBudgetAmount: counts.bpBudgetAmount }
      : {}),
    ...(counts.costBudgetAmount !== undefined
      ? { costBudgetAmount: counts.costBudgetAmount }
      : {}),
    ...(counts.symbolBudgetAmount !== undefined
      ? { symbolBudgetAmount: counts.symbolBudgetAmount }
      : {}),
    candidateInstanceIds: [...candidateInstanceIds],
    targetStepId: stepId,
    continuation,
  };
}

/**
 * P3-30: Effect 内の `pay_cost` step の合計支払い額を返す。
 * choice ステップの場合は choiceIndex に対応する分岐の cost を返す。
 * pay_cost step が無ければ 0 を返す。
 *
 * GUI が「効果起動時にコスト支払いソース選択モーダルが必要かどうか」を判定する用途。
 */
export function getEffectPayCostAmount(
  effect: Effect,
  choiceIndex?: number
): number {
  let total = 0;
  for (const step of effect.steps) {
    // choice ステップ: choiceIndex に応じて分岐 action を選ぶ
    if (step.choice && step.choice.length > 0 && choiceIndex !== undefined) {
      if (choiceIndex === 0) {
        if (step.action.kind === "pay_cost") total += step.action.amount;
      } else {
        const c = step.choice[choiceIndex - 1];
        if (c?.action.kind === "pay_cost") total += c.action.amount;
      }
      continue;
    }
    if (step.action.kind === "pay_cost") {
      total += step.action.amount;
    }
  }
  return total;
}

export function cloneStateForTriggerDelta(state: GameState): GameState {
  return { ...state, log: [...state.log] };
}
