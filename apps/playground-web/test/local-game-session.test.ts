import { beforeAll, describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { initializeGameApiRuntime } from "../server/game-api";
import { LocalGameSession } from "../server/local-game-session";
import { buildBlazingStarOracleScenario } from "../src/scenario-blazing-star-oracle";

beforeAll(initializeGameApiRuntime);
function session() {
  const card = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C01")!;
  return new LocalGameSession("local-unit", {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: ["alice", "bob"].map((owner) =>
        createCardInstance(card, {
          instanceId: `${owner}-secret`,
          ownerPlayerId: owner,
          zone: "hand",
        })
      ),
    }),
    step: "main",
    activePlayerId: "alice",
    turnNumber: 3,
  });
}
const operation = (id = "first", expectedVersion = 1) => ({
  clientMutationId: id,
  expectedVersion,
});

describe("authoritative local session", () => {
  it("accepts one command at a version, rejects stale/conflicting identities and never applies a duplicate twice", () => {
    const game = session();
    const result = game.mutate("alice", "step", operation());
    expect(result.version).toBe(2);
    expect(game.inspect().state.step).toBe("attack");
    expect(() => game.mutate("alice", "step", operation("racing"))).toThrow(
      "Conflict"
    );
    expect(game.mutate("alice", "step", operation())).toMatchObject({
      version: 2,
      duplicate: true,
      duplicateVersion: 2,
    });
    expect(() => game.mutate("bob", "step", operation())).toThrow(
      "identity mismatch"
    );
    expect(() =>
      game.mutate("alice", "action", { ...operation(), actionId: "forged" })
    ).toThrow("identity mismatch");
    expect(game.inspect().trace).toHaveLength(1);
  });
  it("rejects the wrong actor and illegal input without changing any committed state", () => {
    const game = session();
    const before = game.inspect();
    expect(() => game.mutate("bob", "step", operation())).toThrow(
      "allowed only"
    );
    expect(() =>
      game.mutate("alice", "action", { ...operation(), actionId: "forged" })
    ).toThrow("not in legal actions");
    expect(() => game.mutate("alice", "step", { expectedVersion: 1 })).toThrow(
      "metadata"
    );
    expect(game.inspect()).toEqual(before);
  });
  it("projects only the viewer's private cards and isolates sessions and returned snapshots", () => {
    const first = session();
    const second = session();
    expect(
      first
        .view("alice")
        .state.cardInstances.find((card) => card.instanceId === "alice-secret")
        ?.definitionId
    ).toBe("BSTH01-C01");
    expect(
      first
        .view("bob")
        .state.cardInstances.find((card) => card.instanceId === "alice-secret")
        ?.definitionId
    ).toBe("_hidden_card_");
    expect(() => first.view("third-party")).toThrow("Not a player");
    first.inspect().state.step = "end";
    first.mutate("alice", "step", operation());
    expect(second.inspect().state.step).toBe("main");
    expect(second.inspect().version).toBe(1);
  });
  it("settles a missing acknowledgement and fences an uncommitted late request", () => {
    const game = session();
    game.mutate("alice", "step", operation());
    expect(game.settle("alice", "step", "first", {})).toMatchObject({
      outcome: "applied",
      appliedVersion: 2,
    });
    expect(game.settle("alice", "step", "late", {})).toMatchObject({
      outcome: "cancelled",
      appliedVersion: null,
    });
    expect(() => game.mutate("alice", "step", operation("late", 2))).toThrow(
      "CANCELLED"
    );
    expect(() => game.settle("bob", "step", "first", {})).toThrow(
      "identity mismatch"
    );
    expect(game.currentVersion).toBe(2);
  });
  it("acknowledges a late pregame update after start without changing state", () => {
    const game = session();
    game.mutate("alice", "step", operation());
    const before = game.inspect();
    expect(
      game.mutate("bob", "pregame-update", {
        ...operation("late-pregame"),
        preGame: {},
      })
    ).toMatchObject({ alreadyComplete: true, version: 2 });
    expect(game.inspect()).toEqual(before);
  });
  it.each(["alice", "bob"])(
    "%s executes the room action/auto-drain pipeline and finishes the pending choice",
    (owner) => {
      const game = new LocalGameSession(
        "local-oracle",
        buildBlazingStarOracleScenario(
          [...ALL_CARDS],
          new URLSearchParams({ owner })
        )
      );
      let sequence = 0;
      const act = (actor: string, kind: string, extra = {}) => {
        const action = game
          .actions(actor)
          .actions.find((a) => a.kind === kind)!;
        expect(action).toBeDefined();
        game.mutate(actor, "action", {
          actionId: action.actionId,
          ...extra,
          expectedVersion: game.currentVersion,
          clientMutationId: `oracle-${++sequence}`,
        });
      };
      act(owner, "resolve_pending_triggered_effect");
      act(owner === "alice" ? "bob" : "alice", "pass_stack");
      act(owner, "resolve_pending_deck_reveal_pick", {
        selectedDeckRevealCardIds: ["oracle-deck-1"],
      });
      const state = game.inspect().state;
      expect(
        state.cardInstances.find((card) => card.instanceId === "yamazanadu")
          ?.normalCoreCount
      ).toBe(2);
      expect(
        state.cardInstances.find((card) => card.instanceId === "oracle-deck-1")
          ?.zone
      ).toBe("hand");
      expect(state.pendingDeckReveal).toBeNull();
      expect(state.pendingAfterTriggersContinuations).toEqual([]);
      expect(game.inspect().trace).toHaveLength(3);
    }
  );
});
