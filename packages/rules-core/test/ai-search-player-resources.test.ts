import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  materializeAiSearchDecksWithHandRefs,
  materializeAiSearchFieldInstances,
  materializeAiSearchPlayerResources,
  moveSoulCore,
  projectAiSearchCards,
  projectAiSearchDeckKnowledgeWithVisibility,
  projectAiSearchPlayerResources,
  sampleAiSearchDeck,
  type AiObservation,
  type CardDefinition,
  type GameState,
} from "../src";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["PUBLIC", "SECRET"].map((name) => ({
  cardNo: `RESOURCE-${name}`,
  name,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
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
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function fixture() {
  const state = createEmptyGameState({
    playerIds: ["live-alice", "live-bob"],
    playerOverrides: [0, 1].map((seat) => ({
      deckCount: 3,
      handCount: 2,
      lifeNormalCoreCount: 3 + seat,
      reserveNormalCoreCount: 8 + seat,
      trashNormalCoreCount: 2 + seat,
      voidNormalCoreCount: 185 - 3 * seat,
      soulCoreLocation: { kind: "reserve" as const },
      reserveSoulCoreCount: 2,
      trashSoulCoreCount: 1,
      lifeSoulCoreCount: 1,
    })),
  });
  return replaceCardInstances(
    { ...state, zoneCountMode: undefined, turnNumber: 2, step: "main" },
    state.playerOrder.flatMap((ownerPlayerId, seat) =>
      (["field", "hand", "hand", "deck", "deck", "deck"] as const).map(
        (zone, index) =>
          createCardInstance(definitions[0], {
            instanceId: `live-${seat}-${index}`,
            ownerPlayerId,
            zone,
            normalCoreCount: zone === "field" ? 1 : 0,
          })
      )
    )
  );
}
function observe(state: GameState, viewer: string) {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
}
function project(observation: AiObservation) {
  const visible = projectAiSearchCards(observation);
  const observedField = visible.filter((card) => card.zone === "field");
  const resources = projectAiSearchPlayerResources(observation);
  const field = materializeAiSearchFieldInstances(observedField, lookup);
  const players = materializeAiSearchPlayerResources(
    resources,
    field,
    observedField,
    lookup
  );
  return { visible, observedField, resources, field, players };
}

describe("I1 observed player physical resources (partial world)", () => {
  it.each(
    [0, 1].flatMap((seat) =>
      ["reserve", "field"].map((from) => ({ seat, from }))
    )
  )(
    "reprojects resources and completes paid summon/placement for root $seat using $from soul core",
    ({ seat, from }) => {
      let source = fixture();
      const viewer = source.playerOrder[seat];
      if (from === "field")
        source = moveSoulCore(
          source,
          viewer,
          { kind: "reserve", playerId: viewer },
          { kind: "card", instanceId: `live-${seat}-0` }
        );
      const observation = observe(source, viewer);
      const input = project(observation),
        before = structuredClone(input);
      const knowledge = projectAiSearchDeckKnowledgeWithVisibility(observation);
      const samples = (["me", "opp"] as const).map((owner) =>
        sampleAiSearchDeck(
          knowledge,
          owner,
          [{ weight: 1, cardNos: Array(5).fill(definitions[0].cardNo) }],
          definitions,
          31415
        )
      );
      const hidden = materializeAiSearchDecksWithHandRefs(
        samples,
        knowledge,
        input.visible,
        definitions
      );
      let world = replaceCardInstances(
        {
          ...createEmptyGameState({
            playerIds: [me, opp],
            playerOverrides: input.players,
          }),
          zoneCountMode: undefined,
          turnNumber: 2,
          step: "main",
          activePlayerId: me,
        },
        [...hidden.cards, ...input.field.cards]
      );
      for (const viewpoint of [me, opp]) {
        const reprojection = observe(world, viewpoint);
        // Card references are local to an observation. Reordering the freshly
        // assembled zones changes the numbers, but must preserve the exact edge.
        const expected = input.resources.map((entry) => {
          const location = entry.soulCoreLocation;
          const binding =
            location?.kind === "card"
              ? input.field.fieldBindings.find(
                  (value) => value.cardRef === location.cardRef
                )
              : undefined;
          return {
            ...entry,
            owner:
              viewpoint === me
                ? entry.owner
                : entry.owner === "me"
                  ? "opp"
                  : "me",
            soulCoreLocation: binding
              ? {
                  kind: "card",
                  cardRef: reprojection.cards.findIndex(
                    (card) => card.instanceId === binding.instanceId
                  ),
                }
              : location,
          };
        });
        if (viewpoint === opp) expected.reverse();
        expect(projectAiSearchPlayerResources(reprojection)).toEqual(expected);
      }
      const chosenId = hidden.handBindings[0]!.instanceId;
      const fieldId = input.field.fieldBindings.find(
        (binding) =>
          input.observedField.find((card) => card.cardRef === binding.cardRef)!
            .owner === "me"
      )!.instanceId;
      const actions = () =>
        [me, opp].flatMap((actingPlayerId) =>
          getLegalActions({ state: world, actingPlayerId, ...options })
        );
      const summon = actions().find(
        (action) =>
          action.kind === "summon" && action.sourceInstanceId === chosenId
      )!;
      expect(summon).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: summon,
        paymentSources:
          from === "field"
            ? [
                {
                  kind: "card",
                  instanceId: fieldId,
                  amount: 1,
                  includeSoulCore: true,
                },
                { kind: "reserve", amount: 1 },
              ]
            : [{ kind: "reserve", amount: 2, includeSoulCore: true }],
        ...options,
      }).state;
      const pass = actions().find((action) => action.kind === "pass_stack")!;
      expect(pass).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: pass,
        ...options,
      }).state;
      const place = actions().find(
        (action) => action.kind === "resolve_pending_enter_field_placement"
      )!;
      expect(place).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: place,
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        ...options,
      }).state;
      expect(world.players.find((player) => player.id === me)).toMatchObject({
        reserveNormalCoreCount: input.resources[0]!.reserveNormalCoreCount - 2,
        trashNormalCoreCount: input.resources[0]!.trashNormalCoreCount + 1,
        reserveSoulCoreCount:
          input.resources[0]!.reserveSoulCoreCount -
          (from === "reserve" ? 1 : 0),
        trashSoulCoreCount: input.resources[0]!.trashSoulCoreCount + 1,
        lifeSoulCoreCount: 1,
        soulCoreLocation: { kind: "trash" },
        handCount: 1,
      });
      expect(
        world.cardInstances.find((card) => card.instanceId === chosenId)
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(
        world.cardInstances.find((card) => card.instanceId === fieldId)
      ).toMatchObject({ zone: "field", normalCoreCount: 1, soulCoreCount: 0 });
      expect(world.pendingEnterFieldPlacement).toBeNull();
      expect(world.stackWindow).toBeNull();
      expect(input).toEqual(before);
    }
  );

  it("does not transport hidden card references or infer a missing legacy location from counts", () => {
    const source = fixture(),
      viewer = source.playerOrder[0];
    source.players[1]!.soulCoreLocation = {
      kind: "card",
      instanceId: "live-1-1",
    };
    const observation = observe(source, viewer);
    expect(observation.players[1]!.soulCoreCardInstanceId).toBeNull();
    expect(() => projectAiSearchPlayerResources(observation)).toThrow(
      "missing observed soul core field reference"
    );
    source.players[1]!.soulCoreLocation = null;
    const input = project(observe(source, viewer));
    expect(input.resources[1]!.reserveSoulCoreCount).toBe(2);
    expect(input.players[1]!.soulCoreLocation).toBeNull();
  });

  it("preserves reserve/trash/life/removed/none without single-core normalization", () => {
    for (const kind of [
      "reserve",
      "trash",
      "life",
      "removed_from_game",
      "none",
    ] as const) {
      const source = fixture(),
        viewer = source.playerOrder[0];
      source.players[0]!.soulCoreLocation = kind === "none" ? null : { kind };
      const input = project(observe(source, viewer));
      expect(input.players[0]).toMatchObject({
        reserveSoulCoreCount: 2,
        trashSoulCoreCount: 1,
        lifeSoulCoreCount: 1,
        soulCoreLocation: kind === "none" ? null : { kind },
      });
    }
  });

  it("is invariant to secret identities/order and live player/card ID renaming", () => {
    let source = fixture();
    const viewer = source.playerOrder[0];
    source = moveSoulCore(
      source,
      viewer,
      { kind: "reserve", playerId: viewer },
      { kind: "card", instanceId: "live-0-0" }
    );
    const changed = structuredClone(source),
      rename = (id: string) => `renamed-${id}`;
    for (const card of changed.cardInstances) {
      if (
        card.zone === "deck" ||
        (card.zone === "hand" && card.ownerPlayerId !== viewer)
      )
        card.definitionId = card.originalDefinitionId = definitions[1].cardNo;
      card.instanceId = rename(card.instanceId);
      card.ownerPlayerId = rename(card.ownerPlayerId);
      card.controllerPlayerId = rename(card.controllerPlayerId);
    }
    changed.playerOrder = changed.playerOrder.map(rename);
    changed.activePlayerId = rename(changed.activePlayerId);
    for (const player of changed.players) {
      player.id = rename(player.id);
      if (player.soulCoreLocation?.kind === "card")
        player.soulCoreLocation.instanceId = rename(
          player.soulCoreLocation.instanceId
        );
    }
    const original = project(observe(source, viewer)),
      other = project(observe(changed, rename(viewer)));
    expect(other).toEqual(original);
    expect(JSON.stringify(other)).not.toContain("live-");
    expect(JSON.stringify(other)).not.toContain("renamed-");
    expect(JSON.stringify(other)).not.toContain("RESOURCE-SECRET");
  });

  it("rejects negative/nonfinite counts, missing old references and inconsistent synthetic bindings", () => {
    let source = fixture();
    const viewer = source.playerOrder[0];
    source = moveSoulCore(
      source,
      viewer,
      { kind: "reserve", playerId: viewer },
      { kind: "card", instanceId: "live-0-0" }
    );
    const observation = observe(source, viewer),
      input = project(observation);
    for (const value of [-1, NaN, Infinity, 0.5]) {
      const bad = structuredClone(observation);
      bad.players[0]!.reserveNormalCoreCount = value;
      expect(() => projectAiSearchPlayerResources(bad)).toThrow();
    }
    const old = structuredClone(observation);
    delete old.players[0]!.soulCoreCardInstanceId;
    expect(() => projectAiSearchPlayerResources(old)).toThrow(
      "missing observed soul core field reference"
    );
    const missing = { ...input.field, fieldBindings: [] };
    expect(() =>
      materializeAiSearchPlayerResources(
        input.resources,
        missing,
        input.observedField,
        lookup
      )
    ).toThrow();
    const duplicate = {
      ...input.field,
      fieldBindings: [
        ...input.field.fieldBindings,
        input.field.fieldBindings[0]!,
      ],
    };
    expect(() =>
      materializeAiSearchPlayerResources(
        input.resources,
        duplicate,
        input.observedField,
        lookup
      )
    ).toThrow();
    const broken = structuredClone(input.field);
    broken.cards[0]!.soulCoreCount = 0;
    expect(() =>
      materializeAiSearchPlayerResources(
        input.resources,
        broken,
        input.observedField,
        lookup
      )
    ).toThrow();
    const live = structuredClone(input.field);
    live.fieldBindings[0]!.instanceId = live.cards[0]!.instanceId =
      "real-secret-id";
    expect(() =>
      materializeAiSearchPlayerResources(
        input.resources,
        live,
        input.observedField,
        lookup
      )
    ).toThrow();
    expect(() =>
      materializeAiSearchPlayerResources(
        [input.resources[0]!, input.resources[0]!],
        input.field,
        input.observedField,
        lookup
      )
    ).toThrow();
    expect(input).toEqual(project(observation));
  });

  it("rejects full/debug observations and mismatched non-card locations", () => {
    const source = fixture(),
      viewer = source.playerOrder[0];
    for (const mode of ["spectator_full", "debug_perfect"] as const) {
      const observation = buildAiObservation({
        state: source,
        viewpointPlayerId: viewer,
        mode,
        getCardDefinitionById: lookup,
      });
      expect(() => projectAiSearchPlayerResources(observation)).toThrow();
    }
    for (const kind of ["reserve", "trash", "life"] as const) {
      const observation = observe(source, viewer);
      observation.players[0]!.soulCoreLocationKind = kind;
      observation.players[0]![`${kind}SoulCoreCount`] = 0;
      expect(() => projectAiSearchPlayerResources(observation)).toThrow(
        "inconsistent observed soul core location"
      );
    }
  });
});
