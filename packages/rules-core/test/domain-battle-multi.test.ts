import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueBattleEndTriggers,
  type GameState,
} from "../src/runtime";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => [],
};
const inst = (no: string, id: string, cores: number) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: cores,
    exhaustState: "exhausted",
  });
function drain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 40; i++) {
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
function battle(
  state: GameState,
  attackId: string,
  participantInstanceIds: readonly string[] = ["first", "second"]
) {
  return queueBattleEndTriggers({
    state,
    participantInstanceIds: [...participantInstanceIds],
    blockSideInstanceIds: [],
    attackId,
    ...options,
  });
}
describe("同時バトル終了時の領域の主語と回数", () => {
  it("諏訪子2枚でも各参加者が1回ずつ回復し、同ターンの再バトルでは回復しない", () => {
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          inst("BSTH05-X02", "suwako-a", 4),
          inst("BSTH05-X02", "suwako-b", 4),
          inst("BSTH05-X01", "first", 4),
          inst("BSTH05-X01", "second", 4),
          inst("BSTH05-X01", "nonparticipant", 4),
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 3,
    };
    const first = drain(battle(base, "battle-1"));
    for (const id of ["first", "second"])
      expect(
        first.cardInstances.find((c) => c.instanceId === id)?.exhaustState
      ).toBe("recovered");
    expect(
      first.cardInstances.find((c) => c.instanceId === "nonparticipant")
        ?.exhaustState
    ).toBe("exhausted");
    const exhausted: GameState = {
      ...first,
      cardInstances: first.cardInstances.map((c) => ({
        ...c,
        exhaustState: "exhausted",
      })),
    };
    const second = drain(battle(exhausted, "battle-2"));
    for (const id of ["first", "second"])
      expect(
        second.cardInstances.find((c) => c.instanceId === id)?.exhaustState
      ).toBe("exhausted");
    const reentered = drain(
      battle(
        {
          ...second,
          cardInstances: second.cardInstances.map((c) =>
            c.instanceId === "first" ? { ...c, fieldInstanceGeneration: 1 } : c
          ),
        },
        "battle-3"
      )
    );
    expect(
      reentered.cardInstances.find((c) => c.instanceId === "first")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      reentered.cardInstances.find((c) => c.instanceId === "second")
        ?.exhaustState
    ).toBe("exhausted");
    const repeat = drain(
      battle(
        {
          ...reentered,
          cardInstances: reentered.cardInstances.map((c) => ({
            ...c,
            exhaustState: "exhausted",
          })),
        },
        "battle-4"
      )
    );
    for (const id of ["first", "second"])
      expect(
        repeat.cardInstances.find((c) => c.instanceId === id)?.exhaustState
      ).toBe("exhausted");
    const nextTurn = drain(battle({ ...repeat, turnNumber: 5 }, "battle-5"));
    for (const id of ["first", "second"])
      expect(
        nextTurn.cardInstances.find((c) => c.instanceId === id)?.exhaustState
      ).toBe("recovered");
  });

  it("本文の系統を持たない参加スピリットと創界神ネクサスは回復しない", () => {
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          inst("BSTH05-X02", "suwako", 4),
          inst("BSTH05-X01", "fuzin-spirit", 4),
          inst("BSTH05-C01", "unrelated-spirit", 4),
          inst("BSTH10-X01", "unrelated-grandwalker", 4),
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 3,
    };

    const spiritBattle = drain(
      battle(base, "battle-unrelated-spirit", [
        "fuzin-spirit",
        "unrelated-spirit",
      ])
    );
    expect(
      spiritBattle.cardInstances.find((c) => c.instanceId === "fuzin-spirit")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      spiritBattle.cardInstances.find(
        (c) => c.instanceId === "unrelated-spirit"
      )?.exhaustState
    ).toBe("exhausted");

    const nexusBattle = drain(
      battle(
        {
          ...spiritBattle,
          cardInstances: spiritBattle.cardInstances.map((card) => ({
            ...card,
            exhaustState:
              card.instanceId === "unrelated-grandwalker"
                ? "exhausted"
                : card.exhaustState,
          })),
        },
        "battle-unrelated-grandwalker",
        ["fuzin-spirit", "unrelated-grandwalker"]
      )
    );
    expect(
      nexusBattle.cardInstances.find(
        (c) => c.instanceId === "unrelated-grandwalker"
      )?.exhaustState
    ).toBe("exhausted");
  });
});
