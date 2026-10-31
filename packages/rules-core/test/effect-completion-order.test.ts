import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

function spirit(cardNo: string, effects: Effect[] = []): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}
function scenario(withBursts: boolean) {
  const magic: CardDefinition = {
    ...spirit("TEST-HITEN"),
    name: "飛天御剣流『順序検証』",
    printedCategory: "magic",
    cost: 2,
    reductionSymbols: ["red", "white"],
    levelDefs: [],
    symbolColors: [],
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const parent = spirit("TEST-PARENT", [
    {
      timing: {
        kind: "game_event",
        event: "increase_hand",
        player: "opponent",
      },
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  ]);
  const child = spirit("TEST-CHILD", [
    {
      timing: {
        kind: "game_event",
        event: "increase_hand",
        player: "opponent",
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 3 } },
      ],
    },
  ]);
  const burst = spirit("TEST-BURST", [
    {
      timing: {
        kind: "burst",
        trigger: "相手の効果によって相手の手札が増えた後",
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 4 } },
      ],
    },
  ]);
  burst.textLines = ["【バースト：相手の効果によって相手の手札が増えた後】"];
  const defs = [...ALL_CARDS, magic, parent, child, burst];
  const map = new Map(defs.map((def) => [def.cardNo, def]));
  const lookups = {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredMagicActions: buildMagicLookup(defs),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: buildBurstEffectLookup(defs),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  };
  const card = (
    no: string,
    id: string,
    owner: string,
    zone: "hand" | "field" | "deck" | "burst"
  ) =>
    createCardInstance(map.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card("BSRK01-CX01", "kenshin", "alice", "field"),
        card(magic.cardNo, "magic", "alice", "hand"),
        card(parent.cardNo, "parent", "bob", "field"),
        card(child.cardNo, "child", "alice", "field"),
        card(child.cardNo, "a-deck", "alice", "deck"),
        card(child.cardNo, "b-deck", "bob", "deck"),
        ...(withBursts
          ? [
              card(burst.cardNo, "outer-burst", "bob", "burst"),
              card(burst.cardNo, "inner-burst", "alice", "burst"),
            ]
          : []),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
  if (withBursts)
    state = {
      ...state,
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "outer-burst" },
        { playerId: "alice", cardInstanceId: "inner-burst" },
      ],
    };
  const actions = () =>
    ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      )
      .filter((a) => a.can);
  const apply = (kind: string, id?: string) => {
    const action = actions().find(
      (a) =>
        a.kind === kind &&
        (id === undefined ||
          ("sourceInstanceId" in a && a.sourceInstanceId === id) ||
          ("cardInstanceId" in a && a.cardInstanceId === id))
    );
    expect(
      action,
      JSON.stringify({
        kind,
        id,
        actions: actions(),
        window: state.stackWindow,
        continuations: state.pendingAfterTriggersContinuations,
        completions: state.pendingEffectCompletions,
        pending: state.pendingTriggeredEffects,
        log: state.log.slice(-15),
      })
    ).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...lookups }).state;
  };
  const pass = () => {
    for (let guard = 0; state.stackWindow && guard < 12; guard++)
      apply("pass_stack");
    expect(state.stackWindow).toBeNull();
  };
  const count = (player: string) =>
    state.players.find((p) => p.id === player)!.countValue;
  return { actions, apply, pass, count, state: () => state };
}

describe("効果発揮後は内部の通常派生・発揮後を待ち、通常バーストより先", () => {
  it.each([false, true])(
    "剣心: 内部のドロー派生→内部発揮後→外部発揮後（バースト=%s）",
    (withBursts) => {
      const s = scenario(withBursts);
      const canKenshin = () =>
        s
          .actions()
          .some(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "kenshin"
          );
      s.apply("use_magic", "magic");
      s.pass();
      expect(canKenshin()).toBe(false);
      if (withBursts) {
        s.apply("resolve_pending_burst_check", "outer-burst");
        s.pass();
      }
      s.apply("resolve_pending_triggered_effect", "parent");
      s.pass();
      expect(canKenshin()).toBe(false);
      expect(s.count("bob")).toBe(0);
      if (withBursts) {
        s.apply("resolve_pending_burst_check", "inner-burst");
        s.pass();
      }
      s.apply("resolve_pending_triggered_effect", "child");
      s.pass();
      expect(s.count("alice")).toBe(3);
      expect(s.count("bob")).toBe(1);
      expect(canKenshin()).toBe(true);
      s.apply("resolve_pending_triggered_effect", "kenshin");
      s.pass();
      expect(s.count("alice")).toBe(withBursts ? 9 : 5);
      expect(s.count("bob")).toBe(withBursts ? 5 : 1);
      expect(s.state().pendingBurstChecks).toHaveLength(0);
      expect(s.state().pendingAfterTriggersContinuations).toHaveLength(0);
    }
  );
});
