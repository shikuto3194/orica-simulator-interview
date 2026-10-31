import type { CardDefinition, GameState } from "../model";
import type { Effect } from "../dsl-types";
import { getCardById } from "../card/card-lookup";
import { getEventPrintedCategory } from "../mechanics/act-as-spirit";
import { getEffectiveTribes } from "./legal-actions-shared";
import { matchesCardFilter } from "../card/card-filter";
import { getAvailableTokenSummonCountForDef } from "../effect/structured-summon";
import { executeEffect } from "../effect/effect-interpreter";
import { createCardInstance } from "../factories";
import { replaceCardInstances } from "../zone/card-instance-state";

export interface PreCostEffectLookups {
  getRegisteredTriggeredEffectActions?:
    | import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup
    | undefined;
  getRegisteredBurstActions?:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  chainId?: string | undefined;
}

export interface TokenPoolPreCostForcedCombineTrigger {
  tokenCardNo: string;
  tokenDefinition: CardDefinition;
  effect: Effect;
  effectIndex: number;
}

/** relatedTokenCardNos is token-deck inventory; the token's own effects define activation. */
export function findTokenPoolPreCostForcedCombineTrigger(
  state: GameState,
  actingPlayerId: string,
  summonSourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): TokenPoolPreCostForcedCombineTrigger | null {
  const source = getCardById(state, summonSourceInstanceId);
  const definition = source && getCardDefinitionById(source.definitionId);
  if (!source || !definition || source.controllerPlayerId !== actingPlayerId)
    return null;
  const tokenCardNos = new Set(
    state.cardInstances
      .filter((card) => card.ownerPlayerId === actingPlayerId)
      .flatMap(
        (card) =>
          getCardDefinitionById(card.definitionId)?.relatedTokenCardNos ?? []
      )
  );
  for (const tokenCardNo of tokenCardNos) {
    const tokenDefinition = getCardDefinitionById(tokenCardNo);
    if (
      !tokenDefinition ||
      getAvailableTokenSummonCountForDef(
        state,
        actingPlayerId,
        tokenDefinition
      ) <= 0
    )
      continue;
    for (const [effectIndex, effect] of (
      tokenDefinition.effects ?? []
    ).entries()) {
      const timing = effect.timing;
      const zones = [effect.applicability?.zone].flat();
      if (
        !zones.includes("token_pool") ||
        timing.kind !== "game_event" ||
        !timing.beforeCost ||
        timing.event !== "summon" ||
        timing.player !== "self"
      )
        continue;
      if (
        timing.triggerFilter &&
        !matchesCardFilter(source, definition, timing.triggerFilter, {
          state,
          getCardDefinitionById,
          effectiveCategory: getEventPrintedCategory(definition),
          effectiveTribes: getEffectiveTribes(
            state,
            source,
            definition,
            getCardDefinitionById
          ),
        })
      )
        continue;
      return { tokenCardNo, tokenDefinition, effect, effectIndex };
    }
  }
  return null;
}

/** Execute the token's DSL before resuming the interrupted summon declaration/step. */
export function applyTokenPoolPreCostForcedCombineDeclarationSideEffect(
  state: GameState,
  actingPlayerId: string,
  summonSourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  lookups: PreCostEffectLookups = {}
): { state: GameState; combineHostInstanceId: string } | null {
  const trigger = findTokenPoolPreCostForcedCombineTrigger(
    state,
    actingPlayerId,
    summonSourceInstanceId,
    getCardDefinitionById
  );
  if (!trigger) return null;
  // Token-deck copies are materialized only when their effect is invoked. No field entry yet.
  const token = createCardInstance(trigger.tokenDefinition, {
    ownerPlayerId: actingPlayerId,
    zone: "token_pool",
  });
  const result = executeEffect({
    state: replaceCardInstances(state, [...state.cardInstances, token]),
    chainId: `pre-cost:${lookups.chainId ?? summonSourceInstanceId}:${token.instanceId}`,
    sourceInstanceId: token.instanceId,
    actingPlayerId,
    effect: trigger.effect,
    effectIndex: trigger.effectIndex,
    triggerRelatedInstanceId: summonSourceInstanceId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      lookups.getRegisteredTriggeredEffectActions ?? (() => []),
    ...(lookups.getRegisteredBurstActions
      ? { getRegisteredBurstActions: lookups.getRegisteredBurstActions }
      : {}),
  });
  const pending = result.pendingMultiPlacement;
  if (!pending?.directCombineRequirement) return null;
  const { continuation, ...placement } = pending;
  return {
    state: {
      ...result,
      pendingMultiPlacement: {
        ...placement,
        canAbort: false,
        ...(continuation ? { preCostEffectContinuation: continuation } : {}),
        priorStateSnapshot: state,
      },
    },
    combineHostInstanceId: pending.directCombineRequirement.hostInstanceId,
  };
}
