/**
 * ENGINE-attack-scope-ce-expiry:
 * `Duration.scope === "attack"`（model.ts コメント「このアタック中」— アタック解決時に消滅）は
 * 型/ドキュメント上は独立した scope として定義されていたが、`removeExpiredContinuousEffects`
 * (battle_end trigger) と `recomputeContinuousEffects` の両方が `scope === "battle"` のみを
 * 処理しており、`scope: "attack"` の CE は battle_end で一切除去されず `permanent` 相当に
 * 恒久残留する実装バグだった。
 *
 * 本エンジンは複数ブロッカーを含む1 attack 分のバトルを単一の battle_end で一括解決する
 * ([[project_simultaneous_attack_multi_block]]) ため、"battle" と "attack" のライフサイクルは
 * 同一 battle_end 契機で閉じるべきもの。BSDB01-TX01(A)[9,10] / BSSL01-X01[8,9] の
 * 「アタック中のみシンボル固定」は、このバグを「override_properties.symbols は
 * duration:"attack" のスコープ・固定セマンティクスを表現できない」と誤って stub 化していた
 * (実際は override_properties 自体の欠落ではなく、duration:"attack" 共通基盤の欠落)。
 *
 * 本テストは removeExpiredContinuousEffects の単体回帰と、executeBattleResolution 経由の
 * 統合回帰の両方で scope:"attack" CE が battle_end に確実に失効することを確認する。
 *
 * adversarial verifier round1 refute: 同じ「バトル関連 CE をクリア」目的の並行フィルタが
 * `executeEndAttackStep` (structured-state-grants.ts、BSDB01-C03「ただちにバトルを終了できる」
 * 等カード効果駆動の即時バトル終了パス。executeBattleResolution を経由しない別経路) にも存在し、
 * そちらは scope:"battle" のみで scope:"attack" が対象外のまま残っていた。round1 fix でこの経路も
 * 揃えたため、本ファイル末尾にその回帰テストも追加する。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  collectGameStateInvariantIssues,
  executeBattleResolution,
} from "../src/index";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import {
  executeEndAttackStep,
  finalizePendingAttackStepEndFinalizations,
} from "../src/effect/structured-state-grants";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/index";

describe("ENGINE-attack-scope-ce-expiry", () => {
  it("scope:'attack' CE は attackId 一致の battle_end で失効する (単体回帰)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const attackScopedCE: ContinuousEffect = {
      effectId: "ce:test:attack-scoped",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "attack" },
      createdAtTurn: 2,
      createdAtAttackId: "attack:known:1",
      modifierTag: "unblockable",
      targetInstanceId: "atk-1",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [attackScopedCE],
    };

    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:known:1",
    });

    expect(
      after.find((ce) => ce.effectId === "ce:test:attack-scoped")
    ).toBeUndefined();
  });

  it("scope:'attack' CE は別 attackId の battle_end では失効しない (自分の attack が閉じるまで残る)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const attackScopedCE: ContinuousEffect = {
      effectId: "ce:test:attack-scoped-2",
      sourceInstanceId: "src-2",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "attack" },
      createdAtTurn: 2,
      createdAtAttackId: "attack:known:1",
      modifierTag: "unblockable",
      targetInstanceId: "atk-1",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [attackScopedCE],
    };

    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:other:99",
    });

    expect(
      after.find((ce) => ce.effectId === "ce:test:attack-scoped-2")
    ).toBeDefined();
  });

  it("scope:'attack' CE で createdAtAttackId が null のときは battle_end で失効する (pre_declaration_stack 同型の保守的失効)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const nullAttackCE: ContinuousEffect = {
      effectId: "ce:test:attack-scoped-null",
      sourceInstanceId: "src-5",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "attack" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "unblockable",
      targetInstanceId: "atk-1",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [nullAttackCE],
    };

    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:any:1",
    });

    expect(
      after.find((ce) => ce.effectId === "ce:test:attack-scoped-null")
    ).toBeUndefined();
  });

  it("executeBattleResolution 経由で scope:'attack' の override_properties CE が battle_end で失効する (engine ordering 統合回帰)", () => {
    const attackerDef: CardDefinition = {
      cardNo: "TEST-ATK-ATTACKSCOPE",
      name: "テスト攻撃者(attack-scope)",
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
      instanceId: "atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:be-atk:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "be-atk",
      participantEntityIds: ["be-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };

    const attackScopedCE: ContinuousEffect = {
      effectId: "ce:test:integration-attack-scope",
      sourceInstanceId: "atk-1",
      sourceDefinitionId: "TEST-ATK-ATTACKSCOPE",
      actingPlayerId: "alice",
      duration: { scope: "attack" },
      createdAtTurn: 2,
      createdAtAttackId: attackId,
      modifierTag: "override_properties",
      targetInstanceId: "atk-1",
      metadata: { properties: { symbols: ["red", "red", "blue", "blue"] } },
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
          entityId: "be-atk",
          memberInstanceIds: ["atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
      activeContinuousEffects: [attackScopedCE],
    };

    const resolved = executeBattleResolution({
      state: midBattle,
      getCardDefinitionById: (id) =>
        id === "TEST-ATK-ATTACKSCOPE" ? attackerDef : undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) => ce.effectId === "ce:test:integration-attack-scope"
      )
    ).toBeUndefined();
  });

  it("非 attack/battle スコープ CE は battle_end で失効しない (scope ガード回帰防止)", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const permanentCE: ContinuousEffect = {
      effectId: "ce:test:permanent",
      sourceInstanceId: "src-3",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice",
    };

    const whileOnFieldCE: ContinuousEffect = {
      effectId: "ce:test:while-on-field",
      sourceInstanceId: "src-4",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      activeContinuousEffects: [permanentCE, whileOnFieldCE],
    };

    const after = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack:any:1",
    });

    expect(
      after.find((ce) => ce.effectId === "ce:test:permanent")
    ).toBeDefined();
    expect(
      after.find((ce) => ce.effectId === "ce:test:while-on-field")
    ).toBeDefined();
  });

  it("executeEndAttackStep (カード効果駆動の即時バトル終了、BSDB01-C03 型) でも scope:'attack' CE が除去される", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });

    const attackScopedCE: ContinuousEffect = {
      effectId: "ce:test:end-attack-step-attack-scope",
      sourceInstanceId: "src-6",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "attack" },
      createdAtTurn: 2,
      createdAtAttackId: "attack:known:1",
      modifierTag: "unblockable",
      targetInstanceId: "atk-1",
    };
    const battleScopedCE: ContinuousEffect = {
      effectId: "ce:test:end-attack-step-battle-scope",
      sourceInstanceId: "src-7",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: 2,
      createdAtAttackId: "attack:known:1",
      modifierTag: "unblockable",
      targetInstanceId: "atk-1",
    };
    const permanentCE: ContinuousEffect = {
      effectId: "ce:test:end-attack-step-permanent",
      sourceInstanceId: "src-8",
      sourceDefinitionId: "TEST-SRC",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice",
    };

    const state: GameState = {
      ...baseState,
      turnNumber: 2,
      step: "attack",
      activeContinuousEffects: [attackScopedCE, battleScopedCE, permanentCE],
    };

    const queued = executeEndAttackStep(state, "alice");
    const after = finalizePendingAttackStepEndFinalizations(queued);

    expect(after.step).toBe("end");
    expect(
      after.activeContinuousEffects.find(
        (ce) => ce.effectId === "ce:test:end-attack-step-attack-scope"
      )
    ).toBeUndefined();
    expect(
      after.activeContinuousEffects.find(
        (ce) => ce.effectId === "ce:test:end-attack-step-battle-scope"
      )
    ).toBeUndefined();
    expect(
      after.activeContinuousEffects.find(
        (ce) => ce.effectId === "ce:test:end-attack-step-permanent"
      )
    ).toBeDefined();
  });

  it("効果によるアタックステップ終了はフラッシュ離場後の空 battle shell を残さない", () => {
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [],
    });
    const state: GameState = {
      ...baseState,
      step: "attack",
      activePlayerId: "bob",
      battleEntities: [
        {
          entityId: "battle-entity:blocker",
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: ["blocker"],
          resolvedBp: 0,
          resolvedSymbols: [],
          attackState: "blocking",
        },
        {
          entityId: "battle-entity:attacker",
          memberInstanceIds: [],
          leftFieldMemberInstanceIds: ["attacker"],
          resolvedBp: 0,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "effect-end-attack-step:flash-destroy",
          actingPlayerId: "bob",
          sourceInstanceId: "source",
          createdAtTurn: 1,
        },
      ],
    };

    const after = finalizePendingAttackStepEndFinalizations(state);

    expect(after.activeAttack).toBeNull();
    expect(after.battleEntities).toEqual([]);
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
});
