/**
 * 破壊連動（『このスピリットのアタック時』効果/バトルで相手を破壊したとき）の盤面変化と発揮枠ゲート。
 *
 * 対象カード (いずれも BSTH01-X08 同型「アタック中スコープの即時効果」):
 *   - BSTH003-C31「魔法使い達の杖」: このスピリットの効果で相手を破壊したとき相手ライフ1コアをリザーブへ。
 *     cause=opponent_effect のみ（バトル討ち取りは対象外）。
 *   - BSTH003-M02「可能性空間移動船」: 同条件で自身を回復。
 *   - BSTH002-転醒X01(A)「霧雨魔梨沙」: 相手を破壊/消滅させたとき相手ライフ1コアをリザーブへ。
 *     cause=[battle, opponent_effect]（「効果で」限定が無いためバトル討ち取りも対象）。
 *   cause の極性は deriveTriggerEventCauseFromPendingLeave が離脱カード(=相手)自身の
 *   コントローラ基準で導出するため、「自分が」破壊した場合は opponent_effect 側になる
 *   (self_effect は「相手が相手自身を自壊させた」を指す。
 *   ENGINE-cause-polarity-self-effect-opponent-effect-audit)。
 *
 * 設計根拠 10_rules/05「『アタック時』の2類型と上位フィルター」/ [[project_attack_time_scope_immediate]]。
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
  StructuredTriggerEvent,
  TriggerEventCause,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function defOf(cardNo: string): CardDefinition {
  const def = ALL_CARDS.find((c) => c.cardNo === cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def as CardDefinition;
}

// ────────────────────────────────────────────────────────────
// 1. 盤面変化: 相手ライフ1コア→相手リザーブ (C31 / BSTH002-転醒X01(A) 共通)
// ────────────────────────────────────────────────────────────

describe("破壊連動: 相手ライフ→リザーブ core_move の盤面変化", () => {
  // 実カードのステップ列を取り出し、発揮枠ゲート (game_event 誘発 + in_battle) は
  // cause 絞り込み test で別途検証する。盤面変化の単位検証は steps を即時実行で確認する
  // (BSTH01-X08 test と同じ手法: 誘発配線とアクション解決を分離して検証)。
  function immediateOf(steps: Effect["steps"]): Effect {
    return { timing: { kind: "activated", mode: "main" }, steps };
  }

  it("C31 effect[0] のステップで相手ライフ1コアがリザーブへ移る", () => {
    const c31 = defOf("BSTH003-C31");
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {},
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    const result = executeEffect({
      chainId: "test:destroy-effect-life-reserve-recover:69",
      state,
      effect: immediateOf((c31.effects[0] as Effect).steps),
      sourceInstanceId: "s1",
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(4);
    expect(bob.reserveNormalCoreCount).toBe(1);
  });

  it("BSTH002-転醒X01(A) effect[1] のステップで相手ライフ1コアがリザーブへ移る", () => {
    const card = defOf("BSTH002-転醒X01(A)");
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {},
        { lifeNormalCoreCount: 4, reserveNormalCoreCount: 0 },
      ],
    });
    const result = executeEffect({
      chainId: "test:destroy-effect-life-reserve-recover:90",
      state,
      effect: immediateOf((card.effects[1] as Effect).steps),
      sourceInstanceId: "s1",
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(3);
    expect(bob.reserveNormalCoreCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────
// 2. 盤面変化: 自身を回復 (M02)
// ────────────────────────────────────────────────────────────

describe("破壊連動: 自身回復 (M02)", () => {
  it("M02 effect[0] のステップで疲労状態の自身が回復する", () => {
    const m02 = defOf("BSTH003-M02");
    const effect = m02.effects[0] as Effect;
    const host = {
      ...createCardInstance(defOf("BSTH003-M02"), {
        instanceId: "s1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      exhaustState: "exhausted" as const,
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host],
    });
    const result = executeEffect({
      chainId: "test:destroy-effect-life-reserve-recover:125",
      state,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: effect.steps,
      },
      sourceInstanceId: "s1",
      actingPlayerId: ALICE,
      getCardDefinitionById: () => undefined,
    });
    const self = result.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(self.exhaustState).toBe("recovered");
  });
});

// ────────────────────────────────────────────────────────────
// 3. cause マッチング: 「効果で」限定 (self_effect のみ) vs 破壊/消滅 (battle 含む)
// ────────────────────────────────────────────────────────────

describe("破壊連動: cause 絞り込み", () => {
  function destroyEvent(cause: TriggerEventCause): StructuredTriggerEvent {
    return {
      family: "leave_field",
      causeKind: "destroy",
      cause,
      validationMode: "snapshot_only",
    };
  }

  it("C31 (このスピリットの効果で) は opponent_effect のみ受け、battle は受けない", () => {
    const c31 = defOf("BSTH003-C31");
    const timing = (c31.effects[0] as Effect).timing as Extract<
      Effect["timing"],
      { kind: "game_event" }
    >;
    const matcher: TriggerEventMatcher = {
      family: "leave_field",
      causeKind: "destroy",
      cause: timing.cause as TriggerEventCause | readonly TriggerEventCause[],
    };
    expect(matchesTriggerEvent(matcher, destroyEvent("opponent_effect"))).toBe(
      true
    );
    expect(matchesTriggerEvent(matcher, destroyEvent("battle"))).toBe(false);
    expect(matchesTriggerEvent(matcher, destroyEvent("self_effect"))).toBe(
      false
    );
  });

  it("BSTH002-転醒X01(A) (破壊/消滅) は battle / opponent_effect 両方を受ける", () => {
    const card = defOf("BSTH002-転醒X01(A)");
    const timing = (card.effects[1] as Effect).timing as Extract<
      Effect["timing"],
      { kind: "game_event" }
    >;
    const matcher: TriggerEventMatcher = {
      family: "leave_field",
      causeKind: "destroy",
      cause: timing.cause as TriggerEventCause | readonly TriggerEventCause[],
    };
    expect(matchesTriggerEvent(matcher, destroyEvent("battle"))).toBe(true);
    expect(matchesTriggerEvent(matcher, destroyEvent("opponent_effect"))).toBe(
      true
    );
    expect(matchesTriggerEvent(matcher, destroyEvent("self_effect"))).toBe(
      false
    );
  });
});

// ────────────────────────────────────────────────────────────
// 4. end-to-end: 実際の destroy pending → 導出 cause → 発揮枠候補 (C31)
//    (手組み StructuredTriggerEvent への注入ではなく、queuePendingLeave +
//    deriveTriggerEventCauseFromPendingLeave 経由の実導出を検証する。
//    ENGINE-cause-polarity-self-effect-opponent-effect-audit の
//    「end-to-end 検証をしていない」指摘への再発防止テスト)
// ────────────────────────────────────────────────────────────

describe("破壊連動: end-to-end (C31 が実際の自分の破壊効果で発火するか)", () => {
  const C31 = defOf("BSTH003-C31");
  const VICTIM = defOf("BSTH001-C01");

  function buildBoard() {
    const c31Brave = createCardInstance(C31, {
      instanceId: "c31-e2e",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "host-e2e",
    });
    const host = createCardInstance(VICTIM, {
      instanceId: "host-e2e",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(VICTIM, {
      instanceId: "victim-e2e",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c31Brave, host, victim],
    });
    const state = {
      ...base,
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack" as const,
      battleEntities: [
        {
          entityId: "be-e2e",
          resolvedBp: 3000,
          attackState: "attacking" as const,
          resolvedSymbols: ["red" as const],
          memberInstanceIds: ["host-e2e", "c31-e2e"],
        },
      ],
    };
    return state;
  }

  it("自分(ALICE)の破壊効果(非バトル)で相手のスピリットが離脱するとき、C31 が応答候補になる", () => {
    const defs = new Map<string, CardDefinition>([
      [C31.cardNo, C31],
      [VICTIM.cardNo, VICTIM],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([C31, VICTIM]);
    const burstLookup = buildBurstEffectLookup([C31, VICTIM]);
    const before = buildBoard();
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "victim-e2e",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:c31-e2e-destroy",
      causePlayerId: ALICE,
      // 離脱イベントは、その破壊を引き起こした合体先の情報を pending leave から受け取る。
      causedByEffectSourceInstanceId: "host-e2e",
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:destroy-effect-life-reserve-recover:271",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      causedBySourceInstanceId: "host-e2e",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: burstLookup,
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
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(choices.some((c) => c.sourceCard.instanceId === "c31-e2e")).toBe(
      true
    );
  });
});
