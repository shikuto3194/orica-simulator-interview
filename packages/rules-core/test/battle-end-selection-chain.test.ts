import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type Effect,
  type GameState,
  type LegalAction,
} from "../src";
import { queueBattleEndTriggers } from "../src/effect/trigger-system";

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

// 02d: 前段→派生→「この効果発揮後」の後段。「その後」は本文を先に続ける。
// 選択再開と最終化で原因を変えると、同じ減少が2回登録される。
describe("バトル終了時の数選択と効果発揮後", () => {
  for (const owner of ["alice", "bob"]) {
    for (const selection of ["count", "burst"] as const) {
      for (const afterTriggers of [true, false]) {
        for (const chosen of [0, 1]) {
          for (const decline of [false, true]) {
            it(`${owner}: ${selection}=${chosen}, after_triggers=${afterTriggers}, 派生辞退=${decline}`, () => {
              const opponent = owner === "alice" ? "bob" : "alice";
              const source = spirit("TEST-SELECTION-SOURCE", [
                {
                  timing: { kind: "card_event", event: "battle_end" },
                  steps: [
                    ...(selection === "burst"
                      ? [
                          {
                            action: {
                              kind: "discard_set_burst" as const,
                              player: "opponent" as const,
                              count: { min: 0, max: 1 },
                            },
                          },
                        ]
                      : []),
                    {
                      action: {
                        kind: "count_decrease",
                        player: "self",
                        amount: selection === "count" ? { min: 0, max: 1 } : 1,
                      },
                    },
                    {
                      ...(afterTriggers
                        ? { connector: "after_triggers" as const }
                        : {}),
                      action: { kind: "draw", count: 1 },
                    },
                  ],
                },
              ]);
              const watcher = spirit("TEST-SELECTION-WATCHER", [
                {
                  timing: {
                    kind: "game_event",
                    event: "count_decrease",
                    player: "self",
                  },
                  executionMode: "optional",
                  steps: [
                    { action: { kind: "draw", count: 1 } },
                    {
                      connector: "after_triggers",
                      action: {
                        kind: "count_increase",
                        player: "self",
                        amount: 3,
                      },
                    },
                  ],
                },
              ]);
              const filler = spirit("TEST-SELECTION-FILLER");
              const definitions = [source, watcher, filler];
              const lookups = {
                getCardDefinitionById: (id: string) =>
                  definitions.find((d) => d.cardNo === id),
                getRegisteredTriggeredEffectActions:
                  buildTriggeredEffectLookup(definitions),
                getRegisteredBurstActions: () => [],
                getRegisteredFieldCardEffectActions: () => [],
              };
              const attackId = "selection:attack:1";
              const battleEffect: GameState["activeContinuousEffects"][number] =
                {
                  effectId: "selection-battle-effect",
                  sourceInstanceId: "source",
                  sourceDefinitionId: source.cardNo,
                  actingPlayerId: owner,
                  duration: { scope: "battle" },
                  createdAtTurn: 3,
                  createdAtAttackId: attackId,
                  modifierTag: "effect_immunity",
                  targetInstanceId: "source",
                };
              let state: GameState = {
                ...createEmptyGameState({
                  playerIds: ["alice", "bob"],
                  playerOverrides: ["alice", "bob"].map((id) => ({
                    countValue: id === owner ? 3 : 0,
                  })),
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
                      instanceId: "burst",
                      ownerPlayerId: opponent,
                      zone: "burst",
                    }),
                    ...Array.from({ length: 4 }, (_, i) =>
                      createCardInstance(filler, {
                        instanceId: `deck-${i}`,
                        ownerPlayerId: owner,
                        zone: "deck",
                      })
                    ),
                  ],
                  setBurstStates: [
                    { playerId: opponent, cardInstanceId: "burst" },
                  ],
                }),
                activePlayerId: owner,
                turnNumber: 3,
                step: "attack",
                window: "battle_resolution",
                pendingBattleEndFinalizeAttackIds: [attackId],
                activeContinuousEffects: [battleEffect],
              };
              const actions = () =>
                [owner, opponent]
                  .flatMap((actingPlayerId) =>
                    getLegalActions({ state, actingPlayerId, ...lookups })
                  )
                  .filter((a) => a.can);
              const act = (
                kind: LegalAction["kind"],
                extra: Partial<ApplyLegalActionOptions> = {}
              ) => {
                const action = actions().find((a) => a.kind === kind);
                expect(action, JSON.stringify(actions())).toBeDefined();
                state = applyLegalAction({
                  ...extra,
                  state,
                  action: action!,
                  ...lookups,
                }).state;
              };
              const hand = () =>
                state.cardInstances.filter(
                  (c) => c.ownerPlayerId === owner && c.zone === "hand"
                ).length;
              const count = () =>
                state.players.find((p) => p.id === owner)!.countValue;

              state = queueBattleEndTriggers({
                state,
                participantInstanceIds: ["source"],
                attackId,
                ...lookups,
              });
              act("resolve_pending_triggered_effect");
              act("pass_stack");
              expect(
                state.pendingCountSelection !== null ||
                  state.pendingDiscardSetBurstCountSelection !== null
              ).toBe(true);
              expect(state.activeContinuousEffects).toContainEqual(
                battleEffect
              );
              expect(hand()).toBe(0);
              expect(count()).toBe(3);

              state = JSON.parse(JSON.stringify(state)) as GameState;
              if (selection === "count")
                act("resolve_pending_count_decrease", {
                  countDecreaseSelection: chosen,
                });
              else
                act("resolve_pending_discard_set_burst_count", {
                  discardSetBurstCountSelection: chosen,
                });
              const decreases = selection === "burst" || chosen === 1;
              expect(
                state.pendingTriggeredEffects.filter(
                  (p) => p.eventKind === "count_decrease"
                )
              ).toHaveLength(decreases ? 1 : 0);
              expect(count()).toBe(decreases ? 2 : 3);
              expect(hand()).toBe(afterTriggers && decreases ? 0 : 1);
              if (selection === "burst")
                expect(
                  state.cardInstances.find((c) => c.instanceId === "burst")
                    ?.zone
                ).toBe(chosen === 1 ? "trash" : "burst");
              if (decreases) {
                expect(state.activeContinuousEffects).toContainEqual(
                  battleEffect
                );
                expect(state.pendingBattleEndFinalizeAttackIds).toContain(
                  attackId
                );
                act("resolve_pending_triggered_effect", {
                  skipOptionalEffect: decline,
                });
              }
              for (
                let guard = 0;
                guard < 8 && state.stackWindow !== null;
                guard++
              )
                act("pass_stack");
              expect(state.stackWindow).toBeNull();
              expect(state.pendingCountSelection).toBeNull();
              expect(state.pendingDiscardSetBurstCountSelection).toBeNull();
              expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
              expect(state.pendingTriggeredEffects).toHaveLength(0);
              expect(state.pendingBattleEndFinalizeAttackIds).not.toContain(
                attackId
              );
              expect(
                state.activeContinuousEffects.some(
                  (e) => e.effectId === battleEffect.effectId
                )
              ).toBe(false);
              expect(count()).toBe(
                (decreases ? 2 : 3) + (decreases && !decline ? 3 : 0)
              );
              expect(hand()).toBe(decreases && !decline ? 2 : 1);
            });
          }
        }
      }
    }
  }
});
