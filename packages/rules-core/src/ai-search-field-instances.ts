import type { AiSearchCard } from "./ai-search-cards";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { createCardInstance } from "./factories";
import { synthesizeBackFaceDefinition } from "./effect/structured-effect-registrations";
import { isImaginBrave, type CardDefinition, type CardInstance } from "./model";

/** Physical field component only. This is not a resumable sampled world.
 * Input must be the field subset of projectAiSearchCards, plus the public DB.
 * No real state or instance IDs are accepted. Continuous effects, usage/history,
 * player soul-core locations and continuations must be built
 * separately and the complete world's observation must then be checked.
 *
 * Supports known, face-up field cards and one-level Brave attachments, including
 * explicitly observed Imagin right slots. Reject concealed identities, incomplete/nested
 * relationships, under-cards and leave-pending cards rather
 * than guessing their missing relationships/provenance. Effective BP, symbols,
 * colors etc. are observations, not replacement printed definitions or effects.
 */
export function materializeAiSearchFieldInstances(
  fieldCards: readonly AiSearchCard[],
  getPublicCardDefinition: (cardNo: string) => CardDefinition | undefined
): {
  cards: CardInstance[];
  fieldBindings: readonly { cardRef: number; instanceId: string }[];
} {
  if (!Array.isArray(fieldCards))
    throw new Error("invalid observed field component");
  const observedCards: readonly AiSearchCard[] = fieldCards;
  const refs = new Set<number>();
  const definitions = new Map<number, CardDefinition>();
  const byRef = new Map<number, AiSearchCard>();
  const cards: CardInstance[] = [];
  const fieldBindings: { cardRef: number; instanceId: string }[] = [];
  for (const observed of [...observedCards].sort(
    (a, b) => a.cardRef - b.cardRef
  )) {
    if (
      !Number.isSafeInteger(observed.cardRef) ||
      observed.cardRef < 0 ||
      refs.has(observed.cardRef) ||
      !["me", "opp"].includes(observed.owner) ||
      !["me", "opp"].includes(observed.controller) ||
      observed.zone !== "field" ||
      observed.identityVisibility !== "known" ||
      observed.faceDown !== false ||
      observed.pendingLeaveKind !== null ||
      !Array.isArray(observed.attachedChildren) ||
      observed.underCardCount !== 0
    )
      throw new Error("unsupported or inconsistent observed field card");
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
      throw new Error("invalid observed field values");
    const definition = getPublicCardDefinition(observed.cardNoOrUnknown);
    if (!definition || definition.cardNo !== observed.cardNoOrUnknown)
      throw new Error("unknown or inconsistent public field definition");
    // 08a: a back face returns to its original front on leaving the field.
    // Missing provenance is not proof that the current face is the front.
    // Only an explicit public DB pair is supported; other transformations
    // require their own observed provenance before this component can resume.
    if (typeof observed.originalCardNo !== "string" || !observed.originalCardNo)
      throw new Error("missing observed field original face");
    const original = getPublicCardDefinition(observed.originalCardNo);
    if (
      !original ||
      original.cardNo !== observed.originalCardNo ||
      (original.cardNo !== definition.cardNo &&
        (!original.isDoubleSided ||
          !original.backFace ||
          synthesizeBackFaceDefinition(original, original.backFace).cardNo !==
            definition.cardNo))
    )
      throw new Error(
        "unsupported or inconsistent observed field original face"
      );
    // 08c:32,50-54: the right slot has no ordinary reciprocal child reference.
    // Old tokens without this projection cannot prove even an empty slot.
    if (isImaginBrave(definition) && observed.imaginRight === undefined)
      throw new Error("missing observed Imagin right slot");
    if (
      !isImaginBrave(definition) &&
      observed.imaginRight !== undefined &&
      observed.imaginRight !== null
    )
      throw new Error("unexpected observed Imagin attachment");
    definitions.set(observed.cardRef, definition);
    byRef.set(observed.cardRef, observed);
  }
  // These are observed physical links, not a new legality evaluator. In
  // particular, never infer a missing reciprocal edge from just one endpoint.
  // Card IDs are allocated only after the entire component has been checked.
  const rightHosts = new Set<number>();
  for (const observed of byRef.values()) {
    const parentRef = observed.attachedTo;
    if (parentRef !== undefined) {
      const parent = byRef.get(parentRef);
      if (
        !Number.isSafeInteger(parentRef) ||
        parentRef === observed.cardRef ||
        !parent ||
        parent.attachedTo !== undefined ||
        observed.attachedChildren.length !== 0 ||
        definitions.get(observed.cardRef)!.printedCategory !== "brave" ||
        !parent.attachedChildren.includes(observed.cardRef)
      )
        throw new Error(
          "unsupported or inconsistent observed field attachment"
        );
    }
    const children = new Set<number>();
    for (const childRef of observed.attachedChildren) {
      const child = byRef.get(childRef);
      if (
        !Number.isSafeInteger(childRef) ||
        childRef === observed.cardRef ||
        children.has(childRef) ||
        !child ||
        child.attachedTo !== observed.cardRef
      )
        throw new Error(
          "unsupported or inconsistent observed field attachment"
        );
      children.add(childRef);
    }
    const rightRef = observed.imaginRight;
    if (rightRef !== undefined && rightRef !== null) {
      const right = byRef.get(rightRef);
      if (
        !Number.isSafeInteger(rightRef) ||
        rightRef === observed.cardRef ||
        rightRef === parentRef ||
        !right ||
        right.attachedTo !== undefined ||
        right.attachedChildren.length !== 0 ||
        isImaginBrave(definitions.get(rightRef)!) ||
        observed.attachedChildren.length !== 0 ||
        rightHosts.has(rightRef)
      )
        throw new Error(
          "unsupported or inconsistent observed Imagin attachment"
        );
      rightHosts.add(rightRef);
    }
    if (
      isImaginBrave(definitions.get(observed.cardRef)!) &&
      parentRef !== undefined &&
      byRef.get(parentRef)!.attachedChildren.length !== 1
    )
      throw new Error("unsupported or inconsistent observed Imagin attachment");
  }
  const syntheticId = (ref: number) => `search-field-${ref}`;
  for (const observed of byRef.values()) {
    const definition = definitions.get(observed.cardRef)!;
    const instanceId = syntheticId(observed.cardRef);
    const instance = createCardInstance(definition, {
      instanceId,
      ownerPlayerId: AI_SEARCH_WORLD_PLAYERS[observed.owner],
      controllerPlayerId: AI_SEARCH_WORLD_PLAYERS[observed.controller],
      zone: "field",
      zoneRoleName: observed.zoneRoleName,
      normalCoreCount: observed.normalCoreCount,
      soulCoreCount: observed.soulCoreCount,
      minimumRequiredCores: observed.minimumRequiredCores,
      exhaustState: observed.exhaustState,
      attachedToInstanceId:
        observed.attachedTo === undefined
          ? null
          : syntheticId(observed.attachedTo),
      attachedChildrenIds: observed.attachedChildren.map(syntheticId),
      imaginRightCombinedWith:
        observed.imaginRight === undefined || observed.imaginRight === null
          ? null
          : syntheticId(observed.imaginRight),
      // Having cores now entails the latch; zero cores do not reveal history.
      // The full builder must still reconstruct history-dependent state.
      everHadCorePlaced:
        observed.normalCoreCount > 0 || observed.soulCoreCount > 0,
    });
    // Populate a fresh instance, never mutate or clone the live source card.
    instance.originalDefinitionId = observed.originalCardNo!;
    cards.push(instance);
    fieldBindings.push({ cardRef: observed.cardRef, instanceId });
  }
  return { cards, fieldBindings };
}
