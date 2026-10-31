import type { CardDefinition } from "./model";
import type { AiSearchCardCount } from "./ai-search-deck-knowledge";
import { validateMainDeckDefinitions } from "./card/card-filter";
import { MIN_DECK_SIZE } from "./factories";

/** A viewer-known change to the combined hand+deck multiset. Drawing,
 * shuffling and moving between hand/deck have no delta. Crossing that boundary,
 * creation, deletion and identity changes do. No live card reference is needed.
 *
 * This is a trusted in-memory component, not a wire format or an engine-history
 * completeness proof. The future request producer must supply EVERY change
 * since registration from viewer-visible facts. PublicDisclosure alone does not
 * currently supply that complete provenance. Never infer a missing change from
 * the real remaining deck, or use this component on that production path yet.
 */
export interface AiSearchOwnPopulationChanges {
  schemaVersion: 1;
  kind: "viewer-known-own-population-changes";
  events: readonly {
    /** Contiguous viewer-local ordinal, starting at zero. */
    eventId: number;
    removed: readonly AiSearchCardCount[];
    added: readonly AiSearchCardCount[];
  }[];
}

function data<T extends object, K extends keyof T>(input: T, key: K): T[K] {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor))
    throw new Error("invalid own population data property");
  return descriptor.value as T[K];
}

/** Reconstruct only the multiset, not any ordering or virtual GameState.
 * Registered-list legality applies at registration. Effect-created/transformed
 * current cards must resolve in the public DB, but do not reapply construction
 * copy/contract/token restrictions to the changed in-game population.
 */
export function reconstructAiSearchOwnPopulation(
  registeredCardNos: readonly string[],
  changes: AiSearchOwnPopulationChanges,
  publicCards: readonly CardDefinition[]
): readonly AiSearchCardCount[] {
  if (
    !Array.isArray(registeredCardNos) ||
    registeredCardNos.length < MIN_DECK_SIZE ||
    !Array.isArray(publicCards) ||
    !changes ||
    data(changes, "schemaVersion") !== 1 ||
    data(changes, "kind") !== "viewer-known-own-population-changes"
  )
    throw new Error("invalid registered own population input");
  const events = data(changes, "events");
  if (!Array.isArray(events))
    throw new Error("invalid own population event history");
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
  const identity = (id: string) => {
    if (typeof id !== "string" || !byId.has(id))
      throw new Error("unknown public own population card");
    return id;
  };
  const registered = registeredCardNos.map((id) => byId.get(identity(id))!);
  if (validateMainDeckDefinitions(registered).length)
    throw new Error("invalid registered main deck");
  const counts = new Map<string, number>();
  for (const definition of registered)
    counts.set(definition.cardNo, (counts.get(definition.cardNo) ?? 0) + 1);
  let size = registered.length;
  const readCounts = (entries: readonly AiSearchCardCount[]) => {
    if (!Array.isArray(entries))
      throw new Error("invalid own population change counts");
    const seen = new Set<string>();
    const result: AiSearchCardCount[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = data(entries, index);
      const cardNo = identity(data(entry, "cardNo"));
      const count = data(entry, "count");
      if (!Number.isSafeInteger(count) || count <= 0 || seen.has(cardNo))
        throw new Error("invalid or duplicate own population change count");
      seen.add(cardNo);
      result.push({ cardNo, count });
    }
    return result;
  };
  for (let index = 0; index < events.length; index++) {
    const event = data(events, index);
    if (data(event, "eventId") !== index)
      throw new Error("incomplete or reordered own population history");
    const removed = readCounts(data(event, "removed"));
    const added = readCounts(data(event, "added"));
    if (removed.length + added.length === 0)
      throw new Error("empty own population change");
    for (const { cardNo, count } of removed) {
      const remaining = (counts.get(cardNo) ?? 0) - count;
      if (remaining < 0)
        throw new Error("inconsistent_observation: own population removal");
      counts.set(cardNo, remaining);
      size -= count;
    }
    for (const { cardNo, count } of added) {
      const total = (counts.get(cardNo) ?? 0) + count;
      size += count;
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(size))
        throw new Error("own population count overflow");
      counts.set(cardNo, total);
    }
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, count]) => count > 0)
    .map(([cardNo, count]) => ({ cardNo, count }));
}
