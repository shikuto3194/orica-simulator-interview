import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  collectGameStateInvariantIssues,
  executeEffectResistance,
  executeSendToDeck,
  flushPendingLeaves,
  resolveBraveLeaveChoice,
} from "../src";
import type { CardDefinition, GameState, SendToDeckAction } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

function contractSpiritDef(cardNo: string): CardDefinition {
  return {
    ...spiritDef(cardNo),
    keywordTags: ["contract"],
  } as CardDefinition;
}

function braveDef(cardNo: string): CardDefinition {
  return {
    ...spiritDef(cardNo),
    printedCategory: "brave",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  } as CardDefinition;
}

const defs = new Map<string, CardDefinition>([
  ["BSKB01-M02", spiritDef("BSKB01-M02")],
  ["TARGET-SPIRIT", spiritDef("TARGET-SPIRIT")],
  ["TARGET-CONTRACT", contractSpiritDef("TARGET-CONTRACT")],
  ["TARGET-BRAVE", braveDef("TARGET-BRAVE")],
]);

function getDef(id: string): CardDefinition | undefined {
  return defs.get(id);
}

const sendBottomPiercing: SendToDeckAction = {
  kind: "send_to_deck",
  target: {
    selfCard: false,
    player: "opponent",
    count: 1,
    filter: { category: ["spirit", "ultimate"] },
  },
  position: "bottom",
  pierceCannotLeaveField: true,
};

function baseState(cardInstances: GameState["cardInstances"]): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [
      { reserveNormalCoreCount: 3, deckCount: 10 },
      { reserveNormalCoreCount: 3, deckCount: 10 },
    ],
  });
}

function fieldSpirit(instanceId: string, cores = 2) {
  return createCardInstance(getDef("TARGET-SPIRIT")!, {
    instanceId,
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: cores,
  });
}

function fieldContract(instanceId: string, cores = 2) {
  return createCardInstance(getDef("TARGET-CONTRACT")!, {
    instanceId,
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: cores,
  });
}

