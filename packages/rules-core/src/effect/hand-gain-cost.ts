import { getCardById } from "../card/card-lookup";
import {
  applyCardCostPayments,
  getAutomaticNormalCorePaymentSources,
  assertPaymentSourcesAreAvailable,
  getAvailableCardCostPaymentSources,
  getTotalPaymentAmount,
  type CardCostPaymentSource,
} from "../core/payment-system";
import type {
  CardDefinition,
  CardInstance,
  EffectTiming,
  GameState,
  Zone,
} from "../model";
import { getHandGainCostGateAmount } from "./effect-resistance-check";
import { nextCoreSourceAllocationId } from "./structured-effect-sequences";

/** 手札増加対価の対象・支払い・拒否の正源。カードの耐性では免除しない。 */
export function getOwnEffectHandGainCost(
  state: GameState,
  recipientPlayerId: string,
  effectPlayerId: string
): number {
  return recipientPlayerId === effectPlayerId
    ? getHandGainCostGateAmount(state, recipientPlayerId)
    : 0;
}

export function getZoneMoveHandGainCost(
  state: GameState,
  recipientPlayerId: string,
  effectPlayerId: string,
  cards: readonly Pick<CardInstance, "zone">[],
  destination: string
): number {
  return destination === "hand" &&
    cards.some(
      (card) =>
        card.zone === "deck" ||
        card.zone === "trash" ||
        card.zone === "revealed"
    )
    ? getOwnEffectHandGainCost(state, recipientPlayerId, effectPlayerId)
    : 0;
}

export interface HandGainCostSource {
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinitionId?: string;
}

function paymentDefinition(
  state: GameState,
  source: HandGainCostSource,
  getDefinition: (id: string) => CardDefinition | undefined
) {
  const card = getDefinition(
    source.sourceDefinitionId ??
      getCardById(state, source.sourceInstanceId)?.definitionId ??
      ""
  );
  if (!card)
    throw new Error(
      `Missing hand gain effect source: ${source.sourceInstanceId}`
    );
  return card;
}

export function getHandGainCostPaymentSources(
  state: GameState,
  source: HandGainCostSource,
  getDefinition: (id: string) => CardDefinition | undefined
) {
  return getAvailableCardCostPaymentSources({
    state,
    actingPlayerId: source.actingPlayerId,
    card: paymentDefinition(state, source, getDefinition),
    getCardDefinitionById: getDefinition,
  });
}

/** 空の支払いは拒否。省略できるのは通常コアの支払元が一意な場合だけ。 */
export function payHandGainCost(
  state: GameState,
  source: HandGainCostSource,
  amount: number,
  getDefinition: (id: string) => CardDefinition | undefined,
  selectedSources?: readonly CardCostPaymentSource[]
): { state: GameState; canGain: boolean } {
  if (amount <= 0) return { state, canGain: true };
  if (selectedSources?.length === 0)
    return {
      state: {
        ...state,
        log: [
          ...state.log,
          `effect:hand-gain:blocked-by-hand-gain-cost:${source.actingPlayerId}`,
        ],
      },
      canGain: false,
    };
  const available = getHandGainCostPaymentSources(state, source, getDefinition);
  const player = state.players.find((p) => p.id === source.actingPlayerId)!;
  const paymentSources =
    selectedSources ??
    getAutomaticNormalCorePaymentSources(amount, [
      {
        sourceId: "reserve",
        available: available.reserveSource.availableCoreAmount,
        hasSoulCore:
          available.reserveSource.availableCoreAmount >
          player.reserveNormalCoreCount,
      },
      ...available.onBoardCoreSources.map((s) => ({
        sourceId: s.instanceId,
        available: s.availableCoreAmount,
        hasSoulCore: s.soulCoreAvailable,
        ...(s.destination ? { destination: s.destination } : {}),
      })),
    ]);
  if (!paymentSources || getTotalPaymentAmount(paymentSources) !== amount)
    throw new Error(
      "Hand gain blocked by hand_gain_cost_gate: payment does not match required cost"
    );
  assertPaymentSourcesAreAvailable({
    paymentSources,
    availableReserveCoreAmount: available.reserveSource.availableCoreAmount,
    availableOnBoardCoreSources: available.onBoardCoreSources,
  });
  return {
    state: applyCardCostPayments({
      state,
      actingPlayerId: source.actingPlayerId,
      paymentSources,
      chainId: `hand-gain-cost:${source.sourceInstanceId}`,
      getCardDefinitionById: getDefinition,
    }),
    canGain: true,
  };
}

export interface HandGainCostExecutionOptions {
  coreSourceAllocations?: Record<string, number> | undefined;
  coreSourceSoulCoreInstanceId?: string | undefined;
  effectTiming?: EffectTiming | undefined;
}

/** 対象確定後、移動前に通常コストHUDへ中断する。同じstepの再実行で支払いを確定。 */
export function resolveZoneMoveHandGainCost(
  state: GameState,
  source: HandGainCostSource,
  recipientPlayerId: string,
  cards: readonly Pick<CardInstance, "zone">[],
  destination: Zone,
  getDefinition: (id: string) => CardDefinition | undefined,
  options: HandGainCostExecutionOptions = {}
): { state: GameState; canGain: boolean } {
  const amount = getZoneMoveHandGainCost(
    state,
    recipientPlayerId,
    source.actingPlayerId,
    cards,
    destination
  );
  if (amount <= 0) return { state, canGain: true };
  const allocations = options.coreSourceAllocations;
  const soulSourceId = options.coreSourceSoulCoreInstanceId;
  if (allocations !== undefined) {
    const ids = new Set(Object.keys(allocations));
    if (soulSourceId) ids.add(soulSourceId);
    const paymentSources = [...ids].flatMap((id): CardCostPaymentSource[] => {
      const includeSoulCore = soulSourceId === id;
      const paid = (allocations[id] ?? 0) + Number(includeSoulCore);
      return paid <= 0
        ? []
        : [
            id === "reserve"
              ? { kind: "reserve", amount: paid, includeSoulCore }
              : { kind: "card", instanceId: id, amount: paid, includeSoulCore },
          ];
    });
    return payHandGainCost(
      state,
      source,
      amount,
      getDefinition,
      paymentSources
    );
  }
  const available = getHandGainCostPaymentSources(state, source, getDefinition);
  const player = state.players.find((p) => p.id === recipientPlayerId)!;
  return {
    canGain: false,
    state: {
      ...state,
      pendingCoreSourceAllocation: {
        pendingId: nextCoreSourceAllocationId(),
        actingPlayerId: recipientPlayerId,
        sourceInstanceId: source.sourceInstanceId,
        sourceDefinitionId: paymentDefinition(state, source, getDefinition)
          .cardNo,
        canDecline: true,
        requiredTotal: amount,
        toLocation: { kind: "trash", player: "self" },
        effectTiming: options.effectTiming ?? {
          kind: "activated",
          mode: "main",
        },
        candidates: [
          ...(available.reserveSource.availableCoreAmount > 0
            ? [
                {
                  instanceId: "reserve",
                  available: available.reserveSource.availableCoreAmount,
                  normalAvailable: player.reserveNormalCoreCount,
                  hasSoulCore:
                    available.reserveSource.availableCoreAmount >
                    player.reserveNormalCoreCount,
                },
              ]
            : []),
          ...available.onBoardCoreSources.map((s) => ({
            instanceId: s.instanceId,
            available: s.availableCoreAmount,
            normalAvailable:
              s.availableCoreAmount - Number(s.soulCoreAvailable),
            hasSoulCore: s.soulCoreAvailable,
          })),
        ],
      },
    },
  };
}
