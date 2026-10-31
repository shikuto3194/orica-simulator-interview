import { getCardById } from "../card/card-lookup";
import { isGrantedTriggeredUsageAvailable } from "../mechanics/grant-effect-system";
import { canActivateNexusMechanicEffect } from "../mechanics/nexus-mechanic-suppression";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../model";

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
  const canActivate =
    !!sourceCard &&
    !!sourceDefinition &&
    (sourceCard.zone === "field" ||
      grant?.metadata?.turnReservation === true) &&
    (mechanic.kind === "granted_effect"
      ? !!grant &&
        isGrantedTriggeredUsageAvailable(
          state,
          grant,
          sourceCard,
          getCardDefinitionById
        )
      : canActivateNexusMechanicEffect(
          state,
          sourceInstanceId,
          mechanic.kind,
          getCardDefinitionById
        ));
  return { sourceCard, sourceDefinition, grant, canActivate };
}
