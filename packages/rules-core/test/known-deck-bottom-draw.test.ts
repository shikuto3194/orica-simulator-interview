import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  rememberKnownDeckCardsByInstanceIds,
  sanitizeStateForViewer,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => undefined,
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredMagicActions: () => undefined,
  getRegisteredBattleImmediateEffectActions: () => undefined,
};

describe("known deck positions through legal action resolution", () => {
  it.each(["alice", "bob"])(
    "%s: アリスの下ドロー後も既知の上4枚が実デッキと一致する",
    (owner) => {
      const topDefinitions = [
        "BSSA01-C01",
        "BSRK01-C06",
        "BSTH02-R11",
        "BSSA01-転醒X02(A)",
      ];
      const deckDefinitions = [
        ...topDefinitions,
        ...Array<string>(22).fill("BSSA01-C03"),
        "BSSA01-C02",
      ];
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(definitions.get("BSSA01-C01")!, {
            instanceId: "source",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 1,
          }),
          ...deckDefinitions.map((id, index) =>
            createCardInstance(definitions.get(id)!, {
              instanceId: `deck-${index}`,
              ownerPlayerId: owner,
              zone: "deck",
            })
          ),
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          deckCount: id === owner ? 27 : 0,
          countValue: 1,
          lifeNormalCoreCount: 6,
        })),
      });
      state = rememberKnownDeckCardsByInstanceIds({
        state,
        playerId: owner,
        instanceIds: ["deck-0", "deck-1", "deck-2", "deck-3", "deck-26"],
        audience: "both",
        actorPlayerId: owner,
      });
      state = queuePendingReactionsFromTriggerEvents(
        { ...state, activePlayerId: owner, turnNumber: 3, step: "main" },
        [
          {
            actingPlayerId: owner,
            eventKind: "summon",
            source: "action_resolution",
            chainId: "test:known-deck-bottom-draw:72",
            attackId: null,
            relatedPlayerId: owner,
            relatedInstanceId: "source",
            amount: null,
          },
        ],
        undefined,
        lookups
      );
      for (const [player, kind] of [
        [owner, "resolve_pending_triggered_effect"],
        [owner === "alice" ? "bob" : "alice", "pass_stack"],
      ]) {
        const action = getLegalActions({
          state,
          actingPlayerId: player!,
          ...lookups,
        }).find((candidate) => candidate.kind === kind);
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      }
      const actualDeck = state.cardInstances.filter(
        (card) => card.ownerPlayerId === owner && card.zone === "deck"
      );
      expect(actualDeck).toHaveLength(26);
      expect(actualDeck.slice(0, 4).map((card) => card.definitionId)).toEqual(
        topDefinitions
      );
      expect(
        state.cardInstances.find((card) => card.instanceId === "deck-26")?.zone
      ).toBe("hand");
      for (const viewer of ["alice", "bob"]) {
        const visible = sanitizeStateForViewer(state, viewer);
        expect(
          visible.knownDeckCards?.map((entry) => entry.indexFromBottom)
        ).toEqual([22, 23, 24, 25]);
        expect(
          visible.knownDeckCards?.map((entry) => entry.definitionIdSnapshot)
        ).toEqual([...topDefinitions].reverse());
        expect(
          visible.cardInstances
            .filter((card) => card.zone === "deck")
            .every((card) => card.definitionId === "_hidden_card_")
        ).toBe(true);
        expect(sanitizeStateForViewer(visible, viewer).knownDeckCards).toEqual(
          visible.knownDeckCards
        );
      }
    }
  );
});
