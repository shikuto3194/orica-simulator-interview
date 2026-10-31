/**
 * BSTH08.5-M11 獅子（歓喜） [0,1] 手元常駐
 * 「自分がこのカードを除外するとき、かわりに手札に戻せる。」
 *
 * = effect_resistance(resistsOutcome:remove_from_game, source:"self",
 *   replacement:move_to(zone:"hand"))。executeRemoveFromGame の非フィールド分岐が
 *   自己起因 (actingPlayerId === card.controllerPlayerId) の手元カード除外を検出すると、
 *   直接除外せず pendingSetAsideExitReplacementChoice を立てて
 *   「手札へ戻す/通常通り除外する」の選択を提示する (ENGINE-set-aside-exit-replacement-choice)。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  executeRemoveFromGame,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  resolveSetAsideExitReplacementChoice,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

function makeState(): GameState {
  const m11 = createCardInstance(card("BSTH08.5-M11"), {
    instanceId: "m11",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "set_aside",
  });
  const state: GameState = {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [m11],
  };
  return rebuildContinuousEffectsFromField(state, getDef);
}

describe("BSTH08.5-M11 手元常駐: 自己除外の置換選択", () => {
  it("自分が手元のこのカードを除外しようとすると、直接除外せず選択待ちになる", () => {
    const state = makeState();

    const result = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: { player: "self", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "m11"
    );

    // 直接 removed_from_game へは行かず、手元のまま選択待ちになる。
    expect(result.cardInstances.find((c) => c.instanceId === "m11")?.zone).toBe(
      "set_aside"
    );
    expect(result.pendingSetAsideExitReplacementChoice).toEqual({
      choosingPlayerId: ALICE,
      cardInstanceId: "m11",
      removalTargetInstanceIds: ["m11"],
      replacement: { kind: "move_to", zone: "hand" },
    });
  });

  it("置換を受け入れると、除外されず手札へ移動する", () => {
    const state = makeState();
    const afterRemove = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: { player: "self", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "m11"
    );

    const resolved = resolveSetAsideExitReplacementChoice(afterRemove, true);

    expect(resolved.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "m11")?.zone
    ).toBe("hand");
  });

  it("置換を辞退すると、通常通り除外される", () => {
    const state = makeState();
    const afterRemove = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: { player: "self", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "m11"
    );

    const resolved = resolveSetAsideExitReplacementChoice(afterRemove, false);

    expect(resolved.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "m11")?.zone
    ).toBe("removed_from_game");
  });

  it("相手が同じカードを除外しようとした場合 (自己起因でない) は選択を提示せず通常通り除外する", () => {
    const state = makeState();

    const result = executeRemoveFromGame(
      state,
      BOB,
      {
        kind: "remove_from_game",
        target: { player: "opponent", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "m11"
    );

    expect(result.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(result.cardInstances.find((c) => c.instanceId === "m11")?.zone).toBe(
      "removed_from_game"
    );
  });

  it("duration:permanent のため、通常の継続効果再計算 (recomputeAndRebuildContinuousEffects) でも CE が失効しない (adversarial verifier 2026-07-25 round2: while_set は burst/mirage 専用で set_aside には無効という指摘の回帰確認)", () => {
    const state = makeState();
    const before = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "replace_field_exit"
    );
    expect(before.length).toBe(1);

    const recomputed = recomputeAndRebuildContinuousEffects(state, getDef);
    const after = recomputed.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "replace_field_exit"
    );
    expect(after.length).toBe(1);
    // 除去→再登録の往復が起きていれば effectId が変わる。同一 CE が持続していることを確認する。
    expect(after[0]!.effectId).toBe(before[0]!.effectId);
  });
});
