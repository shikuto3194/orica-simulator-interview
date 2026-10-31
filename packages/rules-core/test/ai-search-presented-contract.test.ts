import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyTrainingDecisionChoice,
  buildAiObservation,
  collectKnownCardNosFromAiObservation,
  createCardInstance,
  createEmptyGameState,
  encodeAiObservation,
  getNextTrainingDecision,
  initializeGame,
  materializeAiSearchFieldInstances,
  materializeAiSearchPlayerResources,
  projectAiSearchCards,
  projectAiSearchDeckKnowledge,
  projectAiSearchPlayerResources,
  type AiObservation,
  type CardDefinition,
  type Engine,
  type GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { replaceCardInstances } from "../src/zone/card-instance-state";

const normal: CardDefinition = {
  cardNo: "SEARCH-CONTRACT-NORMAL",
  name: "公開通常カード",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  keywordTags: [],
  textLines: [],
  maxDeckCount: 40,
};
const contracts: CardDefinition[] = (["green", "red"] as const).map(
  (color) => ({
    ...normal,
    cardNo: `SEARCH-CONTRACT-${color}`,
    name: `公開契約${color}`,
    colors: [color],
    keywordTags: ["contract"],
    maxDeckCount: 3,
  })
);
const evil = ALL_CARDS.find((card) => card.cardNo === "BSGE01-C07")!;
const definitions = [normal, ...contracts, evil];
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const engine: Engine = {
  cards: definitions,
  getCardDefinitionById: lookup,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function fixture() {
  return initializeGame({
    playerIds: ["live-alice", "live-bob"],
    decks: contracts.map((contract) => [
      contract,
      ...Array<CardDefinition>(39).fill(normal),
    ]) as [CardDefinition[], CardDefinition[]],
    preserveDeckOrder: true,
  });
}
function observe(state: GameState, viewer = state.playerOrder[0]) {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: lookup,
  });
}
function present(state: GameState, choices: readonly boolean[]) {
  for (const accept of choices) {
    const node = getNextTrainingDecision(state, engine)!;
    expect(node.preGamePhase).toBe("waiting_contract");
    const choice = node.choices.find(
      (choice) =>
        choice.preGameChoice?.kind === "contract_presentation" &&
        choice.preGameChoice.present === accept
    )!;
    expect(choice).toBeDefined();
    state = applyTrainingDecisionChoice(state, node, choice, engine);
  }
  expect(state.preGame?.phase).toBe("contract_confirm");
  return state;
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
  return {
    resources,
    players,
    field,
    cards,
    world: createEmptyGameState({
      playerIds: [me, opp],
      playerOverrides: players,
      cardInstances: field.cards,
    }),
  };
}

