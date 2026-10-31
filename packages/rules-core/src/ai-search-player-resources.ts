import {
  AI_UNKNOWN_CARD,
  type AiObservation,
  type AiRelativePlayer,
} from "./ai-observation";
import { isContractDefinition } from "./card/card-filter";
import { projectAiSearchCards, type AiSearchCard } from "./ai-search-cards";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { searchPlayerResolver } from "./ai-search-observation";
import type { CardDefinition, CardInstance, PlayerState } from "./model";

const countFields = [
  "deckCount",
  "handCount",
  "lifeNormalCoreCount",
  "reserveNormalCoreCount",
  "trashNormalCoreCount",
  "voidNormalCoreCount",
  "reserveSoulCoreCount",
  "trashSoulCoreCount",
  "lifeSoulCoreCount",
  "countValue",
] as const;

type ResourceCounts = Pick<PlayerState, (typeof countFields)[number]>;

function copyCountProtection(
  input: Readonly<Record<string, number>> | undefined,
  count: number
): Record<string, number> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error("missing observed count protection");
  const entries: [string, number][] = [];
  let total = 0;
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0
    )
      throw new Error("invalid observed count protection");
    total += descriptor.value;
    if (!Number.isSafeInteger(total) || total > count)
      throw new Error("inconsistent observed count protection");
    entries.push([key, descriptor.value]);
  }
  // shrinkProtectedCounts consumes equally reducible buckets in insertion order.
  return Object.fromEntries(entries);
}

function copyResourceCounts(input: ResourceCounts): ResourceCounts {
  const counts = {} as ResourceCounts;
  for (const field of countFields) {
    const value = input[field];
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("invalid observed player resource count");
    counts[field] = value;
  }
  return counts;
}
type ObservedSoulLocation =
  | { kind: "card"; cardRef: number }
  | { kind: "reserve" | "trash" | "life" | "removed_from_game" }
  | null;

function copyPresentedContract(input: string | null): string | null {
  if (
    input !== null &&
    (typeof input !== "string" || !input || input === AI_UNKNOWN_CARD)
  )
    throw new Error("missing or invalid observed contract presentation");
  return input;
}

/** Physical resources, public presentation and soul-state membership, not a complete player.
 * Includes public count protection. Usage and continuations are separate.
 * Counts support multiple interchangeable soul cores. The legacy location is
 * preserved independently; never infer it from a count or card ownership.
 */
export type AiSearchPlayerResources = ResourceCounts & {
  owner: AiRelativePlayer;
  soulCoreLocation: ObservedSoulLocation;
  soulStateCardRefs: readonly number[];
  protectedCounts: Readonly<Record<string, number>>;
  contractCardNo: string | null;
};

export function projectAiSearchPlayerResources(
  observation: AiObservation
): readonly AiSearchPlayerResources[] {
  const relative = searchPlayerResolver(observation);
  // Shares the card projector's order, validation and reference namespace.
  const cards = projectAiSearchCards(observation);
  const soulRefs = new Set<number>();
  return (["me", "opp"] as const).map((owner) => {
    const player = observation.players.find(
      (entry) => relative(entry.playerId) === owner
    )!;
    const counts = copyResourceCounts(player);
    const protectedCounts = copyCountProtection(
      player.protectedCounts,
      counts.countValue
    );
    const contractCardNo = copyPresentedContract(player.contractCardNo);
    const kind = player.soulCoreLocationKind;
    let soulCoreLocation: ObservedSoulLocation;
    if (kind === "none") soulCoreLocation = null;
    else if (kind === "card") {
      const index = observation.cards.findIndex(
        (card) => card.instanceId === player.soulCoreCardInstanceId
      );
      const card = cards[index];
      if (!card || card.zone !== "field" || card.soulCoreCount <= 0)
        throw new Error("missing observed soul core field reference");
      soulCoreLocation = { kind: "card", cardRef: card.cardRef };
    } else if (
      kind === "reserve" ||
      kind === "trash" ||
      kind === "life" ||
      kind === "removed_from_game"
    ) {
      if (
        (kind === "reserve" && counts.reserveSoulCoreCount === 0) ||
        (kind === "trash" && counts.trashSoulCoreCount === 0) ||
        (kind === "life" && counts.lifeSoulCoreCount === 0)
      )
        throw new Error("inconsistent observed soul core location");
      soulCoreLocation = { kind };
    } else throw new Error("invalid observed soul core location");
    const ids = player.soulStateCardInstanceIds;
    if (
      !Array.isArray(ids) ||
      !Number.isSafeInteger(player.soulStateCount) ||
      player.soulStateCount < 0 ||
      ids.length !== player.soulStateCount ||
      new Set(ids).size !== ids.length
    )
      throw new Error("missing or inconsistent observed soul state membership");
    const soulStateCardRefs = ids
      .map((id) => {
        const card =
          cards[observation.cards.findIndex((c) => c.instanceId === id)];
        if (
          typeof id !== "string" ||
          !card ||
          card.zone !== "field" ||
          card.identityVisibility !== "known" ||
          card.faceDown ||
          card.controller !== owner ||
          card.normalCoreCount !== 0 ||
          card.soulCoreCount !== 0 ||
          card.exhaustState !== "recovered" ||
          card.pendingLeaveKind !== null ||
          soulRefs.has(card.cardRef)
        )
          throw new Error("invalid observed soul state field reference");
        soulRefs.add(card.cardRef);
        return card.cardRef;
      })
      .sort((a, b) => a - b);
    return {
      owner,
      ...counts,
      protectedCounts,
      contractCardNo,
      soulCoreLocation,
      soulStateCardRefs,
    };
  });
}

