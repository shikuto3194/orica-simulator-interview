import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForViewer,
} from "../src";
import {
  applyFreeMirageSetBookkeeping,
  getAvailableMiragePaymentSources,
  planMirageSetReplacements,
  removeMirageSetState,
  resolveDeferredSetMirageStack,
  useSetMirageInStackContextAsAction,
  useEffectSetMirageAsAction,
} from "../src/mechanics/mirage-system";
import type { CardDefinition, GameState, LegalAction } from "../src";
import type { Effect } from "../src/dsl-types";
import { replaceCardInstances } from "../src/zone/card-instance-state";
import { moveCardZone } from "../src/core/core-system";
import { assertPendingTriggerChainIds } from "../src/chain-id";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const C01 = definitions.get("BSTH002-C01")!;
const A = definitions.get("BSGE01-C02")!;
const B = definitions.get("BSTH002-C04")!;
const SOURCE = definitions.get("BSTH002-X01")!;
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => undefined,
};

function fixture(
  existing: CardDefinition[],
  incoming: CardDefinition,
  zone: "hand" | "deck" | "revealed"
) {
  const cards = existing.map((definition, i) =>
    createCardInstance(definition, {
      instanceId: `old-${i}`,
      ownerPlayerId: "alice",
      zone: "mirage",
    })
  );
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        reserveNormalCoreCount: 10,
        handCount: zone === "hand" ? 1 : 0,
        deckCount: zone === "deck" ? 1 : 0,
      },
      { handCount: 1 },
    ],
    cardInstances: [
      createCardInstance(incoming, {
        instanceId: "incoming",
        ownerPlayerId: "alice",
        zone,
      }),
      ...cards,
      createCardInstance(SOURCE, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(A, {
        instanceId: "secret-opponent-card",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ],
    mirageSetStates: cards.map((card) => ({
      playerId: "alice",
      cardInstanceId: card.instanceId,
    })),
    mirageSetPlayerIdsThisTurn: ["alice"],
    mirageSetCountExemptionsUsed: [{ playerId: "alice", cardNo: C01.cardNo }],
  });
  return { ...state, activePlayerId: "alice", step: "main" as const };
}

function legal(state: GameState): LegalAction[] {
  return getLegalActions({ state, actingPlayerId: "alice", ...lookups });
}

function choose(state: GameState, replacement: string[]) {
  // 実カードの交換待ちでも保存中の原因文脈を検査できることを確認する。
  expect(() => assertPendingTriggerChainIds(state)).not.toThrow();
  const choices = legal(state).filter(
    (action) => action.kind === "resolve_pending_step_choice"
  );
  const label = replacement.length
    ? `${
        replacement[0] === "old-0"
          ? C01.name
          : getCardDefinitionById(
              state.cardInstances.find(
                (card) => card.instanceId === replacement[0]
              )!.definitionId
            )!.name
      }（セット${replacement[0] === "old-0" ? 1 : 2}）と入れ替え`
    : "追加";
  const selected = choices.find(
    (action) =>
      action.kind === "resolve_pending_step_choice" &&
      action.choiceLabel === label
  );
  expect(selected, JSON.stringify(choices)).toBeDefined();
  const viewer = sanitizeStateForViewer(state, "alice");
  expect(viewer.pendingStepChoice?.mirageSetChoice).toBeUndefined();
  expect(JSON.stringify(viewer.pendingStepChoice)).not.toContain(
    "secret-opponent-card"
  );
  expect(
    viewer.cardInstances.find(
      (card) => card.instanceId === "secret-opponent-card"
    )?.definitionId
  ).not.toBe(A.cardNo);
  return applyLegalAction({ state, action: selected!, ...lookups }).state;
}

function assertResult(
  state: GameState,
  original: GameState,
  replacement: string[],
  paid: number
) {
  expect(state.pendingStepChoice).toBeNull();
  expect(state.pendingDeckReveal).toBeNull();
  expect(state.stackWindow).toBeNull();
  expect(
    state.cardInstances.find((card) => card.instanceId === "incoming")?.zone
  ).toBe("mirage");
  expect(
    state.mirageSetStates.map((entry) => entry.cardInstanceId).sort()
  ).toEqual(
    ["old-0", "old-1"]
      .filter((id) => !replacement.includes(id))
      .concat("incoming")
      .sort()
  );
  for (const id of ["old-0", "old-1"])
    expect(
      state.cardInstances.find((card) => card.instanceId === id)?.zone
    ).toBe(replacement.includes(id) ? "hand" : "mirage");
  expect(
    state.log.filter((line) => line.startsWith("mirage:replace:"))
  ).toEqual(replacement.map((id) => `mirage:replace:alice:${id}->incoming`));
  expect(state.mirageSetPlayerIdsThisTurn).toEqual(
    original.mirageSetPlayerIdsThisTurn
  );
  expect(state.mirageSetCountExemptionsUsed).toEqual(
    original.mirageSetCountExemptionsUsed
  );
  expect(state.players[0]!.reserveNormalCoreCount).toBe(10 - paid);
  expect(
    new Set(state.mirageSetStates.map((entry) => entry.cardInstanceId)).size
  ).toBe(state.mirageSetStates.length);
}

