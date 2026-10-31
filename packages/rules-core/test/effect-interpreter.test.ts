import { finishCoreChoices } from "./helpers/core-choice-driver";
import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { autoResumePendingOptionalSteps } from "../src/effect/optional-step-auto-resume";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  buildReevaluationConfig,
  executeReevaluationCheck,
  runReevaluationAtTiming,
} from "../src/legal/legal-actions-shared";
import {
  applyPendingStepOptionalChoiceAction,
  applyPendingStepOptionalTargetSelectionAction,
} from "../src/legal/pending-action-handlers";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { evaluateAttackStepEndBlockedRetryCondition } from "../src/effect/attack-step-end-blocked-retry";
import { finalizePendingAttackStepEndFinalizations } from "../src/effect/structured-state-grants";
import {
  buildFieldCardEffectLookup,
  deriveSuppressionEffectDescriptor,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { isCombinedBraveEffectSource } from "../src/effect/effect-source-identity";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectResolutionActionKind,
  GameState,
} from "../src/model";
import type { Effect, EffectTargetFilter } from "../src/dsl-types";

// ============================================================
// テスト用ヘルパー
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
    startingVoidNormalCoreCount: 1000,
  });
}

function resolvePendingMultiPlacementForTest(
  state: GameState,
  multiPlacementAllocations: NonNullable<
    Parameters<typeof applyLegalAction>[0]["multiPlacementAllocations"]
  >
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    multiPlacementAllocations,
  }).state;
}