/** Bind the physical component to the already materialized public field.
 * Returns explicit overrides for the common player/game factories. It does not
 * default the unobserved mechanics of a full player or resume a sampled world.
 * No real GameState, secret instance, or source player is accepted or copied.
 */
export function materializeAiSearchPlayerResources(
  resources: readonly AiSearchPlayerResources[],
  field: {
    cards: readonly CardInstance[];
    fieldBindings: readonly { cardRef: number; instanceId: string }[];
  },
  observedField: readonly AiSearchCard[],
  getPublicCardDefinition: (cardNo: string) => CardDefinition | undefined
): (ResourceCounts &
  Pick<
    PlayerState,
    | "id"
    | "soulCoreLocation"
    | "soulStateInstanceIds"
    | "protectedCounts"
    | "contractCardNo"
  >)[] {
  if (!Array.isArray(resources) || resources.length !== 2)
    throw new Error("invalid observed player resource component");
  const observedResources: readonly AiSearchPlayerResources[] = resources;
  const usedSoulRefs = new Set<number>();
  return (["me", "opp"] as const).map((owner) => {
    const matching = observedResources.filter((entry) => entry.owner === owner);
    if (matching.length !== 1)
      throw new Error("invalid observed player resource binding");
    const resource = matching[0]!;
    const contractCardNo = copyPresentedContract(resource.contractCardNo);
    if (contractCardNo !== null) {
      const definition = getPublicCardDefinition(contractCardNo);
      if (
        !definition ||
        definition.cardNo !== contractCardNo ||
        !isContractDefinition(definition)
      )
        throw new Error("unknown or inconsistent public presented contract");
    }
    const counts = copyResourceCounts(resource);
    const protectedCounts = copyCountProtection(
      resource.protectedCounts,
      counts.countValue
    );
    const location = resource.soulCoreLocation;
    let soulCoreLocation: PlayerState["soulCoreLocation"];
    if (location === null) soulCoreLocation = null;
    else if (location.kind === "card") {
      const observed = observedField.filter(
        (card) => card.cardRef === location.cardRef
      );
      const bindings = field.fieldBindings.filter(
        (binding) => binding.cardRef === location.cardRef
      );
      const instances = field.cards.filter(
        (card) => card.instanceId === bindings[0]?.instanceId
      );
      if (
        !Number.isSafeInteger(location.cardRef) ||
        location.cardRef < 0 ||
        observed.length !== 1 ||
        observed[0]!.zone !== "field" ||
        observed[0]!.soulCoreCount <= 0 ||
        bindings.length !== 1 ||
        bindings[0]!.instanceId !== `search-field-${location.cardRef}` ||
        instances.length !== 1 ||
        instances[0]!.zone !== "field" ||
        instances[0]!.soulCoreCount !== observed[0]!.soulCoreCount
      )
        throw new Error("inconsistent materialized soul core field binding");
      soulCoreLocation = { kind: "card", instanceId: instances[0]!.instanceId };
    } else if (
      location.kind === "reserve" ||
      location.kind === "trash" ||
      location.kind === "life" ||
      location.kind === "removed_from_game"
    ) {
      if (
        (location.kind === "reserve" && counts.reserveSoulCoreCount === 0) ||
        (location.kind === "trash" && counts.trashSoulCoreCount === 0) ||
        (location.kind === "life" && counts.lifeSoulCoreCount === 0)
      )
        throw new Error("inconsistent observed soul core location");
      soulCoreLocation = { kind: location.kind };
    } else throw new Error("invalid observed soul core location");
    if (!Array.isArray(resource.soulStateCardRefs))
      throw new Error("missing observed soul state membership");
    const soulStateInstanceIds = resource.soulStateCardRefs.map((cardRef) => {
      const observed = observedField.filter((card) => card.cardRef === cardRef);
      const bindings = field.fieldBindings.filter(
        (entry) => entry.cardRef === cardRef
      );
      const instances = field.cards.filter(
        (card) => card.instanceId === bindings[0]?.instanceId
      );
      if (
        !Number.isSafeInteger(cardRef) ||
        cardRef < 0 ||
        usedSoulRefs.has(cardRef) ||
        observed.length !== 1 ||
        bindings.length !== 1 ||
        instances.length !== 1 ||
        observed[0]!.zone !== "field" ||
        observed[0]!.identityVisibility !== "known" ||
        observed[0]!.faceDown ||
        observed[0]!.controller !== owner ||
        observed[0]!.normalCoreCount !== 0 ||
        observed[0]!.soulCoreCount !== 0 ||
        observed[0]!.exhaustState !== "recovered" ||
        observed[0]!.pendingLeaveKind !== null ||
        bindings[0]!.instanceId !== `search-field-${cardRef}` ||
        instances[0]!.zone !== "field" ||
        instances[0]!.controllerPlayerId !== AI_SEARCH_WORLD_PLAYERS[owner] ||
        instances[0]!.normalCoreCount !== 0 ||
        instances[0]!.soulCoreCount !== 0 ||
        instances[0]!.exhaustState !== "recovered" ||
        instances[0]!.pendingLeaveKind !== null
      )
        throw new Error("inconsistent materialized soul state field binding");
      usedSoulRefs.add(cardRef);
      return instances[0]!.instanceId;
    });
    return {
      id: AI_SEARCH_WORLD_PLAYERS[owner],
      contractCardNo,
      ...counts,
      protectedCounts,
      soulCoreLocation,
      soulStateInstanceIds,
    };
  });
}
