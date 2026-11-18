import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  initializeGame,
  materializeAiSearchDecksWithHandRefs,
  materializeAiSearchFieldInstances,
  projectAiSearchCards,
  projectAiSearchDeckKnowledgeWithVisibility,
  sampleAiSearchDeck,
  type AiSearchCard,
  type CardDefinition,
  type GameState,
} from "../src";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const definitions: CardDefinition[] = ["A", "B", "SECRET"].map((name) => ({
  cardNo: `FIELD-SAMPLE-${name}`,
  name,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 5000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  maxDeckCount: 40,
}));
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const deck = Array.from({ length: 40 }, () => definitions[0]);
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;
const options = {
  getCardDefinitionById: lookup,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};

function fixture() {
  const state = initializeGame({
    decks: [[...deck], [...deck]],
    preserveDeckOrder: true,
    skipPreGame: true,
  });
  return replaceCardInstances(state, [
    ...state.cardInstances,
    ...state.playerOrder.flatMap((ownerPlayerId, seat) =>
      ["recovered", "exhausted", "heavily_exhausted"].map((exhaustState, i) =>
        createCardInstance(definitions[seat], {
          instanceId: `live-field-${seat}-${i}`,
          ownerPlayerId,
          zone: "field",
          normalCoreCount: seat === 0 ? 2 : 1,
          exhaustState: exhaustState as
            | "recovered"
            | "exhausted"
            | "heavily_exhausted",
        })
      )
    ),
  ]);
}

function project(state: GameState, viewer: string) {
  return projectAiSearchCards(
    buildAiObservation({
      state,
      viewpointPlayerId: viewer,
      getCardDefinitionById: lookup,
    })
  ).filter((card) => card.zone === "field");
}

