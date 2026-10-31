import type {
  AiObservation,
  AiPlayerFeatures,
  AiRelativePlayer,
} from "./ai-observation";
import { AI_UNKNOWN_CARD } from "./ai-observation";
import { searchPlayerResolver } from "./ai-search-observation";
import { disclosureAudienceCanView } from "./public-disclosure";
import type { PublicDisclosureAudience } from "./model";

export interface AiSearchCardCount {
  cardNo: string;
  count: number;
}

/** Only present observations, not a claim about the remaining registered deck.
 * A later provenance-aware sampler must account for cards outside these zones,
 * generated/transformed cards and public movement history separately.
 */
export interface AiSearchDeckKnowledge {
  schemaVersion: 1;
  kind: "observed-hand-deck-constraints";
  players: readonly {
    owner: AiRelativePlayer;
    handCount: number;
    deckCount: number;
    knownHand: readonly AiSearchCardCount[];
    knownDeck: readonly {
      indexFromBottom: number;
      cardNo: string;
    }[];
  }[];
}

/** Same constraints with the observed audience retained for synthetic worlds.
 * Missing opponent-private knowledge is not reconstructed by this component.
 */
export interface AiSearchDeckKnowledgeWithVisibility extends Omit<
  AiSearchDeckKnowledge,
  "players"
> {
  players: readonly (Omit<
    AiSearchDeckKnowledge["players"][number],
    "knownDeck"
  > & {
    knownDeck: readonly {
      indexFromBottom: number;
      cardNo: string;
      audience: PublicDisclosureAudience;
      actor: AiRelativePlayer;
    }[];
  })[];
}

function data<T extends object, K extends keyof T>(input: T, key: K): T[K] {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor && !("value" in descriptor))
    throw new Error("invalid search deck knowledge data property");
  return descriptor?.value as T[K];
}

function count(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid observed hand/deck count");
  return value;
}

// A detached, validated copy of the observation's existing SSOT counts. This
// never computes/reconciles a GameState count from card instances.
function projectObservedZoneCounts(player: AiPlayerFeatures) {
  return {
    handCount: count(data(player, "handCount")),
    deckCount: count(data(player, "deckCount")),
  };
}

function cardNo(value: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === AI_UNKNOWN_CARD ||
    value === "_hidden_card_"
  )
    throw new Error("invalid known search card identity");
  return value;
}

/** Trusted player-observation adapter. No GameState, live instance IDs, true
 * opponent list, deck order or registered-list deduction enters this component.
 * Known positions are already audience-filtered by the common sanitizer; check
 * that boundary again and retain only relative owner, position and snapshot.
 */
export function projectAiSearchDeckKnowledge(
  observation: AiObservation
): AiSearchDeckKnowledge {
  const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
  return {
    ...knowledge,
    players: knowledge.players.map((player) => ({
      ...player,
      knownDeck: player.knownDeck.map(({ indexFromBottom, cardNo }) => ({
        indexFromBottom,
        cardNo,
      })),
    })),
  };
}

/** Single projection/validation path for counts, known identities and audience.
 * Actor IDs leave this boundary only as viewer-relative player bindings.
 */
export function projectAiSearchDeckKnowledgeWithVisibility(
  observation: AiObservation
): AiSearchDeckKnowledgeWithVisibility {
  const relative = searchPlayerResolver(observation);
  if (
    !Array.isArray(observation.cards) ||
    !Array.isArray(observation.knownDeck)
  )
    throw new Error("missing observed search deck knowledge");
  const players = (["me", "opp"] as const).map((owner) => {
    const player = observation.players.find(
      (value) => relative(data(value, "playerId")) === owner
    )!;
    const zoneCounts = projectObservedZoneCounts(player);
    const { handCount, deckCount } = zoneCounts;
    if (!Number.isSafeInteger(handCount + deckCount))
      throw new Error("invalid observed hand/deck count");
    const hand = new Map<string, number>();
    for (const token of observation.cards) {
      if (
        data(token, "zone") !== "hand" ||
        relative(data(token, "ownerPlayerId")) !== owner ||
        data(token, "identityVisibility") === "unknown"
      )
        continue;
      const identity = cardNo(data(token, "cardNoOrUnknown"));
      hand.set(identity, (hand.get(identity) ?? 0) + 1);
    }
    const knownCount = [...hand.values()].reduce(
      (sum, value) => sum + value,
      0
    );
    if (knownCount > handCount || (owner === "me" && knownCount !== handCount))
      throw new Error("observed hand count differs from visible cards");
    const slots = new Map<
      number,
      {
        cardNo: string;
        audience: PublicDisclosureAudience;
        actor: AiRelativePlayer;
      }
    >();
    for (const entry of observation.knownDeck) {
      const playerId = data(entry, "playerId");
      if (relative(playerId) !== owner) continue;
      const actorPlayerId = data(entry, "actorPlayerId");
      const actor = relative(actorPlayerId);
      const audience = data(entry, "audience");
      if (!["both", "actor_only", "opponent_only"].includes(audience))
        throw new Error("invalid observed deck knowledge audience");
      if (
        !disclosureAudienceCanView(
          audience,
          actorPlayerId,
          observation.viewpointPlayerId
        )
      )
        continue;
      const index = count(data(entry, "indexFromBottom"));
      if (index >= deckCount || slots.has(index))
        throw new Error("invalid or duplicate known search deck slot");
      slots.set(index, {
        cardNo: cardNo(data(entry, "definitionIdSnapshot")),
        audience,
        actor,
      });
    }
    return {
      owner,
      ...zoneCounts,
      knownHand: [...hand]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([cardNo, count]) => ({ cardNo, count })),
      knownDeck: [...slots]
        .sort(([a], [b]) => a - b)
        .map(([indexFromBottom, visibility]) => ({
          indexFromBottom,
          ...visibility,
        })),
    };
  });
  return { schemaVersion: 1, kind: "observed-hand-deck-constraints", players };
}
