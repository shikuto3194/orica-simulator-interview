import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectAndQueueTriggerReactions,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  finalizeEffectResolution,
  getLegalActions,
  type GameState,
  type PendingLeaveEntity,
  queuePendingLeave,
  useResolvePendingTriggeredEffectAsAction,
  useResolvePendingBurstCheckAsAction,
  executeBattleResolution,
  getAvailableTriggeredEffectSourceChoices,
} from "../src";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
function initialState() {
  const instance = (
    no: string,
    id: string,
    zone: "field" | "trash" | "deck",
    cores = 0
  ) =>
    createCardInstance(getCardDefinitionById(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount: cores,
    });
  const host = instance("BSAZ02-R02", "niro", "field", 1);
  host.underCards = [
    {
      cardInstanceId: "drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  const drive = instance("BSAZ02-C10", "drive", "field");
  drive.attachedToInstanceId = "niro";
  const before = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      host,
      drive,
      instance("BSAZ02-X04", "vers", "field"),
      instance("BSAZ02-M04", "moon", "trash"),
      ...Array.from({ length: 6 }, (_, i) =>
        instance("BSAZ02-M01", `deck-${i}`, "deck")
      ),
    ],
  });
  before.step = "main";
  return before;
}
function setup(deferred = false) {
  const before = initialState();
  if (deferred) {
    let queued = collectAndQueueTriggerReactions({
      beforeState: {
        ...before,
        cardInstances: before.cardInstances.map((c) =>
          c.instanceId === "niro"
            ? { ...c, zone: "hand" as const, zoneRoleName: "ultimate" as const }
            : c
        ),
      },
      afterState: before,
      source: "action_resolution",
      chainId: "niro-summon",
      attackId: null,
      ...lookups,
    });
    for (let i = 0; i < 8; i++) {
      const available = actions(queued);
      if (
        available.some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "niro"
        )
      )
        break;
      const skip = available.find(
        (a) => a.kind === "resolve_pending_triggered_effect"
      );
      if (!skip) break;
      queued = applyLegalAction({
        state: queued,
        action: skip,
        skipOptionalEffect: true,
        ...lookups,
      }).state;
    }
    const declare = actions(queued).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "niro"
    );
    expect(declare, JSON.stringify(actions(queued))).toBeDefined();
    let state = applyLegalAction({
      state: queued,
      action: declare!,
      ...lookups,
    }).state;
    for (let i = 0; i < 4 && state.stackWindow; i++) {
      const pass = actions(state).find((a) => a.kind === "pass_stack")!;
      state = applyLegalAction({ state, action: pass, ...lookups }).state;
    }
    return state;
  }
  const state = executeEffect({
    state: before,
    effect: getCardDefinitionById("BSAZ02-R02")!.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "niro",
    actingPlayerId: "alice",
    chainId: "niro-destroy",
    rangeAutoResolveStrategy: "max",
    ...lookups,
  });
  return finalizeEffectResolution({
    state,
    beforeState: before,
    chainId: "niro-destroy",
    endLogs: [],
    actingPlayerId: "alice",
    causedBySourceInstanceId: "niro",
    ...lookups,
  });
}
const actions = (state: GameState) =>
  ["alice", "bob"]
    .flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    )
    .filter((a) => a.can);
describe("火星ネクサス実離脱のトラッシュ誘発", () => {
  it.each([false, true])(
    "ニロケラスによる自分のアリューシア破壊後に眠れる月の少女を回収できる (選択=%s)",
    (deferred) => {
      let state = setup(deferred);
      if (deferred) {
        const action = actions(state).find(
          (a) => a.kind === "resolve_pending_effect_target"
        );
        expect(action, JSON.stringify(actions(state))).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          targetInstanceIds: ["vers"],
          ...lookups,
        }).state;
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "vers")?.zone
      ).toBe("trash");
      const choices = actions(state);

      const declare = choices.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "moon"
      );
      expect(declare).toBeDefined();
      state = applyLegalAction({ state, action: declare!, ...lookups }).state;
      for (
        let i = 0;
        i < 12 &&
        state.cardInstances.find((c) => c.instanceId === "moon")?.zone !==
          "hand";
        i++
      ) {
        const action = actions(state).find(
          (a) =>
            a.kind === "pass_stack" ||
            a.kind === "resolve_pending_triggered_effect"
        );
        expect(action, JSON.stringify(actions(state))).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "moon")?.zone
      ).toBe("hand");
    }
  );
});

