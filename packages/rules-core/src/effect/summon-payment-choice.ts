import { getCardById } from "../card/card-lookup";
import type { AdditionalCostModifier } from "../core/cost-system";
import {
  getAutomaticNormalCorePaymentSources,
  getAvailableCardCostPaymentSources,
  type CardCostPaymentSource,
} from "../core/payment-system";
import type { CardFilter } from "../dsl-types";
import type {
  CardDefinition,
  EffectTiming,
  GameState,
  SummonAction,
} from "../model";
import { nextPendingSelectionId } from "./structured-effect-sequences";

/** Every effect summon uses the same payment-choice gate before changing the board. */
export function resolveEffectSummonPaymentChoice(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  definition: CardDefinition;
  amount: number;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  paymentSources?: readonly CardCostPaymentSource[] | undefined;
  excludedInstanceIds?: ReadonlySet<string>;
  onBoardCoreSourceFilter?: CardFilter | undefined;
  summonCause?: SummonAction["summonCause"] | undefined;
  additionalCostModifiers?: readonly AdditionalCostModifier[] | undefined;
  effectTiming?: EffectTiming | undefined;
  sourceEffectIndex?: number | undefined;
  preCostCombineHostInstanceId?: string | undefined;
}):
  | { kind: "ready"; paymentSources: readonly CardCostPaymentSource[] }
  | { kind: "pending"; state: GameState }
  | { kind: "unavailable" } {
  if (options.paymentSources !== undefined)
    return { kind: "ready", paymentSources: options.paymentSources };
  if (options.amount === 0) return { kind: "ready", paymentSources: [] };
  const { state, actingPlayerId, sourceInstanceId, definition, amount } =
    options;
  const available = getAvailableCardCostPaymentSources({
    state,
    actingPlayerId,
    card: definition,
    sourceInstanceId: options.targetInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    baseCostOverride: amount,
    useKind: definition.printedCategory === "nexus" ? "place_nexus" : "summon",
    ...(options.summonCause !== undefined
      ? { summonCause: options.summonCause }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: options.onBoardCoreSourceFilter }
      : {}),
  });
  const onBoard = available.onBoardCoreSources.filter(
    (source) => !options.excludedInstanceIds?.has(source.instanceId)
  );
  const soulOnly = available.soulCoreOnlySources.filter(
    (source) => !options.excludedInstanceIds?.has(source.instanceId)
  );
  const boardTotal = onBoard.reduce(
    (sum, source) => sum + source.availableCoreAmount,
    0
  );
  const reserve = available.reserveSource.availableCoreAmount;
  const canPay = options.onBoardCoreSourceFilter
    ? reserve >= amount || boardTotal >= amount
    : reserve + boardTotal >= amount;
  if (!canPay) return { kind: "unavailable" };
  const reserveNormal = state.players.find(
    (player) => player.id === actingPlayerId
  )!.reserveNormalCoreCount;
  const automatic = getAutomaticNormalCorePaymentSources(amount, [
    {
      sourceId: "reserve",
      available: reserve,
      hasSoulCore: reserve > reserveNormal,
    },
    ...onBoard.map((source) => ({
      sourceId: source.instanceId,
      available: source.availableCoreAmount,
      hasSoulCore: source.soulCoreAvailable,
      ...(source.destination ? { destination: source.destination } : {}),
    })),
  ]);
  if (automatic !== null) return { kind: "ready", paymentSources: automatic };
  return {
    kind: "pending",
    state: {
      ...state,
      pendingEffectSummonCostPayment: {
        pendingId: nextPendingSelectionId("escp"),
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId:
          getCardById(state, sourceInstanceId)?.definitionId ??
          definition.cardNo,
        summonTargetInstanceId: options.targetInstanceId,
        summonTargetDefinitionId: definition.cardNo,
        requiredCost: amount,
        availableReserveCoreAmount: reserve,
        availableReserveNormalCoreAmount: Math.min(reserveNormal, reserve),
        availableOnBoardCoreSources: onBoard,
        availableSoulCoreOnlySources: soulOnly,
        effectTiming: options.effectTiming ?? {
          kind: "activated",
          mode: "main",
        },
        ...(options.sourceEffectIndex !== undefined
          ? { sourceEffectIndex: options.sourceEffectIndex }
          : {}),
        ...(options.preCostCombineHostInstanceId !== undefined
          ? {
              preCostCombineHostInstanceId:
                options.preCostCombineHostInstanceId,
            }
          : {}),
      },
      log: [
        ...state.log,
        `effect:summon-cost-payment:pending:${sourceInstanceId}:required=${amount}`,
      ],
    },
  };
}
