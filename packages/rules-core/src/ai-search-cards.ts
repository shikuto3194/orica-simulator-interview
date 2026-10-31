import type { AiCardToken, AiObservation } from "./ai-observation";
import { searchPlayerResolver } from "./ai-search-observation";

const scalarFields = [
  "zone",
  "zoneRoleName",
  "identityVisibility",
  "cardNoOrUnknown",
  "originalCardNo",
  "faceDown",
  "exhausted",
  "exhaustState",
  "normalCoreCount",
  "soulCoreCount",
  "minimumRequiredCores",
  "pendingLeaveKind",
  "effectiveLevel",
  "effectiveBp",
  "effectiveCategory",
  "combinedUnitBp",
  "underCardCount",
] as const satisfies readonly (keyof AiCardToken)[];

const vectorFields = [
  "effectiveSymbols",
  "effectiveColors",
  "effectiveTribes",
  "combinedUnitSymbols",
] as const satisfies readonly (keyof AiCardToken)[];

const bundleFields = [
  "effectiveSymbolBundles",
  "combinedUnitSymbolBundles",
] as const satisfies readonly (keyof AiCardToken)[];

/** Visible-card component of the future search packet. No live engine IDs.
 * References are local to this one observation and follow its visible order;
 * they are not persistent tracking IDs or a graph-isomorphism canonicalization.
 * Hidden hand/deck cards are represented elsewhere by counts/constraints.
 */
export type AiSearchCard = Pick<
  AiCardToken,
  | (typeof scalarFields)[number]
  | (typeof vectorFields)[number]
  | (typeof bundleFields)[number]
> & {
  cardRef: number;
  owner: "me" | "opp";
  controller: "me" | "opp";
  attachedTo?: number;
  attachedChildren: readonly number[];
  imaginRight?: number | null;
};

// This is a trusted observation adapter, not an arbitrary JSON validator.
// Named data descriptors prevent extra fields/accessors/toJSON from becoming
// serialized state. Never spread a card or pass it to JSON.stringify here.
function data<T extends object, K extends keyof T>(input: T, key: K): T[K] {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor && !("value" in descriptor))
    throw new Error("invalid search card data property");
  return descriptor?.value as T[K];
}

function strings(value: readonly string[] | undefined) {
  if (!Array.isArray(value)) throw new Error("invalid search card vector");
  return Array.from({ length: value.length }, (_, index) => {
    const item = data(value, index);
    if (typeof item !== "string") throw new Error("invalid search card vector");
    return item;
  });
}

/** Input is buildAiObservation's player-mode output. Raw GameState, full/debug
 * observations and missing/dangling/duplicate references fail closed. This
 * component cannot resume an engine: pending/stack/usage, known-deck constraints,
 * historical tracking, request/root candidates and the sampler remain separate.
 */
export function projectAiSearchCards(
  observation: AiObservation
): readonly AiSearchCard[] {
  const relative = searchPlayerResolver(observation);
  if (!Array.isArray(observation.cards))
    throw new Error("missing search card list");
  const refs = new Map<string, number>();
  observation.cards.forEach((card, index) => {
    const id = data(card, "instanceId");
    if (typeof id !== "string" || id.length === 0 || refs.has(id))
      throw new Error("invalid or duplicate search card identity");
    refs.set(id, index);
  });
  const ref = (id: string) => {
    if (typeof id !== "string" || !refs.has(id))
      throw new Error("dangling search card reference");
    return refs.get(id)!;
  };
  return observation.cards.map((card, cardRef) => {
    // These tokens are absent from a normal player observation. Do not turn an
    // accidentally supplied real deck/hidden hand into a searchable card list.
    if (
      data(card, "zone") === "deck" ||
      (data(card, "zone") === "hand" &&
        data(card, "identityVisibility") === "unknown")
    )
      throw new Error("hidden hand/deck cannot enter search cards");
    const projected: Record<string, unknown> = {
      cardRef,
      owner: relative(data(card, "ownerPlayerId")),
      controller: relative(data(card, "controllerPlayerId")),
    };
    for (const field of scalarFields) {
      const value = data(card, field);
      if (value === undefined) continue;
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value))
      )
        throw new Error("invalid search card scalar");
      projected[field] = value;
    }
    for (const field of vectorFields) {
      const value = data(card, field);
      if (value !== undefined) projected[field] = strings(value);
    }
    for (const field of bundleFields) {
      const value = data(card, field);
      if (value !== undefined) {
        if (!Array.isArray(value))
          throw new Error("invalid search card bundles");
        projected[field] = Array.from({ length: value.length }, (_, i) => {
          const bundle = data(value, i);
          const count = data(bundle, "count");
          if (!Number.isSafeInteger(count) || count < 0)
            throw new Error("invalid search card bundle count");
          return { colors: strings(data(bundle, "colors")), count };
        });
      }
    }
    const parent = data(card, "attachedToInstanceId");
    if (parent !== undefined) projected.attachedTo = ref(parent);
    projected.attachedChildren = strings(data(card, "attachedChildrenIds")).map(
      ref
    );
    const right = data(card, "imaginRightCombinedWith");
    if (right !== undefined)
      projected.imaginRight = right === null ? null : ref(right);
    return projected as AiSearchCard;
  });
}
