import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition } from "../src";

const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const lookup = (id: string) => definitions.get(id);
const definition = (id: string) => definitions.get(id)!;

describe("BSTS01 リグルド・ゴブタの軽減", () => {
  for (const cardNo of ["BSTS01-C03", "BSTS01-C04"]) {
    it(`${cardNo}: 印字軽減は緑・緑`, () => {
      expect(definition(cardNo).reductionSymbols).toEqual(["green", "green"]);
    });

    it(`${cardNo}: 青シンボル1つの盤面では、青扱い後も印字由来の緑要求を2つ持つ`, () => {
      const blueSource = createCardInstance(definition("BSTS01-C01"), {
        instanceId: "blue-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const hand = createCardInstance(definition(cardNo), {
        instanceId: "hand",
        ownerPlayerId: "alice",
        zone: "hand",
      });
      const state = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          cardInstances: [blueSource, hand],
        },
        lookup
      );
      const result = calculateReduction({
        state,
        actingPlayerId: "alice",
        card: definition(cardNo),
        sourceInstanceId: hand.instanceId,
        getCardDefinitionById: lookup,
      });
      expect(result.totalReduction).toBe(1);
      expect(result.finalCost).toBe(2);
      expect(result.reductionBreakdown).toEqual(
        expect.arrayContaining([
          { color: "blue", requested: 2, available: 1, applied: 1 },
          { color: "green", requested: 2, available: 0, applied: 0 },
        ])
      );
    });

    for (const role of ["advent_source", "text_role"] as const) {
      it(`${cardNo}: ${role} は独立した軽減シンボルにならない`, () => {
        // 2026-09-16 snapshot: C01 の下に CX01、attachedToInstanceId は null。
        const host = createCardInstance(definition("BSTS01-C01"), {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        });
        const under = createCardInstance(definition("BSTS01-CX01"), {
          instanceId: "under",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        });
        host.underCards = [{ cardInstanceId: under.instanceId, role }];
        const hand = createCardInstance(definition(cardNo), {
          instanceId: "hand",
          ownerPlayerId: "alice",
          zone: "hand",
        });
        const state = rebuildContinuousEffectsFromField(
          {
            ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
            cardInstances: [host, under, hand],
          },
          lookup
        );
        const result = calculateReduction({
          state,
          actingPlayerId: "alice",
          card: definition(cardNo),
          sourceInstanceId: hand.instanceId,
          getCardDefinitionById: lookup,
        });
        expect(
          result.fieldSymbolSources.map((source) => source.sourceInstanceId)
        ).toEqual(["host"]);
        expect(result.totalReduction).toBe(1);
        expect(result.finalCost).toBe(2);
      });
    }
  }
});
