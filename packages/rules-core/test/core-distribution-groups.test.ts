import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  canAddCoreDistributionCore,
  isCoreDistributionAllocationValid,
  getCoreDistributionAllocationCapacity,
  type GameState,
} from "../src";
import { coreDistributionChoices } from "../src/action-input-choices";

const defs = new Map(ALL_CARDS.map((d) => [d.cardNo, d]));
const getDef = (id: string) => defs.get(id);
function fixture(cardNo = "BSTH11-R03", owner = "alice", contract = false) {
  const field = (no: string, id: string, player = owner) =>
    createCardInstance(getDef(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      cores: 1,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      field(cardNo, "source"),
      field("BSTH11-X02", "dual"),
      field("BSTH11-C01", "fantasy"),
      field("BSTH11-X01", "secret"),
      field("BSTH11-C01", "enemy", owner === "alice" ? "bob" : "alice"),
      ...Array.from({ length: 3 }, (_, i) =>
        createCardInstance(getDef("BSTH11-C04")!, {
          instanceId: `deck-${i}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      id,
      voidNormalCoreCount: 20,
      trashNormalCoreCount: 3,
      ...(id === owner && contract ? { contractCardNo: "BSTH11-C01" } : {}),
    })),
  });
  return executeEffect({
    state,
    chainId: "test:core-distribution-groups",
    sourceInstanceId: "source",
    actingPlayerId: owner,
    effect: getDef(cardNo)!.effects![cardNo === "BSTH11-R03" ? 1 : 0]!,
    effectIndex: cardNo === "BSTH11-R03" ? 1 : 0,
    getCardDefinitionById: getDef,
  });
}
function apply(state: GameState, kind: string, payload = {}) {
  const owner =
    state.pendingCoreDistribution?.actingPlayerId ??
    state.pendingStepOptionalChoice?.choosingPlayerId ??
    "alice";
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    getCardDefinitionById: getDef,
  }).find(
    (a) => a.kind === kind && (!("choice" in a) || a.choice === "execute")
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    ...payload,
  }).state;
}
const begin = (owner = "alice", contract = false) =>
  apply(
    fixture("BSTH11-R03", owner, contract),
    "resolve_pending_step_optional_choice"
  );

describe("共有枠のコア配分", () => {
  it("通常とソウルの合算で上限に達したら追加候補をなくす", () => {
    const constraints = {
      candidates: [
        { instanceId: "a", definitionId: "a" },
        { instanceId: "b", definitionId: "b" },
      ],
      maxTotal: 2,
    };
    expect(canAddCoreDistributionCore(constraints, { a: 1 }, {}, "b")).toBe(
      true
    );
    expect(
      canAddCoreDistributionCore(constraints, { a: 1 }, { b: 1 }, "b")
    ).toBe(false);
  });
  it.each(["alice", "bob"])(
    "%s: 種類横断のHUD1回と支払い付きドローだけで解決",
    (owner) => {
      const state = begin(owner);
      const pending = state.pendingCoreDistribution!;
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(pending.totalNormalCores).toBe(2);
      expect(pending.candidates.map((c) => c.instanceId)).toEqual(
        expect.arrayContaining(["source", "dual", "fantasy", "secret"])
      );
      expect(pending.candidates.map((c) => c.instanceId)).not.toContain(
        "enemy"
      );
      expect(
        canAddCoreDistributionCore(pending, { dual: 1 }, {}, "source")
      ).toBe(true);
      expect(canAddCoreDistributionCore(pending, { dual: 1 }, {}, "dual")).toBe(
        false
      );
      expect(
        canAddCoreDistributionCore(pending, { source: 1 }, {}, "fantasy")
      ).toBe(false);
      expect(
        canAddCoreDistributionCore(pending, { source: 1 }, {}, "secret")
      ).toBe(true);
      const selected = apply(state, "resolve_pending_core_distribution", {
        coreDistributionAllocations: { source: 1, secret: 1 },
      });
      expect(selected.pendingCoreDistribution).toBeNull();
      expect(selected.pendingStepOptionalChoice?.stepIndex).toBe(1);
      const done = apply(selected, "resolve_pending_step_optional_choice");
      expect(done.pendingStepOptionalChoice).toBeNull();
      expect(
        done.cardInstances.find((c) => c.instanceId === "source")!
          .normalCoreCount
      ).toBe(2);
      expect(
        done.cardInstances.find((c) => c.instanceId === "secret")!
          .normalCoreCount
      ).toBe(2);
      expect(
        done.players.find((p) => p.id === owner)!.voidNormalCoreCount
      ).toBe(21);
      expect(
        done.players.find((p) => p.id === owner)!.trashNormalCoreCount
      ).toBe(0);
      expect(
        done.cardInstances.filter(
          (c) => c.ownerPlayerId === owner && c.zone === "hand"
        )
      ).toHaveLength(2);
    }
  );
  it.each([{}, { dual: 1 }])("途中完了 %j でも後段へ進む", (allocations) => {
    const after = apply(begin(), "resolve_pending_core_distribution", {
      coreDistributionAllocations: allocations,
    });
    expect(after.pendingStepOptionalChoice?.stepIndex).toBe(1);
  });
  it.each([
    { dual: 2 },
    { source: 1, fantasy: 1 },
    { secret: 1, dual: 1, source: 1 },
  ])("違法配分 %j をREST/直接入力でも拒否", (allocations) => {
    const state = begin();
    expect(() =>
      apply(state, "resolve_pending_core_distribution", {
        coreDistributionAllocations: allocations,
      })
    ).toThrow();
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")!
        .normalCoreCount
    ).toBe(1);
  });
  it("契約中は配分確定で終了", () => {
    const after = apply(
      begin("alice", true),
      "resolve_pending_core_distribution",
      { coreDistributionAllocations: { dual: 1 } }
    );
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.players[0]!.trashNormalCoreCount).toBe(3);
  });
  it("AIの候補も同じ共有枠を守り最大配置と途中完了を含む", () => {
    const state = begin();
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    if (action.kind !== "resolve_pending_core_distribution")
      throw Error("distribution");
    const choices = coreDistributionChoices(state, action, 1000).values;
    expect(
      choices.some(
        (c) => Object.keys(c.coreDistributionAllocations ?? {}).length === 0
      )
    ).toBe(true);
    expect(
      choices.some(
        (c) =>
          c.coreDistributionAllocations?.dual === 1 &&
          c.coreDistributionAllocations?.source === 1
      )
    ).toBe(true);
    for (const choice of choices)
      expect(
        isCoreDistributionAllocationValid(
          action,
          choice.coreDistributionAllocations ?? {}
        )
      ).toBe(true);
  });
  it("重なる共有枠の最大数と割り当てを配置順に依存せず求める", () => {
    const constraints = {
      candidates: [
        { instanceId: "a", definitionId: "a" },
        { instanceId: "b", definitionId: "b" },
        { instanceId: "c", definitionId: "c" },
      ],
      maxPerCandidate: 1,
      allocationGroups: [
        { candidateInstanceIds: ["a", "b"], maxCount: 1 },
        { candidateInstanceIds: ["a", "c"], maxCount: 1 },
        { candidateInstanceIds: ["a"], maxCount: 1 },
      ],
    };
    expect(getCoreDistributionAllocationCapacity(constraints, 6)).toBe(3);
    expect(
      isCoreDistributionAllocationValid(constraints, { a: 1, b: 1, c: 1 })
    ).toBe(true);
    expect(
      isCoreDistributionAllocationValid(constraints, { a: 1 }, { a: 1 })
    ).toBe(false);
  });
  it("BSLH01-X04にも1体1個の配分HUDを使う", () => {
    const def = getDef("BSLH01-X04")!;
    const cards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(def, {
        instanceId: `cb-${i}`,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    });
    const executing = executeEffect({
      state,
      chainId: "test:cb-distribution",
      sourceInstanceId: "cb-0",
      actingPlayerId: "alice",
      effect: def.effects![0]!,
      effectIndex: 0,
      getCardDefinitionById: getDef,
    });
    const choosing = apply(executing, "resolve_pending_step_optional_choice");
    expect(choosing.pendingCoreDistribution?.totalNormalCores).toBe(4);
    expect(choosing.pendingCoreDistribution?.maxPerCandidate).toBe(1);
    expect(() =>
      apply(choosing, "resolve_pending_core_distribution", {
        coreDistributionAllocations: { "cb-0": 2 },
      })
    ).toThrow();
    const after = apply(choosing, "resolve_pending_core_distribution", {
      coreDistributionAllocations: { "cb-1": 1, "cb-3": 1 },
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "cb-1")!.normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "cb-3")!.normalCoreCount
    ).toBe(2);
  });
});
