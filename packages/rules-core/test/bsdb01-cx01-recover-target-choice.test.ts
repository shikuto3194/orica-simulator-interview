import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/runtime";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/runtime";

// BSDB01-CX01【契約煌臨元】「ボイドからコア1個を自分のフィールドに置くことができ、
// 自分のスピリット1体を回復できる」の実フロー (leave_field 誘発 → 任意step 2段) を検証する。
// 回復の対象候補は共通 SSOT (legal-actions-shared.ts の targetCardFilterActionKind:"recover")
// に従い「回復状態でない (疲労/重疲労) 自分のスピリット」。複数候補ならプレイヤーが選ぶ。

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => cardNoMap.get(id);
const ALICE = "player-1";
const BOB = "player-2";
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

type St = "recovered" | "exhausted";

/** 先頭のスピリットの下に CX01 を煌臨元として置いた盤面 (+ 相手の被破壊対象)。 */
function board(states: Record<string, St>): GameState {
  const cx01 = createCardInstance(getDef("BSDB01-CX01")!, {
    instanceId: "cx01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const spirits = Object.entries(states).map(([id, st], i) => {
    const base = createCardInstance(getDef("BSDB01-C01")!, {
      instanceId: id,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: st,
    });
    return i === 0
      ? {
          ...base,
          underCards: [
            { cardInstanceId: "cx01", role: "advent_source" as const },
          ],
        }
      : base;
  });
  const destroyer = createCardInstance(getDef("BSDB01-C01")!, {
    instanceId: "destroyer",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const target = createCardInstance(getDef("BSDB01-C05")!, {
    instanceId: "bob-t",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  return createEmptyGameState({
    cardInstances: [...spirits, cx01, destroyer, target],
  });
}

type Act = { kind: string; choice?: string; sourceInstanceId?: string };

function legal(state: GameState, actor: string): Act[] {
  return getLegalActions({
    state,
    actingPlayerId: actor,
    ...lookups,
  } as never) as unknown as Act[];
}

function apply(
  state: GameState,
  action: Act,
  extra: Record<string, unknown> = {}
): GameState {
  return applyLegalAction({
    state,
    action: action as never,
    ...lookups,
    ...extra,
  } as never).state;
}

/** 相手カードがサイヤ人の効果で破壊される離脱を起点に CX01 の誘発を積み、step0 実行まで進める。 */
function startAtCoreDistribution(states: Record<string, St>): GameState {
  const before = board(states);
  const afterDestroy = queuePendingLeave({
    state: before,
    instanceId: "bob-t",
    kind: "destroy",
    cause: "effect_resolution",
    chainId: "t:chain",
    causePlayerId: ALICE,
    causedByEffectSourceInstanceId: "destroyer",
  });
  let s = collectAndQueueTriggerReactions({
    chainId: "t:cx",
    beforeState: before,
    afterState: afterDestroy,
    source: "action_resolution",
    causedByPlayerId: ALICE,
    ...lookups,
  });
  for (let g = 0; g < 20 && s.pendingCoreDistribution === null; g++) {
    const actor = s.stackWindow?.priorityPlayerId ?? ALICE;
    const acts = legal(s, actor);
    const next =
      acts.find(
        (x) =>
          x.kind === "resolve_pending_step_optional_choice" &&
          x.choice === "execute"
      ) ??
      acts.find(
        (x) =>
          x.kind === "resolve_pending_triggered_effect" &&
          x.sourceInstanceId === "cx01"
      ) ??
      acts.find((x) => x.kind === "pass_stack");
    if (!next) break;
    s = apply(s, next);
  }
  expect(s.pendingCoreDistribution).not.toBeNull();
  return s;
}

function placeCoreOn(state: GameState, destination: string): GameState {
  const act = legal(state, ALICE).find(
    (x) => x.kind === "resolve_pending_core_distribution"
  )!;
  return apply(state, act, {
    coreDistributionAllocations: { [destination]: 1 },
    coreDistributionSourceAllocations: { void: 1 },
  });
}

function executeRecoverStep(state: GameState): GameState {
  expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
  const exec = legal(state, ALICE).find(
    (x) =>
      x.kind === "resolve_pending_step_optional_choice" &&
      x.choice === "execute"
  );
  expect(exec).toBeDefined();
  return apply(state, exec!);
}

describe("BSDB01-CX01 契約煌臨元: コア配置先と回復対象の選択", () => {
  it("コア配置先は複数候補ならプレイヤーが選べる (候補 >= 2)", () => {
    const s = startAtCoreDistribution({
      a: "exhausted",
      b: "exhausted",
      c: "recovered",
    });
    const ids = s.pendingCoreDistribution!.candidates.map((c) => c.instanceId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("疲労スピリットが複数いるとき、回復対象はプレイヤーが選ぶ (回復状態は候補外)。選んだ側だけが回復する", () => {
    let s = startAtCoreDistribution({
      a: "exhausted",
      b: "exhausted",
      c: "recovered",
    });
    s = placeCoreOn(s, "c");
    s = executeRecoverStep(s);

    const pending = s.pendingStepOptionalTargetSelection;
    expect(pending).not.toBeNull();
    expect([...pending!.candidateInstanceIds].sort()).toEqual(["a", "b"]);
    expect(pending!.requiredTargetCount).toBe(1);
    expect(pending!.maxTargetCount).toBe(1);

    const pick = legal(s, ALICE).find(
      (x) => x.kind === "resolve_pending_step_optional_target_selection"
    )!;
    s = apply(s, pick, { targetInstanceIds: ["b"] });

    const state = (id: string) =>
      s.cardInstances.find((c) => c.instanceId === id)!.exhaustState;
    expect(state("b")).toBe("recovered");
    expect(state("a")).toBe("exhausted");
    expect(s.log).toContain("effect:recover:b");
  });

  it("コア配置先に選んだカードが回復対象に流用されない (配置先=回復状態でも、疲労スピリットを回復する)", () => {
    let s = startAtCoreDistribution({ a: "exhausted", b: "recovered" });
    s = placeCoreOn(s, "b");
    s = executeRecoverStep(s);
    const state = (id: string) =>
      s.cardInstances.find((c) => c.instanceId === id)!.exhaustState;
    expect(state("a")).toBe("recovered");
    expect(s.log).toContain("effect:recover:a");
  });
});
