import type { CardDefinition, CardInstance } from "./model";
import type { AiSearchSampledDeck } from "./ai-search-deck-sampler";
import { createCardInstance } from "./factories";
import type { AiSearchDeckKnowledgeWithVisibility } from "./ai-search-deck-knowledge";
import { disclosureAudienceCanView } from "./public-disclosure";
import type { AiSearchCard } from "./ai-search-cards";

/** Synthetic bindings for one sampled world. Never use real player/card IDs. */
export const AI_SEARCH_WORLD_PLAYERS = Object.freeze({
  me: "search-me",
  opp: "search-opp",
} as const);

/** Materialize just the sampled hand/deck component through the common factory.
 * Input is the constrained sampler's trusted output and the public card DB.
 * No real state, hidden instances, RNG, clock or module-global ID generator is
 * read. Slot IDs are local to one world, not persistent tracking identities.
 *
 * This does not build a resumable GameState: public cards, known-slot audiences,
 * pending/stack/usage and reprojection must still be supplied by the full I1
 * builder. In particular, do not substitute these fresh hand instances for the
 * root's visible-card references or copy live hidden-card metadata onto them.
 */
export function materializeAiSearchDecks(
  samples: readonly AiSearchSampledDeck[],
  publicCards: readonly CardDefinition[]
): CardInstance[] {
  if (
    !Array.isArray(samples) ||
    samples.length !== 2 ||
    !Array.isArray(publicCards)
  )
    throw new Error("invalid sampled deck materialization input");
  const definitions = new Map<string, CardDefinition>();
  for (const definition of publicCards) {
    if (
      typeof definition.cardNo !== "string" ||
      !definition.cardNo ||
      definitions.has(definition.cardNo)
    )
      throw new Error("invalid or duplicate public card definition");
    definitions.set(definition.cardNo, definition);
  }
  const cards: CardInstance[] = [];
  for (const owner of ["me", "opp"] as const) {
    const matching = samples.filter((sample) => sample.owner === owner);
    if (matching.length !== 1)
      throw new Error("invalid sampled deck player binding");
    const sample = matching[0]!;
    if (!Array.isArray(sample.hand) || !Array.isArray(sample.deckFromBottom))
      throw new Error("invalid sampled deck zones");
    const create = (cardNo: string, zone: "hand" | "deck", slot: number) => {
      const definition = definitions.get(cardNo);
      if (!definition) throw new Error("unknown public sampled card");
      return createCardInstance(definition, {
        instanceId: `search-hidden-${owner}-${zone}-${slot}`,
        ownerPlayerId: AI_SEARCH_WORLD_PLAYERS[owner],
        zone,
      });
    };
    // The sampler uses bottom=0; engine cardInstances use top first. Reverse a
    // copy, never the sample, and retain bottom-local slot IDs after reversal.
    for (let index = sample.deckFromBottom.length - 1; index >= 0; index--)
      cards.push(create(sample.deckFromBottom[index]!, "deck", index));
    for (let index = 0; index < sample.hand.length; index++)
      cards.push(create(sample.hand[index]!, "hand", index));
  }
  // Construction legality belongs to registration / prior selection. A current
  // population may contain effect-created cards or exceed the printed copy cap.
  return cards;
}

/** Bind observed known-deck slots to fresh sampled instances. Only projected
 * constraints, samples and public definitions enter; no real state/IDs exist
 * here. This does not supply public cards, root hand refs or pending state and
 * is not a complete virtual-world/reprojection or H1-H3 implementation.
 */
