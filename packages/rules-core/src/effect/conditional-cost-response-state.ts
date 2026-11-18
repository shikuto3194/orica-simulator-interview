import {
  getAdditionalSoulCoreCountAtLocation,
  getNormalCoreCountAtLocation,
  moveNormalCores,
  refundAdditionalSoulCores,
  withSoulCoreLocation,
} from "../core/core-system";
import type { GameState, NormalCoreContainer } from "../model";
import { replaceCardInstances } from "../zone/card-instance-state";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function keyedRows(rows: readonly unknown[], key: string) {
  const result = new Map<string, unknown>();
  for (const row of rows) {
    const id = record(row)?.[key];
    if (typeof id !== "string" || result.has(id)) return undefined;
    result.set(id, row);
  }
  return result;
}

function rebaseValue(
  beforeCost: unknown,
  paid: unknown,
  afterResponse: unknown
): unknown {
  if (Object.is(beforeCost, paid)) return afterResponse;
  if (Object.is(paid, afterResponse)) return beforeCost;
  if (
    typeof beforeCost === "number" &&
    typeof paid === "number" &&
    typeof afterResponse === "number"
  ) {
    return afterResponse + (beforeCost - paid);
  }
  if (
    Array.isArray(beforeCost) &&
    Array.isArray(paid) &&
    Array.isArray(afterResponse)
  ) {
    for (const key of [
      "instanceId",
      "playerId",
      "id",
      "effectId",
      "operationId",
      "pendingId",
      "cardInstanceId",
    ]) {
      const beforeRows = keyedRows(beforeCost, key);
      const paidRows = keyedRows(paid, key);
      const responseRows = keyedRows(afterResponse, key);
      if (!beforeRows || !paidRows || !responseRows) continue;
      const restored = new Map<string, unknown>();
      for (const [id, row] of responseRows) {
        if (!paidRows.has(id)) restored.set(id, row);
        else if (beforeRows.has(id)) {
          restored.set(
            id,
            rebaseValue(beforeRows.get(id), paidRows.get(id), row)
          );
        }
      }
      for (const [id, row] of beforeRows) {
        if (!paidRows.has(id) && !restored.has(id)) restored.set(id, row);
      }
      return [...restored.values()];
    }
    const paidSerialized = paid.map((value) => JSON.stringify(value));
    const beforeSerialized = beforeCost.map((value) => JSON.stringify(value));
    const responseSerialized = afterResponse.map((value) =>
      JSON.stringify(value)
    );
    if (
      paidSerialized.length === beforeSerialized.length &&
      paidSerialized.every((value, i) => value === beforeSerialized[i])
    )
      return afterResponse;
    if (
      paidSerialized.length <= responseSerialized.length &&
      paidSerialized.every((value, i) => value === responseSerialized[i])
    ) {
      return [...beforeCost, ...afterResponse.slice(paid.length)];
    }
    return afterResponse;
  }
  const beforeObject = record(beforeCost);
  const paidObject = record(paid);
  const responseObject = record(afterResponse);
  if (beforeObject && paidObject && responseObject) {
    const restored = { ...responseObject };
    for (const key of new Set([
      ...Object.keys(beforeObject),
      ...Object.keys(paidObject),
    ])) {
      const value = rebaseValue(
        beforeObject[key],
        paidObject[key],
        responseObject[key]
      );
      if (value === undefined) delete restored[key];
      else restored[key] = value;
    }
    return restored;
  }
  return afterResponse;
}

/**
 * Rebase the clause's pre-payment snapshot across a completed disclosure
 * response. Card/player/CE records are matched by identity, including after a
 * serialized resume, rather than assuming the response left their order intact.
 */
