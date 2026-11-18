import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  getLegalActions,
  createEmptyGameState,
  createCardInstance,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type LegalAction,
} from "../src";

describe("攻撃時の配置中止は解決済みpromptを復活させない", () => {
  for (const owner of ["alice", "bob"])
    for (const saved of [false, true])
      it.each(["core", "multi", "condition"] as const)(
        `${owner} JSON=${saved} %s: ドローは1回、未解決の別効果は残る`,
        (kind) => {
          const source: CardDefinition = {
            cardNo: "ROLLBACK-ATTACK",
            name: "ROLLBACK-ATTACK",
            printedCategory: "spirit",
            colors: ["red"],
            cost: 1,
            reductionSymbols: [],
            levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
            symbolColors: ["red"],
            keywordTags: [],
            textLines: [],
            sourceUrls: [],
            sourceConfidence: "C",
            effects: [
              {
                timing: { kind: "card_event", event: "attack" },
                steps: [
                  { action: { kind: "draw", count: 1 } },
                  {
                    action:
                      kind === "multi"
                        ? {
                            kind: "summon",
                            target: {
                              kind: "from_zone",
                              zone: "hand",
                              count: 1,
                            },
                            costModifier: "free",
                          }
                        : {
                            kind: "core_distribute",
                            from: { kind: "reserve", player: "self" },
                            to: {
                              kind: "filter",
                              player: "self",
                              filter: {},
                              count: "all",
                            },
                            amount: "all",
                            mode: "player_choice",
                            minTotal: 1,
                          },
                  },
                ],
              },
              {
                timing: { kind: "card_event", event: "attack" },
                steps: [
                  {
                    action: {
                      kind: "count_increase",
                      player: "self",
                      amount: 1,
                    },
                  },
                ],
              },
            ],
          };
          const filler: CardDefinition = {
            ...source,
            cardNo: "ROLLBACK-FILLER",
            name: "ROLLBACK-FILLER",
            effects: [],
          };
          if (kind === "condition") {
            source.levelDefs.push({ level: 2, requiredCores: 2, bp: 2000 });
            const raise = {
              action: {
                kind: "core_move" as const,
                from: { kind: "void" as const, player: "self" as const },
                to: { kind: "this_card" as const },
                amount: 1,
              },
            };
            source.effects[0]!.steps.splice(1, 0, raise);
            source.effects[1]!.condition = [{ kind: "min_level", value: 2 }];
            source.effects.push(
              {
                timing: { kind: "card_event", event: "attack" },
                steps: [
                  {
                    action: {
                      kind: "core_move",
                      from: { kind: "this_card" },
                      to: { kind: "reserve", player: "self" },
                      amount: 1,
                    },
                  },
                ],
              },
              {
                timing: { kind: "card_event", event: "attack" },
                steps: [raise],
              }
            );
          }
          const defs = [source, filler];
          const lookups = {
            getCardDefinitionById: (id: string) =>
              defs.find((d) => d.cardNo === id),
            getRegisteredTriggeredEffectActions:
              buildTriggeredEffectLookup(defs),
            getRegisteredBattleImmediateEffectActions:
              buildBattleImmediateEffectLookup(defs),
            getRegisteredBurstActions: () => [],
            getRegisteredFieldCardEffectActions: () => [],
          };
          let state = {
            ...createEmptyGameState({
              playerIds: ["alice", "bob"],
              playerOverrides: [
                { handCount: 0, deckCount: 3, reserveNormalCoreCount: 5 },
                { handCount: 0, deckCount: 3, reserveNormalCoreCount: 5 },
              ],
              cardInstances: [
                createCardInstance(source, {
                  instanceId: "source",
                  ownerPlayerId: owner,
                  zone: "field",
                  normalCoreCount: 1,
                }),
                ...["deck1", "deck2", "deck3"].map((instanceId) =>
                  createCardInstance(filler, {
                    instanceId,
                    ownerPlayerId: owner,
                    zone: "deck",
                  })
                ),
              ],
            }),
            activePlayerId: owner,
            step: "attack" as const,
            turnNumber: 3,
          };
          const actions = () =>
            ["alice", "bob"].flatMap((actingPlayerId) =>
              getLegalActions({ state, actingPlayerId, ...lookups })
            );
          const act = (
            predicate: (a: LegalAction) => boolean,
            input: Partial<ApplyLegalActionOptions> = {}
          ) => {
            const action = actions().find(predicate);
            expect(action, JSON.stringify(actions())).toBeDefined();
            state = applyLegalAction({
              state,
              action: action!,
              ...lookups,
              ...input,
            }).state;
          };
          const resolve = (index: number) => {
            const prompt = state.battleImmediateEffects.find(
              (p) => p.registrationIndex === index
            )!;
            expect(prompt).toBeDefined();
            if (
              !actions().some(
                (a) =>
                  a.kind === "resolve_battle_immediate_effect" &&
                  a.promptId === prompt.promptId
              )
            ) {
              act(
                (a) =>
                  a.kind === "select_pending_to_resolve" &&
                  a.pendingId === prompt.promptId
              );
            }
            act(
              (a) =>
                a.kind === "resolve_battle_immediate_effect" &&
                a.promptId === prompt.promptId
            );
            while (state.stackWindow) act((a) => a.kind === "pass_stack");
          };
          act((a) => a.kind === "attack" && a.sourceInstanceId === "source");
          while (state.preDeclarationStackWindow)
            act((a) => a.kind === "pass_pre_declaration_stack");
          resolve(0);
          if (state.pendingZoneSelection)
            act((a) => a.kind === "resolve_pending_zone_selection", {
              chosenInstanceIds: ["deck1"],
            });
          const remaining = state.battleImmediateEffects;
          expect(remaining.map((p) => p.registrationIndex).sort()).toEqual(
            kind === "condition" ? [1, 2, 3] : [1]
          );
          if (saved) state = JSON.parse(JSON.stringify(state));
          act(
            (a) =>
              a.kind ===
              (kind === "multi"
                ? "abort_pending_multi_placement"
                : "abort_pending_core_distribution")
          );
          expect(state.battleImmediateEffects).toEqual(remaining);
          expect(state.players.find((p) => p.id === owner)?.handCount).toBe(1);
          resolve(1);
          if (kind === "condition") {
            resolve(2);
            resolve(3);
          }
          expect(state.players.find((p) => p.id === owner)?.countValue).toBe(1);
          expect(state.players.find((p) => p.id === owner)?.handCount).toBe(1);
          expect(state.battleImmediateEffects).toHaveLength(0);
          expect(
            actions().some((a) => a.kind === "resolve_battle_immediate_effect")
          ).toBe(false);
        }
      );
});
