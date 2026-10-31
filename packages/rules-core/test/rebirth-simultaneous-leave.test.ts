import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildRebirthSimultaneousLeaveScenario,
  rebirthLeaveLookups,
} from "../../../apps/playground-web/src/scenario-rebirth-simultaneous-leave";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  finalizeEffectResolution,
  type Effect,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";

const lookups = rebirthLeaveLookups(ALL_CARDS);
const actions = (state: GameState) =>
  ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    )
    .filter((a) => a.can);
function act(
  state: GameState,
  kind: LegalAction["kind"],
  skipOptionalEffect = false
) {
  const action = actions(state).find(
    (a) => a.kind === kind && !("skipOnly" in a && a.skipOnly)
  );
  expect(action, JSON.stringify(actions(state))).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    skipOptionalEffect,
    ...lookups,
  }).state;
}
function pass(state: GameState) {
  for (let n = 0; state.stackWindow && n < 8; n++)
    state = act(state, "pass_stack");
  return state;
}
const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

describe("同時破壊と彼岸の転醒時", () => {
  for (const owner of ["alice", "bob"]) {
    it.each(["nexus", "spirit"])(
      `${owner}: %s は転醒時の解決まで破壊待機を保つ`,
      (mode) => {
        let state = buildRebirthSimultaneousLeaveScenario(
          ALL_CARDS,
          new URLSearchParams({ owner, mode })
        );
        expect(card(state, "leave-eiki")).toMatchObject({
          zone: "field",
          pendingLeaveKind: "destroy",
          normalCoreCount: 2,
        });
        expect(card(state, "leave-other")).toMatchObject({
          zone: "field",
          pendingLeaveKind: "destroy",
        });
        state = pass(act(state, "resolve_pending_triggered_effect"));
        expect(card(state, "leave-sun")).toMatchObject({
          zone: "field",
          definitionId: "BSTH04-転醒R02(B)",
          pendingLeaveKind: null,
        });
        expect(card(state, "leave-eiki")).toMatchObject({
          zone: "field",
          pendingLeaveKind: "destroy",
        });
        expect(card(state, "leave-other")).toMatchObject({
          zone: "field",
          pendingLeaveKind: "destroy",
        });
        expect(
          state.players.find((p) => p.id === owner)?.reserveNormalCoreCount
        ).toBe(0);
        state = pass(act(state, "resolve_pending_triggered_effect", true));
        expect(card(state, "leave-eiki")).toMatchObject({
          zone: "trash",
          pendingLeaveKind: null,
          normalCoreCount: 0,
        });
        expect(card(state, "leave-other")).toMatchObject({
          zone: "trash",
          pendingLeaveKind: null,
        });
        expect(state.pendingLeaveEntities).toHaveLength(0);
      }
    );
  }
});
for (const owner of ["alice", "bob"]) {
  it(
    owner +
      ": 既存トラッシュだけを召喚し、召喚時を終えてから同時破壊を確定する",
    () => {
      let state = buildRebirthSimultaneousLeaveScenario(
        ALL_CARDS,
        new URLSearchParams({ owner, mode: "spirit" })
      );
      state = pass(act(state, "resolve_pending_triggered_effect"));
      state = pass(act(state, "resolve_pending_triggered_effect"));
      const selection = actions(state).find(
        (a) => a.kind === "resolve_pending_effect_target"
      )!;
      expect(selection).toMatchObject({
        candidateTargetInstanceIds: ["leave-old-trash"],
      });
      expect(card(state, "leave-other")).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      state = applyLegalAction({
        state,
        action: selection,
        targetInstanceIds: ["leave-old-trash"],
        ...lookups,
      }).state;
      const placement = actions(state).find(
        (a) => a.kind === "resolve_pending_multi_placement"
      )!;
      expect(placement).toBeDefined();
      expect(card(state, "leave-eiki")).toMatchObject({
        zone: "field",
        normalCoreCount: 2,
      });
      state = applyLegalAction({
        state,
        action: placement,
        ...lookups,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "leave-old-trash",
            placements: [{ kind: "trash_normal", amount: 1 }],
          },
        ],
      }).state;
      expect(card(state, "leave-old-trash")).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
      });
      expect(card(state, "leave-other")).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
      expect(
        state.pendingTriggeredEffects.some((p) => p.eventKind === "summon")
      ).toBe(true);
      for (let i = 0; state.pendingTriggeredEffects.length > 0 && i < 8; i++) {
        if (actions(state).some((a) => a.kind === "select_pending_to_resolve"))
          state = act(state, "select_pending_to_resolve");
        state = pass(act(state, "resolve_pending_triggered_effect", true));
      }
      expect(card(state, "leave-eiki")).toMatchObject({
        zone: "trash",
        normalCoreCount: 0,
      });
      expect(card(state, "leave-other")).toMatchObject({
        zone: "trash",
        normalCoreCount: 0,
      });
      expect(card(state, "leave-sun")).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
      });
      expect(card(state, "leave-old-trash")).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
      });
      expect(state.players.find((p) => p.id === owner)).toMatchObject({
        countValue: 3,
        reserveNormalCoreCount: 1,
        trashNormalCoreCount: 1,
      });
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );
  it(owner + ": 転醒を辞退すれば3枚とも離脱してコアを戻す", () => {
    let state = buildRebirthSimultaneousLeaveScenario(
      ALL_CARDS,
      new URLSearchParams({ owner })
    );
    state = act(state, "resolve_pending_triggered_effect", true);
    for (const id of ["leave-sun", "leave-eiki", "leave-other"])
      expect(card(state, id)).toMatchObject({
        zone: "trash",
        normalCoreCount: 0,
      });
    expect(state.players.find((p) => p.id === owner)).toMatchObject({
      countValue: 2,
      reserveNormalCoreCount: 1,
    });
    expect(state.pendingLeaveEntities).toHaveLength(0);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });
}

