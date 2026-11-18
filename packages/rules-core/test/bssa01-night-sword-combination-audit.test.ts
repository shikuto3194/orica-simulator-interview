import { createActionInputDecisionNode } from "../src/training-decision-surface";
import { isEligibleBraveCombineHost } from "../src/legal/legal-actions-shared";
import {
  createStepExecutionContext,
  recordStepResult,
  serializeStepContext,
} from "../src/step-execution-context";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeCoreMove } from "../src/effect/structured-core-move";
import { getUnblockedLifeDamage } from "../src/battle/battle-actions";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/model";

const definitions = [
  ...new Map(
    expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
  ).values(),
];
const getDef = (id: string): CardDefinition | undefined =>
  definitions.find((c) => c.cardNo === id);
const eligible = definitions.filter(
  (c) => c.printedCategory === "spirit" && c.cost >= 7
);
const sword = getDef("BSSA01-転醒X01(B)")!;
const enemy = (id: string, cores = 5, owner = "bob") =>
  createCardInstance(getDef("BSSA01-C01")!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
function setup(
  no: string,
  targets = [enemy("target-a"), enemy("target-b")]
): GameState {
  const host = createCardInstance(getDef(no)!, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 10,
  });
  host.attachedChildrenIds = ["sword"];
  const brave = createCardInstance(sword, {
    instanceId: "sword",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
  });
  brave.attachedToInstanceId = "host";
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, ...targets],
        playerOverrides: [
          { countValue: 10, lifeNormalCoreCount: 10 },
          { lifeNormalCoreCount: 20, reserveNormalCoreCount: 5 },
        ],
      }),
      step: "attack",
    },
    getDef
  );
}
function run(
  state: GameState,
  index: number,
  extra: Partial<Parameters<typeof executeEffect>[0]> = {}
) {
  const host = state.cardInstances.find((c) => c.instanceId === "host")!;
  return executeEffect({
    chainId: "test:bssa01-night-sword-combination-audit:77",
    state,
    effect: getDef(host.definitionId)!.effects![index]!,
    effectIndex: index,
    sourceInstanceId: "host",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  });
}
function apply(
  state: GameState,
  kind: string,
  extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  }).state;
}
const cores = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount;
function battle(state: GameState): GameState {
  return {
    ...state,
    battleEntities: [
      {
        entityId: "attack",
        memberInstanceIds: ["host", "sword"],
        resolvedBp: 10000,
        resolvedSymbols: ["purple", "purple"],
        attackState: "attacking",
      },
    ],
    battleResolutionGroup: {
      attackId: "attack-1",
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      symbolResolutionOrder: ["attack"],
      participantSnapshots: [
        {
          entityId: "attack",
          memberInstanceIds: ["host", "sword"],
          resolvedBp: 10000,
          resolvedSymbols: ["purple", "purple"],
          blockedBy: [],
        },
      ],
    },
  };
}

describe("night sword: every printed-cost eligible spirit", () => {
  it.each(eligible.map((c) => [c.cardNo]))(
    "%s: host battle and effect life/core removal",
    (no) => {
      const state = setup(no);
      expect(
        getUnblockedLifeDamage(battle(state), getDef)?.totalLifeDamage
      ).toBe(3);
      const life = executeCoreMove(
        state,
        "alice",
        { kind: "life", player: "opponent" },
        { kind: "trash", player: "opponent" },
        1,
        "host",
        undefined,
        undefined,
        getDef
      );
      expect(life.players[1]!.lifeNormalCoreCount).toBe(18);
      const removal = executeCoreMove(
        state,
        "alice",
        { kind: "card_instance", instanceId: "target-a" },
        { kind: "reserve", player: "opponent" },
        1,
        "host",
        undefined,
        undefined,
        getDef
      );
      expect(cores(removal, "target-a")).toBe(3);
    }
  );
});

