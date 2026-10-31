/**
 * BSTH001-転醒R02(A) ユウゲンマガン 転醒トリガーの DSL 配線テスト。
 *
 * engine-drain iteration 2026-06-17:
 * 効果[6,7] の【転醒：自分のカウント3以下】「自分が相手のスピリット/アルティメットを
 * 消滅/破壊したとき、このスピリットを裏返せる」を旧 stub から
 * game_event:[destroy,vanish] player:opponent + triggerFilter:[spirit,ultimate]
 * + cause:[battle,opponent_effect] + condition[min_level:2, rebirth.maxCount:3]
 * + steps:[rebirth] で実装した。
 *
 * cause 方向は離脱した相手カード視点 (deriveTriggerEventCauseFromPendingLeave):
 *   - battle = バトル討ち取り
 *   - opponent_effect = destroyedCardController(=相手) と異なる causePlayerId (=自分)
 *   - self_effect は相手自身の自破壊効果のため「自分が」に該当せず除外
 *
 * sourceWhose:"either" (ENGINE-cause-polarity-self-effect-opponent-effect-audit 横断調査で
 * 追加検出): 同 family の actingPlayerId は「離脱した相手カードのコントローラ」を指し
 * listener(このカード)自身のコントローラとは一致しないため、既定 whose:"self"
 * (getTriggeredEffectSourceUseBlockReason) では常に候補から除外されてしまっていた
 * (下記「本カードが実際に候補になるか」テストが本来の e2e 検証。旧コメントの
 * 「既存 generic trigger framework のテストで担保」は誤りだった — 手組み
 * StructuredTriggerEvent への注入テストのみで、実際の pendingLeave→cause 導出
 * →getAvailableTriggeredEffectSourceChoices 経路は未検証だった)。
 *
 * 検証内容:
 *  1. timing/condition/executionMode が原文写像と一致する。
 *  2. triggerFilter が spirit/ultimate のみで nexus 等を含まない。
 *  3. stub が解消されている (cards:fidelity 計上対象から外れる)。
 *  4. cause:[battle,opponent_effect] が登録されており self_effect (相手の自壊) は対象外。
 *  5. executeRebirth で裏面 (BSTH001-転醒R02(B) 幽幻魔眼) へ flip する。
 *  6. 実際の destroy pending (queuePendingLeave) → 導出 cause → 発揮枠候補まで通しで検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import type { CardDefinition, GameState, RebirthAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH001-転醒R02(A) ユウゲンマガン 転醒トリガー", () => {
  const front = cardNoMap.get("BSTH001-転醒R02(A)")!;

  it("効果[6,7]: game_event:destroy/vanish opponent spirit/ultimate + cause filter 配線", () => {
    // effects[2] = [6,7] textRef の転醒効果 (rebirth 含む)
    const rebirthEffect = front.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 6 &&
        e.textRef[1] === 7 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    expect(rebirthEffect).toBeDefined();

    // timing: game_event player:opponent event:[destroy,vanish] triggerFilter spirit/ultimate
    //         cause:[battle, opponent_effect] (相手スピ/アルが自分の働きで離脱)
    expect(rebirthEffect.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: ["destroy", "vanish"],
      triggerFilter: { category: ["spirit", "ultimate"] },
      cause: ["battle", "opponent_effect"],
      sourceWhose: "either",
    });

    // executionMode optional = 「裏返せる」(可能形=任意)
    expect(rebirthEffect.executionMode).toBe("optional");

    // 転醒条件: Lv2 以上 (本効果が Lv2-Lv3 でのみ発揮)
    expect(rebirthEffect.condition).toEqual([{ kind: "min_level", value: 2 }]);

    // rebirth.maxCount = 3 (自分のカウント3以下のときのみ flip)
    const action = rebirthEffect.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") {
      expect(action.maxCount).toBe(3);
    }

    // stub 解消済み (cards:fidelity が計上しない)
    expect(rebirthEffect.stub).toBeUndefined();
  });

  it("triggerFilter は spirit/ultimate のみ・nexus/magic 等は対象外", () => {
    const rebirthEffect = front.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 6 &&
        e.textRef[1] === 7 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    expect(rebirthEffect.timing.kind).toBe("game_event");
    if (rebirthEffect.timing.kind === "game_event") {
      const filter = rebirthEffect.timing.triggerFilter;
      expect(filter).toBeDefined();
      expect(filter?.category).toEqual(["spirit", "ultimate"]);
    }
  });

  it("cause filter に self_effect が含まれない (相手自身の自破壊効果は『自分が』に該当しない)", () => {
    const rebirthEffect = front.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 6 &&
        e.textRef[1] === 7 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    expect(rebirthEffect.timing.kind).toBe("game_event");
    if (rebirthEffect.timing.kind === "game_event") {
      const cause = rebirthEffect.timing.cause;
      expect(Array.isArray(cause)).toBe(true);
      const causes = cause as readonly string[];
      expect(causes).toContain("battle");
      expect(causes).toContain("opponent_effect");
      expect(causes).not.toContain("self_effect");
      expect(causes).not.toContain("state_based");
    }
  });

  it("executeRebirth で裏面 (BSTH001-転醒R02(B) 幽幻魔眼) へ flip", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSTH001-転醒R02(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2, // Lv2 (requiredCores 2)
    });

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });

    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 3,
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "sp-1",
      getDef,
      "test:bsth001-tensei-r02-destroy-trigger:161"
    );

    // flip 成立: 裏面 (BSTH001-転醒R02(B) 幽幻魔眼) に差し替わる。
    const flipped = after.cardInstances.find((c) => c.instanceId === "sp-1")!;
    expect(flipped.definitionId).toBe("BSTH001-転醒R02(B)");
  });

  it("[end-to-end] 自分(ALICE)の破壊効果(非バトル)で相手のスピリットが離脱するとき、本カードが応答候補になる", () => {
    const VICTIM = cardNoMap.get("BSTH001-C01")!;
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [VICTIM.cardNo, VICTIM],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front, VICTIM]);
    const burstLookup = buildBurstEffectLookup([front, VICTIM]);

    const self = createCardInstance(front, {
      instanceId: "r02-e2e",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level 条件成立)
    });
    const victim = createCardInstance(VICTIM, {
      instanceId: "victim-e2e",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self, victim],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "victim-e2e",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:r02-e2e-destroy",
      causePlayerId: "alice",
    });
    const after = collectAndQueueTriggerReactions({
      chainId: "test:bsth001-tensei-r02-destroy-trigger:205",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: "alice",
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
    expect(choices.some((c) => c.sourceCard.instanceId === "r02-e2e")).toBe(
      true
    );
  });

  it("[regression] 破壊を契機にした別カードの転醒も相手の実移動前に解決する", () => {
    // 転醒の対象が自分自身でも、破壊から誘発した効果の解決を待つ (Q1501)。
    const VICTIM = cardNoMap.get("BSTH001-C01")!;
    const defs = new Map<string, CardDefinition>([
      [front.cardNo, front],
      [VICTIM.cardNo, VICTIM],
    ]);
    const getDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([front, VICTIM]);
    const burstLookup = buildBurstEffectLookup([front, VICTIM]);

    const self = createCardInstance(front, {
      instanceId: "r02-flush-guard",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level 条件成立)
    });
    const victim = createCardInstance(VICTIM, {
      instanceId: "victim-flush-guard",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self, victim],
      playerOverrides: [{ countValue: 0 }, {}],
    });
    const afterDestroy = queuePendingLeave({
      state: before,
      instanceId: "victim-flush-guard",
      kind: "destroy",
      cause: "effect_resolution",
      chainId: "test-chain:r02-flush-guard-destroy",
      causePlayerId: "alice",
    });
    const afterReactions = collectAndQueueTriggerReactions({
      chainId: "test:bsth001-tensei-r02-destroy-trigger:270",
      beforeState: before,
      afterState: afterDestroy,
      source: "action_resolution",
      causedByPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: burstLookup,
    });

    // 転醒をまだ宣言/辞退していないため、破壊待機を維持する。
    const flushed = flushPendingLeaves(afterReactions, getDef);
    const victimAfterFlush = flushed.cardInstances.find(
      (c) => c.instanceId === "victim-flush-guard"
    );
    expect(victimAfterFlush?.zone).toBe("field");
    expect(
      flushed.pendingLeaveEntities.some(
        (pl) => pl.instanceId === "victim-flush-guard"
      )
    ).toBe(true);
  });
});
