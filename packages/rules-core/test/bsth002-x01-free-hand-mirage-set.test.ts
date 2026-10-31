import { replaceCardInstances } from "../src/zone/card-instance-state";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  maskPendingPromptsForViewer,
  queueRegisteredBattleImmediateEffects,
  sanitizeStateForViewer,
} from "../src/runtime";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBattleImmediateEffectActions =
  buildBattleImmediateEffectLookup(ALL_CARDS);

function card(cardNo: string): CardDefinition {
  const def = cardNoMap.get(cardNo);
  if (!def) throw new Error(`missing card: ${cardNo}`);
  return def;
}

describe("BSTH002-X01 free hand mirage set cost", () => {
  function setUp(options?: {
    handMirageCardNo?: string;
    oldMirageCardNo?: string | null;
  }) {
    const sourceDef = card("BSTH002-X01");
    const mirageDef = card(options?.handMirageCardNo ?? "BSTH002-C04");
    const oldMirageDef =
      options?.oldMirageCardNo === null
        ? null
        : card(options?.oldMirageCardNo ?? "BSTH002-R02");
    const enemyDef = card("BSTH002-R03");
    const source = createCardInstance(sourceDef, {
      instanceId: "rika-ex",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const handMirage = createCardInstance(mirageDef, {
      instanceId: "hand-mirage",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const oldMirage =
      oldMirageDef !== null
        ? createCardInstance(oldMirageDef, {
            instanceId: "old-mirage",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "mirage",
          })
        : null;
    const enemy1 = createCardInstance(enemyDef, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(enemyDef, {
      instanceId: "enemy-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const existingDeck = createCardInstance(enemyDef, {
      instanceId: "bob-existing-deck",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const aliceDeck = createCardInstance(enemyDef, {
      instanceId: "alice-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        handMirage,
        ...(oldMirage ? [oldMirage] : []),
        enemy1,
        enemy2,
        existingDeck,
        aliceDeck,
      ],
      playerOverrides: [{ handCount: 1, deckCount: 1 }, { deckCount: 1 }],
      mirageSetStates: oldMirage
        ? [{ playerId: "alice", cardInstanceId: "old-mirage" }]
        : [],
    });
    return { sourceDef, state };
  }

  function executeAttackEffect(
    state: GameState,
    sourceDef: CardDefinition,
    targetInstanceIds: string[],
    mirageInstanceId = "hand-mirage",
    sourceInstanceId = "rika-ex"
  ): GameState {
    return executeEffect({
      chainId: "test:bsth002-x01-free-hand-mirage-set:121",
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      targetInstanceIds,
      targetGroups: [
        {
          targetStepId: "selectMirage",
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateTargetInstanceIds: [mirageInstanceId],
          candidateTargetZones: ["hand"],
        },
        {
          targetStepId: "rika-ex-bottom-deck-targets",
          requiredTargetCount: 0,
          maxTargetCount: 2,
          candidateTargetInstanceIds: targetInstanceIds.filter((id) =>
            id.startsWith("enemy-")
          ),
          candidateTargetZones: ["field"],
        },
      ],
    });
  }

  function resolveRecoverChoice(
    state: GameState,
    choice: "execute" | "decline"
  ): GameState {
    const pending = state.pendingStepOptionalChoice!;
    expect(pending).not.toBeNull();
    return applyLegalAction({
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:${choice}`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  it("BSTH002-X01: 化け化けの全個別交換を選んでも先行選択・敵2番目・回復・使用履歴を保持する", () => {
    for (const existingExempt of [false, true])
      for (const incomingExempt of [false, true]) {
        const replacements =
          !existingExempt && !incomingExempt
            ? ["other-mirage"]
            : [null, "old-mirage", "other-mirage"];
        for (const replacement of replacements) {
          const { sourceDef, state: original } = setUp({
            handMirageCardNo: incomingExempt ? "BSTH002-C01" : "BSTH002-R02",
            oldMirageCardNo: "BSTH002-C01",
          });
          const other = createCardInstance(
            card(existingExempt ? "BSTH002-C01" : "BSTH002-R02"),
            {
              instanceId: "other-mirage",
              ownerPlayerId: "alice",
              zone: "mirage",
            }
          );
          // この回帰は交換選択をまたぐ敵2番目の保持を調べる。相手には離脱時選択を持たない実カードを使う。
          const prepared = replaceCardInstances(
            original,
            original.cardInstances.map((instance) =>
              instance.instanceId.startsWith("enemy-")
                ? { ...instance, definitionId: "BSTH002-C02" }
                : instance
            )
          );
          const state = {
            ...prepared,
            cardInstances: [...prepared.cardInstances, other],
            mirageSetStates: [
              ...original.mirageSetStates,
              { playerId: "alice", cardInstanceId: other.instanceId },
            ],
            mirageSetPlayerIdsThisTurn: ["alice"],
            mirageSetCountExemptionsUsed: [
              { playerId: "alice", cardNo: "BSTH002-C01" },
            ],
          };
          let after = executeAttackEffect(state, sourceDef, [
            "hand-mirage",
            "enemy-2",
          ]);
          if (replacements.length > 1) {
            const choices = getLegalActions({
              state: after,
              actingPlayerId: "alice",
              getCardDefinitionById,
              getRegisteredTriggeredEffectActions,
            }).filter(
              (action) => action.kind === "resolve_pending_step_choice"
            );
            expect(choices).toHaveLength(3);
            const selected = choices.find(
              (action) =>
                action.kind === "resolve_pending_step_choice" &&
                (replacement === null
                  ? action.choiceLabel === "追加"
                  : action.choiceLabel.includes(
                      replacement === "old-mirage" ? "セット1" : "セット2"
                    ))
            );
            expect(selected).toBeDefined();
            after = applyLegalAction({
              state: after,
              action: selected!,
              getCardDefinitionById,
              getRegisteredTriggeredEffectActions,
            }).state;
          }
          after = flushPendingLeaves(
            resolveRecoverChoice(after, "execute"),
            getCardDefinitionById
          );
          expect(
            after.cardInstances.find(
              (instance) => instance.instanceId === "enemy-1"
            )?.zone
          ).toBe("field");
          expect(
            after.cardInstances.find(
              (instance) => instance.instanceId === "enemy-2"
            )?.zone,
            JSON.stringify({
              existingExempt,
              incomingExempt,
              replacement,
              log: after.log,
              choice: after.pendingStepChoice,
              optional: after.pendingStepOptionalChoice,
            })
          ).toBe("deck");
          expect(
            after.cardInstances.find(
              (instance) => instance.instanceId === "rika-ex"
            )?.exhaustState
          ).toBe("recovered");
          expect(
            after.mirageSetStates.map((entry) => entry.cardInstanceId).sort()
          ).toEqual(
            ["old-mirage", "other-mirage"]
              .filter((id) => id !== replacement)
              .concat("hand-mirage")
              .sort()
          );
          for (const id of ["old-mirage", "other-mirage"])
            expect(
              after.cardInstances.find((instance) => instance.instanceId === id)
                ?.zone
            ).toBe(id === replacement ? "hand" : "mirage");
          expect(after.mirageSetPlayerIdsThisTurn).toEqual(
            state.mirageSetPlayerIdsThisTurn
          );
          expect(after.mirageSetCountExemptionsUsed).toEqual(
            state.mirageSetCountExemptionsUsed
          );
          expect(after.stackWindow).toBeNull();
          expect(after.pendingStepChoice).toBeNull();
        }
      }
  });

  function queueActionResolutionTriggers(
    beforeState: GameState,
    afterState: GameState,
    chainId: string
  ): GameState {
    return collectAndQueueTriggerReactions({
      beforeState,
      afterState,
      source: "action_resolution",
      chainId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
      causedByPlayerId: "alice",
      causedBySourceInstanceId: "rika-ex",
    });
  }

  function resolveMirageSetDraw(state: GameState): GameState {
    let current = state;
    while (current.pendingBurstChecks.length > 0) {
      const check = current.pendingBurstChecks[0]!;
      current = applyLegalAction({
        state: current,
        action: {
          chainId: "test:bsth002-x01-free-hand-mirage-set:199",
          kind: "decline_pending_burst_check",
          actionId: `decline:${check.checkId}`,
          can: true,
          reason: "test",
          actingPlayerId: check.actingPlayerId,
          checkId: check.checkId,
          eventKind: check.eventKind,
          relatedPlayerId: check.relatedPlayerId,
        },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      }).state;
    }
    const matching = current.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "mirage_set" && p.relatedInstanceId === "hand-mirage"
    );
    expect(matching).toHaveLength(1);

    const resolveAction = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "mirage_set" &&
        a.sourceInstanceId === "hand-mirage"
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: current,
      action: resolveAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(declared.window).toBe("stack");

    return applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass-stack",
        can: true,
        reason: "test",
        actingPlayerId: declared.stackWindow!.priorityPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  function cannotBeSentToDeckCE(
    targetInstanceId: string,
    sourceDefinitionId: string
  ): ContinuousEffect {
    return {
      effectId: `test-cannot-deck-${targetInstanceId}`,
      sourceInstanceId: `test-source-${sourceDefinitionId}`,
      sourceDefinitionId,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "cannot_be_sent_to_deck",
      targetInstanceId,
      metadata: { source: "opponent_effect" },
    };
  }

  it("BSTH002-X01: production legal action で手札ミラージュ対象グループを公開する", () => {
    const { sourceDef, state } = setUp();
    const source = state.cardInstances.find(
      (instance) => instance.instanceId === "rika-ex"
    )!;
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-rika-ex",
      participantEntityId: "rika-ex",
      actingPlayerId: "alice",
      sourceCard: source,
      sourceDefinition: sourceDef,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions,
      simultaneousGroupId: "sg-rika-ex",
    });

    expect(queued.battleImmediateEffects).toHaveLength(1);

    const action = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBattleImmediateEffectActions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_battle_immediate_effect" &&
        candidate.sourceInstanceId === "rika-ex" &&
        candidate.sourceCardNo === "BSTH002-X01" &&
        candidate.skipOnly !== true
    );

    expect(action).toBeDefined();
    if (!action || action.kind !== "resolve_battle_immediate_effect") {
      throw new Error("missing BSTH002-X01 battle immediate action");
    }

    const selectMirageGroup = action.targetGroups?.find(
      (group) => group.targetStepId === "selectMirage"
    );
    expect(selectMirageGroup).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 1,
      candidateTargetZones: ["hand"],
      candidateTargetInstanceIds: ["hand-mirage"],
    });

    const bottomDeckGroup = action.targetGroups?.find(
      (group) => group.targetStepId === "rika-ex-bottom-deck-targets"
    );
    expect(bottomDeckGroup).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 2,
      candidateTargetZones: ["field"],
      candidateTargetInstanceIds: ["enemy-1", "enemy-2"],
    });
    expect(action.candidateTargetInstanceIds).toEqual([
      "hand-mirage",
      "enemy-1",
      "enemy-2",
    ]);
  });

  it("BSTH002-X01: 手札の白/紫ミラージュをコストなしでセットし、相手2体をデッキ下へ戻して任意回復を実行する", () => {
    const { sourceDef, state } = setUp();
    const resolved = executeAttackEffect(state, sourceDef, [
      "hand-mirage",
      "enemy-1",
      "enemy-2",
    ]);
    expect(resolved.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "rika-ex",
      stepIndex: 3,
    });

    const afterRecover = resolveRecoverChoice(resolved, "execute");
    const withMirageSetTrigger = queueActionResolutionTriggers(
      state,
      afterRecover,
      "test:rika-ex:attack"
    );
    const result = flushPendingLeaves(
      withMirageSetTrigger,
      getCardDefinitionById
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage")
    ).toMatchObject({ zone: "mirage", zoneRoleName: "spirit-card" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "old-mirage")
    ).toMatchObject({ zone: "hand" });
    expect(result.mirageSetStates).toEqual([
      { playerId: "alice", cardInstanceId: "hand-mirage" },
    ]);
    expect(result.players.find((p) => p.id === "alice")?.handCount).toBe(1);
    expect(
      result.cardInstances.find((c) => c.instanceId === "rika-ex")
    ).toMatchObject({ exhaustState: "recovered" });
    expect(
      result.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-existing-deck", "enemy-1", "enemy-2"]);

    const afterDraw = resolveMirageSetDraw(result);
    expect(afterDraw.players.find((p) => p.id === "alice")?.handCount).toBe(2);
    expect(afterDraw.players.find((p) => p.id === "alice")?.deckCount).toBe(0);
  });

  it("BSTH002-X01: 0体選択で回復も辞退するとミラージュセットを巻き戻す", () => {
    const { sourceDef, state } = setUp();
    const resolved = executeAttackEffect(state, sourceDef, ["hand-mirage"]);
    expect(
      resolved.pendingStepOptionalChoice?.continuation.stepContext
        .pendingConditionalCostRollback?.originalState
    ).toBeDefined();
    expect(
      sanitizeStateForViewer(resolved, "alice").pendingStepOptionalChoice
        ?.continuation.stepContext.pendingConditionalCostRollback
    ).toBeUndefined();
    expect(
      maskPendingPromptsForViewer(resolved, "alice").pendingStepOptionalChoice
        ?.continuation.stepContext.pendingConditionalCostRollback
    ).toBeUndefined();

    const afterDecline = resolveRecoverChoice(resolved, "decline");
    expect(afterDecline.pendingTriggeredEffects).toHaveLength(0);
    const withMirageSetTrigger = queueActionResolutionTriggers(
      state,
      afterDecline,
      "test:rika-ex:attack:decline"
    );
    const result = flushPendingLeaves(
      withMirageSetTrigger,
      getCardDefinitionById
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage")
    ).toMatchObject({ zone: "hand" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "old-mirage")
    ).toMatchObject({ zone: "mirage" });
    expect(result.mirageSetStates).toEqual([
      { playerId: "alice", cardInstanceId: "old-mirage" },
    ]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "rika-ex")
    ).toMatchObject({ exhaustState: "exhausted" });
    expect(result.players.find((p) => p.id === "alice")?.handCount).toBe(1);
    expect(
      result.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "mirage_set" || p.eventKind === "increase_hand"
      )
    ).toHaveLength(0);
    expect(result.log).toContain(
      "effect:conditional-cost-target-shortage:rika-ex"
    );
    expect(
      result.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-existing-deck"]);
  });

  it("BSTH002-X01: rollback で戻った旧ミラージュのセット時誘発を誤キューしない", () => {
    const { sourceDef, state } = setUp({
      handMirageCardNo: "BSTH002-R02",
      oldMirageCardNo: "BSTH002-C04",
    });
    const resolved = executeAttackEffect(state, sourceDef, ["hand-mirage"]);
    const afterDecline = resolveRecoverChoice(resolved, "decline");
    const result = flushPendingLeaves(afterDecline, getCardDefinitionById);

    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage")
    ).toMatchObject({ zone: "hand" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "old-mirage")
    ).toMatchObject({ zone: "mirage" });
    expect(result.mirageSetStates).toEqual([
      { playerId: "alice", cardInstanceId: "old-mirage" },
    ]);
    expect(
      result.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "mirage_set" || p.eventKind === "increase_hand"
      )
    ).toHaveLength(0);
  });

  it("BSTH002-X01: 0体選択でも回復を実行すればミラージュセットは成立する", () => {
    const { sourceDef, state } = setUp();
    const resolved = executeAttackEffect(state, sourceDef, ["hand-mirage"]);
    const afterRecover = resolveRecoverChoice(resolved, "execute");
    const result = flushPendingLeaves(afterRecover, getCardDefinitionById);

    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage")
    ).toMatchObject({ zone: "mirage", zoneRoleName: "spirit-card" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "old-mirage")
    ).toMatchObject({ zone: "hand" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "rika-ex")
    ).toMatchObject({ exhaustState: "recovered" });
    expect(result.players.find((p) => p.id === "alice")?.handCount).toBe(1);
    expect(
      result.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "mirage_set" && p.relatedInstanceId === "hand-mirage"
      )
    ).toHaveLength(1);
    expect(result.log).not.toContain(
      "effect:conditional-cost-target-shortage:rika-ex"
    );
    expect(
      result.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-existing-deck"]);
  });

  it("BSTH002-X01: 白1色の防止効果には阻まれ、白以外や多色白の防止効果は貫通する", () => {
    const whiteCase = setUp();
    const whiteProtected: GameState = {
      ...whiteCase.state,
      activeContinuousEffects: [cannotBeSentToDeckCE("enemy-1", "BSTH002-C02")],
    };
    const whiteResolved = executeAttackEffect(
      whiteProtected,
      whiteCase.sourceDef,
      ["hand-mirage", "enemy-1"]
    );
    const whiteResult = flushPendingLeaves(
      resolveRecoverChoice(whiteResolved, "execute"),
      getCardDefinitionById
    );
    expect(
      whiteResult.cardInstances.find((c) => c.instanceId === "enemy-1")
    ).toMatchObject({ zone: "field" });

    const purpleCase = setUp();
    const purpleProtected: GameState = {
      ...purpleCase.state,
      activeContinuousEffects: [cannotBeSentToDeckCE("enemy-1", "BSTH002-C01")],
    };
    const purpleResolved = executeAttackEffect(
      purpleProtected,
      purpleCase.sourceDef,
      ["hand-mirage", "enemy-1"]
    );
    const purpleResult = flushPendingLeaves(
      resolveRecoverChoice(purpleResolved, "execute"),
      getCardDefinitionById
    );
    expect(
      purpleResult.cardInstances.find((c) => c.instanceId === "enemy-1")
    ).toMatchObject({ zone: "deck" });

    const multiColorCase = setUp();
    const multiColorProtected: GameState = {
      ...multiColorCase.state,
      activeContinuousEffects: [cannotBeSentToDeckCE("enemy-1", "BSLH01-C02")],
    };
    const multiColorResolved = executeAttackEffect(
      multiColorProtected,
      multiColorCase.sourceDef,
      ["hand-mirage", "enemy-1"]
    );
    const multiColorResult = flushPendingLeaves(
      resolveRecoverChoice(multiColorResolved, "execute"),
      getCardDefinitionById
    );
    expect(
      multiColorResult.cardInstances.find((c) => c.instanceId === "enemy-1")
    ).toMatchObject({ zone: "deck" });
  });

  it("BSTH002-X01: 同一ターン2回目の解決はミラージュセットとデッキ下送りだけ実行し、回復ステップは使用済みで飛ばす", () => {
    const { sourceDef, state } = setUp();
    const secondHandMirage = createCardInstance(card("BSTH002-C04"), {
      instanceId: "hand-mirage-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const withSecondMirage: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, secondHandMirage],
      players: state.players.map((player) =>
        player.id === "alice" ? { ...player, handCount: 2 } : player
      ),
    };

    const firstResolved = executeAttackEffect(withSecondMirage, sourceDef, [
      "hand-mirage",
      "enemy-1",
    ]);
    const afterFirstRecoverChoice = resolveRecoverChoice(
      firstResolved,
      "execute"
    );
    const afterFirstRecover = flushPendingLeaves(
      queueActionResolutionTriggers(
        withSecondMirage,
        afterFirstRecoverChoice,
        "test:rika-ex:attack:first"
      ),
      getCardDefinitionById
    );
    const afterFirstDraw = resolveMirageSetDraw(afterFirstRecover);
    const readyForSecondAttack: GameState = {
      ...afterFirstDraw,
      cardInstances: afterFirstDraw.cardInstances.map((instance) =>
        instance.instanceId === "rika-ex"
          ? { ...instance, exhaustState: "exhausted" }
          : instance
      ),
    };

    const secondResolved = executeAttackEffect(
      readyForSecondAttack,
      sourceDef,
      ["hand-mirage-2", "enemy-2"],
      "hand-mirage-2"
    );
    const result = flushPendingLeaves(secondResolved, getCardDefinitionById);

    expect(secondResolved.pendingStepOptionalChoice).toBeNull();
    expect(secondResolved.log).toContain(
      "effect:step-usage-exhausted:rika-ex:0:3"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage-2")
    ).toMatchObject({ zone: "mirage", zoneRoleName: "spirit-card" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-mirage")
    ).toMatchObject({ zone: "hand" });
    expect(
      result.cardInstances.find((c) => c.instanceId === "rika-ex")
    ).toMatchObject({ exhaustState: "exhausted" });
    expect(
      result.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-existing-deck", "enemy-1", "enemy-2"]);
  });

  it("BSTH002-X01: 回復のターン1回は同名共有ではなく各スピリット個体に適用する", () => {
    const { sourceDef, state } = setUp();
    const secondSource = createCardInstance(sourceDef, {
      instanceId: "rika-ex-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const secondHandMirage = createCardInstance(card("BSTH002-C04"), {
      instanceId: "hand-mirage-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const withSameNameSecondInstance: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, secondSource, secondHandMirage],
      players: state.players.map((player) =>
        player.id === "alice" ? { ...player, handCount: 2 } : player
      ),
    };

    const afterFirstRecovery = resolveRecoverChoice(
      executeAttackEffect(
        withSameNameSecondInstance,
        sourceDef,
        ["hand-mirage", "enemy-1"],
        "hand-mirage",
        "rika-ex"
      ),
      "execute"
    );
    const afterSecondRecovery = resolveRecoverChoice(
      executeAttackEffect(
        afterFirstRecovery,
        sourceDef,
        ["hand-mirage-2", "enemy-2"],
        "hand-mirage-2",
        "rika-ex-2"
      ),
      "execute"
    );

    expect(afterSecondRecovery.log).not.toContain(
      "effect:step-usage-exhausted:rika-ex-2:0:3"
    );
    expect(
      afterSecondRecovery.cardInstances.find(
        (instance) => instance.instanceId === "rika-ex"
      )
    ).toMatchObject({ exhaustState: "recovered" });
    expect(
      afterSecondRecovery.cardInstances.find(
        (instance) => instance.instanceId === "rika-ex-2"
      )
    ).toMatchObject({ exhaustState: "recovered" });
  });
});