const leaveKinds: PendingLeaveEntity["kind"][] = [
  "destroy",
  "vanish",
  "bounce",
  "remove_from_game",
];
describe("同類監査: トラッシュ常駐の離脱後回収", () => {
  for (const cardNo of ["BSAZ02-M04", "BSAZ01-C06"]) {
    for (const causePlayerId of ["alice", "bob"]) {
      it.each(leaveKinds)(
        `${cardNo}: ${causePlayerId} の %s は実移動後に一度だけ回収`,
        (kind) => {
          const initial = initialState();
          const moon = initial.cardInstances.find(
            (c) => c.instanceId === "moon"
          )!;
          moon.definitionId = cardNo;
          const queued = collectAndQueueTriggerReactions({
            beforeState: {
              ...initial,
              cardInstances: initial.cardInstances.map((c) =>
                c.instanceId === "niro" ? { ...c, zone: "hand" as const } : c
              ),
            },
            afterState: initial,
            source: "action_resolution",
            chainId: "audit-summon",
            attackId: null,
            ...lookups,
          });
          const pending = queued.pendingTriggeredEffects.find((p) =>
            getAvailableTriggeredEffectSourceChoices({
              state: queued,
              pendingEffect: p,
              ...lookups,
            }).some((c) => c.sourceCard.instanceId === "niro")
          )!;
          expect(pending).toBeDefined();
          const state = useResolvePendingTriggeredEffectAsAction({
            state: { ...queued, pendingTriggeredEffects: [pending] },
            pendingId: pending.pendingId,
            actingPlayerId: pending.actingPlayerId,
            resolveEffect: (state, context) =>
              queuePendingLeave({
                state,
                instanceId: "vers",
                kind,
                ...(kind === "bounce"
                  ? { leaveDestination: { zone: "hand" as const } }
                  : {}),
                cause: "effect_resolution",
                causePlayerId,
                chainId: context.chainId,
              }),
            ...lookups,
          }).state;
          expect(
            state.cardInstances.find((c) => c.instanceId === "vers")?.zone
          ).toBe(
            kind === "bounce"
              ? "hand"
              : kind === "remove_from_game"
                ? "removed_from_game"
                : "trash"
          );
          const recover = actions(state).filter(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "moon"
          );
          if (cardNo === "BSAZ01-C06" && causePlayerId === "alice") {
            expect(recover).toHaveLength(0);
            return;
          }
          expect(recover).toHaveLength(1);
          let after = applyLegalAction({
            state,
            action: recover[0]!,
            ...lookups,
          }).state;
          for (let i = 0; i < 4 && after.stackWindow; i++)
            after = applyLegalAction({
              state: after,
              action: actions(after).find((a) => a.kind === "pass_stack")!,
              ...lookups,
            }).state;
          expect(
            after.cardInstances.find((c) => c.instanceId === "moon")?.zone
          ).toBe("hand");
          expect(
            after.pendingTriggeredEffects.filter(
              (p) => p.eventKind === "leave_field"
            )
          ).toHaveLength(0);
        }
      );
    }
  }
  it("同じ離脱を見た同名2枚の回収はターンに1枚", () => {
    let state = setup(true);
    const other = createCardInstance(getCardDefinitionById("BSAZ02-M04")!, {
      instanceId: "moon-2",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    state = { ...state, cardInstances: [...state.cardInstances, other] };
    state = applyLegalAction({
      state,
      action: actions(state).find(
        (a) => a.kind === "resolve_pending_effect_target"
      )!,
      targetInstanceIds: ["vers"],
      ...lookups,
    }).state;
    expect(
      actions(state).filter(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceDefinitionId === "BSAZ02-M04"
      )
    ).toHaveLength(2);
    const declare = actions(state).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "moon"
    )!;
    state = applyLegalAction({ state, action: declare, ...lookups }).state;
    state = applyLegalAction({
      state,
      action: actions(state).find((a) => a.kind === "pass_stack")!,
      ...lookups,
    }).state;
    expect(state.cardInstances.find((c) => c.instanceId === "moon")?.zone).toBe(
      "hand"
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "moon-2")?.zone
    ).toBe("trash");
    expect(
      actions(state).some(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "moon-2"
      )
    ).toBe(false);
  });
});