describe("night sword: real effect patterns", () => {
  it.each([0, 1])(
    "Kirito chooses reserve/trash (%s) and moves four",
    (choiceIndex) => {
      let state = run(
        rebuildContinuousEffectsFromField(
          { ...battle(setup("BSSA01-X01")), battleResolutionGroup: null },
          getDef
        ),
        3,
        { choiceIndex }
      );
      expect(state.pendingCoreShootSelection?.totalAmount).toBe(4);
      state = apply(state, "resolve_pending_core_shoot", {
        coreShootDistribution: { "target-a": 2, "target-b": 2 },
      });
      expect(cores(state, "target-a")).toBe(3);
      expect(cores(state, "target-b")).toBe(3);
      expect(
        state.players[1]![
          choiceIndex === 1 ? "trashNormalCoreCount" : "reserveNormalCoreCount"
        ]
      ).toBe(choiceIndex === 1 ? 4 : 9);
    }
  );
  it("Alice exhaust life loss increases, recovery and void placement do not", () => {
    let state = setup("BSSA01-X02");
    state = run(state, 3);
    expect(state.players[1]!.lifeNormalCoreCount).toBe(18);
    state.players[0]!.lifeNormalCoreCount = 5;
    state.players[0]!.trashNormalCoreCount = 1;
    state = run(state, 2);
    expect(state.players[0]!.lifeNormalCoreCount).toBe(6);
    expect(cores(state, "host")).toBe(11);
  });
  it.each(["target-a", "target-b", "ally"])(
    "TX01(A): one each plus one chosen on %s",
    (chosen) => {
      let state = run(
        setup("BSKB01-TX01(A)", [
          enemy("target-a"),
          enemy("target-b"),
          enemy("ally", 5, "alice"),
        ]),
        2
      );
      expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
      expect(
        state.pendingCoreSourceAllocation?.candidates
          .map((c) => c.instanceId)
          .sort()
      ).toEqual(["ally", "target-a", "target-b"]);
      state = apply(state, "resolve_core_source_allocation", {
        coreSourceAllocations: { [chosen]: 1 },
      });
      for (const id of ["target-a", "target-b", "ally"])
        expect(cores(state, id)).toBe(id === chosen ? 3 : 4);
      expect(cores(state, "host")).toBe(10);
    }
  );
  it("TX01(A): additional removal contributes to vanish-count refill", () => {
    let state = run(
      setup("BSKB01-TX01(A)", [enemy("target-a", 2), enemy("target-b", 4)]),
      2
    );
    state = apply(state, "resolve_core_source_allocation", {
      coreSourceAllocations: { "target-a": 1 },
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-a")
    ).toMatchObject({
      zone: "field",
      pendingLeaveKind: "vanish",
    });
    state = apply(state, "resolve_pending_step_optional_choice");
    expect(cores(state, "host")).toBe(11);
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-a")?.zone
    ).toBe("trash");
  });
  it.each([false, true])(
    "TX01(B): life2 + field/reserve one each + shared extra (reserve=%s)",
    (reserve) => {
      let state = run(setup("BSKB01-TX01(B)"), 1);
      expect(state.players[1]!.lifeNormalCoreCount).toBe(18);
      expect(state.pendingCoreShootSelection?.totalAmount).toBe(3);
      expect(() =>
        apply(state, "resolve_pending_core_shoot", {
          coreShootDistribution: { "reserve:bob": 3 },
        })
      ).toThrow(/each source zone/);
      state = apply(state, "resolve_pending_core_shoot", {
        coreShootDistribution: {
          "target-a": reserve ? 1 : 2,
          "reserve:bob": reserve ? 2 : 1,
        },
      });
      expect(cores(state, "target-a")).toBe(reserve ? 4 : 3);
      expect(state.players[1]!.reserveNormalCoreCount).toBe(reserve ? 3 : 4);
      expect(state.players[1]!.trashNormalCoreCount).toBe(5);
    }
  );
  it("TX01(B): without sword each zone still moves only one", () => {
    const initial = setup("BSKB01-TX01(B)");
    initial.cardInstances = initial.cardInstances.filter(
      (c) => c.instanceId !== "sword"
    );
    initial.cardInstances[0]!.attachedChildrenIds = [];
    let state = run(rebuildContinuousEffectsFromField(initial, getDef), 1);
    expect(state.players[1]!.lifeNormalCoreCount).toBe(19);
    expect(state.pendingCoreShootSelection?.totalAmount).toBe(2);
    state = apply(state, "resolve_pending_core_shoot", {
      coreShootDistribution: { "target-a": 1, "reserve:bob": 1 },
    });
    expect(state.players[1]!.trashNormalCoreCount).toBe(3);
  });
  it("detached sword stops all host bonuses", () => {
    const initial = setup("BSSA01-X01");
    initial.cardInstances.find(
      (c) => c.instanceId === "sword"
    )!.attachedToInstanceId = null;
    initial.cardInstances[0]!.attachedChildrenIds = [];
    const state = rebuildContinuousEffectsFromField(initial, getDef);
    expect(getUnblockedLifeDamage(battle(state), getDef)?.totalLifeDamage).toBe(
      2
    );
  });
});

