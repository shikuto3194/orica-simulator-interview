/**
 * ENGINE-pre-declaration-stack-battle-ce-expiry:
 * pre_declaration_stack で発揮された scope:"battle" CE は state.activeAttack 未確定の
 * ため createdAtAttackId=null で登録される (effect-interpreter.ts:8015 / 7001 等)。
 *
 * 旧実装の removeExpiredContinuousEffects(battle_end) は
 *   `return effect.createdAtAttackId !== trigger.attackId;`
 * で null と attackId を !== で比較していたため常に true (=保持) を返し、
 * pre_declaration_stack CE が直後の battle_end でも除去されず後続バトル/ターンへ
 * silent に残留する pre-existing bug があった。
 *
 * 修正後は createdAtAttackId=null の battle CE を battle_end で必ず失効させる
 * (pre_declaration_stack の意図: 「次に開く battle」スコープで発揮し battle_end で閉じる)。
 *
 * 本テストは pre_declaration_stack を組まずに、null attackId の scope:battle CE を
 * 直接 state へ流し込み、removeExpiredContinuousEffects(battle_end) で除去されることを
 * 直接 assert する (engine ordering とは独立した CE 失効ロジックの単体回帰)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
} from "../src/index";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/index";

describe("ENGINE-pre-declaration-stack-battle-ce-expiry", () => {
  it("createdAtAttackId=null の scope:'battle' CE は battle_end で失効する (旧実装では残留)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const nullAttackCE: ContinuousEffect = {
      effectId: "ce:test:null-attack",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: "alice",
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };

    const knownAttackCE: ContinuousEffect = {
      effectId: "ce:test:known-attack",
      sourceInstanceId: "src-2",
      sourceDefinitionId: "TEST-SRC-2",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: 2,
      createdAtAttackId: "attack:known:1",
      modifierTag: "life_damage_interception",
      targetInstanceId: "alice",
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [nullAttackCE, knownAttackCE],
    };

    // 同じ attackId の battle_end → known-attack CE が attackId 一致で除去。
    // null-attack CE も新仕様で除去 (pre_declaration_stack で次のバトル用に登録された CE は
    // ここで失効すべき)。
    const afterMatching = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:known:1",
    });

    expect(
      afterMatching.find((ce) => ce.effectId === "ce:test:known-attack")
    ).toBeUndefined();
    expect(
      afterMatching.find((ce) => ce.effectId === "ce:test:null-attack")
    ).toBeUndefined();
  });

  it("createdAtAttackId=null の scope:'battle' CE は無関係な attackId の battle_end でも失効する", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const nullAttackCE: ContinuousEffect = {
      effectId: "ce:test:null-attack-2",
      sourceInstanceId: "src-3",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: "alice",
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [nullAttackCE],
    };

    // 別 attackId の battle_end でも null-attack CE は失効 (次の閉じる battle_end で確実に閉じる)。
    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:other:99",
    });

    expect(
      after.find((ce) => ce.effectId === "ce:test:null-attack-2")
    ).toBeUndefined();
  });

  it("executeBattleResolution の finalizeBattleEndScopeExpirations 経由で null attackId の scope:'battle' CE が除去される (engine ordering 統合回帰)", () => {
    // pre_declaration_stack 経路で登録された CE を再現する: activeAttack 未確定の段階で
    // 仮想的に登録した CE (createdAtAttackId=null) を活性中の battle 状態へ持ち越し、
    // executeBattleResolution が battle_end → finalizeBattleEndScopeExpirations 経由で
    // removeExpiredContinuousEffects(battle_end) を呼ぶ実 path を踏ませる。
    const attackerDef: CardDefinition = {
      cardNo: "TEST-ATK-NULL",
      name: "テスト攻撃者(null-attackId)",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const attacker = createCardInstance(attackerDef, {
      instanceId: "atk-null",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:integration-null:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "be-atk-null",
      participantEntityIds: ["be-atk-null"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-atk-null", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-atk-null"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };

    const nullPreDeclCE: ContinuousEffect = {
      effectId: "ce:test:integration-null",
      sourceInstanceId: "atk-null",
      sourceDefinitionId: "TEST-ATK-NULL",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "life_damage_interception",
      targetInstanceId: "alice",
      metadata: {
        cause: "any" as const,
        mode: "replace" as const,
        turnThreshold: 1,
        floor: 0,
      },
    };

    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker],
    });
    const midBattle: GameState = {
      ...baseState,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "be-atk-null",
          memberInstanceIds: ["atk-null"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [nullPreDeclCE],
    };

    const resolved = executeBattleResolution({
      state: midBattle,
      getCardDefinitionById: (id) =>
        id === "TEST-ATK-NULL" ? attackerDef : undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    // 統合経路 (executeBattleResolution → finalizeBattleEndScopeExpirations →
    // removeExpiredContinuousEffects(battle_end)) で null attackId CE が除去される。
    // 旧実装では `null !== "attack:integration-null:1"` が常に true となり残留していた。
    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) => ce.effectId === "ce:test:integration-null"
      )
    ).toBeUndefined();
  });

  it("非 battle スコープ CE は battle_end で失効しない (scope ガード回帰防止)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const permanentCE: ContinuousEffect = {
      effectId: "ce:test:permanent",
      sourceInstanceId: "src-4",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice",
    };

    const turnCE: ContinuousEffect = {
      effectId: "ce:test:turn",
      sourceInstanceId: "src-5",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [permanentCE, turnCE],
    };

    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:any:1",
    });

    // どちらも battle スコープではないので残る。
    expect(
      after.find((ce) => ce.effectId === "ce:test:permanent")
    ).toBeDefined();
    expect(after.find((ce) => ce.effectId === "ce:test:turn")).toBeDefined();
  });
});
