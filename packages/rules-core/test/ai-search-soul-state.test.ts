import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  materializeAiSearchFieldInstances,
  materializeAiSearchPlayerResources,
  projectAiSearchCards,
  projectAiSearchPlayerResources,
  queuePendingLeave,
  type AiObservation,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeSoulStateSummon } from "../src/effect/structured-summon";

const contract: CardDefinition = {
  cardNo: "SEARCH-SOUL-CONTRACT",
  name: "contract",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: ["contract"],
  textLines: [],
};
const secret = { ...contract, cardNo: "SEARCH-SOUL-SECRET", keywordTags: [] };
const lookup = (id: string) =>
  [contract, secret].find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function fixture() {
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["live-alice", "live-bob"],
      startingDeckCount: 0,
      playerOverrides: [0, 1].map(() => ({
        handCount: 0,
        contractCardNo: contract.cardNo,
      })),
      cardInstances: ["live-alice", "live-bob"].flatMap((ownerPlayerId) => [
        createCardInstance(contract, {
          instanceId: `${ownerPlayerId}-contract`,
          ownerPlayerId,
          zone: "field",
          normalCoreCount: 3,
          exhaustState: "exhausted",
        }),
        createCardInstance(secret, {
          instanceId: `${ownerPlayerId}-hidden`,
          ownerPlayerId,
          zone: "deck",
        }),
      ]),
    }),
    turnNumber: 3,
    step: "main",
    zoneCountMode: undefined,
  };
  for (const owner of state.playerOrder) {
    state = flushPendingLeaves(
      queuePendingLeave({
        state,
        instanceId: `${owner}-contract`,
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: state.playerOrder.find((id) => id !== owner)!,
        chainId: `test:${owner}`,
      }),
      lookup
    );
    const action = getLegalActions({
      state,
      actingPlayerId: owner,
      ...options,
    }).find(
      (entry) =>
        entry.kind === "resolve_soul_state_replacement" &&
        entry.choice === "keep"
    );
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...options }).state;
  }
  return state;
}
function observe(state: GameState, viewer: string) {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
}
function project(observation: AiObservation) {
  const cards = projectAiSearchCards(observation).filter(
    (card) => card.zone === "field"
  );
  const field = materializeAiSearchFieldInstances(cards, lookup);
  const resources = projectAiSearchPlayerResources(observation);
  const players = materializeAiSearchPlayerResources(
    resources,
    field,
    cards,
    lookup
  );
  return { cards, field, resources, players };
}

