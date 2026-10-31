import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  initializeGame,
  materializeAiSearchDecksWithHandRefs,
  materializeAiSearchFieldInstances,
  materializeAiSearchPublicZoneInstances,
  projectAiSearchCards,
  projectAiSearchDeckKnowledgeWithVisibility,
  sampleAiSearchDeck,
  type AiSearchCard,
  type CardDefinition,
  type GameState,
} from "../src";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["A", "B", "SECRET"].map((name) => ({
  cardNo: `PUBLIC-ZONE-${name}`,
  name,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  maxDeckCount: 40,
}));
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};
const deck = Array.from({ length: 40 }, () => definitions[0]);
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;
const zones = ["trash", "removed_from_game"] as const;

function fixture() {
  const state = initializeGame({
    decks: [[...deck], [...deck]],
    preserveDeckOrder: true,
    skipPreGame: true,
  });
  return replaceCardInstances(state, [
    ...state.cardInstances,
    ...state.playerOrder.flatMap((ownerPlayerId, seat) => [
      createCardInstance(definitions[1], {
        instanceId: `live-source-${seat}`,
        ownerPlayerId,
        zone: "field",
        normalCoreCount: 1,
      }),
      // Preserve four distinct physical copies per seat: two trash, two removed.
      // Void is a core container and must not become a card's sampled zone.
      ...["trash", ...zones, "removed_from_game"].map((zone, index) =>
        createCardInstance(definitions[0], {
          instanceId: `live-public-${seat}-${index}`,
          ownerPlayerId,
          zone: zone as (typeof zones)[number],
        })
      ),
    ]),
  ]);
}

function observe(state: GameState, viewer: string) {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
}
function publicCards(visible: readonly AiSearchCard[]) {
  return visible.filter((card) => zones.some((zone) => zone === card.zone));
}
function project(state: GameState, viewer: string) {
  return publicCards(projectAiSearchCards(observe(state, viewer)));
}
function materialize(cards: readonly AiSearchCard[]) {
  return materializeAiSearchPublicZoneInstances(cards, lookup);
}
function meaning(cards: readonly AiSearchCard[]) {
  return cards.map(({ cardRef: _cardRef, ...card }) => card);
}
function choose(
  state: GameState,
  actor: string,
  kind: string,
  payload: Partial<Parameters<typeof applyLegalAction>[0]> = {},
  sourceInstanceId?: string
) {
  const actions = getLegalActions({
    state,
    actingPlayerId: actor,
    ...options,
  });
  const action = actions.find(
    (candidate) =>
      candidate.kind === kind &&
      (sourceInstanceId === undefined ||
        ("sourceInstanceId" in candidate &&
          candidate.sourceInstanceId === sourceInstanceId))
  );
  expect(action, `${kind}: ${JSON.stringify(actions)}`).toBeDefined();
  return applyLegalAction({ state, action: action!, ...payload, ...options })
    .state;
}

