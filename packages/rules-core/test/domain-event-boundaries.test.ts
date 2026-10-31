import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type GameState,
  type CardZone,
} from "../src";

const target: CardDefinition = {
  ...ALL_CARDS.find((c) => c.cardNo === "BSTH01-C01")!,
  cardNo: "DOMAIN-EVENT-TARGET",
  tribe: "妖精・地霊・風神",
  effects: [],
};
const defs = [
  ...ALL_CARDS,
  target,
  { ...target, cardNo: "DOMAIN-EVENT-OTHER", tribe: "無関係" },
];
const getDef = (id: string) => defs.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: () => [],
};
const inst = (
  no: string,
  id: string,
  cores = 1,
  owner = "alice",
  zone: CardZone = "field"
) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
function setup(no: string, cores: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 0, deckCount: 5 }, { handCount: 2 }],
      cardInstances: [
        inst(no, "source", cores),
        inst(no, "copy", cores),
        inst(target.cardNo, "summoned"),
        inst(target.cardNo, "second"),
        inst(target.cardNo, "trash", 0, "alice", "trash"),
        ...[0, 1, 2, 3, 4].map((i) =>
          inst(target.cardNo, `deck-${i}`, 0, "alice", "deck")
        ),
        ...[0, 1].map((i) =>
          inst(target.cardNo, `hand-${i}`, 0, "bob", "hand")
        ),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    turnNumber: 3,
  };
}
function summon(
  state: GameState,
  chainId: string,
  fromZone: CardZone = "hand",
  ids = ["summoned"]
) {
  return queuePendingReactionsFromTriggerEvents(
    state,
    ids.map((id) => ({
      actingPlayerId: "alice",
      eventKind: "summon" as const,
      source: "action_resolution" as const,
      chainId,
      attackId: null,
      relatedInstanceId: id,
      relatedPlayerId: state.cardInstances.find((c) => c.instanceId === id)!
        .controllerPlayerId,
      amount: 1,
      fromZone,
    })),
    undefined,
    options
  );
}
function drain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 30; i++) {
    const actions = current.players.flatMap((p) =>
      getLegalActions({ state: current, actingPlayerId: p.id, ...options })
    );
    const action =
      actions.find((a) => a.kind === "pass_stack") ??
      actions.find((a) => a.kind === "select_pending_to_resolve") ??
      actions.find(
        (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
      );
    if (!action) break;
    current = applyLegalAction({
      state: current,
      action,
      skipOptionalEffect: false,
      ...options,
    }).state;
  }
  return current;
}

describe("リリーブラック・さとりの領域を原文の条件付きで実解決", () => {
  it("リリーブラック2枚・妖精2体同時召喚でも1枚ドローし、別の召喚では再び1枚ドローする", () => {
    const first = drain(
      summon(setup("BSTH07.8-XX01", 1), "summon-1", "hand", [
        "summoned",
        "second",
      ])
    );
    expect(first.players[0]!.handCount).toBe(1);
    const second = drain(summon(first, "summon-2"));
    expect(second.players[0]!.handCount).toBe(2);
  });
  it.each(["trash", "turn", "level", "tribe", "opponent"])(
    "リリーブラックは %s の条件外でドローしない",
    (change) => {
      const base = setup("BSTH07.8-XX01", change === "level" ? 0 : 1);
      const state = {
        ...base,
        activePlayerId: change === "turn" ? "bob" : "alice",
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "summoned"
            ? {
                ...c,
                ...(change === "tribe"
                  ? { definitionId: "DOMAIN-EVENT-OTHER" }
                  : {}),
                ...(change === "opponent"
                  ? { controllerPlayerId: "bob", ownerPlayerId: "bob" }
                  : {}),
              }
            : c
        ),
      };
      const result = drain(
        summon(state, "summon-negative", change === "trash" ? "trash" : "hand")
      );
      expect(result.players[0]!.handCount).toBe(0);
    }
  );
  it("さとりは自分メインの地霊召喚で相手の手札をすべて手元へ移し、同名でターン1回を共有する", () => {
    const first = drain(summon(setup("BSTH06-X01", 3), "summon-1"));
    expect(
      first.cardInstances
        .filter((c) => c.instanceId.startsWith("hand-"))
        .every((c) => c.zone === "set_aside")
    ).toBe(true);
    const extraHand = {
      ...first,
      cardInstances: [
        ...first.cardInstances,
        inst(target.cardNo, "new-hand", 0, "bob", "hand"),
      ],
      players: first.players.map((p) =>
        p.id === "bob" ? { ...p, handCount: 1 } : p
      ),
    };
    expect(
      drain(summon(extraHand, "summon-2")).cardInstances.find(
        (c) => c.instanceId === "new-hand"
      )?.zone
    ).toBe("hand");
  });
  it.each(["step", "turn", "level", "tribe", "no-trash"])(
    "さとりは %s の条件外で手札を動かさない",
    (change) => {
      const base = setup("BSTH06-X01", change === "level" ? 2 : 3);
      const state: GameState = {
        ...base,
        step: change === "step" ? "attack" : "main",
        activePlayerId: change === "turn" ? "bob" : "alice",
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "summoned" && change === "tribe"
            ? { ...c, definitionId: "DOMAIN-EVENT-OTHER" }
            : c.instanceId === "trash" && change === "no-trash"
              ? { ...c, zone: "removed_from_game" }
              : c
        ),
      };
      const result = drain(summon(state, "summon-negative"));
      expect(
        result.cardInstances
          .filter((c) => c.instanceId.startsWith("hand-"))
          .every((c) => c.zone === "hand")
      ).toBe(true);
    }
  );
});
