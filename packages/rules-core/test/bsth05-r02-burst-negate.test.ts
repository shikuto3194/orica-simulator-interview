import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildMagicLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";

const otherMagic: CardDefinition = {
  ...ALL_CARDS.find((c) => c.cardNo === "BSTH05-R02")!,
  cardNo: "BURST-NEGATE-OTHER-MAGIC",
  cost: 0,
  reductionSymbols: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const cards = [...ALL_CARDS, otherMagic];
const getCardDefinitionById = (id: string) =>
  cards.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredMagicActions: buildMagicLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
};
const harvest = getCardDefinitionById("BSTH05-R02")!;

function scenario(burstNo: string, owner = "bob"): GameState {
  const opponent = owner === "bob" ? "alice" : "bob";
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const initialized = rebuildContinuousEffectsFromField(
    {
      ...state,
      step: "attack",
      turnNumber: 3,
      activePlayerId: opponent,
      players: state.players.map((p) => ({ ...p, reserveNormalCoreCount: 10 })),
      cardInstances: [
        createCardInstance(getCardDefinitionById(burstNo)!, {
          instanceId: "burst",
          ownerPlayerId: owner,
          zone: "burst",
        }),
        createCardInstance(harvest, {
          instanceId: "harvest",
          ownerPlayerId: opponent,
          zone: "hand",
        }),
      ],
      setBurstStates: [{ playerId: owner, cardInstanceId: "burst" }],
    },
    getCardDefinitionById
  );
  return {
    ...initialized,
    pendingBurstChecks: [
      {
        checkId: "burst-check",
        actingPlayerId: owner,
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:bsth05-r02-burst-negate:70",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"]
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find(
    (a) => a.kind === kind && (a.kind !== "use_magic" || a.timing === "stack")
  );
  expect(
    action,
    `${kind}: ${JSON.stringify(getLegalActions({ state, actingPlayerId: player, ...lookups }))}`
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...lookups,
    ...(kind === "use_magic"
      ? { paymentSources: [{ kind: "reserve" as const, amount: 4 }] }
      : {}),
    ...(kind === "resolve_pending_multi_placement"
      ? {
          multiPlacementAllocations: [
            {
              destinationInstanceId: "burst",
              placements: [{ kind: "reserve_normal" as const, amount: 1 }],
            },
          ],
        }
      : {}),
  }).state;
}

function finish(state: GameState, owner: string): GameState {
  if (state.pendingMultiPlacement)
    state = act(state, owner, "resolve_pending_multi_placement");
  expect(state.pendingMultiPlacement).toBeNull();
  expect(state.pendingStackCascade).toBeNull();
  return state;
}

function matches(state: GameState, player: string) {
  return stackMatchesNegateAction({
    state,
    stack: state.stackWindow!.pendingStackAction!,
    actingPlayerId: player,
    request: {
      negateTarget: "effect",
      targetController: "opponent",
      targetEffectFilter: { timingKind: "burst" },
      sourceInstanceId: "harvest",
    },
    getCardDefinitionById,
  });
}

describe("BSTH05-R02 バースト効果1つの無効化", () => {
  for (const owner of ["alice", "bob"]) {
    const opponent = owner === "alice" ? "bob" : "alice";
    it(`${owner}: メインマジックの宣言にも空撃ちでき、ドローを止めず無効化予約も残さない`, () => {
      const base = scenario("BSTH01-M13", owner);
      let state: GameState = {
        ...base,
        step: "main",
        activePlayerId: owner,
        pendingBurstChecks: [],
        cardInstances: [
          ...base.cardInstances,
          createCardInstance(otherMagic, {
            instanceId: "other",
            ownerPlayerId: owner,
            zone: "hand",
          }),
          createCardInstance(harvest, {
            instanceId: "drawn",
            ownerPlayerId: owner,
            zone: "deck",
          }),
        ],
      };
      const mainMagic = getLegalActions({
        state,
        actingPlayerId: owner,
        ...lookups,
      }).find((a) => a.kind === "use_magic" && a.timing === "main");
      expect(mainMagic).toBeDefined();
      state = applyLegalAction({ state, action: mainMagic!, ...lookups }).state;
      expect(matches(state, opponent)).toBe(false);
      state = act(state, opponent, "use_magic");
      state = act(state, owner, "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "drawn")?.zone
      ).toBe("hand");
      expect(
        state.cardInstances.find((c) => c.instanceId === "harvest")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "other")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "burst")?.zone
      ).toBe("burst");
      expect(state.pendingStackNegateRequests).toEqual([]);
      expect(
        state.players.find((p) => p.id === opponent)?.reserveNormalCoreCount
      ).toBe(6);
    });
    it.each(["BSTH01-M13", "BSTH01-X07"])(
      `${owner}: %s 発動宣言では空撃ちし、後の発揮を無効化しない`,
      (burstNo) => {
        let state = act(
          scenario(burstNo, owner),
          owner,
          "resolve_pending_burst_check"
        );
        expect(state.stackWindow?.burstWindowKind).toBe("activation");
        expect(matches(state, opponent)).toBe(false);
        state = act(state, opponent, "use_magic");
        state = act(state, owner, "pass_stack");
        state = finish(state, owner);
        expect(
          state.cardInstances.find((c) => c.instanceId === "harvest")?.zone
        ).toBe("trash");
        expect(
          state.cardInstances.find((c) => c.instanceId === "burst")?.zone
        ).toBe("field");
        expect(state.pendingStackNegateRequests).toEqual([]);
      }
    );

    it.each([
      ["BSTH01-M13", true],
      ["BSTH01-X07", false],
    ] as const)(
      `${owner}: %s 発揮宣言でセット中耐性と発動中耐性を区別`,
      (burstNo, canNegate) => {
        let state = act(
          scenario(burstNo, owner),
          owner,
          "resolve_pending_burst_check"
        );
        state = act(state, opponent, "pass_stack");
        expect(state.stackWindow?.burstWindowKind).toBe("effect_declaration");
        expect(state.setBurstStates).toEqual([]);
        expect(
          matches(state, opponent),
          JSON.stringify({
            stack: state.stackWindow,
            ce: state.activeContinuousEffects,
          })
        ).toBe(canNegate);
        expect(matches(state, owner)).toBe(false);
        state = act(state, opponent, "use_magic");
        state = act(state, owner, "pass_stack");
        state = finish(state, owner);
        expect(
          state.cardInstances.find((c) => c.instanceId === "harvest")?.zone
        ).toBe("trash");
        expect(
          state.cardInstances.find((c) => c.instanceId === "burst")?.zone,
          state.log.join("\n")
        ).toBe(canNegate ? "trash" : "field");
        expect(state.pendingStackNegateRequests).toEqual([]);
        expect(state.revealedBurstStates).toEqual([]);
        expect(
          state.players.find((p) => p.id === opponent)?.reserveNormalCoreCount
        ).toBe(6);
      }
    );
  }
});
