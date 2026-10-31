import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  materializeAiSearchFieldInstances,
  projectAiSearchCards,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  executeBounce,
  executeRebirth,
  executeReverseRebirth,
} from "../src/effect/structured-effect-interpreter";

const front: CardDefinition = {
  cardNo: "SEARCH-FACE-A",
  name: "公開A面",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  isDoubleSided: true,
  backFace: {
    cardNo: "SEARCH-FACE-B",
    name: "公開B面",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    symbolColors: ["blue"],
    textLines: [],
  },
};
const definitions = expandCardDefinitionsWithBackFaces([front]);
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function observe(state: GameState, viewer: string) {
  return projectAiSearchCards(
    buildAiObservation({
      state,
      viewpointPlayerId: viewer,
      getCardDefinitionById: lookup,
    })
  );
}

function reborn() {
  const state = createEmptyGameState({
    playerIds: ["live-first", "live-second"],
    cardInstances: [
      createCardInstance(front, {
        instanceId: "live-rebirth",
        ownerPlayerId: "live-first",
        zone: "field",
        normalCoreCount: 2,
        exhaustState: "exhausted",
      }),
    ],
  });
  return executeRebirth(
    state,
    "live-first",
    {
      kind: "rebirth",
      maxCount: 5,
      triggerDescription: "",
      countBonusMode: "none",
    },
    "live-rebirth",
    lookup,
    "test:search-field-faces"
  );
}