export function rebaseConditionalCostRollback(
  beforeCost: GameState,
  paidAtDisclosure: GameState,
  afterResponse: GameState
): GameState {
  const restored = rebaseValue(
    beforeCost,
    paidAtDisclosure,
    afterResponse
  ) as GameState;
  const playersAfter = new Map(
    afterResponse.players.map((player) => [player.id, player])
  );
  const cardsAfter = new Map(
    afterResponse.cardInstances.map((card) => [card.instanceId, card])
  );
  const beforeCards = new Map(
    beforeCost.cardInstances.map((card) => [card.instanceId, card])
  );
  const locations: NormalCoreContainer[] = [
    ...beforeCost.players.flatMap(({ id }) =>
      (["life", "reserve", "trash", "void"] as const).map((kind) => ({
        kind,
        playerId: id,
      }))
    ),
    ...beforeCost.cardInstances.map(({ instanceId }) => ({
      kind: "card" as const,
      instanceId,
    })),
  ];
  const debits: { from: NormalCoreContainer; remaining: number }[] = [];
  const credits: { to: NormalCoreContainer; remaining: number }[] = [];
  for (const location of locations) {
    if (location.kind === "card" && !cardsAfter.has(location.instanceId))
      continue;
    const delta =
      getNormalCoreCountAtLocation(beforeCost, location) -
      getNormalCoreCountAtLocation(paidAtDisclosure, location);
    if (delta < 0) debits.push({ from: location, remaining: -delta });
    if (delta > 0) {
      const card =
        location.kind === "card"
          ? restored.cardInstances.find(
              (entry) => entry.instanceId === location.instanceId
            )
          : undefined;
      const payer =
        card && beforeCards.get(card.instanceId)?.controllerPlayerId;
      credits.push({
        to:
          card && payer && card.zone !== "field"
            ? { kind: "reserve", playerId: payer }
            : location,
        remaining: delta,
      });
    }
  }
  // Restore semantic records independently of physical cores. Reverse physical
  // moves on the actual balances after the response, using the core primitives.
  const { cardInstances, players, ...restoredRecords } = restored;
  let result = replaceCardInstances(
    {
      ...afterResponse,
      ...restoredRecords,
      players: players.map((player) => {
        const live = playersAfter.get(player.id)!;
        return {
          ...player,
          reserveNormalCoreCount: live.reserveNormalCoreCount,
          trashNormalCoreCount: live.trashNormalCoreCount,
          voidNormalCoreCount: live.voidNormalCoreCount,
          lifeNormalCoreCount: live.lifeNormalCoreCount,
          soulCoreLocation: live.soulCoreLocation,
          reserveSoulCoreCount: live.reserveSoulCoreCount,
          trashSoulCoreCount: live.trashSoulCoreCount,
          lifeSoulCoreCount: live.lifeSoulCoreCount,
        };
      }),
    },
    cardInstances.map((card) => ({
      ...card,
      normalCoreCount: cardsAfter.get(card.instanceId)?.normalCoreCount ?? 0,
      soulCoreCount: cardsAfter.get(card.instanceId)?.soulCoreCount ?? 0,
    }))
  );
  for (const debit of debits) {
    let available = Math.min(
      debit.remaining,
      getNormalCoreCountAtLocation(result, debit.from)
    );
    for (const credit of credits) {
      const amount = Math.min(available, credit.remaining);
      if (amount <= 0) continue;
      const moved = moveNormalCores(result, debit.from, credit.to, amount);
      if (moved === result) continue;
      result = moved;
      available -= amount;
      credit.remaining -= amount;
    }
  }
  for (const player of beforeCost.players) {
    const paid = paidAtDisclosure.players.find(({ id }) => id === player.id);
    const live = playersAfter.get(player.id);
    const original = player.soulCoreLocation;
    if (
      !paid ||
      !live ||
      JSON.stringify(paid.soulCoreLocation) === JSON.stringify(original) ||
      JSON.stringify(live.soulCoreLocation) !==
        JSON.stringify(paid.soulCoreLocation)
    )
      continue;
    const refundLocation =
      original?.kind === "card" &&
      result.cardInstances.find(
        (card) => card.instanceId === original.instanceId
      )?.zone !== "field"
        ? { kind: "reserve" as const }
        : original;
    result = withSoulCoreLocation(result, player.id, refundLocation);
  }
  for (const { id: playerId } of beforeCost.players) {
    const containers = [
      ...(["life", "reserve", "trash"] as const).map((kind) => ({
        kind,
        playerId,
      })),
      ...beforeCost.cardInstances
        .filter(
          (card) =>
            card.controllerPlayerId === playerId &&
            cardsAfter.has(card.instanceId)
        )
        .map(({ instanceId }) => ({ kind: "card" as const, instanceId })),
    ];
    type Container = (typeof containers)[number];
    const debits: { from: Container; amount: number }[] = [];
    const credits: { to: Container; amount: number }[] = [];
    for (const location of containers) {
      const delta =
        getAdditionalSoulCoreCountAtLocation(beforeCost, location) -
        getAdditionalSoulCoreCountAtLocation(paidAtDisclosure, location);
      if (delta < 0) debits.push({ from: location, amount: -delta });
      if (delta > 0) {
        const liveCard =
          location.kind === "card"
            ? cardsAfter.get(location.instanceId)
            : undefined;
        credits.push({
          to:
            liveCard && liveCard.zone !== "field"
              ? { kind: "reserve", playerId }
              : location,
          amount: delta,
        });
      }
    }
    for (const debit of debits) {
      for (const credit of credits) {
        const refund = refundAdditionalSoulCores(
          result,
          debit.from,
          credit.to,
          Math.min(debit.amount, credit.amount)
        );
        result = refund.state;
        credit.amount -= refund.moved;
        debit.amount -= refund.moved;
      }
    }
  }
  return result;
}
