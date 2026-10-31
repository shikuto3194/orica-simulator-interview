import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../model";
import type { TriggeredEffectSourceChoice } from "./trigger-system";
import {
  canUseEffectByUsageLimit,
  getStableEffectLabel,
} from "../legal/legal-actions-shared";

interface SourceUsageOptions {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  choice: TriggeredEffectSourceChoice;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}

export function hasNoDuplicateUsageLimit(
  limits: TriggeredEffectSourceChoice["actionRegistration"]["usageLimit"]
): boolean {
  return (Array.isArray(limits) ? limits : [limits]).some(
    (limit) => limit?.kind === "no_duplicate"
  );
}

/** キュー表示・順序選択・再キューで同じ使用制限を評価する。 */
export function isTriggeredSourceUsageAvailable(
  options: SourceUsageOptions
): boolean {
  const {
    state,
    pendingEffect: pending,
    choice,
    getCardDefinitionById,
  } = options;
  const registration = choice.actionRegistration;
  return (
    !registration.usageLimit ||
    pending.usageLimitConsumedOnPrivateDeclaration === true ||
    canUseEffectByUsageLimit({
      state,
      sourceInstanceId:
        choice.sourceEffectInstanceId ?? choice.sourceCard.instanceId,
      sourceDefinitionId:
        choice.sourceEffectDefinitionId ?? choice.sourceEffectDefinition.cardNo,
      sourceEffect:
        choice.sourceEffectDefinition.effects?.[registration.effectIndex ?? -1],
      getCardDefinitionById,
      effectLabel: getStableEffectLabel(
        registration.sourceKind,
        choice.registrationIndex,
        registration
      ),
      usageLimit: registration.usageLimit,
      ...(registration.limitGroupId
        ? { groupId: registration.limitGroupId }
        : {}),
      ...(pending.relatedInstanceId
        ? { relatedInstanceId: pending.relatedInstanceId }
        : {}),
      triggerEventScopeKey: pending.pendingId,
      ...(pending.chainId ? { triggerActivationKey: pending.chainId } : {}),
    })
  );
}

/** 重複する別個体を残して発揮元を選び直せる。最後の必須効果は辞退できない。 */
export function canSkipDuplicateTriggeredSource(
  options: SourceUsageOptions & {
    choices: readonly TriggeredEffectSourceChoice[];
  }
): boolean {
  const { choice } = options;
  const registration = choice.actionRegistration;
  if (!hasNoDuplicateUsageLimit(registration.usageLimit)) return false;
  const label = getStableEffectLabel(
    registration.sourceKind,
    choice.registrationIndex,
    registration
  );
  return options.choices.some(
    (peer) =>
      (peer.sourceEffectInstanceId ?? peer.sourceCard.instanceId) !==
        (choice.sourceEffectInstanceId ?? choice.sourceCard.instanceId) &&
      peer.sourceCard.controllerPlayerId ===
        choice.sourceCard.controllerPlayerId &&
      (peer.sourceEffectDefinitionId ?? peer.sourceEffectDefinition.cardNo) ===
        (choice.sourceEffectDefinitionId ??
          choice.sourceEffectDefinition.cardNo) &&
      getStableEffectLabel(
        peer.actionRegistration.sourceKind,
        peer.registrationIndex,
        peer.actionRegistration
      ) === label &&
      isTriggeredSourceUsageAvailable({ ...options, choice: peer })
  );
}
