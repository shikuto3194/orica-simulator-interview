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
  cardNo: "SEARCH-COMBINE-HOST",
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
const brave: CardDefinition = {
  ...host,
  cardNo: "SEARCH-COMBINE-BRAVE",
  name: "Brave",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
};
const blocker: CardDefinition = {
  ...host,
  cardNo: "SEARCH-COMBINE-BLOCKER",
  name: "Blocker",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
};
const definitions = [host, brave, blocker];
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
};
const me = AI_SEARCH_WORLD_PLAYERS.me,
  opp = AI_SEARCH_WORLD_PLAYERS.opp;

function project(state: GameState, viewer: string) {
  return projectAiSearchCards(
    buildAiObservation({
      state,
      viewpointPlayerId: viewer,
      getCardDefinitionById: lookup,
    })
  ).filter((card) => card.zone === "field");
}

// Use the real legal-action/combination primitive before observing, rather
// than constructing reciprocal links only in a synthetic projector fixture.
function combinedFixture(seat: number) {
  const players = ["live-first", "live-second"],
    owner = players[seat],
    other = players[1 - seat];
  const base = createEmptyGameState({
    playerIds: players,
    cardInstances: [
      createCardInstance(host, {
        instanceId: "live-host",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(brave, {
        instanceId: "live-brave",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(blocker, {
        instanceId: "live-blocker",
        ownerPlayerId: other,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  const state: GameState = {
    ...base,
    activePlayerId: owner,
    turnNumber: 2,
    step: "main",
    window: "none",
  };
  const combine = getLegalActions({
    state,
    actingPlayerId: owner,
    ...options,
  }).find(
    (action) =>
      action.kind === "brave_combine" &&
      action.braveInstanceId === "live-brave" &&
      action.targetInstanceId === "live-host"
  );
  expect(combine).toBeDefined();
  return {
    state: applyLegalAction({ state, action: combine!, ...options }).state,
    viewer: owner,
  };
}

describe("I1 observed ordinary Brave attachment component", () => {
  // 05_brave-and-attack-special-cases.md: BP and symbols are added to the
  // combined spirit. Verify both through the real engine's final board.
  it.each([0, 1])(
    "reprojects real combination and resolves combined BP and symbols for root seat %s",
    (seat) => {
      const { state: source, viewer } = combinedFixture(seat);
      const fields = project(source, viewer),
        before = structuredClone(fields);
      const { cards, fieldBindings } = materializeAiSearchFieldInstances(
        fields,
        lookup
      );
      const bound = (cardNo: string) =>
        fieldBindings.find(
          (binding) =>
            binding.cardRef ===
            fields.find((card) => card.cardNoOrUnknown === cardNo)!.cardRef
        )!.instanceId;
      const hostId = bound(host.cardNo),
        braveId = bound(brave.cardNo),
        blockerId = bound(blocker.cardNo);
      expect(cards.find((card) => card.instanceId === hostId)).toMatchObject({
        attachedChildrenIds: [braveId],
        normalCoreCount: 2,
      });
      expect(cards.find((card) => card.instanceId === braveId)).toMatchObject({
        attachedToInstanceId: hostId,
        normalCoreCount: 0,
      });
      const base = createEmptyGameState({
        playerIds: [me, opp],
        cardInstances: cards,
      });
      expect(project(base, me)).toEqual(fields);
      expect(
        materializeAiSearchFieldInstances([...fields].reverse(), lookup)
      ).toEqual({ cards, fieldBindings });
      expect(
        getCombinedUnitBp(
          base,
          cards.find((card) => card.instanceId === hostId)!,
          host,
          lookup
        )
      ).toBe(4000);
      for (const shouldBlock of [true, false]) {
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
        const apply = (action: ReturnType<typeof actions>[number]) => {
          world = applyLegalAction({ state: world, action, ...options }).state;
        };
        const attack = actions().find(
          (action) =>
            action.kind === "attack" && action.sourceInstanceId === hostId
        );
        expect(attack).toBeDefined();
        expect(
          actions().some(
            (action) =>
              action.kind === "attack" && action.sourceInstanceId === braveId
          )
        ).toBe(false);
        apply(attack!);
        let blocked = false;
        for (let step = 0; step < 32; step++) {
          const legal = actions();
          const block = shouldBlock
            ? legal.find(
                (action) =>
                  action.kind === "block" &&
                  action.sourceInstanceId === blockerId
              )
            : undefined;
          const action =
            block ??
            legal.find((item) =>
              [
                "pass_pre_declaration_stack",
                "pass_stack",
                "pass_battle_flash",
                "open_battle_flash",
                "decline_block",
              ].includes(item.kind)
            );
          expect(
            action,
            legal.map((item) => item.kind).join(",")
          ).toBeDefined();
          apply(action!);
          if (block) blocked = true;
          if (!world.activeAttack && !world.preDeclarationStackWindow) break;
        }
        expect(blocked).toBe(shouldBlock);
        expect(world.activeAttack).toBeNull();
        expect(world.preDeclarationStackWindow).toBeNull();
        expect(world.stackWindow).toBeNull();
        expect(
          world.cardInstances.find((card) => card.instanceId === hostId)!.zone
        ).toBe("field");
        expect(
          world.cardInstances.find((card) => card.instanceId === braveId)
        ).toMatchObject({
          zone: "field",
          attachedToInstanceId: hostId,
        });
        expect(
          world.cardInstances.find((card) => card.instanceId === blockerId)!
            .zone
        ).toBe(shouldBlock ? "trash" : "field");
        expect(
          world.players.find((player) => player.id === opp)!.lifeNormalCoreCount
        ).toBe(shouldBlock ? 5 : 3);
      }
      expect(fields).toEqual(before);
    }
  );

  it("keeps attachment bindings independent of live IDs and unrelated hidden identities", () => {
    const { state, viewer } = combinedFixture(0);
    state.cardInstances.push(
      createCardInstance(host, {
        instanceId: "secret-hand",
        ownerPlayerId: state.playerOrder[1],
        zone: "hand",
      })
    );
    const fields = project(state, viewer);
    const changed = structuredClone(state),
      rename = (id: string) => `renamed-${id}`;
    for (const card of changed.cardInstances) {
      card.instanceId = rename(card.instanceId);
      card.ownerPlayerId = rename(card.ownerPlayerId);
      card.controllerPlayerId = rename(card.controllerPlayerId);
      if (card.attachedToInstanceId !== null)
        card.attachedToInstanceId = rename(card.attachedToInstanceId);
      card.attachedChildrenIds = card.attachedChildrenIds.map(rename);
      if (card.zone === "hand") {
        card.definitionId = "DIFFERENT-SECRET";
        card.originalDefinitionId = "DIFFERENT-SECRET";
      }
    }
    changed.playerOrder = changed.playerOrder.map(rename);
    changed.activePlayerId = rename(changed.activePlayerId);
    for (const player of changed.players) player.id = rename(player.id);
    const other = project(changed, rename(viewer));
    expect(other).toEqual(fields);
    const result = materializeAiSearchFieldInstances(other, lookup);
    expect(result).toEqual(materializeAiSearchFieldInstances(fields, lookup));
    expect(JSON.stringify(result)).not.toMatch(/live-|renamed-|secret-/);
    const before = structuredClone(other);
    result.cards.find(
      (card) => card.attachedChildrenIds.length
    )!.attachedChildrenIds.length = 0;
    expect(other).toEqual(before);
  });

  it("rejects missing, duplicate, one-sided, self and nested attachment references", () => {
    const { state, viewer } = combinedFixture(0),
      fields = project(state, viewer);
    const h = fields.findIndex((card) => card.cardNoOrUnknown === host.cardNo),
      b = fields.findIndex((card) => card.cardNoOrUnknown === brave.cardNo),
      o = fields.findIndex((card) => card.cardNoOrUnknown === blocker.cardNo);
    const mutations: ((value: AiSearchCard[]) => void)[] = [
      (value) => value.splice(b, 1),
      (value) => value.splice(h, 1),
      (value) => {
        value[h].attachedChildren = [];
      },
      (value) => {
        delete value[b].attachedTo;
      },
      (value) => {
        value[h].attachedChildren = [value[b].cardRef, value[b].cardRef];
      },
      (value) => {
        value[b].attachedTo = value[b].cardRef;
      },
      (value) => {
        value[b].attachedTo = 0.5;
      },
      (value) => {
        value[h].attachedChildren = [NaN];
      },
      (value) => {
        value[h].attachedChildren = [999];
      },
      (value) => {
        value[b].cardNoOrUnknown = host.cardNo;
        // Keep face provenance valid so this case reaches the non-Brave
        // attachment rejection rather than an unrelated face-pair guard.
        value[b].originalCardNo = host.cardNo;
      },
      (value) => {
        value[b].attachedChildren = [value[o].cardRef];
        value[o].attachedTo = value[b].cardRef;
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(fields);
      mutate(changed);
      expect(() => materializeAiSearchFieldInstances(changed, lookup)).toThrow(
        /attachment/
      );
    }
  });
});
