import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
  type GameState,
} from "../src";
import { canUseEffectByUsageLimit } from "../src/legal/legal-actions-shared";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const source = definitions.get("BSLH01-C05")!;
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: () => [],
};
const productionLookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredBattleImmediateEffectActions: () => undefined,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => undefined,
};

function summonEvent(
  playerId: string,
  relatedInstanceId: string
): CollectedTriggerEvent {
  return {
    actingPlayerId: playerId,
    eventKind: "summon",
    source: "action_resolution",
    chainId: "test:bslh01-c05-mandatory-followup:35",
    attackId: null,
    relatedPlayerId: playerId,
    relatedInstanceId,
    amount: null,
    fromZone: "hand",
  };
}

function queuedSummon(
  state: GameState,
  playerId: string,
  relatedInstanceId: string
) {
  return queuePendingReactionsFromTriggerEvents(
    state,
    [summonEvent(playerId, relatedInstanceId)],
    undefined,
    productionLookups
  );
}

function c05ResolveAction(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    ...productionLookups,
  }).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      action.sourceInstanceId === sourceInstanceId &&
      action.sourceCardNo === source.cardNo
  );
}

function closeCurrentStack(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 8 && current.stackWindow; guard++) {
    const priorityPlayerId = current.stackWindow.priorityPlayerId;
    const action = getLegalActions({
      state: current,
      actingPlayerId: priorityPlayerId,
      ...productionLookups,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(action).toBeDefined();
    if (!action) break;
    current = applyLegalAction({
      state: current,
      action,
      ...productionLookups,
    }).state;
  }
  return current;
}

function chooseDestroyAndResolve(
  state: GameState,
  playerId: string,
  targetInstanceId: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: playerId,
    ...productionLookups,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_step_choice" &&
      candidate.choiceIndex === 0
  );
  expect(action).toBeDefined();
  let next = applyLegalAction({
    state,
    action: action!,
    ...productionLookups,
  }).state;
  const targetAction = getLegalActions({
    state: next,
    actingPlayerId: playerId,
    ...productionLookups,
  }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
  expect(targetAction).toBeDefined();
  next = applyLegalAction({
    state: next,
    action: targetAction!,
    targetInstanceIds: [targetInstanceId],
    ...productionLookups,
  }).state;
  // 先頭stepの使用制限を消費済みなら、その任意カウント+1の確認は作られない。
  // 後続の破壊/破棄と成功後の処理は同じ経路で解決し切る。
  for (let step = 0; step < 4; step++) {
    const optionalAction = getLegalActions({
      state: next,
      actingPlayerId: playerId,
      ...productionLookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_optional_choice" &&
        candidate.choice === "execute"
    );
    if (!optionalAction) break;
    next = applyLegalAction({
      state: next,
      action: optionalAction!,
      ...productionLookups,
    }).state;
  }
  expect(next.pendingStepOptionalChoice).toBeNull();
  return closeCurrentStack(next);
}

function start(cores: number, branch: "destroy" | "burst") {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "randy",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...[0, 1].map((i) =>
        createCardInstance(definitions.get("BSLH01-C06")!, {
          instanceId: `target-${i}`,
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        })
      ),
      createCardInstance(definitions.get("BSLH01-R05")!, {
        instanceId: "burst",
        ownerPlayerId: "bob",
        zone: "burst",
        faceDown: true,
      }),
    ],
  });
  return executeEffect({
    chainId: "test:bslh01-c05-mandatory-followup:179",
    state: {
      ...base,
      step: "main",
      turnNumber: 3,
      activePlayerId: "alice",
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              countValue: 2,
              trashNormalCoreCount: cores,
              trashSoulCoreCount: 1,
              reserveNormalCoreCount: 0,
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
      setBurstStates: [{ playerId: "bob", cardInstanceId: "burst" }],
    },
    effect: source.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "randy",
    actingPlayerId: "alice",
    choiceIndex: branch === "burst" ? 1 : 0,
    ...lookups,
  });
}