const combinations = [
  {
    title:
      "化け化け+Aから通常Bは全効果writerでAだけを交換し、使用履歴を消費しない",
    existing: [C01, A],
    incoming: B,
    expected: [["old-1"]],
  },
  {
    title:
      "化け化け+Aから化け化けBは全効果writerで追加または各1枚を選び、使用履歴を消費しない",
    existing: [C01, A],
    incoming: C01,
    expected: [[], ["old-0"], ["old-1"]],
  },
  {
    title:
      "化け化け2枚から通常Bは全効果writerで追加または各1枚を選び、使用履歴を消費しない",
    existing: [C01, C01],
    incoming: B,
    expected: [[], ["old-0"], ["old-1"]],
  },
  {
    title:
      "化け化け2枚から化け化けCは全効果writerで追加または各1枚を選び、使用履歴を消費しない",
    existing: [C01, C01],
    incoming: C01,
    expected: [[], ["old-0"], ["old-1"]],
  },
];

describe("化け化けを含む効果ミラージュセットの個別交換", () => {
  function declareBeforeResponse() {
    const initial = {
      ...fixture([C01, A], B, "hand"),
      mirageSetPlayerIdsThisTurn: [],
    };
    const cost = getAvailableMiragePaymentSources({
      state: initial,
      actingPlayerId: "alice",
      mirageData: B.mirageData!,
      sourceInstanceId: "incoming",
      getCardDefinitionById,
    }).reduction.finalCost;
    const declared = useSetMirageInStackContextAsAction({
      state: initial,
      actingPlayerId: "alice",
      sourceInstanceId: "incoming",
      replacedMirageInstanceIds: ["old-1"],
      paymentSources: [{ kind: "reserve", amount: cost }],
      ...lookups,
    });
    return { initial, declared, cost };
  }

  it("宣言後に有償効果セットが通常枠を埋めたら、応答結果を残して宣言の支払いだけを戻す", () => {
    const { declared } = declareBeforeResponse();
    const reply = createCardInstance(definitions.get("BSES01-R02")!, {
      instanceId: "reply",
      ownerPlayerId: "alice",
      zone: "revealed",
    });
    const responseState = replaceCardInstances(declared.state, [
      ...declared.state.cardInstances,
      reply,
    ]);
    const afterResponse = useEffectSetMirageAsAction({
      state: responseState,
      actingPlayerId: "alice",
      sourceInstanceId: "reply",
      effectAuthorizedSourceZones: ["revealed"],
      replacedMirageInstanceIds: ["old-1"],
      paymentSources: [{ kind: "reserve", amount: 1 }],
      ...lookups,
    }).state;
    const result = resolveDeferredSetMirageStack({
      state: afterResponse,
      activeStack: declared.activeStack,
      getRegisteredBurstActions: undefined,
      ...lookups,
    });
    expect(result.mirageSetStates.map((entry) => entry.cardInstanceId)).toEqual(
      ["old-0", "reply"]
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "incoming")?.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((card) => card.instanceId === "old-1")?.zone
    ).toBe("hand");
    expect(result.players[0]!.reserveNormalCoreCount).toBe(9);
    expect(result.mirageSetPlayerIdsThisTurn).toEqual([]);
    expect(
      result.log.some(
        (line) =>
          line.startsWith("set_mirage:rollback:") &&
          line.endsWith("post-stack-declaration-illegal")
      )
    ).toBe(true);
  });

  it("宣言後に交換先が別ゾーンへ離れたら引き戻さず、空いた通常枠へのセットだけを解決する", () => {
    const { declared, cost } = declareBeforeResponse();
    const moved = moveCardZone(declared.state, "old-1", "trash");
    const afterResponse = removeMirageSetState(moved, "old-1");
    const result = resolveDeferredSetMirageStack({
      state: afterResponse,
      activeStack: declared.activeStack,
      getRegisteredBurstActions: undefined,
      ...lookups,
    });
    expect(
      result.cardInstances.find((card) => card.instanceId === "old-1")?.zone
    ).toBe("trash");
    expect(result.mirageSetStates.map((entry) => entry.cardInstanceId)).toEqual(
      ["old-0", "incoming"]
    );
    expect(result.players[0]!.reserveNormalCoreCount).toBe(10 - cost);
    expect(
      result.log.filter((line) => line.startsWith("mirage:replace:"))
    ).toEqual([]);
  });
  it("効果セットは未使用の通常行動数と手札免除を消費せず、不正交換と二重登録を拒否する", () => {
    const state = {
      ...fixture([C01, A], C01, "revealed"),
      mirageSetPlayerIdsThisTurn: [],
      mirageSetCountExemptionsUsed: [],
    };
    const options = {
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "incoming",
      effectAuthorizedSourceZones: ["revealed" as const],
      paymentSources: [{ kind: "reserve" as const, amount: 2 }],
      ...lookups,
    };
    for (const invalid of [
      ["old-0", "old-1"],
      ["source"],
      ["secret-opponent-card"],
      ["old-0", "old-0"],
    ])
      expect(() =>
        useEffectSetMirageAsAction({
          ...options,
          replacedMirageInstanceIds: invalid,
        })
      ).toThrow(/replacement selection/);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(10);
    const after = useEffectSetMirageAsAction({
      ...options,
      replacedMirageInstanceIds: [],
    }).state;
    expect(after.mirageSetPlayerIdsThisTurn).toEqual([]);
    expect(after.mirageSetCountExemptionsUsed).toEqual([]);
    expect(after.players[0]!.reserveNormalCoreCount).toBe(8);
    expect(() =>
      useEffectSetMirageAsAction({
        ...options,
        state: after,
        effectAuthorizedSourceZones: ["mirage"],
      })
    ).toThrow(/Cannot effect-set/);
    expect(
      applyFreeMirageSetBookkeeping(
        after,
        "alice",
        "incoming",
        getCardDefinitionById
      )
    ).toBe(after);
    expect(() =>
      planMirageSetReplacements({
        state,
        actingPlayerId: "alice",
        sourceInstanceIds: ["incoming", "incoming"],
        getCardDefinitionById,
      })
    ).toThrow(/Duplicate/);
  });
  for (const item of combinations)
    it(item.title, () => {
      for (const writer of ["self", "move", "deck", "paid"] as const)
        for (const replacement of item.expected) {
          const initial = fixture(
            item.existing,
            item.incoming,
            writer === "deck" ? "deck" : writer === "paid" ? "revealed" : "hand"
          );
          let result: GameState;
          let paid = 0;
          if (writer === "paid") {
            paid = getAvailableMiragePaymentSources({
              state: initial,
              actingPlayerId: "alice",
              mirageData: item.incoming.mirageData!,
              sourceInstanceId: "incoming",
              getCardDefinitionById,
            }).reduction.finalCost;
            result = useEffectSetMirageAsAction({
              state: initial,
              actingPlayerId: "alice",
              sourceInstanceId: "incoming",
              effectAuthorizedSourceZones: ["revealed"],
              paymentSources: [{ kind: "reserve", amount: paid }],
              replacedMirageInstanceIds: replacement,
              ...lookups,
            }).state;
          } else {
            const effect: Effect = {
              timing: { kind: "continuous" },
              steps: [
                {
                  action: { kind: "count_increase", player: "self", amount: 1 },
                },
                {
                  id: "set",
                  action:
                    writer === "self"
                      ? { kind: "set_self_as_mirage" }
                      : writer === "move"
                        ? {
                            kind: "move_card",
                            from: { zone: "hand", player: "self" },
                            to: { zone: "mirage" },
                            count: 1,
                          }
                        : {
                            kind: "deck_reveal",
                            revealCount: 1,
                            picks: [
                              {
                                count: 1,
                                filter: { hasMechanic: ["mirage"] },
                                destination: "mirage_set",
                              },
                            ],
                            remainder: "bottom",
                          },
                },
                {
                  action: { kind: "count_increase", player: "self", amount: 1 },
                },
              ],
              textRef: [],
            };
            result = executeEffect({
              state: initial,
              effect,
              sourceInstanceId: writer === "self" ? "incoming" : "source",
              actingPlayerId: "alice",
              chainId: `effect-mirage:${writer}`,
              promptUnresolvedChoice: true,
              ...lookups,
            });
            if (writer === "deck") {
              const pick = legal(result).find(
                (action) => action.kind === "resolve_pending_deck_reveal_pick"
              );
              expect(pick).toBeDefined();
              result = applyLegalAction({
                state: result,
                action: pick!,
                selectedDeckRevealCardIds: ["incoming"],
                ...lookups,
              }).state;
            }
            if (item.expected.length > 1) {
              const choices = legal(result).filter(
                (action) => action.kind === "resolve_pending_step_choice"
              );
              expect(choices).toHaveLength(item.expected.length);
              expect(
                new Set(choices.map((action) => action.actionId)).size
              ).toBe(item.expected.length);
              expect(
                result.cardInstances.find(
                  (card) => card.instanceId === "incoming"
                )?.zone
              ).not.toBe("mirage");
              expect(result.players[0]!.countValue).toBe(1);
              result = choose(result, replacement);
            }
            expect(result.players[0]!.countValue).toBe(2);
          }
          assertResult(result, initial, replacement, paid);
        }
    });

  it("BSGE01-M04の実バーストは化け化けを数えず、全合法候補から1枚だけ交換して公開処理を完了する", () => {
    const hibari = definitions.get("BSGE01-M04")!;
    for (const multiple of [false, true])
      for (const replacement of multiple
        ? [[], ["old-0"], ["old-1"]]
        : [["old-1"]]) {
        const original = fixture(multiple ? [C01, C01] : [C01, A], A, "deck");
        const initial = replaceCardInstances(original, [
          ...original.cardInstances.filter(
            (card) => card.instanceId !== "source"
          ),
          createCardInstance(hibari, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone: "burst",
          }),
          createCardInstance(definitions.get("BSTH002-R03")!, {
            instanceId: "enemy",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ]);
        let state = executeEffect({
          state: initial,
          effect: hibari.effects![2]!,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: "real-hibari",
          targetInstanceIds: ["enemy"],
          ...lookups,
        });
        expect(
          state.cardInstances.find((card) => card.instanceId === "enemy")
            ?.exhaustState
        ).toBe("heavily_exhausted");
        for (
          let i = 0;
          i < 8 && (state.pendingDeckReveal || state.pendingStepChoice);
          i++
        ) {
          if (state.pendingStepChoice) {
            state = choose(state, replacement);
            continue;
          }
          const actions = legal(state);
          const pick = actions.find(
            (action) => action.kind === "resolve_pending_deck_reveal_pick"
          );
          if (pick?.kind === "resolve_pending_deck_reveal_pick") {
            state = applyLegalAction({
              state,
              action: pick,
              selectedDeckRevealCardIds: pick.candidateCardInstanceIds.includes(
                "incoming"
              )
                ? ["incoming"]
                : [],
              ...lookups,
            }).state;
            continue;
          }
          const order = actions.find(
            (action) => action.kind === "resolve_pending_deck_reveal_order"
          );
          expect(order).toBeDefined();
          if (order?.kind === "resolve_pending_deck_reveal_order")
            state = applyLegalAction({
              state,
              action: order,
              deckRevealRemainderOrder: order.remainingCardInstanceIds,
              ...lookups,
            }).state;
        }
        assertResult(state, initial, replacement, 0);
      }
  });

  it("BSES01-R02の公開時有償セットは個別交換を選ぶ前に支払わず、選択後の1コアだけで完了する", () => {
    const r02 = definitions.get("BSES01-R02")!;
    for (const multiple of [false, true])
      for (const replacement of multiple
        ? [[], ["old-0"], ["old-1"]]
        : [["old-1"]]) {
        const initial = fixture(multiple ? [C01, C01] : [C01, A], r02, "deck");
        let state = executeEffect({
          state: initial,
          effect: {
            timing: { kind: "continuous" },
            textRef: [],
            steps: [
              {
                action: {
                  kind: "deck_reveal",
                  revealCount: 1,
                  picks: [],
                  remainder: "bottom",
                },
              },
            ],
          },
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: "real-r02-reveal",
          ...lookups,
        });
        expect(state.pendingDeckReveal?.phase).toBe("revealed_choice");
        const pick = legal(state).find(
          (action) => action.kind === "resolve_pending_deck_reveal_pick"
        );
        expect(pick).toBeDefined();
        state = applyLegalAction({
          state,
          action: pick!,
          selectedDeckRevealCardIds: ["incoming"],
          deckRevealMiragePaymentSourcesByInstanceId: {
            incoming: [{ kind: "reserve", amount: 1 }],
          },
          ...lookups,
        }).state;
        if (multiple) {
          expect(state.players[0]!.reserveNormalCoreCount).toBe(10);
          expect(
            state.cardInstances.find((card) => card.instanceId === "incoming")
              ?.zone
          ).toBe("revealed");
          state = choose(state, replacement);
        }
        assertResult(state, initial, replacement, 1);
        expect(
          state.log.filter((line) => line.startsWith("mirage:cost-paid:"))
        ).toHaveLength(1);
      }
  });
});
