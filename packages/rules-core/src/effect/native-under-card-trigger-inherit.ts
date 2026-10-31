// ENGINE-tx01b-attack-trigger-inherit: host (target, 通常 self) の childRoleTag 一致
// text_role アンダーカードそれぞれの effects[] から sourceEvents 一致の
// card_event 効果を見つけ、host 自身を source として実行する。
//
// card_event はカード自身のイベントにのみ反応する設計 (10_rules) のため、一致した効果は
// 常に借用元カードの「このカードの{event}時」効果であり、ラベル判別は不要
// (effect-borrowing.ts の borrow_card_event_effect と異なり選択式ではなく自動継承)。
//
// 借用元自身の condition/applicability は effect-borrowing.ts の
// listBorrowableCardEventEffectCandidates → executeSelectedBorrowedCardEventEffect と
// 同じ二段階パターンを踏襲する: (1) 借用元インスタンス (underCard、host に付着した
// 状態のまま — under-card は host 離脱までフィールドに残るため zone/level/自身の
// underCards は well-defined) を基準に evaluateCondition/evaluateApplicability で
// ゲート判定する (adversarial verifier round3 refute対応: 無条件 strip は
// needs-ruling.jsonl:BSAZ02-TX01(B) の裁定射程 [triggerEventスコープ拡張のみ] を超えて
// 借用元自身の発揮条件まで無視していた)。(2) ゲート通過後、実行対象の effect からのみ
// condition/applicability を strip して host を source に発揮する (二重評価回避、
// 借用元条件は既にゲートで判定済み)。

import { getCardById } from "../card/card-lookup";
import type { CardDefinition, GameState } from "../model";
import { textRoleUnderCardIdsOf } from "../model";
import type { DSL, Effect, EffectStep } from "../dsl-types";
import { evaluateCondition } from "./structured-condition-eval";
import { evaluateApplicability } from "./effect-applicability";
import type { ExecuteEffectOptions } from "./effect-interpreter";
import type {
  TriggeredEffectActionRegistrationLookup,
  BurstActionRegistrationLookup,
} from "./trigger-system";

/**
 * steps (choice 分岐を含め再帰的に) のいずれかが executionMode/usageLimit/retrigger を
 * 持つか判定する。この継承は無条件・単発実行のみをサポートし、任意選択/使用回数制限/
 * 条件付き再発火を再現する配線を持たないため、それらを黙って無視して誤発揮させるより
 * donor 効果ごと除外する方が安全 (adversarial verifier round2 refute: effect レベルの
 * executionMode/usageLimit だけを見ており、EffectStep レベル (BSAZ02-X02 effects[1]
 * steps[1] の `core_move` に executionMode:"optional") が漏れていた)。
 * `structured-effect-registrations.ts` の `collectActionKinds` と同じ choice 再帰パターン。
 */
function hasUnsupportedStepModifiers(steps: readonly EffectStep[]): boolean {
  return steps.some((step) => {
    if (step.executionMode !== undefined) return true;
    if (step.usageLimit !== undefined) return true;
    if (step.retrigger !== undefined) return true;
    if (step.choice && hasUnsupportedStepModifiers(step.choice)) return true;
    return false;
  });
}

/**
 * 借用対象の絞り込み。「このカードのアタック時」効果だけを継承する意図
 * (例: BSAZ02-R01 effects[2] `event:"attack"`) であり、「召喚/アタック/ブロック時」
 * のような多イベント効果 (例: R01 effects[0] `event:["summon","attack","block"]`) は
 * "attack" を含んでいても対象外にする必要がある — 部分一致 (`.some`) だと後者も
 * 誤って拾ってしまい、host のアタックのたびに召喚時トリガーまで無条件発揮される
 * (adversarial verifier round1 refute)。donor の宣言イベント集合が sourceEvents の
 * 部分集合であることを要求する (`.every`)。
 */
function isInheritableCardEventEffect(
  effect: Effect,
  sourceEvents: readonly string[]
): boolean {
  if (effect.stub !== undefined || effect.steps.length === 0) return false;
  if (effect.timing.kind !== "card_event") return false;
  if (effect.executionMode !== undefined) return false;
  if (effect.usageLimit !== undefined) return false;
  if (hasUnsupportedStepModifiers(effect.steps)) return false;
  const declaredEvents = Array.isArray(effect.timing.event)
    ? effect.timing.event
    : [effect.timing.event];
  if (declaredEvents.length === 0) return false;
  return declaredEvents.every((ev) => sourceEvents.includes(ev));
}

export function executeUnderCardTriggerInherit(
  state: GameState,
  chainId: string,
  actingPlayerId: string,
  action: DSL.UnderCardTriggerInheritAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds: string[] | undefined,
  sourceInstanceId: string,
  executeEffectFn: (options: ExecuteEffectOptions) => GameState,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  const hostId = resolvedTargetIds?.[0] ?? sourceInstanceId;
  const hostCard = getCardById(state, hostId);
  if (!hostCard) return state;

  let result = state;
  for (const underId of textRoleUnderCardIdsOf(hostCard, action.childRoleTag)) {
    const underCard = getCardById(result, underId);
    if (!underCard) continue;
    if (underCard.attachedToInstanceId !== hostId) continue;
    if (underCard.zone !== "field" || underCard.faceDown) continue;
    const underDefinition = getCardDefinitionById(underCard.definitionId);
    if (!underDefinition) continue;

    for (const donorEffect of underDefinition.effects ?? []) {
      if (!isInheritableCardEventEffect(donorEffect, action.sourceEvents)) {
        continue;
      }
      if (
        donorEffect.condition &&
        donorEffect.condition.length > 0 &&
        !evaluateCondition(
          result,
          donorEffect.condition,
          underCard.instanceId,
          underCard.controllerPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }
      // 借用元 applicability の level は評価対象から除外する。text_role アンダーカードは
      // attach 時に normalCoreCount が強制的に0になる (native-move-core-handlers.ts) ため、
      // 借用元カード自身のレベルは常に levelDefs 最低値未満に固定され、level ゲート付き
      // donor 効果 (例: BSAZ02-R01 の Lv3-Lv4 効果群) が永久に不成立になってしまう
      // (adversarial verifier 2026-07-18 round1 refute)。round3 で「無条件 strip は
      // 裁定射程を超える」と判断された経緯があるため、level 以外の applicability
      // (zone/form/combined 等、アタッチ状態でも意味を持つ) は引き続き評価する。
      if (donorEffect.applicability) {
        const { level: _donorLevel, ...applicabilityWithoutLevel } =
          donorEffect.applicability;
        if (
          Object.keys(applicabilityWithoutLevel).length > 0 &&
          !evaluateApplicability(
            result,
            applicabilityWithoutLevel,
            underCard.instanceId,
            getCardDefinitionById
          )
        ) {
          continue;
        }
      }
      const {
        condition: _donorCondition,
        applicability: _donorApplicability,
        ...executableEffect
      } = donorEffect;
      result = executeEffectFn({
        state: result,
        chainId,
        effect: executableEffect,
        ...(getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions }
          : {}),
        sourceInstanceId: hostId,
        actingPlayerId,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        rangeAutoResolveStrategy: "max",
        stepTargetSelectionBypassesPreventionGate: false,
      });
      result = {
        ...result,
        log: [
          ...result.log,
          `under_card_trigger_inherit:executed:${hostId}:${underDefinition.cardNo}`,
        ],
      };
    }
  }
  return result;
}
