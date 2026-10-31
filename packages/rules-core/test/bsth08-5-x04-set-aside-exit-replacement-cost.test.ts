/**
 * BSTH08.5-X04 希望の面 [0,1] 手元常駐
 * 「自分がこのカードを除外するとき、かわりに1コスト支払うことができる。」
 *
 * = effect_resistance(resistsOutcome:remove_from_game, source:"self",
 *   replacement:pay_cost(amount:1))。BSTH08.5-M11 (move_to, 手札へ戻す) と同型の
 *   pendingSetAsideExitReplacementChoice 機構を使うが、置換先はゾーン移動ではなく
 *   通常の合法な原資から1コスト支払って手元に残ること。原資選択・制限・本文再開は
 *   card-exclusion-replacement-payment.test.ts が扱い、本ファイルは単枚の基本境界を扱う。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  executeRemoveFromGame,
  getLegalActions,
  rebuildContinuousEffectsFromField,
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

function makeState(
  playerOverrides?: Partial<import("../src").PlayerState>[]
): GameState {
  const x04 = createCardInstance(card("BSTH08.5-X04"), {
    instanceId: "x04",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "set_aside",
  });
  const state: GameState = {
    ...createEmptyGameState({ playerIds: [ALICE, BOB], playerOverrides }),
    cardInstances: [x04],
  };
  return rebuildContinuousEffectsFromField(state, getDef);
}

describe("BSTH08.5-X04 手元常駐: 自己除外のコスト支払い置換選択", () => {
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
      "x04"
    );

    expect(result.cardInstances.find((c) => c.instanceId === "x04")?.zone).toBe(
      "set_aside"
    );
    expect(result.pendingSetAsideExitReplacementChoice).toEqual({
      choosingPlayerId: ALICE,
      cardInstanceId: "x04",
      removalTargetInstanceIds: ["x04"],
      replacement: { kind: "pay_cost", amount: 1 },
    });
  });

  it("置換を受け入れると、除外されずゾーンに残りリザーブから1コスト支払う", () => {
    const state = makeState();
    const alicePlayer = state.players.find((p) => p.id === ALICE)!;
    const reserveBefore = alicePlayer.reserveNormalCoreCount;

    const afterRemove = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: { player: "self", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "x04"
    );

    const resolved = resolveSetAsideExitReplacementChoice(afterRemove, true);

    expect(resolved.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x04")?.zone
    ).toBe("set_aside");
    const aliceAfter = resolved.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(reserveBefore - 1);
    expect(aliceAfter.trashNormalCoreCount).toBe(1);
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
      "x04"
    );

    const resolved = resolveSetAsideExitReplacementChoice(afterRemove, false);

    expect(resolved.pendingSetAsideExitReplacementChoice).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x04")?.zone
    ).toBe("removed_from_game");
  });

  it("リザーブがコスト未満のとき、置換 (replace) の legal action がオファーされない", () => {
    const state = makeState([{ reserveNormalCoreCount: 0 }, {}]);
    const afterRemove = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: { player: "self", zone: ["set_aside"], count: 1 },
      },
      getDef,
      "x04"
    );

    expect(afterRemove.pendingSetAsideExitReplacementChoice).not.toBeNull();
    const actions = getLegalActions({
      state: afterRemove,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const setAsideActions = actions.filter(
      (a) => a.kind === "resolve_set_aside_exit_replacement_choice"
    );
    expect(setAsideActions.map((a) => a.choice)).toEqual(["decline"]);
  });
});
