import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { GameState } from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const contract = ALL_CARDS.find(
  (c) => c.printedCategory === "spirit" && c.keywordTags.includes("contract")
)!;
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};
function choose(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "player-2",
    ...options,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options }).state;
}
describe("純化の持ち主選択", () => {
  it("2枚の契約カードはそれぞれ持ち主が裏向きか魂状態を選ぶ", () => {
    let state = createEmptyGameState({
      cardInstances: [
        createCardInstance(lookup("BSTH10-M02")!, {
          instanceId: "source",
          ownerPlayerId: "player-1",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...["a", "b"].map((id) =>
          createCardInstance(contract, {
            instanceId: id,
            ownerPlayerId: "player-2",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ],
    });
    state = executeEffect({
      chainId: "test:bsth10-purification-choices:51",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "turn_face_down",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 2,
              },
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "player-1",
      targetInstanceIds: ["a", "b"],
      ...options,
    });
    expect(state.pendingStepOptionalChoice?.choosingPlayerId).toBe("player-2");
    state = choose(state, "decline");
    expect(
      state.cardInstances.find((c) => c.instanceId === "a")?.faceDown
    ).toBe(true);
    expect(state.pendingStepOptionalChoice?.choosingPlayerId).toBe("player-2");
    state = choose(state, "execute");
    expect(state.players[1]!.soulStateInstanceIds).toContain("b");
    expect(
      state.cardInstances.find((c) => c.instanceId === "b")?.faceDown
    ).toBe(false);
  });
});
