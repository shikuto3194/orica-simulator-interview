import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
describe("qa-055 種類喪失と防止不可", () => {
  it.each([false, true])(
    "一切の効果で防げない=%s の場合の霊夢への破壊",
    (all) => {
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({
          cardInstances: [
            createCardInstance(lookup("BSTH10-X05")!, {
              instanceId: "source",
              ownerPlayerId: "player-1",
              zone: "field",
              normalCoreCount: 1,
            }),
            createCardInstance(lookup("BSTH10-C02")!, {
              instanceId: "reimu",
              ownerPlayerId: "player-2",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        }),
        lookup
      );
      const result = executeEffect({
        chainId: "test:bsth10-category-bypass:33",
        state,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
              },
            },
          ],
        },
        sourceInstanceId: "source",
        actingPlayerId: "player-1",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        sourcePreventionLevel: "unpreventable",
        ...(all
          ? {
              sourcePreventionBypass: { kind: "all_effects" as const },
              sourceTargetLockBypass: { kind: "all_effects" as const },
            }
          : {}),
      });
      const reimu = result.cardInstances.find((c) => c.instanceId === "reimu")!;
      expect(
        reimu.zone === "trash" || reimu.pendingLeaveKind === "destroy",
        JSON.stringify(result.log)
      ).toBe(all);
    }
  );
});
