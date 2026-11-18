import { getGrandstoneMechanicEligibility } from "../mechanics/grandstone-system";
import { matchesTriggerSourceRole } from "./trigger-observation-sources";
import { getCardById } from "../card/card-lookup";
import { isGrantedExhaustTriggerEligible } from "./exhaust-trigger-eligibility";
import {
  canObserveGrantedEffectUnderSuppression,
  isGrantedTriggeredConditionMet,
  isGrantedTriggeredUsageAvailable,
  isGrantedTriggeredUsageLimitAvailable,
} from "../mechanics/grant-effect-system";
import { canActivateNexusMechanicEffect } from "../mechanics/nexus-mechanic-suppression";
import {
  getMagicStackDomainEligibility,
  getOracleMechanicEligibility,
} from "../mechanics/oracle-system";
import { canTriggerFromPendingLeaveSource } from "../zone/pending-leave-trigger-event-kind";
import { collectUnderCardScopeIds } from "../model";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingTriggeredEffect,
} from "../model";

/** 同じ instanceId の再入場や面の変更を、元の機構の待機へ引き継がない。 */
export function hasMatchingTriggeredMechanicSourceIdentity(
  source: CardInstance | undefined,
  mechanic: NonNullable<PendingTriggeredEffect["mechanic"]>,
  state: GameState
): boolean {
  if (!source) return false;
  const identity = mechanic.sourceIdentity;
  // 旧保存の pending に観測時の面・世代を後付けして過去の記録とは扱わない。
  if (identity === undefined) return true;
  return (
    identity !== null &&
    source.instanceId === identity.instanceId &&
    source.definitionId === identity.definitionId &&
    (source.fieldInstanceGeneration ?? 0) ===
      identity.fieldInstanceGeneration &&
    matchesTriggerSourceRole(state, source, identity.sourceRole)
  );
}

/** 神託・解封・付与効果の宣言資格。順序待ちや発揮後の不発は判定しない。 */
export function getTriggeredMechanicActivationState(
  state: GameState,
  mechanic: NonNullable<PendingTriggeredEffect["mechanic"]>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
) {
  const sourceInstanceId =
    mechanic.kind === "oracle" ||
    mechanic.kind === "placement_oracle" ||
    mechanic.kind === "magic_stack_domain"
      ? mechanic.grandwalkerInstanceId
      : mechanic.kind === "granted_effect"
        ? mechanic.granteeInstanceId
        : mechanic.grandstoneInstanceId;
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const grant =
    mechanic.kind === "granted_effect"
      ? state.activeContinuousEffects.find(
          (ce) => ce.effectId === mechanic.grantCeEffectId
        )
      : undefined;
  const oracleEligibility =
    sourceCard &&
    sourceDefinition &&
    (mechanic.kind === "oracle" || mechanic.kind === "placement_oracle")
      ? getOracleMechanicEligibility(
          state,
          sourceCard,
          sourceDefinition,
          mechanic,
          getCardDefinitionById
        )
      : undefined;
  const grandstoneEligibility =
    sourceCard &&
    sourceDefinition &&
    (mechanic.kind === "unseal" || mechanic.kind === "stone_rebirth")
      ? getGrandstoneMechanicEligibility(
          state,
          sourceCard,
          sourceDefinition,
          mechanic.kind,
          getCardDefinitionById
        )
      : undefined;
  const domainEligibility =
    sourceCard && sourceDefinition && mechanic.kind === "magic_stack_domain"
      ? getMagicStackDomainEligibility(
          state,
          sourceCard,
          sourceDefinition,
          getCardDefinitionById
        )
      : undefined;
  const explicitConditionMet =
    mechanic.kind === "granted_effect"
      ? !!grant &&
        !!sourceCard &&
        isGrantedTriggeredConditionMet(
          state,
          grant,
          sourceCard,
          getCardDefinitionById,
          mechanic
        )
      : (oracleEligibility ?? grandstoneEligibility ?? domainEligibility)
          ?.explicitConditionMet === true;
  const subjectIsUnderCard = (() => {
    if (mechanic.kind !== "oracle" || mechanic.triggerKind !== "summon")
      return false;
    const { textRole, adventSource } = collectUnderCardScopeIds(state);
    return (
      textRole.has(mechanic.triggerCardInstanceId) ||
      adventSource.has(mechanic.triggerCardInstanceId)
    );
  })();
  const canObserve =
    !!sourceCard &&
    !!sourceDefinition &&
    !subjectIsUnderCard &&
    oracleEligibility?.usageAvailable !== false &&
    (mechanic.kind === "granted_effect" ||
      canActivateNexusMechanicEffect(
        state,
        sourceCard.instanceId,
        mechanic.kind,
        getCardDefinitionById
      )) &&
    (grant?.metadata?.turnReservation === true ||
      hasMatchingTriggeredMechanicSourceIdentity(
        sourceCard,
        mechanic,
        state
      )) &&
    (sourceCard.zone === "field" ||
      grant?.metadata?.turnReservation === true) &&
    (mechanic.kind !== "granted_effect" ||
      (!!grant &&
        isGrantedTriggeredUsageLimitAvailable(
          state,
          grant,
          sourceCard,
          getCardDefinitionById
        ) &&
        canObserveGrantedEffectUnderSuppression(
          state,
          grant,
          sourceCard,
          getCardDefinitionById
        ) &&
        isGrantedExhaustTriggerEligible(
          state,
          mechanic,
          getCardDefinitionById
        ))) &&
    (grant?.metadata?.turnReservation === true ||
      (mechanic.kind === "granted_effect" &&
        mechanic.triggerEventKind === undefined) ||
      canTriggerFromPendingLeaveSource(state, sourceCard, {
        eventKind:
          mechanic.kind === "granted_effect"
            ? mechanic.triggerEventKind!
            : mechanic.kind,
        relatedInstanceId:
          mechanic.kind === "granted_effect"
            ? (mechanic.triggerRelatedInstanceId ?? null)
            : null,
      }));
  const canActivate =
    canObserve &&
    !!sourceCard &&
    (mechanic.kind === "granted_effect"
      ? !!grant &&
        explicitConditionMet &&
        isGrantedTriggeredUsageAvailable(
          state,
          grant,
          sourceCard,
          getCardDefinitionById
        )
      : (oracleEligibility ?? grandstoneEligibility ?? domainEligibility)
          ?.canActivate === true);
  return {
    sourceCard,
    sourceDefinition,
    grant,
    canObserve,
    canActivate,
    explicitConditionMet,
  };
}

/** 明示条件の後成立だけを派生優先へ渡す。資源の後充足や旧保存から原因を推定しない。 */
export function isTriggeredMechanicExplicitConditionNewlyEnabled(
  beforeState: GameState,
  afterState: GameState,
  beforePending: PendingTriggeredEffect,
  afterPending: PendingTriggeredEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (
    beforePending.dormantMechanicCondition !== true ||
    !beforePending.mechanic ||
    !afterPending.mechanic
  )
    return false;
  const before = getTriggeredMechanicActivationState(
    beforeState,
    beforePending.mechanic,
    getCardDefinitionById
  );
  const after = getTriggeredMechanicActivationState(
    afterState,
    afterPending.mechanic,
    getCardDefinitionById
  );
  return (
    before.canObserve &&
    after.canObserve &&
    !before.explicitConditionMet &&
    after.explicitConditionMet
  );
}
