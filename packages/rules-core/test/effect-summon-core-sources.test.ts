import {
  applyAutoEnterFieldCores,
  countEnterFieldCoreSources,
} from "../src/zone/enter-field-core-sources";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  applyLegalAction,
  rebuildContinuousEffectsFromField,
} from "../src";
import {
  canAutoExecuteSummonFromZoneCandidate,
  canAutoExecuteSummonFromZoneCandidateSequence,
} from "../src/effect/summon-from-zone-candidates";
import {
  canExecuteSummonSelfNow,
  executeSummon,
  executeSoulStateSummon,
  executeTokenSummon,
} from "../src/effect/structured-summon";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const triggered = buildTriggeredEffectLookup(ALL_CARDS);
const burst = buildBurstEffectLookup(ALL_CARDS);

function setup(
  zone: "hand" | "trash" | "set_aside" = "hand",
  fieldSoul = false
) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(getDef("BSDB01-C06")!, {
        instanceId: "kamehouse",
        ownerPlayerId: "bob",
        zone: "field",
        soulCoreCount: fieldSoul ? 1 : 0,
      }),
      createCardInstance(getDef("BSDB01-CX01")!, {
        instanceId: "goku",
        ownerPlayerId: "bob",
        zone,
      }),
    ],
    playerOverrides: [
      {},
      {
        reserveNormalCoreCount: 0,
        reserveSoulCoreCount: fieldSoul ? 0 : 1,
        soulCoreLocation: fieldSoul
          ? { kind: "card", instanceId: "kamehouse" }
          : { kind: "reserve" },
        trashNormalCoreCount: 3,
        handCount: zone === "hand" ? 1 : 0,
        deckCount: 35,
      },
    ],
  });
  return { ...state, activePlayerId: "bob", step: "main" as const };
}

describe("effect summon core sources", () => {
  it("snapshot: C06 offers activation with only one reserve soul core", () => {
    const state = setup();
    state.pendingTriggeredEffects = [
      {
        pendingId: "c06-placement",
        actingPlayerId: "bob",
        eventKind: "place",
        event: {
          family: "enter_field",
          actionKind: "placement",
          validationMode: "require_related_instance_on_field",
        },
        source: "action_resolution",
        chainId: "c06-placement",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "kamehouse",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
        fromZone: "in_use",
        relatedInstanceIds: ["kamehouse"],
        relatedInstanceIdsBySourceRegistrationKey: {
          "kamehouse#0": ["kamehouse"],
        },
      },
    ];
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggered,
      getRegisteredBurstActions: burst,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" && !action.skipOnly
      )
    ).toBe(true);
  });

  for (const zone of ["hand", "trash", "set_aside"] as const) {
    for (const fieldSoul of [false, true]) {
      it(`${zone}: ${fieldSoul ? "field" : "reserve"} soul supports from-zone and self summon`, () => {
        const state = setup(zone, fieldSoul);
        const before = structuredClone(state);
        expect(
          canAutoExecuteSummonFromZoneCandidate({
            state,
            actingPlayerId: "bob",
            candidate: state.cardInstances[1]!,
            getCardDefinitionById: getDef,
            action: {
              kind: "summon",
              target: "other",
              zone,
              fullReduction: true,
            },
          })
        ).toBe(true);
        expect(
          canExecuteSummonSelfNow({
            state,
            sourceInstanceId: "goku",
            target: { zone },
            costModifier: "full_reduction",
            getCardDefinitionById: getDef,
          })
        ).toBe(true);
        expect(state).toEqual(before);
        for (const target of ["self", "other"] as const) {
          let after = executeSummon(
            state,
            "test:effect-summon-core-sources:141",
            "bob",
            { kind: "summon", target, zone, fullReduction: true },
            target === "self" ? "goku" : "kamehouse",
            getDef
          );
          if (after.pendingMultiPlacement) {
            const action = getLegalActions({
              state: after,
              actingPlayerId: "bob",
              getCardDefinitionById: getDef,
            }).find((a) => a.kind === "resolve_pending_multi_placement")!;
            after = applyLegalAction({
              state: after,
              action,
              getCardDefinitionById: getDef,
              getRegisteredTriggeredEffectActions: triggered,
              getRegisteredBurstActions: burst,
              multiPlacementAllocations: [
                {
                  destinationInstanceId: "goku",
                  placements: [
                    fieldSoul
                      ? { kind: "card_soul", instanceId: "kamehouse" }
                      : { kind: "reserve_soul" },
                  ],
                },
              ],
            }).state;
          }
          const goku = after.cardInstances.find(
            (card) => card.instanceId === "goku"
          )!;
          expect(goku.zone).toBe("field");
          expect(goku.normalCoreCount).toBe(0);
          expect(goku.soulCoreCount).toBe(1);
          expect(after.players[1]!.reserveSoulCoreCount).toBe(0);
        }
      });
    }
  }
});

