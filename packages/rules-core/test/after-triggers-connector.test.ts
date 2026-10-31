import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";
import { applyLegalAction, getLegalActions } from "../src";

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
    ownerPlayerId: overrides.ownerPlayerId ?? "alice",
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
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}

function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

// ============================================================
// after_triggers コネクタ
// ============================================================

describe("after_triggers コネクタ（P3-15 問題3）", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("destroy → after_triggers の境界で対象が field から trash に flush される", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({
      cardNo: "TGT-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
    });
    const state = makeState([source, target]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:after-triggers-connector:109",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // after_triggers で flushPendingLeaves が呼ばれ、destroy 対象が trash に移動している
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "tgt-1"
    )!;
    expect(targetAfter.zone).toBe("trash");
    expect(
      result.pendingLeaveEntities.some((p) => p.instanceId === "tgt-1")
    ).toBe(false);

    // after_triggers のログが出力される
    expect(
      result.log.some((l) => l.startsWith("effect:after_triggers:flushed:"))
    ).toBe(true);

    // 次 step の count_increase も実行される（sequential と同じく後続ステップに進む）
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);
  });

  it("sequential では同じ構造でも対象が field に残ったまま次 step が実行される", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({
      cardNo: "TGT-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
    });
    const state = makeState([source, target]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "sequential",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:after-triggers-connector:176",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // sequential では flush されないため、destroy 対象は pendingLeave に登録されたまま field に残る
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "tgt-1"
    )!;
    expect(targetAfter.zone).toBe("field");
    expect(
      result.pendingLeaveEntities.some((p) => p.instanceId === "tgt-1")
    ).toBe(true);

    // after_triggers のログは出ない
    expect(
      result.log.some((l) => l.startsWith("effect:after_triggers:flushed:"))
    ).toBe(false);

    // count_increase は実行される
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);
  });

  it("after_triggers で leave_field 系誘発効果が pendingTriggeredEffects にキュー化される", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    // 対象カードに「離場時」トリガー効果を持たせる
    const targetDef = makeDef({
      cardNo: "TGT-LEAVE-001",
      colors: ["blue"],
      symbolColors: ["blue"],
      effects: [
        {
          timing: { kind: "card_event", event: "leave_field" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 3 } },
          ],
        },
      ],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
    });
    const state = makeState([source, target]);

    const pendingBefore = state.pendingTriggeredEffects.length;

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:after-triggers-connector:254",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // after_triggers により leave_field / card:removed-from-field の誘発効果がキュー化される
    // （collectAndQueueTriggerReactions + flushPendingLeaves の連携による）
    expect(result.pendingTriggeredEffects.length).toBeGreaterThan(
      pendingBefore
    );
  });

  it("previousStepPreState が null の初回 step では after_triggers は無効（sequential と同じ）", () => {
    // connector は i > startIndex のときのみ評価されるため、最初の step に after_triggers を付けても無視される。
    // 実質「2 番目以降の step が after_triggers のとき、直前に実行された step の pre-state を使う」動作を確認。
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    registerDef(sourceDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const state = makeState([source]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        // 最初の step の connector は無視される
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 2 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:after-triggers-connector:291",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // count_increase が実行され、after_triggers のログは出ない
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(2);
    expect(
      result.log.some((l) => l.startsWith("effect:after_triggers:flushed:"))
    ).toBe(false);
  });

  it("after_triggers 前の step が condition でスキップされた場合、次の実行済み step の pre-state を使う", () => {
    // step 1: false condition でスキップ
    // step 2: destroy
    // step 3: after_triggers + count_increase
    // → step 3 の境界では step 2 の pre-state を基準に誘発を集める
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({
      cardNo: "TGT-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
    });
    const state = makeState([source, target]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        // 1: stepCondition で skip（存在しない stepId の ref_succeeded は false）
        {
          id: "skipped-step",
          stepCondition: { kind: "ref_succeeded", stepId: "nonexistent-step" },
          action: { kind: "count_increase", player: "self", amount: 10 },
        },
        // 2: 実行される破壊
        {
          id: "destroy-step",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        // 3: after_triggers
        {
          id: "bonus-step",
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:after-triggers-connector:361",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // 破壊対象は trash に flush されている（step 2 の pre-state を基準とする動作）
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "tgt-1"
    )!;
    expect(targetAfter.zone).toBe("trash");
    // スキップされた step 1 は実行されない
    // step 3 の count_increase は実行される
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);
    expect(
      result.log.some((l) => l.startsWith("effect:after_triggers:flushed:"))
    ).toBe(true);
  });

  it("after_triggers は skipped step を挟んでも leaveKind を直近実行 step の result に注釈する", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    const targetDef = makeDef({
      cardNo: "TGT-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
    });
    const state = makeState([source, target]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "destroy-step",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          id: "skipped-step",
          stepCondition: { kind: "ref_succeeded", stepId: "missing-step" },
          action: { kind: "count_increase", player: "self", amount: 10 },
        },
        {
          id: "after-step",
          connector: "after_triggers",
          stepCondition: {
            kind: "ref_left_field",
            stepId: "destroy-step",
            leaveKind: "destroy",
          },
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:after-triggers-connector:435",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "tgt-1"
    )!;
    expect(targetAfter.zone).toBe("trash");
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it("after_triggers は pre-state log snapshot だけを delta として扱い、古い field_place log で effect summon を place 扱いにしない", () => {
    const sourceDef = makeDef({ cardNo: "SRC-SUMMON-001" });
    const summonedDef = makeDef({
      cardNo: "TGT-SUMMON-001",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "summon",
            cause: ["self_effect"],
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    });
    registerDef(sourceDef);
    registerDef(summonedDef);

    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const summoned = makeInstance(summonedDef, {
      instanceId: "summoned-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      zoneRoleName: null,
      normalCoreCount: 0,
    });
    const baseState = makeState([source, summoned]);
    const state: GameState = {
      ...baseState,
      log: [
        ...baseState.log,
        "effect:field_place:search_deck:alice:summoned-1",
      ],
      players: baseState.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 1 }
          : player
      ),
    };

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              count: 1,
              filter: { category: ["spirit"] },
            },
            costModifier: "free",
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };
    // pendingMultiPlacement 解決後の continuation は definition の effectIndex から再開する。
    const sourceDefWithEffect = { ...sourceDef, effects: [effect] };
    registerDef(sourceDefWithEffect);

    const triggeredLookup = buildTriggeredEffectLookup([
      sourceDefWithEffect,
      summonedDef,
    ]);
    let result = executeEffect({
      chainId: "test:after-triggers-connector:525",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    const placementAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: placementAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "summoned-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;

    const pending = result.pendingTriggeredEffects.find(
      (entry) => entry.relatedInstanceId === "summoned-1"
    );
    expect(pending).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "summoned-1",
    });
  });

  it("同一親 chain 内の複数 after_triggers は connector ごとに別 chainId を使う", () => {
    const sourceDef = makeDef({ cardNo: "SRC-001" });
    registerDef(sourceDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
    });
    const state = makeState([source]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
        { action: { kind: "count_increase", player: "self", amount: 1 } },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      chainId: "parent-chain",
      getCardDefinitionById: getDef,
    });

    const flushLogs = result.log.filter((line) =>
      line.startsWith("effect:after_triggers:flushed:")
    );
    expect(flushLogs).toEqual([
      "effect:after_triggers:flushed:parent-chain:after_triggers:1",
      "effect:after_triggers:flushed:parent-chain:after_triggers:3",
    ]);
  });
});
