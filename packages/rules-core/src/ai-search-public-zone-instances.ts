import type { AiSearchCard } from "./ai-search-cards";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { createCardInstance } from "./factories";
import type { CardDefinition, CardInstance } from "./model";

/** Physical, visible trash/removed-card component of a sampled world.
 * Accept only the corresponding subset of projectAiSearchCards and the public
 * card DB. No live state, identities, hidden order or historical bindings enter.
 * The common factory supplies fresh observation-local instances; equal printed
 * cards remain separate selectable copies.
 *
 * This is not a complete world builder. Zone-entry history, usage, continuous
 * effects and continuations still require separate observed reconstruction and
 * full reprojection. In particular, this does not authorize sampling concealed
 * cards, treating a revealed snapshot as a live card, or resuming in-use cards.
 */
export function materializeAiSearchPublicZoneInstances(
  publicZoneCards: readonly AiSearchCard[],
  getPublicCardDefinition: (cardNo: string) => CardDefinition | undefined
): {
  cards: CardInstance[];
  publicZoneBindings: readonly { cardRef: number; instanceId: string }[];
} {
  if (!Array.isArray(publicZoneCards))
    throw new Error("invalid observed public zone component");
  const observedCards: readonly AiSearchCard[] = publicZoneCards;
  const refs = new Set<number>();
  const cards: CardInstance[] = [];
  const publicZoneBindings: { cardRef: number; instanceId: string }[] = [];
  for (const observed of [...observedCards].sort(
    (a, b) => a.cardRef - b.cardRef
  )) {
    if (
      !Number.isSafeInteger(observed.cardRef) ||
      observed.cardRef < 0 ||
      refs.has(observed.cardRef) ||
      !["me", "opp"].includes(observed.owner) ||
      !["me", "opp"].includes(observed.controller) ||
      (observed.zone !== "trash" && observed.zone !== "removed_from_game") ||
      observed.identityVisibility !== "known" ||
      observed.faceDown !== false ||
      observed.pendingLeaveKind !== null ||
      observed.attachedTo !== undefined ||
      !Array.isArray(observed.attachedChildren) ||
      observed.attachedChildren.length !== 0 ||
      (observed.imaginRight !== undefined && observed.imaginRight !== null) ||
      observed.underCardCount !== 0
    )
      throw new Error("unsupported or inconsistent observed public zone card");
    refs.add(observed.cardRef);
    if (
      [
        observed.normalCoreCount,
        observed.soulCoreCount,
        observed.minimumRequiredCores,
      ].some((count) => !Number.isSafeInteger(count) || count < 0) ||
      !["recovered", "exhausted", "heavily_exhausted"].includes(
        observed.exhaustState
      ) ||
      observed.exhausted !== (observed.exhaustState !== "recovered") ||
      typeof observed.zoneRoleName !== "string" ||
      !observed.zoneRoleName ||
      typeof observed.cardNoOrUnknown !== "string" ||
      !observed.cardNoOrUnknown
    )
      throw new Error("invalid observed public zone values");
    const definition = getPublicCardDefinition(observed.cardNoOrUnknown);
    if (!definition || definition.cardNo !== observed.cardNoOrUnknown)
      throw new Error("unknown or inconsistent public zone definition");
    // A transformed card's provenance cannot be inferred from its current face.
    // The normal field-leave primitive restores the front before these zones.
    if (
      observed.originalCardNo !== undefined &&
      observed.originalCardNo !== definition.cardNo
    )
      throw new Error("unsupported observed public zone original face");
    const instanceId = `search-public-${observed.cardRef}`;
    cards.push(
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: AI_SEARCH_WORLD_PLAYERS[observed.owner],
        controllerPlayerId: AI_SEARCH_WORLD_PLAYERS[observed.controller],
        zone: observed.zone,
        zoneRoleName: observed.zoneRoleName,
        normalCoreCount: observed.normalCoreCount,
        soulCoreCount: observed.soulCoreCount,
        minimumRequiredCores: observed.minimumRequiredCores,
        exhaustState: observed.exhaustState,
      })
    );
    publicZoneBindings.push({ cardRef: observed.cardRef, instanceId });
  }
  return { cards, publicZoneBindings };
}
