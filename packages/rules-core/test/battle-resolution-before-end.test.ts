import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

function spirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function setup(
  event: "reduce_life" | "destroy" | "leave_field",
  deferredEffect = false,
  handBurst = false
) {
  const attacker: CardDefinition = {
    ...spirit("ORDER-ATTACKER", 5000),
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "battle_end",
          ...(deferredEffect ? { deferredTo: "battle_end" as const } : {}),
        },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 7 } },
          { deferTo: "battle_end", action: { kind: "end_attack_step" } },
        ],
      },
    ],
  };
  const observer: CardDefinition = {
    ...spirit("ORDER-OBSERVER", 1000),
    effects: [
      {
        timing: { kind: "game_event", event, player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
  const blocker = spirit("ORDER-BLOCKER", 1000);
  const burst: CardDefinition = {
    ...spirit("ORDER-BURST", 1000),
    printedCategory: "magic",
    levelDefs: [],
    symbolColors: [],
    textLines: [
      event === "reduce_life"
        ? "【バースト：自分のライフ減少後】"
        : "【バースト：自分のスピリットが破壊された後】",
    ],
    keywordTags: ["burst"],
    effects: [
      {
        timing: {
          kind: "burst",
          ...(handBurst ? { handSource: true } : {}),
          trigger: {
            kind:
              event === "reduce_life" ? "life_decrease" : "spirit_destroyed",
            player: "self",
          },
        },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
      },
    ],
  };
  const defs = [attacker, observer, blocker, burst];
  const lookups = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: buildBurstEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
  };
  const blocked = event !== "reduce_life";
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attacker, {
          instanceId: "attacker",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(observer, {
          instanceId: "observer",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(blocker, {
          instanceId: "blocker",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(burst, {
          instanceId: "burst",
          ownerPlayerId: "bob",
          zone: handBurst ? "hand" : "burst",
        }),
      ],
      setBurstStates: handBurst
        ? []
        : [{ playerId: "bob", cardInstanceId: "burst" }],
    }),
    turnNumber: 4,
    activePlayerId: "alice",
    step: "attack",
    window: "battle_resolution",
    activeAttack: {
      attackId: "attack:order",
      primaryEntityId: "atk",
      participantEntityIds: ["atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "atk",
          blockedByEntityIds: blocked ? ["blk"] : [],
        },
      ],
      symbolResolutionOrder: ["atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
    battleEntities: [
      {
        entityId: "atk",
        memberInstanceIds: ["attacker"],
        attackState: "attacking",
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
      },
      {
        entityId: "blk",
        memberInstanceIds: ["blocker"],
        attackState: blocked ? "blocking" : "idle",
        resolvedBp: 1000,
        resolvedSymbols: ["red"],
      },
    ],
  };
  return {
    state: handBurst
      ? {
          ...state,
          cardInstances: state.cardInstances.filter(
            (c) => c.instanceId !== "observer"
          ),
        }
      : state,
    lookups,
  };
}

describe("バトル解決の誘発・バースト → バトル終了時 → アタックステップ終了", () => {
  it.each(
    (["reduce_life", "destroy", "leave_field"] as const)
      .flatMap((event) =>
        [false, true].map((deferredEffect) => ({
          event,
          deferredEffect,
          handBurst: false,
        }))
      )
      .concat([
        { event: "reduce_life", deferredEffect: false, handBurst: true },
      ])
  )(
    "$event の誘発とバーストの後、終了時誘発の終了予約を解決（効果全体の予約=$deferredEffect、手札バーストのみ=$handBurst）",
    ({ event, deferredEffect, handBurst }) => {
      const ctx = setup(event, deferredEffect, handBurst);
      let state = executeBattleResolution({
        state: ctx.state,
        ...ctx.lookups,
      }).state;
      expect(state.pendingImmediateBattleEnds).toHaveLength(1);
      expect(
        state.pendingImmediateBattleEnds[0]?.battleEndEntryStarted
      ).not.toBe(true);
      expect(
        state.pendingTriggeredEffects.some((p) => p.eventKind === "battle_end")
      ).toBe(false);
      const counts = () => state.players.map((p) => p.countValue);
      let sawBattleEnd = false;
      for (let i = 0; i < 40 && state.step === "attack"; i++) {
        const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...ctx.lookups })
        );
        const action =
          actions.find((a) => a.can && a.kind === "pass_stack") ??
          actions.find(
            (a) =>
              a.can &&
              a.kind === "resolve_pending_burst_check" &&
              a.sourceInstanceId === "burst"
          ) ??
          actions.find(
            (a) => a.can && a.kind === "resolve_pending_triggered_effect"
          ) ??
          actions.find(
            (a) => a.can && a.kind === "resolve_pending_burst_check"
          );
        expect(
          action,
          JSON.stringify({
            actions: actions.map((a) => a.kind),
            counts: counts(),
            pending: state.pendingImmediateBattleEnds,
          })
        ).toBeDefined();
        if (
          action!.kind === "resolve_pending_triggered_effect" &&
          action!.eventKind === "battle_end"
        ) {
          sawBattleEnd = true;
          expect(counts()).toEqual([0, handBurst ? 2 : 3]);
          if (!handBurst) {
            expect(
              state.cardInstances.find((c) => c.instanceId === "burst")!.zone
            ).toBe("trash");
          }
        }
        state = applyLegalAction({
          state,
          action: action!,
          ...ctx.lookups,
        }).state;
      }
      expect(sawBattleEnd).toBe(true);
      expect(counts()).toEqual([7, handBurst ? 2 : 3]);
      expect(state.step).toBe("end");
      expect(state.pendingImmediateBattleEnds).toHaveLength(0);
      expect(state.pendingBattleEndDeferrals).toHaveLength(0);
      expect(state.pendingAttackStepEndFinalizations).toHaveLength(0);
    }
  );
});