it.each([true, false])(
  "付与された破壊時効果も同時破壊を待たせる（辞退=%s）",
  (skip) => {
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 1, handCount: 0 }, {}],
        cardInstances: [
          createCardInstance(lookups.getCardDefinitionById("BSTH04-C01")!, {
            instanceId: "grant-draw-card",
            ownerPlayerId: "alice",
            zone: "deck",
          }),
          createCardInstance(lookups.getCardDefinitionById("BSTH02.5-X01")!, {
            instanceId: "grant-destroyer",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 3,
          }),
          ...["grant-host", "grant-peer"].map((instanceId) =>
            createCardInstance(lookups.getCardDefinitionById("BSTH04-C01")!, {
              instanceId,
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            })
          ),
        ],
      }),
      activePlayerId: "bob",
      step: "attack" as const,
    };
    const grant: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: { kind: "self" },
            grantedEffect: {
              timing: { kind: "card_event", event: "destroy" },
              executionMode: "optional",
              steps: [{ action: { kind: "draw", count: 1 } }],
            },
          },
        },
      ],
    };
    const before = executeEffect({
      state: base,
      effect: grant,
      chainId: "test:grant-sibling:grant",
      sourceInstanceId: "grant-host",
      actingPlayerId: "alice",
      ...lookups,
    });
    const chainId = "test:grant-sibling:destroy";
    let state = finalizeEffectResolution({
      beforeState: before,
      state: executeEffect({
        state: before,
        chainId,
        effect: lookups.getCardDefinitionById("BSTH02.5-X01")!.effects![2]!,
        sourceInstanceId: "grant-destroyer",
        actingPlayerId: "bob",
        targetInstanceIds: ["grant-host", "grant-peer"],
        ...lookups,
      }),
      chainId,
      endLogs: [],
      actingPlayerId: "bob",
      causedBySourceInstanceId: "grant-destroyer",
      ...lookups,
    });
    expect(
      state.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toBe(true);
    for (const id of ["grant-host", "grant-peer"])
      expect(card(state, id)).toMatchObject({
        zone: "field",
        pendingLeaveKind: "destroy",
      });
    state = pass(act(state, "resolve_pending_triggered_effect", skip));
    expect(card(state, "grant-draw-card").zone).toBe(skip ? "deck" : "hand");
    expect(state.players.find((p) => p.id === "alice")?.handCount).toBe(
      skip ? 0 : 1
    );
    for (const id of ["grant-host", "grant-peer"])
      expect(card(state, id)).toMatchObject({
        zone: "trash",
        pendingLeaveKind: null,
      });
    expect(state.pendingLeaveEntities).toHaveLength(0);
  }
);