describe("I1 observed soul-state membership (partial world)", () => {
  it.each([0, 1])(
    "root %s preserves real soul replacement, no attack, and explicit summon/maintenance placement",
    (seat) => {
      const source = fixture(),
        viewer = source.playerOrder[seat];
      const observation = observe(source, viewer),
        input = project(observation),
        before = structuredClone(input);
      expect(source.pendingSoulStateReplacement).toBeNull();
      expect(source.pendingLeaveEntities).toEqual([]);
      expect(
        input.players.every(
          (player) => player.soulStateInstanceIds.length === 1
        )
      ).toBe(true);
      let world: GameState = {
        ...createEmptyGameState({
          playerIds: [me, opp],
          playerOverrides: input.players,
          cardInstances: input.field.cards,
        }),
        turnNumber: 3,
        step: "attack",
        activePlayerId: me,
      };
      const id = input.players[0]!.soulStateInstanceIds[0]!;
      expect(
        getLegalActions({
          state: world,
          actingPlayerId: me,
          ...options,
        }).filter((action) => action.kind === "attack")
      ).toEqual([]);
      expect(projectAiSearchPlayerResources(observe(world, me))).toEqual(
        input.resources
      );
      const opposite = projectAiSearchPlayerResources(observe(world, opp));
      expect(opposite[0]!.soulStateCardRefs).toEqual(
        input.resources[1]!.soulStateCardRefs
      );
      expect(opposite[1]!.soulStateCardRefs).toEqual(
        input.resources[0]!.soulStateCardRefs
      );
      // 08a2: an explicit soul-state summon effect, not an ordinary summon.
      world = executeSoulStateSummon(
        { ...world, step: "main" },
        "test:soul-summon",
        me,
        undefined,
        "free",
        id,
        lookup,
        [id],
        [{ kind: "reserve_normal", amount: 1 }]
      );
      expect(world.players[0]!.soulStateInstanceIds).toEqual([]);
      expect(world.players[0]!.reserveNormalCoreCount).toBe(
        input.players[0]!.reserveNormalCoreCount - 1
      );
      expect(world.players[1]!.soulStateInstanceIds).toEqual(
        input.players[1]!.soulStateInstanceIds
      );
      expect(
        world.cardInstances.find((card) => card.instanceId === id)
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      });
      expect(world.pendingMultiPlacement).toBeNull();
      expect(world.pendingEnterFieldPlacement).toBeNull();
      expect(
        getLegalActions({
          state: { ...world, step: "attack" },
          actingPlayerId: me,
          ...options,
        }).some((action) => action.kind === "attack")
      ).toBe(true);
      expect(input).toEqual(before);
    }
  );

  it.each([0, 1])(
    "root %s ignores different secrets and live player/card IDs",
    (seat) => {
      const source = fixture(),
        changed = structuredClone(source),
        viewer = source.playerOrder[seat];
      const rename = (id: string) => `renamed:${id}`;
      for (const card of changed.cardInstances) {
        if (card.zone === "deck") card.definitionId = contract.cardNo;
        card.instanceId = rename(card.instanceId);
        card.ownerPlayerId = rename(card.ownerPlayerId);
        card.controllerPlayerId = rename(card.controllerPlayerId);
      }
      changed.playerOrder = changed.playerOrder.map(rename);
      changed.activePlayerId = rename(changed.activePlayerId);
      for (const player of changed.players) {
        player.id = rename(player.id);
        player.soulStateInstanceIds = player.soulStateInstanceIds.map(rename);
      }
      const result = project(observe(changed, rename(viewer)));
      expect(result).toEqual(project(observe(source, viewer)));
      expect(JSON.stringify(result)).not.toMatch(
        /live-|renamed:|SEARCH-SOUL-SECRET/
      );
    }
  );

  it("rejects old/missing/duplicate/dangling/hidden/non-field membership without exposing secret IDs", () => {
    const state = fixture(),
      viewer = state.playerOrder[0],
      observation = observe(state, viewer);
    for (const ids of [
      undefined,
      [],
      ["absent"],
      ["live-alice-hidden"],
      ["live-alice-contract", "live-alice-contract"],
    ]) {
      const bad = structuredClone(observation);
      bad.players[0]!.soulStateCardInstanceIds = ids;
      expect(() => projectAiSearchPlayerResources(bad)).toThrow();
    }
    state.players[0]!.soulStateInstanceIds = ["live-alice-hidden"];
    const hidden = observe(state, viewer);
    expect(hidden.players[0]!.soulStateCardInstanceIds).toEqual([]);
    expect(() => projectAiSearchPlayerResources(hidden)).toThrow();
    for (const mutate of [
      (o: AiObservation) => {
        o.cards[0]!.normalCoreCount = 1;
      },
      (o: AiObservation) => {
        o.cards[0]!.soulCoreCount = 1;
      },
      (o: AiObservation) => {
        o.cards[0]!.exhaustState = "exhausted";
      },
      (o: AiObservation) => {
        o.cards[0]!.zone = "trash";
      },
      (o: AiObservation) => {
        o.cards[0]!.faceDown = true;
      },
      (o: AiObservation) => {
        o.cards[0]!.controllerPlayerId = o.players[1]!.playerId;
      },
    ]) {
      const bad = structuredClone(observation);
      mutate(bad);
      expect(() => projectAiSearchPlayerResources(bad)).toThrow();
    }
  });

  it("rejects mismatched synthetic membership and never guesses an absent component", () => {
    const state = fixture(),
      input = project(observe(state, state.playerOrder[0]));
    const bind = (value = input) =>
      materializeAiSearchPlayerResources(
        value.resources,
        value.field,
        value.cards,
        lookup
      );
    for (const mutation of [
      (v: typeof input) => {
        v.resources[0]!.soulStateCardRefs = [999];
      },
      (v: typeof input) => {
        v.resources[0]!.soulStateCardRefs = [
          ...v.resources[0]!.soulStateCardRefs,
          ...v.resources[0]!.soulStateCardRefs,
        ];
      },
      (v: typeof input) => {
        v.resources[1]!.soulStateCardRefs = v.resources[0]!.soulStateCardRefs;
      },
      (v: typeof input) => {
        v.field.cards[0]!.normalCoreCount = 1;
      },
      (v: typeof input) => {
        v.field.cards[0]!.controllerPlayerId = opp;
      },
      (v: typeof input) => {
        v.field.fieldBindings = [];
      },
      (v: typeof input) => {
        v.field.cards[0]!.instanceId = "secret-live-id";
      },
    ]) {
      const bad = structuredClone(input);
      mutation(bad);
      expect(() => bind(bad)).toThrow();
    }
    expect(bind()).toEqual(input.players);
  });
});