function additionalCostDeltaCE(
  sourceInstanceId: string,
  actingPlayerId: string,
  amount: number,
  filter: NonNullable<ContinuousEffect["targetFilter"]>
): ContinuousEffect {
  return {
    effectId: `ce-additional-cost-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: "ENGINE-COST-TAX",
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: filter,
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}

function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

// ============================================================
// 基本テスト
// ============================================================

describe("executeEffect", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  describe("単一ステップ効果", () => {
    it("draw アクション", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", count: 2 } }],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:151",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      // ドロー効果がログに記録される
      const drawLogs = result.log.filter((l) => l.includes("draw"));
      expect(drawLogs.length).toBeGreaterThan(0);
    });

    it("count_increase アクション", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:177",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(1);
    });

    it("recover アクション（selfターゲット）", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "recover",
              target: { kind: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:210",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const card = result.cardInstances.find((c) => c.instanceId === "src-1")!;
      expect(card.exhaustState).toBe("recovered");
    });
  });

  describe("Condition 評価", () => {
    it("条件不成立時はスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        condition: [{ kind: "count_value", player: "self", min: 99 }],
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:238",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0); // 未変更
      expect(result.log.some((l) => l.includes("condition-unmet"))).toBe(true);
    });
  });

  describe("P3-83: 消滅待機の Lv 条件は snapshot で判定 (Ver.17.0 例2)", () => {
    const vanishLvDef = makeDef({
      cardNo: "VANISH-LV",
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 2000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
    });

    it("コア0でも snapshot Lv2 の消滅待機は min_level:2 を満たす（離脱時効果が消滅時 Lv で判定）", () => {
      registerDef(vanishLvDef);
      const card = makeInstance(vanishLvDef, {
        instanceId: "van-1",
        normalCoreCount: 0,
        pendingLeaveKind: "vanish",
        pendingLeaveLvSnapshot: 2,
      });
      const state = makeState([card]);

      // 現在コア由来なら Lv0 で不成立になるところを、snapshot Lv2 で成立させる。
      expect(
        evaluateCondition(
          state,
          [{ kind: "min_level", value: 2 }],
          "van-1",
          "alice",
          getDef
        )
      ).toBe(true);
      // snapshot=2 なので min_level:3 は不成立（snapshot を超える条件は満たさない）。
      expect(
        evaluateCondition(
          state,
          [{ kind: "min_level", value: 3 }],
          "van-1",
          "alice",
          getDef
        )
      ).toBe(false);
    });

    it("snapshot 未設定の消滅待機は現在コア由来 (Lv0) に fallback する", () => {
      registerDef(vanishLvDef);
      const card = makeInstance(vanishLvDef, {
        instanceId: "van-2",
        normalCoreCount: 0,
        pendingLeaveKind: "vanish",
        pendingLeaveLvSnapshot: null,
      });
      const state = makeState([card]);

      expect(
        evaluateCondition(
          state,
          [{ kind: "min_level", value: 2 }],
          "van-2",
          "alice",
          getDef
        )
      ).toBe(false);
    });
  });

  describe("Connector: simultaneous", () => {
    it("2ステップが両方実行される", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "simultaneous",
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:333",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(3);
    });
  });

  describe("Connector: conditional_result", () => {
    it("前ステップ成功時に次ステップ実行", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "step1",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "conditional_result",
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:370",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      // 回復成功 → カウント増加も実行
      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(1);
    });
  });

  describe("StepCondition", () => {
    it("ref_succeeded: 前ステップ成功で実行", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 5 },
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "recover_step" },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:409",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(5);
    });

    // ============================================================
    // B-2: ref_succeeded not / ref_count / minCount maxCount
    // ============================================================

    it("B-2: ref_succeeded not=true で前ステップ失敗時に実行", () => {
      // count_decrease を countValue=0 から実行 → succeeded=false
      // → not=true なので次ステップ実行
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "decrease_step",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 7 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "decrease_step",
              not: true,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:452",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(7);
    });

    it("B-2: ref_succeeded not=true 前ステップ成功時はスキップ", () => {
      // count_decrease 実行で countValue 1→0 → succeeded=true → not=true でスキップ
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const baseState = makeState([sourceCard]);
      const state: GameState = {
        ...baseState,
        players: baseState.players.map((p) =>
          p.id === "alice" ? { ...p, countValue: 1 } : p
        ),
      };

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "decrease_step",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 7 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "decrease_step",
              not: true,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:496",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // 開始 countValue=1, decrease で 0, increase は not=true でスキップ → 結果 0
      expect(alice.countValue).toBe(0);
    });

    it("B-2: ref_count min: 影響件数が閾値以上で実行", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 3 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "recover_step",
              min: 1,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:537",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(3);
    });

    it("B-2: ref_count min=2 影響件数1件ではスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 3 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "recover_step",
              min: 2,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:577",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0);
    });

    it("B-2: ref_count max: 上限超過でスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 4 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "recover_step",
              min: 0,
              max: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:618",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0);
    });

    it("B-2: ref_count not=true 件数0でも実行", () => {
      // count_decrease を 0 から → 影響件数0 → ref_count min:1 不成立 → not=true で実行
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "decrease_step",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 6 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "decrease_step",
              min: 1,
              not: true,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:657",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(6);
    });

    it("B-2: ref_has_match minCount 既定=1 で動作", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "recover_step",
              filter: { category: ["spirit"] },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:697",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(2);
    });

    it("B-2: ref_has_match minCount=2 1件マッチではスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "recover_step",
              filter: { category: ["spirit"] },
              minCount: 2,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:738",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0);
    });

    it("B-2: ref_has_match not=true マッチ件数0で実行", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 9 },
            connector: "sequential",
            // category=nexus にはマッチしない → not=true で実行
            stepCondition: {
              kind: "ref_has_match",
              stepId: "recover_step",
              filter: { category: ["nexus"] },
              not: true,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:780",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(9);
    });

    it("B-2: ref_has_color minCount=2 1色マッチではスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001", colors: ["red"] });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        exhaustState: "exhausted",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "recover_step",
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_has_color",
              stepId: "recover_step",
              colors: ["red"],
              minCount: 2,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:821",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0);
    });

    // ============================================================
    // D-2: ref_choice — 選択→分岐
    // 「A か B を選ぶ。A を選んだ場合さらに C を行う」
    // ============================================================

    it("D-2: ref_choice — デフォルト選択（choiceIndex=0）で後続ステップ実行", () => {
      // step "pick" は choice 持ち。デフォルト=count_increase 1, 代替=count_increase 5。
      // 後続 "bonus" は ref_choice で choiceIndex=0 のときのみ実行。
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 5 } },
            ],
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:868",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 0,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // pick=1（デフォルト）+ bonus=10（ref_choice 一致）= 11
      expect(alice.countValue).toBe(11);
    });

    it("D-2: ref_choice — 代替選択（choiceIndex=1）で後続ステップスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 5 } },
            ],
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:910",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 1,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // pick=5（代替）+ bonus スキップ = 5
      expect(alice.countValue).toBe(5);
    });

    it("D-2: ref_choice not=true で否定", () => {
      // 「A を選ばなかったとき（B を選んだとき）追加効果」
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 5 } },
            ],
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 0,
              not: true,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:954",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 1,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // pick=5（代替）+ bonus=10（not=true で代替を捕捉）= 15
      expect(alice.countValue).toBe(15);
    });

    it("D-2: ref_choice 双方向分岐 — 各選択肢に専用後続ステップ", () => {
      // 「A か B を選ぶ。A を選んだとき X、B を選んだとき Y」
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 2 } },
            ],
          },
          {
            // 分岐 A: 選択肢 0 のとき +100
            action: { kind: "count_increase", player: "self", amount: 100 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 0,
            },
          },
          {
            // 分岐 B: 選択肢 1 のとき +200
            action: { kind: "count_increase", player: "self", amount: 200 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 1,
            },
          },
        ],
      };

      // 選択肢 1 を選んだ場合
      const resultB = executeEffect({
        chainId: "test:effect-interpreter:1009",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 1,
      });
      // pick=2 + 分岐 A=skip + 分岐 B=200 = 202
      expect(resultB.players.find((p) => p.id === "alice")!.countValue).toBe(
        202
      );
    });

    it("D-2: ref_choice — choice なしの参照ステップは false（chosenChoiceIndex 未記録）", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            // choice 持たないステップ
            id: "no_choice",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "no_choice",
              choiceIndex: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1049",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 0,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // 参照先が choice 持たないため ref_choice は false → bonus スキップ
      expect(alice.countValue).toBe(1);
    });

    it("D-2: ref_choice — 未知の stepId 参照は false", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 5 } },
            ],
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "missing_step",
              choiceIndex: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1091",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        choiceIndex: 0,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // 未知の stepId → false → bonus スキップ
      expect(alice.countValue).toBe(1);
    });

    it("D-2: ref_choice — choiceIndex 未指定（options.choiceIndex undefined）でも記録されない", () => {
      // choice 持ちステップだが options.choiceIndex 未指定の場合、デフォルト action が実行されるが
      // chosenChoiceIndex は記録されない（実装上 options.choiceIndex undefined チェック）。
      // → ref_choice は false。
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "pick",
            action: { kind: "count_increase", player: "self", amount: 1 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 5 } },
            ],
          },
          {
            action: { kind: "count_increase", player: "self", amount: 10 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "pick",
              choiceIndex: 0,
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1136",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        // choiceIndex を渡さない
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      // pick=1（デフォルト fallback）+ bonus はスキップ（chosenChoiceIndex 未記録）= 1
      expect(alice.countValue).toBe(1);
    });
  });

  describe("Applicability", () => {
    it("ゾーン不一致でスキップ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      // カードが hand にある
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        zone: "hand",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "continuous" },
        applicability: { zone: "field" }, // field のみ
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1170",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(0); // 未実行
    });

    it("zone: 'anywhere' は全ゾーンでマッチ", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-1",
        zone: "hand",
      });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "continuous" },
        applicability: { zone: "anywhere" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1199",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(1);
    });
  });

  describe("ステップレベル条件", () => {
    it("step.condition 不成立でスキップ、他ステップは実行", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            // この条件は不成立（カウント99以上）
            condition: [{ kind: "count_value", player: "self", min: 99 }],
            action: { kind: "count_increase", player: "self", amount: 10 },
          },
          {
            // こちらは無条件で実行
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "simultaneous",
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1235",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.countValue).toBe(1); // 10 ではなく 1 のみ
    });
  });

  describe("DynamicCount", () => {
    it("count_value ソース: カウント値の数だけカウント増加", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);
      // alice のカウントを事前に 3 にセット
      const alice = state.players.find((p) => p.id === "alice")!;
      alice.countValue = 3;

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                source: { kind: "count_value", player: "self" },
              },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1273",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const aliceResult = result.players.find((p) => p.id === "alice")!;
      // 元の 3 + 動的参照で 3 増加 = 6
      expect(aliceResult.countValue).toBe(6);
    });

    it("count_value ソース + multiplier: カウント×1000 の BP 修正", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);
      const alice = state.players.find((p) => p.id === "alice")!;
      alice.countValue = 4;

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { kind: "self" },
              amount: {
                source: { kind: "count_value", player: "self" },
                multiplier: 1000,
              },
              duration: { scope: "turn", whose: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1311",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      // BP修正のログが記録される（BP+4000）
      const bpLogs = result.log.filter((l) => l.includes("bp_modify"));
      expect(bpLogs.length).toBeGreaterThan(0);
    });

    it("count_value ソース: 相手のカウント値を参照", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);
      const bob = state.players.find((p) => p.id === "bob")!;
      bob.countValue = 5;

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                source: { kind: "count_value", player: "opponent" },
              },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1347",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const aliceResult = result.players.find((p) => p.id === "alice")!;
      // 相手のカウント 5 だけ増加
      expect(aliceResult.countValue).toBe(5);
    });

    it("offset: 乗算後に加算オフセットが適用される", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      registerDef(sourceDef);
      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const state = makeState([sourceCard]);
      const alice = state.players.find((p) => p.id === "alice")!;
      alice.countValue = 3;

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                source: { kind: "count_value", player: "self" },
                multiplier: 2,
                offset: 1,
              },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1385",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const aliceResult = result.players.find((p) => p.id === "alice")!;
      // 元の 3 + (3 * 2 + 1) = 3 + 7 = 10
      expect(aliceResult.countValue).toBe(10);
    });

    it("cards_in_zone: フィールドのスピリット数を参照", () => {
      const sourceDef = makeDef({ cardNo: "SRC-001" });
      const spiritDef2 = makeDef({ cardNo: "SP-002", name: "スピリット2" });
      const spiritDef3 = makeDef({ cardNo: "SP-003", name: "スピリット3" });
      registerDef(sourceDef);
      registerDef(spiritDef2);
      registerDef(spiritDef3);

      const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
      const spirit2 = makeInstance(spiritDef2, { instanceId: "sp-2" });
      const spirit3 = makeInstance(spiritDef3, { instanceId: "sp-3" });
      const state = makeState([sourceCard, spirit2, spirit3]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: { category: ["spirit"] },
                },
              },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1431",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const aliceResult = result.players.find((p) => p.id === "alice")!;
      // フィールド上のスピリット 3 体分
      expect(aliceResult.countValue).toBe(3);
    });

    it("ENGINE-deck-reveal-count-amount: deck_reveal.revealCount は DynamicCount (cards_in_zone) で動的解決される", () => {
      const sourceDef = makeDef({ cardNo: "SRC-002" });
      const reserveDef = makeDef({ cardNo: "RSV-001", name: "リザーブ要員" });
      const deckDef = makeDef({ cardNo: "DECK-001", name: "デッキ要員" });
      registerDef(sourceDef);
      registerDef(reserveDef);
      registerDef(deckDef);

      const sourceCard = makeInstance(sourceDef, { instanceId: "src-2" });
      const reserveCards = [
        makeInstance(reserveDef, { instanceId: "rsv-1", zone: "reserve" }),
        makeInstance(reserveDef, { instanceId: "rsv-2", zone: "reserve" }),
      ];
      const deckCards = Array.from({ length: 5 }, (_, i) =>
        makeInstance(deckDef, { instanceId: `deck-${i}`, zone: "deck" })
      );
      const state = makeState([sourceCard, ...reserveCards, ...deckCards]);

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: {
                source: {
                  kind: "cards_in_zone",
                  zone: "reserve",
                  player: "self",
                },
              },
              picks: [],
              remainder: "top_or_bottom",
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:1482",
        state,
        effect,
        sourceInstanceId: "src-2",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      // リザーブ2枚分 = revealCount 2 として解決される
      expect(result.pendingDeckReveal?.revealedCardInstanceIds).toHaveLength(2);
    });
  });

  // ============================================================
  // B-4: ゾーン内カウント条件（field_has / field_lacks の zone 拡張）
  // ============================================================

  describe("B-4: field_has/field_lacks zone パラメータ", () => {
    it("field_has zone:'trash' — トラッシュにスピリット3枚以上で true", () => {
      const def = makeDef({ cardNo: "TRASH-SP", printedCategory: "spirit" });
      registerDef(def);
      const src = makeInstance(makeDef({ cardNo: "SRC-001" }), {
        instanceId: "src-1",
      });
      registerDef(makeDef({ cardNo: "SRC-001" }));

      const trashCards = [
        makeInstance(def, { instanceId: "t-1", zone: "trash" as const }),
        makeInstance(def, { instanceId: "t-2", zone: "trash" as const }),
        makeInstance(def, { instanceId: "t-3", zone: "trash" as const }),
      ];
      const state = makeState([src, ...trashCards]);

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        zone: "trash" as const,
        category: ["spirit" as const],
        minCount: 3,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        true
      );
    });

    it("field_has zone:'trash' — トラッシュにスピリット2枚で minCount:3 は false", () => {
      const def = makeDef({ cardNo: "TRASH-SP", printedCategory: "spirit" });
      registerDef(def);
      const src = makeInstance(makeDef({ cardNo: "SRC-001" }), {
        instanceId: "src-1",
      });
      registerDef(makeDef({ cardNo: "SRC-001" }));

      const trashCards = [
        makeInstance(def, { instanceId: "t-1", zone: "trash" as const }),
        makeInstance(def, { instanceId: "t-2", zone: "trash" as const }),
      ];
      const state = makeState([src, ...trashCards]);

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        zone: "trash" as const,
        category: ["spirit" as const],
        minCount: 3,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        false
      );
    });

    it("field_has zone:'deck' — デッキ枚数10枚以下を maxCount で判定", () => {
      const def = makeDef({ cardNo: "DECK-001" });
      registerDef(def);
      const src = makeInstance(def, { instanceId: "src-1" });

      // デッキに 8 枚
      const deckCards = Array.from({ length: 8 }, (_, i) =>
        makeInstance(def, { instanceId: `d-${i}`, zone: "deck" as const })
      );
      const state = makeState([src, ...deckCards]);

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        zone: "deck" as const,
        maxCount: 10,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        true
      );
    });

    it("field_has zone:'deck' — デッキ枚数12枚で maxCount:10 は false", () => {
      const def = makeDef({ cardNo: "DECK-001" });
      registerDef(def);
      const src = makeInstance(def, { instanceId: "src-1" });

      const deckCards = Array.from({ length: 12 }, (_, i) =>
        makeInstance(def, { instanceId: `d-${i}`, zone: "deck" as const })
      );
      const state = makeState([src, ...deckCards]);

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        zone: "deck" as const,
        maxCount: 10,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        false
      );
    });

    it("field_has zone:'set_aside' — 手元にカードがあれば true", () => {
      const def = makeDef({ cardNo: "SA-001" });
      registerDef(def);
      const src = makeInstance(def, { instanceId: "src-1" });
      const saCard = makeInstance(def, {
        instanceId: "sa-1",
        zone: "set_aside" as const,
      });
      const state = makeState([src, saCard]);

      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        zone: "set_aside" as const,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        true
      );
    });

    it("field_lacks zone:'trash' — トラッシュにスピリットがなければ true", () => {
      const def = makeDef({ cardNo: "SP-TRASH", printedCategory: "spirit" });
      registerDef(def);
      const src = makeInstance(def, { instanceId: "src-1" });
      // トラッシュにネクサスだけ（スピリットなし）
      const nexusDef = makeDef({
        cardNo: "NX-TRASH",
        printedCategory: "nexus",
      });
      registerDef(nexusDef);
      const trashNexus = makeInstance(nexusDef, {
        instanceId: "tn-1",
        zone: "trash" as const,
      });
      const state = makeState([src, trashNexus]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        zone: "trash" as const,
        category: ["spirit" as const],
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        true
      );
    });

    it("field_lacks zone:'trash' — トラッシュにスピリットがあれば false", () => {
      const def = makeDef({ cardNo: "SP-TRASH", printedCategory: "spirit" });
      registerDef(def);
      const src = makeInstance(def, { instanceId: "src-1" });
      const trashSpirit = makeInstance(def, {
        instanceId: "ts-1",
        zone: "trash" as const,
      });
      const state = makeState([src, trashSpirit]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        zone: "trash" as const,
        category: ["spirit" as const],
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        false
      );
    });

    it("field_lacks cardName:'self' — 同名スピリットが場にいなければ true (BSTH01-M01)", () => {
      const patchouli = makeDef({
        cardNo: "TEST-PATCHOULI",
        name: "パチュリー・ノーレッジ",
        printedCategory: "spirit",
      });
      registerDef(patchouli);
      const otherSpirit = makeDef({
        cardNo: "TEST-OTHER",
        name: "別名スピリット",
        printedCategory: "spirit",
      });
      registerDef(otherSpirit);

      // 手札に source、場には別名スピリットだけ → 条件成立
      const handPatchouli = makeInstance(patchouli, {
        instanceId: "hand-pat",
        zone: "hand" as const,
      });
      const fieldOther = makeInstance(otherSpirit, {
        instanceId: "field-other",
        zone: "field" as const,
      });
      const state = makeState([handPatchouli, fieldOther]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        cardName: "self" as const,
        excludeSelf: true,
      };
      expect(
        evaluateCondition(state, [clause], "hand-pat", "alice", getDef)
      ).toBe(true);
    });

    it("field_lacks cardName:'self' — 同名スピリットが場にいれば false (BSTH01-M01)", () => {
      const patchouli = makeDef({
        cardNo: "TEST-PATCHOULI",
        name: "パチュリー・ノーレッジ",
        printedCategory: "spirit",
      });
      registerDef(patchouli);

      const handPatchouli = makeInstance(patchouli, {
        instanceId: "hand-pat",
        zone: "hand" as const,
      });
      const fieldPatchouli = makeInstance(patchouli, {
        instanceId: "field-pat",
        zone: "field" as const,
      });
      const state = makeState([handPatchouli, fieldPatchouli]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        cardName: "self" as const,
        excludeSelf: true,
      };
      expect(
        evaluateCondition(state, [clause], "hand-pat", "alice", getDef)
      ).toBe(false);
    });

    it("field_lacks cardName:'self' — excludeSelf=true で source 自身は除外", () => {
      const patchouli = makeDef({
        cardNo: "TEST-PATCHOULI",
        name: "パチュリー・ノーレッジ",
        printedCategory: "spirit",
      });
      registerDef(patchouli);

      // source 自身が場にあるが excludeSelf=true なので除外 → 条件成立
      const fieldPatchouli = makeInstance(patchouli, {
        instanceId: "field-pat",
        zone: "field" as const,
      });
      const state = makeState([fieldPatchouli]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        cardName: "self" as const,
        excludeSelf: true,
      };
      expect(
        evaluateCondition(state, [clause], "field-pat", "alice", getDef)
      ).toBe(true);
    });

    it("field_lacks cardName:'self' — 相手の場の同名スピリットは無視", () => {
      const patchouli = makeDef({
        cardNo: "TEST-PATCHOULI",
        name: "パチュリー・ノーレッジ",
        printedCategory: "spirit",
      });
      registerDef(patchouli);

      const handPatchouli = makeInstance(patchouli, {
        instanceId: "hand-pat",
        zone: "hand" as const,
      });
      // 相手の場のパチュリー
      const oppPatchouli = makeInstance(patchouli, {
        instanceId: "opp-pat",
        zone: "field" as const,
        controllerPlayerId: "bob",
        ownerPlayerId: "bob",
      });
      const state = makeState([handPatchouli, oppPatchouli]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        cardName: "self" as const,
        excludeSelf: true,
      };
      // player:self は alice → bob のパチュリーは判定対象外 → true
      expect(
        evaluateCondition(state, [clause], "hand-pat", "alice", getDef)
      ).toBe(true);
    });

    it("field_lacks colors — 指定色のカードが場にいなければ true (field_has と対称)", () => {
      const redDef = makeDef({
        cardNo: "RED-SP",
        printedCategory: "spirit",
        colors: ["red"],
      });
      registerDef(redDef);
      const blueDef = makeDef({
        cardNo: "BLUE-SP",
        printedCategory: "spirit",
        colors: ["blue"],
      });
      registerDef(blueDef);

      const src = makeInstance(redDef, { instanceId: "src-1" });
      // 場には青のスピリットだけ → 赤を lacks しているので true
      const blueField = makeInstance(blueDef, {
        instanceId: "blue-1",
        zone: "field" as const,
      });
      const state = makeState([src, blueField]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        colors: ["red" as const],
        excludeSelf: true,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        true
      );
    });

    it("field_lacks colors — 指定色のカードが場にいれば false", () => {
      const redDef = makeDef({
        cardNo: "RED-SP",
        printedCategory: "spirit",
        colors: ["red"],
      });
      registerDef(redDef);
      const src = makeInstance(redDef, { instanceId: "src-1" });
      // 自分自身が赤として場にいる → excludeSelf=true で除外しても、別の赤を追加すれば false
      const otherRed = makeInstance(redDef, {
        instanceId: "red-2",
        zone: "field" as const,
      });
      const state = makeState([src, otherRed]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        colors: ["red" as const],
        excludeSelf: true,
      };
      expect(evaluateCondition(state, [clause], "src-1", "alice", getDef)).toBe(
        false
      );
    });

    it("field_lacks symbolColors — 指定シンボルが自分の場になければ true", () => {
      const srcDef = makeDef({
        cardNo: "NO-GUIDE-SRC",
        printedCategory: "spirit",
        symbolColors: ["purple"],
      });
      const otherDef = makeDef({
        cardNo: "YELLOW-SYM",
        printedCategory: "spirit",
        symbolColors: ["yellow"],
      });
      registerDef(srcDef);
      registerDef(otherDef);
      const src = makeInstance(srcDef, { instanceId: "src-no-guide" });
      const other = makeInstance(otherDef, { instanceId: "yellow-sym" });
      const state = makeState([src, other]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        symbolColors: ["guide" as const],
      };

      expect(
        evaluateCondition(state, [clause], "src-no-guide", "alice", getDef)
      ).toBe(true);
    });

    it("field_lacks symbolColors — 指定シンボルが自分の場にあれば false", () => {
      const srcDef = makeDef({
        cardNo: "NO-GUIDE-SRC",
        printedCategory: "spirit",
        symbolColors: ["purple"],
      });
      const guideDef = makeDef({
        cardNo: "GUIDE-SYM",
        printedCategory: "nexus",
        symbolColors: ["guide"],
      });
      registerDef(srcDef);
      registerDef(guideDef);
      const src = makeInstance(srcDef, { instanceId: "src-with-guide" });
      const guide = makeInstance(guideDef, { instanceId: "guide-sym" });
      const state = makeState([src, guide]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        symbolColors: ["guide" as const],
      };

      expect(
        evaluateCondition(state, [clause], "src-with-guide", "alice", getDef)
      ).toBe(false);
    });

    it("field_lacks symbolColors — text_role アンダーカードのシンボルは無印 field に数えない", () => {
      const hostDef = makeDef({
        cardNo: "HOST-NO-GUIDE",
        printedCategory: "spirit",
        symbolColors: ["purple"],
      });
      const guideDef = makeDef({
        cardNo: "UNDER-GUIDE",
        printedCategory: "brave",
        symbolColors: ["guide"],
      });
      registerDef(hostDef);
      registerDef(guideDef);
      const host = makeInstance(hostDef, {
        instanceId: "host-no-guide",
        underCards: [
          {
            cardInstanceId: "under-guide",
            role: "text_role",
            roleTag: "test",
          },
        ],
      });
      const underGuide = makeInstance(guideDef, {
        instanceId: "under-guide",
        zone: "field" as const,
        attachedToInstanceId: "host-no-guide",
      });
      const state = makeState([host, underGuide]);

      const clause = {
        kind: "field_lacks" as const,
        player: "self" as const,
        symbolColors: ["guide" as const],
      };

      expect(
        evaluateCondition(state, [clause], "host-no-guide", "alice", getDef)
      ).toBe(true);
    });

    it("zone 省略時はデフォルト 'field' — 既存動作互換", () => {
      const def = makeDef({ cardNo: "COMPAT-001", printedCategory: "spirit" });
      registerDef(def);
      const fieldSpirit = makeInstance(def, {
        instanceId: "fs-1",
        zone: "field" as const,
      });
      const trashSpirit = makeInstance(def, {
        instanceId: "ts-1",
        zone: "trash" as const,
      });
      const state = makeState([fieldSpirit, trashSpirit]);

      // zone 省略 → field のみ対象
      const clause = {
        kind: "field_has" as const,
        player: "self" as const,
        category: ["spirit" as const],
        minCount: 1,
      };
      expect(evaluateCondition(state, [clause], "fs-1", "alice", getDef)).toBe(
        true
      );

      // minCount:2 → field には 1 体のみ
      const clause2 = { ...clause, minCount: 2 };
      expect(evaluateCondition(state, [clause2], "fs-1", "alice", getDef)).toBe(
        false
      );
    });
  });

  // ============================================================
  // B-3: バトル状態条件（in_battle ConditionClause）
  // ============================================================

  describe("B-3: in_battle ConditionClause", () => {
    it("in_battle — アタック中のカードで true", () => {
      const def = makeDef({ cardNo: "ATK-001" });
      registerDef(def);
      const card = makeInstance(def, { instanceId: "atk-1" });
      const state = makeState([card]);
      state.battleEntities = [
        {
          entityId: "be-1",
          memberInstanceIds: ["atk-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ];

      const clause = { kind: "in_battle" as const };
      expect(evaluateCondition(state, [clause], "atk-1", "alice", getDef)).toBe(
        true
      );
    });

    it("in_battle — ブロック中のカードで true", () => {
      const def = makeDef({ cardNo: "BLK-001" });
      registerDef(def);
      const card = makeInstance(def, { instanceId: "blk-1" });
      const state = makeState([card]);
      state.battleEntities = [
        {
          entityId: "be-1",
          memberInstanceIds: ["blk-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["blue"],
          attackState: "blocking",
        },
      ];

      const clause = { kind: "in_battle" as const };
      expect(evaluateCondition(state, [clause], "blk-1", "alice", getDef)).toBe(
        true
      );
    });

    it("in_battle — バトル不参加のカードで false", () => {
      const def = makeDef({ cardNo: "IDLE-001" });
      registerDef(def);
      const card = makeInstance(def, { instanceId: "idle-1" });
      const state = makeState([card]);
      // battleEntities は空

      const clause = { kind: "in_battle" as const };
      expect(
        evaluateCondition(state, [clause], "idle-1", "alice", getDef)
      ).toBe(false);
    });

    it("in_battle state:'attacking' — アタック中のみ true", () => {
      const def = makeDef({ cardNo: "ATK-002" });
      registerDef(def);
      const atkCard = makeInstance(def, { instanceId: "atk-2" });
      const blkCard = makeInstance(def, { instanceId: "blk-2" });
      const state = makeState([atkCard, blkCard]);
      state.battleEntities = [
        {
          entityId: "be-a",
          memberInstanceIds: ["atk-2"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "be-b",
          memberInstanceIds: ["blk-2"],
          resolvedBp: 3000,
          resolvedSymbols: ["blue"],
          attackState: "blocking",
        },
      ];

      const clause = {
        kind: "in_battle" as const,
        state: "attacking" as const,
      };
      expect(evaluateCondition(state, [clause], "atk-2", "alice", getDef)).toBe(
        true
      );
      expect(evaluateCondition(state, [clause], "blk-2", "alice", getDef)).toBe(
        false
      );
    });

    it("in_battle state:'blocking' — ブロック中のみ true", () => {
      const def = makeDef({ cardNo: "BLK-002" });
      registerDef(def);
      const atkCard = makeInstance(def, { instanceId: "atk-3" });
      const blkCard = makeInstance(def, { instanceId: "blk-3" });
      const state = makeState([atkCard, blkCard]);
      state.battleEntities = [
        {
          entityId: "be-a",
          memberInstanceIds: ["atk-3"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "be-b",
          memberInstanceIds: ["blk-3"],
          resolvedBp: 3000,
          resolvedSymbols: ["blue"],
          attackState: "blocking",
        },
      ];

      const clause = { kind: "in_battle" as const, state: "blocking" as const };
      expect(evaluateCondition(state, [clause], "atk-3", "alice", getDef)).toBe(
        false
      );
      expect(evaluateCondition(state, [clause], "blk-3", "alice", getDef)).toBe(
        true
      );
    });

    it("in_battle — idle 状態のエンティティは false", () => {
      const def = makeDef({ cardNo: "IDLE-002" });
      registerDef(def);
      const card = makeInstance(def, { instanceId: "idle-2" });
      const state = makeState([card]);
      state.battleEntities = [
        {
          entityId: "be-idle",
          memberInstanceIds: ["idle-2"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ];

      const clause = { kind: "in_battle" as const };
      expect(
        evaluateCondition(state, [clause], "idle-2", "alice", getDef)
      ).toBe(false);
    });
  });

  // ============================================================
  // A-4: override_properties プロパティコピー (copy_from スナップショット)
  // ============================================================

  describe("A-4: override_properties copy_from スナップショット", () => {
    function runOverride(
      state: GameState,
      sourceInstanceId: string,
      properties: Record<string, unknown>
    ): GameState {
      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: properties as never,
              duration: { scope: "permanent" },
            },
          },
        ],
      };
      return executeEffect({
        chainId: "test:effect-interpreter:2148",
        state,
        effect,
        sourceInstanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
    }

    it("bp copy_from — 相手のスピリットの実効 BP を全レベル一律でスナップショット", () => {
      const selfDef = makeDef({
        cardNo: "SELF-BP",
        name: "コピー側",
        levelDefs: [
          { level: 1, requiredCores: 1, bp: 1000 },
          { level: 2, requiredCores: 3, bp: 2000 },
        ],
      });
      const oppDef = makeDef({
        cardNo: "OPP-BP",
        name: "コピー元",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
      });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-bp" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-bp",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-bp", {
        bp: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      expect(ce).toBeDefined();
      const props = ce!.metadata!.properties as {
        bp: { lv1: number; lv2?: number; lv3?: number };
      };
      expect(props.bp).toEqual({ lv1: 8000, lv2: 8000, lv3: 8000 });
    });

    it("bp copy_from — スナップショット後にソース BP が変わっても CE は不変", () => {
      const selfDef = makeDef({
        cardNo: "SELF-SNAP",
        name: "スナップ側",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      });
      const oppDef = makeDef({
        cardNo: "OPP-SNAP",
        name: "スナップ元",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-snap" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-snap",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-snap", {
        bp: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      // ソースがフィールドから消えても CE のスナップショット値は変わらない
      const oppGone = result.cardInstances.map((c) =>
        c.instanceId === "opp-snap" ? { ...c, zone: "trash" as const } : c
      );
      const stateAfter: GameState = { ...result, cardInstances: oppGone };
      const ce = stateAfter.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as { bp: { lv1: number } };
      expect(props.bp.lv1).toBe(5000);
    });

    it("symbols copy_from — 相手スピリットの実効シンボルをスナップショット", () => {
      const selfDef = makeDef({
        cardNo: "SELF-SYM",
        symbolColors: ["red"],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      });
      const oppDef = makeDef({
        cardNo: "OPP-SYM",
        symbolColors: ["blue", "white"],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-sym" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-sym",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-sym", {
        symbols: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as { symbols: string[] };
      expect(props.symbols).toEqual(["blue", "white"]);
    });

    it("cardName copy_from — 相手スピリットのカード名をスナップショット", () => {
      const selfDef = makeDef({ cardNo: "SELF-CN", name: "セルフ" });
      const oppDef = makeDef({ cardNo: "OPP-CN", name: "オポネント" });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-cn" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-cn",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-cn", {
        cardName: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as { cardName: string };
      expect(props.cardName).toBe("オポネント");
    });

    it("cost copy_from — 相手スピリットの定義コストをスナップショット", () => {
      const selfDef = makeDef({ cardNo: "SELF-COST", cost: 3 });
      const oppDef = makeDef({ cardNo: "OPP-COST", cost: 7 });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-cost" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-cost",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-cost", {
        cost: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as { cost: number };
      expect(props.cost).toBe(7);
    });

    it("tribes copy_from — 「・」区切りの系統文字列を配列にスナップショット", () => {
      const selfDef = makeDef({ cardNo: "SELF-TR", tribe: "武装" });
      const oppDef = makeDef({ cardNo: "OPP-TR", tribe: "幻想・導魔" });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-tr" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-tr",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-tr", {
        tribes: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as { tribes: string[] };
      expect(props.tribes).toEqual(["幻想", "導魔"]);
    });

    it("リテラル値と copy_self は copy_from と共存できる", () => {
      const selfDef = makeDef({
        cardNo: "SELF-MIX",
        name: "ミックス",
        cost: 2,
      });
      const oppDef = makeDef({
        cardNo: "OPP-MIX",
        name: "ターゲット",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      });
      registerDef(selfDef);
      registerDef(oppDef);
      const self = makeInstance(selfDef, { instanceId: "self-mix" });
      const opp = makeInstance(oppDef, {
        instanceId: "opp-mix",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([self, opp]);

      const result = runOverride(state, "self-mix", {
        // 名前はソース自身、BP は相手から、コストはリテラル
        cardName: "copy_self",
        bp: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
        cost: 99,
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      const props = ce!.metadata!.properties as {
        cardName: string;
        bp: { lv1: number };
        cost: number;
      };
      expect(props.cardName).toBe("copy_self"); // copy_self はそのまま保存（getOverriddenProperties で解決）
      expect(props.bp.lv1).toBe(6000);
      expect(props.cost).toBe(99);
    });

    it("copy_from の対象が見つからない場合は当該プロパティを除外", () => {
      const selfDef = makeDef({
        cardNo: "SELF-MISS",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      });
      registerDef(selfDef);
      const self = makeInstance(selfDef, { instanceId: "self-miss" });
      // 相手スピリットなし
      const state = makeState([self]);

      const result = runOverride(state, "self-miss", {
        bp: {
          copy_from: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      });

      const ce = result.activeContinuousEffects.find(
        (c) => c.modifierTag === "override_properties"
      );
      // CE は登録されるが bp プロパティは undefined → 削除済み
      expect(ce).toBeDefined();
      const props = ce!.metadata!.properties as Record<string, unknown>;
      expect(props.bp).toBeUndefined();
    });
  });

  // ============================================================
  // summon target:"other" — 複数体同時召喚のコア計算
  // ============================================================
  describe("summon (target:other) — 複数体同時召喚でコアが増殖しない", () => {
    it("reserve=3 / 2体同時召喚 / requiredCores=2 ならフィールドコアと残 reserve の合計が元コアを超えない", () => {
      const sourceDef = makeDef({ cardNo: "SRC-MULTI" });
      registerDef(sourceDef);
      const summonDef = makeDef({
        cardNo: "TARGET-MULTI",
        cost: 0,
        levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
      });
      registerDef(summonDef);

      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-multi",
        zone: "field",
      });
      const handCard1 = createCardInstance(summonDef, {
        ownerPlayerId: "alice",
        zone: "hand",
        instanceId: "hand-multi-1",
      });
      const handCard2 = createCardInstance(summonDef, {
        ownerPlayerId: "alice",
        zone: "hand",
        instanceId: "hand-multi-2",
      });

      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard, handCard1, handCard2],
        playerOverrides: [{ reserveNormalCoreCount: 3, handCount: 2 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                count: 2,
              },
              costModifier: "free",
            },
          },
        ],
      };

      const pendingState = executeEffect({
        chainId: "test:effect-interpreter:2509",
        state,
        effect,
        sourceInstanceId: "src-multi",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(pendingState.pendingMultiPlacement).not.toBeNull();
      const result = resolvePendingMultiPlacementForTest(pendingState, [
        {
          destinationInstanceId: "hand-multi-1",
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
        {
          destinationInstanceId: "hand-multi-2",
          placements: [
            { kind: "reserve_normal", amount: 1 },
            { kind: "card_normal", instanceId: "src-multi", amount: 1 },
          ],
        },
      ]);

      const aliceAfter = result.players.find((p) => p.id === "alice")!;
      const summoned1 = result.cardInstances.find(
        (c) => c.instanceId === "hand-multi-1"
      )!;
      const summoned2 = result.cardInstances.find(
        (c) => c.instanceId === "hand-multi-2"
      )!;
      const sourceAfter = result.cardInstances.find(
        (c) => c.instanceId === "src-multi"
      )!;

      expect(summoned1.zone).toBe("field");
      expect(summoned2.zone).toBe("field");

      // コア保存則: reserve とフィールドの既存コアから置いた合計が元コアを超えない
      const totalCoreAfter =
        aliceAfter.reserveNormalCoreCount +
        sourceAfter.normalCoreCount +
        summoned1.normalCoreCount +
        summoned2.normalCoreCount;
      expect(totalCoreAfter).toBe(4);

      // 期待挙動: 1体目に minCores=2 を満たす配置、2体目は残 reserve と場から配置
      expect(summoned1.normalCoreCount).toBe(2);
      expect(summoned2.normalCoreCount).toBe(2);
      expect(aliceAfter.reserveNormalCoreCount).toBe(0);
      expect(sourceAfter.normalCoreCount).toBe(0);
    });

    it("reserve=2 / 3体同時召喚 / requiredCores=1 なら場のコアも使って requiredCores を満たす", () => {
      const sourceDef = makeDef({ cardNo: "SRC-TRIPLE" });
      registerDef(sourceDef);
      const summonDef = makeDef({
        cardNo: "TARGET-TRIPLE",
        cost: 0,
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      });
      registerDef(summonDef);

      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-triple",
        zone: "field",
      });
      const handCards = [1, 2, 3].map((i) =>
        createCardInstance(summonDef, {
          ownerPlayerId: "alice",
          zone: "hand",
          instanceId: `hand-triple-${i}`,
        })
      );

      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard, ...handCards],
        playerOverrides: [{ reserveNormalCoreCount: 2, handCount: 3 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                count: 3,
              },
              costModifier: "free",
            },
          },
        ],
      };

      const pendingState = executeEffect({
        chainId: "test:effect-interpreter:2605",
        state,
        effect,
        sourceInstanceId: "src-triple",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(pendingState.pendingMultiPlacement).not.toBeNull();
      const result = resolvePendingMultiPlacementForTest(pendingState, [
        {
          destinationInstanceId: "hand-triple-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "hand-triple-2",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "hand-triple-3",
          placements: [
            { kind: "card_normal", instanceId: "src-triple", amount: 1 },
          ],
        },
      ]);

      const aliceAfter = result.players.find((p) => p.id === "alice")!;
      const summoned = handCards.map(
        (c) => result.cardInstances.find((x) => x.instanceId === c.instanceId)!
      );
      const sourceAfter = result.cardInstances.find(
        (c) => c.instanceId === "src-triple"
      )!;

      expect(summoned.every((c) => c.zone === "field")).toBe(true);

      const totalCoreAfter =
        aliceAfter.reserveNormalCoreCount +
        sourceAfter.normalCoreCount +
        summoned.reduce((sum, c) => sum + c.normalCoreCount, 0);
      expect(totalCoreAfter).toBe(3);

      // 期待: reserve と場の既存コアから 3 体すべての minimumRequiredCores を満たす
      expect(summoned[0]!.normalCoreCount).toBe(1);
      expect(summoned[1]!.normalCoreCount).toBe(1);
      expect(summoned[2]!.normalCoreCount).toBe(1);
      expect(aliceAfter.reserveNormalCoreCount).toBe(0);
      expect(sourceAfter.normalCoreCount).toBe(0);
    });
  });

  // ============================================================
  // summon — コスト支払いコアが trash に正しく堆積する（コア保存則）
  // ============================================================
  describe("summon — コスト支払いコアが trash に堆積する", () => {
    it("target:self / fixedPayment=1 / reserve=3 → trash=1, field=1, reserve=1 で総量保存", () => {
      const summonDef = makeDef({
        cardNo: "SELF-FIXED-1",
        cost: 7,
        levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      });
      registerDef(summonDef);

      const handCard = createCardInstance(summonDef, {
        ownerPlayerId: "alice",
        zone: "hand",
        instanceId: "self-fixed",
      });

      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [handCard],
        playerOverrides: [{ reserveNormalCoreCount: 3, handCount: 1 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:effect-interpreter:2692",
        summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        state,
        effect,
        sourceInstanceId: "self-fixed",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const aliceAfter = result.players.find((p) => p.id === "alice")!;
      const summoned = result.cardInstances.find(
        (c) => c.instanceId === "self-fixed"
      )!;

      expect(summoned.zone).toBe("field");
      expect(summoned.normalCoreCount).toBe(1);
      expect(aliceAfter.reserveNormalCoreCount).toBe(1);
      // バグ再現防止: コスト分の 1 コアがトラッシュに堆積している
      expect(aliceAfter.trashNormalCoreCount).toBe(1);
      // コア保存則: 元 reserve == 残 reserve + field + trash
      const totalCoreAfter =
        aliceAfter.reserveNormalCoreCount +
        aliceAfter.trashNormalCoreCount +
        summoned.normalCoreCount;
      expect(totalCoreAfter).toBe(3);
    });

    it("target:other / 通常コスト=2 / reserve=4 → trash=2, field=1, reserve=1 で総量保存", () => {
      const sourceDef = makeDef({ cardNo: "SRC-OTHER-COST" });
      registerDef(sourceDef);
      const summonDef = makeDef({
        cardNo: "OTHER-NORMAL",
        cost: 2,
        levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      });
      registerDef(summonDef);

      const sourceCard = makeInstance(sourceDef, {
        instanceId: "src-other-cost",
        zone: "field",
      });
      const handCard = createCardInstance(summonDef, {
        ownerPlayerId: "alice",
        zone: "hand",
        instanceId: "hand-other-cost",
      });

      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [sourceCard, handCard],
        playerOverrides: [{ reserveNormalCoreCount: 4, handCount: 1 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                count: 1,
              },
            },
          },
        ],
      };

      const pendingState = executeEffect({
        chainId: "test:effect-interpreter:2760",
        summonPaymentSources: [{ kind: "reserve", amount: 2 }],
        state,
        effect,
        sourceInstanceId: "src-other-cost",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(pendingState.pendingMultiPlacement).not.toBeNull();
      const result = resolvePendingMultiPlacementForTest(pendingState, [
        {
          destinationInstanceId: "hand-other-cost",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ]);

      const aliceAfter = result.players.find((p) => p.id === "alice")!;
      const summoned = result.cardInstances.find(
        (c) => c.instanceId === "hand-other-cost"
      )!;

      expect(summoned.zone).toBe("field");
      expect(summoned.normalCoreCount).toBe(1);
      expect(aliceAfter.reserveNormalCoreCount).toBe(1);
      expect(aliceAfter.trashNormalCoreCount).toBe(2);
      const totalCoreAfter =
        aliceAfter.reserveNormalCoreCount +
        aliceAfter.trashNormalCoreCount +
        summoned.normalCoreCount;
      expect(totalCoreAfter).toBe(4);
    });
  });
});

describe("from_zone summon target selection", () => {
  const sourceDef = makeDef({
    cardNo: "ENGINE-FROM-ZONE-SOURCE",
    name: "from-zone summon source",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { category: ["spirit"] },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
      },
    ],
  });
  const targetDefA = makeDef({
    cardNo: "ENGINE-FROM-ZONE-A",
    name: "target A",
  });
  const targetDefB = makeDef({
    cardNo: "ENGINE-FROM-ZONE-B",
    name: "target B",
  });
  const defs = [sourceDef, targetDefA, targetDefB];
  const getDef = (id: string) => defs.find((def) => def.cardNo === id);

  it("registration exposes hand candidates for summon from_zone instead of silent auto-selection", () => {
    const lookup = buildFieldCardEffectLookup(defs);
    const reg = lookup(sourceDef.cardNo)?.[0];
    expect(reg).toMatchObject({
      requiredTargetCount: 1,
      candidateTargetPlayerScope: "acting_player",
      candidateTargetZones: ["hand"],
      targetCardFilter: { category: ["spirit"] },
    });
  });

  it("executeEffect consumes preSelectedIds and summons the chosen hand card", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 8 }, {}],
    });
    const source = makeInstance(sourceDef, {
      instanceId: "source",
      definitionId: sourceDef.cardNo,
      zone: "field",
      normalCoreCount: 1,
    });
    const first = makeInstance(targetDefA, {
      instanceId: "first-candidate",
      definitionId: targetDefA.cardNo,
      zone: "hand",
      normalCoreCount: 0,
    });
    const chosen = makeInstance(targetDefB, {
      instanceId: "chosen-candidate",
      definitionId: targetDefB.cardNo,
      zone: "hand",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, first, chosen],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:2869",
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["chosen-candidate"],
    });

    const firstAfter = result.cardInstances.find(
      (card) => card.instanceId === "first-candidate"
    );
    const chosenAfter = result.cardInstances.find(
      (card) => card.instanceId === "chosen-candidate"
    );
    expect(firstAfter?.zone).toBe("hand");
    expect(chosenAfter?.zone).toBe("field");
  });

  it("on_step target selection excludes from_zone candidates that cannot be auto-executed", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SOURCE",
      name: "from-zone on-step source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const cheapTargetDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-CHEAP",
      name: "on-step cheap target",
      cost: 0,
    });
    const expensiveTargetDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-EXPENSIVE",
      name: "on-step expensive target",
      cost: 2,
    });
    const defs = [onStepSourceDef, cheapTargetDef, expensiveTargetDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const source = makeInstance(onStepSourceDef, {
      instanceId: "on-step-source",
      definitionId: onStepSourceDef.cardNo,
      zone: "field",
      normalCoreCount: 1,
    });
    const cheap = makeInstance(cheapTargetDef, {
      instanceId: "on-step-cheap",
      definitionId: cheapTargetDef.cardNo,
      zone: "trash",
      normalCoreCount: 0,
    });
    const expensive = makeInstance(expensiveTargetDef, {
      instanceId: "on-step-expensive",
      definitionId: expensiveTargetDef.cardNo,
      zone: "trash",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const result = executeEffect({
      chainId: "test:effect-interpreter:2948",
      state: {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [source, cheap, expensive],
      },
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = result.pendingStepOptionalTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.requiredTargetCount).toBe(0);
    expect(pending!.maxTargetCount).toBe(1);
    expect(pending!.candidateInstanceIds).toEqual(["on-step-cheap"]);
  });

  it("on_step from_zone summon target selection clamps shared resource capacity", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SHARED-RESOURCE-SOURCE",
      name: "from-zone on-step shared resource source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-shared-resource-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const targetADef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SHARED-A",
      name: "on-step shared resource A",
      cost: 1,
    });
    const targetBDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SHARED-B",
      name: "on-step shared resource B",
      cost: 1,
    });
    const defs = [onStepSourceDef, targetADef, targetBDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeSharedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        makeInstance(onStepSourceDef, {
          instanceId: "on-step-shared-source",
          definitionId: onStepSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 0,
        }),
        makeInstance(targetADef, {
          instanceId: "on-step-shared-a",
          definitionId: targetADef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
        makeInstance(targetBDef, {
          instanceId: "on-step-shared-b",
          definitionId: targetBDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const result = executeEffect({
      chainId: "test:effect-interpreter:3034",
      state: makeSharedState(),
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-shared-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = result.pendingStepOptionalTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.requiredTargetCount).toBe(0);
    expect(pending!.maxTargetCount).toBe(1);
    expect(pending!.candidateInstanceIds).toEqual([
      "on-step-shared-a",
      "on-step-shared-b",
    ]);

    const resolve = (targetInstanceIds: string[]) =>
      applyPendingStepOptionalTargetSelectionAction({
        state: result,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${pending!.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: pending!.choosingPlayerId,
          pendingId: pending!.pendingId,
          sourceInstanceId: pending!.sourceInstanceId,
          sourceDefinitionId: pending!.sourceDefinitionId,
          effectIndex: pending!.effectIndex,
          stepIndex: pending!.stepIndex,
          requiredTargetCount: pending!.requiredTargetCount,
          maxTargetCount: pending!.maxTargetCount,
          candidateTargetInstanceIds: pending!.candidateInstanceIds,
        },
        targetInstanceIds,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

    expect(() => resolve(["on-step-shared-a", "on-step-shared-b"])).toThrow(
      /out of range/
    );

    const singleResolved = resolve(["on-step-shared-b"]);
    expect(
      singleResolved.cardInstances.find(
        (card) => card.instanceId === "on-step-shared-b"
      )?.zone
    ).toBe("field");
  });

  it("on_step from_zone summon target selection finds later executable subsets", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SUBSET-SOURCE",
      name: "from-zone on-step subset source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-subset-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const heavyDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SUBSET-HEAVY",
      name: "on-step subset heavy",
      cost: 3,
    });
    const cheapADef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SUBSET-CHEAP-A",
      name: "on-step subset cheap A",
      cost: 1,
    });
    const cheapBDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-SUBSET-CHEAP-B",
      name: "on-step subset cheap B",
      cost: 1,
    });
    const defs = [onStepSourceDef, heavyDef, cheapADef, cheapBDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const result = executeEffect({
      chainId: "test:effect-interpreter:3129",
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
        }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          makeInstance(onStepSourceDef, {
            instanceId: "on-step-subset-source",
            definitionId: onStepSourceDef.cardNo,
            zone: "field",
            normalCoreCount: 0,
          }),
          makeInstance(heavyDef, {
            instanceId: "on-step-subset-heavy",
            definitionId: heavyDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(cheapADef, {
            instanceId: "on-step-subset-cheap-a",
            definitionId: cheapADef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(cheapBDef, {
            instanceId: "on-step-subset-cheap-b",
            definitionId: cheapBDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
        ],
      },
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-subset-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = result.pendingStepOptionalTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.maxTargetCount).toBe(2);
    expect(pending!.candidateInstanceIds).toEqual([
      "on-step-subset-heavy",
      "on-step-subset-cheap-a",
      "on-step-subset-cheap-b",
    ]);

    const resolve = (targetInstanceIds: string[]) =>
      applyPendingStepOptionalTargetSelectionAction({
        state: result,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${pending!.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: pending!.choosingPlayerId,
          pendingId: pending!.pendingId,
          sourceInstanceId: pending!.sourceInstanceId,
          sourceDefinitionId: pending!.sourceDefinitionId,
          effectIndex: pending!.effectIndex,
          stepIndex: pending!.stepIndex,
          requiredTargetCount: pending!.requiredTargetCount,
          maxTargetCount: pending!.maxTargetCount,
          candidateTargetInstanceIds: pending!.candidateInstanceIds,
        },
        targetInstanceIds,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

    expect(() =>
      resolve(["on-step-subset-heavy", "on-step-subset-cheap-a"])
    ).toThrow(/collectively auto-executable/);

    const resolved = resolve([
      "on-step-subset-cheap-a",
      "on-step-subset-cheap-b",
    ]);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "on-step-subset-cheap-a"
      )?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "on-step-subset-cheap-b"
      )?.zone
    ).toBe("field");
  });

  it("on_step from_zone summon target resolution rejects collectively non-executable selections", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-COLLECTIVE-SOURCE",
      name: "from-zone on-step collective source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-collective-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const cheapDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-COLLECTIVE-CHEAP",
      name: "on-step collective cheap",
      cost: 1,
    });
    const expensiveADef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-COLLECTIVE-A",
      name: "on-step collective expensive A",
      cost: 3,
    });
    const expensiveBDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-COLLECTIVE-B",
      name: "on-step collective expensive B",
      cost: 3,
    });
    const defs = [onStepSourceDef, cheapDef, expensiveADef, expensiveBDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const result = executeEffect({
      chainId: "test:effect-interpreter:3265",
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          // Two summons pay 1 + 3 and need two distinct maintenance cores.
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          makeInstance(onStepSourceDef, {
            instanceId: "on-step-collective-source",
            definitionId: onStepSourceDef.cardNo,
            zone: "field",
            normalCoreCount: 1,
          }),
          makeInstance(cheapDef, {
            instanceId: "on-step-collective-cheap",
            definitionId: cheapDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(expensiveADef, {
            instanceId: "on-step-collective-a",
            definitionId: expensiveADef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(expensiveBDef, {
            instanceId: "on-step-collective-b",
            definitionId: expensiveBDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
        ],
      },
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-collective-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = result.pendingStepOptionalTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.maxTargetCount).toBe(2);
    expect(pending!.candidateInstanceIds).toEqual([
      "on-step-collective-cheap",
      "on-step-collective-a",
      "on-step-collective-b",
    ]);

    const resolve = (targetInstanceIds: string[]) =>
      applyPendingStepOptionalTargetSelectionAction({
        state: result,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${pending!.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: pending!.choosingPlayerId,
          pendingId: pending!.pendingId,
          sourceInstanceId: pending!.sourceInstanceId,
          sourceDefinitionId: pending!.sourceDefinitionId,
          effectIndex: pending!.effectIndex,
          stepIndex: pending!.stepIndex,
          requiredTargetCount: pending!.requiredTargetCount,
          maxTargetCount: pending!.maxTargetCount,
          candidateTargetInstanceIds: pending!.candidateInstanceIds,
        },
        targetInstanceIds,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

    expect(() =>
      resolve(["on-step-collective-a", "on-step-collective-b"])
    ).toThrow(/collectively auto-executable/);

    const resolved = finishCoreChoices(
      resolve(["on-step-collective-cheap", "on-step-collective-b"]),
      lookup
    );
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "on-step-collective-b"
      )?.zone
    ).toBe("field");
  });

  it("on_step from_zone summon candidate selection honors summonCause additional cost", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-CAUSE-SOURCE",
      name: "from-zone on-step summon cause source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-summon-cause",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit", "ultimate"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const taxedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-TAXED-SPIRIT",
      name: "on-step taxed spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const untaxedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-UNTAXED-ULTIMATE",
      name: "on-step untaxed ultimate",
      cost: 0,
      printedCategory: "ultimate",
    });
    const defs = [onStepSourceDef, taxedSpiritDef, untaxedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeTaxedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", "bob", 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
      cardInstances: [
        makeInstance(onStepSourceDef, {
          instanceId: "on-step-cause-source",
          definitionId: onStepSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(taxedSpiritDef, {
          instanceId: "on-step-taxed-spirit",
          definitionId: taxedSpiritDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
        makeInstance(untaxedUltimateDef, {
          instanceId: "on-step-untaxed-ultimate",
          definitionId: untaxedUltimateDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const run = (effectActionKind: EffectResolutionActionKind) =>
      executeEffect({
        chainId: "test:effect-interpreter:3430",
        state: makeTaxedState(),
        effect: onStepSourceDef.effects![0]!,
        sourceInstanceId: "on-step-cause-source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        effectActionKind,
      }).pendingStepOptionalTargetSelection;

    expect(run("triggered_effect")!.candidateInstanceIds).toEqual([
      "on-step-untaxed-ultimate",
    ]);
    expect(run("burst_activation")!.candidateInstanceIds).toEqual([
      "on-step-taxed-spirit",
      "on-step-untaxed-ultimate",
    ]);

    const burstPending = run("burst_activation")!;
    expect(burstPending.continuation.effectActionKind).toBe("burst_activation");
    const afterBurstResume = applyPendingStepOptionalTargetSelectionAction({
      state: {
        ...makeTaxedState(),
        pendingStepOptionalTargetSelection: burstPending,
      },
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${burstPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: burstPending.choosingPlayerId,
        pendingId: burstPending.pendingId,
        sourceInstanceId: burstPending.sourceInstanceId,
        sourceDefinitionId: burstPending.sourceDefinitionId,
        effectIndex: burstPending.effectIndex,
        stepIndex: burstPending.stepIndex,
        requiredTargetCount: burstPending.requiredTargetCount,
        maxTargetCount: burstPending.maxTargetCount,
        candidateTargetInstanceIds: burstPending.candidateInstanceIds,
      },
      targetInstanceIds: ["on-step-taxed-spirit"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(
      afterBurstResume.cardInstances.find(
        (card) => card.instanceId === "on-step-taxed-spirit"
      )?.zone
    ).toBe("field");
  });

  it("on_step from_zone summon candidate selection excludes ultimate with unmet summonCondition", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-ULTIMATE-GATE-SOURCE",
      name: "from-zone on-step ultimate gate source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-ultimate-gate-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit", "ultimate"] },
                  count: { min: 0, max: 2 },
                },
              },
            },
          ],
        },
      ],
    });
    const allowedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-GATE-SPIRIT",
      name: "on-step gate spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const blockedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-GATE-ULTIMATE",
      name: "on-step blocked ultimate",
      cost: 0,
      printedCategory: "ultimate",
      summonCondition: [
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "missing condition anchor" }],
          minCount: 1,
        },
      ],
    });
    const defs = [onStepSourceDef, allowedSpiritDef, blockedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    const result = executeEffect({
      chainId: "test:effect-interpreter:3533",
      state: {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          makeInstance(onStepSourceDef, {
            instanceId: "on-step-gate-source",
            definitionId: onStepSourceDef.cardNo,
            zone: "field",
            normalCoreCount: 1,
          }),
          makeInstance(blockedUltimateDef, {
            instanceId: "on-step-blocked-ultimate",
            definitionId: blockedUltimateDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(allowedSpiritDef, {
            instanceId: "on-step-allowed-spirit",
            definitionId: allowedSpiritDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
        ],
      },
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-gate-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    });

    expect(result.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 1,
      candidateInstanceIds: ["on-step-allowed-spirit"],
    });
  });

  it("on_step from_zone summon keeps ultimate with unmet summonCondition when ignoreSummonCondition is true", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-IGNORE-GATE-SOURCE",
      name: "from-zone on-step ignore gate source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-ignore-gate-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["ultimate"] },
                  count: { min: 0, max: 1 },
                },
                ignoreSummonCondition: true,
              },
            },
          ],
        },
      ],
    });
    const blockedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-IGNORE-GATE-ULTIMATE",
      name: "on-step ignore blocked ultimate",
      cost: 0,
      printedCategory: "ultimate",
      summonCondition: [
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "missing condition anchor" }],
          minCount: 1,
        },
      ],
    });
    const defs = [onStepSourceDef, blockedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    const result = executeEffect({
      chainId: "test:effect-interpreter:3620",
      state: {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          makeInstance(onStepSourceDef, {
            instanceId: "on-step-ignore-gate-source",
            definitionId: onStepSourceDef.cardNo,
            zone: "field",
            normalCoreCount: 1,
          }),
          makeInstance(blockedUltimateDef, {
            instanceId: "on-step-ignore-gate-ultimate",
            definitionId: blockedUltimateDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
        ],
      },
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-ignore-gate-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    });

    expect(result.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 1,
      candidateInstanceIds: ["on-step-ignore-gate-ultimate"],
    });
  });

  it("optional from_zone summon opens target selection for ignored summonCondition ultimate", () => {
    const optionalSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-IGNORE-GATE-SOURCE",
      name: "from-zone optional ignore gate source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-ignore-gate-summon",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["ultimate"] },
                  count: { min: 0, max: 1 },
                },
                ignoreSummonCondition: true,
              },
            },
          ],
        },
      ],
    });
    const blockedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-IGNORE-GATE-ULTIMATE",
      name: "optional ignore blocked ultimate",
      cost: 0,
      printedCategory: "ultimate",
      summonCondition: [
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "missing condition anchor" }],
          minCount: 1,
        },
      ],
    });
    const defs = [optionalSourceDef, blockedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeIgnoreState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        makeInstance(optionalSourceDef, {
          instanceId: "optional-ignore-gate-source",
          definitionId: optionalSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(blockedUltimateDef, {
          instanceId: "optional-ignore-gate-ultimate",
          definitionId: blockedUltimateDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const initial = executeEffect({
      chainId: "test:effect-interpreter:3719",
      state: makeIgnoreState(),
      effect: optionalSourceDef.effects![0]!,
      sourceInstanceId: "optional-ignore-gate-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    });
    const choice = initial.pendingStepOptionalChoice!;
    expect(choice).toMatchObject({
      stepIndex: 0,
      canExecute: true,
    });

    const afterChoice = applyPendingStepOptionalChoiceAction({
      state: initial,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `psoc-${choice.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: choice.choosingPlayerId,
        pendingId: choice.pendingId,
        sourceInstanceId: choice.sourceInstanceId,
        effectIndex: choice.effectIndex,
        stepIndex: choice.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(afterChoice.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 1,
      candidateInstanceIds: ["optional-ignore-gate-ultimate"],
    });
  });

  it("from_zone summon execution skips ultimate with unmet summonCondition", () => {
    const directSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-DIRECT-ULTIMATE-GATE-SOURCE",
      name: "from-zone direct ultimate gate source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "direct-ultimate-gate-summon",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    });
    const allowedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-DIRECT-GATE-SPIRIT",
      name: "direct gate spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const blockedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-DIRECT-GATE-ULTIMATE",
      name: "direct blocked ultimate",
      cost: 0,
      printedCategory: "ultimate",
      summonCondition: [
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "missing condition anchor" }],
          minCount: 1,
        },
      ],
    });
    const defs = [directSourceDef, allowedSpiritDef, blockedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    const result = executeEffect({
      chainId: "test:effect-interpreter:3809",
      state: {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          makeInstance(directSourceDef, {
            instanceId: "direct-gate-source",
            definitionId: directSourceDef.cardNo,
            zone: "field",
            normalCoreCount: 1,
          }),
          makeInstance(blockedUltimateDef, {
            instanceId: "direct-blocked-ultimate",
            definitionId: blockedUltimateDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
          makeInstance(allowedSpiritDef, {
            instanceId: "direct-allowed-spirit",
            definitionId: allowedSpiritDef.cardNo,
            zone: "trash",
            normalCoreCount: 0,
          }),
        ],
      },
      effect: directSourceDef.effects![0]!,
      sourceInstanceId: "direct-gate-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    });

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "direct-blocked-ultimate"
      )?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "direct-allowed-spirit"
      )?.zone
    ).toBe("field");
  });

  it("on_step forced from_zone keeps exact executable candidates in target selection", () => {
    const onStepSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-EXACT-SOURCE",
      name: "from-zone on-step exact source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "on-step-exact-summon",
              targetSelectionTiming: "on_step",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    });
    const taxedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-EXACT-TAXED-SPIRIT",
      name: "on-step exact taxed spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const untaxedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-ON-STEP-EXACT-UNTAXED-ULTIMATE",
      name: "on-step exact untaxed ultimate",
      cost: 0,
      printedCategory: "ultimate",
    });
    const defs = [onStepSourceDef, taxedSpiritDef, untaxedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeTaxedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", "bob", 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
      cardInstances: [
        makeInstance(onStepSourceDef, {
          instanceId: "on-step-exact-source",
          definitionId: onStepSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(taxedSpiritDef, {
          instanceId: "on-step-exact-taxed-spirit",
          definitionId: taxedSpiritDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
        makeInstance(untaxedUltimateDef, {
          instanceId: "on-step-exact-untaxed-ultimate",
          definitionId: untaxedUltimateDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const pending = executeEffect({
      chainId: "test:effect-interpreter:3929",
      state: makeTaxedState(),
      effect: onStepSourceDef.effects![0]!,
      sourceInstanceId: "on-step-exact-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    }).pendingStepOptionalTargetSelection;

    expect(pending).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["on-step-exact-untaxed-ultimate"],
    });

    const after = applyPendingStepOptionalTargetSelectionAction({
      state: {
        ...makeTaxedState(),
        pendingStepOptionalTargetSelection: pending!,
      },
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${pending!.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.choosingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        sourceDefinitionId: pending!.sourceDefinitionId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        requiredTargetCount: pending!.requiredTargetCount,
        maxTargetCount: pending!.maxTargetCount,
        candidateTargetInstanceIds: pending!.candidateInstanceIds,
      },
      targetInstanceIds: ["on-step-exact-untaxed-ultimate"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "on-step-exact-untaxed-ultimate"
      )?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "on-step-exact-taxed-spirit"
      )?.zone
    ).toBe("trash");
  });

  it("optional from_zone summon canExecute honors summonCause additional cost", () => {
    const optionalSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-CAUSE-SOURCE",
      name: "from-zone optional summon cause source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-summon-cause",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    });
    const taxedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-TAXED-SPIRIT",
      name: "optional taxed spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const defs = [optionalSourceDef, taxedSpiritDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeTaxedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", "bob", 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
      cardInstances: [
        makeInstance(optionalSourceDef, {
          instanceId: "optional-cause-source",
          definitionId: optionalSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(taxedSpiritDef, {
          instanceId: "optional-taxed-spirit",
          definitionId: taxedSpiritDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const run = (effectActionKind: EffectResolutionActionKind) =>
      executeEffect({
        chainId: "test:effect-interpreter:4045",
        state: makeTaxedState(),
        effect: optionalSourceDef.effects![0]!,
        sourceInstanceId: "optional-cause-source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        effectActionKind,
      }).pendingStepOptionalChoice;

    expect(run("triggered_effect")).toMatchObject({
      stepIndex: 0,
      canExecute: false,
    });
    expect(run("burst_activation")).toMatchObject({
      stepIndex: 0,
      canExecute: true,
    });
  });

  it("optional from_zone summon execute opens target selection with executable candidates", () => {
    const optionalSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-TARGET-SOURCE",
      name: "from-zone optional target source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-target-summon",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    });
    const taxedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-TARGET-TAXED-SPIRIT",
      name: "optional target taxed spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const untaxedUltimateDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-TARGET-UNTAXED-ULTIMATE",
      name: "optional target untaxed ultimate",
      cost: 0,
      printedCategory: "ultimate",
    });
    const defs = [optionalSourceDef, taxedSpiritDef, untaxedUltimateDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeTaxedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", "bob", 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
      cardInstances: [
        makeInstance(optionalSourceDef, {
          instanceId: "optional-target-source",
          definitionId: optionalSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(taxedSpiritDef, {
          instanceId: "optional-target-taxed-spirit",
          definitionId: taxedSpiritDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
        makeInstance(untaxedUltimateDef, {
          instanceId: "optional-target-untaxed-ultimate",
          definitionId: untaxedUltimateDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });
    const initial = executeEffect({
      chainId: "test:effect-interpreter:4139",
      state: makeTaxedState(),
      effect: optionalSourceDef.effects![0]!,
      sourceInstanceId: "optional-target-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "triggered_effect",
    });
    const choice = initial.pendingStepOptionalChoice!;
    expect(choice).toMatchObject({
      stepIndex: 0,
      canExecute: true,
    });

    const afterChoice = applyPendingStepOptionalChoiceAction({
      state: initial,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `psoc-${choice.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: choice.choosingPlayerId,
        pendingId: choice.pendingId,
        sourceInstanceId: choice.sourceInstanceId,
        effectIndex: choice.effectIndex,
        stepIndex: choice.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const pending = afterChoice.pendingStepOptionalTargetSelection;
    expect(pending).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
      candidateInstanceIds: ["optional-target-untaxed-ultimate"],
    });

    const afterTarget = applyPendingStepOptionalTargetSelectionAction({
      state: afterChoice,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${pending!.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.choosingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        sourceDefinitionId: pending!.sourceDefinitionId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        requiredTargetCount: pending!.requiredTargetCount,
        maxTargetCount: pending!.maxTargetCount,
        candidateTargetInstanceIds: pending!.candidateInstanceIds,
      },
      targetInstanceIds: ["optional-target-untaxed-ultimate"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(
      afterTarget.cardInstances.find(
        (card) => card.instanceId === "optional-target-untaxed-ultimate"
      )?.zone
    ).toBe("field");
    expect(
      afterTarget.cardInstances.find(
        (card) => card.instanceId === "optional-target-taxed-spirit"
      )?.zone
    ).toBe("trash");
  });

  it("auto-resume keeps burst effectActionKind for optional from_zone summon", () => {
    const optionalSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-AUTO-RESUME-SOURCE",
      name: "from-zone optional auto resume source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "optional-auto-resume-summon",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    });
    const taxedSpiritDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-OPTIONAL-AUTO-RESUME-TAXED-SPIRIT",
      name: "optional auto resume taxed spirit",
      cost: 0,
      printedCategory: "spirit",
    });
    const defs = [optionalSourceDef, taxedSpiritDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const makeTaxedState = (): GameState => ({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", "bob", 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
      cardInstances: [
        makeInstance(optionalSourceDef, {
          instanceId: "optional-auto-resume-source",
          definitionId: optionalSourceDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(taxedSpiritDef, {
          instanceId: "optional-auto-resume-taxed-spirit",
          definitionId: taxedSpiritDef.cardNo,
          zone: "trash",
          normalCoreCount: 0,
        }),
      ],
    });

    const initial = executeEffect({
      chainId: "test:effect-interpreter:4275",
      state: makeTaxedState(),
      effect: optionalSourceDef.effects![0]!,
      sourceInstanceId: "optional-auto-resume-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "burst_activation",
    });
    expect(initial.pendingStepOptionalChoice).toMatchObject({
      canExecute: true,
    });

    const after = autoResumePendingOptionalSteps({
      state: initial,
      effect: optionalSourceDef.effects![0]!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      executeEffectFn: executeEffect,
    });

    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "optional-auto-resume-taxed-spirit"
      )?.zone
    ).toBe("field");
  });

  it("auto-resume keeps source_card override for optional source_card steps", () => {
    const hostDef = makeDef({
      cardNo: "ENGINE-OPTIONAL-AUTO-RESUME-SOURCE-CARD-HOST",
      name: "optional auto resume host",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              executionMode: "optional",
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
        },
      ],
    });
    const sourceCardDef = makeDef({
      cardNo: "ENGINE-OPTIONAL-AUTO-RESUME-SOURCE-CARD-REF",
      name: "optional auto resume source card reference",
    });
    const defs = [hostDef, sourceCardDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        makeInstance(hostDef, {
          instanceId: "optional-auto-resume-host",
          definitionId: hostDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
        makeInstance(sourceCardDef, {
          instanceId: "optional-auto-resume-source-card",
          definitionId: sourceCardDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const initial = executeEffect({
      chainId: "test:effect-interpreter:4351",
      state,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "optional-auto-resume-host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      sourceCardReferenceInstanceId: "optional-auto-resume-source-card",
    });
    expect(initial.pendingStepOptionalChoice).toMatchObject({
      continuation: {
        sourceCardReferenceInstanceId: "optional-auto-resume-source-card",
      },
    });

    const after = autoResumePendingOptionalSteps({
      state: initial,
      effect: hostDef.effects![0]!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      executeEffectFn: executeEffect,
    });

    const host = after.cardInstances.find(
      (card) => card.instanceId === "optional-auto-resume-host"
    );
    const sourceCard = after.cardInstances.find(
      (card) => card.instanceId === "optional-auto-resume-source-card"
    );
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(host?.zone).toBe("field");
    expect(host?.pendingLeaveKind).toBeNull();
    expect(sourceCard?.zone).toBe("field");
    expect(sourceCard?.pendingLeaveKind).toBe("destroy");
  });

  it("optional source_card canExecute uses the computed source_card override", () => {
    const hostDef = makeDef({
      cardNo: "ENGINE-OPTIONAL-SOURCE-CARD-CANEXECUTE-HOST",
      name: "optional source_card canExecute host",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              executionMode: "optional",
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
        },
      ],
    });
    const sourceCardDef = makeDef({
      cardNo: "ENGINE-OPTIONAL-SOURCE-CARD-CANEXECUTE-REF",
      name: "optional source_card canExecute reference",
    });
    const defs = [hostDef, sourceCardDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        makeInstance(hostDef, {
          instanceId: "optional-source-card-canexecute-host",
          definitionId: hostDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
          pendingLeaveKind: "destroy",
          pendingLeaveCause: "effect",
          pendingLeaveChainId: "prior-chain",
        }),
        makeInstance(sourceCardDef, {
          instanceId: "optional-source-card-canexecute-ref",
          definitionId: sourceCardDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const initial = executeEffect({
      chainId: "test:effect-interpreter:4437",
      state,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "optional-source-card-canexecute-host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      sourceCardReferenceInstanceId: "optional-source-card-canexecute-ref",
    });

    expect(initial.pendingStepOptionalChoice).toMatchObject({
      canExecute: true,
      continuation: {
        sourceCardReferenceInstanceId: "optional-source-card-canexecute-ref",
      },
    });
  });

  it("combined brave conditions use the host while source_card still refers to the brave", () => {
    const hostDef = makeDef({
      cardNo: "ENGINE-COMBINED-BRAVE-CONDITION-HOST",
      name: "combined brave condition host",
    });
    const braveDef = makeDef({
      cardNo: "ENGINE-COMBINED-BRAVE-CONDITION-BRAVE",
      name: "combined brave condition brave",
      printedCategory: "brave",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          condition: [{ kind: "min_level", value: 1 }],
          steps: [
            {
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
        },
      ],
    });
    const defs = [hostDef, braveDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        makeInstance(hostDef, {
          instanceId: "combined-condition-host",
          definitionId: hostDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
          attachedChildrenIds: ["combined-condition-brave"],
        }),
        makeInstance(braveDef, {
          instanceId: "combined-condition-brave",
          definitionId: braveDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
          attachedToInstanceId: "combined-condition-host",
        }),
      ],
    };

    const after = executeEffect({
      chainId: "test:effect-interpreter:4505",
      state,
      effect: braveDef.effects![0]!,
      sourceInstanceId: "combined-condition-host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectSourceInstanceId: "combined-condition-brave",
      effectSourceDefinitionId: braveDef.cardNo,
    });

    expect(
      after.log.some((entry) =>
        entry.startsWith("effect:condition-unmet:combined-condition-host")
      )
    ).toBe(false);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "combined-condition-host"
      )?.pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === "combined-condition-brave"
      )?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("blocked end_attack_step retry keeps implicit combined brave source_card override", () => {
    const hostDef = makeDef({
      cardNo: "ENGINE-END-ATTACK-RETRY-HOST",
      name: "end attack retry host",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "blocked-end",
              action: { kind: "end_attack_step" },
            },
            {
              id: "destroy-source-card",
              executionMode: "optional",
              stepCondition: {
                kind: "ref_blocked_by_opponent_effect",
                stepId: "blocked-end",
              },
              action: {
                kind: "destroy",
                target: { kind: "source_card" },
              },
            },
          ],
        },
      ],
    });
    const braveDef = makeDef({
      cardNo: "ENGINE-END-ATTACK-RETRY-BRAVE",
      name: "end attack retry brave",
      printedCategory: "brave",
    });
    const defs = [hostDef, braveDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        makeInstance(hostDef, {
          instanceId: "retry-host",
          definitionId: hostDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
          attachedChildrenIds: ["retry-brave"],
        }),
        makeInstance(braveDef, {
          instanceId: "retry-brave",
          definitionId: braveDef.cardNo,
          zone: "field",
          normalCoreCount: 1,
          attachedToInstanceId: "retry-host",
        }),
      ],
    };
    expect(
      isCombinedBraveEffectSource({
        state,
        sourceInstanceId: "retry-host",
        effectSourceInstanceId: "retry-brave",
        effectSourceDefinitionId: braveDef.cardNo,
        getCardDefinitionById: lookup,
      })
    ).toBe(true);

    const queued = executeEffect({
      chainId: "test:effect-interpreter:4601",
      state,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "retry-host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 0,
      effectSourceInstanceId: "retry-brave",
      effectSourceDefinitionId: braveDef.cardNo,
    });
    expect(
      queued.pendingAttackStepEndFinalizations[0]?.blockedByOpponentRetry
        ?.continuation.sourceCardReferenceInstanceId
    ).toBe("retry-brave");
    const pending = finalizePendingAttackStepEndFinalizations(
      {
        ...queued,
        activeContinuousEffects: [
          ...queued.activeContinuousEffects,
          {
            effectId: "retry-restrict-end-attack-step",
            sourceInstanceId: "retry-restrict-source",
            sourceDefinitionId: "ENGINE-END-ATTACK-RETRY-RESTRICT",
            actingPlayerId: "bob",
            targetInstanceId: "alice",
            modifierTag: "restrict_end_attack_step",
            duration: { scope: "turn" },
            createdAtTurn: 1,
            createdAtAttackId: null,
          },
        ],
      },
      lookup,
      ({ state: retryState, retry, stepContext }) =>
        evaluateAttackStepEndBlockedRetryCondition({
          state: retryState,
          retry,
          stepContext,
          getCardDefinitionById: lookup,
        })
    );

    expect(pending.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "retry-host",
      sourceDefinitionId: braveDef.cardNo,
      stepIndex: 1,
      stepLabel: "destroy-source-card",
      continuation: {
        effectSourceInstanceId: "retry-brave",
        effectSourceDefinitionId: braveDef.cardNo,
        sourceCardReferenceInstanceId: "retry-brave",
      },
    });
  });

  it("optional from_zone summon canExecute honors onBoardCoreSourceFilter for cost payment", () => {
    const filteredSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-FILTERED-SOURCE",
      name: "from-zone filtered summon source",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "filtered-summon",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "hand",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                costModifier: { fixedPayment: 2 },
                onBoardCoreSourceFilter: {
                  targetsGrandwalker: "only",
                  grandwalkerKind: "grandwalker",
                },
              },
            },
          ],
        },
      ],
    });
    const filteredTargetDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-FILTERED-TARGET",
      name: "filtered target",
      cost: 7,
    });
    const grandwalkerDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-GRANDWALKER",
      name: "filtered grandwalker",
      printedCategory: "nexus",
      symbolColors: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    });
    const normalNexusDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-NORMAL-NEXUS",
      name: "normal nexus",
      printedCategory: "nexus",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    });
    const defs = [
      filteredSourceDef,
      filteredTargetDef,
      grandwalkerDef,
      normalNexusDef,
    ];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const source = makeInstance(filteredSourceDef, {
      instanceId: "filtered-source",
      definitionId: filteredSourceDef.cardNo,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = makeInstance(filteredTargetDef, {
      instanceId: "filtered-target",
      definitionId: filteredTargetDef.cardNo,
      zone: "hand",
      normalCoreCount: 0,
    });
    const grandwalker = makeInstance(grandwalkerDef, {
      instanceId: "filtered-grandwalker-pay",
      definitionId: grandwalkerDef.cardNo,
      zone: "field",
      normalCoreCount: 2,
    });
    const normalNexus = makeInstance(normalNexusDef, {
      instanceId: "filtered-placement-source",
      definitionId: normalNexusDef.cardNo,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 0, handCount: 1 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, target, grandwalker, normalNexus],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:4748",
      state,
      effect: filteredSourceDef.effects![0]!,
      sourceInstanceId: "filtered-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "filtered-source",
      stepIndex: 0,
    });
    expect(
      result.cardInstances.find((card) => card.instanceId === "filtered-target")
        ?.zone
    ).toBe("hand");
  });

  it("optional from_zone summon keeps reserve available for enter-field cores when filtered on-board can pay", () => {
    const filteredSourceDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-FILTERED-RESERVE-SOURCE",
      name: "from-zone filtered summon source with reserve",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "filtered-summon",
              executionMode: "optional",
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "hand",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                costModifier: { fixedPayment: 2 },
                onBoardCoreSourceFilter: {
                  targetsGrandwalker: "only",
                  grandwalkerKind: "grandwalker",
                },
              },
            },
          ],
        },
      ],
    });
    const filteredTargetDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-FILTERED-RESERVE-TARGET",
      name: "filtered target with reserve",
      cost: 7,
    });
    const grandwalkerDef = makeDef({
      cardNo: "ENGINE-FROM-ZONE-FILTERED-RESERVE-GRANDWALKER",
      name: "filtered grandwalker with reserve",
      printedCategory: "nexus",
      symbolColors: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    });
    const defs = [filteredSourceDef, filteredTargetDef, grandwalkerDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const source = makeInstance(filteredSourceDef, {
      instanceId: "filtered-reserve-source",
      definitionId: filteredSourceDef.cardNo,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = makeInstance(filteredTargetDef, {
      instanceId: "filtered-reserve-target",
      definitionId: filteredTargetDef.cardNo,
      zone: "hand",
      normalCoreCount: 0,
    });
    const grandwalker = makeInstance(grandwalkerDef, {
      instanceId: "filtered-reserve-grandwalker-pay",
      definitionId: grandwalkerDef.cardNo,
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2, handCount: 1 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, target, grandwalker],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:4841",
      state,
      effect: filteredSourceDef.effects![0]!,
      sourceInstanceId: "filtered-reserve-source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "filtered-reserve-source",
      stepIndex: 0,
    });
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "filtered-reserve-target"
      )?.zone
    ).toBe("hand");
  });

  it("self summon accepts chosen filtered on-board payment and reserve placement", () => {
    const selfDef = makeDef({
      cardNo: "ENGINE-SELF-FILTERED-AUTO",
      name: "self filtered auto summon",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "summon",
                target: { kind: "self", zone: "hand" },
                costModifier: { fixedPayment: 2 },
                onBoardCoreSourceFilter: {
                  targetsGrandwalker: "only",
                  grandwalkerKind: "grandwalker",
                },
              },
            },
          ],
        },
      ],
    });
    const grandwalkerDef = makeDef({
      cardNo: "ENGINE-SELF-FILTERED-GRANDWALKER",
      name: "self filtered grandwalker",
      printedCategory: "nexus",
      symbolColors: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    });
    const defs = [selfDef, grandwalkerDef];
    const lookup = (id: string) => defs.find((def) => def.cardNo === id);
    const self = makeInstance(selfDef, {
      instanceId: "self-filtered-auto",
      definitionId: selfDef.cardNo,
      zone: "hand",
      normalCoreCount: 0,
    });
    const grandwalker = makeInstance(grandwalkerDef, {
      instanceId: "self-filtered-grandwalker-pay",
      definitionId: grandwalkerDef.cardNo,
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2, handCount: 1 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, grandwalker],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:4917",
      summonPaymentSources: [
        {
          kind: "card",
          instanceId: "self-filtered-grandwalker-pay",
          amount: 2,
        },
      ],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      state,
      effect: selfDef.effects![0]!,
      sourceInstanceId: "self-filtered-auto",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "self-filtered-auto"
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "self-filtered-grandwalker-pay"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(1);
  });
});

// ============================================================
// maxCores / minCores auto-select 配線（engine batch2-7）
// ============================================================
// convertTargetSpecToEffectTarget + collectTargetCardCandidates で maxCores/minCores を
// 自動選択経路 (count:"all" / preSelectedIds 無し) でも honor することの検証。
// 候補列挙(GUI)経路ではなく、AI・count:-1・テストが通る auto-select 経路を突く。

describe("maxCores / minCores auto-select (ENGINE-maxCores-autoselect)", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  // after_triggers connector で破壊対象を trash に flush し、観測可能にする。
  function runDestroyAll(
    filter: import("../src/dsl-types").CardFilter,
    targets: CardInstance[],
    source: CardInstance
  ): GameState {
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: "all",
              filter,
            },
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };
    return executeEffect({
      chainId: "test:effect-interpreter:4981",
      state: makeState([source, ...targets]),
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
  }

  it("maxCores:3 + count:'all' — 3コア以下のみ破壊、4コアは残る", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({ cardNo: "TGT-001", printedCategory: "spirit" });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const lowCore = makeInstance(targetDef, {
      instanceId: "tgt-low",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 3,
    });
    const highCore = makeInstance(targetDef, {
      instanceId: "tgt-high",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 4,
    });

    const result = runDestroyAll({ maxCores: 3 }, [lowCore, highCore], source);

    // 3コアは trash へ flush
    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-low")!.zone
    ).toBe("trash");
    // 4コアは field に残る (maxCores を auto-select が無視していれば trash に行ってしまう)
    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-high")!.zone
    ).toBe("field");
  });

  it("minCores:3 + count:'all' — 3コア以上のみ破壊、2コアは残る", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({ cardNo: "TGT-001", printedCategory: "spirit" });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const fewCore = makeInstance(targetDef, {
      instanceId: "tgt-few",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 2,
    });
    const manyCore = makeInstance(targetDef, {
      instanceId: "tgt-many",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 3,
    });

    const result = runDestroyAll({ minCores: 3 }, [fewCore, manyCore], source);

    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-many")!.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-few")!.zone
    ).toBe("field");
  });

  it("coreCount フィルタ無しの auto-select は不変 — 全件破壊", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({ cardNo: "TGT-001", printedCategory: "spirit" });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const a = makeInstance(targetDef, {
      instanceId: "tgt-a",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 1,
    });
    const b = makeInstance(targetDef, {
      instanceId: "tgt-b",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      normalCoreCount: 9,
    });

    // filter にコア条件なし → コア数に関係なく両方破壊
    const result = runDestroyAll({ category: ["spirit"] }, [a, b], source);

    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-a")!.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((c) => c.instanceId === "tgt-b")!.zone
    ).toBe("trash");
  });
});

// ============================================================
// suppress_effect: effectFilter 任意化（カード全効果の発揮抑止）
// ============================================================

describe("suppress_effect blanket suppression (effectFilter optional)", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  function setupSuppressorAndTarget(): {
    state: GameState;
    sourceId: string;
    targetId: string;
  } {
    const sourceDef = makeDef({ cardNo: "SUPP-SRC" });
    const targetDef = makeDef({ cardNo: "SUPP-TGT" });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, { instanceId: "supp-src" });
    const target = makeInstance(targetDef, {
      instanceId: "supp-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    return {
      state: makeState([source, target]),
      sourceId: "supp-src",
      targetId: "supp-tgt",
    };
  }

  it("executor registers a blanket effect_suppression CE (no effectFilter) and it suppresses effects of every timing", () => {
    const { state, sourceId, targetId } = setupSuppressorAndTarget();

    // 実プロダクション executor: effectFilter 省略 (blanket) の suppress_effect。
    // 「相手のスピリット1体の効果をすべて発揮させない」相当。
    const effect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            duration: { scope: "turn" },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:5144",
      state,
      effect,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // CE が effectFilter 無し (blanket) で登録される。
    const ces = result.activeContinuousEffects.filter(
      (c) =>
        c.modifierTag === "effect_suppression" &&
        c.targetInstanceId === targetId
    );
    expect(ces).toHaveLength(1);
    expect(ces[0].metadata?.effectFilter).toBeUndefined();

    // 抑止対象カードの「召喚時」効果も「アタック時」効果も、それぞれの
    // 解決時 reevaluation (effect_suppression) で発揮させない (passed=false)。
    const summonRegistration = {
      reevaluationPoints: [
        {
          timing: "after_sba" as const,
          checks: ["effect_suppression" as const],
          failurePolicy: "abort_remaining" as const,
        },
      ],
    };
    for (const descriptor of [
      { timingKind: "card_event", triggerPhrases: ["召喚時"] },
      { timingKind: "card_event", triggerPhrases: ["アタック時"] },
    ]) {
      const reeval = runReevaluationAtTiming({
        state: result,
        registration: summonRegistration,
        timing: "after_sba",
        sourceInstanceId: targetId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: descriptor,
      });
      expect(reeval.passed).toBe(false);
      expect(reeval.failedChecks).toEqual(["effect_suppression"]);
      expect(reeval.failurePolicy).toBe("abort_remaining");
    }
  });

  it("filtered suppress_effect (with effectFilter) suppresses only the matching effect end-to-end", () => {
    const { state, sourceId, targetId } = setupSuppressorAndTarget();

    const effectFilter: EffectTargetFilter = { triggerPhrase: "アタック時" };
    const effect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            effectFilter,
            duration: { scope: "turn" },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:effect-interpreter:5213",
      state,
      effect,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const ce = result.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "effect_suppression" &&
        c.targetInstanceId === targetId
    );
    expect(ce?.metadata?.effectFilter).toEqual(effectFilter);

    const registration = {
      reevaluationPoints: [
        {
          timing: "after_sba" as const,
          checks: ["effect_suppression" as const],
        },
      ],
    };

    // 「アタック時」効果 → 抑止される
    expect(
      runReevaluationAtTiming({
        state: result,
        registration,
        timing: "after_sba",
        sourceInstanceId: targetId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["アタック時"],
        },
      }).passed
    ).toBe(false);

    // 「召喚時」効果 → 抑止されない (filter 不一致)
    expect(
      runReevaluationAtTiming({
        state: result,
        registration,
        timing: "after_sba",
        sourceInstanceId: targetId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["召喚時"],
        },
      }).passed
    ).toBe(true);
  });

  it("blanket suppression lifts once the continuous effect expires", () => {
    const { state, sourceId, targetId } = setupSuppressorAndTarget();
    const effect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const suppressed = executeEffect({
      chainId: "test:effect-interpreter:5287",
      state,
      effect,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // CE が活きている間は抑止。
    expect(
      executeReevaluationCheck({
        state: suppressed,
        checkKind: "effect_suppression",
        sourceInstanceId: targetId,
        targetInstanceIds: [],
      })
    ).toBe(false);

    // CE が満了/除去されたら抑止は解ける。
    const lifted: GameState = { ...suppressed, activeContinuousEffects: [] };
    expect(
      executeReevaluationCheck({
        state: lifted,
        checkKind: "effect_suppression",
        sourceInstanceId: targetId,
        targetInstanceIds: [],
      })
    ).toBe(true);
  });
});

// ============================================================
// suppress_effect: 動的フィルタ continuous suppress（ENGINE-dynamic-filter-suppress）
//   BSTH04-転醒R01(B) 金龍 [5,6]: 「相手のフィールドの6色の効果は発揮されない」
//   target:{kind:"filter",count:"all"} → instanceId に snapshot せず単一グローバル CE。
//   CE 登録後に場へ出たカードも消費側で動的に matchesCardFilter で再評価して抑止する。
// ============================================================

describe("suppress_effect dynamic filter-based continuous suppression", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  // 6色（赤/紫/緑/白/黄/青）すべてを併せ持つカードのみ抑止（black は7色目で対象外）。
  const SIX_COLORS = [
    "red",
    "purple",
    "green",
    "white",
    "yellow",
    "blue",
  ] as const;

  function registerSixColorSuppressor(
    state: GameState,
    sourceId: string
  ): GameState {
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { colors: [...SIX_COLORS], colorsLogic: "and" },
              count: "all",
            },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    };
    return executeEffect({
      chainId: "test:effect-interpreter:5361",
      state,
      effect,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
  }

  it("登録は単一のグローバル CE（targetInstanceId 未設定 + suppressTargetFilter）として行われる", () => {
    const sourceDef = makeDef({ cardNo: "KINRYU-SUPP-SRC" });
    registerDef(sourceDef);
    const source = makeInstance(sourceDef, { instanceId: "kinryu-src" });
    const result = registerSixColorSuppressor(
      makeState([source]),
      "kinryu-src"
    );

    const ces = result.activeContinuousEffects.filter(
      (c) => c.modifierTag === "effect_suppression"
    );
    expect(ces).toHaveLength(1);
    // 動的フィルタ CE は instanceId へ snapshot しない。
    expect(ces[0].targetInstanceId).toBeUndefined();
    expect(ces[0].metadata?.suppressTargetPlayer).toBe("opponent");
    expect(
      (ces[0].metadata?.suppressTargetFilter as { colors?: string[] })?.colors
    ).toEqual([...SIX_COLORS]);
  });

  it("CE 登録後に場へ出た相手の6色カードを動的に抑止する（getCardDefinitionById 供給時）", () => {
    const sourceDef = makeDef({ cardNo: "KINRYU-SUPP-SRC" });
    // 6色カード（後から場へ出る側）。
    const sixColorDef = makeDef({
      cardNo: "SIX-COLOR-TGT",
      colors: [...SIX_COLORS],
    });
    registerDef(sourceDef);
    registerDef(sixColorDef);

    const source = makeInstance(sourceDef, { instanceId: "kinryu-src" });
    // まず suppressor だけが場にいる状態で CE を登録（6色カードは未登場）。
    const afterSuppress = registerSixColorSuppressor(
      makeState([source]),
      "kinryu-src"
    );

    // CE 登録後に相手の6色カードが場へ出る。
    const sixColor = makeInstance(sixColorDef, {
      instanceId: "six-color-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const withTarget: GameState = {
      ...afterSuppress,
      cardInstances: [...afterSuppress.cardInstances, sixColor],
    };

    const registration = {
      reevaluationPoints: [
        {
          timing: "after_sba" as const,
          checks: ["effect_suppression" as const],
          failurePolicy: "abort_remaining" as const,
        },
      ],
    };

    // getCardDefinitionById 供給 → 動的フィルタ CE を評価して抑止（passed=false）。
    const reeval = runReevaluationAtTiming({
      state: withTarget,
      registration,
      timing: "after_sba",
      sourceInstanceId: "six-color-tgt",
      targetInstanceIds: [],
      suppressionEffectDescriptor: {
        timingKind: "card_event",
        triggerPhrases: ["アタック時"],
      },
      getCardDefinitionById: getDef,
    });
    expect(reeval.passed).toBe(false);
    expect(reeval.failedChecks).toEqual(["effect_suppression"]);
  });

  it("6色に満たない相手カード・自分の6色カードは抑止しない", () => {
    const sourceDef = makeDef({ cardNo: "KINRYU-SUPP-SRC" });
    // 5色（青を欠く）の相手カード = colorsLogic:"and" 不一致。
    const fiveColorDef = makeDef({
      cardNo: "FIVE-COLOR-TGT",
      colors: ["red", "purple", "green", "white", "yellow"],
    });
    // 6色だが自分のカード（player:"opponent" 不一致）。
    const ownSixColorDef = makeDef({
      cardNo: "OWN-SIX-COLOR",
      colors: [...SIX_COLORS],
    });
    registerDef(sourceDef);
    registerDef(fiveColorDef);
    registerDef(ownSixColorDef);

    const source = makeInstance(sourceDef, { instanceId: "kinryu-src" });
    const fiveColor = makeInstance(fiveColorDef, {
      instanceId: "five-color-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const ownSix = makeInstance(ownSixColorDef, {
      instanceId: "own-six",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
    });
    const afterSuppress = registerSixColorSuppressor(
      makeState([source, fiveColor, ownSix]),
      "kinryu-src"
    );

    const registration = {
      reevaluationPoints: [
        {
          timing: "after_sba" as const,
          checks: ["effect_suppression" as const],
        },
      ],
    };

    for (const sourceInstanceId of ["five-color-tgt", "own-six"]) {
      const reeval = runReevaluationAtTiming({
        state: afterSuppress,
        registration,
        timing: "after_sba",
        sourceInstanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["アタック時"],
        },
        getCardDefinitionById: getDef,
      });
      expect(reeval.passed).toBe(true);
    }
  });

  it("getCardDefinitionById 未供給時は動的フィルタ CE を評価しない（後方互換）", () => {
    const sourceDef = makeDef({ cardNo: "KINRYU-SUPP-SRC" });
    const sixColorDef = makeDef({
      cardNo: "SIX-COLOR-TGT",
      colors: [...SIX_COLORS],
    });
    registerDef(sourceDef);
    registerDef(sixColorDef);

    const source = makeInstance(sourceDef, { instanceId: "kinryu-src" });
    const sixColor = makeInstance(sixColorDef, {
      instanceId: "six-color-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const afterSuppress = registerSixColorSuppressor(
      makeState([source, sixColor]),
      "kinryu-src"
    );

    // getCardDefinitionById 省略 → 動的フィルタは評価されず抑止されない。
    expect(
      executeReevaluationCheck({
        state: afterSuppress,
        checkKind: "effect_suppression",
        sourceInstanceId: "six-color-tgt",
        targetInstanceIds: [],
      })
    ).toBe(true);
  });
});

// ============================================================
// suppress_effect: filtered (effectFilter 付き) — 本物の解決パイプライン経由
// ============================================================

describe("suppress_effect filtered suppression — real resolution path", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("filtered suppress_effect が finalizeEffectResolution 経由で一致タイミング効果のみ抑止する", () => {
    // 抑止される側の実カード: 「アタック時」効果 + 「召喚時」効果を持つ。
    const attackEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      triggerPhrases: ["アタック時"],
      steps: [{ action: { kind: "draw", count: 1 } }],
    };
    const summonEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      triggerPhrases: ["召喚時"],
      steps: [{ action: { kind: "draw", count: 1 } }],
    };
    const targetDef = makeDef({
      cardNo: "SUPP-TGT-EFFECTS",
      effects: [attackEffect, summonEffect],
    });
    const sourceDef = makeDef({ cardNo: "SUPP-SRC" });
    registerDef(sourceDef);
    registerDef(targetDef);

    const source = makeInstance(sourceDef, { instanceId: "supp-src" });
    const target = makeInstance(targetDef, {
      instanceId: "supp-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
    });
    const baseState = makeState([source, target]);

    // 実カードの triggered registration が登録時に効果から記述子を導出している。
    const triggeredRegs = generateTriggeredEffectRegistrations(targetDef);
    const summonReg = triggeredRegs.find((r) =>
      r.suppressionEffectDescriptor?.triggerPhrases?.includes("召喚時")
    );
    expect(summonReg?.suppressionEffectDescriptor).toEqual(
      deriveSuppressionEffectDescriptor(summonEffect, {
        sourceDefinitionId: targetDef.cardNo,
        sourceKind: "spirit",
        effectIndex: 1,
      })
    );

    // filtered suppress_effect CE（「アタック時」効果のみ発揮させない）を target に付与。
    const suppressEffect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "suppress_effect",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            effectFilter: { triggerPhrase: "アタック時" },
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const stateWithSuppressor = executeEffect({
      chainId: "test:effect-interpreter:5605",
      state: baseState,
      effect: suppressEffect,
      sourceInstanceId: "supp-src",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(
      stateWithSuppressor.activeContinuousEffects.find(
        (c) =>
          c.modifierTag === "effect_suppression" &&
          c.targetInstanceId === "supp-tgt"
      )?.metadata?.effectFilter
    ).toEqual({ triggerPhrase: "アタック時" });

    // 解決時の after_sba reevaluation ポイント。
    // 生成器も同じ shape を付与するが、このテストは pipeline を直接呼ぶため明示する。
    const reevaluationPoints = [
      {
        timing: "after_sba" as const,
        checks: ["effect_suppression" as const],
        failurePolicy: "abort_remaining" as const,
      },
    ];

    // 本物の解決パイプライン: buildReevaluationConfig → finalizeEffectResolution
    // → runReevaluationAtTiming → executeReevaluationCheck → matchesEffectTargetFilter。
    const resolveThroughPipeline = (effect: Effect): GameState => {
      const descriptor = deriveSuppressionEffectDescriptor(effect);
      const config = buildReevaluationConfig(
        { reevaluationPoints, suppressionEffectDescriptor: descriptor },
        "supp-tgt",
        []
      )!;
      // buildReevaluationConfig が記述子を config へ伝搬している（本タスクの配線）。
      expect(config.suppressionEffectDescriptor).toEqual(descriptor);
      return finalizeEffectResolution({
        state: stateWithSuppressor,
        beforeState: stateWithSuppressor,
        chainId: "supp-test-chain",
        endLogs: [],
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: undefined,
        causedBySourceInstanceId: "supp-tgt",
        reevaluation: config,
      });
    };

    const wasSuppressed = (state: GameState): boolean =>
      state.log.some((l) =>
        l.startsWith("reevaluation:after_sba:failed:effect_suppression")
      );

    // 「アタック時」効果 → effectFilter 一致 → 発揮させない（reevaluation 失敗）。
    expect(wasSuppressed(resolveThroughPipeline(attackEffect))).toBe(true);
    // 「召喚時」効果 → effectFilter 不一致 → そのまま発揮（reevaluation 通過）。
    expect(wasSuppressed(resolveThroughPipeline(summonEffect))).toBe(false);
  });
});
