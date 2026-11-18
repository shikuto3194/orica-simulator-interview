import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateActionInputChoices,
  type GameState,
} from "@orica/rules-core";
import {
  applyChosenAction,
  buildEngine,
  legalActionsFor,
  resolveActionInputs,
} from "./selfplay-driver";

describe.each([
  { reserve: 0, discardCount: 4 },
  { reserve: 1, discardCount: 3 },
])(
  "selfplay variable zone-discount payment reserve=$reserve/discards=$discardCount",
  ({ reserve, discardCount }) => {
    it("retains a complete Rain payment across C12's pre-cost interruption", () => {
      const engine = buildEngine();
      const c12 = engine.getCardDefinitionById("BSAZ01-C12")!;
      const rain = engine.getCardDefinitionById("BSAZ03-M01")!;
      const discards = [
        "BSTH001-R01",
        "BSAZ02-C17",
        "BSLH01-C12",
        "BSTH09-X03",
      ].slice(0, discardCount);
      const discardIds = discards.map((_, i) => `discard-${i}`);
      const continuous = c12.effects!.find(
        (effect) =>
          effect.timing.kind === "continuous" &&
          effect.steps.some(
            (step) => step.action.kind === "offer_magic_pre_cost_trigger"
          )
      )!;
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            {
              reserveNormalCoreCount: reserve,
              reserveSoulCoreCount: 0,
              handCount: 1 + discards.length,
            },
            {},
          ],
          cardInstances: [
            createCardInstance(c12, {
              instanceId: "c12",
              ownerPlayerId: "alice",
              zone: "field",
              zoneRoleName: "magic",
            }),
            createCardInstance(rain, {
              instanceId: "rain",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
            createCardInstance(engine.getCardDefinitionById("BSTH04-C12")!, {
              instanceId: "borrowable",
              ownerPlayerId: "alice",
              zone: "trash",
            }),
            ...discards.map((cardNo, i) =>
              createCardInstance(engine.getCardDefinitionById(cardNo)!, {
                instanceId: discardIds[i]!,
                ownerPlayerId: "alice",
                zone: "hand",
              })
            ),
          ],
        }),
        activePlayerId: "alice",
        turnNumber: 3,
        step: "main",
        window: "none",
      };
      state = executeEffect({
        chainId: "test:selfplay-variable-zone-payment",
        state,
        effect: continuous,
        sourceInstanceId: "c12",
        actingPlayerId: "alice",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      const action = legalActionsFor(state, engine).actions.find(
        (candidate) =>
          candidate.kind === "use_magic" &&
          candidate.sourceInstanceId === "rain" &&
          candidate.costMode === "zone_discount_variable"
      );
      if (!action) throw new Error("missing variable-discard Rain action");
      expect(action).toMatchObject({
        reducedCost: 4,
        finalCost: reserve,
        preCostTriggerOffer: { sourceInstanceId: "c12" },
      });
      const completeInput = {
        selectedZoneCardIds: discardIds,
        paymentSources: reserve === 0 ? [] : [{ kind: "reserve", amount: 1 }],
      };
      for (const limit of [1, 128]) {
        expect(
          generateActionInputChoices(
            state,
            action,
            { getCardDefinitionById: engine.getCardDefinitionById },
            limit
          )
        ).toEqual({ values: [completeInput], truncated: false, limit });
      }
      expect(
        resolveActionInputs(state, action, engine.getCardDefinitionById)
      ).toEqual(completeInput);

      const intercepted = applyChosenAction(state, action, engine);
      expect(intercepted.pendingFieldMagicPreCostTrigger).not.toBeNull();
      expect(intercepted.players[0]?.reserveNormalCoreCount).toBe(reserve);
      expect(
        intercepted.cardInstances
          .filter((card) => discardIds.includes(card.instanceId))
          .every((card) => card.zone === "hand")
      ).toBe(true);
      const decline = legalActionsFor(intercepted, engine).actions.find(
        (candidate) => candidate.kind === "resolve_field_magic_pre_cost_trigger"
      );
      if (!decline) throw new Error("missing pre-cost trigger decision");
      expect(
        resolveActionInputs(intercepted, decline, engine.getCardDefinitionById)
          .fieldMagicPreCostTriggerDecision
      ).toBe("decline");
      const resumed = applyChosenAction(intercepted, decline, engine);
      expect(resumed.pendingFieldMagicPreCostTrigger).toBeNull();
      expect(resumed.stackWindow).not.toBeNull();
      expect(
        resumed.cardInstances.find((card) => card.instanceId === "rain")?.zone
      ).toBe("in_use");
      expect(
        resumed.cardInstances.find((card) => card.instanceId === "c12")?.zone
      ).toBe("field");
      expect(
        resumed.cardInstances
          .filter((card) => discardIds.includes(card.instanceId))
          .every((card) => card.zone === "trash")
      ).toBe(true);
      expect(resumed.players[0]?.reserveNormalCoreCount).toBe(0);
      expect(resumed.players[0]?.handCount).toBe(0);
    });
  }
);
