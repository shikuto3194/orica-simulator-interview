import { getCEsForTarget } from "../card/ce-lookup";
import { matchesCardFilter } from "../card/card-filter";
import type { CardFilter } from "../dsl-types";
import {
  collectUnderCardScopeIds,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "../model";
import { resolveCardImmunityAffect } from "./effect-affect-adapter";

/** 回復禁止の対象条件と耐性。リフレッシュと効果による回復が同じ判定を使う。 */
export function isCardRecoveryRestricted(
  state: GameState,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  recoveryMode: "one_step" | "fully" = "one_step"
): boolean {
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return false;
  return [
    ...getCEsForTarget(state, card.controllerPlayerId),
    ...getCEsForTarget(state, card.instanceId),
  ].some((ce) => {
    if (ce.modifierTag !== "prevent_recovery") return false;
    const metadata = ce.metadata as
      | { filter?: CardFilter; restriction?: "recover" | "become_recovered" }
      | undefined;
    if (metadata?.restriction === "become_recovered") {
      if (
        recoveryMode === "one_step" &&
        card.exhaustState === "heavily_exhausted"
      )
        return false;
    } else if (recoveryMode === "fully") {
      return false;
    }
    const filter = metadata?.filter ?? {};
    if (
      !matchesCardFilter(card, def, filter, {
        state,
        getCardDefinitionById,
        underCardIds: collectUnderCardScopeIds(state),
      })
    )
      return false;
    const source = state.cardInstances.find(
      (c) => c.instanceId === ce.sourceInstanceId
    );
    return (
      resolveCardImmunityAffect(
        state,
        card,
        ce.actingPlayerId,
        "none",
        {
          instance: source,
          definition: getCardDefinitionById(ce.sourceDefinitionId),
          effectIndex: ce.provenance?.effectIndex,
        },
        getCardDefinitionById
      ).kind === "allowed"
    );
  });
}
