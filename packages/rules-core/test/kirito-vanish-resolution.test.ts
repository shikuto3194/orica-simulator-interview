import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildNightSwordScenario } from "../../../apps/playground-web/src/scenario-night-sword";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  executeEffect,
  type Effect,
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";
const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
  getRegisteredBurstActions: () => [],
  getCardDefinitionById: (id: string) => defs.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
};
function act(
  state: GameState,
  kind: LegalAction["kind"],
  extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  for (let i = 0; i < 8 && kind !== "resolve_pending_burst_check"; i++) {
    const candidates = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      )
      .filter((a) => a.can);
    if (candidates.some((a) => a.kind === kind)) break;
    const burst = candidates.find(
      (a) => a.kind === "resolve_pending_burst_check"
    );
    if (!burst) break;
    state = applyLegalAction({ state, action: burst, ...lookups }).state;
  }
  const actions = ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    )
    .filter((a) => a.can);
  const action = actions.find(
    (a) =>
      a.kind === kind &&
      (extra.choiceIndex === undefined || a.choiceIndex === extra.choiceIndex)
  );
  expect(action, JSON.stringify(actions.map((a) => a.kind))).toBeDefined();
  const result = applyLegalAction({
    state,
    action: action!,
    ...lookups,
    ...extra,
  });
  return result.state;
}
function remove(owner = "alice", cores = "2", targets = "soul") {
  const state = buildNightSwordScenario(
    [...ALL_CARDS],
    new URLSearchParams({ mode: "vanish", owner, cores, targets })
  );
  return act(state, "resolve_pending_core_shoot", {
    coreShootDistribution: { "target-a": 1, "target-b": 1 },
  });
}
describe("キリトの同時消滅と記憶開放術", () => {
  it.each(["alice", "bob"])(
    "%s: 全対象が記憶開放術の解決まで待機する",
    (owner) => {
      let state = remove(owner);
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(2);
      expect(
        state.cardInstances
          .filter((c) => c.instanceId.startsWith("target-"))
          .map((c) => c.pendingLeaveKind)
      ).toEqual(["vanish", "vanish"]);
      state = act(state, "resolve_pending_triggered_effect");
      expect(state.pendingSoulStateReplacement).toBeNull();
      state = act(state, "pass_stack");
      expect(
        state.players.find((p) => p.id !== owner)!.lifeNormalCoreCount
      ).toBe(3);
      expect(state.pendingSoulStateReplacement).not.toBeNull();
    }
  );
  it.each([0, 1])(
    "ライフ移動にもリザーブ/トラッシュ選択 %s を提示する",
    (choiceIndex) => {
      let state = remove("alice", "3", "soul");
      state = act(state, "resolve_pending_triggered_effect");
      state = act(state, "pass_stack");
      expect(state.pendingStepChoice).not.toBeNull();
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(2);
      expect(state.players[1]!.lifeNormalCoreCount).toBe(5);
      state = act(state, "resolve_pending_step_choice", { choiceIndex });
      expect(state.players[1]!.lifeNormalCoreCount).toBe(3);
      expect(state.players[1]!.trashNormalCoreCount).toBe(
        choiceIndex === 1 ? 2 : 0
      );
      expect(state.players[1]!.reserveNormalCoreCount).toBe(
        choiceIndex === 1 ? 2 : 4
      );
      for (const id of ["target-a", "target-b"]) {
        expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe(id);
        state = act(state, "resolve_soul_state_replacement");
      }
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(0);
    }
  );
});

function scopeState(cores = 3, attacking = true, combined = true) {
  const host = createCardInstance(
    lookups.getCardDefinitionById("BSSA01-X01")!,
    {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cores,
      attachedChildrenIds: combined ? ["sword"] : [],
    }
  );
  const sword = createCardInstance(
    lookups.getCardDefinitionById("BSSA01-転醒X01(B)")!,
    {
      instanceId: "sword",
      ownerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: combined ? "host" : null,
    }
  );
  const other = createCardInstance(
    lookups.getCardDefinitionById("BSSA01-X01")!,
    {
      instanceId: "other",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    }
  );
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, sword, other],
        playerOverrides: [
          { countValue: 3 },
          {
            lifeNormalCoreCount: 10,
            reserveNormalCoreCount: 0,
            trashNormalCoreCount: 0,
          },
        ],
      }),
      step: "attack",
      battleEntities: attacking
        ? [
            {
              entityId: "attack",
              memberInstanceIds: combined ? ["host", "sword"] : ["host"],
              resolvedBp: 22000,
              resolvedSymbols: ["purple"],
              attackState: "attacking",
            },
          ]
        : [],
    },
    lookups.getCardDefinitionById
  );
}
const lifeEffect = (to: "reserve" | "trash" | "void" = "reserve"): Effect => ({
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "life", player: "opponent" },
        to: { kind: to, player: "opponent" },
        amount: 1,
      },
    },
  ],
});
describe("キリトの移動先変更の発揮元と有効期間", () => {
  it.each(["host", "sword", "other"])(
    "発揮元 %s: 合体スピリットだけ変更できる",
    (sourceInstanceId) => {
      const state = executeEffect({
        chainId: "test:kirito-vanish-resolution:199",
        state: scopeState(),
        effect: lifeEffect(),
        sourceInstanceId,
        actingPlayerId: "alice",
        ...lookups,
      });
      if (sourceInstanceId === "other") {
        expect(state.pendingStepChoice).toBeNull();
        expect(state.players[1]!.lifeNormalCoreCount).toBe(9);
        expect(state.players[1]!.reserveNormalCoreCount).toBe(1);
      } else {
        expect(state.pendingStepChoice?.choices.map((c) => c.label)).toEqual([
          "リザーブへ置く",
          "トラッシュへ置く",
        ]);
        const after = act(state, "resolve_pending_step_choice", {
          choiceIndex: 1,
        });
        expect(after.players[1]!.lifeNormalCoreCount).toBe(8);
        expect(after.players[1]!.trashNormalCoreCount).toBe(2);
      }
    }
  );
  it.each([
    { cores: 2, attacking: true },
    { cores: 3, attacking: false },
  ])(
    "条件外 $cores コア / attacking=$attacking では変更しない",
    ({ cores, attacking }) => {
      const state = executeEffect({
        chainId: "test:kirito-vanish-resolution:229",
        state: scopeState(cores, attacking),
        effect: lifeEffect(),
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        ...lookups,
      });
      expect(state.pendingStepChoice).toBeNull();
      expect(state.players[1]!.lifeNormalCoreCount).toBe(8);
      expect(state.players[1]!.reserveNormalCoreCount).toBe(2);
    }
  );
  it.each(["trash", "void"] as const)("本文の移動先 %s は変更しない", (to) => {
    const state = executeEffect({
      chainId: "test:kirito-vanish-resolution:242",
      state: scopeState(),
      effect: lifeEffect(to),
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(state.pendingStepChoice).toBeNull();
    expect(state.players[1]!.lifeNormalCoreCount).toBe(8);
    expect(state.players[1]!.reserveNormalCoreCount).toBe(0);
    expect(state.players[1]!.trashNormalCoreCount).toBe(to === "trash" ? 2 : 0);
  });
  it("合体していないブレイヴ自身には適用しない", () => {
    const state = executeEffect({
      chainId: "test:kirito-vanish-resolution:255",
      state: scopeState(3, true, false),
      effect: lifeEffect(),
      sourceInstanceId: "sword",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(state.pendingStepChoice).toBeNull();
    expect(state.players[1]!.reserveNormalCoreCount).toBe(1);
  });
});
