import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const source = getDef("BSAZ02-C16")!;
const mars = source;
function resolve(
  cards: [string, typeof source, "hand" | "trash" | "set_aside"][]
) {
  return executeEffect({
    state: createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards.map(([id, definition, zone]) =>
        createCardInstance(definition, {
          instanceId: id,
          ownerPlayerId: "alice",
          zone,
        })
      ),
    }),
    effect: source.effects![0]!,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    chainId: "swap-contract",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("入れ替えの宣言後選択", () => {
  it("手札だけを交換候補にし、このカード自身だけを回収する", () => {
    const state = resolve([
      ["source", source, "trash"],
      ["copy", source, "trash"],
      ["hand", mars, "hand"],
      ["aside", mars, "set_aside"],
    ]);
    expect(
      state.pendingHandTrashSwapChoice?.outgoingCandidateInstanceIds
    ).toEqual(["hand"]);
    expect(
      state.pendingHandTrashSwapChoice?.incomingCandidateInstanceIds
    ).toEqual(["source"]);
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(actions.map((action) => action.kind)).toEqual(["swap_hand_trash"]);
    const after = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: getDef,
    }).state;
    expect(
      after.cardInstances.map((card) => [card.instanceId, card.zone])
    ).toEqual([
      ["source", "hand"],
      ["copy", "trash"],
      ["hand", "trash"],
      ["aside", "set_aside"],
    ]);
  });

  it("手元にしか火星がなければ交換待ちを生成しない", () => {
    expect(
      resolve([
        ["source", source, "trash"],
        ["aside", mars, "set_aside"],
      ]).pendingHandTrashSwapChoice
    ).toBeNull();
  });

  it("古い辞退actionを直接送っても発揮済みの入れ替えを辞退できない", () => {
    const state = resolve([
      ["source", source, "trash"],
      ["hand", mars, "hand"],
    ]);
    expect(state.pendingHandTrashSwapChoice).not.toBeNull();
    expect(() =>
      applyLegalAction({
        state,
        getCardDefinitionById: getDef,
        action: {
          kind: "decline_hand_trash_swap",
          actionId: "forged-decline",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: state.pendingHandTrashSwapChoice!.pendingId,
          sourceInstanceId: "source",
        },
      })
    ).toThrow();
  });
});
