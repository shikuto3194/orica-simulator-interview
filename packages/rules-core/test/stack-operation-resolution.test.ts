import { describe, expect, it } from "vitest";
import { buildStackOperationScenario } from "../../../apps/playground-web/src/scenario-stack-operation";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  expandCardDefinitionsWithBackFaces,
  createCardInstance,
  getLegalActions,
  type GameState,
  type LegalAction,
  type CardDefinition,
} from "../src";

const burst: CardDefinition = {
  ...ALL_CARDS.find((c) => c.cardNo === "BSAZ01-C08")!,
  cardNo: "TEST-STACK-BURST",
  name: "test-stack-burst",
  textLines: ["【バースト：相手の効果発揮後】", "自分のカウント+2する。"],
  keywordTags: ["burst"],
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "any_effect_activated", player: "opponent" },
      },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 2 } },
      ],
    },
  ],
};
const observer: CardDefinition = {
  ...ALL_CARDS.find((c) => c.cardNo === "BSSA01-C01")!,
  cardNo: "TEST-STACK-OBSERVER",
  name: "test-stack-observer",
  effects: [
    {
      timing: { kind: "game_event", event: "count_increase", player: "self" },
      condition: [{ kind: "count_value", player: "self", min: 5 }],
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};
const cards = [
  ...expandCardDefinitionsWithBackFaces(ALL_CARDS),
  burst,
  observer,
];
const getCardDefinitionById = (id: string) =>
  cards.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredMagicActions: buildMagicLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(cards),
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
};

const initialState = () =>
  buildStackOperationScenario(ALL_CARDS, new URLSearchParams("stage=initial"));

function actions(state: GameState) {
  return ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...lookups })
  );
}
function act(
  state: GameState,
  predicate: (a: LegalAction) => boolean,
  extra = {}
): GameState {
  const available = actions(state);
  const action = available.find(predicate);
  expect(
    action,
    available
      .map(
        (a) => `${a.kind}:${"sourceInstanceId" in a ? a.sourceInstanceId : ""}`
      )
      .join("\n")
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...lookups,
    ...(action?.kind === "use_magic"
      ? {
          paymentSources: [
            { kind: "reserve" as const, amount: action.finalCost },
          ],
        }
      : {}),
    ...extra,
  }).state;
}

