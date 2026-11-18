import { getCardById } from "../card/card-lookup";
import {
  getEffectiveCardName,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  GameState,
  TriggerEventCause,
  Zone,
} from "../model";
import {
  getEffectTribeGrants,
  type TriggerContext,
} from "./structured-effect-interpreter";

export interface TriggerConditionEventContext {
  eventFacts?: import("../model").TriggerEventFacts;
  relatedInstanceId: string | null;
  effectSourceInstanceId?: string;
  effectSourceInstanceIds?: readonly string[];
  effectSourceDefinitionId?: string;
  fromZone?: Zone;
  physicalFromZone?: Zone;
  cause?: TriggerEventCause;
}

/** 通常登録と付与登録のイベント条件に同じ原因カード・元ゾーンを渡す。 */
export function buildTriggerConditionContext(
  state: GameState,
  event: TriggerConditionEventContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): TriggerContext {
  const relatedCard = event.relatedInstanceId
    ? getCardById(state, event.relatedInstanceId)
    : undefined;
  if (event.eventFacts)
    return {
      ...event.eventFacts.conditionContext,
      ...(event.cause !== undefined ? { cause: event.cause } : {}),
      ...(event.fromZone !== undefined ? { fromZone: event.fromZone } : {}),
      ...(event.physicalFromZone !== undefined
        ? { physicalFromZone: event.physicalFromZone }
        : {}),
      // この句だけは評価時点の場所を見る（02e）。
      ...(relatedCard ? { relatedInstanceZone: relatedCard.zone } : {}),
    };
  const sourceIds = [
    ...new Set([
      ...(event.effectSourceInstanceId ? [event.effectSourceInstanceId] : []),
      ...(event.effectSourceInstanceIds ?? []),
    ]),
  ];
  const source =
    (sourceIds[0] ? getCardById(state, sourceIds[0]) : undefined) ??
    relatedCard;
  const definition = source
    ? getCardDefinitionById(
        sourceIds.length === 1 && source.instanceId === sourceIds[0]
          ? (event.effectSourceDefinitionId ?? source.definitionId)
          : source.definitionId
      )
    : undefined;
  const context: TriggerContext = {
    ...(event.cause !== undefined ? { cause: event.cause } : {}),
    ...(event.fromZone !== undefined ? { fromZone: event.fromZone } : {}),
    ...(event.physicalFromZone !== undefined
      ? { physicalFromZone: event.physicalFromZone }
      : {}),
    ...(relatedCard ? { relatedInstanceZone: relatedCard.zone } : {}),
  };
  if (!source || !definition) return context;
  return {
    ...context,
    sourceColors: getEffectiveColors(state, source, definition),
    sourceTribes: [
      ...new Set([
        ...getEffectiveTribes(state, source, definition, getCardDefinitionById),
        ...getEffectTribeGrants(
          state,
          source.instanceId,
          definition,
          source.controllerPlayerId,
          getCardDefinitionById
        ),
      ]),
    ],
    sourcePlayerId: source.controllerPlayerId,
    sourceInstanceId: source.instanceId,
    sourceCategory: definition.printedCategory,
    sourceCardName: getEffectiveCardName(
      state,
      source,
      definition,
      getCardDefinitionById
    ),
  };
}
