/**
 * コスト軽減下限（floor）プリミティブの回帰テスト。
 *
 * `cost_modify` 自己対象 `modifier:{ floor:N }` の継続効果で、軽減後コストを
 * `max(floor, printed - reduction)` にクランプする（10_rules/03a §コスト軽減下限）。
 * - 「このカードの配置コストは0にならない」= floor:1（BSTH06-X01 / BSTH03-X02）
 * - 「Nコスト以上支払わなければ召喚できない」= floor:N（BSTH06-X03）
 *
 * calculateReduction は SSOT のため、availability / resolution / accel すべてに反映される。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { calculateReduction } from "../src/core/cost-system";
import { executeSummonOther } from "../src/effect/structured-summon";
import { canAutoExecuteSummonFromZoneCandidate } from "../src/effect/summon-from-zone-candidates";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src";

const defMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => defMap.get(id);

const PLAYER = "p1";

/** 指定シンボルの単色スピリットをフィールドに置いた state を作る（軽減供給源）。 */
function stateWithFieldSymbols(suppliers: readonly string[]): GameState {
  const instances: CardInstance[] = suppliers.map((cardNo, idx) =>
    createCardInstance(getDef(cardNo)!, {
      instanceId: `supplier-${idx}`,
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
    })
  );
  return createEmptyGameState({
    playerIds: [PLAYER, "p2"],
    cardInstances: instances,
  });
}

function reduce(cardNo: string, state: GameState): number {
  const card = getDef(cardNo)!;
  return calculateReduction({
    state,
    actingPlayerId: PLAYER,
    card,
    getCardDefinitionById: getDef,
  }).reducedCost;
}

function resolveMinimumPlacement(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: PLAYER,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    multiPlacementAllocations: action!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements: [{ kind: "reserve_normal", amount: target.minimumCoreCount }],
    })),
  }).state;
}

function additionalCostDeltaCE(amount: number): ContinuousEffect {
  return {
    effectId: `ce-additional-cost-${amount}`,
    sourceInstanceId: "source",
    sourceDefinitionId: "BSDB01-C02",
    actingPlayerId: PLAYER,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: { player: "self", category: ["ultimate"] },
  };
}