describe("誘発・バーストの全終了分岐", () => {
  it.each(["normal", "before_each_step", "after_sba"] as const)(
    "%s: バースト解決終了の実離脱も回収誘発を配送する",
    (timing) => {
      const before = initialState();
      const check = {
        checkId: "audit-burst",
        actingPlayerId: "alice",
        eventKind: "life_reduced" as const,
        source: "action_resolution" as const,
        chainId: "audit",
        attackId: null,
        relatedPlayerId: "alice",
        amount: 1,
        step: before.step,
        window: before.window,
        resolvedBurstCardInstanceIds: [],
      };
      const leave = (state: GameState) =>
        queuePendingLeave({
          state,
          instanceId: "vers",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "burst:audit-burst",
        });
      let state = useResolvePendingBurstCheckAsAction({
        state: {
          ...(timing === "before_each_step" ? leave(before) : before),
          pendingBurstChecks: [check],
        },
        actingPlayerId: "alice",
        checkId: check.checkId,
        resolveEffect: leave,
        ...(timing === "normal"
          ? {}
          : {
              reevaluation: {
                sourceInstanceId: "niro",
                targetInstanceIds: ["missing-target"],
                registration: {
                  reevaluationPoints: [
                    {
                      timing,
                      checks: ["target_validity" as const],
                      failurePolicy: "abort_remaining" as const,
                    },
                  ],
                },
              },
            }),
        ...lookups,
      }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "vers")?.zone
      ).toBe("trash");
      expect(
        actions(state).filter(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "moon"
        )
      ).toHaveLength(1);
      state = applyLegalAction({
        state,
        action: actions(state).find(
          (action) =>
            action.kind === "resolve_pending_triggered_effect" &&
            action.sourceInstanceId === "moon"
        )!,
        ...lookups,
      }).state;
      for (let guard = 0; guard < 4 && state.stackWindow; guard++) {
        state = applyLegalAction({
          state,
          action: actions(state).find(
            (action) => action.kind === "pass_stack"
          )!,
          ...lookups,
        }).state;
      }
      expect(
        state.cardInstances.find((card) => card.instanceId === "moon")?.zone
      ).toBe("hand");
      if (timing !== "normal")
        expect(
          state.log.some((line) =>
            line.includes(`reevaluation:${timing}:failed`)
          )
        ).toBe(true);
    }
  );
});

it("同類監査: バトル破壊で離れたブレイヴも出撃を誘発する", () => {
  const attacker = {
    ...getCardDefinitionById("BSAZ02-R02")!,
    cardNo: "TEST-LEAVE-BATTLE-ATTACKER",
    effects: [],
    printedCategory: "spirit" as const,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 10000 }],
  };
  const victim = {
    ...attacker,
    cardNo: "TEST-LEAVE-BATTLE-BRAVE",
    printedCategory: "brave" as const,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  };
  const definitions = [...ALL_CARDS, attacker, victim];
  const battleLookups = {
    ...lookups,
    getCardDefinitionById: (id: string) =>
      definitions.find((c) => c.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
  };
  const before = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(attacker, {
        instanceId: "winner",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(victim, {
        instanceId: "victim",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(getCardDefinitionById("BSAZ01-C06")!, {
        instanceId: "recovery",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ],
  });
  const battle: GameState = {
    ...before,
    step: "attack",
    activePlayerId: "bob",
    activeAttack: {
      attackId: "audit-battle",
      primaryEntityId: "winner-entity",
      participantEntityIds: ["winner-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        {
          participantEntityId: "winner-entity",
          blockedByEntityIds: ["victim-entity"],
        },
      ],
      symbolResolutionOrder: ["winner-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
    battleEntities: [
      {
        entityId: "winner-entity",
        memberInstanceIds: ["winner"],
        resolvedBp: 10000,
        resolvedSymbols: ["white"],
        attackState: "attacking",
      },
      {
        entityId: "victim-entity",
        memberInstanceIds: ["victim"],
        resolvedBp: 1000,
        resolvedSymbols: ["white"],
        attackState: "blocking",
      },
    ],
  };
  const after = executeBattleResolution({
    state: battle,
    ...battleLookups,
  }).state;
  expect(after.cardInstances.find((c) => c.instanceId === "victim")?.zone).toBe(
    "trash"
  );
  const available = getLegalActions({
    state: after,
    actingPlayerId: "alice",
    ...battleLookups,
  });
  expect(
    available.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "recovery"
    )
  ).toHaveLength(1);
  const recovery = available.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "recovery"
  )!;
  let recovered = applyLegalAction({
    state: after,
    action: recovery,
    ...battleLookups,
  }).state;
  const pass = getLegalActions({
    state: recovered,
    actingPlayerId: "bob",
    ...battleLookups,
  }).find((a) => a.kind === "pass_stack")!;
  recovered = applyLegalAction({
    state: recovered,
    action: pass,
    ...battleLookups,
  }).state;
  expect(
    recovered.cardInstances.find((c) => c.instanceId === "recovery")?.zone
  ).toBe("hand");
});
