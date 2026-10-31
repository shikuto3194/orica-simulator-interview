import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  getEnterFieldCorePlacementSourceCapacity,
  type CardDefinition,
  type GameState,
  type FieldCoreSourceMinimum,
} from "../src";
import type { DSL } from "../src/dsl-types";
import {
  applyAutoEnterFieldCores,
  countEnterFieldCoreSources,
} from "../src/zone/enter-field-core-sources";
import { canAutoExecuteSummonFromZoneCandidate } from "../src/effect/summon-from-zone-candidates";

const baseDef: CardDefinition = {
  cardNo: "CORE-MIN-SPIRIT",
  name: "供給元",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "CB・S.S.S",
  effects: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const definitions = [
  ...ALL_CARDS,
  baseDef,
  {
    ...baseDef,
    cardNo: "CORE-MIN-ULTIMATE",
    printedCategory: "ultimate" as const,
  },
  { ...baseDef, cardNo: "CORE-MIN-NEXUS", printedCategory: "nexus" as const },
];
const getDef = (id: string) => definitions.find((d) => d.cardNo === id);
const floor: FieldCoreSourceMinimum = {
  categories: ["spirit", "ultimate"],
  minimum: 1,
};
const card = (s: GameState, id: string) =>
  s.cardInstances.find((c) => c.instanceId === id)!;

function setup(donorNormal: number, donorSoul = 0, targetCount = 1) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(getDef("BSLH01-X01")!, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(getDef("CORE-MIN-ULTIMATE")!, {
        instanceId: "donor",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: donorNormal,
        soulCoreCount: donorSoul,
      }),
      ...Array.from({ length: targetCount }, (_, i) =>
        createCardInstance(baseDef, {
          instanceId: `target${i}`,
          ownerPlayerId: "alice",
          zone: "trash",
          normalCoreCount: 0,
        })
      ),
    ],
    playerOverrides: [
      {
        reserveNormalCoreCount: 0,
        reserveSoulCoreCount: 0,
        soulCoreLocation: donorSoul
          ? { kind: "card", instanceId: "donor" }
          : null,
      },
      {},
    ],
  });
  return { ...state, activePlayerId: "alice", step: "main" as const };
}

function printedSummon(no: "BSLH01-X01" | "BSLH01-X04"): DSL.SummonAction {
  const def = getDef(no)!;
  const effect =
    no === "BSLH01-X01"
      ? def.grandwalkerData!.divineSkills![1]!.effects[0]!
      : def.effects![1]!;
  const action = effect.steps.find((s) => s.action.kind === "summon")!.action;
  if (action.kind !== "summon") throw new Error("missing printed summon");
  return action;
}
function begin(state: GameState, no: "BSLH01-X01" | "BSLH01-X04") {
  // Cost/life gain are covered by each card's existing tests; execute the actual printed summon action.
  return executeEffect({
    chainId: "test:bslh01-summon-core-minimum-fidelity:107",
    state,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    targetInstanceIds: state.cardInstances
      .filter((c) => c.instanceId.startsWith("target"))
      .map((c) => c.instanceId),
    targetSelectionResolved: true,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: printedSummon(no) }],
    },
  });
}
function allocate(
  state: GameState,
  allocations: Array<{
    destinationInstanceId: string;
    placements: import("../src/zone/enter-field-placement-execution").EnterFieldCorePlacement[];
  }>
) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find((a) => a.kind === "resolve_pending_multi_placement")!;
  expect(action).toBeDefined();
  expect(
    action.kind === "resolve_pending_multi_placement" &&
      action.fieldCoreSourceMinimum
  ).toEqual(floor);
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    multiPlacementAllocations: allocations,
  }).state;
}

