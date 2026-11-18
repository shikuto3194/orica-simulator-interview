import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildCoreSourceUnionScenario } from "../../../apps/playground-web/src/scenario-core-source-union";
import { buildPendingCoreHud } from "../../../apps/playground-web/src/utils/core-hud-pending";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  executeEffect,
  generateSoulCoreOutsideGame,
  getLegalActions,
  restoreSnapshot,
  withSoulCoreLocation,
} from "../src";
import type { GameState } from "../src";

const map = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookup = {
  getCardDefinitionById: (id: string) => map.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};
const scenario = (card = "BSTH02-X01", owner = "alice", stage = "pending") =>
  buildCoreSourceUnionScenario(
    ALL_CARDS,
    new URLSearchParams({ card, owner, stage })
  );
function select(state: GameState, id: string, soul = false) {
  const action = getLegalActions({
    state,
    actingPlayerId: state.pendingCoreSourceAllocation!.actingPlayerId,
    ...lookup,
  }).find((a) => a.kind === "resolve_core_source_allocation")!;
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action,
    ...lookup,
    coreSourceAllocations: soul ? {} : { [id]: 1 },
    ...(soul ? { coreSourceSoulCoreInstanceId: id } : {}),
  }).state;
}
function execute(state: GameState, card: string) {
  const effectIndex =
    card === "BSTH02-X01" ? 1 : card === "BSTH02.7-X02" ? 3 : 0;
  return executeEffect({
    chainId: "test:core-source-union:45",
    state,
    effect: map.get(card)!.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: "sc-core-union-source",
    actingPlayerId: state.activePlayerId,
    optionalExecuteResumeStepIndex: 0,
    ...lookup,
  });
}

