import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  createCardInstance,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
} from "@orica/rules-core";
import { buildEmptyTargetSelectionScenario } from "../src/scenario-empty-target-selection";

const lookups = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
};

describe("対象不在の対象選択", () => {
  it("一方の対象グループだけが空でも、生存グループの選択は省略できない", () => {
    const state = buildEmptyTargetSelectionScenario(
      ALL_CARDS,
      new URLSearchParams({ target: "departed" })
    );
    state.cardInstances.push(
      createCardInstance(lookups.getCardDefinitionById("BSTH01-C01")!, {
        instanceId: "survivor",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const pending = state.pendingEffectTargetSelection!;
    pending.candidateInstanceIds = [
      ...pending.candidateInstanceIds,
      "survivor",
    ];
    pending.targetGroups = pending.targetGroups!.map((group, index) =>
      index === 1
        ? { ...group, candidateTargetInstanceIds: ["survivor"] }
        : group
    );
    pending.deferredStack.targetGroups = pending.targetGroups;
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(action.requiredTargetCount).toBe(1);
    expect(action.targetGroups?.map((g) => g.requiredTargetCount)).toEqual([
      0, 1,
    ]);
    expect(action.candidateTargetInstanceIds).toEqual(["survivor"]);
    expect(() =>
      applyLegalAction({ state, action, targetInstanceIds: [], ...lookups })
    ).toThrow();
    expect(() =>
      applyLegalAction({
        state,
        action,
        targetInstanceIds: ["empty-target-opponent"],
        ...lookups,
      })
    ).toThrow();
    const next = applyLegalAction({
      state,
      action,
      targetInstanceIds: ["survivor"],
      ...lookups,
    }).state;
    expect(next.pendingEffectTargetSelection).toBeNull();
    expect(
      next.cardInstances.find((c) => c.instanceId === "survivor")?.zone
    ).toBe("deck");
    expect(
      next.cardInstances.find((c) => c.instanceId === "empty-target-opponent")
        ?.zone
    ).toBe("trash");
  });

  it("選択待ちの間に全候補が離脱しても、対象グループを空選択で解決できる", () => {
    const original = buildEmptyTargetSelectionScenario(
      ALL_CARDS,
      new URLSearchParams({ target: "present" })
    );
    const state = {
      ...original,
      cardInstances: original.cardInstances.map((c) =>
        c.instanceId === "empty-target-opponent"
          ? { ...c, zone: "trash" as const }
          : c
      ),
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(action.candidateTargetInstanceIds).toEqual([]);
    expect(action.requiredTargetCount).toBe(0);
    const next = applyLegalAction({
      state,
      action,
      targetInstanceIds: [],
      ...lookups,
    }).state;
    expect(next.pendingEffectTargetSelection).toBeNull();
    expect(
      next.cardInstances.find((c) => c.instanceId === "empty-target-opponent")
        ?.zone
    ).toBe("trash");
  });

  for (const owner of ["alice", "bob"]) {
    it(`${owner}: 空選択で解決し、フラッシュに進む`, () => {
      const state = buildEmptyTargetSelectionScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const pending = state.pendingEffectTargetSelection!;
      expect(pending.candidateInstanceIds).toEqual([]);
      expect(pending.requiredTargetCount).toBe(0);
      expect(pending.maxTargetCount).toBe(0);
      expect(pending.targetGroups).toHaveLength(2);
      const action = getLegalActions({
        state,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_effect_target")!;
      const next = applyLegalAction({
        state,
        action,
        targetInstanceIds: [],
        ...lookups,
      }).state;
      expect(next.pendingEffectTargetSelection).toBeNull();
      const openFlash = getLegalActions({
        state: next,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => a.kind === "open_battle_flash");
      expect(openFlash).toBeDefined();
      expect(
        applyLegalAction({ state: next, action: openFlash!, ...lookups }).state
          .activeAttack?.flashWindowState?.kind
      ).toBe("before_block");
      expect(
        next.cardInstances.find((c) => c.instanceId === "empty-target-source")
          ?.zone
      ).toBe("field");
    });
  }

  it("候補がある場合は2回の選択を必須とし、選んだカードをデッキへ戻す", () => {
    const state = buildEmptyTargetSelectionScenario(
      ALL_CARDS,
      new URLSearchParams({ target: "present" })
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target")!;
    expect(action.requiredTargetCount).toBe(2);
    expect(() =>
      applyLegalAction({ state, action, targetInstanceIds: [], ...lookups })
    ).toThrow();
    const next = applyLegalAction({
      state,
      action,
      targetInstanceIds: ["empty-target-opponent", "empty-target-opponent"],
      ...lookups,
    }).state;
    expect(next.pendingEffectTargetSelection).toBeNull();
    expect(
      next.cardInstances.find((c) => c.instanceId === "empty-target-opponent")
        ?.zone
    ).toBe("deck");
  });
});
