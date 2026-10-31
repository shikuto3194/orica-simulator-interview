import { describe, expect, it } from "vitest";
import { executeSpiritHandSwap } from "../src/mechanics/accel-change-system";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";

function spirit(cardNo: string, effects: Effect[] = []): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

describe("入替の状態継承（Q5846/5847/5849・05 分離）", () => {
  for (const exhaustState of [
    "recovered",
    "exhausted",
    "heavily_exhausted",
  ] as const)
    for (const enterRecovered of [false, true])
      for (const braveMode of [
        "combined",
        "separated",
        "cannot-exhaust",
      ] as const)
        it(`${exhaustState} recovered=${enterRecovered} brave=${braveMode}`, () => {
          const host = { ...spirit("SWAP-HOST"), cost: 5 };
          const incoming = spirit("SWAP-INCOMING");
          const brave: CardDefinition = {
            ...spirit("SWAP-BRAVE"),
            printedCategory: "brave",
            braveCondition: { minCost: braveMode === "combined" ? 1 : 5 },
            textLines:
              braveMode === "cannot-exhaust"
                ? [
                    "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。",
                  ]
                : [],
          };
          const getDef = (id: string) =>
            [host, incoming, brave].find((d) => d.cardNo === id);
          const state = createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              {
                ...createCardInstance(host, {
                  instanceId: "source",
                  ownerPlayerId: "alice",
                  zone: "field",
                  cores: 2,
                }),
                exhaustState,
                attachedChildrenIds: ["brave"],
              },
              createCardInstance(incoming, {
                instanceId: "hand",
                ownerPlayerId: "alice",
                zone: "hand",
              }),
              {
                ...createCardInstance(brave, {
                  instanceId: "brave",
                  ownerPlayerId: "alice",
                  zone: "field",
                  cores: 1,
                }),
                exhaustState,
                attachedToInstanceId: "source",
              },
            ],
          });
          const result = executeSpiritHandSwap(
            state,
            "hand",
            "source",
            "swap:audit",
            "alice",
            getDef,
            {},
            enterRecovered
          );
          const card = (id: string) =>
            result.cardInstances.find((c) => c.instanceId === id)!;
          const expected = enterRecovered ? "recovered" : exhaustState;
          expect(card("hand").exhaustState).toBe(expected);
          expect(card("hand").normalCoreCount).toBe(2);
          expect(card("source").normalCoreCount).toBe(0);
          expect(card("source").zone).toBe("hand");
          expect(card("brave").attachedToInstanceId).toBe(
            braveMode === "combined" ? "hand" : null
          );
          expect(card("brave").exhaustState).toBe(
            braveMode === "cannot-exhaust" ? "recovered" : expected
          );
          expect(result.players[0]!.reserveNormalCoreCount).toBe(
            state.players[0]!.reserveNormalCoreCount
          );
        });
});

