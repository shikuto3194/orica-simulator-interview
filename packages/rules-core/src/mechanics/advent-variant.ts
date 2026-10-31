import type { CardDefinition, GameState } from "../model";
import { getCEsForTarget } from "../card/ce-lookup";

/** 「【契約煌臨】を持っているものとして扱う」の有効な付与。 */
export function hasContractAdventEligibilityGrant(
  state: Pick<GameState, "activeContinuousEffects">,
  targetInstanceId: string
): boolean {
  return getCEsForTarget(state, targetInstanceId).some((ce) => {
    if (ce.modifierTag !== "override_properties") return false;
    const props = ce.metadata?.properties as
      | { grantsContractAdventEligibility?: boolean }
      | undefined;
    return props?.grantsContractAdventEligibility === true;
  });
}

/** 印字の煌臨種別と「持つものとして扱う」を合わせた共通判定。 */
export function hasEffectiveAdventVariant(
  state: Pick<GameState, "activeContinuousEffects">,
  instanceId: string,
  definition: CardDefinition | undefined,
  variants: readonly ("normal" | "contract" | "f_contract")[]
): boolean {
  return (
    (definition?.adventData !== undefined &&
      variants.includes(definition.adventData.adventVariant ?? "normal")) ||
    (variants.includes("contract") &&
      hasContractAdventEligibilityGrant(state, instanceId))
  );
}
