import { describe, expect, it } from "vitest";
import { createEmptyGameState, type GameState } from "@orica/rules-core";
import { hasSelfplayResolutionChain } from "./selfplay-driver";

const ALICE = "alice";
const BOB = "bob";

function battleFlashState(pendingStackAction: boolean): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "attack",
    window: "flash_before_block",
    activeAttack: {
      attackId: "attack:revisit-guard",
      attackerInstanceId: "attacker",
      defenderPlayerId: BOB,
      blockerInstanceId: null,
      cardEventChainId: null,
      flashWindowState: {
        timing: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: null,
        pendingStackAction: pendingStackAction
          ? ({ stackId: "stack:field-effect" } as never)
          : null,
      },
    } as GameState["activeAttack"],
  };
}

describe("selfplay revisit guard", () => {
  it("tracks a pending field-effect stack within a battle flash window", () => {
    expect(hasSelfplayResolutionChain(battleFlashState(true))).toBe(true);
    expect(hasSelfplayResolutionChain(battleFlashState(false))).toBe(false);
  });
});
