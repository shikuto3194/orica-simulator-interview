import { describe, expect, it } from "vitest";
import {
  AI_SEARCH_WORLD_PLAYERS,
  applyLegalAction,
  buildAiObservation,
  createCardInstance,
  createEmptyGameState,
  getCombinedUnitBp,
  getLegalActions,
  materializeAiSearchFieldInstances,
  projectAiSearchCards,
  type AiSearchCard,
  type CardDefinition,
  type GameState,
} from "../src";

const host: CardDefinition = {
  cardNo: "SEARCH-IMAGIN-HOST",
  name: "Host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
};
const imagin: CardDefinition = {
  ...host,
  cardNo: "SEARCH-IMAGIN-BRAVE",
  name: "Imagin",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
  imaginBraveData: { sharedCondition: {} },
};
const lookup = (id: string) =>
  [host, imagin].find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function fixture(seat: number, prefix = "live", secret = "SECRET-A") {
  const players = [`${prefix}-first`, `${prefix}-second`];
  const owner = players[seat];
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: players,
      cardInstances: [
        ...["left", "right"].map((side) =>
          createCardInstance(host, {
            instanceId: `${prefix}-${side}`,
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 1,
          })
        ),
        createCardInstance(imagin, {
          instanceId: `${prefix}-brave`,
          ownerPlayerId: owner,
          zone: "field",
        }),
        createCardInstance(
          { ...host, cardNo: secret },
          {
            instanceId: `${prefix}-hidden-hand`,
            ownerPlayerId: players[1 - seat],
            zone: "hand",
          }
        ),
        createCardInstance(
          { ...host, cardNo: secret },
          {
            instanceId: `${prefix}-hidden-deck`,
            ownerPlayerId: players[1 - seat],
            zone: "deck",
          }
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 2,
    step: "main",
    window: "none",
  };
  for (const side of ["left", "right"]) {
    const action = getLegalActions({
      state,
      actingPlayerId: owner,
      ...options,
    }).find(
      (action) =>
        action.kind === "brave_combine" &&
        action.braveInstanceId === `${prefix}-brave` &&
        action.targetInstanceId === `${prefix}-${side}`
    );
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...options }).state;
  }
  return { state, owner, players };
}

function fields(state: GameState, viewer: string) {
  return projectAiSearchCards(
    buildAiObservation({
      state,
      viewpointPlayerId: viewer,
      getCardDefinitionById: lookup,
    })
  ).filter((card) => card.zone === "field");
}