it("one core cannot maintain two simultaneous summons", () => {
  const state = setup();
  state.cardInstances.push(
    createCardInstance(getDef("BSDB01-CX01")!, {
      instanceId: "goku2",
      ownerPlayerId: "bob",
      zone: "hand",
    })
  );
  state.players[1]!.handCount = 2;
  const options = {
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDef,
    candidates: state.cardInstances.slice(1),
    action: {
      kind: "summon" as const,
      target: "other" as const,
      zone: "hand" as const,
      fullReduction: true,
    },
  };
  expect(canAutoExecuteSummonFromZoneCandidateSequence(options)).toBe(false);
  state.players[1]!.reserveSoulCoreCount = 2;
  expect(canAutoExecuteSummonFromZoneCandidateSequence(options)).toBe(true);
});
it("life/trash cores are excluded unless the effect permits trash", () => {
  const state = setup();
  state.players[1]!.reserveSoulCoreCount = 0;
  state.players[1]!.trashSoulCoreCount = 2;
  state.players[1]!.soulCoreLocation = { kind: "trash" };
  state.players[1]!.lifeSoulCoreCount = 1;
  const options = {
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDef,
  };
  expect(countEnterFieldCoreSources(options)).toBe(0);
  expect(
    countEnterFieldCoreSources({ ...options, trashNormalCapacity: 1 })
  ).toBe(1);
  state.players[1]!.trashNormalCoreCount = 0;
  expect(
    countEnterFieldCoreSources({ ...options, trashNormalCapacity: 1 })
  ).toBe(0);
  expect(
    countEnterFieldCoreSources({ ...options, trashGenericCapacity: 2 })
  ).toBe(2);
});
it("pending field sources and multiple soul cores agree with actual placement", () => {
  const state = setup("hand", true);
  state.cardInstances[0]!.soulCoreCount = 2;
  state.cardInstances[0]!.pendingLeaveKind = "destroy";
  state.cardInstances[1]!.zone = "field";
  const options = {
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: getDef,
  };
  expect(countEnterFieldCoreSources(options)).toBe(2);
  const after = applyAutoEnterFieldCores({
    ...options,
    destinationInstanceId: "goku",
    requiredCores: 2,
  })!.state;
  expect(after.cardInstances[1]!.soulCoreCount).toBe(2);
  expect(after.cardInstances[0]!.soulCoreCount).toBe(0);
});
it("soul-state summon counts every available soul core", () => {
  const state = setup();
  const goku = {
    ...getDef("BSDB01-CX01")!,
    levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
  };
  const lookup = (id: string) => (id === goku.cardNo ? goku : getDef(id));
  state.cardInstances[1]!.zone = "field";
  state.cardInstances[1]!.minimumRequiredCores = 2;
  state.players[1]!.soulStateInstanceIds = ["goku"];
  state.players[1]!.reserveSoulCoreCount = 2;
  const after = executeSoulStateSummon(
    state,
    "test:effect-summon-core-sources.test.ts:summon",
    "bob",
    undefined,
    "free",
    "kamehouse",
    lookup,
    ["goku"]
  );
  expect(after.pendingMultiPlacement?.targets[0]?.instanceId).toBe("goku");
});
it("token cost can use field cores while reserving a core for placement", () => {
  const state = setup("hand", true);
  state.cardInstances[0]!.normalCoreCount = 1;
  const source = {
    ...getDef("BSDB01-C06")!,
    relatedTokenCardNos: ["TEST-TOKEN"],
  };
  const token = {
    ...getDef("BSDB01-CX01")!,
    cardNo: "TEST-TOKEN",
    token: true,
    maxTokenCount: 2,
  };
  const lookup = (id: string) =>
    id === source.cardNo ? source : id === token.cardNo ? token : getDef(id);
  const after = executeTokenSummon(
    state,
    "test:effect-summon-core-sources.test.ts:summon",
    "bob",
    1,
    { fixedPayment: 1 },
    undefined,
    undefined,
    undefined,
    "kamehouse",
    lookup,
    undefined,
    undefined,
    [{ kind: "card", instanceId: "kamehouse", amount: 1 }]
  );
  expect(after.pendingMultiPlacement?.targets).toHaveLength(1);
  expect(
    after.players[1]!.trashNormalCoreCount +
      after.players[1]!.trashSoulCoreCount
  ).toBe(4);
  expect(
    countEnterFieldCoreSources({
      state: after,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    })
  ).toBe(1);
});

