import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import pendingFixture from "./fixtures/source-choice-pending-2026-09-15.json";
import { buildSummonSourceUnionScenario } from "../../../apps/playground-web/src/scenario-summon-source-union";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createGameSnapshot,
  getLegalActions,
  restoreSnapshot,
} from "../src";
import type { GameState } from "../src";

const map = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const lookup = {
  getCardDefinitionById: (id: string) => map.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};

// 旧添付そのものはID欠落で拒否する。別の互換性（召喚元選択）を調べる
// 合成fixtureには、テストが宣言した原因を明示する。
function causalPendingFixture() {
  const pending = structuredClone(pendingFixture) as NonNullable<
    GameState["pendingStepChoice"]
  >;
  pending.continuation.chainId = "test:source-choice:declared-effect";
  return pending;
}

it("rejects the original attachment whose continuation has no cause", () => {
  const state = buildSummonSourceUnionScenario(ALL_CARDS);
  state.pendingStepChoice = structuredClone(
    pendingFixture
  ) as GameState["pendingStepChoice"];
  expect(() =>
    restoreSnapshot(createGameSnapshot(state), lookup.getCardDefinitionById)
  ).toThrow(/pendingStepChoice.continuation.chainId/);
});

it("restores a causal deferred summon choice with trash and soul candidates together", () => {
  let state = buildSummonSourceUnionScenario(ALL_CARDS);
  state = {
    ...state,
    pendingTriggeredEffects: [],
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === "sc-union-source" ? { ...c, instanceId: "card-5" } : c
    ),
    pendingStepChoice: causalPendingFixture(),
  };
  const before = structuredClone(state);
  const restored = restoreSnapshot(
    createGameSnapshot(state),
    lookup.getCardDefinitionById
  ).state;
  expect(restored.pendingStepChoice).toBeNull();
  expect(
    restored.pendingEffectTargetSelection?.candidateInstanceIds.slice().sort()
  ).toEqual(["sc-union-soul", "sc-union-trash"]);
  expect(restored.players.map((p) => p.reserveNormalCoreCount)).toEqual(
    before.players.map((p) => p.reserveNormalCoreCount)
  );
  expect(state).toEqual(before);
  expect(
    getLegalActions({
      state: restored,
      actingPlayerId: "alice",
      ...lookup,
    }).some((a) => a.kind === "resolve_pending_step_choice")
  ).toBe(false);
});

it("restores the old magic choice after its paid declaration without reopening a stack window", () => {
  const current = map.get("BSGE01-C16")!;
  const old = structuredClone(current);
  const step = old.effects![1]!.steps[0]!;
  if (step.action.kind !== "summon" || step.action.target.kind !== "from_zone")
    throw new Error("fixture");
  const action = structuredClone(step.action);
  delete step.action.target.includeSoulState;
  action.target = {
    ...step.action.target,
    zone: "field",
    filter: { ...step.action.target.filter, soulState: "only" },
  };
  step.choice = [{ action }];
  const oldCards = ALL_CARDS.map((c) => (c.cardNo === old.cardNo ? old : c));
  const oldLookup = {
    ...lookup,
    getCardDefinitionById: (id: string) =>
      id === old.cardNo ? old : map.get(id),
    getRegisteredMagicActions: buildMagicLookup(oldCards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(oldCards),
  };
  let state = buildSummonSourceUnionScenario(
    oldCards,
    new URLSearchParams({ card: old.cardNo })
  );
  const use = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...oldLookup,
  }).find((a) => a.kind === "use_magic")!;
  if (use.kind !== "use_magic") throw new Error("fixture declaration");
  state = applyLegalAction({
    state,
    action: use,
    ...oldLookup,
    paymentSources: [{ kind: "reserve", amount: use.finalCost }],
  }).state;
  for (let guard = 0; guard < 6 && !state.pendingStepChoice; guard++) {
    const pass = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...oldLookup })
      )
      .find((a) => a.kind === "pass_stack");
    if (!pass) break;
    state = applyLegalAction({ state, action: pass, ...oldLookup }).state;
  }
  expect(state.pendingStepChoice).not.toBeNull();
  const reserves = state.players.map((p) => p.reserveNormalCoreCount);
  const restored = restoreSnapshot(
    createGameSnapshot(state),
    lookup.getCardDefinitionById
  ).state;
  expect(restored.pendingStepChoice).toBeNull();
  expect(
    restored.pendingEffectTargetSelection?.candidateInstanceIds.slice().sort()
  ).toEqual(["sc-union-soul", "sc-union-trash"]);
  expect(restored.players.map((p) => p.reserveNormalCoreCount)).toEqual(
    reserves
  );
});

it("keeps genuine choices and temporary effect overrides unchanged", () => {
  const state = buildSummonSourceUnionScenario(ALL_CARDS);
  const pending = causalPendingFixture();
  pending.continuation.resumeEffectOverride =
    map.get("BSTS01-C05")!.effects![1]!;
  state.pendingStepChoice = pending;
  expect(
    restoreSnapshot(createGameSnapshot(state), lookup.getCardDefinitionById)
      .state.pendingStepChoice
  ).toEqual(pending);
});