describe("night sword: selection boundaries", () => {
  it.each(["target-a", "target-b"])(
    "core kind choice resumes fixed bonus allocation (%s)",
    (chosen) => {
      const initial = setup("BSKB01-TX01(A)", [
        enemy("target-a", 2),
        enemy("target-b", 5),
      ]);
      initial.players[1]!.soulCoreLocation = {
        kind: "card",
        instanceId: "target-a",
      };
      initial.cardInstances.find(
        (c) => c.instanceId === "target-a"
      )!.soulCoreCount = 1;
      let state = run(initial, 2);
      state = apply(state, "resolve_core_source_allocation", {
        coreSourceAllocations: { [chosen]: 1 },
      });
      expect(state.pendingLifeCoreSelection).not.toBeNull();
      const pending = state.pendingLifeCoreSelection!;
      const action = getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_life_core_selection")!;
      state = applyLegalAction({
        state,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        lifeCorePartitionChoice: {
          normalChosen: pending.totalAmount,
          soulChosen: 0,
        },
      }).state;
      expect(cores(state, "target-b")).toBe(chosen === "target-b" ? 3 : 4);
      expect(state.players[1]!.reserveNormalCoreCount).toBe(8);
    }
  );
});

// Preserve the actual action of every eligible card; isolate only its activation
// gate so each distinct movement route is exercised with a nonempty source.
function removalActions(
  value: unknown
): import("../src/dsl-types").DSL.CoreMoveAction[] {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  const own =
    v.kind === "core_move" && v.from
      ? [value as import("../src/dsl-types").DSL.CoreMoveAction]
      : [];
  return [...own, ...Object.values(v).flatMap(removalActions)];
}
const actionCases = eligible.flatMap((card) =>
  removalActions(card.effects)
    .filter(
      (action) =>
        (("player" in action.from && action.from.player === "opponent") ||
          action.from.kind === "target_card") &&
        (typeof action.amount === "number" ||
          action.amount === "all" ||
          (typeof action.amount === "object" &&
            "max" in action.amount &&
            typeof action.amount.max === "number"))
    )
    .map((action, index) => ({ no: card.cardNo, index, action }))
);
describe("night sword: all concrete opponent movement actions", () => {
  it.each(actionCases)("$no action $index", ({ no, action }) => {
    const fieldCard = action.from.kind === "field_card";
    const targetSpec =
      action.target && "filter" in action.target
        ? action.target.filter
        : undefined;
    const nexus = fieldCard || targetSpec?.category?.includes("nexus");
    const targetDef = nexus
      ? definitions.find(
          (c) =>
            c.printedCategory === "nexus" &&
            c.grandwalkerData &&
            c.tribe?.includes("創界神")
        )!
      : getDef("BSSA01-C01")!;
    const target = createCardInstance(targetDef, {
      instanceId: "target-a",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 10,
      exhaustState: "exhausted",
    });
    const initial = setup(no, [target]);
    const base =
      action.amount === "all"
        ? 10
        : typeof action.amount === "number"
          ? action.amount
          : (action.amount as { max: number }).max;
    let state = executeEffect({
      chainId: "test:bssa01-night-sword-combination-audit:403",
      state: initial,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action }],
      },
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      rangeAutoResolveStrategy: "max",
      targetInstanceIds: ["target-a"],
    });
    if (state.pendingCoreShootSelection) {
      const reserve =
        action.from.kind === "field" && action.from.eachZone ? 1 : 0;
      state = apply(state, "resolve_pending_core_shoot", {
        coreShootDistribution: {
          "target-a": state.pendingCoreShootSelection.totalAmount - reserve,
          ...(reserve ? { "reserve:bob": reserve } : {}),
        },
      });
    }
    if (action.from.kind === "life")
      expect(state.players[1]!.lifeNormalCoreCount).toBe(20 - base - 1);
    else expect(cores(state, "target-a")).toBe(10 - Math.min(10, base + 1));
  });
});