function choose(state: GameState, decision: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === decision
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}

describe("BSLH01-C05: 任意の前段と強制の結果処理を分離する", () => {
  for (const branch of ["destroy", "burst"] as const) {
    for (const cores of [0, 2, 5]) {
      it(`${branch}: 通常コア${cores}個でも後段は選択なしで可能な限り実行する`, () => {
        let state = start(cores, branch);
        expect(state.pendingStepOptionalChoice?.stepIndex).toBe(0);
        expect(state.pendingStepOptionalChoice?.prompt?.sourceText).toBe(
          "ターンに1回、自分のカウント+1できる。"
        );
        state = choose(state, "execute");
        expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
        expect(
          state.pendingStepOptionalChoice?.prompt?.sourceText
        ).not.toContain("破壊/破棄したとき");
        state = choose(state, "execute");
        if (branch === "destroy") {
          expect(
            state.pendingStepOptionalTargetSelection?.candidateInstanceIds
          ).toEqual(["target-0", "target-1"]);
          const action = getLegalActions({
            state,
            actingPlayerId: "alice",
            ...lookups,
          }).find(
            (a) => a.kind === "resolve_pending_step_optional_target_selection"
          )!;
          state = applyLegalAction({
            state,
            action,
            targetInstanceIds: ["target-1"],
            ...lookups,
          }).state;
        }
        expect(state.pendingStepOptionalChoice).toBeNull();
        expect(state.pendingStepChoice).toBeNull();
        expect(state.pendingStepOptionalTargetSelection).toBeNull();
        expect(
          state.cardInstances.find(
            (c) =>
              c.instanceId === (branch === "destroy" ? "target-1" : "burst")
          )?.zone
        ).toBe("trash");
        expect(state.players[0]).toMatchObject({
          countValue: 4,
          reserveNormalCoreCount: Math.min(cores, 3),
          trashNormalCoreCount: Math.max(0, cores - 3),
          trashSoulCoreCount: 1,
          soulCoreLocation: { kind: "trash" },
        });
        expect(
          state.log.filter((entry) =>
            entry.startsWith("effect:step-optional-pending:")
          )
        ).toHaveLength(2);
      });
    }
  }
  it("除去を辞退すれば後段は発揮せず、先頭カウントだけを増やせる", () => {
    let state = choose(start(5, "destroy"), "execute");
    state = choose(state, "decline");
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.players[0]).toMatchObject({
      countValue: 3,
      trashNormalCoreCount: 5,
      reserveNormalCoreCount: 0,
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-1")?.zone
    ).toBe("field");
  });

  it("先頭のカウント増加だけは実際の召喚誘発でターンに1回になり、各個体・相手・次ターンで独立する", () => {
    const countIncreaseUsageLimit = source.effects![0]!.steps[0]!.usageLimit!;
    const countIncreaseUsageLabel = "__step:BSLH01-C05:0:0";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "randy-first",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(source, {
          instanceId: "randy-same-name",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(source, {
          instanceId: "randy-opponent",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(definitions.get("BSLH01-C06")!, {
          instanceId: "opponent-target",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(definitions.get("BSLH01-C06")!, {
          instanceId: "opponent-target-second",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(definitions.get("BSLH01-C06")!, {
          instanceId: "opponent-target-third",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    const queuedFirst = queuedSummon(state, "alice", "randy-first");
    const firstAction = c05ResolveAction(queuedFirst, "alice", "randy-first");
    expect(firstAction).toBeDefined();
    let used = applyLegalAction({
      state: queuedFirst,
      action: firstAction!,
      ...productionLookups,
    }).state;

    used = closeCurrentStack(used);
    expect(used.pendingStepChoice?.stepIndex).toBe(1);
    used = chooseDestroyAndResolve(used, "alice", "opponent-target");
    expect(used.pendingTriggeredEffects).toHaveLength(0);
    expect(used.stackWindow).toBeNull();
    expect(
      used.cardInstances.find((card) => card.instanceId === "opponent-target")
        ?.zone
    ).toBe("trash");

    expect(used.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: source.cardNo,
          sourceInstanceId: "randy-first",
          duration: "turn",
        }),
      ])
    );

    const countAfterFirst = used.players.find(
      (player) => player.id === "alice"
    )!.countValue;
    const queuedFirstAgain = queuedSummon(used, "alice", "randy-first");
    const firstAgainAction = c05ResolveAction(
      queuedFirstAgain,
      "alice",
      "randy-first"
    );
    expect(firstAgainAction).toBeDefined();
    expect(firstAgainAction).not.toMatchObject({ skipOnly: true });
    let afterFirstAgain = applyLegalAction({
      state: queuedFirstAgain,
      action: firstAgainAction!,
      ...productionLookups,
    }).state;
    afterFirstAgain = closeCurrentStack(afterFirstAgain);
    expect(afterFirstAgain.pendingStepChoice?.stepIndex).toBe(1);
    afterFirstAgain = chooseDestroyAndResolve(
      afterFirstAgain,
      "alice",
      "opponent-target-second"
    );
    expect(
      afterFirstAgain.cardInstances.find(
        (card) => card.instanceId === "opponent-target-second"
      )?.zone
    ).toBe("trash");
    expect(
      afterFirstAgain.players.find((player) => player.id === "alice")!
        .countValue
    ).toBe(countAfterFirst + 1);
    expect(afterFirstAgain.log).toContain(
      "effect:step-usage-exhausted:randy-first:0:0"
    );
    expect(
      afterFirstAgain.effectUsageRecords.filter(
        (record) =>
          record.sourceInstanceId === "randy-first" &&
          record.effectLabel === countIncreaseUsageLabel
      )
    ).toHaveLength(1);

    const queuedSameName = queuedSummon(
      afterFirstAgain,
      "alice",
      "randy-same-name"
    );
    expect(queuedSameName.pendingTriggeredEffects).toHaveLength(1);
    const sameNameAction = c05ResolveAction(
      queuedSameName,
      "alice",
      "randy-same-name"
    );
    expect(sameNameAction).toBeDefined();
    let afterSameName = applyLegalAction({
      state: queuedSameName,
      action: sameNameAction!,
      ...productionLookups,
    }).state;
    afterSameName = closeCurrentStack(afterSameName);
    afterSameName = chooseDestroyAndResolve(
      afterSameName,
      "alice",
      "opponent-target-third"
    );
    expect(
      afterSameName.cardInstances.find(
        (card) => card.instanceId === "opponent-target-third"
      )?.zone
    ).toBe("trash");
    expect(afterSameName.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "randy-same-name",
          effectLabel: countIncreaseUsageLabel,
        }),
      ])
    );

    expect(
      canUseEffectByUsageLimit({
        state: afterSameName,
        sourceInstanceId: "randy-same-name",
        sourceDefinitionId: source.cardNo,
        effectLabel: countIncreaseUsageLabel,
        usageLimit: countIncreaseUsageLimit,
      })
    ).toBe(false);
    expect(
      canUseEffectByUsageLimit({
        state: afterSameName,
        sourceInstanceId: "randy-opponent",
        sourceDefinitionId: source.cardNo,
        effectLabel: countIncreaseUsageLabel,
        usageLimit: countIncreaseUsageLimit,
      })
    ).toBe(true);
    expect(
      canUseEffectByUsageLimit({
        state: {
          ...afterSameName,
          turnNumber: afterSameName.turnNumber + 1,
        },
        sourceInstanceId: "randy-same-name",
        sourceDefinitionId: source.cardNo,
        effectLabel: countIncreaseUsageLabel,
        usageLimit: countIncreaseUsageLimit,
      })
    ).toBe(true);
  });
});
