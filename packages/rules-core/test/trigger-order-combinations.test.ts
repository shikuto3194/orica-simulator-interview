import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  type GameState,
  type PendingTriggeredEffect,
  type TriggerEventKind,
} from "../src";
import { scopeInnermostTriggerReactions } from "../src/effect/trigger-resolution-scope";

// 「～るとき」「～したとき」「離れるとき」「離れたとき」「効果発揮後」
// とステップ退出の区間を代表するイベント。バーストは通常誘発の後で別途検証する。
const timings = [
  "targeted",
  "summon",
  "destroy",
  "leave_field",
  "effect_activated",
  "main_step_end",
] as const satisfies readonly TriggerEventKind[];
type Queue = "public" | "private";

function add(
  state: GameState,
  queue: Queue,
  id: string,
  chain: string,
  group: string,
  event: TriggerEventKind,
  owner: string
) {
  const pending: PendingTriggeredEffect = {
    pendingId: id,
    actingPlayerId: owner,
    eventKind: event,
    source: "action_resolution",
    chainId: chain,
    attackId: null,
    relatedPlayerId: owner,
    relatedInstanceId: id,
    amount: 1,
    step: "main",
    window: "step_start",
    resolvedSourceInstanceIds: [],
    simultaneousGroupId: group,
  };
  if (queue === "public") state.pendingTriggeredEffects.push(pending);
  else
    state.pendingPrivateDeclarations.push({
      ...pending,
      declarationId: id,
      ownerPlayerId: owner,
      sourceInstanceId: id,
      sourceDefinitionId: "ORDER-TEST",
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
    });
}
const ids = (state: GameState) => {
  const visible = scopeInnermostTriggerReactions(state);
  return [
    ...visible.pendingTriggeredEffects,
    ...visible.pendingPrivateDeclarations,
  ]
    .map((p) => p.pendingId)
    .sort();
};
const remove = (state: GameState, prefix: string): GameState => ({
  ...state,
  pendingTriggeredEffects: state.pendingTriggeredEffects.filter(
    (p) => !p.pendingId.startsWith(prefix)
  ),
  pendingPrivateDeclarations: state.pendingPrivateDeclarations.filter(
    (p) => !p.pendingId.startsWith(prefix)
  ),
});

describe("タイミング・公開/非公開・両者・保存・投入順の直積", () => {
  for (const outerTiming of timings)
    for (const innerTiming of timings)
      for (const outerQueue of ["public", "private"] as const)
        for (const innerQueue of ["public", "private"] as const)
          for (const owner of ["alice", "bob"])
            for (const snapshot of [false, true])
              for (const reversed of [false, true]) {
                it(`${outerTiming}/${innerTiming} ${outerQueue}/${innerQueue} ${owner} snapshot=${snapshot} reversed=${reversed}`, () => {
                  let state = createEmptyGameState({
                    playerIds: ["alice", "bob"],
                  });
                  const opponent = owner === "alice" ? "bob" : "alice";
                  add(
                    state,
                    outerQueue,
                    "outer",
                    "root",
                    "outer-group",
                    outerTiming,
                    owner
                  );
                  add(
                    state,
                    innerQueue,
                    "outer-peer",
                    "other-root",
                    "outer-group",
                    outerTiming,
                    opponent
                  );
                  add(
                    state,
                    innerQueue,
                    "inner",
                    "trigger:root:child",
                    "inner-group",
                    innerTiming,
                    opponent
                  );
                  add(
                    state,
                    outerQueue,
                    "inner-peer",
                    "other-inner-root",
                    "inner-group",
                    innerTiming,
                    owner
                  );
                  add(
                    state,
                    outerQueue,
                    "grandchild",
                    "trigger:root:child:grandchild",
                    "grandchild-group",
                    innerTiming,
                    owner
                  );
                  if (reversed) {
                    state.pendingTriggeredEffects.reverse();
                    state.pendingPrivateDeclarations.reverse();
                  }
                  if (snapshot)
                    state = JSON.parse(JSON.stringify(state)) as GameState;
                  expect(
                    ids(state),
                    "孫が外側二層とその同時誘発群より先"
                  ).toEqual(["grandchild"]);
                  expect(
                    state.pendingTriggeredEffects.length +
                      state.pendingPrivateDeclarations.length,
                    "合法手用の絞り込みは元の待機を消さない"
                  ).toBe(5);
                  state = remove(state, "grandchild");
                  expect(
                    ids(state),
                    "孫の解決・辞退後は内側の同時誘発群"
                  ).toEqual(["inner", "inner-peer"]);
                  state = remove(state, "inner");
                  expect(
                    ids(state),
                    "内側が空になって初めて外側へ戻る"
                  ).toEqual(["outer", "outer-peer"]);
                });
              }
});
