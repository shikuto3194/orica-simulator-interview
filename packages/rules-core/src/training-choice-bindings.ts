import type { EncodedAiObservation } from "./ai-observation-encoder";
import type { PlayerActionInputOptions } from "./player-decision-contract";
import { coreContainerFromId } from "./core/core-container-id";
import { coreDistributionSoulCoreSourceContainerFromKey } from "./core/core-distribution-flow";
import type { NormalCoreContainer } from "./model";

// A bounded first set of concrete option roles. Unlisted options still use the
// existing field mask; this is not the complete PlayerDecision representation.
export const CHOICE_INPUT_BINDING_FIELDS = [
  "targetInstanceIds",
  "followUpTargetInstanceIds",
  "paymentSources",
  "payCostPaymentSources",
  "summonPaymentSources",
  "coreSourceAllocations",
  "coreDistributionAllocations",
  "coreDistributionSoulCoreAllocations",
  "coreDistributionSourceAllocations",
  "coreDistributionSoulCoreSourceAllocations",
] as const satisfies readonly (keyof PlayerActionInputOptions)[];
export const CHOICE_INPUT_CONTAINERS = [
  "card",
  "reserve",
  "trash",
  "life",
  "void",
] as const;
export const CHOICE_INPUT_DESTINATIONS = ["none", "trash", "void"] as const;
export const CHOICE_INPUT_OWNERS = ["none", "me", "opp"] as const;

export interface TrainingChoiceInputBinding {
  fieldIndex: number;
  containerIndex: number;
  destinationIndex: number;
  ownerIndex: number;
  tokenIndex: number;
  amount: number;
  soul: boolean;
  // Only ordered target selections carry a position. Payment/map entry order
  // is not semantic and must not affect scores or floating-point summation.
  position: number;
}

export const CHOICE_INPUT_BINDING_SCHEMA = {
  version: 2,
  parentAction: "choice.action-or-action_input-node.action",
  fields: CHOICE_INPUT_BINDING_FIELDS,
  containers: CHOICE_INPUT_CONTAINERS,
  destinations: CHOICE_INPUT_DESTINATIONS,
  owners: CHOICE_INPUT_OWNERS,
  ownerPerspective: "decision-actor; card-features-use-none",
  scalars: ["amount/10", "soul", "position/20"],
  card: "observation-card-features-without-identity-string",
  pool: "lexicographic-vector-order/sum-tanh-before-choice-tanh",
};

export function encodeChoiceInputBindings(
  options: PlayerActionInputOptions | undefined,
  observation: EncodedAiObservation,
  context: { actingPlayerId: string; sourcePlayerId: string }
): TrainingChoiceInputBinding[] {
  const bindings: TrainingChoiceInputBinding[] = [];
  function add(
    field: (typeof CHOICE_INPUT_BINDING_FIELDS)[number],
    container: (typeof CHOICE_INPUT_CONTAINERS)[number],
    amount: number,
    soul = false,
    id?: string,
    position = 0,
    destination: (typeof CHOICE_INPUT_DESTINATIONS)[number] = "none",
    ownerPlayerId = context.actingPlayerId
  ) {
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Error("invalid choice input binding amount");
    if (amount === 0) return;
    if (container !== "card" && !ownerPlayerId)
      throw new Error("choice input binding requires a source owner");
    const tokenIndex =
      id === undefined ? -1 : observation.cardInstanceIds.indexOf(id);
    if (
      container === "card" &&
      (tokenIndex < 0 ||
        observation.cardMask[tokenIndex] !== 1 ||
        observation.cards[tokenIndex]?.mask !== 1)
    )
      throw new Error("choice input binding requires an observed card");
    const binding = {
      fieldIndex: CHOICE_INPUT_BINDING_FIELDS.indexOf(field),
      containerIndex: CHOICE_INPUT_CONTAINERS.indexOf(container),
      destinationIndex: CHOICE_INPUT_DESTINATIONS.indexOf(destination),
      ownerIndex:
        container === "card"
          ? 0
          : ownerPlayerId === context.actingPlayerId
            ? 1
            : 2,
      tokenIndex,
      amount,
      soul,
      position,
    };
    const prior = bindings.find(
      (entry) =>
        entry.fieldIndex === binding.fieldIndex &&
        entry.containerIndex === binding.containerIndex &&
        entry.destinationIndex === binding.destinationIndex &&
        entry.ownerIndex === binding.ownerIndex &&
        entry.tokenIndex === binding.tokenIndex &&
        entry.soul === soul &&
        entry.position === position
    );
    if (prior) {
      if (!Number.isSafeInteger(prior.amount + amount))
        throw new Error("invalid choice input binding amount");
      prior.amount += amount;
    } else bindings.push(binding);
  }
  function addContainer(
    field: (typeof CHOICE_INPUT_BINDING_FIELDS)[number],
    container: NormalCoreContainer,
    amount: number,
    soul: boolean
  ) {
    add(
      field,
      container.kind,
      amount,
      soul,
      container.kind === "card" ? container.instanceId : undefined,
      0,
      "none",
      container.kind === "card" ? undefined : container.playerId
    );
  }
  for (const field of [
    "targetInstanceIds",
    "followUpTargetInstanceIds",
  ] as const) {
    Array.from(options?.[field] ?? []).forEach((id, index) =>
      add(field, "card", 1, false, id, index + 1)
    );
  }
  for (const field of [
    "paymentSources",
    "payCostPaymentSources",
    "summonPaymentSources",
  ] as const) {
    for (const source of options?.[field] ?? []) {
      const soul = source.includeSoulCore === true ? 1 : 0;
      const container = source.kind === "card" ? "card" : "reserve";
      const id = source.kind === "card" ? source.instanceId : undefined;
      const destination =
        source.kind === "card" ? (source.destination ?? "trash") : "trash";
      add(field, container, source.amount - soul, false, id, 0, destination);
      add(field, container, soul, true, id, 0, destination);
    }
  }
  for (const field of [
    "coreSourceAllocations",
    "coreDistributionAllocations",
    "coreDistributionSoulCoreAllocations",
    "coreDistributionSourceAllocations",
    "coreDistributionSoulCoreSourceAllocations",
  ] as const) {
    const sourceMap =
      field === "coreDistributionSourceAllocations" ||
      field === "coreDistributionSoulCoreSourceAllocations";
    const soul =
      field === "coreDistributionSoulCoreAllocations" ||
      field === "coreDistributionSoulCoreSourceAllocations";
    for (const [key, amount] of Object.entries(options?.[field] ?? {})) {
      if (amount === 0) continue;
      if (field === "coreSourceAllocations") {
        addContainer(
          field,
          observation.cardInstanceIds.includes(key)
            ? { kind: "card", instanceId: key }
            : key === "reserve"
              ? { kind: "reserve", playerId: context.actingPlayerId }
              : coreContainerFromId(key),
          amount,
          soul
        );
      } else if (sourceMap) {
        const container =
          !soul && key === "void"
            ? { kind: "void" as const, playerId: context.sourcePlayerId }
            : coreDistributionSoulCoreSourceContainerFromKey(
                context.sourcePlayerId,
                key
              );
        if (
          !container ||
          container.kind === "removed_from_game" ||
          (soul && container.kind === "void")
        )
          throw new Error("unsupported choice input binding source");
        addContainer(field, container, amount, soul);
      } else {
        add(field, "card", amount, soul, key);
      }
    }
  }
  return bindings;
}