describe("I1 observed physical field instances (partial world)", () => {
  it.each([0, 1])(
    "reprojects the standalone physical field and completes attack/block resolution for root seat %s",
    (seat) => {
      const source = fixture();
      // Give the root attacker Lv2 and the other seat's blocker Lv1.
      for (const card of source.cardInstances)
        if (card.zone === "field")
          card.normalCoreCount =
            card.ownerPlayerId === source.playerOrder[seat] ? 2 : 1;
      const observation = buildAiObservation({
        state: source,
        viewpointPlayerId: source.playerOrder[seat],
        getCardDefinitionById: lookup,
      });
      const visible = projectAiSearchCards(observation);
      const fields = visible.filter((card) => card.zone === "field");
      const before = structuredClone(fields);
      const { cards, fieldBindings } = materializeAiSearchFieldInstances(
        fields,
        lookup
      );
      expect(cards).toHaveLength(6);
      expect(new Set(cards.map((card) => card.instanceId)).size).toBe(6);
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
      expect(
        new Set([...hidden.cards, ...cards].map((card) => card.instanceId)).size
      ).toBe(hidden.cards.length + cards.length);
      let world = replaceCardInstances(
        {
          ...createEmptyGameState({
            playerIds: [me, opp],
            startingDeckCount: 0,
            playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
          }),
          zoneCountMode: undefined,
          turnNumber: 2,
          step: "attack",
          window: "none",
          activePlayerId: me,
        },
        [...hidden.cards, ...cards]
      );
      // Local refs change when the complete observation order changes. Compare
      // the full field token meaning, with just that local ref removed.
      const meaning = (values: readonly AiSearchCard[]) =>
        values.map(({ cardRef: _ref, ...card }) => card);
      expect(meaning(project(world, me))).toEqual(meaning(fields));
      const choose = (
        owner: "me" | "opp",
        state: "recovered" | "exhausted"
      ) => {
        const observed = fields.find(
          (card) => card.owner === owner && card.exhaustState === state
        )!;
        return fieldBindings.find(
          (binding) => binding.cardRef === observed.cardRef
        )!.instanceId;
      };
      const attacker = choose("me", "recovered"),
        blocker = choose("opp", "recovered");
      const actions = () =>
        [me, opp].flatMap((actingPlayerId) =>
          getLegalActions({ state: world, actingPlayerId, ...options })
        );
      const finishDeclaration = () => {
        for (let i = 0; i < 4 && world.preDeclarationStackWindow; i++) {
          const pass = actions().find(
            (action) => action.kind === "pass_pre_declaration_stack"
          );
          expect(pass).toBeDefined();
          world = applyLegalAction({
            state: world,
            action: pass!,
            ...options,
          }).state;
        }
        expect(world.preDeclarationStackWindow).toBeNull();
      };
      expect(
        actions().some(
          (action) =>
            action.kind === "attack" &&
            action.sourceInstanceId === choose("me", "exhausted")
        )
      ).toBe(false);
      const attack = actions().find(
        (action) =>
          action.kind === "attack" && action.sourceInstanceId === attacker
      )!;
      expect(attack).toBeDefined();
      world = applyLegalAction({
        state: world,
        action: attack,
        ...options,
      }).state;
      finishDeclaration();
      expect(
        world.cardInstances.find((card) => card.instanceId === attacker)!
          .exhaustState
      ).toBe("exhausted");
      let blocked = false;
      for (let i = 0; i < 24 && world.activeAttack; i++) {
        const legal = actions();
        const block = legal.find(
          (action) =>
            action.kind === "block" && action.sourceInstanceId === blocker
        );
        const action =
          block ??
          legal.find((item) =>
            ["pass_stack", "pass_battle_flash", "open_battle_flash"].includes(
              item.kind
            )
          );
        expect(
          action,
          `unhandled battle choices ${legal.map((item) => item.kind).join(",")}`
        ).toBeDefined();
        world = applyLegalAction({
          state: world,
          action: action!,
          ...options,
        }).state;
        if (block) {
          finishDeclaration();
          blocked = true;
          expect(
            world.cardInstances.find((card) => card.instanceId === blocker)!
              .exhaustState
          ).toBe("exhausted");
        }
      }
      expect(blocked).toBe(true);
      expect(world.activeAttack).toBeNull();
      expect(world.stackWindow).toBeNull();
      expect(
        world.cardInstances.find((card) => card.instanceId === attacker)!.zone
      ).toBe("field");
      expect(
        world.cardInstances.find((card) => card.instanceId === blocker)!.zone
      ).toBe("trash");
      expect(
        world.players.find((player) => player.id === opp)!.lifeNormalCoreCount
      ).toBe(5);
      expect(fields).toEqual(before);
    }
  );

  it("keeps synthetic bindings independent of hidden identities, live IDs and input ordering", () => {
    const source = fixture(),
      viewer = source.playerOrder[0];
    const original = project(source, viewer);
    const changed = structuredClone(source);
    const rename = (id: string) => `other-${id}`;
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
    changed.playerOrder = changed.playerOrder.map(rename);
    changed.activePlayerId = rename(changed.activePlayerId);
    for (const player of changed.players) player.id = rename(player.id);
    const other = project(changed, rename(viewer));
    expect(other).toEqual(original);
    const expected = materializeAiSearchFieldInstances(original, lookup);
    expect(
      materializeAiSearchFieldInstances([...other].reverse(), lookup)
    ).toEqual(expected);
    Object.defineProperty(other[0], "instanceId", {
      get() {
        throw new Error("live identity read");
      },
    });
    Object.defineProperty(other[0], "toJSON", {
      get() {
        throw new Error("serialization hook read");
      },
    });
    expect(materializeAiSearchFieldInstances(other, lookup)).toEqual(expected);
  });

  it("preserves public control and physical core counts without mutating input or DB", () => {
    const source = fixture();
    const fields = project(source, source.playerOrder[0]);
    expect(fields).toHaveLength(6);
    fields[0] = {
      ...fields[0],
      controller: "opp",
      soulCoreCount: 2,
      normalCoreCount: 3,
    };
    const before = structuredClone(fields),
      db = structuredClone(definitions);
    const result = materializeAiSearchFieldInstances(fields, lookup);
    expect(result.cards[0]).toMatchObject({
      ownerPlayerId: me,
      controllerPlayerId: opp,
      normalCoreCount: 3,
      soulCoreCount: 2,
      everHadCorePlaced: true,
    });
    result.cards[0].normalCoreCount = 0;
    expect(fields).toEqual(before);
    expect(definitions).toEqual(db);
  });

  it.each([0, 1])(
    "preserves a remaining right Imagin attachment and rejects legacy missing-slot observations for root seat %s",
    (seat) => {
      const imagin: CardDefinition = {
        ...definitions[0],
        cardNo: "FIELD-SAMPLE-IMAGIN",
        printedCategory: "brave",
        levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
        imaginBraveData: {},
      };
      const publicLookup = (id: string) =>
        id === imagin.cardNo ? imagin : lookup(id);
      const playerIds = ["live-owner", "live-opponent"];
      // 08c:32: after one host leaves, the other combination remains. The
      // right slot is deliberately absent from the host's ordinary children.
      // An explicit empty slot distinguishes a standalone Imagin from a legacy
      // observation that omitted right relationships entirely.
      for (const hasRightHost of [true, false]) {
        const state = createEmptyGameState({
          playerIds,
          cardInstances: [
            createCardInstance(definitions[0], {
              instanceId: "live-right-host",
              ownerPlayerId: playerIds[0],
              zone: "field",
              normalCoreCount: 1,
            }),
            createCardInstance(imagin, {
              instanceId: "live-imagin",
              ownerPlayerId: playerIds[0],
              zone: "field",
              imaginRightCombinedWith: hasRightHost ? "live-right-host" : null,
            }),
          ],
        });
        expect(
          state.cardInstances.find((card) => card.instanceId === "live-imagin")
        ).toMatchObject({
          attachedToInstanceId: null,
          imaginRightCombinedWith: hasRightHost ? "live-right-host" : null,
        });
        expect(
          state.cardInstances.find(
            (card) => card.instanceId === "live-right-host"
          )!.attachedChildrenIds
        ).toEqual([]);
        const fields = projectAiSearchCards(
          buildAiObservation({
            state,
            viewpointPlayerId: playerIds[seat],
            getCardDefinitionById: publicLookup,
          })
        ).filter((card) => card.zone === "field");
        expect(fields).toHaveLength(2);
        const observed = fields.find(
          (card) => card.cardNoOrUnknown === imagin.cardNo
        )!;
        expect(observed).toMatchObject({
          identityVisibility: "known",
          attachedChildren: [],
          underCardCount: 0,
        });
        expect(observed.attachedTo).toBeUndefined();
        const before = structuredClone(fields);
        const result = materializeAiSearchFieldInstances(fields, publicLookup);
        const rightRef = fields.find(
          (card) => card.cardNoOrUnknown === definitions[0].cardNo
        )!.cardRef;
        expect(observed.imaginRight).toBe(hasRightHost ? rightRef : null);
        expect(
          result.cards.find((card) => card.definitionId === imagin.cardNo)
        ).toMatchObject({
          imaginRightCombinedWith: hasRightHost
            ? `search-field-${rightRef}`
            : null,
        });
        const legacy = structuredClone(fields);
        delete legacy.find((card) => card.cardNoOrUnknown === imagin.cardNo)!
          .imaginRight;
        expect(() =>
          materializeAiSearchFieldInstances(legacy, publicLookup)
        ).toThrow("missing observed Imagin right slot");
        expect(fields).toEqual(before);
      }
    }
  );

  it("rejects unsupported relationships and inconsistent physical values instead of inventing continuation state", () => {
    const source = fixture(),
      fields = project(source, source.playerOrder[0]);
    for (const patch of [
      { cardRef: -1 },
      { cardRef: 0.5 },
      { owner: "live-player" },
      { controller: "live-player" },
      { zone: "hand" },
      { identityVisibility: "unknown" },
      { identityVisibility: "public_memory" },
      { faceDown: true },
      { pendingLeaveKind: "destroy" },
      { attachedTo: 1 },
      { attachedChildren: [1] },
      { underCardCount: 1 },
      { normalCoreCount: -1 },
      { soulCoreCount: NaN },
      { minimumRequiredCores: 0.5 },
      { exhaustState: "invalid" },
      { exhausted: true },
      { zoneRoleName: "" },
      { cardNoOrUnknown: "missing" },
    ])
      expect(() =>
        materializeAiSearchFieldInstances(
          [{ ...fields[0], ...patch } as AiSearchCard],
          lookup
        )
      ).toThrow();
    expect(() =>
      materializeAiSearchFieldInstances([fields[0], fields[0]], lookup)
    ).toThrow();
    expect(() =>
      materializeAiSearchFieldInstances([fields[0]], () => definitions[2])
    ).toThrow();
  });
});