describe("field-origin send_to_deck pending leave (BSKB01-M02)", () => {
  it("queues bounce pending leave with deck-bottom intent, then flushes to owner deck bottom", () => {
    const state = baseState([
      createCardInstance(getDef("TARGET-SPIRIT")!, {
        instanceId: "bob-existing-deck",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "deck",
      }),
      fieldSpirit("target-1", 2),
    ]);

    const pending = executeSendToDeck(
      state,
      ALICE,
      sendBottomPiercing,
      getDef,
      "BSKB01-M02-source",
      ["target-1"]
    );
    const targetPending = pending.cardInstances.find(
      (card) => card.instanceId === "target-1"
    )!;
    expect(targetPending.zone).toBe("field");
    expect(targetPending.pendingLeaveKind).toBe("bounce");
    expect(pending.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "target-1",
        kind: "bounce",
        leaveDestination: { zone: "deck", position: "bottom" },
        preventStayOnField: true,
      })
    );

    const flushed = flushPendingLeaves(pending, getDef);
    const target = flushed.cardInstances.find(
      (card) => card.instanceId === "target-1"
    )!;
    expect(target.zone).toBe("deck");
    expect(target.controllerPlayerId).toBe(BOB);
    expect(target.pendingLeaveKind).toBeNull();
    expect(
      flushed.cardInstances
        .filter((card) => card.ownerPlayerId === BOB && card.zone === "deck")
        .map((card) => card.instanceId)
    ).toEqual(["bob-existing-deck", "target-1"]);
    expect(flushed.players.find((player) => player.id === BOB)!.deckCount).toBe(
      11
    );
    expect(
      flushed.players.find((player) => player.id === BOB)!
        .reserveNormalCoreCount
    ).toBe(5);
  });

  it("pierces cannot_leave_field but not cannot_be_sent_to_deck", () => {
    let cannotLeave = baseState([fieldSpirit("cannot-leave", 1)]);
    cannotLeave = executeEffectResistance(
      cannotLeave,
      BOB,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "cannot-leave",
      getDef
    );

    const pierced = executeSendToDeck(
      cannotLeave,
      ALICE,
      sendBottomPiercing,
      getDef,
      "BSKB01-M02-source",
      ["cannot-leave"]
    );
    expect(
      pierced.cardInstances.find((card) => card.instanceId === "cannot-leave")
        ?.pendingLeaveKind
    ).toBe("bounce");
    expect(
      pierced.log.some((line) =>
        line.startsWith(
          "effect:send_to_deck:cannot-leave-field-pierced:alice:cannot-leave"
        )
      )
    ).toBe(true);

    let cannotDeck = baseState([fieldSpirit("cannot-deck", 1)]);
    cannotDeck = executeEffectResistance(
      cannotDeck,
      BOB,
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_be_sent_to_deck",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "cannot-deck",
      getDef
    );
    const blocked = executeSendToDeck(
      cannotDeck,
      ALICE,
      sendBottomPiercing,
      getDef,
      "BSKB01-M02-source",
      ["cannot-deck"]
    );
    expect(
      blocked.cardInstances.find((card) => card.instanceId === "cannot-deck")
        ?.pendingLeaveKind
    ).toBeNull();
  });

  it("opens brave leave choice before deck-bottom flush and preserves either choice", () => {
    const host = fieldSpirit("host-1", 2);
    host.attachedChildrenIds = ["brave-1"];
    const brave = createCardInstance(getDef("TARGET-BRAVE")!, {
      instanceId: "brave-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const existingDeck = createCardInstance(getDef("TARGET-SPIRIT")!, {
      instanceId: "bob-existing-deck",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "deck",
    });
    const pending = executeSendToDeck(
      baseState([existingDeck, host, brave]),
      ALICE,
      sendBottomPiercing,
      getDef,
      "BSKB01-M02-source",
      ["host-1"]
    );
    const awaitingChoice = flushPendingLeaves(pending, getDef);
    expect(awaitingChoice.pendingBraveLeaveChoice).toMatchObject({
      hostInstanceId: "host-1",
      braveInstanceIds: ["brave-1"],
      leaveKind: "bounce",
      leaveDestination: { zone: "deck", position: "bottom" },
    });

    const kept = flushPendingLeaves(
      resolveBraveLeaveChoice(awaitingChoice, "keep"),
      getDef
    );
    expect(
      kept.cardInstances.find((card) => card.instanceId === "host-1")?.zone
    ).toBe("deck");
    expect(
      kept.cardInstances.find((card) => card.instanceId === "brave-1")?.zone
    ).toBe("field");

    const sent = flushPendingLeaves(
      resolveBraveLeaveChoice(awaitingChoice, "send_with_host"),
      getDef
    );
    expect(
      sent.cardInstances.find((card) => card.instanceId === "host-1")?.zone
    ).toBe("deck");
    expect(
      sent.cardInstances.find((card) => card.instanceId === "brave-1")?.zone
    ).toBe("deck");
    expect(
      sent.cardInstances
        .filter((card) => card.ownerPlayerId === BOB && card.zone === "deck")
        .map((card) => card.instanceId)
    ).toEqual(["bob-existing-deck", "host-1", "brave-1"]);
  });

  it("preventStayOnField suppresses contract soul-state replacement and flushes to deck bottom", () => {
    const state = {
      ...baseState([
        createCardInstance(getDef("TARGET-SPIRIT")!, {
          instanceId: "bob-existing-deck",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "deck",
        }),
        fieldContract("contract-1", 2),
      ]),
      players: baseState([]).players.map((player) =>
        player.id === BOB
          ? { ...player, contractCardNo: "TARGET-CONTRACT" }
          : player
      ),
    };

    const pending = executeSendToDeck(
      state,
      ALICE,
      sendBottomPiercing,
      getDef,
      "BSKB01-M02-source",
      ["contract-1"]
    );
    expect(pending.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "contract-1",
        preventStayOnField: true,
        leaveDestination: { zone: "deck", position: "bottom" },
      })
    );

    const flushed = flushPendingLeaves(pending, getDef);
    const contract = flushed.cardInstances.find(
      (card) => card.instanceId === "contract-1"
    )!;
    expect(flushed.pendingSoulStateReplacement).toBeNull();
    expect(
      flushed.players.find((player) => player.id === BOB)!.soulStateInstanceIds
    ).not.toContain("contract-1");
    expect(contract.zone).toBe("deck");
    expect(contract.pendingLeaveKind).toBeNull();
    expect(
      flushed.cardInstances
        .filter((card) => card.ownerPlayerId === BOB && card.zone === "deck")
        .map((card) => card.instanceId)
    ).toEqual(["bob-existing-deck", "contract-1"]);
  });
});

describe("non-field send_to_deck counter synchronization", () => {
  it("EDH-0005: hand-to-deck updates both handCount and deckCount", () => {
    const handCard = createCardInstance(getDef("TARGET-SPIRIT")!, {
      instanceId: "alice-hand-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const existingDeckCard = createCardInstance(getDef("TARGET-SPIRIT")!, {
      instanceId: "alice-deck-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard, existingDeckCard],
      playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
    });
    const result = executeSendToDeck(
      state,
      ALICE,
      {
        kind: "send_to_deck",
        target: {
          player: "self",
          count: 1,
          category: ["spirit"],
          zone: ["hand"],
        },
        position: "bottom",
      },
      getDef,
      "source"
    );

    const alice = result.players.find((player) => player.id === ALICE)!;
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === handCard.instanceId
      )?.zone
    ).toBe("deck");
    expect(alice.handCount).toBe(0);
    expect(alice.deckCount).toBe(2);
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });
});