it("candidate preview applies the same symbol reduction as execution", () => {
  const state = setup();
  state.players[1]!.reserveNormalCoreCount = 2;
  const source = { ...getDef("BSDB01-C06")!, effects: [] };
  const lookup = (id: string) => (id === source.cardNo ? source : getDef(id));
  expect(
    canAutoExecuteSummonFromZoneCandidate({
      state,
      actingPlayerId: "bob",
      action: { kind: "summon", target: "other", zone: "hand" },
      candidate: state.cardInstances[1]!,
      getCardDefinitionById: lookup,
    })
  ).toBe(true);
  const after = executeSummon(
    state,
    "test:effect-summon-core-sources:329",
    "bob",
    { kind: "summon", target: "other", zone: "hand" },
    "kamehouse",
    lookup,
    [{ kind: "reserve", amount: 2 }]
  );
  expect(after.cardInstances[1]!.zone).toBe("field");
  expect(after.players[1]!.reserveNormalCoreCount).toBe(0);
  expect(after.players[1]!.reserveSoulCoreCount).toBe(1);
  expect(after.pendingMultiPlacement?.targets[0]?.minimumCoreCount).toBe(1);
});
it("one action shares its trash core budget across simultaneous summons", () => {
  const state = setup();
  state.players[1]!.reserveSoulCoreCount = 0;
  state.cardInstances.push(
    createCardInstance(getDef("BSDB01-CX01")!, {
      instanceId: "goku2",
      ownerPlayerId: "bob",
      zone: "hand",
    })
  );
  state.players[1]!.handCount = 2;
  const action = {
    kind: "summon" as const,
    target: "other" as const,
    zone: "hand" as const,
    count: 2,
    fullReduction: true,
    trashCoreMax: 1,
  };
  const args = {
    state,
    actingPlayerId: "bob",
    action,
    candidates: state.cardInstances.slice(1),
    getCardDefinitionById: getDef,
  };
  expect(canAutoExecuteSummonFromZoneCandidateSequence(args)).toBe(false);
  expect(
    canAutoExecuteSummonFromZoneCandidateSequence({
      ...args,
      action: { ...action, trashCoreMax: 2 },
    })
  ).toBe(true);
  const after = executeSummon(
    state,
    "test:effect-summon-core-sources:374",
    "bob",
    action,
    "kamehouse",
    getDef
  );
  expect(
    after.cardInstances.filter(
      (c) => c.definitionId === "BSDB01-CX01" && c.zone === "field"
    )
  ).toHaveLength(0);
  expect(after.pendingMultiPlacement).toBeNull();
  expect(after.players[1]!.trashNormalCoreCount).toBe(3);
});
it("self summon retains an existing soul core without requiring another core", () => {
  const state = setup();
  state.players[1]!.reserveSoulCoreCount = 0;
  state.players[1]!.soulCoreLocation = { kind: "card", instanceId: "goku" };
  state.cardInstances[1]!.soulCoreCount = 1;
  expect(
    canExecuteSummonSelfNow({
      state,
      sourceInstanceId: "goku",
      target: { zone: "hand", carryOverExistingCores: true },
      costModifier: "full_reduction",
      getCardDefinitionById: getDef,
    })
  ).toBe(true);
  const after = executeSummon(
    state,
    "test:effect-summon-core-sources:396",
    "bob",
    {
      kind: "summon",
      target: "self",
      zone: "hand",
      fullReduction: true,
      carryOverExistingCores: true,
    },
    "goku",
    getDef
  );
  expect(after.cardInstances[1]).toMatchObject({
    zone: "field",
    normalCoreCount: 0,
    soulCoreCount: 1,
  });
});

it("multiple free summons still pay mandatory extra costs through shared sources", () => {
  let state = setup();
  state.players[1]!.reserveNormalCoreCount = 6;
  state.players[1]!.reserveSoulCoreCount = 2;
  state.players[1]!.handCount = 2;
  state.cardInstances.push(
    createCardInstance(getDef("BSDB01-CX01")!, {
      instanceId: "goku2",
      ownerPlayerId: "bob",
      zone: "hand",
    }),
    createCardInstance(getDef("BSTH02-C02")!, {
      instanceId: "tax",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    })
  );
  state = { ...rebuildContinuousEffectsFromField(state, getDef), step: "main" };
  const action = {
    kind: "summon" as const,
    target: "other" as const,
    zone: "hand" as const,
    count: 2,
    withoutCost: true,
    summonCause: "effect" as const,
  };
  expect(
    canAutoExecuteSummonFromZoneCandidateSequence({
      state,
      actingPlayerId: "bob",
      action,
      candidates: state.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
      ),
      getCardDefinitionById: getDef,
    })
  ).toBe(true);
  const after = executeSummon(
    state,
    "test:effect-summon-core-sources:454",
    "bob",
    action,
    "kamehouse",
    getDef,
    [{ kind: "reserve", amount: 6 }]
  );
  expect(after.pendingMultiPlacement?.targets).toHaveLength(2);
  expect(after.players[1]!.reserveNormalCoreCount).toBe(0);
  expect(after.players[1]!.reserveSoulCoreCount).toBe(2);
  expect(after.players[1]!.trashNormalCoreCount).toBe(9);
});
