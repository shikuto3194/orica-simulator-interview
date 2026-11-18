import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, GameState } from "../src/model";
import {
  executeRefSummon,
  executeSummonSelf,
  executeSummonOther,
} from "../src/effect/structured-summon";
import { placeCardFromZoneToField } from "../src/effect/structured-effect-interpreter";
import { canAutoExecuteSummonFromZoneCandidateSequence } from "../src/effect/summon-from-zone-candidates";
import { executeReverseRebirth } from "../src/effect/structured-card-replacement";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((d) => [d.cardNo, d])
);
const entrant: CardDefinition = {
  ...definitions.get("BSTH01-C01")!,
  cardNo: "AUDIT-ENTRANT",
  name: "維持コア選択用",
  cost: 1,
  printedCategory: "spirit",
  keywordTags: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 10 } },
      ],
    },
  ],
};
definitions.set(entrant.cardNo, entrant);
const lookup = (id: string) => definitions.get(id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: (id: string) => {
    const def = lookup(id);
    return def ? generateTriggeredEffectRegistrations(def) : [];
  },
};
function actions(state: GameState, player = "alice") {
  return getLegalActions({ state, actingPlayerId: player, ...options });
}

describe("effect entry core choice audit", () => {
  it.each([0, 1])(
    "effect separation chooses cores without emitting entry events (minimum=%i)",
    (minimum) => {
      const braveDef: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-SEPARATION-BRAVE",
        printedCategory: "brave",
        levelDefs: [{ level: 1, requiredCores: minimum, bp: 1000 }],
        effects: ["summon", "place"].map((event) => ({
          timing: { kind: "card_event", event: event as "summon" | "place" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 10 } },
          ],
        })),
      };
      definitions.set(braveDef.cardNo, braveDef);
      const state = executeEffect({
        state: createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(entrant, {
              instanceId: "host",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 3,
              attachedChildrenIds: ["separated"],
            }),
            createCardInstance(braveDef, {
              instanceId: "separated",
              ownerPlayerId: "alice",
              zone: "field",
              attachedToInstanceId: "host",
            }),
          ],
          playerOverrides: [
            { reserveNormalCoreCount: 2, reserveSoulCoreCount: 1 },
            {},
          ],
        }),
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        chainId: "audit:separation",
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "brave_separate_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["brave"] },
                  count: 1,
                },
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
        targetInstanceIds: ["separated"],
        ...options,
      });
      expect(state.players[0]!.reserveNormalCoreCount).toBe(2);
      expect(state.players[0]!.countValue).toBe(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "separated")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: null,
        normalCoreCount: 0,
      });
      expect(state.pendingMultiPlacement?.targets).toMatchObject([
        {
          instanceId: "separated",
          minimumCoreCount: minimum,
          enterFieldEventKind: null,
        },
      ]);
      const after = applyLegalAction({
        state,
        action: actions(state).find(
          (a) => a.kind === "resolve_pending_multi_placement"
        )!,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "separated",
            placements: [{ kind: "reserve_soul" }],
          },
        ],
        ...options,
      }).state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "separated")
          ?.soulCoreCount
      ).toBe(1);
      expect(after.players[0]!.reserveNormalCoreCount).toBe(2);
      expect(after.players[0]!.countValue).toBe(1);
      expect(
        after.pendingTriggeredEffects.filter(
          (p) =>
            p.relatedInstanceId === "separated" &&
            (p.eventKind === "summon" || p.eventKind === "place")
        )
      ).toHaveLength(0);
      expect(
        (after.publicDisclosures ?? []).filter(
          (entry) =>
            entry.kind === "zone_moved" &&
            entry.results.some((result) => result.instanceId === "separated")
        )
      ).toHaveLength(0);
      expect(
        after.log.some((line) =>
          /^effect:(summon:separated|field_place:multi_placement|field_put:multi_placement)/.test(
            line
          )
        )
      ).toBe(false);
    }
  );

  it.each([
    ["deck", false],
    ["deck", true],
    ["trash", false],
    ["trash", true],
  ] as const)(
    "preserves the original source and chain after %s selection (following step=%s)",
    (zone, followingStep) => {
      const targetDef: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-ZONE-TARGET",
        colors: ["red"],
        effects: [
          {
            timing: {
              kind: "card_event",
              event: zone === "deck" ? "summon" : "place",
            },
            steps: [
              {
                action: { kind: "count_increase", player: "self", amount: 10 },
              },
            ],
          },
        ],
      };
      const sourceDef: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-ZONE-SOURCE",
        colors: ["yellow"],
        printedCategory: "nexus",
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind: "search_zone",
                  zone,
                  count: { min: 0, max: 1 },
                  destination: "field",
                },
              },
              ...(followingStep
                ? [
                    {
                      action: {
                        kind: "count_increase" as const,
                        player: "self" as const,
                        amount: 1,
                      },
                    },
                  ]
                : []),
            ],
          },
        ],
      };
      definitions.set(targetDef.cardNo, targetDef);
      definitions.set(sourceDef.cardNo, sourceDef);
      let state = executeEffect({
        state: createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(sourceDef, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            ...["entry-1", "entry-2"].map((instanceId) =>
              createCardInstance(targetDef, {
                instanceId,
                ownerPlayerId: "alice",
                zone,
              })
            ),
          ],
          playerOverrides: [
            { reserveNormalCoreCount: 1, reserveSoulCoreCount: 0 },
            {},
          ],
        }),
        effect: sourceDef.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "audit:zone-source",
        ...options,
      });
      state = applyLegalAction({
        state,
        action: actions(state).find(
          (a) => a.kind === "resolve_pending_zone_selection"
        )!,
        selectedZoneCardIds: ["entry-1"],
        ...options,
      }).state;
      expect(state.pendingMultiPlacement).toMatchObject({
        sourceInstanceId: "source",
        sourceDefinitionId: sourceDef.cardNo,
        sourceEffectIndex: 0,
        continuation: {
          chainId: "audit:zone-source",
          sourceInstanceId: "source",
        },
      });
      state = applyLegalAction({
        state,
        action: actions(state).find(
          (a) => a.kind === "resolve_pending_multi_placement"
        )!,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "entry-1",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        ...options,
      }).state;
      expect(
        state.pendingTriggeredEffects.find(
          (p) => p.relatedInstanceId === "entry-1"
        )
      ).toMatchObject({
        eventKind: zone === "deck" ? "summon" : "place",
        effectSourceInstanceId: "source",
        chainId: "audit:zone-source",
      });
      expect(state.players[0]!.countValue).toBe(followingStep ? 1 : 0);
    }
  );

  it.each([
    ["deck", 0],
    ["deck", 1],
    ["deck", 2],
    ["trash", 0],
    ["trash", 1],
    ["trash", 2],
  ] as const)(
    "counts only successful %s entries with %i maintenance cores",
    (zone, availableCores) => {
      const sourceDef: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-ZONE-RESULT",
        printedCategory: "nexus",
        effects: [],
      };
      const targetDef: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-ZONE-RESULT-TARGET",
        effects: [],
      };
      definitions.set(sourceDef.cardNo, sourceDef);
      definitions.set(targetDef.cardNo, targetDef);
      let state = executeEffect({
        state: createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(sourceDef, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "field",
            }),
            ...["entry-1", "entry-2"].map((instanceId) =>
              createCardInstance(targetDef, {
                instanceId,
                ownerPlayerId: "alice",
                zone,
              })
            ),
            ...["draw-1", "draw-2"].map((instanceId) =>
              createCardInstance(targetDef, {
                instanceId,
                ownerPlayerId: "alice",
                zone: "deck",
              })
            ),
          ],
          playerOverrides: [
            {
              reserveNormalCoreCount: availableCores,
              reserveSoulCoreCount: 0,
              handCount: 0,
            },
            {},
          ],
        }),
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "entries",
              action: {
                kind: "search_zone",
                zone,
                count: { min: 0, max: 2 },
                destination: "field",
              },
            },
            {
              action: {
                kind: "draw",
                count: {
                  source: { kind: "cards_from_ref", stepId: "entries" },
                },
              },
            },
          ],
        },
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "audit:zone-result",
        ...options,
      });
      state = applyLegalAction({
        state,
        action: actions(state).find(
          (a) => a.kind === "resolve_pending_zone_selection"
        )!,
        selectedZoneCardIds: ["entry-1", "entry-2"],
        ...options,
      }).state;
      expect(state.pendingMultiPlacement?.targets.length ?? 0).toBe(
        availableCores
      );
      if (state.pendingMultiPlacement) {
        state = applyLegalAction({
          state,
          action: actions(state).find(
            (a) => a.kind === "resolve_pending_multi_placement"
          )!,
          multiPlacementAllocations: state.pendingMultiPlacement.targets.map(
            (target) => ({
              destinationInstanceId: target.instanceId,
              placements: [{ kind: "reserve_normal" as const, amount: 1 }],
            })
          ),
          ...options,
        }).state;
      }
      expect(state.players[0]!.handCount).toBe(availableCores);
      expect(
        state.cardInstances.filter(
          (c) => c.instanceId.startsWith("entry-") && c.zone === "field"
        )
      ).toHaveLength(availableCores);
      expect(
        state.cardInstances.filter(
          (c) => c.instanceId.startsWith("entry-") && c.zone === "trash"
        )
      ).toHaveLength(2 - availableCores);
      expect(state.pendingMultiPlacement).toBeNull();
    }
  );

  it("reverse rebirth rejects missing maintenance and applies the chosen soul core", () => {
    const frontDef: CardDefinition = {
      ...entrant,
      cardNo: "AUDIT-REVERSE-FRONT",
      effects: [],
    };
    const backDef: CardDefinition = {
      ...entrant,
      cardNo: "AUDIT-REVERSE-BACK",
      effects: [],
    };
    definitions.set(frontDef.cardNo, frontDef);
    definitions.set(backDef.cardNo, backDef);
    const waiting = executeReverseRebirth(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          {
            ...createCardInstance(backDef, {
              instanceId: "reverse-source",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 2,
            }),
            originalDefinitionId: frontDef.cardNo,
          },
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 2, reserveSoulCoreCount: 1 },
          {},
        ],
      }),
      "alice",
      { kind: "reverse_rebirth", mode: "summon", withoutCost: true },
      "reverse-source",
      lookup
    );
    const action = actions(waiting).find(
      (a) => a.kind === "resolve_reverse_rebirth_summon"
    )!;
    expect(action).toBeDefined();
    const before = structuredClone(waiting);
    for (const placements of [undefined, []]) {
      expect(() =>
        applyLegalAction({
          state: waiting,
          action,
          ...(placements === undefined
            ? {}
            : { summonEnterFieldCorePlacements: placements }),
          ...options,
        })
      ).toThrow("placement below minimum");
      expect(waiting).toEqual(before);
    }
    const after = applyLegalAction({
      state: waiting,
      action,
      summonEnterFieldCorePlacements: [{ kind: "reserve_soul" }],
      ...options,
    }).state;
    const placed = after.cardInstances.find(
      (c) => c.definitionId === frontDef.cardNo
    )!;
    expect(placed.soulCoreCount).toBe(1);
    expect(placed.normalCoreCount).toBe(0);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(4);
    expect(after.pendingReverseRebirthSummon).toBeNull();
  });

  it.each([
    [1, false],
    [2, false],
    [2, true],
  ] as const)(
    "resumes %i additional paid summons across core choices (optional=%s)",
    (additional, optional) => {
      const token: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-PAID-TOKEN",
        cost: 1,
        reductionSymbols: [],
        keywordTags: ["token"],
        effects: [],
        maxTokenDeckCount: 5,
      };
      const producer: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-PAID-POOL",
        printedCategory: "nexus",
        relatedTokenCardNos: [token.cardNo],
        effects: [],
      };
      definitions.set(token.cardNo, token);
      definitions.set(producer.cardNo, producer);
      const source = createCardInstance(producer, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
      });
      let state = executeEffect({
        state: createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source],
          playerOverrides: [
            {
              reserveNormalCoreCount: (additional + 1) * 2,
              reserveSoulCoreCount: 0,
            },
            {},
          ],
        }),
        chainId: "audit:paid-repeat",
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        effectIndex: 0,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              ...(optional ? { executionMode: "optional" as const } : {}),
              action: {
                kind: "summon",
                target: { kind: "from_token_pool", count: 1 },
                costModifier: "full_reduction",
              },
              repeat: { additional },
            },
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
        ...options,
      });
      if (optional) {
        const action = actions(state).find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "execute"
        );
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...options }).state;
      }
      for (let round = 0; round <= additional; round++) {
        expect(state.pendingStepOptionalChoice).toBeNull();
        if (round > 0) {
          expect(
            state.pendingEffectSummonCostPayment?.continuation?.repeatResume
              ?.nextAdditionalIndex
          ).toBe(round - 1);
          state = applyLegalAction({
            state,
            action: actions(state).find(
              (a) => a.kind === "resolve_pending_effect_summon_cost_payment"
            )!,
            summonPaymentSources: [{ kind: "reserve", amount: 1 }],
            ...options,
          }).state;
        }
        const pending = state.pendingMultiPlacement!;
        expect(pending?.targets).toHaveLength(1);
        expect(state.players[0]?.countValue).toBe(0);
        state = applyLegalAction({
          state,
          action: actions(state).find(
            (a) => a.kind === "resolve_pending_multi_placement"
          )!,
          multiPlacementAllocations: [
            {
              destinationInstanceId: pending.targets[0]!.instanceId,
              placements: [{ kind: "reserve_normal", amount: 1 }],
            },
          ],
          ...options,
        }).state;
      }
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingEffectSummonCostPayment).toBeNull();
      expect(
        state.cardInstances.filter((c) => c.definitionId === token.cardNo)
      ).toHaveLength(additional + 1);
      expect(state.players[0]).toMatchObject({
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: additional + 1,
        countValue: 1,
      });
    }
  );

  it.each([false, true])(
    "reserves shared maintenance for token entries (allRelatedTokens=%s)",
    (allRelatedTokens) => {
      const tokens = ["AUDIT-POOL-A", "AUDIT-POOL-B"].map(
        (cardNo): CardDefinition => ({
          ...entrant,
          cardNo,
          effects: [],
          keywordTags: ["token"],
          maxTokenDeckCount: 5,
        })
      );
      const producer: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-POOL",
        relatedTokenCardNos: tokens.map((token) => token.cardNo),
        effects: [],
      };
      for (const def of [...tokens, producer]) definitions.set(def.cardNo, def);
      for (const reserveNormalCoreCount of [0, 1, 2]) {
        const source = createCardInstance(producer, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "hand",
        });
        let state = executeEffect({
          state: createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [source],
            playerOverrides: [
              { reserveNormalCoreCount, reserveSoulCoreCount: 0 },
              {},
            ],
          }),
          chainId: "audit:tokens-budget",
          sourceInstanceId: source.instanceId,
          actingPlayerId: "alice",
          effectIndex: 0,
          effect: {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind: "put",
                  target: {
                    kind: "from_token_pool",
                    count: 2,
                    allRelatedTokens,
                  },
                  costModifier: "free",
                },
              },
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
          ...options,
        });
        expect(
          state.cardInstances.filter((card) => card.instanceId !== "source")
        ).toHaveLength(reserveNormalCoreCount);
        if (reserveNormalCoreCount > 0) {
          const pending = state.pendingMultiPlacement!;
          expect(pending.targets).toHaveLength(reserveNormalCoreCount);
          expect(state.players[0]?.reserveNormalCoreCount).toBe(
            reserveNormalCoreCount
          );
          state = applyLegalAction({
            state,
            action: actions(state).find(
              (a) => a.kind === "resolve_pending_multi_placement"
            )!,
            multiPlacementAllocations: pending.targets.map((target) => ({
              destinationInstanceId: target.instanceId,
              placements: [{ kind: "reserve_normal", amount: 1 }],
            })),
            ...options,
          }).state;
        }
        expect(state.pendingMultiPlacement).toBeNull();
        expect(state.players[0]?.countValue).toBe(1);
        expect(state.players[0]?.reserveNormalCoreCount).toBe(0);
      }
    }
  );

  it("prices simultaneous paid summons before either entrant supplies a reduction symbol", () => {
    const reduced: CardDefinition = {
      ...entrant,
      cardNo: "AUDIT-REDUCED",
      cost: 1,
      reductionSymbols: ["red"],
      symbolColors: ["red"],
      effects: [],
    };
    definitions.set(reduced.cardNo, reduced);
    const cards = ["a", "b"].map((instanceId) =>
      createCardInstance(reduced, {
        instanceId,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const action = {
      kind: "summon",
      target: "other",
      zone: "hand",
      count: 2,
    } as const;
    for (const reserveNormalCoreCount of [3, 4]) {
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: cards,
        playerOverrides: [
          { reserveNormalCoreCount, reserveSoulCoreCount: 0 },
          {},
        ],
      });
      expect(
        canAutoExecuteSummonFromZoneCandidateSequence({
          state: before,
          actingPlayerId: "alice",
          action,
          candidates: cards,
          getCardDefinitionById: lookup,
        })
      ).toBe(reserveNormalCoreCount === 4);
      const state = executeSummonOther(
        before,
        "audit:paid",
        "alice",
        action,
        "a",
        lookup
      );
      expect(state.pendingMultiPlacement?.targets ?? []).toHaveLength(
        reserveNormalCoreCount === 4 ? 2 : 0
      );
      expect(state.players[0]?.reserveNormalCoreCount).toBe(
        reserveNormalCoreCount === 4 ? 2 : 3
      );
      expect(
        state.cardInstances
          .filter((c) => c.zone === "field")
          .every((c) => c.normalCoreCount === 0)
      ).toBe(true);
    }
  });

  it("an unaffordable self summon fails without an impossible prompt and continues its effect", () => {
    const source = createCardInstance(entrant, {
      instanceId: "source",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = executeEffect({
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [
          { reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 },
          {},
        ],
      }),
      chainId: "audit:shortage",
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      effectIndex: 0,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
      ...options,
    });
    expect(state.pendingMultiPlacement).toBeNull();
    expect(state.cardInstances[0]?.zone).toBe("trash");
    expect(state.players[0]?.countValue).toBe(1);
  });

  it.each([
    [0, false],
    [1, false],
    [2, false],
    [2, true],
  ] as const)(
    "keeps all %i additional token placements (optional=%s) and their affected-card reference across core choices",
    (additional, optional) => {
      const token: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-TOKEN",
        effects: [],
        maxTokenDeckCount: 5,
      };
      const producer: CardDefinition = {
        ...entrant,
        cardNo: "AUDIT-PRODUCER",
        relatedTokenCardNos: [token.cardNo],
        effects: [],
      };
      definitions.set(token.cardNo, token);
      definitions.set(producer.cardNo, producer);
      const source = createCardInstance(producer, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const deck = Array.from({ length: 8 }, (_, i) =>
        createCardInstance(entrant, {
          instanceId: `repeat-deck-${i}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      );
      let state = executeEffect({
        state: createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, ...deck],
          playerOverrides: [
            {
              handCount: 0,
              reserveNormalCoreCount: 5,
              reserveSoulCoreCount: 0,
            },
            {},
          ],
        }),
        chainId: "audit:repeat",
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        effectIndex: 0,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "tokens",
              ...(optional ? { executionMode: "optional" as const } : {}),
              action: {
                kind: "put",
                target: { kind: "from_token_pool", count: 1 },
                costModifier: "free",
              },
              repeat: { additional },
            },
            {
              action: {
                kind: "draw",
                count: { source: { kind: "cards_from_ref", stepId: "tokens" } },
              },
            },
          ],
        },
        ...options,
      });
      if (optional) {
        const action = actions(state).find(
          (action) =>
            action.kind === "resolve_pending_step_optional_choice" &&
            action.choice === "execute"
        );
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...options }).state;
      }
      for (let round = 0; round <= additional; round++) {
        expect(state.pendingStepOptionalChoice).toBeNull();
        const pending = state.pendingMultiPlacement!;
        expect(pending?.targets).toHaveLength(1);
        expect(state.players[0]?.handCount).toBe(0);
        expect(state.players[0]?.reserveNormalCoreCount).toBe(5 - round);
        state = applyLegalAction({
          state,
          action: actions(state).find(
            (a) => a.kind === "resolve_pending_multi_placement"
          )!,
          multiPlacementAllocations: [
            {
              destinationInstanceId: pending.targets[0]!.instanceId,
              placements: [{ kind: "reserve_normal", amount: 1 }],
            },
          ],
          ...options,
        }).state;
      }
      expect(state.pendingMultiPlacement).toBeNull();
      expect(
        state.cardInstances.filter((c) => c.definitionId === token.cardNo)
      ).toHaveLength(additional + 1);
      expect(state.players[0]?.handCount).toBe(additional + 1);
    }
  );

  it.each(["self", "multiple-paid"])(
    "%s summons pause without consuming any maintenance cores",
    (mode) => {
      const targets = ["a", "b"].map((id) =>
        createCardInstance(entrant, {
          instanceId: id,
          ownerPlayerId: "alice",
          zone: "hand",
        })
      );
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: targets,
        playerOverrides: [
          { reserveNormalCoreCount: 5, reserveSoulCoreCount: 1 },
          {},
        ],
      });
      const state =
        mode === "self"
          ? executeSummonSelf(
              before,
              "audit:self",
              "alice",
              { kind: "summon", target: "self", withoutCost: true },
              "a",
              lookup
            )
          : executeSummonOther(
              before,
              "audit:multi",
              "alice",
              { kind: "summon", target: "other", zone: "hand", count: 2 },
              "a",
              lookup,
              [{ kind: "reserve", amount: 2 }]
            );
      expect(state.pendingMultiPlacement?.targets).toHaveLength(
        mode === "self" ? 1 : 2
      );
      expect(state.players[0]!.reserveNormalCoreCount).toBe(
        mode === "self" ? 5 : 3
      );
      expect(
        state.cardInstances
          .filter((c) => c.zone === "field")
          .every((c) => c.normalCoreCount === 0 && c.soulCoreCount === 0)
      ).toBe(true);
    }
  );

  it("ref resummons let both owners choose their own cores and preserve exhaustion", () => {
    const cards = ["alice", "bob"].map((owner) =>
      createCardInstance(entrant, {
        instanceId: owner + "-target",
        ownerPlayerId: owner,
        zone: "removed_from_game",
      })
    );
    let state = executeRefSummon(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: cards,
        playerOverrides: [
          { reserveNormalCoreCount: 3 },
          { reserveNormalCoreCount: 3 },
        ],
      }),
      "alice",
      {
        kind: "summon",
        target: { kind: "ref", stepId: "exiled" },
        costModifier: "free",
        toOwnerField: true,
        entersExhausted: true,
      },
      lookup,
      cards.map((c) => c.instanceId)
    );
    expect(state.pendingMultiPlacement?.actingPlayerId).toBe("alice");
    for (const owner of ["alice", "bob"]) {
      expect(state.pendingMultiPlacement?.actingPlayerId).toBe(owner);
      const action = actions(state, owner).find(
        (a) => a.kind === "resolve_pending_multi_placement"
      )!;
      state = applyLegalAction({
        state,
        action,
        multiPlacementAllocations: [
          {
            destinationInstanceId: owner + "-target",
            placements: [{ kind: "reserve_normal", amount: 2 }],
          },
        ],
        ...options,
      }).state;
    }
    expect(state.pendingMultiPlacement).toBeNull();
    for (const c of state.cardInstances)
      expect(c).toMatchObject({
        zone: "field",
        exhaustState: "exhausted",
        normalCoreCount: 2,
      });
    expect(state.players.map((p) => p.reserveNormalCoreCount)).toEqual([1, 1]);
  });

  it("ordinary nexus placement offers zero or extra cores, while independent nexus forbids placement", () => {
    const nexus: CardDefinition = {
      ...entrant,
      cardNo: "AUDIT-NEXUS",
      printedCategory: "nexus",
      effects: [],
      levelDefs: [
        { level: 1, requiredCores: 0 },
        { level: 2, requiredCores: 2 },
      ],
    };
    const forbidden: CardDefinition = {
      ...nexus,
      cardNo: "AUDIT-FORBIDDEN",
      keywordTags: ["enter_field_core_placement_forbidden"],
    };
    definitions.set(nexus.cardNo, nexus);
    definitions.set(forbidden.cardNo, forbidden);
    for (const amount of [0, 2]) {
      const card = createCardInstance(nexus, {
        instanceId: "nexus",
        ownerPlayerId: "alice",
        zone: "trash",
      });
      let state = placeCardFromZoneToField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
          playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
        }),
        card.instanceId,
        lookup
      );
      expect(state.pendingMultiPlacement?.targets[0]?.minimumCoreCount).toBe(0);
      const action = actions(state).find(
        (a) => a.kind === "resolve_pending_multi_placement"
      )!;
      state = applyLegalAction({
        state,
        action,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "nexus",
            placements: amount ? [{ kind: "reserve_normal", amount }] : [],
          },
        ],
        ...options,
      }).state;
      expect(state.cardInstances[0]!.normalCoreCount).toBe(amount);
    }
    const card = createCardInstance(forbidden, {
      instanceId: "forbidden",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    expect(
      placeCardFromZoneToField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
        }),
        card.instanceId,
        lookup
      ).pendingMultiPlacement
    ).toBeNull();
  });
  it("BSTH09-TR01(B) waits for chosen soul/normal cores before each count-2 remainder and suppresses entrant effects", () => {
    const sourceDef = definitions.get("BSTH09-TR01(B)")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "source",
      ownerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "host",
    });
    const host = createCardInstance(definitions.get("BSTH09-X01")!, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
      attachedChildrenIds: [source.instanceId],
    });
    const deck = Array.from({ length: 8 }, (_, i) =>
      createCardInstance(entrant, {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    let state = executeEffect({
      chainId: "test:entry-core-audit",
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      effect: sourceDef.effects![1]!,
      effectIndex: 1,
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, host, ...deck],
        playerOverrides: [
          { countValue: 2, reserveNormalCoreCount: 4, reserveSoulCoreCount: 1 },
          {},
        ],
      }),
      ...options,
    });
    for (const round of [0, 1]) {
      const target = `deck-${round * 4}`;
      const pick = actions(state).find(
        (a) => a.kind === "resolve_pending_deck_reveal_pick"
      )!;
      expect(pick).toBeDefined();
      state = applyLegalAction({
        state,
        action: pick,
        selectedDeckRevealCardIds: [target],
        ...options,
      }).state;
      expect(
        state.pendingMultiPlacement?.targets.map((t) => t.instanceId)
      ).toEqual([target]);
      expect(state.pendingDeckReveal).toBeNull();
      expect(
        state.cardInstances.find((c) => c.instanceId === target)
          ?.normalCoreCount
      ).toBe(0);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(4);
      expect(
        state.cardInstances.filter((c) => c.zone === "revealed")
      ).toHaveLength(3);
      const placement = actions(state).find(
        (a) => a.kind === "resolve_pending_multi_placement"
      )!;
      state = applyLegalAction({
        state,
        action: placement,
        multiPlacementAllocations: [
          {
            destinationInstanceId: target,
            placements:
              round === 0
                ? [{ kind: "reserve_soul" }]
                : [{ kind: "card_normal", instanceId: "host", amount: 2 }],
          },
        ],
        ...options,
      }).state;
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingDeckReveal?.phase).toBe("ordering_remainder");
      const order = actions(state).find(
        (a) => a.kind === "resolve_pending_deck_reveal_order"
      );
      if (!order || order.kind !== "resolve_pending_deck_reveal_order")
        throw new Error("remainder order missing");
      state = applyLegalAction({
        state,
        action: order,
        deckRevealRemainderOrder: order.remainingCardInstanceIds,
        ...options,
      }).state;
    }
    expect(state.pendingDeckReveal).toBeNull();
    expect(state.players[0]!.countValue).toBe(2);
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck-0")?.soulCoreCount
    ).toBe(1);
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck-4")
        ?.normalCoreCount
    ).toBe(2);
    expect(state.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
      6
    );
    expect(
      state.pendingTriggeredEffects.some((p) =>
        p.sourceInstanceId.startsWith("deck-")
      )
    ).toBe(false);
  });
});