describe("core source union", () => {
  it.each(["alice", "bob"])(
    "%s sees both players' field/reserve, with independent cores explicitly included",
    (owner) => {
      const state = scenario("BSTH02-X01", owner);
      expect(state.pendingStepChoice).toBeNull();
      expect(
        state.pendingCoreSourceAllocation?.candidates
          .map((c) => c.instanceId)
          .sort()
      ).toEqual(
        [
          "reserve:alice",
          "reserve:bob",
          "sc-core-union-own",
          "sc-core-union-opponent",
          "sc-core-union-guided",
          "sc-core-union-grandwalker",
        ].sort()
      );
      expect(
        state.pendingCoreSourceAllocation?.candidates.every(
          (c) => !c.hasSoulCore
        )
      ).toBe(true);
    }
  );
  it.each([
    "reserve:alice",
    "reserve:bob",
    "sc-core-union-own",
    "sc-core-union-opponent",
    "sc-core-union-guided",
    "sc-core-union-grandwalker",
  ])("moves selected %s once and resumes vanish accounting", (id) => {
    const before = scenario();
    const after = select(before, id);
    const owner =
      id === "reserve:bob" || id === "sc-core-union-opponent" ? "bob" : "alice";
    if (id.startsWith("reserve:")) {
      expect(
        after.players.find((p) => p.id === owner)!.reserveNormalCoreCount
      ).toBe(4);
    } else {
      expect(
        after.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount
      ).toBe(
        before.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount -
          1
      );
    }
    const vanished =
      id === "sc-core-union-own" || id === "sc-core-union-opponent";
    expect(
      after.cardInstances.find((c) => c.instanceId === "sc-core-union-source")!
        .normalCoreCount
    ).toBe(vanished ? 3 : 2);
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(after.pendingStepChoice).toBeNull();
  });
  it("HUD preserves opponent reserve ownership and keeps legacy card candidates compatible", () => {
    const state = scenario();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookup,
    });
    const hud = buildPendingCoreHud(state, actions)!;
    expect(hud.title).toBe("移動するコアを選択");
    const source = hud.sources.find((s) => s.id === "reserve:bob")!;
    expect(
      hud.confirm([{ kind: "normal", from: source.from }] as Parameters<
        typeof hud.confirm
      >[0]).payload
    ).toMatchObject({ coreSourceAllocations: { "reserve:bob": 1 } });
  });
  it.each(["sc-core-union-source", "life:alice", "void:alice", "missing"])(
    "rejects noncandidate %s without mutating the saved state",
    (id) => {
      const before = scenario();
      const saved = structuredClone(before);
      expect(() => select(before, id)).toThrow();
      expect(before).toEqual(saved);
    }
  );
  it("rechecks normal-core protection when the snapshot candidate becomes stale", () => {
    const before = scenario();
    before.activeContinuousEffects = [
      ...before.activeContinuousEffects,
      {
        effectId: "protect",
        sourceInstanceId: "sc-core-union-own",
        sourceDefinitionId: "BSTH001-R01",
        actingPlayerId: "alice",
        targetInstanceId: "sc-core-union-own",
        modifierTag: "prevent_normal_core_move",
        duration: { scope: "turn" },
        createdAtTurn: 4,
        createdAtAttackId: null,
      },
    ];
    expect(() => select(before, "sc-core-union-own")).toThrow();
    expect(
      before.cardInstances.find((c) => c.instanceId === "sc-core-union-own")!
        .normalCoreCount
    ).toBe(1);
  });
  it("excludes soul-state and grandstone cards from the union", () => {
    const state = scenario("BSTH02-X01", "alice", "before");
    const stone = ALL_CARDS.find((c) => c.grandstoneData)!;
    state.cardInstances.push(
      createCardInstance(stone, {
        instanceId: "stone",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      })
    );
    state.players[0]!.soulStateInstanceIds = ["sc-core-union-own"];
    const ids = execute(
      state,
      "BSTH02-X01"
    ).pendingCoreSourceAllocation!.candidates.map((c) => c.instanceId);
    expect(ids).not.toContain("stone");
    expect(ids).not.toContain("sc-core-union-own");
  });
  it.each(["void:alice", "sc-core-union-guided"])(
    "Shanghai chooses %s, then discards exactly two cards",
    (id) => {
      const before = scenario("BSTH02.7-X02");
      expect(
        before.pendingCoreSourceAllocation?.candidates
          .map((c) => c.instanceId)
          .sort()
      ).toEqual(["sc-core-union-guided", "void:alice"]);
      const after = select(before, id);
      expect(after.players[0]!.lifeNormalCoreCount).toBe(5);
      expect(after.players[0]!.deckCount).toBe(1);
      expect(
        after.cardInstances
          .filter((c) => c.zone === "trash")
          .map((c) => c.instanceId)
          .sort()
      ).toEqual(["sc-core-union-deck-1", "sc-core-union-deck-2"]);
    }
  );
  it("Shanghai does not discard when life placement is prevented", () => {
    const state = scenario("BSTH02.7-X02", "alice", "before");
    state.activeContinuousEffects = [
      ...state.activeContinuousEffects,
      {
        effectId: "life-block",
        sourceInstanceId: "sc-core-union-opponent",
        sourceDefinitionId: "BSTH001-R01",
        actingPlayerId: "bob",
        targetInstanceId: "alice",
        modifierTag: "restrict_core_placement_life",
        duration: { scope: "turn" },
        createdAtTurn: 4,
        createdAtAttackId: null,
      },
    ];
    const after = execute(state, "BSTH02.7-X02");
    expect(after.players[0]!.lifeNormalCoreCount).toBe(4);
    expect(after.players[0]!.deckCount).toBe(3);
    expect(after.pendingCoreSourceAllocation).toBeNull();
  });
  it("excludes a source-specific life placement restriction before choosing a core", () => {
    const state = scenario("BSTH02.7-X02", "alice", "before");
    state.activeContinuousEffects.push({
      effectId: "void-life-block",
      sourceInstanceId: "sc-core-union-opponent",
      sourceDefinitionId: "BSTH002-C04",
      actingPlayerId: "bob",
      targetInstanceId: "alice",
      modifierTag: "restrict_core_placement_life",
      duration: { scope: "turn" },
      createdAtTurn: 4,
      createdAtAttackId: null,
      metadata: { fromZone: "void" },
    });
    const beforeCores = state.cardInstances.find(
      (card) => card.instanceId === "sc-core-union-guided"
    )!.normalCoreCount;
    const after = execute(state, "BSTH02.7-X02");
    expect(after.pendingCoreSourceAllocation).toBeNull();
    expect(after.players[0]!.lifeNormalCoreCount).toBe(5);
    expect(after.players[0]!.deckCount).toBe(1);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "sc-core-union-guided"
      )!.normalCoreCount
    ).toBe(beforeCores - 1);
  });
  it.each([false, true])(
    "Shanghai preserves the selected physical core across a declined replacement: soul=%s",
    (soul) => {
      let before = scenario("BSTH02.7-X02", "alice", "before");
      before = withSoulCoreLocation(before, "alice", {
        kind: "card",
        instanceId: "sc-core-union-guided",
      });
      before.activeContinuousEffects = [
        ...before.activeContinuousEffects,
        {
          effectId: "physical-life-replace",
          sourceInstanceId: "sc-core-union-guided",
          sourceDefinitionId: "BSTH01-XX01",
          actingPlayerId: "alice",
          targetInstanceId: "alice",
          modifierTag: "life_gain_replacement",
          duration: { scope: "turn" },
          createdAtTurn: 4,
          createdAtAttackId: null,
        },
      ];
      const selected = select(
        execute(before, "BSTH02.7-X02"),
        "sc-core-union-guided",
        soul
      );
      const action = getLegalActions({
        state: selected,
        actingPlayerId: "alice",
        ...lookup,
      }).find(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )!;
      const after = applyLegalAction({
        state: selected,
        action,
        ...lookup,
        lifeGainReplacementChoice: "decline",
      }).state;
      expect(after.players[0]!.lifeNormalCoreCount).toBe(soul ? 4 : 5);
      expect(after.players[0]!.lifeSoulCoreCount).toBe(soul ? 1 : 0);
      expect(
        after.cardInstances.find(
          (c) => c.instanceId === "sc-core-union-guided"
        )!.normalCoreCount
      ).toBe(soul ? 2 : 1);
      expect(after.players[0]!.deckCount).toBe(1);
    }
  );
  it("Shanghai moves an additional soul core while preserving the primary soul location", () => {
    const before = generateSoulCoreOutsideGame(
      withSoulCoreLocation(
        scenario("BSTH02.7-X02", "alice", "before"),
        "alice",
        { kind: "reserve" }
      ),
      "alice",
      { kind: "card", instanceId: "sc-core-union-guided" },
      1,
      lookup.getCardDefinitionById
    );
    const after = select(
      execute(before, "BSTH02.7-X02"),
      "sc-core-union-guided",
      true
    );
    expect(after.players[0]!.lifeSoulCoreCount).toBe(1);
    expect(after.players[0]!.soulCoreLocation).toEqual(
      before.players[0]!.soulCoreLocation
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "sc-core-union-guided")!
        .soulCoreCount
    ).toBe(0);
    expect(after.players[0]!.deckCount).toBe(1);
  });
  it.each(["decline", "replace"] as const)(
    "Shanghai resumes after life-gain replacement: %s",
    (choice) => {
      const before = scenario("BSTH02.7-X02", "alice", "before");
      before.activeContinuousEffects = [
        ...before.activeContinuousEffects,
        {
          effectId: "life-replace",
          sourceInstanceId: "sc-core-union-guided",
          sourceDefinitionId: "BSTH01-XX01",
          actingPlayerId: "alice",
          targetInstanceId: "alice",
          modifierTag: "life_gain_replacement",
          duration: { scope: "turn" },
          createdAtTurn: 4,
          createdAtAttackId: null,
        },
      ];
      const selected = select(
        execute(before, "BSTH02.7-X02"),
        "sc-core-union-guided"
      );
      expect(selected.pendingLifeGainReplacementChoice).not.toBeNull();
      expect(selected.players[0]!.deckCount).toBe(3);
      const action = getLegalActions({
        state: selected,
        actingPlayerId: "alice",
        ...lookup,
      }).find(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )!;
      const after = applyLegalAction({
        state: selected,
        action,
        ...lookup,
        lifeGainReplacementChoice: choice,
      }).state;
      expect(after.pendingLifeGainReplacementChoice).toBeNull();
      expect(after.players[0]!.deckCount).toBe(choice === "decline" ? 1 : 3);
      expect(after.players[0]!.lifeNormalCoreCount).toBe(
        choice === "decline" ? 5 : 4
      );
      expect(
        after.cardInstances.find(
          (c) => c.instanceId === "sc-core-union-guided"
        )!.normalCoreCount
      ).toBe(choice === "decline" ? 1 : 2);
    }
  );
  it("waits for every repeated life-gain replacement before continuing the effect", () => {
    let state = scenario("BSTH02.7-X02", "alice", "before");
    state.activeContinuousEffects.push({
      effectId: "repeat-life-replace",
      sourceInstanceId: "sc-core-union-guided",
      sourceDefinitionId: "BSTH01-XX01",
      actingPlayerId: "alice",
      targetInstanceId: "alice",
      modifierTag: "life_gain_replacement",
      duration: { scope: "turn" },
      createdAtTurn: 4,
      createdAtAttackId: null,
    });
    const effect = structuredClone(map.get("BSTH02.7-X02")!.effects![3]!);
    const step = effect.steps[0]!;
    if (step.action.kind !== "core_move") throw new Error("fixture");
    step.action.from = { kind: "void", player: "self" };
    step.repeat = { additional: 2 };
    state = executeEffect({
      chainId: "test:core-source-union:394",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: "sc-core-union-source",
      actingPlayerId: "alice",
      optionalExecuteResumeStepIndex: 0,
      ...lookup,
    });
    for (let i = 0; i < 3; i++) {
      expect(state.pendingLifeGainReplacementChoice).not.toBeNull();
      expect(state.players[0]!.deckCount).toBe(3);
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookup,
      }).find(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )!;
      state = applyLegalAction({
        state,
        action,
        ...lookup,
        lifeGainReplacementChoice: "decline",
      }).state;
    }
    expect(state.pendingLifeGainReplacementChoice).toBeNull();
    expect(state.players[0]!.lifeNormalCoreCount).toBe(7);
    expect(state.players[0]!.deckCount).toBe(1);
  });
  it.each(["reserve", "life", "card", "trash"] as const)(
    "Okina finds soul core in %s without an effect branch",
    (kind) => {
      let state = scenario("BSTH11-X02", "alice", "before");
      state = withSoulCoreLocation(
        state,
        "alice",
        kind === "card" ? { kind, instanceId: "sc-core-union-own" } : { kind }
      );
      const after = execute(state, "BSTH11-X02");
      expect(after.pendingStepChoice).toBeNull();
      expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
      expect(
        after.cardInstances.find(
          (c) => c.instanceId === "sc-core-union-source"
        )!.zone
      ).toBe(kind === "trash" ? "hand" : "field");
      expect(after.players[0]!.trashSoulCoreCount).toBe(1);
    }
  );
  it.each(["BSTH02-X01", "BSTH02.7-X02", "BSTH11-X02"])(
    "restores an old %s step choice through the same continuation",
    (card) => {
      const state = scenario(card, "alice", "before");
      const definition = map.get(card)!;
      const effectIndex =
        card === "BSTH02-X01" ? 1 : card === "BSTH02.7-X02" ? 3 : 0;
      const effect = structuredClone(definition.effects![effectIndex]!);
      const action = effect.steps[0]!.action;
      if (action.kind !== "core_move" || action.from.kind !== "union")
        throw new Error("fixture");
      const sources = action.from.sources;
      effect.steps[0]!.action = { ...action, from: sources[0]! };
      effect.steps[0]!.choice = sources
        .slice(1)
        .map((from) => ({ action: { ...action, from } }));
      const oldDefinition = {
        ...definition,
        effects: definition.effects!.map((e, i) =>
          i === effectIndex ? effect : e
        ),
      };
      const saved = executeEffect({
        chainId: "test:core-source-union:466",
        state,
        effect,
        effectIndex,
        sourceInstanceId: "sc-core-union-source",
        actingPlayerId: "alice",
        optionalExecuteResumeStepIndex: 0,
        ...lookup,
        promptUnresolvedChoice: true,
        getCardDefinitionById: (id) =>
          id === card ? oldDefinition : map.get(id),
      });
      expect(saved.pendingStepChoice).not.toBeNull();
      const restored = restoreSnapshot(
        { schemaVersion: 2, savedAt: "2026-09-15T07:29:33Z", state: saved },
        lookup.getCardDefinitionById
      ).state;
      expect(restored.pendingStepChoice).toBeNull();
      if (card === "BSTH11-X02")
        expect(
          restored.cardInstances.find(
            (c) => c.instanceId === "sc-core-union-source"
          )!.zone
        ).toBe("field");
      else
        expect(
          restored.pendingCoreSourceAllocation?.candidates.length
        ).toBeGreaterThan(1);
      const twice = restoreSnapshot(
        { schemaVersion: 2, savedAt: "2026-09-15T07:29:33Z", state: restored },
        lookup.getCardDefinitionById
      ).state;
      expect({ ...twice, log: [] }).toEqual({ ...restored, log: [] });
      expect(
        twice.log.filter((line) =>
          line.startsWith("snapshot:restored-source-union:")
        )
      ).toHaveLength(1);
    }
  );
});
