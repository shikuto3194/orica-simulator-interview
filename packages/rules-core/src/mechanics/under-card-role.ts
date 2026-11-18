import { getCardById } from "../card/card-lookup";
import { getCEsForTarget, getGlobalCEs } from "../card/ce-lookup";
import { matchesGlobalCETargetFilter } from "../legal/legal-actions-shared";
import {
  underCardRoleTagsEqual,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "../model";

/** 物理配置を変更せず、有効な役割と仮想的な存在をまとめて数える。 */
export function countEffectiveUnderCardRole(
  state: GameState,
  host: CardInstance,
  roleTag: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): number {
  const grants = [
    ...getCEsForTarget(state, host.instanceId),
    ...getGlobalCEs(state),
  ].filter(
    (ce) =>
      ce.modifierTag === "under_card_role" &&
      underCardRoleTagsEqual(
        ce.metadata?.roleTag as string | undefined,
        roleTag
      ) &&
      (ce.targetInstanceId === host.instanceId ||
        (getCardDefinitionById &&
          matchesGlobalCETargetFilter(state, ce, host, getCardDefinitionById)))
  );
  const faceDownIsRole = grants.some(
    (ce) => ce.metadata?.faceDownCards === true
  );
  const physical = host.underCards.filter((entry) => {
    const child = getCardById(state, entry.cardInstanceId);
    if (child?.faceDown) return faceDownIsRole;
    return (
      entry.role === "text_role" &&
      underCardRoleTagsEqual(entry.roleTag, roleTag)
    );
  }).length;
  const virtual = grants.reduce(
    (count, ce) => Math.max(count, Number(ce.metadata?.virtualCount ?? 0)),
    0
  );
  return Math.max(physical, virtual);
}
