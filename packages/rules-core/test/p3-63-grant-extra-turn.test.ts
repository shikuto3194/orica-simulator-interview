/**
 * P3-63 step 4: `grant_extra_turn` DSL action + turn-system 拡張のユニット検証。
 *
 * BSTH02-M01「自分のターンを行う。ただし、追加したターンで『コアステップ』、
 * 『アタックステップ』は行えない。… 追加したターン終了時、『相手のアタックステップ』の
 * バトル中に戻る」を最小要件で動かす:
 *
 * 1. 取得時: turnNumber++, activePlayerId が ownerPlayerId に切替、step=start、
 *    extraTurnState に savedContext (turnNumber / activePlayerId / step / window /
 *    activeAttack) を保存。
 * 2. advanceStep 中の core / attack はスキップされる。
 * 3. extra turn 終了時 (advanceFromEndStep) に returnContext を復元して
 *    bob のアタックステップ中の状態に戻る。
 */
import { describe, expect, it } from "vitest";
import {
  advanceStep,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, Effect, GameState } from "../src";

const dummyDef: CardDefinition = {
  cardNo: "P3-63-EXTRA-TURN-SRC",
  name: "extra turn test source",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const getCardDefinitionById = (_id: string) => dummyDef;
const triggeredLookup = () => undefined;

function buildBobAttackState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    turnNumber: 5,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
    activeAttack: {
      attackId: "attack-1",
      attackerInstanceId: "bob-attacker",
      defenderPlayerId: "alice",
      blockerInstanceId: null,
      cardEventChainId: null,
      windowState: "battle_resolution",
    } as GameState["activeAttack"],
  };
}

