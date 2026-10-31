import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type GameState,
  type LegalAction,
} from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const baseLookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => undefined,
};

describe("BSSG01-X05 conditional-cost continuation choice", () => {
  it.each([
    {
      targets: 0,
      reserve: 2,
      sourceCores: 1,
      executable: false,
      variant: "printed",
    },
    {
      targets: 1,
      reserve: 2,
      sourceCores: 1,
      executable: false,
      variant: "printed",
    },
    {
      targets: 2,
      reserve: 2,
      sourceCores: 1,
      executable: true,
      variant: "printed",
    },
    {
      targets: 2,
      reserve: 0,
      sourceCores: 1,
      executable: false,
      variant: "printed",
    },
    {
      targets: 2,
      reserve: 0,
      sourceCores: 3,
      executable: true,
      variant: "printed",
    },
    {
      targets: 2,
      reserve: 1,
      sourceCores: 1,
      executable: true,
      variant: "soul",
    },
    {
      targets: 1,
      reserve: 0,
      sourceCores: 3,
      executable: true,
      variant: "after-level",
    },
    {
      targets: 2,
      reserve: 2,
      sourceCores: 1,
      executable: true,
      variant: "executed-cost",
    },
  ])(
    "targets=$targets reserve=$reserve sourceCores=$sourceCores executable=$executable variant=$variant",
    ({ targets, reserve, sourceCores, executable, variant }) => {
      // A synthetic variant proves a result filter that becomes satisfiable only
      // AFTER paying. It is not a change to the printed card's definition.
      const definitions =
        variant === "after-level" || variant === "executed-cost"
          ? ALL_CARDS.map((card) =>
              card.cardNo !== "BSSG01-X05"
                ? card
                : {
                    ...card,
                    effects: card.effects!.map((effect, index) =>
                      index !== 1
                        ? effect
                        : {
                            ...effect,
                            steps: effect.steps.map((step) =>
                              variant === "executed-cost" &&
                              step.action.kind === "recover"
                                ? {
                                    ...step,
                                    stepCondition: {
                                      kind: "ref_executed" as const,
                                      stepId: "recover_choice",
                                    },
                                  }
                                : step.action.kind !== "recover" ||
                                    step.action.target.kind !== "filter"
                                  ? step
                                  : {
                                      ...step,
                                      action: {
                                        ...step.action,
                                        target: {
                                          ...step.action.target,
                                          filter: {
                                            ...step.action.target.filter,
                                            maxLevel: 3,
                                          },
                                        },
                                      },
                                    }
                            ),
                          }
                    ),
                  }
            )
          : ALL_CARDS;
      const getCardDefinitionById = (id: string) =>
        definitions.find((card) => card.cardNo === id);
      const lookups = {
        ...baseLookups,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
      };
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            {
              reserveNormalCoreCount: reserve,
              soulCoreLocation: {
                kind: variant === "soul" ? "reserve" : "trash",
              },
            },
            {},
          ],
          cardInstances: [
            createCardInstance(getCardDefinitionById("BSSG01-X05")!, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: sourceCores,
              exhaustState:
                variant === "after-level" ? "exhausted" : "recovered",
            }),
            ...["BSSG01-C01", "BSSG01-M01"].slice(0, targets).map((no, i) =>
              createCardInstance(getCardDefinitionById(no)!, {
                instanceId: `recover-${i}`,
                ownerPlayerId: "alice",
                zone: "field",
                normalCoreCount: 1,
                exhaustState: "exhausted",
              })
            ),
          ],
        }),
        activePlayerId: "alice",
        step: "attack",
        turnNumber: 3,
      };
      // The fixture supplies an established advent event. Acceptance, stack,
      // optional choice, payment and target inputs use the public legal path.
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "advent",
            source: "action_resolution",
            chainId: `test:x05-continuation:${targets}:${reserve}:${sourceCores}`,
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "source",
            amount: null,
          },
        ],
        undefined,
        lookups
      );
      const actions = (actor = "alice") =>
        getLegalActions({ state, actingPlayerId: actor, ...lookups });
      const act = (
        action: LegalAction | undefined,
        extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
      ) => {
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...extra,
          ...lookups,
        }).state;
      };
      act(
        actions().find(
          (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
        )
      );
      for (let n = 0; state.stackWindow && n < 6; n++) {
        act(
          actions(state.stackWindow.priorityPlayerId).find(
            (a) => a.kind === "pass_stack"
          )
        );
      }
      expect(state.stackWindow).toBeNull();
      // Continuations must remain correct across persistence boundaries.
      state = JSON.parse(JSON.stringify(state));
      act(
        actions().find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "decline"
        )
      );

      // Availability previews must never spend cores, change exhaustion, or
      // create leave/pending work in the actual returned state.
      expect(state.players[0]!.reserveNormalCoreCount).toBe(reserve);
      expect(state.players[0]!.trashNormalCoreCount).toBe(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")!
          .normalCoreCount
      ).toBe(sourceCores);
      for (let n = 0; n < targets; n++) {
        expect(
          state.cardInstances.find((c) => c.instanceId === `recover-${n}`)
        ).toMatchObject({
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
          pendingLeaveKind: null,
        });
      }
      if (executable) {
        expect(
          state.pendingStepChoice?.choices.map((c) => c.choiceIndex)
        ).toEqual([1]);
        act(actions().find((a) => a.kind === "resolve_pending_step_choice"));
        for (let n = 0; n < 6; n++) {
          const action = actions().find(
            (a) =>
              a.kind === "resolve_core_source_allocation" ||
              a.kind === "resolve_pending_effect_target"
          );
          if (!action) break;
          act(
            action,
            action.kind === "resolve_core_source_allocation"
              ? {
                  coreSourceAllocations:
                    variant === "soul"
                      ? { reserve: 1 }
                      : reserve >= 2
                        ? { reserve: 2 }
                        : { source: 2 },
                  ...(variant === "soul"
                    ? { coreSourceSoulCoreInstanceId: "reserve" }
                    : {}),
                }
              : {
                  targetInstanceIds:
                    variant === "after-level"
                      ? ["source", "recover-0"]
                      : ["recover-0", "recover-1"],
                }
          );
        }
        expect(state.players[0]!.reserveNormalCoreCount).toBe(0);
        expect(state.players[0]!.trashNormalCoreCount).toBe(
          variant === "soul" ? 1 : 2
        );
        expect(state.players[0]!.trashSoulCoreCount).toBe(1);
        expect(
          state.cardInstances.find((c) => c.instanceId === "source")!
            .normalCoreCount
        ).toBe(1);
        for (const id of variant === "after-level"
          ? ["source", "recover-0"]
          : ["recover-0", "recover-1"]) {
          expect(
            state.cardInstances.find((c) => c.instanceId === id)
          ).toMatchObject({
            zone: "field",
            normalCoreCount: 1,
            exhaustState: "recovered",
            pendingLeaveKind: null,
          });
        }
        expect(state.effectUsageRecords).toHaveLength(1);
        expect(
          state.log.filter((l) => l.startsWith("effect:pay_cost:alice:2:"))
        ).toHaveLength(1);
      } else {
        expect(state.log.some((l) => l.startsWith("effect:pay_cost:"))).toBe(
          false
        );
        expect(
          actions().some(
            (a) =>
              a.kind === "resolve_pending_step_choice" ||
              a.kind === "resolve_core_source_allocation"
          )
        ).toBe(false);
      }
      expect(state.pendingStepChoice).toBeNull();
      expect(state.pendingCoreSourceAllocation).toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingTriggeredEffects).toEqual([]);
      expect(state.pendingLeaveEntities).toEqual([]);
    }
  );
});
