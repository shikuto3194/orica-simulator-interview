import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  getEffectiveSymbols,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";
import { recomputeAndRebuildBattleStateContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import { buildBslh01X03SymbolScenario } from "../../../apps/playground-web/src/scenario-bslh01-x03-symbol";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};
const actions = (state: GameState, player = "alice") =>
  getLegalActions({ state, actingPlayerId: player, ...lookups });
function act(
  state: GameState,
  kind: LegalAction["kind"],
  player = "alice",
  predicate: (a: LegalAction) => boolean = () => true
) {
  const action = actions(state, player).find(
    (a) => a.kind === kind && predicate(a)
  );
  expect(
    action,
    `${kind}: ${actions(state, player).map((a) => a.kind)}`
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}
function declare(state: GameState) {
  state = act(state, "attack");
  expect(symbols(state)).toEqual(["black"]);
  while (state.preDeclarationStackWindow)
    state = act(
      state,
      "pass_pre_declaration_stack",
      state.preDeclarationStackWindow.priorityPlayerId
    );
  return state;
}
function symbols(state: GameState) {
  const card = state.cardInstances.find((c) => c.instanceId === "lloyd")!;
  return getEffectiveSymbols(
    state,
    card,
    getCardDefinitionById(card.definitionId),
    getCardDefinitionById
  );
}
function expectBattleSymbols(state: GameState, count: number) {
  const entity = state.battleEntities.find((e) =>
    e.memberInstanceIds.includes("lloyd")
  );
  expect(entity).toBeDefined();
  expect(entity?.resolvedSymbols).toEqual(Array(count).fill("black"));
  expect(entity?.resolvedSymbolCount ?? entity?.resolvedSymbols.length).toBe(
    count
  );
  expect(symbols(state)).toHaveLength(count);
}
function recover(state: GameState, choice: "execute" | "decline" = "execute") {
  const action = actions(state, "alice").find(
    (candidate) =>
      candidate.kind === "resolve_battle_immediate_effect" &&
      !candidate.skipOnly
  );
  expect(action).toBeDefined();
  expect(action?.executionMode).toBe("optional");
  state = applyLegalAction({
    state,
    action: action!,
    ...(choice === "decline" ? { skipOptionalEffect: true } : {}),
    ...lookups,
  }).state;
  if (choice === "decline") return state;
  for (let i = 0; i < 10 && !state.pendingStepOptionalChoice; i++) {
    const pass = ["alice", "bob"]
      .flatMap((p) => actions(state, p))
      .find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    if (!pass) break;
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
  }
  expect(state.pendingStepOptionalChoice).toBeNull();
  return state;
}
function finishBattle(state: GameState) {
  for (
    let i = 0;
    (state.activeAttack || state.pendingBurstChecks.length > 0) && i < 20;
    i++
  ) {
    const next = ["alice", "bob"]
      .flatMap((p) => actions(state, p))
      .find((a) =>
        [
          "open_battle_flash",
          "pass_battle_flash",
          "decline_block",
          "resolve_pending_burst_check",
          "decline_pending_burst_check",
        ].includes(a.kind)
      );
    expect(
      next,
      JSON.stringify([actions(state), actions(state, "bob")])
    ).toBeDefined();
    state = applyLegalAction({ state, action: next!, ...lookups }).state;
  }
  expect(state.activeAttack).toBeNull();
  return state;
}

describe("BSLH01-X03 アタック/ブロック中の黒シンボル", () => {
  it("[board] 任意回復を辞退しても黒シンボルは2つ、使用回数は消費しない", () => {
    const state = recover(
      declare(buildBslh01X03SymbolScenario(ALL_CARDS)),
      "decline"
    );
    expect(symbols(state)).toEqual(["black", "black"]);
    expect(
      state.cardInstances.find((c) => c.instanceId === "lloyd")?.exhaustState
    ).toBe("exhausted");
    expect(
      state.effectUsageRecords.filter((record) => record.duration === "step")
    ).toHaveLength(0);
  });

  it("[board] 2回のブロックとも宣言直後に黒2、終了後は黒1、回復は1回", () => {
    let state = buildBslh01X03SymbolScenario(
      ALL_CARDS,
      new URLSearchParams({ role: "block" })
    );
    for (const round of [1, 2]) {
      state = act(state, "attack", "bob");
      for (
        let i = 0;
        !actions(state).some((a) => a.kind === "block") && i < 10;
        i++
      ) {
        const pass = ["alice", "bob"]
          .flatMap((p) => actions(state, p))
          .find((a) =>
            [
              "pass_pre_declaration_stack",
              "open_battle_flash",
              "pass_battle_flash",
            ].includes(a.kind)
          );
        expect(pass).toBeDefined();
        state = applyLegalAction({ state, action: pass!, ...lookups }).state;
      }
      expect(symbols(state)).toEqual(["black"]);
      state = act(state, "block");
      for (
        let i = 0;
        !state.battleEntities.some(
          (e) =>
            e.memberInstanceIds.includes("lloyd") &&
            e.attackState === "blocking"
        ) && i < 10;
        i++
      ) {
        const pass = ["alice", "bob"]
          .flatMap((p) => actions(state, p))
          .find((a) =>
            [
              "pass_pre_declaration_stack",
              "pass_stack",
              "pass_battle_flash",
            ].includes(a.kind)
          );
        expect(
          pass,
          JSON.stringify([
            state.preDeclarationStackWindow,
            state.activeAttack,
            actions(state),
            actions(state, "bob"),
          ])
        ).toBeDefined();
        state = applyLegalAction({ state, action: pass!, ...lookups }).state;
      }
      expect(symbols(state)).toEqual(["black", "black"]);
      expectBattleSymbols(state, 2);
      if (round === 1) state = recover(state);
      else expect(state.battleImmediateEffects).toHaveLength(0);
      expect(
        state.cardInstances.find((c) => c.instanceId === "lloyd")?.exhaustState
      ).toBe(round === 1 ? "recovered" : "exhausted");
      expectBattleSymbols(state, 2);
      state = finishBattle(state);
      expectBattleSymbols(state, 1);
      expect(
        state.players.find((p) => p.id === "alice")?.lifeNormalCoreCount
      ).toBe(10);
    }
  });
  it("[board] 宣言成立直後に2つ、回復後も2つ、バトル後1つ、2回目も2つで回復は1回", () => {
    let state = buildBslh01X03SymbolScenario(ALL_CARDS);
    expect(symbols(state)).toEqual(["black"]);
    state = declare(state);
    expect(symbols(state)).toEqual(["black", "black"]);
    expectBattleSymbols(state, 2);
    state = recover(state);
    expect(
      state.cardInstances.find((c) => c.instanceId === "lloyd")?.exhaustState
    ).toBe("recovered");
    expect(symbols(state)).toHaveLength(2);
    state = finishBattle(state);
    expectBattleSymbols(state, 1);
    expect(state.players.find((p) => p.id === "bob")?.lifeNormalCoreCount).toBe(
      8
    );
    expect(symbols(state)).toEqual(["black"]);
    state = declare(state);
    expect(symbols(state)).toEqual(["black", "black"]);
    expectBattleSymbols(state, 2);
    // 同一ステップの2回目は、解決時 skip ではなく宣言前に除外される。
    expect(state.battleImmediateEffects).toHaveLength(0);
    expect(
      actions(state, "alice").some(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" && !action.skipOnly
      )
    ).toBe(false);
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "lloyd")?.exhaustState
    ).toBe("exhausted");
    expect(symbols(state)).toHaveLength(2);
    state = finishBattle(state);
    expectBattleSymbols(state, 1);
    expect(state.players.find((p) => p.id === "bob")?.lifeNormalCoreCount).toBe(
      6
    );
  });

  it.each(["attacking", "blocking"] as const)(
    "[board] %s中の再評価で累積せず、参加をやめると消える",
    (attackState) => {
      let state = buildBslh01X03SymbolScenario(ALL_CARDS);
      state = {
        ...state,
        battleEntities: [
          {
            entityId: "lloyd-entity",
            memberInstanceIds: ["lloyd"],
            resolvedBp: 7000,
            resolvedSymbols: ["black"],
            attackState,
          },
        ],
      };
      for (let i = 0; i < 3; i++) {
        state = recomputeAndRebuildBattleStateContinuousEffects(
          state,
          getCardDefinitionById
        );
        expectBattleSymbols(state, 2);
      }
      state = recomputeAndRebuildBattleStateContinuousEffects(
        {
          ...state,
          battleEntities: state.battleEntities.map((e) => ({
            ...e,
            attackState: "idle",
          })),
        },
        getCardDefinitionById
      );
      expect(symbols(state)).toEqual(["black"]);
      expectBattleSymbols(state, 1);
    }
  );
});
