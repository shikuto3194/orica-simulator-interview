import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";

const getDef = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const source = getDef("BSLH01-C07")!;
type Effect = NonNullable<CardDefinition["effects"]>[number];

function setup(discardedCardNo: string): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(getDef(discardedCardNo)!, {
          instanceId: "discarded",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(source, {
          instanceId: "remaining",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
      playerOverrides: [{ deckCount: 2 }, {}],
    }),
    activePlayerId: "alice",
    step: "main",
  };
}

function choose(
  state: GameState,
  kind: LegalAction["kind"],
  extra = {},
  suffix = ""
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  }).find((a) => a.kind === kind && a.actionId.endsWith(suffix));
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  }).state;
}

function discard(state: GameState, defer: boolean): GameState {
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    textRef: [],
    steps: [
      {
        id: "mill",
        action: {
          kind: "discard",
          player: "self",
          fromZone: "deck",
          count: { min: 0, max: 1 },
          ...(defer ? { deferMovedToTrashEffects: true } : {}),
        },
      },
      ...(defer
        ? [
            {
              executionMode: "optional" as const,
              action: {
                kind: "count_increase" as const,
                player: "self" as const,
                amount: 1,
              },
            },
            {
              action: {
                kind: "process_moved_to_trash" as const,
                source: { stepId: "mill" },
              },
            },
          ]
        : []),
    ],
  };
  const pending = executeEffect({
    chainId: "test:pending-discard-moved-to-trash:104",
    state,
    effect,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
  return choose(pending, "resolve_pending_zone_selection", {
    selectedZoneCardIds: ["discarded"],
  });
}

describe("pending discard の破棄時効果", () => {
  it("任意枚数でも明示処理まで遅延し、回収辞退後に再提示しない", () => {
    const waiting = discard(setup("BSES01-C01"), true);
    expect(
      waiting.cardInstances.find((c) => c.instanceId === "discarded")!.zone
    ).toBe("trash");
    expect(waiting.pendingStepOptionalChoice).not.toBeNull();
    expect(waiting.pendingTrashOptionalAdds).toHaveLength(0);
    expect(waiting.pendingDeckReveal).toBeNull();
    const processed = choose(
      waiting,
      "resolve_pending_step_optional_choice",
      {},
      ":execute"
    );
    expect(processed.players[0]!.countValue).toBe(1);
    expect(processed.pendingDeckReveal?.revealedAutoAddCandidateIds).toEqual([
      "discarded",
    ]);
    const declined = choose(processed, "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: [],
    });
    expect(declined.pendingDeckReveal).toBeNull();
    expect(declined.pendingTrashOptionalAdds).toHaveLength(0);
    expect(
      declined.cardInstances.find((c) => c.instanceId === "discarded")!.zone
    ).toBe("trash");
  });

  it.each(["tribes", "addTribes"] as const)(
    "発生源の %s 変更後の系統で回収条件を判定する",
    (property) => {
      const state = setup("BSTH03-C11");
      state.activeContinuousEffects.push({
        effectId: "granted-tribe",
        sourceInstanceId: "source",
        sourceDefinitionId: source.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        modifierTag: "override_properties",
        targetInstanceId: "source",
        metadata: { properties: { [property]: ["蓬莱"] } },
      });
      const pending = discard(state, false);
      expect(pending.pendingDeckReveal?.revealedAutoAddCandidateIds).toEqual([
        "discarded",
      ]);
      const recovered = choose(pending, "resolve_pending_deck_reveal_pick", {
        selectedDeckRevealCardIds: ["discarded"],
      });
      expect(
        recovered.cardInstances.find((c) => c.instanceId === "discarded")!.zone
      ).toBe("hand");
    }
  );
});
