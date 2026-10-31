import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildMagicLookup,
  executeEffect,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  withSoulCoreLocation,
  type Effect,
  type GameState,
} from "../src";
import { buildCoreShootTargetsScenario } from "../../../apps/playground-web/src/scenario-core-shoot-targets";

const definitions = new Map(ALL_CARDS.map((d) => [d.cardNo, d]));
const getDef = (id: string) => definitions.get(id);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
const magic = getDef("BSTH01-C22")!;
const effect = magic.effects![2]!;
const specialIds = ["shoot-grandwalker", "shoot-guided", "shoot-grandstone"];
const fixture = () => buildCoreShootTargetsScenario([...ALL_CARDS]);
const cores = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!.normalCoreCount;
function run(
  state: GameState,
  selectedEffect = effect,
  distribution?: Record<string, number>,
  soulSourceId?: string
) {
  return executeEffect({
    state,
    effect: selectedEffect,
    actingPlayerId: "alice",
    sourceInstanceId: "shoot-magic",
    sourceDefinition: magic,
    chainId: "core-shoot-special-nexus-test",
    ...options,
    ...(distribution ? { coreShootDistribution: distribution } : {}),
    ...(soulSourceId ? { coreShootSoulCoreInstanceId: soulSourceId } : {}),
  });
}
function resolve(state: GameState, distribution: Record<string, number>) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find((a) => a.kind === "resolve_pending_core_shoot")!;
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action,
    ...options,
    coreShootDistribution: distribution,
  }).state;
}

