import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type GameState,
} from "../src";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getCardDefinitionById = (id: string) =>
  cards.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredBurstActions: () => [],
};
const make = (no: string, id: string, cores: number, owner = "alice") =>
  createCardInstance(getCardDefinitionById(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });

function choose(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options }).state;
}

function drain(state: GameState) {
  for (let i = 0; i < 20; i++) {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...options })
    );
    const action = actions.find((a) =>
      [
        "resolve_pending_triggered_effect",
        "pass_stack",
        "select_pending_to_resolve",
        "resolve_pending_zone_selection",
      ].includes(a.kind)
    );
    if (!action) return state;
    state = applyLegalAction({
      state,
      action,
      ...options,
      ...(action.kind === "resolve_pending_zone_selection"
        ? {
            selectedZoneCardIds:
              state.pendingZoneSelection!.candidateCardInstanceIds.slice(0, 1),
          }
        : {}),
    }).state;
  }
  throw new Error("Effect did not finish");
}

describe("React f51f8ba 原文訂正", () => {
  it("BSTH04-転醒R01(B) 回復を辞退してもコアとライフを得て、同じターンの次回に回復できる", () => {
    const no = "BSTH04-転醒R01(B)";
    const source = {
      ...make(no, "source", 3),
      exhaustState: "exhausted" as const,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
        playerOverrides: [
          {
            trashNormalCoreCount: 6,
            voidNormalCoreCount: 3,
            lifeNormalCoreCount: 5,
          },
          {},
        ],
      }),
      step: "attack",
      activePlayerId: "alice",
      turnNumber: 3,
    };
    const run = (state: GameState) =>
      executeEffect({
        state,
        ...options,
        chainId: "react-kinryu",
        effect: getCardDefinitionById(no)!.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
      });
    const declined = choose(run(state), "decline");
    expect(declined.pendingStepOptionalChoice).toBeNull();
    expect(declined.cardInstances[0]).toMatchObject({
      normalCoreCount: 5,
      exhaustState: "exhausted",
    });
    expect(declined.players[0]).toMatchObject({
      trashNormalCoreCount: 4,
      lifeNormalCoreCount: 6,
    });
    const recovered = choose(run(declined), "execute");
    expect(recovered.pendingStepOptionalChoice).toBeNull();
    expect(recovered.cardInstances[0]).toMatchObject({
      normalCoreCount: 7,
      exhaustState: "recovered",
    });
    expect(recovered.players[0].lifeNormalCoreCount).toBe(7);
    const third = run({
      ...recovered,
      cardInstances: [
        { ...recovered.cardInstances[0]!, exhaustState: "exhausted" },
      ],
    });
    expect(third.pendingStepOptionalChoice).toBeNull();
    expect(third.cardInstances[0]).toMatchObject({
      normalCoreCount: 9,
      exhaustState: "exhausted",
    });
    expect(third.players[0]).toMatchObject({
      trashNormalCoreCount: 0,
      lifeNormalCoreCount: 8,
    });
  });

  for (const [no, threshold, step] of [
    ["BSTH10-X03", 5, "start"],
    ["BSTH10-X04", 3, "end"],
  ] as const) {
    for (const active of ["alice", "bob"]) {
      it.each([threshold - 1, threshold])(
        `${no} 神域: ${active}の${step}でコア%dの境界と解決後盤面`,
        (cores) => {
          const hands = ["alice", "bob"].flatMap((owner) =>
            Array.from({ length: 6 }, (_, i) => ({
              ...make("BSTH10-C03", `${owner}-hand-${i}`, 0, owner),
              zone: "hand" as const,
            }))
          );
          const before: GameState = {
            ...createEmptyGameState({
              playerIds: ["alice", "bob"],
              cardInstances: [
                make(no, "source", cores),
                make("BSTH10-X02", "ultimate", 1),
                ...hands,
              ],
              playerOverrides: [{ handCount: 6 }, { handCount: 6 }],
            }),
            step,
            activePlayerId: active,
            turnNumber: 3,
          };
          const queued = queuePendingReactionsFromTriggerEvents(
            before,
            [
              {
                eventKind: step === "end" ? "end_step" : "start_step",
                actingPlayerId: active,
                relatedPlayerId: active,
                relatedInstanceId: null,
                amount: null,
                attackId: null,
                chainId: "react-domain",
                source: "step_transition",
                step,
                subPhase: "start",
              },
            ],
            undefined,
            options
          );
          const shouldActivate =
            cores === threshold && (no === "BSTH10-X04" || active === "alice");
          expect(
            getLegalActions({
              state: queued,
              actingPlayerId: "alice",
              ...options,
            }).some(
              (action) =>
                action.kind === "resolve_pending_triggered_effect" &&
                action.sourceInstanceId === "source"
            )
          ).toBe(shouldActivate);
          const final = drain(queued);
          expect(final.pendingTriggeredEffects).toHaveLength(0);
          expect(final.pendingZoneSelection).toBeNull();
          if (no === "BSTH10-X03")
            expect(final.pendingExtraSteps ?? []).toEqual(
              shouldActivate ? ["attack"] : []
            );
          else {
            expect(final.players.map((p) => p.handCount)).toEqual(
              shouldActivate ? [5, 5] : [6, 6]
            );
            expect(
              final.cardInstances.filter((c) => c.zone === "trash")
            ).toHaveLength(shouldActivate ? 2 : 0);
          }
        }
      );
    }
  }
});