describe("P3-63 step 4: grant_extra_turn + turn-system extra turn", () => {
  it("取得時: turnNumber++ / activePlayer 切替 / extraTurnState に returnContext 保存", () => {
    const initial: GameState = {
      ...buildBobAttackState(),
      turnSummonedCardRefs: [
        {
          playerId: "bob",
          instanceId: "bob-summoned",
          definitionId: "P3-63-BOB-SUMMONED",
          colors: ["purple"],
          category: "spirit",
          tribes: ["CB"],
        },
      ],
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "grant_extra_turn",
            player: "self",
            skipSteps: ["core", "attack"],
            returnPoint: "previous_attack_battle",
          },
        },
      ],
    };

    // actingPlayerId = "alice" (burst owner)
    const result = executeEffect({
      chainId: "test:p3-63-grant-extra-turn:92",
      state: initial,
      effect,
      sourceInstanceId: "n/a",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(result.turnNumber).toBe(6);
    expect(result.activePlayerId).toBe("alice");
    expect(result.step).toBe("start");
    expect(result.window).toBe("none");
    expect(result.activeAttack).toBeNull();
    expect(result.turnSummonedCardRefs).toEqual([]);

    expect(result.extraTurnState).toBeDefined();
    expect(result.extraTurnState?.ownerPlayerId).toBe("alice");
    expect(result.extraTurnState?.skipSteps).toEqual(["core", "attack"]);
    expect(result.extraTurnState?.returnContext).toMatchObject({
      turnNumber: 5,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
    });
    expect(result.extraTurnState?.returnContext?.activeAttack).toMatchObject({
      attackId: "attack-1",
    });
    expect(result.extraTurnState?.returnContext?.turnSummonedCardRefs).toEqual(
      initial.turnSummonedCardRefs
    );
  });

  it("advanceStep: extra turn 中の core / attack は extra-turn-skip でスキップ", () => {
    // alice の extra turn 中。step="start" → core/attack をスキップ → draw/refresh/main/end と進む
    const baseExtra: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 6,
      activePlayerId: "alice",
      step: "start",
      window: "none",
      extraTurnState: {
        ownerPlayerId: "alice",
        skipSteps: ["core", "attack"],
        returnContext: {
          turnNumber: 5,
          activePlayerId: "bob",
          step: "attack",
          window: "none",
          activeAttack: null,
        },
      },
    };

    const afterStart = advanceStep(
      baseExtra,
      getCardDefinitionById,
      triggeredLookup
    );
    // start → (core skip) → draw
    expect(afterStart.step).toBe("draw");
    expect(
      afterStart.log.some((l) =>
        l.startsWith("step:extra-turn-skip:6:alice:core")
      )
    ).toBe(true);

    const afterDraw = advanceStep(
      afterStart,
      getCardDefinitionById,
      triggeredLookup
    );
    expect(afterDraw.step).toBe("refresh");

    const afterRefresh = advanceStep(
      afterDraw,
      getCardDefinitionById,
      triggeredLookup
    );
    expect(afterRefresh.step).toBe("main");

    // main → (attack skip) → end
    const afterMain = advanceStep(
      afterRefresh,
      getCardDefinitionById,
      triggeredLookup
    );
    expect(afterMain.step).toBe("end");
    expect(
      afterMain.log.some((l) =>
        l.startsWith("step:extra-turn-skip:6:alice:attack")
      )
    ).toBe(true);
  });

  it("extra turn 終了 (advanceFromEndStep): returnContext 復元 → bob の attack step に戻る", () => {
    const endState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 6,
      activePlayerId: "alice",
      step: "end",
      window: "end_step_cleanup",
      extraTurnState: {
        ownerPlayerId: "alice",
        skipSteps: ["core", "attack"],
        returnContext: {
          turnNumber: 5,
          activePlayerId: "bob",
          step: "attack",
          window: "none",
          turnSummonedCardRefs: [
            {
              playerId: "bob",
              instanceId: "bob-before-extra",
              definitionId: "P3-63-BOB-BEFORE-EXTRA",
              colors: ["purple"],
              category: "spirit",
              tribes: ["CB"],
            },
          ],
          activeAttack: {
            attackId: "attack-1",
            attackerInstanceId: "bob-attacker",
            defenderPlayerId: "alice",
            blockerInstanceId: null,
            cardEventChainId: null,
            windowState: "battle_resolution",
          } as GameState["activeAttack"],
        },
      },
      turnSummonedCardRefs: [
        {
          playerId: "alice",
          instanceId: "alice-extra-turn-summoned",
          definitionId: "P3-63-ALICE-EXTRA-TURN-SUMMONED",
          colors: ["red"],
          category: "spirit",
          tribes: ["CB"],
        },
      ],
    };

    const restored = advanceStep(
      endState,
      getCardDefinitionById,
      triggeredLookup
    );

    expect(restored.turnNumber).toBe(5);
    expect(restored.activePlayerId).toBe("bob");
    expect(restored.step).toBe("attack");
    expect(restored.window).toBe("none");
    expect(restored.activeAttack).toMatchObject({ attackId: "attack-1" });
    expect(restored.turnSummonedCardRefs).toEqual([
      {
        playerId: "bob",
        instanceId: "bob-before-extra",
        definitionId: "P3-63-BOB-BEFORE-EXTRA",
        colors: ["purple"],
        category: "spirit",
        tribes: ["CB"],
      },
    ]);
    expect(restored.extraTurnState).toBeNull();
    expect(
      restored.log.some((l) =>
        l.startsWith("step:6:alice:extra-turn-end->restore:bob:attack")
      )
    ).toBe(true);
  });

  it("追加ターンから指定アタックへ復帰すると、強制ブロックの事前宣言窓を再開する", () => {
    const attacker = createCardInstance(dummyDef, {
      instanceId: "bob-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(dummyDef, {
      instanceId: "alice-designated-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const activeAttack = {
      attackId: "attack-designated-return",
      primaryEntityId: "attacker-entity",
      participantEntityIds: ["attacker-entity"],
      groupMode: "single" as const,
      target: { kind: "battle_entity" as const, entityId: "target-entity" },
      designatedTargetInstanceId: target.instanceId,
      blockAssignments: [
        { participantEntityId: "attacker-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacker-entity"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    } as NonNullable<GameState["activeAttack"]>;
    const endState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, target],
      }),
      turnNumber: 6,
      activePlayerId: "alice",
      step: "end",
      window: "end_step_cleanup",
      battleEntities: [
        {
          entityId: "attacker-entity",
          memberInstanceIds: [attacker.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["purple"],
          attackState: "attacking",
        },
        {
          entityId: "target-entity",
          memberInstanceIds: [target.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["purple"],
          attackState: "idle",
        },
      ],
      extraTurnState: {
        ownerPlayerId: "alice",
        skipSteps: ["core", "attack"],
        returnContext: {
          turnNumber: 5,
          activePlayerId: "bob",
          step: "attack",
          window: "declare_attack",
          activeAttack,
        },
      },
    };

    const restored = advanceStep(
      endState,
      getCardDefinitionById,
      triggeredLookup
    );

    expect(restored.extraTurnState).toBeNull();
    expect(restored.window).toBe("pre_declaration_stack");
    expect(restored.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      actingPlayerId: "alice",
      sourceInstanceId: target.instanceId,
    });
  });

  it("中断復帰型の追加ターンを入れ子にしても外側の復帰先を保持する", () => {
    // alice extra turn 中 (step=main) で再度 grant_extra_turn を発火させた場合の挙動。
    // 各追加ターンの復帰先を重ね、内側から順に復元する。
    const aliceExtraMain: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 6,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      extraTurnState: {
        ownerPlayerId: "alice",
        skipSteps: ["core", "attack"],
        returnContext: {
          turnNumber: 5,
          activePlayerId: "bob",
          step: "attack",
          window: "none",
          activeAttack: {
            attackId: "attack-outer",
            attackerInstanceId: "bob-attacker",
            defenderPlayerId: "alice",
            blockerInstanceId: null,
            cardEventChainId: null,
            windowState: "battle_resolution",
          } as GameState["activeAttack"],
        },
      },
    };

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "grant_extra_turn",
            player: "self",
            skipSteps: ["core", "attack"],
            returnPoint: "previous_attack_battle",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:p3-63-grant-extra-turn:391",
      state: aliceExtraMain,
      effect,
      sourceInstanceId: "n/a",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(result.turnNumber).toBe(7);
    expect(result.activePlayerId).toBe("alice");
    expect(result.step).toBe("start");

    // extraTurnState は元の returnContext を保持
    expect(result.extraTurnState?.ownerPlayerId).toBe("alice");
    expect(result.extraTurnState?.returnContext).toMatchObject({
      turnNumber: 6,
      activePlayerId: "alice",
      step: "main",
    });
    expect(
      result.extraTurnState?.returnContext?.extraTurnState?.returnContext
    ).toMatchObject({
      turnNumber: 5,
      activePlayerId: "bob",
      step: "attack",
    });
    expect(
      result.extraTurnState?.returnContext?.extraTurnState?.returnContext
        ?.activeAttack
    ).toMatchObject({
      attackId: "attack-outer",
    });

    const restored = advanceStep(
      { ...result, step: "end", window: "end_step_cleanup" },
      getCardDefinitionById,
      triggeredLookup
    );
    expect(restored.step).toBe("main");
    expect(restored.extraTurnState).toEqual(aliceExtraMain.extraTurnState);
  });

  it("returnContext なし: extraTurnState クリアして通常の次ターン遷移", () => {
    const endState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 6,
      activePlayerId: "alice",
      step: "end",
      window: "end_step_cleanup",
      extraTurnState: {
        ownerPlayerId: "alice",
        skipSteps: [],
        returnContext: null,
      },
    };

    const after = advanceStep(endState, getCardDefinitionById, triggeredLookup);
    // returnContext なしなので通常遷移: turnNumber + 1, opponent (bob)
    expect(after.turnNumber).toBe(7);
    expect(after.activePlayerId).toBe("bob");
    expect(after.step).toBe("start");
    expect(after.extraTurnState).toBeNull();
  });
});
