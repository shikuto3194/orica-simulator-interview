import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  appendPublicDisclosure,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveSymbols,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  sanitizeStateForViewer,
  syncKnownDeckCardsForStateTransition,
} from "../src";
import type { GameState, LegalAction, Zone } from "../src";
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};
function board(no: string) {
  const make = (id: string, cardNo: string, zone: Zone, owner = "player-1") =>
    createCardInstance(lookup(cardNo)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: zone === "field" ? 3 : 0,
    });
  return createEmptyGameState({
    cardInstances: [
      make("source", no, "field"),
      ...Array.from({ length: 6 }, (_, i) =>
        make(`deck${i}`, "BSTH10-C01", "deck")
      ),
      make("hand", "BSTH10-C03", "hand"),
      make("aside", "BSTH10-C04", "set_aside"),
    ],
    playerOverrides: [{ handCount: 1, deckCount: 6 }, {}],
  });
}
function act(
  state: GameState,
  kind: LegalAction["kind"],
  args: Partial<Parameters<typeof applyLegalAction>[0]> = {},
  actor = "player-1"
) {
  const action = getLegalActions({
    state,
    actingPlayerId: actor,
    ...options,
  }).find((a) => a.kind === kind);
  expect(
    action,
    JSON.stringify({ log: state.log, pending: state.pendingDeckReveal })
  ).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options, ...args })
    .state;
}
function start(no: string, divine = false) {
  const def = lookup(no)!;
  return executeEffect({
    chainId: "test:bsth10-deck-resolution:58",
    state: board(no),
    effect: divine
      ? def.grandwalkerData!.divineSkills[0]!.effects[0]!
      : def.effects![0]!,
    sourceInstanceId: "source",
    actingPlayerId: "player-1",
    optionalExecuteResumeStepIndex: 0,
    ...options,
  });
}
describe("BSTH10 閲覧と交換の完了解決", () => {
  it.each([false, true])(
    "鈴瑚の私的閲覧を経た交換先・戻し順は神域で既知だったカードも相手に公開しない（神域=%s）",
    (domain) => {
      const base = board("BSTH10-R02");
      base.cardInstances.push(
        ...[6, 7].map((index) =>
          createCardInstance(lookup("BSTH10-C01")!, {
            instanceId: `extra${index}`,
            ownerPlayerId: "player-1",
            zone: "deck",
          })
        )
      );
      const deckDefs = [
        "BSTH10-X05",
        "BSTH10-X02",
        "BSTH10-M01",
        "BSTH10-C02",
        "BSTH10-C01",
        "BSTH10-C04",
      ];
      base.cardInstances = base.cardInstances.map((card) =>
        card.instanceId.startsWith("deck")
          ? {
              ...card,
              definitionId: deckDefs[Number(card.instanceId.slice(4))]!,
            }
          : card
      );
      if (domain)
        base.cardInstances.push(
          createCardInstance(lookup("BSTH10-X01")!, {
            instanceId: "domain",
            ownerPlayerId: "player-1",
            zone: "field",
            normalCoreCount: 3,
          })
        );
      const rebuilt = rebuildContinuousEffectsFromField(base, lookup);
      let initial = syncKnownDeckCardsForStateTransition({
        before: rebuilt,
        after: rebuilt,
        actorPlayerId: "player-1",
      });
      if (domain)
        initial = appendPublicDisclosure(initial, {
          turnNumber: 1,
          step: "main",
          actorPlayerId: "player-1",
          audience: "both",
          kind: "deck_revealed",
          targets: [0, 1, 2].map((i) => ({
            kind: "card" as const,
            instanceId: `deck${i}`,
            actionLabel: "reveal" as const,
          })),
          results: [],
        });
      const previousIds = new Set(
        initial.publicDisclosures.map((entry) => entry.id)
      );
      let state = executeEffect({
        chainId: "test:bsth10-private-swap",
        state: initial,
        effect: lookup("BSTH10-R02")!.effects![0]!,
        sourceInstanceId: "source",
        actingPlayerId: "player-1",
        optionalExecuteResumeStepIndex: 0,
        ...options,
      });
      expect(
        sanitizeStateForViewer(state, "player-2").cardInstances.filter(
          (card) =>
            card.zone === "revealed" && card.definitionId !== "_hidden_card_"
        )
      ).toHaveLength(0);
      state = act(state, "resolve_pending_deck_reveal_pick", {
        selectedDeckRevealCardIds: ["deck0"],
      });
      state = act(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: ["hand"],
      });
      state = act(state, "resolve_pending_deck_reveal_order", {
        deckRevealRemainderOrder: ["deck1", "hand", "deck3", "deck2"],
      });
      const opponent = sanitizeStateForViewer(state, "player-2");
      const history = JSON.stringify(
        opponent.publicDisclosures.filter((entry) => !previousIds.has(entry.id))
      );
      for (const cardNo of deckDefs.slice(0, 3))
        expect(history).not.toContain(cardNo);
      expect(history).not.toContain(deckDefs[3]);
      expect(history).not.toContain("BSTH10-C03");
      for (const cardNo of [...deckDefs.slice(0, 4), "BSTH10-C03"])
        expect(JSON.stringify(opponent.knownDeckCards)).not.toContain(cardNo);
      if (domain)
        expect(
          JSON.stringify(
            opponent.publicDisclosures.filter((entry) =>
              previousIds.has(entry.id)
            )
          )
        ).toContain(deckDefs[0]);
      const ownHistory = JSON.stringify(
        sanitizeStateForViewer(state, "player-1").publicDisclosures
      );
      for (const cardNo of deckDefs.slice(0, 4))
        expect(ownHistory).toContain(cardNo);
    }
  );
  it("神域下の鈴瑚はデッキ上の手札扱いカードも交換に使い、物理枚数を保存する", () => {
    const base = board("BSTH10-R02");
    const initial = rebuildContinuousEffectsFromField(
      {
        ...base,
        cardInstances: [
          ...base.cardInstances,
          createCardInstance(lookup("BSTH10-X01")!, {
            instanceId: "domain",
            ownerPlayerId: "player-1",
            zone: "field",
            normalCoreCount: 3,
          }),
        ],
      },
      lookup
    );
    let state = executeEffect({
      chainId: "test:bsth10-deck-resolution:87",
      state: initial,
      effect: lookup("BSTH10-R02")!.effects![0]!,
      sourceInstanceId: "source",
      actingPlayerId: "player-1",
      optionalExecuteResumeStepIndex: 0,
      ...options,
    });
    state = act(state, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["deck0"],
    });
    expect(state.pendingZoneSelection?.candidateCardInstanceIds).toContain(
      "deck1"
    );
    expect(state.pendingZoneSelection?.candidateCardInstanceIds).not.toContain(
      "deck4"
    );
    state = act(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["deck1"],
    });
    state = act(state, "resolve_pending_deck_reveal_order", {
      deckRevealRemainderOrder: ["deck1", "deck2", "deck3"],
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck0")?.zone
    ).toBe("hand");
    expect(
      state.cardInstances.filter((c) => c.zone === "deck").at(-1)?.instanceId
    ).toBe("deck1");
    expect(state.players[0]!.handCount).toBe(2);
    expect(state.players[0]!.deckCount).toBe(
      state.cardInstances.filter((c) => c.zone === "deck").length
    );
  });
  it("BSTH10-C04 は閲覧した5枚を指定順で上下に戻す", () => {
    let state = start("BSTH10-C04");
    // 入力はデッキ下から上の順。
    state = act(state, "resolve_pending_deck_reveal_order", {
      deckRevealRemainderOrder: ["deck0", "deck1", "deck2", "deck3", "deck4"],
      deckRevealRemainderPlacements: {
        deck4: "top",
        deck3: "top",
        deck2: "bottom",
        deck1: "bottom",
        deck0: "bottom",
      },
    });
    expect(
      state.cardInstances
        .filter((c) => c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["deck4", "deck3", "deck5", "deck2", "deck1", "deck0"]);
  });
  it("BSTH10-R02 は閲覧4枚から2枚を手札と手元に交換する", () => {
    let state = start("BSTH10-R02");
    state = act(state, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["deck0", "deck1"],
    });
    state = act(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["hand"],
    });
    state = act(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["aside"],
    });
    state = act(state, "resolve_pending_deck_reveal_order", {
      deckRevealRemainderOrder: ["deck2", "deck3", "hand", "aside"],
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck0")?.zone
    ).toBe("hand");
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck1")?.zone
    ).toBe("set_aside");
    expect(
      state.cardInstances
        .filter((c) => ["hand", "aside"].includes(c.instanceId))
        .every((c) => c.zone === "deck")
    ).toBe(true);
    expect(state.players[0]!.handCount).toBe(1);
  });
  it("BSTH10-X04 は交換と並べ替え完了後に黒シンボルを付与する", () => {
    const initial = board("BSTH10-X04");
    initial.cardInstances.push(
      ...["BSTH09.2-X01", "BSTH002-C05"].map((no, index) =>
        createCardInstance(lookup(no)!, {
          instanceId: index === 0 ? "guided" : "ordinary",
          ownerPlayerId: "player-1",
          zone: "field",
          normalCoreCount: 3,
        })
      )
    );
    let state = executeEffect({
      chainId: "test:bsth10-deck-resolution:179",
      state: initial,
      effect:
        lookup("BSTH10-X04")!.grandwalkerData!.divineSkills[0]!.effects[0]!,
      sourceInstanceId: "source",
      actingPlayerId: "player-1",
      optionalExecuteResumeStepIndex: 0,
      ...options,
    });
    state = act(state, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["deck0"],
    });
    state = act(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["hand"],
    });
    state = act(state, "resolve_pending_deck_reveal_order", {
      deckRevealRemainderOrder: ["deck2", "deck1", "hand"],
      deckRevealRemainderPlacements: {
        deck2: "top",
        deck1: "bottom",
        hand: "bottom",
      },
    });
    const source = state.cardInstances.find((c) => c.instanceId === "source")!;
    expect(
      getEffectiveSymbols(
        state,
        source,
        lookup(source.definitionId)!,
        lookup
      ).filter((s) => s === "black")
    ).toHaveLength(2);
    for (const id of ["guided", "ordinary"]) {
      const card = state.cardInstances.find((c) => c.instanceId === id)!;
      const before = initial.cardInstances.find((c) => c.instanceId === id)!;
      expect(
        getEffectiveSymbols(
          state,
          card,
          lookup(card.definitionId)!,
          lookup
        ).filter((s) => s === "black").length -
          getEffectiveSymbols(
            initial,
            before,
            lookup(before.definitionId)!,
            lookup
          ).filter((s) => s === "black").length
      ).toBe(id === "guided" ? 1 : 0);
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck0")?.zone
    ).toBe("hand");
  });
  it("BSTH10-X04 は双方の6枚以上の物理手札を各5枚にする", () => {
    const initial = board("BSTH10-X04");
    const hands = ["player-1", "player-2"].flatMap((owner) =>
      Array.from({ length: 6 }, (_, i) =>
        createCardInstance(lookup("BSTH10-C03")!, {
          instanceId: `${owner}-${i}`,
          ownerPlayerId: owner,
          zone: "hand",
        })
      )
    );
    let state = executeEffect({
      chainId: "test:bsth10-deck-resolution:244",
      state: {
        ...initial,
        step: "end",
        cardInstances: [
          ...initial.cardInstances.filter((c) => c.zone !== "hand"),
          ...hands,
        ],
        players: initial.players.map((p) => ({ ...p, handCount: 6 })),
      },
      effect: lookup("BSTH10-X04")!.effects![0]!,
      sourceInstanceId: "source",
      actingPlayerId: "player-1",
      ...options,
    });
    for (const owner of ["player-1", "player-2"])
      state = act(
        state,
        "resolve_pending_zone_selection",
        { selectedZoneCardIds: [`${owner}-0`] },
        owner
      );
    expect(state.players.map((p) => p.handCount)).toEqual([5, 5]);
    expect(state.cardInstances.filter((c) => c.zone === "trash")).toHaveLength(
      2
    );
  });
});