describe("作戦の使用許可と独立したスタックの解決", () => {
  it("場の作戦は通常使用として先にコストを支払い応答窓を開く", () => {
    let state = act(
      initialState(),
      (a) => a.kind === "attack" && a.sourceInstanceId === "eugeo"
    );
    state = act(
      state,
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "r02"
    );
    const use = actions(state).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "operation"
    );
    expect(use).toBeDefined();
    expect(
      actions(state).some(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === "operation"
      )
    ).toBe(false);
    if (use?.kind !== "use_magic") return;
    expect(use.finalCost).toBeGreaterThan(0);
    expect(() =>
      applyLegalAction({ state, action: use, ...lookups, paymentSources: [] })
    ).toThrow();
    const before = state.players[0]!.trashNormalCoreCount;
    state = applyLegalAction({
      state,
      action: use,
      ...lookups,
      paymentSources: [{ kind: "reserve", amount: use.finalCost }],
    }).state;
    expect(state.players[0]!.trashNormalCoreCount - before).toBe(use.finalCost);
    expect(
      state.preDeclarationStackWindow?.pendingStackAction?.actionKind
    ).toBe("magic");
    expect(state.preDeclarationStackWindow?.priorityPlayerId).toBe("bob");
  });

  it.each([false, true])(
    "九頭龍閃の転醒・青薔薇・カウント・バースト後に下段スタックを解決する (burst=%s)",
    (withBurst) => {
      let state = initialState();
      if (withBurst)
        state = {
          ...state,
          cardInstances: [
            ...state.cardInstances,
            createCardInstance(burst, {
              instanceId: "burst",
              ownerPlayerId: "alice",
              zone: "burst",
            }),
            createCardInstance(observer, {
              instanceId: "observer",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            createCardInstance(getCardDefinitionById("BSSA01-C01")!, {
              instanceId: "draw",
              ownerPlayerId: "alice",
              zone: "deck",
            }),
          ],
          setBurstStates: [{ playerId: "alice", cardInstanceId: "burst" }],
          players: state.players.map((p) =>
            p.id === "alice" ? { ...p, deckCount: 1, handCount: 0 } : p
          ),
        };
      state = act(
        state,
        (a) => a.kind === "attack" && a.sourceInstanceId === "eugeo"
      );
      state = act(
        state,
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "r02"
      );
      state = act(
        state,
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "operation"
      );
      state = act(
        state,
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "r01"
      );
      const response = state.preDeclarationStackWindow!.pendingStackAction!;
      expect(response.chainId).not.toContain(
        response.previousPendingStackAction!.chainId
      );
      expect(
        response.previousPendingStackAction!.waitForResolutionChainIds
      ).toEqual([response.chainId]);
      state = act(state, (a) => a.kind === "pass_pre_declaration_stack");
      expect(state.pendingEffectTargetSelection?.sourceInstanceId).toBe("r01");
      state = act(state, (a) => a.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["eugeo", "alice-spirit"],
      });
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(
        state.pendingStackCascade?.remainingStacks.map((s) => s.cardInstanceId)
      ).toEqual(["operation", "r02"]);
      state = act(
        state,
        (a) =>
          a.kind === "select_pending_to_resolve" &&
          a.sourceInstanceId === "eugeo"
      );
      state = act(state, (a) => a.kind === "pass_stack");
      expect(state.pendingEffectTargetSelection?.sourceInstanceId).toBe(
        "eugeo"
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "eugeo")?.definitionId
      ).toBe("BSSA01-転醒X03(A)");
      // Pay the printed blue-rose fold cost before the B-face trigger exists.
      state = act(state, (a) => a.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["rose"],
      });
      state = act(
        state,
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "eugeo",
        { targetInstanceIds: ["bob-spirit"] }
      );
      let sawRosePlacement = false;
      let sawR02Target = false;
      for (let i = 0; i < 28; i++) {
        const available = actions(state);
        const next = available.find(
          (a) =>
            a.kind === "resolve_pending_burst_check" ||
            a.kind === "pass_stack" ||
            a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve" ||
            a.kind === "resolve_pending_core_distribution" ||
            a.kind === "resolve_pending_effect_target"
        );
        if (!next) break;
        if (next.kind === "resolve_pending_core_distribution") {
          sawRosePlacement = true;
          expect(
            state.pendingStackCascade?.remainingStacks.map(
              (s) => s.cardInstanceId
            )
          ).toEqual(expect.arrayContaining(["operation", "r02"]));
          expect(state.players[1]!.countValue).toBe(1);
        }
        if (
          next.kind === "resolve_pending_effect_target" &&
          next.sourceInstanceId === "r02"
        ) {
          sawR02Target = true;
          expect(sawRosePlacement).toBe(true);
          expect(state.players[1]!.countValue).toBe(3);
          expect(state.pendingLeaveEntities).toHaveLength(0);
          expect(
            state.cardInstances.find((c) => c.instanceId === "operation")?.zone
          ).toBe("trash");
          expect(next.candidateTargetInstanceIds).toEqual(
            withBurst ? ["rose", "observer"] : ["rose"]
          );
          if (withBurst) {
            expect(state.players[0]!.handCount).toBe(1);
            expect(
              state.cardInstances.find((c) => c.instanceId === "burst")?.zone
            ).toBe("trash");
            expect(state.pendingBurstChecks).toHaveLength(0);
          }
        }
        state = applyLegalAction({
          state,
          action: next,
          ...lookups,
          ...(next.kind === "resolve_pending_core_distribution"
            ? {
                coreDistributionAllocations: { rose: 1 },
                coreDistributionSourceAllocations: { reserve: 1 },
              }
            : {}),
          ...(next.kind === "resolve_pending_effect_target"
            ? {
                targetInstanceIds:
                  next.sourceInstanceId === "r02" && withBurst
                    ? ["rose", "observer"]
                    : ["rose"],
              }
            : {}),
        }).state;
      }
      expect(sawR02Target).toBe(true);
      expect(state.players[1]!.countValue).toBe(5);
      expect(state.pendingStackCascade).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(
        state.cardInstances
          .filter((c) =>
            ["eugeo", "rose", "operation", "r01", "r02"].includes(c.instanceId)
          )
          .every((c) => c.zone === "trash")
      ).toBe(true);
    }
  );
});
