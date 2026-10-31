import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";

const nexus = ALL_CARDS.find((card) => card.cardNo === "BSTH01-R21")!;
function vanilla(
  id: string,
  bp: number,
  category: "spirit" | "ultimate" = "spirit"
): CardDefinition {
  return {
    cardNo: id,
    name: id,
    printedCategory: category,
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: ["red"],
    levelDefs: [
      { level: category === "ultimate" ? 3 : 1, requiredCores: 1, bp },
    ],
    effects: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}
function fixture(
  owner: string,
  allyBp: number,
  enemyBp: number,
  category: "spirit" | "ultimate" = "spirit"
) {
  const other = owner === "alice" ? "bob" : "alice";
  const ally = vanilla("TEST-R21-ALLY", allyBp, category);
  const enemy = vanilla("TEST-R21-ENEMY", enemyBp);
  const definitions = [nexus, ally, enemy];
  const lookups = {
    getCardDefinitionById: (id: string) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
  };
  const baseState: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(nexus, {
          instanceId: "source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(ally, {
          instanceId: "ally",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemy, {
          instanceId: "enemy",
          ownerPlayerId: other,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
      ],
    }),
    step: "attack",
    window: "flash_before_block",
    activePlayerId: other,
    turnNumber: 4,
    battleEntities: [
      {
        entityId: "entity",
        memberInstanceIds: ["enemy"],
        resolvedBp: enemyBp,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
  };
  const state: GameState = {
    ...baseState,
    activeAttack: {
      ...createActiveAttack(baseState, "entity", other),
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: owner,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: owner,
        pendingStackAction: null,
      },
    },
  };
  return { state, owner, other, lookups };
}
function fieldAction(board: ReturnType<typeof fixture>) {
  return getLegalActions({
    state: board.state,
    actingPlayerId: board.owner,
    ...board.lookups,
  }).find(
    (action) =>
      action.kind === "use_field_card_effect" &&
      action.sourceInstanceId === "source"
  );
}
function settle(state: GameState, board: ReturnType<typeof fixture>) {
  for (let count = 0; count < 20; count++) {
    if (
      !state.stackWindow &&
      !state.activeAttack?.flashWindowState?.pendingStackAction &&
      !state.pendingStackCascade
    )
      return state;
    const action = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...board.lookups })
      )
      .find((candidate) =>
        [
          "pass_stack",
          "pass_pre_declaration_stack",
          "pass_battle_flash",
        ].includes(candidate.kind)
      );
    expect(action, "actual response must be legal").toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...board.lookups,
    }).state;
  }
  throw new Error("R21 field-effect response did not finish");
}

function finishBattle(
  state: GameState,
  board: ReturnType<typeof fixture>,
  lifeDamage: number
) {
  const lifeBefore = board.state.players.find(
    (player) => player.id === board.owner
  )!.lifeNormalCoreCount;
  for (let count = 0; count < 8 && state.activeAttack; count++) {
    const action = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...board.lookups })
      )
      .find((candidate) =>
        ["pass_battle_flash", "decline_block"].includes(candidate.kind)
      );
    expect(
      action,
      "battle continuation must offer a legal input"
    ).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...board.lookups,
    }).state;
  }
  expect(state.activeAttack, "the battle must finish").toBeNull();
  expect(
    state.players.find((player) => player.id === board.owner)!
      .lifeNormalCoreCount
  ).toBe(lifeBefore - lifeDamage);
  expect(state.pendingLeaveEntities).toHaveLength(0);
  expect(state.pendingEffectTargetSelection).toBeNull();
  return state;
}

// Official Eternal BS01 Q24495: no self/opponent qualifier permits own spirits.
// R21 prints a spirit/ultimate target without either owner qualifier.
describe("BSTH01-R21 unqualified conditional-cost destruction", () => {
  for (const owner of ["alice", "bob"]) {
    describe(owner, () => {
      for (const [title, allyBp, enemyBp, category, selected, candidates] of [
        ["friendly spirit only", 3000, 20000, "spirit", "ally", ["ally"]],
        ["friendly ultimate only", 1000, 20000, "ultimate", "ally", ["ally"]],
        ["opponent only", 20000, 3000, "spirit", "enemy", ["enemy"]],
        [
          "mixed choose friendly",
          3000,
          3000,
          "spirit",
          "ally",
          ["ally", "enemy"],
        ],
        [
          "mixed choose opponent",
          3000,
          3000,
          "spirit",
          "enemy",
          ["ally", "enemy"],
        ],
      ] as const) {
        it(`${title}: real field flash selects exactly one target and pays once`, () => {
          const board = fixture(owner, allyBp, enemyBp, category);
          const action = fieldAction(board);
          expect(action).toBeDefined();
          expect(new Set(action!.candidateTargetInstanceIds)).toEqual(
            new Set(candidates)
          );
          const after = settle(
            applyLegalAction({
              state: board.state,
              action: action!,
              targetInstanceIds: [selected],
              ...board.lookups,
            }).state,
            board
          );
          expect(
            after.cardInstances.find((card) => card.instanceId === "source")
              ?.exhaustState
          ).toBe("exhausted");
          expect(
            after.cardInstances.find((card) => card.instanceId === selected)
              ?.zone
          ).toBe("trash");
          expect(
            after.cardInstances.find(
              (card) =>
                card.instanceId === (selected === "ally" ? "enemy" : "ally")
            )?.zone
          ).toBe("field");
          expect(after.pendingLeaveEntities).toHaveLength(0);
          expect(after.pendingTriggeredEffects).toHaveLength(0);
          expect(after.pendingEffectTargetSelection).toBeNull();
          // A destroyed attacker deals no damage; a surviving one has one symbol.
          finishBattle(after, board, selected === "ally" ? 1 : 0);
        });
      }
      it("declining the real flash opportunity leaves the cost, targets and usage untouched", () => {
        const board = fixture(owner, 3000, 20000);
        expect(fieldAction(board)).toBeDefined();
        const pass = getLegalActions({
          state: board.state,
          actingPlayerId: owner,
          ...board.lookups,
        }).find((action) => action.kind === "pass_battle_flash");
        expect(pass).toBeDefined();
        const after = applyLegalAction({
          state: board.state,
          action: pass!,
          ...board.lookups,
        }).state;
        expect(after.cardInstances).toEqual(board.state.cardInstances);
        expect(after.effectUsageRecords).toEqual(
          board.state.effectUsageRecords
        );
        finishBattle(after, board, 1);
      });
      it("no legal result prevents declaration and a forced body refunds exhaustion", () => {
        const board = fixture(owner, 20000, 20000);
        expect(fieldAction(board)).toBeUndefined();
        const after = flushPendingLeaves(
          executeEffect({
            state: board.state,
            effect: nexus.effects![0]!,
            effectIndex: 0,
            chainId: "r21-impossible",
            sourceInstanceId: "source",
            actingPlayerId: owner,
            ...board.lookups,
          }),
          board.lookups.getCardDefinitionById
        );
        expect(after.cardInstances).toEqual(board.state.cardInstances);
        expect(
          after.cardInstances.find((card) => card.instanceId === "source")
            ?.exhaustState
        ).toBe("recovered");
        expect(after.pendingLeaveEntities).toHaveLength(0);
        finishBattle(after, board, 1);
      });
    });
  }
});
