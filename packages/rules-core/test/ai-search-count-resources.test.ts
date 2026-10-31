import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  materializeAiSearchFieldInstances,
  materializeAiSearchPlayerResources,
  projectAiSearchCards,
  projectAiSearchPlayerResources,
  type AiObservation,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  evaluateCondition,
  executeCountDecrease,
  executeCountIncrease,
} from "../src/effect/structured-effect-interpreter";

const definitions: CardDefinition[] = ["神喰", "幻想"].map((tribe, i) => ({
  cardNo: `SEARCH-COUNT-${i}`,
  name: tribe,
  tribe,
  printedCategory: "spirit",
  cost: 0,
  colors: ["red"],
  symbolColors: ["red"],
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  keywordTags: [],
  textLines: [],
}));
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function fixture() {
  let state = createEmptyGameState({
    playerIds: ["live-alice", "live-bob"],
    startingDeckCount: 0,
    playerOverrides: [{ handCount: 0 }, { handCount: 0 }],
    cardInstances: ["live-alice", "live-bob"].flatMap((ownerPlayerId) =>
      definitions.map((definition, i) =>
        createCardInstance(definition, {
          instanceId: `${ownerPlayerId}-${i}`,
          ownerPlayerId,
          zone: "field",
          normalCoreCount: 1,
        })
      )
    ),
  });
  for (const [seat, owner] of state.playerOrder.entries()) {
    state = executeCountIncrease(state, owner, "self", 2);
    state = executeCountIncrease(state, owner, "self", 3 + seat, "神喰");
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
  const world = createEmptyGameState({
    playerIds: [me, opp],
    cardInstances: field.cards,
    playerOverrides: players,
  });
  return { resources, players, world, field, cards };
}

describe("I1 observed count resources (partial world)", () => {
  it.each([0, 1])(
    "root %s preserves public count, source-sensitive conditions and resolved decreases for both owners",
    (seat) => {
      const source = fixture(),
        observation = observe(source, source.playerOrder[seat]),
        input = project(observation),
        before = structuredClone(input.resources);
      for (const [index, owner] of [me, opp].entries()) {
        const liveOwner = source.playerOrder[index === 0 ? seat : 1 - seat];
        const expected = source.players.find(
          (player) => player.id === liveOwner
        )!;
        expect(input.players[index]).toMatchObject({
          countValue: expected.countValue,
          protectedCounts: expected.protectedCounts,
        });
        for (const [i, definition] of definitions.entries()) {
          const id = input.world.cardInstances.find(
            (card) =>
              card.ownerPlayerId === owner &&
              card.definitionId === definition.cardNo
          )!.instanceId;
          expect(
            evaluateCondition(
              input.world,
              [{ kind: "count_value", player: "self", min: 3 }],
              id,
              owner,
              lookup
            )
          ).toBe(i === 0);
          const after = executeCountDecrease(input.world, owner, "self", 99, [
            definition.tribe!,
          ]);
          const liveAfter = executeCountDecrease(
            source,
            liveOwner,
            "self",
            99,
            [definition.tribe!]
          );
          const actual = after.players.find((player) => player.id === owner)!;
          const reference = liveAfter.players.find(
            (player) => player.id === liveOwner
          )!;
          expect(actual.countValue).toBe(reference.countValue);
          expect(actual.countValue).toBe(i === 0 ? 0 : expected.countValue - 2);
          expect(actual.protectedCounts).toEqual(reference.protectedCounts);
          expect(after.players.find((player) => player.id !== owner)).toEqual(
            input.world.players.find((player) => player.id !== owner)
          );
          expect(
            projectAiSearchPlayerResources(observe(after, me))[index]!
              .countValue
          ).toBe(actual.countValue);
        }
      }
      expect(projectAiSearchPlayerResources(observe(input.world, me))).toEqual(
        input.resources
      );
      expect(projectAiSearchPlayerResources(observe(input.world, opp))).toEqual(
        [...input.resources].reverse().map((entry) => ({
          ...entry,
          owner: entry.owner === "me" ? "opp" : "me",
        }))
      );
      expect(input.resources).toEqual(before);
      source.players[seat]!.protectedCounts!.神喰 = 0;
      expect(project(observation).resources).toEqual(before);
    }
  );

  it.each([0, 1])(
    "root %s preserves multi-bucket consumption order and later source-sensitive conditions",
    (seat) => {
      for (const tribes of [
        ["神喰", "幻想"],
        ["幻想", "神喰"],
      ]) {
        let source = fixture();
        for (const owner of source.playerOrder) {
          source = executeCountDecrease(source, owner, "self", 99, tribes);
          for (const tribe of tribes)
            source = executeCountIncrease(source, owner, "self", 3, tribe);
        }
        const input = project(observe(source, source.playerOrder[seat]));
        for (const [index, owner] of [me, opp].entries()) {
          const liveOwner = source.playerOrder[index === 0 ? seat : 1 - seat];
          expect(Object.entries(input.players[index]!.protectedCounts)).toEqual(
            tribes.map((tribe) => [tribe, 3])
          );
          const liveAfter = executeCountDecrease(
            source,
            liveOwner,
            "self",
            2,
            tribes
          );
          const after = executeCountDecrease(
            input.world,
            owner,
            "self",
            2,
            tribes
          );
          const actual = after.players.find((player) => player.id === owner)!;
          const reference = liveAfter.players.find(
            (player) => player.id === liveOwner
          )!;
          expect(actual.countValue).toBe(4);
          expect(actual.countValue).toBe(reference.countValue);
          expect(Object.entries(actual.protectedCounts!)).toEqual(
            Object.entries(reference.protectedCounts!)
          );
          expect(Object.entries(actual.protectedCounts!)).toEqual([
            [tribes[0], 1],
            [tribes[1], 3],
          ]);
          for (const definition of definitions) {
            const syntheticId = after.cardInstances.find(
              (card) =>
                card.ownerPlayerId === owner &&
                card.definitionId === definition.cardNo
            )!.instanceId;
            const liveId = liveAfter.cardInstances.find(
              (card) =>
                card.ownerPlayerId === liveOwner &&
                card.definitionId === definition.cardNo
            )!.instanceId;
            const condition = [
              { kind: "count_value" as const, player: "self" as const, min: 3 },
            ];
            const actualCondition = evaluateCondition(
              after,
              condition,
              syntheticId,
              owner,
              lookup
            );
            expect(actualCondition).toBe(
              evaluateCondition(liveAfter, condition, liveId, liveOwner, lookup)
            );
            expect(actualCondition).toBe(definition.tribe === tribes[1]);
          }
          expect(
            projectAiSearchPlayerResources(observe(after, me))[index]!
              .protectedCounts
          ).toEqual(reference.protectedCounts);
          expect(after.players.find((player) => player.id !== owner)).toEqual(
            input.world.players.find((player) => player.id !== owner)
          );
        }
      }
    }
  );

  it("keeps hidden identities, order and real instance IDs out of the count component", () => {
    const source = fixture();
    source.cardInstances.push(
      ...["hand", "deck"].map((zone, index) =>
        createCardInstance(definitions[index]!, {
          ownerPlayerId: "live-bob",
          zone: zone as "hand" | "deck",
          instanceId: `secret-${index}`,
        })
      )
    );
    const changed = structuredClone(source);
    changed.cardInstances.reverse();
    // Keep public field ordering fixed: only the secret cards change position.
    changed.cardInstances = [
      ...source.cardInstances
        .filter((card) => card.zone === "field")
        .map((card) => ({ ...card, instanceId: `renamed-${card.instanceId}` })),
      ...changed.cardInstances
        .filter((card) => card.zone !== "field")
        .map((card) => ({
          ...card,
          definitionId: definitions[1]!.cardNo,
          instanceId: `renamed-${card.instanceId}`,
        })),
    ];
    for (const viewer of source.playerOrder)
      expect(project(observe(changed, viewer)).resources).toEqual(
        project(observe(source, viewer)).resources
      );
  });

  it.each([
    undefined,
    null,
    [],
    { 神喰: -1 },
    { 神喰: 0.5 },
    { 神喰: Number.NaN },
    { 神喰: 6 },
    { 神喰: 3, 幻想: 3 },
    { "": 1 },
    Object.create({ 神喰: 3 }),
  ])(
    "rejects missing/invalid protection at projection and materialization (%#)",
    (invalid) => {
      const observation = observe(fixture(), "live-alice");
      const input = project(observation);
      const malformed = {
        ...observation,
        players: observation.players.map((player, i) =>
          i === 0 ? { ...player, protectedCounts: invalid } : player
        ),
      } as AiObservation;
      expect(() => projectAiSearchPlayerResources(malformed)).toThrow(
        /count protection/
      );
      const resources = input.resources.map((entry, i) =>
        i === 0 ? { ...entry, protectedCounts: invalid } : entry
      ) as typeof input.resources;
      expect(() =>
        materializeAiSearchPlayerResources(
          resources,
          input.field,
          input.cards,
          lookup
        )
      ).toThrow(/count protection/);
    }
  );

  it("rejects protection accessors without invoking them", () => {
    let calls = 0;
    const input = project(observe(fixture(), "live-alice"));
    const protectedCounts = Object.defineProperty({}, "神喰", {
      get() {
        calls++;
        return 3;
      },
    });
    const resources = [
      { ...input.resources[0]!, protectedCounts },
      input.resources[1]!,
    ];
    expect(() =>
      materializeAiSearchPlayerResources(
        resources,
        input.field,
        input.cards,
        lookup
      )
    ).toThrow(/count protection/);
    expect(calls).toBe(0);
  });
});