describe("コスト軽減下限 (cost_modify floor)", () => {
  it("BSTH06-X01 配置コストは0にならない (floor:1): 軽減過多でも 1 に留まる", () => {
    // reductionSymbols [red, green] cost 2。red+green 供給で 2 軽減できるが floor:1 で 1。
    const state = stateWithFieldSymbols(["BSDB01-C01", "BSGE01-CX02"]);
    expect(reduce("BSTH06-X01", state)).toBe(1);
  });

  it("BSTH06-X01: 供給なしなら印字コスト 2 (floor 未満には届かない=印字のまま)", () => {
    const state = stateWithFieldSymbols([]);
    expect(reduce("BSTH06-X01", state)).toBe(2);
  });

  it("BSTH06-X03 2コスト以上支払わなければ召喚できない (floor:2): 軽減シンボル2個で 4 (floor 未満には下がらない)", () => {
    // reductionSymbols [red, green] cost 6。シンボル軽減は最大 2（red+green）→ reducedCost 4。
    // floor:2 は 4 を下回らないので非作用だが、override/free 等が乗っても 2 未満には下げない保証。
    const state = stateWithFieldSymbols([
      "BSDB01-C01",
      "BSDB01-C01",
      "BSDB01-C01",
      "BSDB01-C01",
      "BSGE01-CX02",
      "BSGE01-CX02",
    ]);
    expect(reduce("BSTH06-X03", state)).toBe(4);
  });

  it("BSTH06-X03: 部分軽減 (red×1) → 5", () => {
    const state = stateWithFieldSymbols(["BSDB01-C01"]);
    expect(reduce("BSTH06-X03", state)).toBe(5);
  });

  it("BSTH03-X02 配置コスト0にならない (floor:1): yellow+purple 全軽減でも 1", () => {
    // reductionSymbols [yellow, purple] cost 2。
    const state = stateWithFieldSymbols(["BSAZ01-C01", "BSGE01-CX03"]);
    expect(reduce("BSTH03-X02", state)).toBe(1);
  });

  it("BSTH05.5-C01 召喚コストは0にならない (floor:1): blue×3 全軽減でも 1", () => {
    // reductionSymbols [blue, blue, ultimate_symbol, blue] cost 3。
    const state = stateWithFieldSymbols([
      "BSDB01-C02",
      "BSDB01-C02",
      "BSDB01-C02",
    ]);
    expect(reduce("BSTH05.5-C01", state)).toBe(1);
  });

  it("BSTH03-C01 召喚コストは0にならない (floor:1): purple+yellow+ultimate_symbol 全軽減でも 1", () => {
    // reductionSymbols [purple, yellow, ultimate_symbol] cost 3。
    const state = stateWithFieldSymbols([
      "BSGE01-CX03",
      "BSAZ01-C01",
      "BSAZ02-C01",
    ]);
    expect(reduce("BSTH03-C01", state)).toBe(1);
  });

  it("BSTH03-C01: effects[0] DSL 形状 (stub 解消 / cost_modify floor:1)", () => {
    const def = getDef("BSTH03-C01")!;
    expect(def.effects![0]!.stub).toBeUndefined();
    const step = def.effects![0]!.steps[0]!.action;
    expect(step.kind).toBe("cost_modify");
    if (step.kind === "cost_modify") {
      expect(step.target).toEqual({ kind: "self" });
      expect(step.modifier).toEqual({ floor: 1 });
    }
  });

  it("BSTH05.5-C01: effects[0] DSL 形状 (stub 解消 / cost_modify floor:1)", () => {
    const def = getDef("BSTH05.5-C01")!;
    expect(def.effects![0]!.stub).toBeUndefined();
    const step = def.effects![0]!.steps[0]!.action;
    expect(step.kind).toBe("cost_modify");
    if (step.kind === "cost_modify") {
      expect(step.target).toEqual({ kind: "self" });
      expect(step.modifier).toEqual({ floor: 1 });
    }
  });

  it("BSTH05.5-C01 costModifier:free 召喚でも floor:1 を下回らない", () => {
    const source = createCardInstance(getDef("BSDB01-C02")!, {
      instanceId: "source",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(getDef("BSTH05.5-C01")!, {
      instanceId: "kanameishi",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      cardInstances: [source, target],
    });

    const after = resolveMinimumPlacement(
      executeSummonOther(
        state,
        "test:cost-floor.test.ts:summon",
        PLAYER,
        {
          kind: "summon",
          target: "other",
          zone: "hand",
          withoutCost: true,
        },
        source.instanceId,
        getDef
      )
    );

    const player = after.players.find((p) => p.id === PLAYER)!;
    const summoned = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(player.reserveNormalCoreCount).toBe(0);
    expect(player.trashNormalCoreCount).toBe(1);
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);
  });

  it("BSTH05.5-C01 withoutCost+floor の支払い不能時は召喚しない", () => {
    const source = createCardInstance(getDef("BSDB01-C02")!, {
      instanceId: "source",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(getDef("BSTH05.5-C01")!, {
      instanceId: "kanameishi",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
      cardInstances: [source, target],
    });

    const after = executeSummonOther(
      state,
      "test:cost-floor.test.ts:summon",
      PLAYER,
      {
        kind: "summon",
        target: "other",
        zone: "hand",
        withoutCost: true,
      },
      source.instanceId,
      getDef
    );

    const summoned = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(summoned.zone).toBe("hand");
    expect(after.log).toContain(
      "effect:summon:kanameishi:insufficient-cost:required=1"
    );
  });

  it("BSTH05.5-C01 withoutCost+floor は additionalCostValue:-1 が重なっても 0 にならない", () => {
    const source = createCardInstance(getDef("BSDB01-C02")!, {
      instanceId: "source",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(getDef("BSTH05.5-C01")!, {
      instanceId: "kanameishi",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const action = {
      kind: "summon" as const,
      target: "other" as const,
      zone: "hand" as const,
      withoutCost: true,
      summonCause: "effect" as const,
    };
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      playerOverrides: [{ reserveNormalCoreCount: 2, handCount: 1 }, {}],
      cardInstances: [source, target],
      activeContinuousEffects: [additionalCostDeltaCE(-1)],
    });

    expect(
      canAutoExecuteSummonFromZoneCandidate({
        state,
        actingPlayerId: PLAYER,
        action,
        candidate: target,
        getCardDefinitionById: getDef,
      })
    ).toBe(true);

    const after = resolveMinimumPlacement(
      executeSummonOther(
        state,
        "test:cost-floor.test.ts:summon",
        PLAYER,
        action,
        source.instanceId,
        getDef
      )
    );

    const player = after.players.find((p) => p.id === PLAYER)!;
    const summoned = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(player.reserveNormalCoreCount).toBe(0);
    expect(player.trashNormalCoreCount).toBe(1);
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);
  });

  it("BSTH05.5-C01 withoutCost+floor の維持コア不足で直叩きした場合は配置 pending を中止して宣言前へ戻す", () => {
    const source = createCardInstance(getDef("BSDB01-C02")!, {
      instanceId: "source",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(getDef("BSTH05.5-C01")!, {
      instanceId: "kanameishi",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const action = {
      kind: "summon" as const,
      target: "other" as const,
      zone: "hand" as const,
      withoutCost: true,
    };
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      playerOverrides: [{ reserveNormalCoreCount: 1, handCount: 1 }, {}],
      cardInstances: [source, target],
    });

    expect(
      canAutoExecuteSummonFromZoneCandidate({
        state,
        actingPlayerId: PLAYER,
        action,
        candidate: target,
        getCardDefinitionById: getDef,
      })
    ).toBe(false);

    const pending = executeSummonOther(
      state,
      "test:cost-floor.test.ts:summon",
      PLAYER,
      action,
      source.instanceId,
      getDef
    );
    const abortAction = getLegalActions({
      state: pending,
      actingPlayerId: PLAYER,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((candidate) => candidate.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();
    const after = applyLegalAction({
      state: pending,
      action: abortAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    const player = after.players.find((p) => p.id === PLAYER)!;
    const summoned = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(player.reserveNormalCoreCount).toBe(1);
    expect(player.trashNormalCoreCount).toBe(0);
    expect(player.handCount).toBe(1);
    expect(summoned.zone).toBe("hand");
    expect(after.pendingMultiPlacement).toBeNull();
  });

  it("BSTH05.5-C01 placement 指定ありの withoutCost+floor でも floor:1 を支払う", () => {
    const source = createCardInstance(getDef("BSDB01-C02")!, {
      instanceId: "source",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
    });
    const target = createCardInstance(getDef("BSTH05.5-C01")!, {
      instanceId: "kanameishi",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      cardInstances: [source, target],
    });

    const after = executeSummonOther(
      state,
      "test:cost-floor.test.ts:summon",
      PLAYER,
      {
        kind: "summon",
        target: "other",
        zone: "hand",
        withoutCost: true,
      },
      source.instanceId,
      getDef,
      undefined,
      [{ kind: "reserve_normal", amount: 1 }]
    );

    const player = after.players.find((p) => p.id === PLAYER)!;
    const summoned = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(player.reserveNormalCoreCount).toBe(0);
    expect(player.trashNormalCoreCount).toBe(1);
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);
  });

  it("floor は印字コストを超えない: 供給なしでも floor で水増ししない", () => {
    // BSTH06-X01 (cost 2, floor 1) 供給なし → 2 のまま（floor で 1 に下げない、上げない）。
    const state = stateWithFieldSymbols([]);
    expect(reduce("BSTH06-X01", state)).toBe(2);
  });

  // BSTH02.5-X01 伊吹 萃香: 「2コスト以上支払わなければ召喚できない」= floor:2。
  // BSTH06-X03 同型 (cost 6 / reductionSymbols [green,red])。
  it("BSTH02.5-X01 2コスト以上支払わなければ召喚できない (floor:2): 全軽減 (green+red) で 4", () => {
    const state = stateWithFieldSymbols(["BSGE01-CX02", "BSDB01-C01"]);
    expect(reduce("BSTH02.5-X01", state)).toBe(4);
  });

  it("BSTH02.5-X01: effects[0] DSL 形状 (stub 解消 / cost_modify floor:2)", () => {
    const def = getDef("BSTH02.5-X01")!;
    expect(def.effects![0]!.stub).toBeUndefined();
    const step = def.effects![0]!.steps[0]!.action;
    expect(step.kind).toBe("cost_modify");
    if (step.kind === "cost_modify") {
      expect(step.target).toEqual({ kind: "self" });
      expect(step.modifier).toEqual({ floor: 2 });
    }
  });
});
