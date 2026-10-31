import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildContractCountRebirthScenario } from "../../../apps/playground-web/src/scenario-contract-count-rebirth";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  getCurrentActorPlayerIds,
  type GameState,
  type LegalAction,
} from "../src";
const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredBurstActions: () => [],
};
const actions = (state: GameState, actingPlayerId: string) =>
  getLegalActions({ state, actingPlayerId, ...lookups });
const apply = (
  state: GameState,
  player: string,
  predicate: (a: LegalAction) => boolean,
  extra = {}
) => {
  const action = actions(state, player).find(predicate);
  expect(
    action,
    actions(state, player)
      .map((a) => a.kind + ("eventKind" in a ? ":" + a.eventKind : ""))
      .join(",")
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
};
describe("契約合体の同一効果によるカウント増加・転醒の応答窓", () => {
  for (const owner of ["alice", "bob"])
    for (const flash of ["before_block", "after_block"]) {
      const opponent = owner === "alice" ? "bob" : "alice";
      it(
        owner + " " + flash + ": 裏返し選択が終わるまで派生誘発は解決しない",
        () => {
          const state = buildContractCountRebirthScenario(
            ALL_CARDS,
            new URLSearchParams({ owner, flash, stage: "flip-choice" })
          );
          expect(state.pendingStepOptionalChoice).not.toBeNull();
          expect(
            actions(state, owner).every(
              (a) => a.kind === "resolve_pending_step_optional_choice"
            )
          ).toBe(true);
          expect(actions(state, opponent)).toEqual([]);
        }
      );
      for (const first of ["count_increase", "rebirth"])
        it(
          owner +
            " " +
            flash +
            ": " +
            first +
            "から自由に選び、相手の応答後に次へ進む",
          () => {
            let state = buildContractCountRebirthScenario(
              ALL_CARDS,
              new URLSearchParams({ owner, flash })
            );
            expect(
              state.pendingTriggeredEffects.map((p) => p.eventKind)
            ).toEqual(["count_increase", "rebirth"]);
            expect(
              new Set(state.pendingTriggeredEffects.map((p) => p.chainId)).size
            ).toBe(1);
            const choices = actions(state, owner).filter(
              (a) => a.kind === "select_pending_to_resolve"
            );
            expect(choices.map((a) => a.eventKind).sort()).toEqual([
              "count_increase",
              "rebirth",
            ]);
            state = apply(
              state,
              owner,
              (a) =>
                a.kind === "select_pending_to_resolve" && a.eventKind === first
            );
            expect(
              state.activeAttack?.flashWindowState.pendingStackAction
                ?.actionKind
            ).toBe("triggered_effect");
            expect(state.pendingEffectTargetSelection).toBeNull();
            expect(state.players.find((p) => p.id === owner)?.countValue).toBe(
              3
            );
            expect(state.players.find((p) => p.id === owner)?.handCount).toBe(
              0
            );
            expect(actions(state, opponent)).toContainEqual(
              expect.objectContaining({
                kind: "pass_battle_flash",
                responseTiming: "stack",
              })
            );
            expect(actions(state, owner)).toEqual([]);
            expect([...getCurrentActorPlayerIds(state)]).toEqual([opponent]);
            state = apply(
              state,
              opponent,
              (a) => a.kind === "pass_battle_flash"
            );
            if (first === "rebirth") {
              expect(state.pendingEffectTargetSelection).not.toBeNull();
              state = apply(
                state,
                owner,
                (a) => a.kind === "resolve_pending_effect_target",
                { targetInstanceIds: ["cc-target"] }
              );
              expect(
                state.cardInstances.find((c) => c.instanceId === "cc-target")
                  ?.pendingLeaveKind
              ).toBe("destroy");
              expect(
                state.players.find((p) => p.id === owner)?.countValue
              ).toBe(1);
              // 転醒時のカウント減少から派生した誘発を先に辞退し、外側へ戻る。
              state = apply(
                state,
                owner,
                (a) =>
                  a.kind === "resolve_pending_triggered_effect" &&
                  a.eventKind === "count_decrease",
                { skipOptionalEffect: true }
              );
              state = apply(
                state,
                owner,
                (a) =>
                  a.kind === "resolve_pending_triggered_effect" &&
                  a.eventKind === "count_increase",
                { skipOptionalEffect: true }
              );
            } else {
              expect(state.players.find((p) => p.id === owner)?.handCount).toBe(
                1
              );
            }
            const second = first === "rebirth" ? "count_increase" : "rebirth";
            if (first === "count_increase")
              state = apply(
                state,
                owner,
                (a) =>
                  a.kind === "resolve_pending_triggered_effect" &&
                  a.eventKind === second,
                { skipOptionalEffect: true }
              );
            expect(
              state.activeAttack?.flashWindowState.pendingStackAction
            ).toBeNull();
            expect(
              state.pendingTriggeredEffects.some(
                (p) =>
                  p.eventKind === "count_increase" || p.eventKind === "rebirth"
              )
            ).toBe(false);
          }
        );
    }
});

describe("相手ターンの契約合体による同時誘発", () => {
  for (const owner of ["alice", "bob"])
    for (const first of ["count_increase", "rebirth"]) {
      it(owner + ": 相手が" + first + "を選択してから発揮できる", () => {
        const opponent = owner === "alice" ? "bob" : "alice";
        let state = buildContractCountRebirthScenario(
          ALL_CARDS,
          new URLSearchParams({ owner, turn: "opponent" })
        );
        expect(actions(state, owner)).toEqual([]);
        state = apply(
          state,
          opponent,
          (a) => a.kind === "select_pending_to_resolve" && a.eventKind === first
        );
        const available = actions(state, owner);
        expect(available).toHaveLength(1);
        expect(available[0]).toMatchObject({
          kind: "resolve_pending_triggered_effect",
          eventKind: first,
        });
        state = apply(
          state,
          owner,
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.eventKind === first
        );
        expect(actions(state, owner)).toEqual([]);
        expect(actions(state, opponent)).toContainEqual(
          expect.objectContaining({
            kind: "pass_battle_flash",
            responseTiming: "stack",
          })
        );
        expect([...getCurrentActorPlayerIds(state)]).toEqual([opponent]);
      });
    }
});
