/**
 * BSTH01-X08「神槍『スピア・ザ・グングニル』」
 *
 * 【合体中】『このスピリットのアタック時』
 * 相手のスピリット/アルティメットを破壊したとき、ターンに1回、
 * 相手のライフのコア2個までをボイドに置く。
 *
 * 設計 (10_rules/05「『アタック時』の2類型と上位フィルター」参照):
 *   - アタック中スコープの「即時効果」。発火点は破壊の観測 (game_event:destroy)。
 *   - 『アタック時』は上位フィルター (発揮枠) = in_battle:attacking でゲート。
 *   - 破壊の帰属は自分起因のみ: バトル討ち取り (battle) / 自分の破壊効果 (opponent_effect)。
 *     相手による自壊 (self_effect) は「自分が破壊した」に当たらず除外
 *     (deriveTriggerEventCauseFromPendingLeave は離脱カード=相手自身のコントローラ基準で
 *     cause を導出するため、自分起因は causePlayerId(=自分)≠離脱カードのコントローラ(相手)=
 *     opponent_effect 側になる。ENGINE-cause-polarity-self-effect-opponent-effect-audit）。
 *   - 誘発収集は battle reset 前 (in_battle=true) に走るため gate が成立する。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  matchesTriggerEvent,
  getAvailableTriggeredEffectSourceChoices,
  collectAndQueueTriggerReactions,
  type TriggerEventMatcher,
} from "../src/effect/trigger-system";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { queuePendingLeave } from "../src/state-based-actions";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
  StructuredTriggerEvent,
  TriggerEventCause,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

// X08 の実効果と同形 (game_event:destroy + in_battle gate + 自分起因 cause)。
// cause=[battle, opponent_effect]: deriveTriggerEventCauseFromPendingLeave は離脱カード
// (=相手, player:"opponent") 自身のコントローラ基準で cause を導出するため、「自分が破壊した」は
// causePlayerId(=自分) が離脱カードのコントローラ(相手)と異なる opponent_effect 側になる
// (ENGINE-cause-polarity-self-effect-opponent-effect-audit)。
const x08Effect: Effect = {
  timing: {
    kind: "game_event",
    player: "opponent",
    event: "destroy",
    triggerFilter: { category: ["spirit", "ultimate"] },
    cause: ["battle", "opponent_effect"],
  },
  condition: [{ kind: "in_battle", state: "attacking" }],
  applicability: { combined: true },
  executionMode: "optional",
  usageLimit: { kind: "per_instance", duration: "turn" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "life", player: "opponent" },
        to: { kind: "void", player: "opponent" },
        amount: 2,
      },
    },
  ],
};

function braveDef(cardNo: string, effects: Effect[]): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  } as CardDefinition;
}

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

// ════════════════════════════════════════════════════════════
// 1. 盤面変化: ライフ→ボイド core_move (新設ブランチ)
// ════════════════════════════════════════════════════════════

describe("X08 ライフ→ボイド core_move の盤面変化", () => {
  function lifeToVoidEffect(): Effect {
    return {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "void", player: "opponent" },
            amount: 2,
          },
        },
      ],
    };
  }

  it("相手ライフのコア2個がボイドへ移動する", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { lifeNormalCoreCount: 5, voidNormalCoreCount: 0 }],
    });
    const result = executeEffect({
      chainId: "test:bsth01-x08-spear-gungnir:136",
      state,
      effect: lifeToVoidEffect(),
      sourceInstanceId: "s1",
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(3);
    expect(bob.voidNormalCoreCount).toBe(2);
    expect(
      result.log.some((l) => l.includes(`core_move:life:${BOB}->void:${BOB}:2`))
    ).toBe(true);
  });

  it("ライフが2未満なら利用可能な分だけ移動する (capで「2個まで」)", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{}, { lifeNormalCoreCount: 1, voidNormalCoreCount: 0 }],
    });
    const result = executeEffect({
      chainId: "test:bsth01-x08-spear-gungnir:156",
      state,
      effect: lifeToVoidEffect(),
      sourceInstanceId: "s1",
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(0);
    expect(bob.voidNormalCoreCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 2. cause 配列マッチング (自分起因 battle / opponent_effect のみ受ける)
// ════════════════════════════════════════════════════════════

describe("X08 cause 配列マッチング (matchesTriggerEvent)", () => {
  const matcher: TriggerEventMatcher = {
    family: "leave_field",
    causeKind: "destroy",
    cause: ["battle", "opponent_effect"],
  };

  function destroyEvent(cause: TriggerEventCause): StructuredTriggerEvent {
    return {
      family: "leave_field",
      causeKind: "destroy",
      cause,
      validationMode: "snapshot_only",
    };
  }

  it("battle (討ち取り) でマッチ", () => {
    expect(matchesTriggerEvent(matcher, destroyEvent("battle"))).toBe(true);
  });

  it("opponent_effect (自分の破壊効果。離脱カード=相手のコントローラと causePlayerId=自分 が異なる) でマッチ", () => {
    expect(matchesTriggerEvent(matcher, destroyEvent("opponent_effect"))).toBe(
      true
    );
  });

  it("self_effect (相手による自壊。離脱カード=相手自身が causePlayerId) はマッチしない", () => {
    expect(matchesTriggerEvent(matcher, destroyEvent("self_effect"))).toBe(
      false
    );
  });

  it("state_based (コア不足消滅は破壊ではない) はマッチしない", () => {
    expect(matchesTriggerEvent(matcher, destroyEvent("state_based"))).toBe(
      false
    );
  });

  it("cause 未設定イベントはマッチしない (fail-closed)", () => {
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "destroy",
        validationMode: "snapshot_only",
      })
    ).toBe(false);
  });

  it("後方互換: 単一 cause マッチャーは従来どおり 1 値のみ受ける", () => {
    const single: TriggerEventMatcher = {
      family: "leave_field",
      causeKind: "destroy",
      cause: "battle",
    };
    expect(matchesTriggerEvent(single, destroyEvent("battle"))).toBe(true);
    expect(matchesTriggerEvent(single, destroyEvent("self_effect"))).toBe(
      false
    );
  });
});

// ════════════════════════════════════════════════════════════
// 3. 発揮枠ゲート統合 (in_battle:attacking + combined + cause)
// ════════════════════════════════════════════════════════════

describe("X08 発揮枠ゲート (getAvailableTriggeredEffectSourceChoices)", () => {
  const X08 = "BSTH01-X08-TEST";
  const HOST = "TEST-HOST";
  const VICTIM = "TEST-VICTIM";

  function setup(opts: { attacking: boolean; cause: TriggerEventCause }): {
    state: GameState;
    pending: PendingTriggeredEffect;
    lookup: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
    x08Id: string;
  } {
    const x08Def = braveDef(X08, [x08Effect]);
    const hostDef = spiritDef(HOST);
    const victimDef = spiritDef(VICTIM);

    // X08 ブレイヴ: ホストに合体 (attachedToInstanceId) かつアタック中ユニットのメンバー。
    const x08Brave = createCardInstance(x08Def, {
      instanceId: "x08-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-1",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["x08-1"],
    });
    // 破壊された相手スピリット (トラッシュに移動済みでも cardInstances には残る)。
    const victim = createCardInstance(victimDef, {
      instanceId: "victim-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "trash",
      normalCoreCount: 0,
    });

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x08Brave, host, victim],
    });

    const state: GameState = {
      ...base,
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      battleEntities: opts.attacking
        ? [
            {
              entityId: "be-1",
              resolvedBp: 3000,
              attackState: "attacking",
              resolvedSymbols: ["red"],
              memberInstanceIds: ["host-1", "x08-1"],
            },
          ]
        : [],
    };

    const pending: PendingTriggeredEffect = {
      pendingId: "pte:x08",
      actingPlayerId: ALICE,
      eventKind: "destroy",
      source: "battle_resolution",
      chainId: "test:bsth01-x08-spear-gungnir:303",
      attackId: "atk-1",
      relatedPlayerId: BOB,
      relatedInstanceId: "victim-1",
      amount: null,
      step: "attack",
      window: "declare_attack",
      resolvedSourceInstanceIds: [],
      event: {
        family: "leave_field",
        causeKind: "destroy",
        cause: opts.cause,
        validationMode: "snapshot_only",
      },
    } as PendingTriggeredEffect;

    const defs = new Map<string, CardDefinition>([
      [X08, x08Def],
      [HOST, hostDef],
      [VICTIM, victimDef],
    ]);

    return {
      state,
      pending,
      lookup: buildTriggeredEffectLookup([x08Def, hostDef, victimDef]),
      getDef: (id) => defs.get(id),
      x08Id: "x08-1",
    };
  }

  function x08IsCandidate(opts: {
    attacking: boolean;
    cause: TriggerEventCause;
  }): boolean {
    const ctx = setup(opts);
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: ctx.pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    return choices.some(
      (c) => (c.sourceEffectInstanceId ?? c.sourceCard.instanceId) === ctx.x08Id
    );
  }

  it("アタック中 + バトル討ち取りで X08 が候補になる", () => {
    expect(x08IsCandidate({ attacking: true, cause: "battle" })).toBe(true);
  });

  it("アタック中 + 自分の破壊効果 (opponent_effect) で X08 が候補になる", () => {
    expect(x08IsCandidate({ attacking: true, cause: "opponent_effect" })).toBe(
      true
    );
  });

  it("非アタック中 (発揮枠が閉じている) では候補にならない", () => {
    expect(x08IsCandidate({ attacking: false, cause: "battle" })).toBe(false);
  });

  it("相手による自壊 (self_effect) では候補にならない", () => {
    expect(x08IsCandidate({ attacking: true, cause: "self_effect" })).toBe(
      false
    );
  });
});

// ════════════════════════════════════════════════════════════
// 4. end-to-end: 実カードデータ + queuePendingLeave 経由の実導出 cause
//    (matchesTriggerEvent への手組みイベント注入ではなく、
//    deriveTriggerEventCauseFromPendingLeave が実際に正しい極性を出すか検証する。
//    ENGINE-cause-polarity-self-effect-opponent-effect-audit の
//    「end-to-end 検証をしていない」指摘への再発防止テスト)
// ════════════════════════════════════════════════════════════

describe("X08 end-to-end: 自分の効果(バトル外)で相手を破壊したとき実際に発火する", () => {
  const X08_REAL = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X08")!;
  const HOST_REAL = ALL_CARDS.find((c) => c.cardNo === "BSTH01-C01")!;
  const VICTIM_REAL = ALL_CARDS.find((c) => c.cardNo === "BSTH01-C02")!;
  const defs = new Map<string, CardDefinition>([
    [X08_REAL.cardNo, X08_REAL],
    [HOST_REAL.cardNo, HOST_REAL],
    [VICTIM_REAL.cardNo, VICTIM_REAL],
  ]);
  const getDefReal = (id: string) => defs.get(id);
  const lookupReal = buildTriggeredEffectLookup([
    X08_REAL,
    HOST_REAL,
    VICTIM_REAL,
  ]);
  const burstLookupReal = buildBurstEffectLookup([
    X08_REAL,
    HOST_REAL,
    VICTIM_REAL,
  ]);

  function buildBoard() {
    const x08Brave = createCardInstance(X08_REAL, {
      instanceId: "x08-e2e",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-e2e",
    });
    const host = createCardInstance(HOST_REAL, {
      instanceId: "host-e2e",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["x08-e2e"],
    });
    const victim = createCardInstance(VICTIM_REAL, {
      instanceId: "victim-e2e",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x08Brave, host, victim],
    });
    const state: GameState = {
      ...base,
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      battleEntities: [
        {
          entityId: "be-e2e",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["host-e2e", "x08-e2e"],
        },
      ],
    };
    return state;
  }

  it("自分(ALICE)の破壊効果(非バトル)で相手(BOB)のスピリットが離脱するとき、X08 が応答候補になる", () => {
    const before = buildBoard();
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "victim-e2e",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:x08-e2e-destroy",
      causePlayerId: ALICE,
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:bsth01-x08-spear-gungnir:461",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDefReal,
      getRegisteredTriggeredEffectActions: lookupReal,
      getRegisteredBurstActions: burstLookupReal,
    });
    const destroyPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === "victim-e2e"
    );
    expect(destroyPending).toBeDefined();
    if (!destroyPending) return;
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: after,
      pendingEffect: destroyPending,
      getCardDefinitionById: getDefReal,
      getRegisteredTriggeredEffectActions: lookupReal,
    });
    expect(
      choices.some(
        (c) =>
          c.sourceCard.instanceId === "host-e2e" &&
          c.sourceEffectInstanceId === "x08-e2e"
      )
    ).toBe(true);
  });

  it("相手(BOB)自身の効果でBOB自身のスピリットが自壊するとき、X08 は応答候補にならない", () => {
    const before = buildBoard();
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "victim-e2e",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:x08-e2e-self-destruct",
      causePlayerId: BOB,
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:bsth01-x08-spear-gungnir:502",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDefReal,
      getRegisteredTriggeredEffectActions: lookupReal,
      getRegisteredBurstActions: burstLookupReal,
    });
    const destroyPending = after.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "destroy" &&
        pending.relatedInstanceId === "victim-e2e"
    );
    if (!destroyPending) {
      // リスナー不在で pending 自体が積まれないのも「応答候補にならない」と同値。
      return;
    }
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: after,
      pendingEffect: destroyPending,
      getCardDefinitionById: getDefReal,
      getRegisteredTriggeredEffectActions: lookupReal,
    });
    expect(choices.some((c) => c.sourceCard.instanceId === "x08-e2e")).toBe(
      false
    );
  });
});
