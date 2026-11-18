import type { CardDefinition } from "./model";
import type { AiRelativePlayer } from "./ai-observation";
import type {
  AiSearchCardCount,
  AiSearchDeckKnowledge,
} from "./ai-search-deck-knowledge";
import {
  getCardDefinitionMainDeckMaxCount,
  validateMainDeckDefinitions,
} from "./card/card-filter";
import { mulberry32 } from "./training-decision-surface";
import { measureAiWork, type AiWorkTelemetry } from "./ai-work-telemetry";
import {
  reconstructAiSearchOwnPopulation,
  type AiSearchOwnPopulationChanges,
} from "./ai-search-own-population";

/** A hypothesis about the CURRENT hand+deck population, never the true deck.
 * The registered-list composition below requires a complete viewer-known delta
 * stream; its production producer is unfinished. Do not pass a full starting
 * list here after cards have left the population.
 */
export interface AiSearchDeckHypothesis {
  weight: number;
  cardNos: readonly string[];
}

export interface AiSearchSampledDeck {
  owner: AiRelativePlayer;
  prior:
    | "supplied_population"
    | "registered_with_observed_changes"
    | "unknown_archetype";
  /** Bottom is index zero, matching the known-deck observation contract. */
  deckFromBottom: readonly string[];
  /** No real instance IDs or real hidden ordering are produced. */
  hand: readonly string[];
}

/** This is only hidden-zone allocation, not a resumable GameState sampler,
 * MO-ISMCTS, a full search request, or H1-H3 acceptance. Inputs are trusted
 * immutable data components and a public DB, not arbitrary external JSON.
 */
export function sampleAiSearchDeck(
  knowledge: AiSearchDeckKnowledge,
  owner: AiRelativePlayer,
  hypotheses: readonly AiSearchDeckHypothesis[],
  publicCards: readonly CardDefinition[],
  seed: number,
  telemetry?: AiWorkTelemetry
): AiSearchSampledDeck {
  return measureAiWork(telemetry, "hidden_zone_sampling", () =>
    sampleDeck(knowledge, owner, hypotheses, publicCards, seed)
  );
}

/** Partial I1 composition seam. Requires a complete viewer-known change stream;
 * its production observation/history producer is not implemented yet. Unlike
 * the generic prior API, it validates the starting registered list, then permits
 * effect-created cards/copy counts in the current multiset. The trusted producer
 * must bind registration/deltas to the viewer; that binding is not proved by a
 * relative-owner component. No opponent-list or raw GameState parameter exists.
 */
export function sampleAiSearchOwnRegisteredDeck(
  knowledge: AiSearchDeckKnowledge,
  registeredCardNos: readonly string[],
  changes: AiSearchOwnPopulationChanges,
  publicCards: readonly CardDefinition[],
  seed: number,
  telemetry?: AiWorkTelemetry
): AiSearchSampledDeck {
  return measureAiWork(telemetry, "hidden_zone_sampling", () =>
    sampleDeck(
      knowledge,
      "me",
      [],
      publicCards,
      seed,
      reconstructAiSearchOwnPopulation(registeredCardNos, changes, publicCards)
    )
  );
}