describe("I1 observed Imagin field relationships (partial world)", () => {
  // 08c:23/32 and 05:34-35: independent hosts retain individual BP/symbols.
  it.each([0, 1])(
    "reprojects real dual combination and completes each host's attack for root seat %s",
    (seat) => {
      const { state: source, owner } = fixture(seat);
      const observed = fields(source, owner),
        before = structuredClone(observed);
      const component = materializeAiSearchFieldInstances(observed, lookup);
      expect(
        materializeAiSearchFieldInstances([...observed].reverse(), lookup)
      ).toEqual(component);
      const brave = component.cards.find(
        (card) => card.definitionId === imagin.cardNo
      )!;
      const hostIds = [
        brave.attachedToInstanceId!,
        brave.imaginRightCombinedWith!,
      ];
      expect(new Set(hostIds).size).toBe(2);
      const base = createEmptyGameState({
        playerIds: [me, opp],
        cardInstances: component.cards,
      });
      expect(fields(base, me)).toEqual(observed);
      expect(
        base.cardInstances.find((card) => card.instanceId === hostIds[1])!
          .attachedChildrenIds
      ).toEqual([]);
      for (const hostId of hostIds) {
        expect(
          getCombinedUnitBp(
            base,
            base.cardInstances.find((card) => card.instanceId === hostId)!,
            host,
            lookup
          )
        ).toBe(4000);
        let world: GameState = {
          ...structuredClone(base),
          turnNumber: 2,
          step: "attack",
          window: "none",
        };
        const actions = () =>
          [me, opp].flatMap((actingPlayerId) =>
            getLegalActions({ state: world, actingPlayerId, ...options })
          );
        const attack = actions().find(
          (action) =>
            action.kind === "attack" && action.sourceInstanceId === hostId
        );
        expect(attack).toBeDefined();
        expect(
          actions().some(
            (action) =>
              action.kind === "attack" &&
              action.sourceInstanceId === brave.instanceId
          )
        ).toBe(false);
        world = applyLegalAction({
          state: world,
          action: attack!,
          ...options,
        }).state;
        for (let i = 0; i < 32; i++) {
          const action = actions().find((action) =>
            [
              "pass_pre_declaration_stack",
              "pass_stack",
              "pass_battle_flash",
              "open_battle_flash",
              "decline_block",
            ].includes(action.kind)
          );
          expect(action).toBeDefined();
          world = applyLegalAction({
            state: world,
            action: action!,
            ...options,
          }).state;
          if (!world.activeAttack && !world.preDeclarationStackWindow) break;
        }
        expect(world.activeAttack).toBeNull();
        expect(world.preDeclarationStackWindow).toBeNull();
        expect(world.stackWindow).toBeNull();
        expect(
          world.players.find((player) => player.id === opp)!.lifeNormalCoreCount
        ).toBe(3);
        expect(
          world.cardInstances.find(
            (card) => card.instanceId === brave.instanceId
          )
        ).toMatchObject({
          zone: "field",
          exhaustState: "recovered",
          attachedToInstanceId: hostIds[0],
          imaginRightCombinedWith: hostIds[1],
        });
      }
      expect(observed).toEqual(before);
    }
  );

  it.each([0, 1])(
    "is independent of secret identities and all live IDs for viewer seat %s",
    (seat) => {
      const first = fixture(0),
        second = fixture(0, "renamed", "SECRET-B");
      const a = fields(first.state, first.players[seat]),
        b = fields(second.state, second.players[seat]);
      expect(b).toEqual(a);
      const result = materializeAiSearchFieldInstances(b, lookup);
      expect(result).toEqual(materializeAiSearchFieldInstances(a, lookup));
      expect(JSON.stringify(result)).not.toMatch(/live-|renamed-|SECRET/);
    }
  );

  it("rejects dangling projected references, legacy slots and impossible field graphs", () => {
    const { state, owner } = fixture(0);
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: owner,
      getCardDefinitionById: lookup,
    });
    observation.cards.find(
      (card) => card.cardNoOrUnknown === imagin.cardNo
    )!.imaginRightCombinedWith = "unobserved-secret-id";
    expect(() => projectAiSearchCards(observation)).toThrow(
      "dangling search card reference"
    );
    const observed = fields(state, owner);
    const b = observed.findIndex(
      (card) => card.cardNoOrUnknown === imagin.cardNo
    );
    const right = observed.findIndex(
      (card) => card.cardRef === observed[b].imaginRight
    );
    const mutations: ((value: AiSearchCard[]) => void)[] = [
      (v) => {
        delete v[b].imaginRight;
      },
      (v) => {
        v[b].imaginRight = 999;
      },
      (v) => {
        v[b].imaginRight = 0.5;
      },
      (v) => {
        v[b].imaginRight = v[b].cardRef;
      },
      (v) => {
        v[b].imaginRight = v[b].attachedTo;
      },
      (v) => {
        v[right].imaginRight = v[b].cardRef;
      },
      (v) => {
        v[right].attachedChildren = [v[b].cardRef];
      },
      (v) => {
        v[right].attachedTo = v[b].cardRef;
      },
      (v) => {
        v.push({ ...v[b], cardRef: 999, attachedTo: undefined });
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(observed);
      mutate(changed);
      expect(() => materializeAiSearchFieldInstances(changed, lookup)).toThrow(
        /Imagin|attachment/
      );
    }
  });
});
