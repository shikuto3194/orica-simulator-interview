import type { AiObservation, AiRelativePlayer } from "./ai-observation";
import type {
  PublicDisclosure,
  PublicDisclosureResult,
  PublicDisclosureSource,
  PublicDisclosureTarget,
} from "./model";
import { disclosureAudienceCanView } from "./public-disclosure";
import { searchPlayerResolver } from "./ai-search-observation";

/** History component of the future search packet, not a resumable state.
 * Input must come from buildAiObservation in player mode. This module never
 * receives GameState, looks up live cards, or fills a missing snapshot from an ID.
 * Pending/stack/usage projection, canonical live-card references, request/root
 * candidates and the sampler still have to be implemented before I1 is accepted.
 */
export interface AiSearchHistory {
  schemaVersion: 1;
  events: readonly AiSearchHistoryEvent[];
}

type HistorySource = Pick<
  PublicDisclosureSource,
  "definitionIdSnapshot" | "effectIndex" | "definitionPath"
>;
type HistoryTarget = Pick<
  PublicDisclosureTarget,
  "kind" | "definitionIdSnapshot" | "zone" | "actionLabel" | "actionKind"
> & { player?: AiRelativePlayer };
type HistoryResult = Pick<
  PublicDisclosureResult,
  | "kind"
  | "definitionIdSnapshot"
  | "count"
  | "amount"
  | "value"
  | "zone"
  | "from"
  | "to"
  | "exhaustState"
  | "deckPositionSnapshot"
  | "deckIndexFromBottomSnapshot"
  | "deckCountSnapshot"
  | "order"
  | "hiddenReason"
  | "actionLabel"
  | "actionKind"
> & { player?: AiRelativePlayer };

export interface AiSearchHistoryEvent {
  /** Viewer-local ordinal. Global sequence gaps can reveal unseen events. */
  eventId: number;
  turnNumber: PublicDisclosure["turnNumber"];
  step: PublicDisclosure["step"];
  actor: AiRelativePlayer;
  audience: PublicDisclosure["audience"];
  kind: PublicDisclosure["kind"];
  /** Equality of observed attack references, without the engine's raw ID. */
  attackRef?: number;
  source?: HistorySource;
  targets: readonly HistoryTarget[];
  results: readonly HistoryResult[];
}

// Read only named scalar data. Neither extra properties nor serialization hooks
// enter the result; accessors and object-valued scalars are rejected, not called.
function scalar<T extends object, K extends keyof T>(
  input: T,
  key: K
): T[K] | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor))
    throw new Error("invalid search history scalar");
  const value: unknown = descriptor.value;
  if (
    value !== undefined &&
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    throw new Error("invalid search history scalar");
  return descriptor.value as T[K];
}

function pick<T extends object, K extends keyof T>(
  input: T,
  keys: readonly K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    const value = scalar(input, key);
    if (value !== undefined) result[key] = value as T[K];
  }
  return result;
}

function requireScalars<T extends object>(
  input: T,
  keys: readonly (keyof T)[]
) {
  for (const key of keys)
    if (scalar(input, key) === undefined)
      throw new Error("missing required search history scalar");
}

/** Project only the already audience-sanitized observation history. Passing
 * spectator_full/debug_perfect, raw GameState, or an unknown player fails closed.
 * Historical snapshots survive; all live instance/registration/event IDs are
 * deliberately absent. This history cannot track a card back into a hidden zone.
 * No RNG, clock, state clone, card DB or opponent deck is an input.
 */
export function projectAiSearchHistory(
  observation: AiObservation
): AiSearchHistory {
  const relative = searchPlayerResolver(observation);
  const playerRef = (entry: { playerId?: string }) => {
    const id = scalar(entry, "playerId");
    return id === undefined ? {} : { player: relative(id) };
  };
  const attacks = new Map<string, number>();
  const events: AiSearchHistoryEvent[] = [];
  for (const event of observation.publicMemory.disclosures) {
    const actorId = scalar(event, "actorPlayerId");
    const audience = scalar(event, "audience");
    if (
      !actorId ||
      !["both", "actor_only", "opponent_only"].includes(audience ?? "")
    )
      throw new Error("invalid search history audience");
    const actor = relative(actorId);
    // Defense in depth; public movement facts from private events have already
    // been rewritten by state-sanitize to hidden_card_action/audience=both.
    if (
      !disclosureAudienceCanView(
        audience!,
        actorId,
        observation.viewpointPlayerId
      )
    )
      continue;
    requireScalars(event, ["turnNumber", "step", "kind"]);
    const attackId = scalar(event, "attackId");
    if (attackId !== undefined && !attacks.has(attackId))
      attacks.set(attackId, attacks.size);
    let source: HistorySource | undefined;
    if (event.source) {
      source = pick(event.source, ["definitionIdSnapshot", "effectIndex"]);
      const path = Object.getOwnPropertyDescriptor(
        event.source,
        "definitionPath"
      );
      if (path && (!("value" in path) || path.value !== undefined)) {
        if (!("value" in path)) throw new Error("invalid search history path");
        if (path.value === null) source.definitionPath = null;
        else {
          if (!Array.isArray(path.value))
            throw new Error("invalid search history path");
          source.definitionPath = Array.from(
            { length: path.value.length },
            (_, i) => {
              const value = scalar(path.value, i);
              if (typeof value !== "string" && typeof value !== "number")
                throw new Error("invalid search history path");
              return value;
            }
          );
        }
      }
    }
    events.push({
      eventId: events.length,
      ...pick(event, ["turnNumber", "step", "kind"]),
      actor,
      audience: audience!,
      ...(attackId === undefined ? {} : { attackRef: attacks.get(attackId)! }),
      ...(source ? { source } : {}),
      targets: event.targets.map((target) => {
        requireScalars(target, ["kind"]);
        return {
          ...pick(target, [
            "kind",
            "definitionIdSnapshot",
            "zone",
            "actionLabel",
            "actionKind",
          ]),
          ...playerRef(target),
        };
      }),
      results: event.results.map((result) => {
        requireScalars(result, ["kind", "actionLabel"]);
        // Hidden movement is a count/zone fact. Never propagate a stray identity
        // or deck-position snapshot on this variant, even if it was supplied.
        if (scalar(result, "kind") === "hidden_card_move")
          return {
            ...pick(result, [
              "kind",
              "count",
              "from",
              "to",
              "actionLabel",
              "hiddenReason",
            ]),
            ...playerRef(result),
          };
        return {
          ...pick(result, [
            "kind",
            "definitionIdSnapshot",
            "count",
            "amount",
            "value",
            "zone",
            "from",
            "to",
            "exhaustState",
            "deckPositionSnapshot",
            "deckIndexFromBottomSnapshot",
            "deckCountSnapshot",
            "order",
            "hiddenReason",
            "actionLabel",
            "actionKind",
          ]),
          ...playerRef(result),
        };
      }),
    });
  }
  return { schemaVersion: 1, events };
}
