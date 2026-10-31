import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  buildPolicyValueInferenceInput,
  createCardInstance,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  projectAiSearchCards,
  useSetBurstAsAction,
  type AiObservationMode,
  type CardDefinition,
  type Engine,
  type GameState,
  type TrainingDecisionNode,
} from "../src";

const spirit: CardDefinition = {
  cardNo: "AI-SECRET-SPIRIT",
  name: "秘密バースト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  keywordTags: [],
  textLines: ["【バースト：自分のライフ減少後】"],
};
const higherMinimum: CardDefinition = {
  ...spirit,
  cardNo: "AI-SECRET-HIGHER-MINIMUM",
  levelDefs: [{ level: 1, requiredCores: 3, bp: 1000 }],
};
const ultimate: CardDefinition = {
  ...spirit,
  cardNo: "AI-SECRET-ULTIMATE",
  printedCategory: "ultimate",
};
// Both worlds use the same public DB. Only the card actually set is secret.
const definitions = [spirit, higherMinimum, ultimate];
const engine: Engine = {
  cards: definitions,
  getCardDefinitionById: (id) => definitions.find((card) => card.cardNo === id),
  lookups: {} as Engine["lookups"],
};
const node: TrainingDecisionNode = {
  nodeId: "same-public-decision",
  kind: "legal_action",
  actingPlayerId: "alice",
  fields: [],
  choices: [
    {
      choiceId: "advance",
      label: "advance_step",
      systemAction: { kind: "advance_step", actingPlayerId: "alice" },
    },
  ],
  truncated: false,
};

function setBurst(definition: CardDefinition): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "same-hidden-slot",
        ownerPlayerId: "bob",
        zone: "hand",
        cores: 0,
      }),
    ],
  });
  const result = useSetBurstAsAction({
    state: { ...state, activePlayerId: "bob", step: "main" },
    actingPlayerId: "bob",
    sourceInstanceId: "same-hidden-slot",
    getCardDefinitionById: engine.getCardDefinitionById,
  }).state;
  expect(result.setBurstStates).toEqual([
    { playerId: "bob", cardInstanceId: "same-hidden-slot" },
  ]);
  return result;
}

function observe(
  state: GameState,
  viewpointPlayerId = "alice",
  mode: AiObservationMode = "player"
) {
  return buildAiObservation({
    state,
    viewpointPlayerId,
    mode,
    getCardDefinitionById: engine.getCardDefinitionById,
  });
}

describe("AI hidden printed card attributes", () => {
  it.each([
    ["minimum upkeep", higherMinimum],
    ["printed category", ultimate],
  ] as const)(
    "a real burst set does not reveal %s through observation, search or NN",
    (_, differentSecret) => {
      const a = setBurst(spirit);
      const b = setBurst(differentSecret);
      const beforeA = structuredClone(a);
      const beforeB = structuredClone(b);
      const observationA = observe(a);
      const observationB = observe(b);
      expect(observationA.cards[0]).toMatchObject({
        identityVisibility: "unknown",
        cardNoOrUnknown: "UNK_CARD",
      });
      expect.soft(observationA).toEqual(observationB);
      expect
        .soft(projectAiSearchCards(observationA))
        .toEqual(projectAiSearchCards(observationB));
      const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
      const inputB = buildPolicyValueInferenceInput({ state: b, node, engine });
      expect.soft(inputA).toEqual(inputB);
      const network = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
      expect.soft(network.predict(inputA)).toEqual(network.predict(inputB));
      expect(a).toEqual(beforeA);
      expect(b).toEqual(beforeB);
    }
  );

  it.each([
    ["player", "bob"],
    ["debug_perfect", "alice"],
    ["spectator_full", "alice"],
  ] as const)(
    "%s retains permitted printed attributes for %s",
    (mode, viewer) => {
      const a = observe(setBurst(spirit), viewer, mode);
      const b = observe(setBurst(higherMinimum), viewer, mode);
      const c = observe(setBurst(ultimate), viewer, mode);
      expect(a.cards[0]).toMatchObject({
        identityVisibility: "known",
        minimumRequiredCores: 1,
        zoneRoleName: "spirit-card",
      });
      expect(b.cards[0]?.minimumRequiredCores).toBe(3);
      expect(c.cards[0]?.zoneRoleName).toBe("ultimate-card");
      expect(a).not.toEqual(b);
      expect(a).not.toEqual(c);
    }
  );

  it("unknown identity still preserves visible physical state", () => {
    const state = setBurst(higherMinimum);
    const changed: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 2,
        soulCoreCount: 1,
        exhaustState: "exhausted",
      })),
    };
    const hidden = observe(changed);
    expect(hidden.cards[0]).toMatchObject({
      identityVisibility: "unknown",
      normalCoreCount: 2,
      soulCoreCount: 1,
      exhaustState: "exhausted",
      exhausted: true,
    });
    expect(projectAiSearchCards(hidden)).not.toEqual(
      projectAiSearchCards(observe(state))
    );
  });
});