describe("BSTH01-C22と同類のフィールドコア除去", () => {
  it("C12のスタック応答でコア選択を挟んでも、C12と下位のC22を使用後にトラッシュへ送る", () => {
    let state = fixture();
    state.step = "attack";
    state.cardInstances = state.cardInstances.map((c) =>
      c.instanceId === "shoot-response"
        ? { ...c, definitionId: "BSTH04-C12" }
        : c.instanceId.startsWith("shoot-spirit-")
          ? { ...c, ownerPlayerId: "alice", controllerPlayerId: "alice" }
          : c
    );
    state = recomputeAndRebuildContinuousEffects(state, getDef);
    const stackOptions = {
      ...options,
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    };
    const actions = (player: string) =>
      getLegalActions({ state, actingPlayerId: player, ...stackOptions });
    const attack = actions("alice").find((a) => a.kind === "attack");
    expect(attack).toBeDefined();
    state = applyLegalAction({ state, action: attack!, ...stackOptions }).state;
    const acceptAttack = actions("bob").find(
      (a) => a.kind === "pass_pre_declaration_stack"
    );
    expect(acceptAttack).toBeDefined();
    state = applyLegalAction({
      state,
      action: acceptAttack!,
      ...stackOptions,
    }).state;
    const openFlash = actions("alice").find(
      (a) => a.kind === "open_battle_flash"
    );
    expect(openFlash).toBeDefined();
    state = applyLegalAction({
      state,
      action: openFlash!,
      ...stackOptions,
    }).state;
    const pass = (player: string) => {
      const action = actions(player).find(
        (a) => a.kind === "pass_battle_flash"
      );
      expect(action, JSON.stringify(actions(player))).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...stackOptions,
      }).state;
    };
    pass("bob");
    const use = (player: string, timing: "flash" | "stack") => {
      const action = actions(player).find(
        (a) => a.kind === "use_magic" && a.timing === timing
      );
      expect(action, JSON.stringify(actions(player))).toBeDefined();
      if (!action || action.kind !== "use_magic")
        throw new Error("use_magic missing");
      state = applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: action.finalCost }],
        ...stackOptions,
      }).state;
    };
    use("alice", "flash");
    use("bob", "stack");
    pass("alice");
    expect(state.pendingCoreShootSelection?.sourceInstanceId).toBe(
      "shoot-response"
    );
    expect(state.pendingStackCascade?.remainingStacks).toHaveLength(1);
    expect(cores(state, "shoot-nexus")).toBe(3);
    const choose = actions("bob").find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(choose).toBeDefined();
    state = applyLegalAction({
      state,
      action: choose!,
      coreShootDistribution: { "shoot-spirit-a": 1 },
      ...stackOptions,
    }).state;
    expect(state.pendingCoreShootSelection).toBeNull();
    expect(state.pendingStackCascade).toBeNull();
    expect(cores(state, "shoot-spirit-a")).toBe(2);
    expect(
      state.cardInstances.find((c) => c.instanceId === "shoot-response")?.zone
    ).toBe("trash");
    expect(cores(state, "shoot-nexus")).toBe(1);
    expect(
      state.cardInstances.find((c) => c.instanceId === "shoot-magic")?.zone
    ).toBe("trash");
  });
  it("創界神・導界者・創界石を候補に含めず、通常ネクサスとスピリットから2個を移動", () => {
    const pending = run(fixture());
    expect(
      pending.pendingCoreShootSelection?.candidates.map((c) => c.instanceId)
    ).toEqual(["shoot-spirit-a", "shoot-spirit-b", "shoot-nexus"]);
    const after = resolve(pending, { "shoot-spirit-a": 1, "shoot-nexus": 1 });
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "shoot-spirit-a")).toBe(2);
    expect(cores(after, "shoot-nexus")).toBe(2);
    expect(after.players[1]!.reserveNormalCoreCount).toBe(12);
    expect(specialIds.map((id) => cores(after, id))).toEqual([3, 3, 2]);
  });
  it.each(specialIds)("pendingへの対象外指定を拒否: %s", (id) => {
    const pending = run(fixture());
    expect(() => resolve(pending, { [id]: 2 })).toThrow(/not a candidate/);
    expect(specialIds.map((key) => cores(pending, key))).toEqual([3, 3, 2]);
  });
  it.each(specialIds)("直接配分でも対象外指定を拒否: %s", (id) => {
    const before = fixture();
    expect(() => run(before, effect, { [id]: 2 })).toThrow(/candidate/);
    expect(specialIds.map((key) => cores(before, key))).toEqual([3, 3, 2]);
  });
  it.each(specialIds)("直接配分のソウルコアでも対象外指定を拒否: %s", (id) => {
    const before = withSoulCoreLocation(fixture(), "bob", {
      kind: "card",
      instanceId: id,
    });
    expect(() => run(before, effect, { "shoot-spirit-a": 1 }, id)).toThrow(
      /candidate/
    );
    expect(before.players[1]!.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: id,
    });
  });
  it("直接配分で通常コアと合法なソウルコアを1個ずつ動かす", () => {
    const before = withSoulCoreLocation(fixture(), "bob", {
      kind: "card",
      instanceId: "shoot-spirit-b",
    });
    const after = run(
      before,
      effect,
      { "shoot-spirit-a": 1 },
      "shoot-spirit-b"
    );
    expect(cores(after, "shoot-spirit-a")).toBe(2);
    expect(after.players[1]!.reserveNormalCoreCount).toBe(11);
    expect(after.players[1]!.soulCoreLocation).toEqual({ kind: "reserve" });
  });
  it("合法候補が1枚だけの自動解決でも特殊ネクサスのコアは動かさない", () => {
    const state = fixture();
    state.cardInstances = state.cardInstances.filter(
      (c) => !["shoot-spirit-b", "shoot-nexus"].includes(c.instanceId)
    );
    const after = run(state);
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(cores(after, "shoot-spirit-a")).toBe(1);
    expect(after.players[1]!.reserveNormalCoreCount).toBe(12);
    expect(specialIds.map((id) => cores(after, id))).toEqual([3, 3, 2]);
  });
  it("BSTH04-C12のカテゴリ制限と最低1コアを候補・解決に維持する", () => {
    const def = getDef("BSTH04-C12")!;
    const state = fixture();
    state.cardInstances = state.cardInstances.map((c) =>
      c.instanceId === "shoot-magic" ? { ...c, definitionId: def.cardNo } : c
    );
    const pending = executeEffect({
      state,
      effect: def.effects![1]!,
      actingPlayerId: "alice",
      sourceInstanceId: "shoot-magic",
      sourceDefinition: def,
      chainId: "filtered-core-shoot-test",
      ...options,
    });
    expect(
      pending.pendingCoreShootSelection?.candidates.map((c) => c.instanceId)
    ).toEqual(["shoot-spirit-a", "shoot-spirit-b"]);
    const after = resolve(pending, { "shoot-spirit-a": 1 });
    expect(cores(after, "shoot-spirit-a")).toBe(2);
    expect(cores(after, "shoot-nexus")).toBe(3);
    const oneCoreEach = fixture();
    oneCoreEach.cardInstances = oneCoreEach.cardInstances.map((c) =>
      c.instanceId.startsWith("shoot-spirit-")
        ? { ...c, normalCoreCount: 1 }
        : c
    );
    const noRemoval = run(oneCoreEach, def.effects![1]!);
    expect(noRemoval.pendingCoreShootSelection).toBeNull();
    expect(cores(noRemoval, "shoot-spirit-a")).toBe(1);
    expect(cores(noRemoval, "shoot-spirit-b")).toBe(1);
    expect(noRemoval.players[1]!.reserveNormalCoreCount).toBe(10);
  });
  it.each([
    [
      { targetsGrandwalker: "only" as const },
      ["shoot-grandwalker", "shoot-guided"],
    ],
    [
      { targetsGrandstone: true },
      ["shoot-spirit-a", "shoot-spirit-b", "shoot-nexus", "shoot-grandstone"],
    ],
  ])("明示指定した特殊ネクサスの合法除去は保持: %j", (filter, ids) => {
    const selectedEffect: Effect = {
      timing: effect.timing,
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "field", player: "opponent", filter },
            to: { kind: "reserve", player: "opponent" },
            amount: 2,
          },
        },
      ],
    };
    const pending = run(fixture(), selectedEffect);
    expect(
      pending.pendingCoreShootSelection?.candidates.map((c) => c.instanceId)
    ).toEqual(ids);
    const target = ids[ids.length - 1]!;
    const after = resolve(pending, { [target]: 2 });
    expect(cores(after, target)).toBe(target === "shoot-grandstone" ? 0 : 1);
    expect(after.players[1]!.reserveNormalCoreCount).toBe(12);
  });
});
