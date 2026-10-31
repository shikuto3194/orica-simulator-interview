import {
  applyLegalAction,
  getLegalActions,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type GameState,
} from "../../src/runtime";
import { generateActionInputChoices } from "../../src/action-input-choices";
import { getEnterFieldCoreSources } from "../../src/zone/enter-field-core-sources";
import {
  applyEnterFieldCorePlacements,
  type EnterFieldCorePlacement,
} from "../../src/zone/enter-field-placement-execution";
import { executeEffect } from "../../src/effect/effect-interpreter";

export function executeEffectWithChosenMinimumCores(
  options: Parameters<typeof executeEffect>[0]
): GameState {
  return finishCoreChoices(
    executeEffect(options),
    options.getCardDefinitionById,
    {
      ...(options.getRegisteredTriggeredEffectActions
        ? {
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
          }
        : {}),
      ...(options.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
    }
  );
}

/** Board-focused tests explicitly act as a player: choose minimum placements, preferring normal reserve cores. */
export function finishCoreChoices(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  lookups: Partial<
    Pick<
      ApplyLegalActionOptions,
      "getRegisteredTriggeredEffectActions" | "getRegisteredBurstActions"
    >
  > = {}
): GameState {
  for (let round = 0; round < 20; round++) {
    const combine = state.pendingBraveCombineChoice;
    if (combine?.multiPlacementPendingId) {
      const choices = getLegalActions({
        state,
        actingPlayerId: combine.actingPlayerId,
        getCardDefinitionById,
      }).filter((action) => action.kind === "resolve_brave_combine_choice");
      // Board-focused tests retain spirit state when affordable, then choose cores.
      const action =
        choices.find((choice) => choice.chosenHostInstanceId === null) ??
        choices[0];
      if (!action) throw new Error("No legal field-entry brave choice");
      state = applyLegalAction({
        getRegisteredTriggeredEffectActions: () => [],
        ...lookups,
        state,
        action,
        getCardDefinitionById,
      }).state;
      continue;
    }
    const pending =
      state.pendingMultiPlacement ?? state.pendingEffectSummonCostPayment;
    if (!pending) return state;
    const action = getLegalActions({
      state,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById,
    }).find(
      (candidate) =>
        candidate.kind ===
        (state.pendingMultiPlacement
          ? "resolve_pending_multi_placement"
          : "resolve_pending_effect_summon_cost_payment")
    )!;
    let inputs: Partial<ApplyLegalActionOptions>;
    if (state.pendingMultiPlacement) {
      const placement = state.pendingMultiPlacement;
      let preview = state;
      let trashNormal = placement.trashNormalCoreMax ?? 0;
      let trashGeneric = placement.trashCoreMax ?? 0;
      const allocations = placement.targets.map((target) => {
        let remaining = target.minimumCoreCount;
        const placements: EnterFieldCorePlacement[] = [];
        for (const source of getEnterFieldCoreSources({
          state: preview,
          actingPlayerId: pending.actingPlayerId,
          getCardDefinitionById,
          excludedFieldSourceIds: new Set(
            placement.excludedFieldSourceIds ??
              placement.targets.map((item) => item.instanceId)
          ),
          trashNormalCapacity: trashNormal,
          trashGenericCapacity: trashGeneric,
          voidNormalCapacity: target.voidNormalCoreMax ?? 0,
          ...(placement.fieldCoreSourceMinimum
            ? { fieldCoreSourceMinimum: placement.fieldCoreSourceMinimum }
            : {}),
        })) {
          if (remaining === 0) break;
          const amount = Math.min(
            remaining,
            "amount" in source ? source.amount : 1
          );
          placements.push("amount" in source ? { ...source, amount } : source);
          remaining -= amount;
          if (source.kind === "trash_normal") {
            const normal = Math.min(trashNormal, amount);
            trashNormal -= normal;
            trashGeneric -= amount - normal;
          } else if (source.kind === "trash_soul") trashGeneric--;
        }
        if (remaining > 0)
          throw new Error(
            `No legal minimum placement for ${target.instanceId}`
          );
        preview = applyEnterFieldCorePlacements({
          state: preview,
          actingPlayerId: pending.actingPlayerId,
          destinationInstanceId: target.instanceId,
          placements,
          getCardDefinitionById,
          allowTrashNormal: true,
          allowTrashSoul: true,
          allowVoidNormal: true,
        });
        return { destinationInstanceId: target.instanceId, placements };
      });
      inputs = { multiPlacementAllocations: allocations };
    } else {
      const choices = generateActionInputChoices(
        state,
        action,
        { getCardDefinitionById },
        256
      ).values;
      const score = (input: Partial<ApplyLegalActionOptions>) =>
        (input.summonPaymentSources ?? []).reduce(
          (sum, source) =>
            sum +
            (source.kind === "reserve" ? 0 : source.amount) +
            (source.includeSoulCore ? 100 : 0),
          0
        );
      inputs = choices.sort((a, b) => score(a) - score(b))[0] ?? {};
    }
    state = applyLegalAction({
      getRegisteredTriggeredEffectActions: () => [],
      ...lookups,
      state,
      action,
      getCardDefinitionById,
      ...inputs,
    }).state;
  }
  throw new Error("Core choice continuation did not finish");
}
