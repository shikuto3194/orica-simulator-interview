import { getTotalCoresOnCardById } from "../core/core-system";
import type {
  CardDefinition,
  FieldCoreSourceMinimum,
  GameState,
} from "../model";
import {
  applyEnterFieldCorePlacements,
  getEnterFieldCorePlacementSourceCapacity,
  type EnterFieldCorePlacement,
} from "./enter-field-placement-execution";

/** Declaration, effect previews and automatic placement share the execution source gate. */
export interface EnterFieldCoreSourceOptions {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  excludedFieldSourceIds?: ReadonlySet<string>;
  excludedNormalFieldSourceIds?: ReadonlySet<string>;
  trashNormalCapacity?: number;
  trashGenericCapacity?: number;
  voidNormalCapacity?: number;
  fieldCoreSourceMinimum?: FieldCoreSourceMinimum;
}

export function getEnterFieldCoreSources(
  options: EnterFieldCoreSourceOptions
): EnterFieldCorePlacement[] {
  const player = options.state.players.find(
    (p) => p.id === options.actingPlayerId
  );
  if (!player) return [];
  const normal: EnterFieldCorePlacement[] = [];
  const soul: EnterFieldCorePlacement[] = [];
  const addSoul = (placement: EnterFieldCorePlacement, count: number) => {
    for (let i = 0; i < count; i++) soul.push(placement);
  };
  if (player.reserveNormalCoreCount > 0)
    normal.push({
      kind: "reserve_normal",
      amount: player.reserveNormalCoreCount,
    });
  addSoul({ kind: "reserve_soul" }, player.reserveSoulCoreCount);
  for (const card of options.state.cardInstances) {
    if (options.excludedFieldSourceIds?.has(card.instanceId)) continue;
    const definition = options.getCardDefinitionById(card.definitionId);
    const normalCapacity = getEnterFieldCorePlacementSourceCapacity(
      options.state,
      options.actingPlayerId,
      card,
      definition,
      "normal",
      options.fieldCoreSourceMinimum
    );
    const soulCapacity = getEnterFieldCorePlacementSourceCapacity(
      options.state,
      options.actingPlayerId,
      card,
      definition,
      "soul",
      options.fieldCoreSourceMinimum
    );
    if (
      !options.excludedNormalFieldSourceIds?.has(card.instanceId) &&
      normalCapacity > 0
    ) {
      normal.push({
        kind: "card_normal",
        instanceId: card.instanceId,
        amount: normalCapacity,
      });
    }
    if (soulCapacity > 0) {
      addSoul({ kind: "card_soul", instanceId: card.instanceId }, soulCapacity);
    }
  }
  const trashNormal = Math.min(
    player.trashNormalCoreCount,
    (options.trashNormalCapacity ?? 0) + (options.trashGenericCapacity ?? 0)
  );
  if (trashNormal > 0)
    normal.push({ kind: "trash_normal", amount: trashNormal });
  const genericUsed = Math.max(
    0,
    trashNormal - (options.trashNormalCapacity ?? 0)
  );
  addSoul(
    { kind: "trash_soul" },
    Math.min(
      player.trashSoulCoreCount,
      Math.max(0, (options.trashGenericCapacity ?? 0) - genericUsed)
    )
  );
  const voidNormal = Math.min(
    player.voidNormalCoreCount,
    options.voidNormalCapacity ?? 0
  );
  if (voidNormal > 0) normal.push({ kind: "void_normal", amount: voidNormal });
  return [...normal, ...soul];
}

export function countEnterFieldCoreSources(
  options: EnterFieldCoreSourceOptions
): number {
  let total = 0;
  const fieldAmounts = new Map<string, number>();
  for (const source of getEnterFieldCoreSources(options)) {
    const amount = "amount" in source ? source.amount : 1;
    if (source.kind === "card_normal" || source.kind === "card_soul")
      fieldAmounts.set(
        source.instanceId,
        (fieldAmounts.get(source.instanceId) ?? 0) + amount
      );
    else total += amount;
  }
  for (const [id, amount] of fieldAmounts) {
    const card = options.state.cardInstances.find(
      (candidate) => candidate.instanceId === id
    )!;
    total += Math.min(
      amount,
      getEnterFieldCorePlacementSourceCapacity(
        options.state,
        options.actingPlayerId,
        card,
        options.getCardDefinitionById(card.definitionId),
        "generic",
        options.fieldCoreSourceMinimum
      )
    );
  }
  return total;
}

/** Use the same placement executor as the HUD; failed/redirected moves do not count. */
export function applyAutoEnterFieldCores(
  options: Omit<
    EnterFieldCoreSourceOptions,
    "trashNormalCapacity" | "trashGenericCapacity"
  > & {
    destinationInstanceId: string;
    requiredCores: number;
    trashCoreMax?: number;
    trashCoreKind?: "normal" | "generic";
  }
): {
  state: GameState;
  reserveCores: number;
  fieldCores: number;
  trashCores: number;
} | null {
  const sources = getEnterFieldCoreSources({
    ...options,
    excludedFieldSourceIds: new Set([
      ...(options.excludedFieldSourceIds ?? []),
      options.destinationInstanceId,
    ]),
    trashNormalCapacity:
      options.trashCoreKind === "generic" ? 0 : (options.trashCoreMax ?? 0),
    trashGenericCapacity:
      options.trashCoreKind === "generic" ? (options.trashCoreMax ?? 0) : 0,
  });
  let state = options.state;
  let remaining = options.requiredCores;
  let reserveCores = 0;
  let fieldCores = 0;
  let trashCores = 0;
  for (const source of sources) {
    if (remaining <= 0) break;
    let available = "amount" in source ? source.amount : 1;
    if (source.kind === "card_normal" || source.kind === "card_soul") {
      const card = state.cardInstances.find(
        (candidate) => candidate.instanceId === source.instanceId
      )!;
      available = Math.min(
        available,
        getEnterFieldCorePlacementSourceCapacity(
          state,
          options.actingPlayerId,
          card,
          options.getCardDefinitionById(card.definitionId),
          source.kind === "card_normal" ? "normal" : "soul",
          options.fieldCoreSourceMinimum
        )
      );
    }
    if (available <= 0) continue;
    const placement =
      "amount" in source
        ? { ...source, amount: Math.min(available, remaining) }
        : source;
    const before = getTotalCoresOnCardById(
      state,
      options.destinationInstanceId
    );
    state = applyEnterFieldCorePlacements({
      ...options,
      state,
      placements: [placement],
      allowTrashNormal: (options.trashCoreMax ?? 0) > 0,
      allowTrashSoul: options.trashCoreKind === "generic",
      allowVoidNormal: (options.voidNormalCapacity ?? 0) > 0,
    });
    const moved =
      getTotalCoresOnCardById(state, options.destinationInstanceId) - before;
    remaining -= moved;
    switch (placement.kind) {
      case "reserve_normal":
      case "reserve_soul":
        reserveCores += moved;
        break;
      case "card_normal":
      case "card_soul":
        fieldCores += moved;
        break;
      case "trash_normal":
      case "trash_soul":
        trashCores += moved;
        break;
    }
  }
  return remaining <= 0
    ? { state, reserveCores, fieldCores, trashCores }
    : null;
}
