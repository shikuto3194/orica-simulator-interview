import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type ContinuousEffect,
  type GameState,
} from "../src";
import {
  placeCardFromZoneToField,
  processMovedToTrashEffects,
} from "../src/effect/structured-effect-interpreter";

const magic = ALL_CARDS.find((c) => c.cardNo === "BSAZ01-C04")!;
const getDef = (id: string) => (id === magic.cardNo ? magic : undefined);
function fixture(
  restrictedKinds: string[] | undefined,
  zone: "hand" | "trash" | "deck" = "trash"
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(magic, {
          instanceId: "magic",
          ownerPlayerId: "alice",
          zone,
        }),
      ],
    }),
    activeContinuousEffects: [
      {
        effectId: "restriction",
        sourceInstanceId: "restriction-source",
        sourceDefinitionId: "restriction-def",
        actingPlayerId: "bob",
        targetInstanceId: "alice",
        modifierTag: "restrict_use",
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        metadata: {
          filter: { category: ["magic"] },
          ...(restrictedKinds ? { restrictedKinds } : {}),
        },
      } as ContinuousEffect,
    ],
  };
}
const fieldZone = (state: GameState) =>
  state.cardInstances.find((c) => c.instanceId === "magic")?.zone;

describe("card-state field placement respects the same restriction on every route", () => {
  it.each(["BSTH01-C01", "BSAZ01-C17"])(
    "effect placement of %s bypasses only normal-use restrictions",
    (cardNo) => {
      const definition = ALL_CARDS.find((c) => c.cardNo === cardNo)!;
      for (const onlyNormalUse of [false, true]) {
        const state = fixture(undefined);
        state.cardInstances = [
          createCardInstance(definition, {
            instanceId: "magic",
            ownerPlayerId: "alice",
            zone: "trash",
          }),
        ];
        state.activeContinuousEffects[0]!.metadata = {
          filter: { category: [definition.printedCategory] },
          onlyNormalUse,
        };
        const result = placeCardFromZoneToField(state, "magic", (id) =>
          id === definition.cardNo ? definition : undefined
        );
        expect(fieldZone(result)).toBe(onlyNormalUse ? "field" : "trash");
      }
    }
  );
  for (const kinds of [undefined, ["summon"], ["magic"], ["put_on_field"]]) {
    const expected = kinds?.includes("put_on_field") ? "trash" : "field";
    it(`search/recovery placement with ${JSON.stringify(kinds)}`, () => {
      expect(
        fieldZone(placeCardFromZoneToField(fixture(kinds), "magic", getDef))
      ).toBe(expected);
    });
    it.each(["deck", "trash"] as const)(
      `search from %s with ${JSON.stringify(kinds)} preserves counts and legal choices`,
      (zone) => {
        for (const candidateCount of [1, 2]) {
          const state = fixture(kinds, zone);
          state.players[0]!.deckCount = zone === "deck" ? candidateCount : 0;
          if (candidateCount === 2)
            state.cardInstances.push(
              createCardInstance(magic, {
                instanceId: "second",
                ownerPlayerId: "alice",
                zone,
              })
            );
          const lookup = (id: string) =>
            id === magic.cardNo ? { ...magic, effects: [] } : undefined;
          let result = executeEffect({
            chainId: "test:field-card-placement-audit:105",
            state,
            sourceInstanceId: "source",
            actingPlayerId: "alice",
            getCardDefinitionById: lookup,
            effect: {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "search_zone",
                    zone,
                    destination: "field",
                    count: 1,
                  },
                },
              ],
            },
          });
          if (kinds?.includes("put_on_field")) {
            expect(result.pendingZoneSelection).toBeNull();
            expect(fieldZone(result)).toBe(zone);
            expect(
              result.log.some((line) => line.startsWith("effect:field_place"))
            ).toBe(false);
          } else {
            if (candidateCount === 2) {
              const action = getLegalActions({
                state: result,
                actingPlayerId: "alice",
                getCardDefinitionById: lookup,
                getRegisteredTriggeredEffectActions: () => [],
                getRegisteredFieldCardEffectActions: () => [],
              }).find((a) => a.kind === "resolve_pending_zone_selection");
              expect(action).toBeDefined();
              result = applyLegalAction({
                state: result,
                action: action!,
                selectedZoneCardIds: ["magic"],
                getCardDefinitionById: lookup,
                getRegisteredTriggeredEffectActions: () => [],
              }).state;
            }
            expect(fieldZone(result)).toBe("field");
          }
          expect(result.players[0]!.deckCount).toBe(
            result.cardInstances.filter((c) => c.zone === "deck").length
          );
        }
      }
    );
    it(`deck reveal field pick with ${JSON.stringify(kinds)}`, () => {
      const state = fixture(kinds, "deck");
      state.players[0]!.deckCount = 1;
      const lookup = (id: string) =>
        id === magic.cardNo ? { ...magic, effects: [] } : undefined;
      let result = executeEffect({
        chainId: "test:field-card-placement-audit:161",
        state,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [{ count: 1, destination: "field" }],
                remainder: "bottom",
              },
            },
          ],
        },
      });
      const action = getLegalActions({
        state: result,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
      if (kinds?.includes("put_on_field")) {
        expect(action).toMatchObject({
          candidateCardInstanceIds: [],
          canSkip: true,
        });
        expect(() =>
          applyLegalAction({
            state: result,
            action: action!,
            selectedDeckRevealCardIds: ["magic"],
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: () => [],
          })
        ).toThrow();
        result = applyLegalAction({
          state: result,
          action: action!,
          selectedDeckRevealCardIds: [],
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
        expect(fieldZone(result)).toBe("deck");
      } else {
        expect(action).toBeDefined();
        result = applyLegalAction({
          state: result,
          action: action!,
          selectedDeckRevealCardIds: ["magic"],
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
        expect(fieldZone(result)).toBe("field");
        expect(
          result.cardInstances.find((c) => c.instanceId === "magic")!
            .normalCoreCount
        ).toBe(0);
      }
      expect(result.players[0]!.deckCount).toBe(
        result.cardInstances.filter((c) => c.zone === "deck").length
      );
    });
    it(`mandatory trash self-placement with ${JSON.stringify(kinds)}`, () => {
      // The general use restriction already prevents this card's automatic effect
      // from starting; a placement-only restriction is checked at its move step.
      expect(
        fieldZone(
          processMovedToTrashEffects(fixture(kinds), ["magic"], getDef, {
            fromZone: "hand",
          })
        )
      ).toBe(kinds === undefined ? "trash" : expected);
    });
    it(`explicit move_self with ${JSON.stringify(kinds)}`, () => {
      expect(
        fieldZone(
          executeEffect({
            chainId: "test:field-card-placement-audit:242",
            state: fixture(kinds),
            sourceInstanceId: "magic",
            actingPlayerId: "alice",
            getCardDefinitionById: getDef,
            effect: {
              timing: { kind: "activated", mode: "main" },
              steps: [{ action: { kind: "move_self", destination: "field" } }],
            },
          })
        )
      ).toBe(expected);
    });
    it.each([false, true])(
      `borrowing cleanup with ${JSON.stringify(kinds)}, deferred=%s`,
      (deferred) => {
        const borrowed: CardDefinition = {
          ...magic,
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: { kind: "count_increase", player: "self", amount: 1 },
                  ...(deferred ? { executionMode: "optional" as const } : {}),
                },
              ],
            },
          ],
        };
        const state = fixture(kinds);
        const source = createCardInstance(
          { ...magic, cardNo: "source" },
          { instanceId: "source", ownerPlayerId: "alice", zone: "field" }
        );
        const lookup = (id: string) =>
          id === magic.cardNo
            ? borrowed
            : id === "source"
              ? { ...magic, cardNo: "source" }
              : undefined;
        let result = executeEffect({
          chainId: "test:field-card-placement-audit:283",
          state: { ...state, cardInstances: [...state.cardInstances, source] },
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          targetInstanceIds: ["magic"],
          getCardDefinitionById: lookup,
          effect: {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "borrow_magic_effect",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: { category: ["magic"] },
                    count: 1,
                  },
                  borrowModes: ["flash"],
                  thenMove: { zone: "field" },
                },
              },
            ],
          },
        });
        if (deferred) {
          expect(result.pendingStepOptionalChoice).not.toBeNull();
          result = applyLegalAction({
            state: result,
            action: {
              kind: "resolve_pending_step_optional_choice",
              pendingId: result.pendingStepOptionalChoice!.pendingId,
              actingPlayerId: "alice",
              choice: "execute",
            },
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: () => [],
          }).state;
          expect(result.pendingStepOptionalChoice).toBeNull();
        }
        expect(result.players[0]?.countValue).toBe(1);
        expect(fieldZone(result)).toBe(expected);
      }
    );
  }
});