describe("BSLH01 X01/X04 原文の仲間コア0個禁止召喚", () => {
  for (const no of ["BSLH01-X01", "BSLH01-X04"] as const) {
    it(`${no}: 同時2体へ1個ずつ供給し、既存アルティメットに1個を残す`, () => {
      const pending = begin(setup(3, 0, 2), no);
      expect(pending.pendingMultiPlacement?.targets).toHaveLength(2);
      expect(pending.pendingMultiPlacement?.fieldCoreSourceMinimum).toEqual(
        floor
      );
      const allocations = [0, 1].map((i) => ({
        destinationInstanceId: `target${i}`,
        placements: [
          { kind: "card_normal" as const, instanceId: "donor", amount: 1 },
        ],
      }));
      const after = allocate(pending, allocations);
      expect(card(after, "donor").normalCoreCount).toBe(1);
      expect(
        [0, 1].map((i) => card(after, `target${i}`).normalCoreCount)
      ).toEqual([1, 1]);
      allocations[1]!.placements[0]!.amount = 2;
      expect(() => allocate(pending, allocations)).toThrow(
        /minimum remaining cores/
      );
      expect(card(pending, "donor").normalCoreCount).toBe(3);
    });
    it(`${no}: 通常/ソウルのどちらかは選べるが両方は取れない`, () => {
      const pending = begin(setup(1, 1), no);
      const normal = {
        kind: "card_normal" as const,
        instanceId: "donor",
        amount: 1,
      };
      const soul = { kind: "card_soul" as const, instanceId: "donor" };
      for (const placement of [normal, soul]) {
        const after = allocate(pending, [
          { destinationInstanceId: "target0", placements: [placement] },
        ]);
        expect(
          card(after, "donor").normalCoreCount +
            card(after, "donor").soulCoreCount
        ).toBe(1);
      }
      expect(() =>
        allocate(pending, [
          { destinationInstanceId: "target0", placements: [normal, soul] },
        ])
      ).toThrow(/minimum remaining cores/);
    });
  }
  it("単体/複数候補の事前判定、自動配置、確定時検証で残数を共有する", () => {
    const state = setup(1);
    const action = {
      kind: "summon" as const,
      target: "other" as const,
      zone: "trash" as const,
      withoutCost: true,
      fieldCoreSourceMinimum: floor,
    };
    expect(
      canAutoExecuteSummonFromZoneCandidate({
        state,
        actingPlayerId: "alice",
        action,
        candidate: card(state, "target0"),
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    const pending = begin(setup(2), "BSLH01-X01");
    card(pending, "donor").normalCoreCount = 1;
    expect(
      getEnterFieldCorePlacementSourceCapacity(
        pending,
        "alice",
        card(pending, "donor"),
        getDef("CORE-MIN-ULTIMATE"),
        "generic"
      )
    ).toBe(0);
    expect(() =>
      allocate(pending, [
        {
          destinationInstanceId: "target0",
          placements: [{ kind: "card_normal", instanceId: "donor", amount: 1 }],
        },
      ])
    ).toThrow(/minimum remaining cores/);
    const mixed = setup(1, 1);
    const options = {
      state: mixed,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      fieldCoreSourceMinimum: floor,
    };
    expect(countEnterFieldCoreSources(options)).toBe(1);
    card(mixed, "target0").zone = "field";
    expect(
      applyAutoEnterFieldCores({
        ...options,
        destinationInstanceId: "target0",
        requiredCores: 2,
      })
    ).toBeNull();
    expect(
      card(
        applyAutoEnterFieldCores({
          ...options,
          destinationInstanceId: "target0",
          requiredCores: 1,
        })!.state,
        "donor"
      ).soulCoreCount
    ).toBe(1);
  });
  it("スピリットも保護し、通常ネクサスとリザーブの最後のコアは利用できる", () => {
    const state = setup(1);
    card(state, "donor").definitionId = baseDef.cardNo;
    const options = {
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      fieldCoreSourceMinimum: floor,
    };
    expect(countEnterFieldCoreSources(options)).toBe(0);
    card(state, "donor").definitionId = "CORE-MIN-NEXUS";
    expect(countEnterFieldCoreSources(options)).toBe(1);
    state.players[0]!.reserveNormalCoreCount = 1;
    expect(countEnterFieldCoreSources(options)).toBe(2);
    card(state, "target0").zone = "field";
    const after = applyAutoEnterFieldCores({
      ...options,
      destinationInstanceId: "target0",
      requiredCores: 2,
    })!.state;
    expect(card(after, "donor").normalCoreCount).toBe(0);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(0);
  });
});
