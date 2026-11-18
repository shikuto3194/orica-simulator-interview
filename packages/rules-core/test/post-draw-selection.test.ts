import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type GameState,
  type ApplyLegalActionOptions,
  type LegalAction,
} from "../src";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";

const drive = ALL_CARDS.find((card) => card.cardNo === "BSAZ02-C10")!;
const filler = ALL_CARDS.find((card) => card.cardNo === "BSTH01-C01")!;
const lookups = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
  getRegisteredBurstActions: () => [],
  getCardDefinitionById: (id: string) =>
    ALL_CARDS.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};

function queueSummon(state: GameState, source = "drive"): GameState {
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: "alice",
        eventKind: "summon",
        source: "action_resolution",
        chainId: `test:post-draw:${source}`,
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: source,
        amount: null,
        fromZone: "hand",
      },
    ],
    undefined,
    lookups
  );
}

function setup(handCount: number, sourceDefinition = drive): GameState {
  const instance = (id: string, zone: "field" | "hand" | "deck") =>
    createCardInstance(zone === "field" ? sourceDefinition : filler, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  return queueSummon({
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance("drive", "field"),
        instance("drive-2", "field"),
        ...Array.from({ length: handCount }, (_, i) =>
          instance(`hand-${i}`, "hand")
        ),
        ...Array.from({ length: 3 }, (_, i) => instance(`deck-${i}`, "deck")),
      ],
      playerOverrides: [{ handCount, deckCount: 3, countValue: 1 }, {}],
    }),
    activePlayerId: "alice",
    step: "main",
    window: "none",
    turnNumber: 3,
  });
}

function actions(state: GameState, player = "alice") {
  return getLegalActions({ state, actingPlayerId: player, ...lookups });
}
function apply(
  state: GameState,
  kind: LegalAction["kind"],
  extra: Partial<ApplyLegalActionOptions> = {}
): GameState {
  const action = actions(
    state,
    state.stackWindow?.priorityPlayerId ?? "alice"
  ).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
}

describe("BSAZ02-C10: ドロー後に手札を選んでデッキ下に戻す", () => {
  it("登録時にドロー後の手札対象を先取りしない", () => {
    const registration = generateTriggeredEffectRegistrations(drive).find(
      (r) => r.effectIndex === 2
    )!;
    expect(registration.requiredTargetCount ?? 0).toBe(0);
    expect(registration.targetStepId).toBeUndefined();
  });

  it.each([0, 2])(
    "元の手札%i枚: 宣言・スタック通過後に引いたカードも選べる",
    (handCount) => {
      let state = setup(handCount);
      state = apply(state, "resolve_pending_triggered_effect");
      expect(state.players[0]!.handCount).toBe(handCount);
      for (let guard = 0; state.stackWindow && guard < 8; guard++)
        state = apply(state, "pass_stack");
      expect(state.stackWindow).toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      if (handCount > 0) {
        expect(state.players[0]!.handCount).toBe(handCount + 1);
        expect(state.players[0]!.deckCount).toBe(2);
        expect(
          state.pendingStepOptionalTargetSelection?.candidateInstanceIds
        ).toContain("deck-0");
        state = apply(state, "resolve_pending_step_optional_target_selection", {
          targetInstanceIds: ["deck-0"],
        });
      }
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.players[0]!.handCount).toBe(handCount);
      expect(state.players[0]!.deckCount).toBe(3);
      expect(
        state.cardInstances
          .filter((c) => c.zone === "deck")
          .map((c) => c.instanceId)
      ).toEqual(["deck-1", "deck-2", "deck-0"]);
      state = queueSummon(state, "drive-2");
      expect(
        actions(state).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceCardNo === drive.cardNo &&
            !a.skipOnly
        )
      ).toBe(false);
    }
  );

  it("任意効果を辞退するとドローも手札戻しも行わない", () => {
    let state = setup(2);
    state = apply(state, "resolve_pending_triggered_effect", {
      skipOptionalEffect: true,
    });
    expect(state.players[0]!.handCount).toBe(2);
    expect(state.players[0]!.deckCount).toBe(3);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
});

describe("ドロー分岐の後段対象登録", () => {
  it("BSTH02.7-R01: 後段召喚を先に選ばず下から2枚ドローして完走する", () => {
    const definition = ALL_CARDS.find(
      (card) => card.cardNo === "BSTH02.7-R01"
    )!;
    const registration = generateTriggeredEffectRegistrations(definition)[0]!;
    expect(registration.choices?.[0]?.requiredTargetCount ?? 0).toBe(0);
    let state = setup(2, definition);
    state = apply(state, "resolve_pending_triggered_effect");
    for (let guard = 0; state.stackWindow && guard < 8; guard++)
      state = apply(state, "pass_stack");
    state = apply(state, "resolve_pending_step_choice");
    expect(state.players[0]!.handCount).toBe(4);
    expect(state.players[0]!.deckCount).toBe(1);
    expect(
      state.cardInstances
        .filter((c) => c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["deck-0"]);
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
});