describe("I1 observed public zone instances (partial world)", () => {
  it.each([0, 1])(
    "reprojects both public card zones and recovers then summons the selected copy for root seat %s",
    (seat) => {
      const source = fixture();
      const observation = observe(source, source.playerOrder[seat]);
      const visible = projectAiSearchCards(observation);
      const input = publicCards(visible);
      const before = structuredClone(input);
      const { cards, publicZoneBindings } = materialize(input);
      expect(cards).toHaveLength(8);
      expect(new Set(cards.map((card) => card.instanceId)).size).toBe(8);
      expect(
        cards.every(
          (card) =>
            !source.cardInstances.some(
              (live) => live.instanceId === card.instanceId
            )
        )
      ).toBe(true);
      const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
      const samples = (["me", "opp"] as const).map((owner) =>
        sampleAiSearchDeck(
          knowledge,
          owner,
          [{ weight: 1, cardNos: deck.map((card) => card.cardNo) }],
          definitions,
          31415
        )
      );
      const hidden = materializeAiSearchDecksWithHandRefs(
        samples,
        knowledge,
        visible,
        definitions
      );
      const field = materializeAiSearchFieldInstances(
        visible.filter((card) => card.zone === "field"),
        lookup
      );
      const allCards = [...hidden.cards, ...field.cards, ...cards];
      expect(new Set(allCards.map((card) => card.instanceId)).size).toBe(
        allCards.length
      );
      let world = replaceCardInstances(
        {
          ...createEmptyGameState({
            playerIds: [me, opp],
            startingDeckCount: 0,
            playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
          }),
          zoneCountMode: undefined,
          step: "main",
          activePlayerId: me,
        },
        allCards
      );
      expect(meaning(project(world, me))).toEqual(meaning(input));
      const ownTrash = input.filter(
        (card) => card.owner === "me" && card.zone === "trash"
      );
      expect(ownTrash).toHaveLength(2);
      const id = (ref: number) =>
        publicZoneBindings.find((binding) => binding.cardRef === ref)!
          .instanceId;
      const chosenId = id(ownTrash[1].cardRef);
      const untouchedId = id(ownTrash[0].cardRef);
      const sourceId = field.cards.find(
        (card) => card.ownerPlayerId === me
      )!.instanceId;
      world = executeEffect({
        chainId: "test:public-zone-recovery",
        state: world,
        sourceInstanceId: sourceId,
        actingPlayerId: me,
        ...options,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                player: "self",
                count: 1,
                destination: "hand",
              },
            },
          ],
        },
      });
      expect(world.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
        untouchedId,
        chosenId,
      ]);
      world = choose(world, me, "resolve_pending_zone_selection", {
        selectedZoneCardIds: [chosenId],
      });
      expect(
        world.cardInstances.find((card) => card.instanceId === chosenId)?.zone
      ).toBe("hand");
      // Its new hidden-zone presence must not become a public live binding.
      expect(project(world, opp)).toHaveLength(7);
      expect(
        projectAiSearchCards(observe(world, opp)).some(
          (card) => card.zone === "hand" && card.owner === "opp"
        )
      ).toBe(false);
      // Recovery increased the hand. Resolve the engine's normal burst checks
      // before the next declaration; do not clear their state in the fixture.
      for (const actor of [me, opp]) {
        const check = getLegalActions({
          state: world,
          actingPlayerId: actor,
          ...options,
        }).find((action) => action.kind === "resolve_pending_burst_check");
        if (check)
          world = applyLegalAction({
            state: world,
            action: check,
            ...options,
          }).state;
      }
      expect(world.pendingBurstChecks).toHaveLength(0);
      world = choose(world, me, "summon", { paymentSources: [] }, chosenId);
      world = choose(world, opp, "pass_stack");
      world = choose(world, me, "resolve_pending_enter_field_placement", {
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      });
      expect(
        world.cardInstances.find((card) => card.instanceId === chosenId)
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
      });
      expect(
        world.cardInstances.find((card) => card.instanceId === untouchedId)
          ?.zone
      ).toBe("trash");
      expect(
        world.cardInstances.filter((card) => card.zone === "void")
      ).toHaveLength(0);
      expect(
        world.cardInstances.filter((card) => card.zone === "removed_from_game")
      ).toHaveLength(4);
      expect(world.players.find((player) => player.id === me)!.handCount).toBe(
        4
      );
      expect(world.pendingZoneSelection).toBeNull();
      expect(world.pendingEnterFieldPlacement).toBeNull();
      expect(world.stackWindow).toBeNull();
      expect(input).toEqual(before);
    }
  );

  it.each([0, 1])(
    "is independent of secrets and raw identity renaming for root seat %s",
    (seat) => {
      const source = fixture(),
        viewer = source.playerOrder[seat];
      const changed = structuredClone(source);
      const rename = (id: string) => `renamed-${id}`;
      for (const card of changed.cardInstances) {
        if (
          card.zone === "deck" ||
          (card.zone === "hand" && card.ownerPlayerId !== viewer)
        ) {
          card.definitionId = definitions[2].cardNo;
          card.originalDefinitionId = definitions[2].cardNo;
        }
        card.instanceId = rename(card.instanceId);
        card.ownerPlayerId = rename(card.ownerPlayerId);
        card.controllerPlayerId = rename(card.controllerPlayerId);
      }
      changed.cardInstances.reverse(); // Restore visible slot order below; deck order remains changed.
      changed.cardInstances = [
        ...changed.cardInstances.filter((card) => card.zone === "deck"),
        ...changed.cardInstances
          .filter((card) => card.zone !== "deck")
          .reverse(),
      ];
      changed.playerOrder = changed.playerOrder.map(rename);
      changed.activePlayerId = rename(changed.activePlayerId);
      for (const player of changed.players) player.id = rename(player.id);
      const original = project(source, viewer),
        other = project(changed, rename(viewer));
      expect(other).toEqual(original);
      expect(materialize(other)).toEqual(materialize(original));
      expect(materialize([...other].reverse())).toEqual(materialize(original));
      Object.defineProperty(other[0], "instanceId", {
        get() {
          throw new Error("live ID read");
        },
      });
      Object.defineProperty(other[0], "toJSON", {
        get() {
          throw new Error("serialization hook read");
        },
      });
      expect(materialize(other)).toEqual(materialize(original));
    }
  );

  it("preserves public owner/controller and physical values without using effective identity as printed data", () => {
    const source = fixture();
    const input = project(source, source.playerOrder[0]);
    const observed = {
      ...input[0],
      controller: "opp" as const,
      normalCoreCount: 2,
      soulCoreCount: 1,
      exhaustState: "heavily_exhausted" as const,
      exhausted: true,
      effectiveBp: 99999,
      effectiveColors: ["blue"],
    };
    const { cards } = materialize([observed]);
    expect(cards[0]).toMatchObject({
      ownerPlayerId: me,
      controllerPlayerId: opp,
      normalCoreCount: 2,
      soulCoreCount: 1,
      exhaustState: "heavily_exhausted",
      definitionId: definitions[0].cardNo,
      originalDefinitionId: definitions[0].cardNo,
    });
    expect(lookup(cards[0].definitionId)?.colors).toEqual(["red"]);
  });

  it("rejects unsupported, concealed, dangling, duplicate and inconsistent inputs without mutating observations", () => {
    const source = fixture(),
      input = project(source, source.playerOrder[0]);
    const before = structuredClone(input);
    const invalid: Partial<AiSearchCard>[] = [
      { zone: "hand" },
      { zone: "deck" },
      { zone: "field" },
      { zone: "void" },
      { zone: "revealed" },
      { zone: "in_use" },
      { zone: "burst" },
      { zone: "set_aside" },
      { identityVisibility: "unknown" },
      { faceDown: true },
      { cardRef: -1 },
      { cardRef: 0.5 },
      { owner: "invalid" as "me" },
      { controller: "invalid" as "opp" },
      { pendingLeaveKind: "destroy" },
      { attachedTo: 90 },
      { attachedChildren: [90] },
      { imaginRight: 90 },
      { underCardCount: 1 },
      { normalCoreCount: -1 },
      { soulCoreCount: NaN },
      { minimumRequiredCores: 0.5 },
      { exhausted: true },
      { zoneRoleName: "" },
      { cardNoOrUnknown: "missing" },
      { originalCardNo: definitions[1].cardNo },
    ];
    for (const override of invalid)
      expect(() => materialize([{ ...input[0], ...override }])).toThrow();
    expect(() =>
      materializeAiSearchPublicZoneInstances(
        [{ ...input[0], zone: "void" }],
        () => {
          throw new Error("public definition lookup must not run");
        }
      )
    ).toThrow("unsupported or inconsistent observed public zone card");
    expect(() => materialize([input[0], input[0]])).toThrow(/inconsistent/);
    expect(() =>
      materializeAiSearchPublicZoneInstances(input, () => definitions[1])
    ).toThrow(/definition/);
    expect(() =>
      materializeAiSearchPublicZoneInstances(
        null as unknown as AiSearchCard[],
        lookup
      )
    ).toThrow();
    expect(materialize([])).toEqual({ cards: [], publicZoneBindings: [] });
    expect(input).toEqual(before);
  });
});