describe("I1 public contract presentation (partial player component)", () => {
  it.each([0, 1])(
    "root %s never projects the private candidate or an uncommitted presentation",
    (seat) => {
      const source = fixture(),
        viewer = source.playerOrder[seat];
      const first = observe(source, viewer);
      expect(source.preGame?.contractCandidateCardNos).toEqual({
        "live-alice": contracts[0]!.cardNo,
        "live-bob": contracts[1]!.cardNo,
      });
      expect(first.players.map((player) => player.contractCardNo)).toEqual([
        null,
        null,
      ]);
      expect(collectKnownCardNosFromAiObservation(first)).toEqual([]);
      const otherCandidate = structuredClone(source);
      const opponent = source.playerOrder[1 - seat];
      otherCandidate.preGame!.contractCandidateCardNos![opponent] =
        normal.cardNo;
      expect(observe(otherCandidate, viewer)).toEqual(first);
      const node = getNextTrainingDecision(source, engine)!;
      const oneChoice = applyTrainingDecisionChoice(
        source,
        node,
        node.choices[0]!,
        engine
      );
      expect(oneChoice.preGame?.contractPresentationChoices).toEqual({
        "live-alice": true,
      });
      expect(observe(oneChoice, viewer)).toEqual(first);
    }
  );

  it.each(
    [0, 1].flatMap((seat) => [false, true].map((accept) => ({ seat, accept })))
  )(
    "root $seat preserves presentation=$accept after dealing and executes the real color branch for both owners",
    ({ seat, accept }) => {
      const dealt = present(fixture(), [accept, accept]);
      let source = replaceCardInstances(dealt, [
        ...dealt.cardInstances,
        ...dealt.playerOrder.map((ownerPlayerId) =>
          createCardInstance(evil, {
            instanceId: `${ownerPlayerId}-evil`,
            ownerPlayerId,
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ]);
      const viewer = source.playerOrder[seat],
        observation = observe(source, viewer),
        input = project(observation),
        before = structuredClone(input);
      for (const [index, owner] of [me, opp].entries()) {
        const liveSeat = index === 0 ? seat : 1 - seat,
          liveOwner = source.playerOrder[liveSeat],
          contractCardNo = accept ? contracts[liveSeat]!.cardNo : null;
        expect(input.players[index]!.contractCardNo).toBe(contractCardNo);
        expect(
          source.cardInstances.filter(
            (card) => card.ownerPlayerId === liveOwner && card.zone === "hand"
          )
        ).toHaveLength(4);
        expect(
          observation.cards
            .filter(
              (card) => card.ownerPlayerId === liveOwner && card.zone === "hand"
            )
            .every((card) => index === 0 || card.cardNoOrUnknown === "UNK_CARD")
        ).toBe(true);
        const sourceId = input.world.cardInstances.find(
          (card) => card.ownerPlayerId === owner
        )!.instanceId;
        const green = accept && liveSeat === 0;
        for (const [state, id, actor] of [
          [source, `${liveOwner}-evil`, liveOwner],
          [input.world, sourceId, owner],
        ] as const) {
          expect(
            evaluateCondition(
              state,
              [{ kind: "no_presented_contract_card", player: "self" }],
              id,
              actor,
              lookup
            )
          ).toBe(!accept);
          const after = executeEffect({
            chainId: `test:search-presentation:${owner}`,
            state,
            effect: evil.effects![2]!,
            sourceInstanceId: id,
            actingPlayerId: actor,
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: () => [],
          });
          const prior = state.players.find((player) => player.id === actor)!,
            actual = after.players.find((player) => player.id === actor)!;
          expect(actual.reserveNormalCoreCount).toBe(
            prior.reserveNormalCoreCount + (green ? 2 : 0)
          );
          expect(actual.voidNormalCoreCount).toBe(
            prior.voidNormalCoreCount - (green ? 2 : 0)
          );
          expect(actual.contractCardNo).toBe(contractCardNo);
          expect(after.pendingCoreDistribution).toBeNull();
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
      expect(input).toEqual(before);
      source = { ...source, preGame: null };
      expect(projectAiSearchPlayerResources(observe(source, viewer))).toEqual(
        input.resources
      );
    }
  );

  it.each([0, 1])(
    "root %s keeps public contracts while hidden identities/order/IDs do not affect resources or NN input",
    (seat) => {
      const source = present(fixture(), [true, true]),
        viewer = source.playerOrder[seat],
        changed = structuredClone(source);
      for (const card of changed.cardInstances) {
        card.instanceId = `secret-${card.instanceId}`;
        if (card.zone === "deck" || card.ownerPlayerId !== viewer) {
          card.definitionId = normal.cardNo;
          card.originalDefinitionId = normal.cardNo;
        }
      }
      const hiddenIndices = changed.cardInstances.flatMap((card, i) =>
        card.zone === "deck" || card.ownerPlayerId !== viewer ? [i] : []
      );
      const reordered = hiddenIndices
        .map((i) => changed.cardInstances[i]!)
        .reverse();
      hiddenIndices.forEach((i, n) => {
        changed.cardInstances[i] = reordered[n]!;
      });
      // Candidates no longer authorize disclosure of any live hand/deck ID.
      source.preGame = changed.preGame = null;
      const first = observe(source, viewer),
        second = observe(changed, viewer);
      expect(projectAiSearchPlayerResources(second)).toEqual(
        projectAiSearchPlayerResources(first)
      );
      expect(collectKnownCardNosFromAiObservation(second)).toEqual(
        collectKnownCardNosFromAiObservation(first)
      );
      // Use stable public card vocabulary, as production inference does.
      const vocabulary = new Map(
        definitions.map((card, i) => [card.cardNo, i + 1])
      );
      const encode = (observation: AiObservation) =>
        encodeAiObservation({ observation, cardVocabulary: vocabulary });
      const tensors = (observation: AiObservation) => {
        const encoded = encode(observation);
        return {
          global: encoded.global,
          cards: encoded.cards.map((card) => ({
            embIndex: card.embIndex,
            features: card.features,
            mask: card.mask,
          })),
          cardMask: encoded.cardMask,
          knownDeck: encoded.knownDeck,
          knownDeckMask: encoded.knownDeckMask,
        };
      };
      expect(tensors(second)).toEqual(tensors(first));
      expect(encode(second).observationSchemaVersion).toBe(2);
      const absent = structuredClone(first);
      absent.players.find(
        (player) => player.playerId !== viewer
      )!.contractCardNo = null;
      expect(encode(absent).global).not.toEqual(encode(first).global);
    }
  );

  it("rejects v1 observations and missing/malformed/unknown/noncontract presentations without guessing", () => {
    const source = present(fixture(), [true, true]),
      observation = observe(source),
      input = project(observation);
    const old = {
      ...observation,
      schemaVersion: 1,
    } as unknown as AiObservation;
    expect(() => projectAiSearchPlayerResources(old)).toThrow(
      /player observation/
    );
    expect(() => projectAiSearchDeckKnowledge(old)).toThrow(
      /player observation/
    );
    expect(() => encodeAiObservation({ observation: old })).toThrow(
      /schemaVersion/
    );
    for (const value of [undefined, "", "UNK_CARD", 7] as const) {
      const bad = structuredClone(observation);
      bad.players[0]!.contractCardNo = value as never;
      expect(() => projectAiSearchPlayerResources(bad)).toThrow(/presentation/);
    }
    for (const value of [undefined, "", "UNK_CARD", "MISSING", normal.cardNo]) {
      const bad = structuredClone(input.resources);
      bad[0]!.contractCardNo = value as never;
      expect(() =>
        materializeAiSearchPlayerResources(
          bad,
          input.field,
          input.cards,
          lookup
        )
      ).toThrow(/contract|presentation/);
    }
    expect(() =>
      materializeAiSearchPlayerResources(
        input.resources,
        input.field,
        input.cards,
        () => normal
      )
    ).toThrow(/contract/);
  });
});
