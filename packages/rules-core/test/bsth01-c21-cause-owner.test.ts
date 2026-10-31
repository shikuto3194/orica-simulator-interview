import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { generateActionInputChoices } from "../src/action-input-choices";
import { materializeDeferredTrashOptionalAdds } from "../src/effect/structured-effect-interpreter";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const guideDefinition = ALL_CARDS.find(
  (card) =>
    card.printedCategory === "nexus" &&
    card.colors.includes("yellow") &&
    card.tribe?.split("・").includes("導界者")
)!;
const options = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => undefined,
};

describe("BSTH01-C21 自分の黄の効果による自己回収", () => {
  for (const owner of ["alice", "bob"])
    for (const foreign of [false, true])
      it.each(["open", "mill"] as const)(
        `${owner}/foreign=${foreign}/%s: 原因プレイヤーと最終ゾーン・コアを照合する`,
        (route) => {
          const actor = foreign ? (owner === "alice" ? "bob" : "alice") : owner;
          const before = {
            ...createEmptyGameState({
              playerIds: ["alice", "bob"],
              playerOverrides: ["alice", "bob"].map((id) => ({
                handCount: 0,
                deckCount: id === owner ? 1 : 0,
              })),
              cardInstances: [
                createCardInstance(definitions.get("BSTH01-C01")!, {
                  instanceId: "source",
                  ownerPlayerId: actor,
                  zone: "field",
                  normalCoreCount: 8,
                }),
                createCardInstance(definitions.get("BSTH01-C21")!, {
                  instanceId: "blazing",
                  ownerPlayerId: owner,
                  zone: "deck",
                }),
                createCardInstance(guideDefinition, {
                  instanceId: "guide",
                  ownerPlayerId: owner,
                  zone: "field",
                }),
              ],
            }),
            activePlayerId: actor,
            turnNumber: 4,
            step: "main" as const,
          };
          let state = materializeDeferredTrashOptionalAdds(
            executeEffect({
              state: before,
              chainId: "test:C21:cause-owner",
              sourceInstanceId: "source",
              actingPlayerId: actor,
              ...options,
              effect: {
                timing: { kind: "activated", mode: "main" },
                steps: [
                  {
                    action:
                      route === "open"
                        ? {
                            kind: "deck_reveal",
                            revealCount: 1,
                            player: foreign ? "opponent" : "self",
                            picks: [],
                            remainder: "bottom",
                          }
                        : {
                            kind: "discard",
                            fromZone: "deck",
                            count: 1,
                            player: foreign ? "opponent" : "self",
                          },
                  },
                ],
              },
            })
          );
          if (!foreign) {
            const action = getLegalActions({
              state,
              actingPlayerId: owner,
              ...options,
            }).find(
              (entry) => entry.kind === "resolve_pending_deck_reveal_pick"
            );
            expect(action).toBeDefined();
            state = applyLegalAction({
              state,
              action: action!,
              selectedDeckRevealCardIds: ["blazing"],
              ...options,
            }).state;
          }
          for (let n = 0; n < 8; n++) {
            const pendingAction = getLegalActions({
              state,
              actingPlayerId: state.pendingDeckReveal?.actingPlayerId ?? owner,
              ...options,
            }).find((entry) => entry.kind.startsWith("resolve_"));
            if (!pendingAction) break;
            const choices = generateActionInputChoices(
              state,
              pendingAction,
              options,
              64
            );
            state = applyLegalAction({
              state,
              action: pendingAction,
              ...choices.values[0],
              ...options,
            }).state;
          }
          expect(
            state.cardInstances.find((card) => card.instanceId === "blazing")
              ?.zone
          ).toBe(foreign ? (route === "open" ? "deck" : "trash") : "hand");
          expect(
            state.players.find((player) => player.id === owner)!.handCount
          ).toBe(foreign ? 0 : 1);
          expect(
            state.cardInstances.find((card) => card.instanceId === "guide")!
              .normalCoreCount
          ).toBe(!foreign && route === "mill" ? 1 : 0);
          expect(state.pendingDeckReveal).toBeNull();
          expect(state.pendingTrashOptionalAdds).toEqual([]);
          expect(state.pendingAfterTriggersContinuations).toEqual([]);
          expect(state.pendingCoreDistribution).toBeNull();
          expect(state.stackWindow).toBeNull();
        }
      );
});
