import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type GameState,
} from "../src";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
} from "../src/mechanics/oracle-system";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => cards.find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
};
const actions = (state: GameState) =>
  getLegalActions({ state, actingPlayerId: "alice", ...options });
const chainId = "test:repeated-deck-placement";

describe("配置を含むオープン反復の導託", () => {
  it("柱斧で導界者1枚とネクサス2枚を配置しても、配置時導託と対象配置の導託は各1回", () => {
    const make = (no: string, id: string, zone: "field" | "deck") =>
      createCardInstance(lookup(no)!, {
        instanceId: id,
        ownerPlayerId: "alice",
        zone,
      });
    const source = {
      ...make("BSTH09-TR01(B)", "source", "field"),
      attachedToInstanceId: "host",
    };
    const host = {
      ...make("BSTH09-X01", "host", "field"),
      normalCoreCount: 1,
      attachedChildrenIds: ["source"],
    };
    const deck = Array.from({ length: 12 }, (_, i) =>
      make(
        i === 0 ? "BSTH08-X01" : i % 4 === 0 ? "BSTH09-C05" : "BSTH09-C01",
        `deck-${i}`,
        "deck"
      )
    );
    let state = executeEffect({
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, host, ...deck],
          playerOverrides: [{ countValue: 3, reserveNormalCoreCount: 4 }, {}],
        }),
        step: "attack",
      },
      effect: lookup(source.definitionId)!.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId,
      ...options,
    });
    for (const round of [0, 1, 2]) {
      const pick = actions(state).find(
        (action) => action.kind === "resolve_pending_deck_reveal_pick"
      );
      expect(pick).toBeDefined();
      state = finishCoreChoices(
        applyLegalAction({
          state,
          action: pick!,
          selectedDeckRevealCardIds: [`deck-${round * 4}`],
          ...options,
        }).state,
        lookup,
        options
      );
      const order = actions(state).find(
        (action) => action.kind === "resolve_pending_deck_reveal_order"
      );
      if (order?.kind !== "resolve_pending_deck_reveal_order")
        throw new Error("remainder order missing");
      state = applyLegalAction({
        state,
        action: order,
        deckRevealRemainderOrder: order.remainingCardInstanceIds,
        ...options,
      }).state;
    }
    expect(state.pendingDeckReveal).toBeNull();
    expect(
      state.cardInstances
        .filter((card) => card.zone === "field")
        .map((card) => card.instanceId)
    ).toEqual(expect.arrayContaining(["deck-0", "deck-4", "deck-8"]));
    expect(
      state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      )
    ).toHaveLength(1);
    expect(
      state.pendingTriggeredEffects.filter((p) => p.mechanic?.kind === "oracle")
    ).toHaveLength(1);
    // 同じカードでも、別の効果解決区間なら新しい誘発を許可する。
    state = checkAndQueuePlacementOracle(
      state,
      "deck-0",
      lookup,
      `${chainId}:after_triggers:1`
    );
    state = checkAndQueueOracleChoices(
      state,
      "deck-4",
      "place",
      lookup,
      `${chainId}:after_triggers:1`
    );
    expect(
      state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      )
    ).toHaveLength(2);
    expect(
      state.pendingTriggeredEffects.filter((p) => p.mechanic?.kind === "oracle")
    ).toHaveLength(2);
  });
});
