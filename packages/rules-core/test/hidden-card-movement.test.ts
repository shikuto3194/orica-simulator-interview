import { describe, expect, it } from "vitest";
import { ALL_CARDS as allCards } from "@orica/card-data";
import {
  appendPublicDisclosure,
  appendPublicDisclosuresForEffectStepTransition,
  appendPublicDisclosuresForStateTransition,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeShuffleZone,
  sanitizeStateForViewer,
} from "../src";
import type { Zone } from "../src";

const definition = allCards.find((card) => card.cardNo === "BSRK01-C03")!;

describe("非公開カードの移動通知と既知位置", () => {
  it("ドローの重複除外で別カードのデッキからの破棄を消さない", () => {
    const cards = ["discarded", "drawn"].map((instanceId) =>
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    });
    const after = appendPublicDisclosure(
      {
        ...before,
        cardInstances: cards.map((card, index) => ({
          ...card,
          zone: index === 0 ? ("trash" as const) : ("hand" as const),
        })),
      },
      {
        turnNumber: before.turnNumber,
        step: before.step,
        actorPlayerId: "alice",
        audience: "both",
        kind: "zone_moved",
        targets: [],
        results: [
          {
            kind: "hand_delta",
            playerId: "alice",
            amount: 1,
            actionLabel: "draw",
          },
        ],
      }
    );
    const result = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });
    expect(result.publicDisclosures.flatMap((entry) => entry.results)).toEqual([
      expect.objectContaining({ kind: "hand_delta", amount: 1 }),
      expect.objectContaining({
        kind: "card_move",
        instanceId: "discarded",
        from: "deck",
        to: "trash",
      }),
    ]);
  });

  it.each([
    ["deck", "hand"],
    ["deck", "burst"],
    ["deck", "field"],
    ["hand", "burst"],
    ["hand", "field"],
    ["burst", "hand"],
    ["field", "hand"],
  ] as const)("非公開の %s → %s は匿名画像用の移動事実を残す", (from, to) => {
    const card = createCardInstance(definition, {
      instanceId: "hidden-move",
      ownerPlayerId: "alice",
      zone: from,
      ...(from === "field" ? { faceDown: true } : {}),
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    const moved = appendPublicDisclosuresForStateTransition({
      before,
      actorPlayerId: "alice",
      after: {
        ...before,
        cardInstances: [{ ...card, zone: to, faceDown: to === "field" }],
      },
    });
    for (const viewer of ["alice", "bob", null]) {
      const entries = sanitizeStateForViewer(moved, viewer).publicDisclosures;
      expect(entries.flatMap((entry) => entry.results)).toEqual([
        expect.objectContaining({
          kind: "hidden_card_move",
          from,
          to,
          count: 1,
        }),
      ]);
      expect(JSON.stringify(entries)).not.toContain(definition.cardNo);
      expect(JSON.stringify(entries)).not.toContain(card.instanceId);
    }
  });
  it.each(["hand", "burst", "field"] as const)(
    "%s からの非公開デッキ戻しは両者に匿名通知し、本人だけ位置を知る",
    (zone) => {
      const card = createCardInstance(definition, {
        instanceId: "private-card",
        ownerPlayerId: "alice",
        zone,
        ...(zone === "field" ? { faceDown: true } : {}),
      });
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      });
      const after = {
        ...before,
        cardInstances: [{ ...card, zone: "deck" as Zone, faceDown: false }],
      };
      for (const result of [
        appendPublicDisclosuresForStateTransition({
          before,
          after,
          actorPlayerId: "bob",
        }),
        appendPublicDisclosuresForEffectStepTransition({
          before,
          after,
          actorPlayerId: "bob",
          sourceInstanceId: card.instanceId,
          effectIndex: 0,
          action: {
            kind: "send_to_deck",
            position: "bottom",
            target: { kind: "self" },
          },
        }),
      ]) {
        const opponent = sanitizeStateForViewer(result, "bob");
        expect(
          opponent.publicDisclosures.flatMap((entry) => entry.results)
        ).toEqual([
          expect.objectContaining({
            kind: "hidden_card_move",
            from: zone,
            to: "deck",
            count: 1,
          }),
        ]);
        expect(JSON.stringify(opponent.publicDisclosures)).not.toContain(
          definition.cardNo
        );
        expect(JSON.stringify(opponent.publicDisclosures)).not.toContain(
          card.instanceId
        );
        expect(opponent.knownDeckCards).toEqual([]);
        expect(sanitizeStateForViewer(result, null).knownDeckCards).toEqual([]);
        expect(sanitizeStateForViewer(result, "alice").knownDeckCards).toEqual([
          expect.objectContaining({
            definitionIdSnapshot: definition.cardNo,
            indexFromBottom: 0,
          }),
        ]);
        const shuffled = executeShuffleZone(result, "alice", {
          kind: "shuffle_zone",
          zone: "deck",
        });
        expect(
          sanitizeStateForViewer(shuffled, "alice").knownDeckCards
        ).toEqual([]);
        const outer = appendPublicDisclosuresForStateTransition({
          before,
          after: result,
          actorPlayerId: "bob",
        });
        expect(outer.publicDisclosures).toEqual(result.publicDisclosures);
      }
    }
  );

  it.each(["self", "opponent"] as const)(
    "%s だけが見たカードの戻しは他方と観戦者に匿名配送する",
    (revealedTo) => {
      const card = {
        ...createCardInstance(definition, {
          instanceId: "peeked-card",
          ownerPlayerId: "alice",
          zone: "revealed",
        }),
        revealedTo,
        revealedByPlayerId: "alice",
      };
      const before = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      });
      const after = appendPublicDisclosuresForStateTransition({
        before,
        after: {
          ...before,
          cardInstances: [{ ...card, zone: "deck" as const }],
        },
        actorPlayerId: "alice",
      });
      for (const viewer of [revealedTo === "self" ? "bob" : "alice", null]) {
        const entries = sanitizeStateForViewer(after, viewer).publicDisclosures;
        expect(entries.flatMap((entry) => entry.results)).toEqual([
          expect.objectContaining({
            kind: "hidden_card_move",
            from: "revealed",
            to: "deck",
            count: 1,
          }),
        ]);
        expect(JSON.stringify(entries)).not.toContain(definition.cardNo);
        expect(JSON.stringify(entries)).not.toContain(card.instanceId);
      }
    }
  );

  it("BSRK01-C03 の実効果で戻したカードは通知され、本人のデッキ下位置に残る", () => {
    const cards = Array.from({ length: 7 }, (_, index) =>
      createCardInstance(definition, {
        instanceId: `c03-${index}`,
        ownerPlayerId: "alice",
        zone: index < 4 ? "hand" : "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [{ handCount: 4, deckCount: 3 }, {}],
    });
    const pending = executeEffect({
      chainId: "test:hidden-card-movement:244",
      state,
      effect: definition.effects![1]!,
      sourceInstanceId: "c03-0",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        allCards.find((card) => card.cardNo === id),
    });
    expect(pending.pendingZoneSelection).not.toBeNull();
    const after = applyLegalAction({
      state: pending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["c03-1", "c03-2"],
      getRegisteredTriggeredEffectActions: () => [],
      getCardDefinitionById: (id) =>
        allCards.find((card) => card.cardNo === id),
    }).state;
    const returned = after.cardInstances.filter((card) => card.zone === "deck");
    expect(returned).toHaveLength(2);
    expect(sanitizeStateForViewer(after, "alice").knownDeckCards).toHaveLength(
      2
    );
    expect(sanitizeStateForViewer(after, "bob").knownDeckCards).toEqual([]);
    expect(
      sanitizeStateForViewer(after, "bob").publicDisclosures.flatMap(
        (entry) => entry.results
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hidden_card_move",
          from: "hand",
          to: "deck",
          actionLabel: "move_to_bottom",
        }),
      ])
    );
  });
});