export function materializeAiSearchDecksWithKnowledge(
  samples: readonly AiSearchSampledDeck[],
  knowledge: AiSearchDeckKnowledgeWithVisibility,
  publicCards: readonly CardDefinition[]
): CardInstance[] {
  const cards = materializeAiSearchDecks(samples, publicCards);
  if (
    knowledge?.schemaVersion !== 1 ||
    knowledge.kind !== "observed-hand-deck-constraints" ||
    !Array.isArray(knowledge.players) ||
    knowledge.players.length !== 2
  )
    throw new Error("invalid sampled deck knowledge");
  const players: AiSearchDeckKnowledgeWithVisibility["players"] =
    knowledge.players;
  for (const owner of ["me", "opp"] as const) {
    const matching = players.filter((player) => player.owner === owner);
    if (matching.length !== 1)
      throw new Error("invalid deck knowledge binding");
    const player = matching[0]!;
    const deck = cards.filter(
      (card) =>
        card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[owner] &&
        card.zone === "deck"
    );
    const hand = cards.filter(
      (card) =>
        card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[owner] &&
        card.zone === "hand"
    );
    if (
      player.deckCount !== deck.length ||
      player.handCount !== hand.length ||
      !Array.isArray(player.knownHand) ||
      !Array.isArray(player.knownDeck)
    )
      throw new Error("inconsistent_observation: sampled zone counts");
    const seenHand = new Set<string>();
    let knownHandCount = 0;
    for (const entry of player.knownHand) {
      if (
        typeof entry.cardNo !== "string" ||
        !entry.cardNo ||
        !Number.isSafeInteger(entry.count) ||
        entry.count <= 0 ||
        seenHand.has(entry.cardNo) ||
        hand.filter((card) => card.definitionId === entry.cardNo).length <
          entry.count
      )
        throw new Error("inconsistent_observation: sampled known hand");
      seenHand.add(entry.cardNo);
      knownHandCount += entry.count;
    }
    if (owner === "me" && knownHandCount !== hand.length)
      throw new Error("inconsistent_observation: sampled own hand");
    const slots = new Set<number>();
    const knownDeck: AiSearchDeckKnowledgeWithVisibility["players"][number]["knownDeck"] =
      player.knownDeck;
    for (const slot of knownDeck) {
      if (
        !Number.isSafeInteger(slot.indexFromBottom) ||
        slot.indexFromBottom < 0 ||
        slot.indexFromBottom >= deck.length ||
        slots.has(slot.indexFromBottom) ||
        !["me", "opp"].includes(slot.actor) ||
        !["both", "actor_only", "opponent_only"].includes(slot.audience)
      )
        throw new Error("invalid sampled known deck visibility");
      // The projector has already filtered audience. Reject forged constraints
      // here rather than broadening them or silently discarding a known slot.
      if (!disclosureAudienceCanView(slot.audience, slot.actor, "me"))
        throw new Error("unobserved sampled deck knowledge");
      const card = deck[deck.length - 1 - slot.indexFromBottom]!;
      if (card.definitionId !== slot.cardNo)
        throw new Error(
          "inconsistent_observation: sampled known deck identity"
        );
      slots.add(slot.indexFromBottom);
      card.deckKnowledge = {
        audience: slot.audience,
        actorPlayerId: AI_SEARCH_WORLD_PLAYERS[slot.actor],
      };
    }
  }
  return cards;
}

/** Observation-local references to fresh sampled hand instances. A binding is
 * valid only for this root component, not a persistent tracking identity or an
 * authorization to expose a hand card to the other observer.
 */
export interface AiSearchHandBinding {
  cardRef: number;
  instanceId: string;
}

/** Join visible hand references and the sampled hand/deck component without
 * inserting duplicate hand cards when a later builder adds the public board.
 * Only projected cards, observed constraints, samples and public definitions
 * enter. The returned bindings contain synthetic IDs exclusively.
 *
 * This binds identities only: visible runtime modifiers, the public board,
 * pending/stack/usage and a complete resumable world remain the I1 builder's
 * responsibility. In particular, an observed historical hand disclosure is not
 * a live hand reference and cannot be supplied here as one.
 */
export function materializeAiSearchDecksWithHandRefs(
  samples: readonly AiSearchSampledDeck[],
  knowledge: AiSearchDeckKnowledgeWithVisibility,
  visibleCards: readonly AiSearchCard[],
  publicCards: readonly CardDefinition[]
): { cards: CardInstance[]; handBindings: readonly AiSearchHandBinding[] } {
  if (!Array.isArray(visibleCards))
    throw new Error("invalid visible search cards");
  const refs = new Set<number>();
  for (const card of visibleCards) {
    if (
      !Number.isSafeInteger(card.cardRef) ||
      card.cardRef < 0 ||
      refs.has(card.cardRef) ||
      !["me", "opp"].includes(card.owner)
    )
      throw new Error("invalid or duplicate visible search card reference");
    refs.add(card.cardRef);
    if (
      card.zone === "deck" ||
      (card.zone === "hand" && card.identityVisibility !== "known")
    )
      throw new Error("hidden or historical card cannot bind a live hand");
  }
  const cards = materializeAiSearchDecksWithKnowledge(
    samples,
    knowledge,
    publicCards
  );
  const handBindings: AiSearchHandBinding[] = [];
  for (const player of knowledge.players) {
    const visibleHand = visibleCards
      .filter((card) => card.zone === "hand" && card.owner === player.owner)
      .sort((a, b) => a.cardRef - b.cardRef);
    const counts = new Map<string, number>();
    for (const card of visibleHand)
      counts.set(
        card.cardNoOrUnknown,
        (counts.get(card.cardNoOrUnknown) ?? 0) + 1
      );
    if (
      counts.size !== player.knownHand.length ||
      player.knownHand.some(({ cardNo, count }) => counts.get(cardNo) !== count)
    )
      throw new Error("inconsistent_observation: visible hand references");
    const remaining = cards.filter(
      (card) =>
        card.zone === "hand" &&
        card.ownerPlayerId === AI_SEARCH_WORLD_PLAYERS[player.owner]
    );
    for (const observed of visibleHand) {
      const index = remaining.findIndex(
        (card) => card.definitionId === observed.cardNoOrUnknown
      );
      if (index < 0)
        throw new Error("inconsistent_observation: sampled hand reference");
      // Consume one slot per observed copy. Equal definitions do not collapse
      // distinct root choices or reuse a single sampled instance twice.
      const [card] = remaining.splice(index, 1);
      handBindings.push({
        cardRef: observed.cardRef,
        instanceId: card!.instanceId,
      });
    }
  }
  handBindings.sort((a, b) => a.cardRef - b.cardRef);
  return { cards, handBindings };
}