function sampleDeck(
  knowledge: AiSearchDeckKnowledge,
  owner: AiRelativePlayer,
  hypotheses: readonly AiSearchDeckHypothesis[],
  publicCards: readonly CardDefinition[],
  seed: number,
  registeredPopulation?: readonly AiSearchCardCount[]
): AiSearchSampledDeck {
  if (
    knowledge?.schemaVersion !== 1 ||
    knowledge.kind !== "observed-hand-deck-constraints" ||
    !["me", "opp"].includes(owner) ||
    !Array.isArray(knowledge.players) ||
    knowledge.players.length !== 2 ||
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Array.isArray(hypotheses) ||
    !Array.isArray(publicCards)
  )
    throw new Error("invalid search deck sampler input");
  for (const relative of ["me", "opp"] as const)
    if (
      knowledge.players.filter((player) => player.owner === relative).length !==
      1
    )
      throw new Error("invalid search deck player binding");
  const player = knowledge.players.find((value) => value.owner === owner)!;
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const total = player.handCount + player.deckCount;
  if (
    !integer(player.handCount) ||
    !integer(player.deckCount) ||
    !integer(total) ||
    !Array.isArray(player.knownHand) ||
    !Array.isArray(player.knownDeck)
  )
    throw new Error("invalid search deck constraints");
  const required = new Map<string, number>();
  const need = (id: string, amount: number) => {
    if (typeof id !== "string" || !id || !integer(amount) || amount === 0)
      throw new Error("invalid search deck constraint identity/count");
    required.set(id, (required.get(id) ?? 0) + amount);
  };
  const handIds = new Set<string>();
  let knownHandCount = 0;
  for (const entry of player.knownHand) {
    if (handIds.has(entry.cardNo))
      throw new Error("duplicate known hand identity");
    handIds.add(entry.cardNo);
    need(entry.cardNo, entry.count);
    knownHandCount += entry.count;
  }
  const slots = new Set<number>();
  for (const entry of player.knownDeck) {
    if (
      !integer(entry.indexFromBottom) ||
      entry.indexFromBottom >= player.deckCount ||
      slots.has(entry.indexFromBottom)
    )
      throw new Error("invalid or duplicate known search deck slot");
    slots.add(entry.indexFromBottom);
    need(entry.cardNo, 1);
  }
  if (
    knownHandCount > player.handCount ||
    (owner === "me" && knownHandCount !== player.handCount)
  )
    throw new Error("inconsistent_observation: visible hand count");
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byId = new Map<string, CardDefinition>();
  for (const definition of publicCards) {
    if (
      typeof definition.cardNo !== "string" ||
      !definition.cardNo ||
      byId.has(definition.cardNo)
    )
      throw new Error("invalid or duplicate public card definition");
    byId.set(definition.cardNo, definition);
  }
  const resolve = (ids: readonly string[]) =>
    ids.map((id) => {
      const definition = byId.get(id);
      if (!definition) throw new Error("unknown public hypothesis card");
      return definition;
    });
  const counts = (ids: readonly string[]) => {
    const result = new Map<string, number>();
    for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
    return result;
  };
  const matches = (ids: readonly string[]) => {
    const population = counts(ids);
    return (
      ids.length === total &&
      [...required].every(([id, count]) => (population.get(id) ?? 0) >= count)
    );
  };
  const rng = mulberry32(seed);
  const shuffle = (ids: string[]) => {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    return ids;
  };
  const fromRegisteredChanges = registeredPopulation !== undefined;
  let priors = hypotheses;
  if (registeredPopulation) {
    // Check the observed count before expanding. A corrupt but safe-integer
    // delta must not allocate an enormous array merely to discover a mismatch.
    const size = registeredPopulation.reduce(
      (sum, entry) => sum + entry.count,
      0
    );
    if (size !== total)
      throw new Error("inconsistent_observation: own population count");
    priors = [
      {
        weight: 1,
        cardNos: registeredPopulation.flatMap(({ cardNo, count }) =>
          Array.from({ length: count }, () => cardNo)
        ),
      },
    ];
  }
  const compatible = priors
    .map((candidate) => {
      if (
        !Number.isFinite(candidate.weight) ||
        candidate.weight <= 0 ||
        !Array.isArray(candidate.cardNos)
      )
        throw new Error("invalid search population prior");
      const ids = [...candidate.cardNos].sort(compare);
      // Invalid populations are configuration errors, not silently dropped priors.
      const definitions = resolve(ids);
      if (
        !fromRegisteredChanges &&
        validateMainDeckDefinitions(definitions).length
      )
        throw new Error("invalid main-deck hypothesis population");
      return { ids, weight: candidate.weight };
    })
    .filter((candidate) => matches(candidate.ids));

  let population: string[];
  let prior: AiSearchSampledDeck["prior"] = fromRegisteredChanges
    ? "registered_with_observed_changes"
    : "supplied_population";
  if (owner === "me") {
    // Exact own remaining multiset must come from registered list + known
    // movements. Do not replace contradictory own knowledge with a public prior.
    if (priors.length !== 1 || compatible.length !== 1)
      throw new Error("inconsistent_observation: own population");
    population = compatible[0]!.ids;
  } else if (compatible.length) {
    // Scale before summation so extreme finite weights cannot overflow.
    const max = Math.max(...compatible.map((candidate) => candidate.weight));
    const sum = compatible.reduce(
      (value, candidate) => value + candidate.weight / max,
      0
    );
    let draw = rng() * sum;
    population = compatible.at(-1)!.ids;
    for (const candidate of compatible) {
      draw -= candidate.weight / max;
      if (draw < 0) {
        population = candidate.ids;
        break;
      }
    }
  } else {
    prior = "unknown_archetype";
    const fixed = [...required]
      .sort(([a], [b]) => compare(a, b))
      .flatMap(([id, count]) => Array.from({ length: count }, () => id));
    if (
      fixed.length > total ||
      validateMainDeckDefinitions(resolve(fixed)).length
    )
      throw new Error("inconsistent_observation: required cards");
    const pool = [...byId.values()].sort((a, b) => compare(a.cardNo, b.cardNo));
    population = [];
    // Bounded rejection sampling. Every attempt starts from the same immutable
    // constraints; neither a failed attempt nor pool exhaustion relaxes them.
    for (let attempt = 0; attempt < 32; attempt++) {
      const trial = [...fixed];
      const used = counts(trial);
      while (trial.length < total) {
        const eligible = pool.filter((definition) => {
          if (
            (used.get(definition.cardNo) ?? 0) >=
            getCardDefinitionMainDeckMaxCount(definition)
          )
            return false;
          return (
            validateMainDeckDefinitions([...resolve(trial), definition])
              .length === 0
          );
        });
        if (!eligible.length) break;
        const id = eligible[Math.floor(rng() * eligible.length)]!.cardNo;
        trial.push(id);
        used.set(id, (used.get(id) ?? 0) + 1);
      }
      if (
        matches(trial) &&
        validateMainDeckDefinitions(resolve(trial)).length === 0
      ) {
        population = trial.sort(compare);
        break;
      }
    }
    if (!matches(population))
      throw new Error("inconsistent_observation: public population exhausted");
  }
  const remaining = [...population];
  const take = (id: string) => {
    const index = remaining.indexOf(id);
    if (index < 0)
      throw new Error("inconsistent_observation: missing required card");
    remaining.splice(index, 1);
    return id;
  };
  const hand = [...player.knownHand]
    .sort((a, b) => compare(a.cardNo, b.cardNo))
    .flatMap((entry) =>
      Array.from({ length: entry.count }, () => take(entry.cardNo))
    );
  const deck: (string | undefined)[] = Array.from({ length: player.deckCount });
  for (const entry of [...player.knownDeck].sort(
    (a, b) => a.indexFromBottom - b.indexFromBottom
  ))
    deck[entry.indexFromBottom] = take(entry.cardNo);
  shuffle(remaining);
  while (hand.length < player.handCount) hand.push(remaining.pop()!);
  for (let i = 0; i < deck.length; i++)
    if (deck[i] === undefined) deck[i] = remaining.pop()!;
  if (
    remaining.length ||
    hand.some((id) => typeof id !== "string") ||
    deck.some((id) => typeof id !== "string")
  )
    throw new Error("inconsistent_observation: population allocation");
  return {
    owner,
    prior,
    hand: shuffle(hand),
    deckFromBottom: deck as string[],
  };
}