describe("night sword: dynamic counts and life selection", () => {
  it("Galacta Knight uses actual prior life loss plus one", () => {
    const initial = setup("BSKB01-M02");
    const action = removalActions(getDef("BSKB01-M02")!.effects).find(
      (a) => a.from.kind === "life" && a.from.player === "opponent"
    )!;
    const ctx = createStepExecutionContext();
    recordStepResult(ctx, {
      stepId: "self-life-to-one",
      affectedCardInstanceIds: [],
      succeeded: true,
      numericAmount: 3,
    });
    const state = executeEffect({
      chainId: "test:bssa01-night-sword-combination-audit:446",
      state: initial,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action }],
      },
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      restoredStepContext: serializeStepContext(ctx),
    });
    expect(state.players[1]!.lifeNormalCoreCount).toBe(16);
  });
  it("shadow-count removal increases the selectable maximum once", () => {
    const initial = setup("BSSL01-M01", [enemy("target-a", 10)]);
    const action = removalActions(getDef("BSSL01-M01")!.effects).find(
      (a) => a.from.kind === "field"
    )!;
    const shadowDef = definitions.find(
      (c) => c.printedCategory === "spirit" && c.tribe === "影"
    )!;
    expect(shadowDef).toBeDefined();
    initial.cardInstances.push(
      createCardInstance(shadowDef, {
        instanceId: "shadow",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state = executeEffect({
      chainId: "test:bssa01-night-sword-combination-audit:476",
      state: initial,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action }],
      },
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: ["target-a"],
    });
    expect(state.pendingCoreShootSelection?.totalAmount).toBe(3);
  });
  it("life core-kind selection does not reapply the life bonus", () => {
    const initial = setup("BSSA01-X02");
    initial.players[1]!.soulCoreLocation = { kind: "life" };
    let state = run(initial, 3);
    expect(state.pendingLifeCoreSelection?.totalAmount).toBe(2);
    expect(state.pendingLifeCoreSelection?.continuation?.chainId).toBe(
      "test:bssa01-night-sword-combination-audit:77"
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_life_core_selection")!;
    state = applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      lifeCorePartitionChoice: { normalChosen: 2, soulChosen: 0 },
    }).state;
    expect(state.players[1]!.lifeNormalCoreCount).toBe(18);
    expect(state.players[1]!.soulCoreLocation).toEqual({ kind: "life" });
  });
  it("zero life movement cannot create damage", () => {
    const initial = setup("BSSA01-X02");
    const state = executeCoreMove(
      initial,
      "alice",
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      0,
      "host",
      undefined,
      undefined,
      getDef
    );
    expect(state.players[1]!.lifeNormalCoreCount).toBe(20);
  });
});

it("TX01(B): reserve soul satisfies its zone minimum without creating normal cores", () => {
  const initial = setup("BSKB01-TX01(B)");
  initial.players[1]!.reserveNormalCoreCount = 0;
  initial.players[1]!.soulCoreLocation = { kind: "reserve" };
  let state = run(initial, 1);
  expect(() =>
    apply(state, "resolve_pending_core_shoot", {
      coreShootDistribution: { "target-a": 2, "reserve:bob": 1 },
    })
  ).toThrow(/normal cores/);
  state = apply(state, "resolve_pending_core_shoot", {
    coreShootDistribution: { "target-a": 2 },
    coreShootSoulCoreInstanceId: "reserve:bob",
  });
  expect(state.players[1]!.trashNormalCoreCount).toBe(4);
  expect(state.players[1]!.reserveNormalCoreCount).toBe(0);
  expect(state.players[1]!.soulCoreLocation).toEqual({ kind: "trash" });
});

describe("night sword: combine conditions", () => {
  it.each([1, 2])("count %s is checked before combining", (count) => {
    const state = setup("BSSA01-X01");
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    const brave = state.cardInstances.find((c) => c.instanceId === "sword")!;
    host.attachedChildrenIds = [];
    brave.attachedToInstanceId = null;
    state.players[0]!.countValue = count;
    expect(
      isEligibleBraveCombineHost({
        state,
        host,
        hostDefinition: getDef(host.definitionId)!,
        incomingBraveCondition: sword.braveCondition,
        incomingBrave: brave,
        incomingBraveDef: sword,
        getCardDefinitionById: getDef,
      })
    ).toBe(count >= 2);
  });
});

it.each([false, true])(
  "TX01(B): one-choice training limit retains a valid zone allocation (soul=%s)",
  (soul) => {
    const initial = setup("BSKB01-TX01(B)");
    if (soul) {
      initial.players[1]!.reserveNormalCoreCount = 0;
      initial.players[1]!.soulCoreLocation = { kind: "reserve" };
    }
    const state = run(initial, 1);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_shoot")!;
    const node = createActionInputDecisionNode(state, action, {
      maxGeneratedChoices: 1,
    });
    expect(node?.choices).toHaveLength(1);
    const choice = node!.choices[0]!;
    expect(choice.applyOptions).toBeDefined();
    expect(() =>
      applyLegalAction({
        state,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        ...choice.applyOptions,
      })
    ).not.toThrow();
  }
);
