import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const vegeta = definitions.get("BSDB01-C02")!;
const lookups = {
  getRegisteredFieldCardEffectActions: () => [],
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};

function setup(countValue = 0, deckCount = 6): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        ...["vegeta", "other-vegeta"].map((instanceId) =>
          createCardInstance(vegeta, {
            instanceId,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          })
        ),
        ...Array.from({ length: deckCount + 2 }, (_, index) =>
          createCardInstance(vegeta, {
            instanceId: `filler-${index}`,
            ownerPlayerId: "alice",
            zone: index < 2 ? "hand" : "deck",
          })
        ),
      ],
      playerOverrides: [{ countValue, deckCount, handCount: 2 }, {}],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "none",
    turnNumber: 3,
  };
}

function apply(
  state: GameState,
  match: (action: LegalAction) => boolean,
  actingPlayerId = state.preDeclarationStackWindow?.priorityPlayerId ??
    state.stackWindow?.priorityPlayerId ??
    "alice"
): GameState {
  const actions = getLegalActions({ state, actingPlayerId, ...lookups });
  const action = actions.find(match);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}

function closeStack(state: GameState): GameState {
  let current = state;
  for (
    let guard = 0;
    (current.stackWindow || current.preDeclarationStackWindow) && guard < 8;
    guard++
  )
    current = apply(
      current,
      (action) =>
        action.kind === "pass_stack" ||
        action.kind === "pass_pre_declaration_stack"
    );
  expect(current.stackWindow).toBeNull();
  return current;
}

function run(state: GameState, sourceInstanceId = "vegeta"): GameState {
  return executeEffect({
    chainId: "test:bsdb01-c02-single-trigger:86",
    state,
    sourceInstanceId,
    effect: vegeta.effects[0]!,
    effectIndex: 0,
    actingPlayerId: "alice",
    ...lookups,
  });
}

function choose(state: GameState, choice: "execute" | "decline"): GameState {
  let current = apply(
    state,
    (action) =>
      action.kind === "resolve_pending_step_optional_choice" &&
      action.choice === choice
  );
  if (current.pendingZoneSelection) {
    const action = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_zone_selection")!;
    current = applyLegalAction({
      state: current,
      action,
      selectedZoneCardIds: [
        current.cardInstances.find(
          (card) => card.zone === "hand" && card.ownerPlayerId === "alice"
        )!.instanceId,
      ],
      ...lookups,
    }).state;
  }
  return current;
}

describe("BSDB01-C02 煌臨/アタック時は本文1つにつき1回の発揮", () => {
  it.each([0, 3])(
    "カウント%s: アタック1回でカウントとドローを別誘発にしない（OCは別効果）",
    (count) => {
      const attacked = closeStack(
        apply(
          setup(count),
          (action) =>
            action.kind === "attack" && action.sourceInstanceId === "vegeta"
        )
      );
      expect(attacked.attackDeclarationLog).toHaveLength(1);
      expect(attacked.battleImmediateEffects).toHaveLength(count >= 2 ? 2 : 1);
      const resolving = closeStack(
        apply(
          attacked,
          (action) =>
            action.kind === "resolve_battle_immediate_effect" &&
            action.sourceInstanceId === "vegeta" &&
            action.promptId.endsWith(":0")
        )
      );
      expect(resolving.players[0]).toMatchObject({
        countValue: count + 1,
        deckCount: 6,
        handCount: 2,
      });
      expect(resolving.pendingStepOptionalChoice).toMatchObject({
        sourceInstanceId: "vegeta",
        stepIndex: 1,
      });
    }
  );

  it("2ドロー後に1破棄し、同ターンの再発揮はカウントだけ増やす", () => {
    const after = choose(run(setup()), "execute");
    expect(after.players[0]).toMatchObject({
      countValue: 1,
      deckCount: 4,
      handCount: 3,
    });
    const again = run(after);
    expect(again.players[0]).toMatchObject({
      countValue: 2,
      deckCount: 4,
      handCount: 3,
    });
    expect(again.pendingStepOptionalChoice).toBeNull();
    const nextTurn = choose(run({ ...again, turnNumber: 5 }), "execute");
    expect(nextTurn.players[0]).toMatchObject({
      countValue: 3,
      deckCount: 2,
      handCount: 4,
    });
  });

  it("カウント1→2のOC達成は、カウント増加効果から派生して1回だけ誘発する", () => {
    const attacked = closeStack(
      apply(
        setup(1),
        (action) =>
          action.kind === "attack" && action.sourceInstanceId === "vegeta"
      )
    );
    expect(attacked.battleImmediateEffects).toHaveLength(1);
    const originalGroup =
      attacked.battleImmediateEffects[0]!.simultaneousGroupId;
    const resolving = closeStack(
      apply(
        attacked,
        (action) => action.kind === "resolve_battle_immediate_effect"
      )
    );
    expect(resolving.players[0]!.countValue).toBe(2);
    const after = choose(resolving, "decline");
    expect(after.battleImmediateEffects).toHaveLength(1);
    const oc = after.battleImmediateEffects[0]!;
    expect(oc.registrationIndex).toBe(1);
    expect(oc.causedByChainId).toContain("battle-immediate:");
    expect(oc.simultaneousGroupId).not.toBe(originalGroup);
    const finished = closeStack(
      apply(
        after,
        (action) =>
          action.kind === "resolve_battle_immediate_effect" && !action.skipOnly
      )
    );
    expect(finished.players[0]!.countValue).toBe(3);
    expect(finished.battleImmediateEffects).toEqual([]);
    expect(finished.attackDeclarationLog).toHaveLength(1);
  });

  it("ドロー辞退時は破棄せず回数も消費せず、次の発揮でドローできる", () => {
    const declined = choose(run(setup()), "decline");
    expect(declined.players[0]).toMatchObject({
      countValue: 1,
      deckCount: 6,
      handCount: 2,
    });
    expect(declined.effectUsageRecords).toEqual([]);
    const after = choose(run(declined), "execute");
    expect(after.players[0]).toMatchObject({
      countValue: 2,
      deckCount: 4,
      handCount: 3,
    });
  });

  it("同名の別個体は各1回ドローできる", () => {
    const first = choose(run(setup()), "execute");
    const second = choose(run(first, "other-vegeta"), "execute");
    expect(second.players[0]).toMatchObject({
      countValue: 2,
      deckCount: 2,
      handCount: 4,
    });
  });

  it("デッキ0枚でドローできなくてもカウントは増え、手札を破棄しない", () => {
    const after = run(setup(0, 0));
    const finished = after.pendingStepOptionalChoice
      ? choose(after, "decline")
      : after;
    expect(finished.players[0]).toMatchObject({
      countValue: 1,
      deckCount: 0,
      handCount: 2,
    });
  });
});