describe("I1 observed field original face (partial world)", () => {
  it.each([0, 1])(
    "reprojects actual rebirth and completes reverse flip and field exit for root seat %s",
    (seat) => {
      const source = reborn();
      expect(source.cardInstances[0]).toMatchObject({
        definitionId: front.backFace!.cardNo,
        originalDefinitionId: front.cardNo,
      });
      const observed = observe(source, source.playerOrder[seat]);
      expect(observed).toHaveLength(1);
      expect(observed[0]).toMatchObject({
        cardNoOrUnknown: front.backFace!.cardNo,
        originalCardNo: front.cardNo,
        effectiveBp: 6000,
        effectiveColors: ["blue"],
      });
      const before = structuredClone(observed);
      const dbBefore = structuredClone(definitions);
      const { cards } = materializeAiSearchFieldInstances(observed, lookup);
      const world = createEmptyGameState({
        playerIds: [me, opp],
        cardInstances: cards,
      });
      expect(observe(world, me)).toEqual(observed);
      expect(cards[0].instanceId).not.toBe("live-rebirth");
      const owner = seat === 0 ? me : opp;
      const reversed = executeReverseRebirth(
        world,
        owner,
        { kind: "reverse_rebirth", mode: "flip" },
        cards[0].instanceId,
        lookup
      );
      expect(reversed.cardInstances[0]).toMatchObject({
        definitionId: front.cardNo,
        originalDefinitionId: front.cardNo,
        instanceId: cards[0].instanceId,
        zone: "field",
        normalCoreCount: 2,
        exhaustState: "exhausted",
      });
      expect(reversed.players.map((player) => player.countValue)).toEqual(
        world.players.map((player) => player.countValue)
      );
      expect(observe(reversed, me)[0]).toMatchObject({
        cardNoOrUnknown: front.cardNo,
        originalCardNo: front.cardNo,
        effectiveBp: 1000,
        effectiveColors: ["red"],
      });
      // Separate continuation from the same B-face world: the common leave
      // pipeline, not a manual definitionId assignment, must restore A.
      const bounced = executeBounce(
        world,
        owner,
        {
          kind: "bounce",
          target: { player: "self", category: ["spirit"], count: 1 },
        },
        lookup,
        undefined,
        [cards[0].instanceId]
      );
      expect(bounced.cardInstances[0].pendingLeaveKind).toBe("bounce");
      const exited = flushPendingLeaves(bounced, lookup);
      expect(exited.cardInstances[0]).toMatchObject({
        definitionId: front.cardNo,
        originalDefinitionId: front.cardNo,
        zone: "hand",
        normalCoreCount: 0,
        pendingLeaveKind: null,
      });
      expect(exited.pendingLeaveEntities).toEqual([]);
      expect(
        exited.players.find((player) => player.id === owner)!.handCount
      ).toBe(
        world.players.find((player) => player.id === owner)!.handCount + 1
      );
      expect(observed).toEqual(before);
      expect(definitions).toEqual(dbBefore);
    }
  );

  it.each([0, 1])(
    "does not expose concealed original faces or live identities for root seat %s",
    (seat) => {
      const a = reborn(),
        b = reborn();
      const viewer = a.playerOrder[seat],
        other = a.playerOrder[1 - seat];
      const addSecrets = (state: GameState, secret: string) => {
        for (const zone of ["hand", "deck", "burst", "field"] as const) {
          const hidden = createCardInstance(front, {
            instanceId: `${secret}-${zone}`,
            ownerPlayerId: other,
            zone,
            faceDown: zone === "field" || zone === "burst",
          });
          hidden.definitionId = `${secret}-current`;
          hidden.originalDefinitionId = `${secret}-original`;
          state.cardInstances.push(hidden);
        }
      };
      addSecrets(a, "private-A");
      addSecrets(b, "private-B");
      b.cardInstances[0].instanceId = "renamed-public-card";
      const projected = observe(a, viewer);
      expect(observe(b, viewer)).toEqual(projected);
      for (const card of projected.filter(
        (card) => card.identityVisibility === "unknown"
      ))
        expect(card.originalCardNo).toBeUndefined();
      expect(JSON.stringify(projected)).not.toMatch(
        /private-A|private-B|live-rebirth|renamed-public-card/
      );
      expect(
        materializeAiSearchFieldInstances(
          projected.filter((card) => !card.faceDown),
          lookup
        )
      ).toEqual(
        materializeAiSearchFieldInstances(
          observe(b, viewer).filter((card) => !card.faceDown),
          lookup
        )
      );
    }
  );

  it("rejects missing or inconsistent original faces without guessing legacy B-face provenance", () => {
    const card = observe(reborn(), "live-first")[0];
    const legacy = { ...card };
    delete legacy.originalCardNo;
    expect(() => materializeAiSearchFieldInstances([legacy], lookup)).toThrow(
      "missing observed field original face"
    );
    for (const originalCardNo of ["", "missing"]) {
      const bad = { ...card, originalCardNo };
      expect(() => materializeAiSearchFieldInstances([bad], lookup)).toThrow(
        /original face/
      );
    }
    const unrelated = {
      ...front,
      cardNo: "SEARCH-FACE-UNRELATED",
      isDoubleSided: false,
    };
    expect(() =>
      materializeAiSearchFieldInstances(
        [{ ...card, originalCardNo: unrelated.cardNo }],
        (id) => (id === unrelated.cardNo ? unrelated : lookup(id))
      )
    ).toThrow(/original face/);
  });

  it("uses the engine's public back-face definition convention when the back-face number is omitted", () => {
    const fallback = structuredClone(front);
    delete fallback.backFace!.cardNo;
    const db = expandCardDefinitionsWithBackFaces([fallback]);
    const get = (id: string) => db.find((card) => card.cardNo === id);
    const state = createEmptyGameState({
      playerIds: [me, opp],
      cardInstances: [
        createCardInstance(fallback, {
          instanceId: "fallback-front",
          ownerPlayerId: me,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    const flipped = executeRebirth(
      state,
      me,
      {
        kind: "rebirth",
        maxCount: 5,
        triggerDescription: "",
        countBonusMode: "none",
      },
      "fallback-front",
      get,
      "test:search-fallback-face"
    );
    const projected = projectAiSearchCards(
      buildAiObservation({
        state: flipped,
        viewpointPlayerId: me,
        getCardDefinitionById: get,
      })
    );
    expect(projected[0].cardNoOrUnknown).toBe(`${fallback.cardNo}_back`);
    expect(
      materializeAiSearchFieldInstances(projected, get).cards[0]
    ).toMatchObject({
      definitionId: `${fallback.cardNo}_back`,
      originalDefinitionId: fallback.cardNo,
    });
  });
});