// 03c: 「その後」は前述を解決してから発揮する。
// 02d: 中断中の選択を終えるまで原因の効果は完了しない。
describe("入替選択と後続本文の組合せ", () => {
  for (const owner of ["alice", "bob"])
    for (const route of ["hand-trash", "field-hand"] as const)
      for (const connector of [
        "simultaneous",
        "sequential",
        "after_triggers",
        "after_state_check",
        "conditional_cost",
        "conditional_result",
        "unless_previous_succeeded",
        "last",
      ] as const)
        for (const accept of [false, true])
          for (const snapshot of [false, true])
            for (const battle of [false, true])
              for (const repeat of route === "hand-trash" &&
              connector === "sequential"
                ? [0, 2]
                : [0])
                it(`${owner} ${route} ${connector} accept=${accept} snapshot=${snapshot} battle=${battle} repeat=${repeat}`, () => {
                  const effect: Effect = {
                    timing: { kind: "activated", mode: "main" },
                    steps: [
                      {
                        ...(repeat ? { repeat: { additional: repeat } } : {}),
                        ...(!accept
                          ? { executionMode: "optional" as const }
                          : {}),
                        action:
                          route === "hand-trash"
                            ? {
                                kind: "queue_hand_trash_swap",
                                outgoingFilter: {},
                                incomingFilter: {},
                              }
                            : {
                                kind: "queue_field_hand_swap",
                                incomingFilter: {},
                              },
                      },
                      ...(connector === "last"
                        ? []
                        : [
                            {
                              connector,
                              action: {
                                kind: "count_increase" as const,
                                player: "self" as const,
                                amount: 2,
                              },
                            },
                          ]),
                    ],
                  };
                  const source = spirit("COMBINATION-SOURCE", [effect]);
                  const filler = spirit("COMBINATION-FILLER");
                  const watcher = spirit("COMBINATION-WATCHER", [
                    {
                      timing: {
                        kind: "game_event",
                        event: "effect_activated",
                        player: "self",
                      },
                      steps: [{ action: { kind: "draw", count: 1 } }],
                    },
                  ]);
                  const definitions = [source, filler, watcher];
                  const lookups = {
                    getCardDefinitionById: (id: string) =>
                      definitions.find((d) => d.cardNo === id),
                    getRegisteredTriggeredEffectActions:
                      buildTriggeredEffectLookup(definitions),
                    getRegisteredBurstActions: () => [],
                    getRegisteredFieldCardEffectActions: () => [],
                  };
                  let state = createEmptyGameState({
                    playerIds: ["alice", "bob"],
                    playerOverrides: [{ countValue: 3 }, { countValue: 3 }],
                    cardInstances: [
                      createCardInstance(source, {
                        instanceId: "source",
                        ownerPlayerId: owner,
                        zone: "field",
                        cores: 1,
                      }),
                      createCardInstance(watcher, {
                        instanceId: "watcher",
                        ownerPlayerId: owner,
                        zone: "field",
                        cores: 1,
                      }),
                      createCardInstance(filler, {
                        instanceId: "hand",
                        ownerPlayerId: owner,
                        zone: "hand",
                      }),
                      createCardInstance(filler, {
                        instanceId: "trash",
                        ownerPlayerId: owner,
                        zone: "trash",
                      }),
                    ],
                  });
                  state = { ...state, activePlayerId: owner, step: "main" };
                  const chainId = "combination:outer:inner";
                  if (battle)
                    state.pendingBattleEndFinalizeAttackIds = ["swap-audit"];
                  state = executeEffect({
                    state,
                    effect,
                    effectIndex: 0,
                    sourceInstanceId: "source",
                    actingPlayerId: owner,
                    chainId,
                    ...(battle
                      ? { battleEndDeferralAttackId: "swap-audit" }
                      : {}),
                    postResolutionOracle: {
                      triggerKind: "effect_activated",
                      triggerCardInstanceId: "source",
                      chainId,
                      activatorPlayerId: owner,
                      effectActivationLogStart: state.log.length,
                    },
                    ...lookups,
                  });
                  expect(
                    Boolean(
                      route === "hand-trash"
                        ? state.pendingHandTrashSwapChoice
                        : state.pendingFieldHandSwapChoice
                    )
                  ).toBe(accept);
                  expect(
                    state.players.find((p) => p.id === owner)?.countValue,
                    "入替の選択前に後段を発揮しない"
                  ).toBe(3);
                  expect(
                    state.pendingTriggeredEffects.some(
                      (p) => p.eventKind === "effect_activated"
                    )
                  ).toBe(false);
                  if (battle)
                    expect(state.pendingBattleEndFinalizeAttackIds).toContain(
                      "swap-audit"
                    );
                  if (snapshot)
                    state = JSON.parse(JSON.stringify(state)) as GameState;
                  if (!accept) {
                    const decline = getLegalActions({
                      state,
                      actingPlayerId: owner,
                      ...lookups,
                    }).find(
                      (a) =>
                        a.kind === "resolve_pending_step_optional_choice" &&
                        a.choice === "decline"
                    );
                    expect(decline).toBeDefined();
                    state = applyLegalAction({
                      state,
                      action: decline!,
                      ...lookups,
                    }).state;
                  }
                  const kind =
                    route === "hand-trash"
                      ? "swap_hand_trash"
                      : "swap_field_hand";
                  let selections = 0;
                  while (
                    state.pendingHandTrashSwapChoice ||
                    state.pendingFieldHandSwapChoice
                  ) {
                    expect(selections).toBeLessThan(4);
                    expect(
                      state.players.find((p) => p.id === owner)?.countValue
                    ).toBe(3);
                    if (snapshot)
                      state = JSON.parse(JSON.stringify(state)) as GameState;
                    const action = getLegalActions({
                      state,
                      actingPlayerId: owner,
                      ...lookups,
                    }).find((a) => a.kind === kind);
                    expect(action).toBeDefined();
                    state = applyLegalAction({
                      state,
                      action: action!,
                      ...lookups,
                    }).state;
                    selections++;
                  }
                  expect(selections).toBe(accept ? repeat + 1 : 0);
                  expect(state.pendingHandTrashSwapChoice).toBeNull();
                  expect(state.pendingFieldHandSwapChoice).toBeNull();
                  const continues =
                    connector !== "last" &&
                    (connector === "conditional_cost" ||
                    connector === "conditional_result"
                      ? accept
                      : connector === "unless_previous_succeeded"
                        ? !accept
                        : true);
                  expect(
                    state.players.find((p) => p.id === owner)?.countValue,
                    "受諾・辞退後に後段を1回だけ発揮する"
                  ).toBe(continues ? 5 : 3);
                  const activated = connector !== "conditional_cost" || accept;
                  expect(
                    state.pendingTriggeredEffects.filter(
                      (p) => p.eventKind === "effect_activated"
                    )
                  ).toHaveLength(activated ? 1 : 0);
                  if (activated)
                    expect(
                      state.pendingTriggeredEffects.find(
                        (p) => p.eventKind === "effect_activated"
                      )?.chainId
                    ).toContain(chainId);
                  expect(
                    state.cardInstances.find((c) => c.instanceId === "hand")
                      ?.zone
                  ).toBe(
                    accept
                      ? route === "hand-trash"
                        ? "trash"
                        : "field"
                      : "hand"
                  );
                });
});
