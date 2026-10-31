/**
 * BSTH002-転醒X01(A) 二ッ岩 マミゾウ 転醒トリガーの DSL 配線テスト。
 *
 * engine-drain iteration 2026-06-17:
 * 効果[6,7] の【転醒：自分のカウント5以下】「相手による離脱時、裏返せる」を
 * 旧 stub から 10_rules/08a §2 line 93 写像 (spirit:相手離脱 = card_event:leave_field
 * cause:["opponent_effect","battle"]・condition count_value(max:5)・steps:[rebirth]) で
 * 実装した。BSTH03-転醒R01(A) (ネクサス版 同型) との対称性を検証する。
 *
 * 検証内容:
 *  1. timing/condition/executionMode が rule line 93 写像と一致する。
 *  2. stub が解消されている (cards:fidelity 計上対象から外れる)。
 *  3. 相手による破壊待機 (pendingLeave) 状態で executeRebirth を呼ぶと
 *     裏面 (BSTH002-転醒X01(B) 魅魔) へ flip し、pendingLeave* が解除されて
 *     フィールドに残る (08a:83 + 04:14 離脱待機状態での置換)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import type { CardDefinition, GameState, RebirthAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH002-転醒X01(A) 二ッ岩 マミゾウ 転醒トリガー", () => {
  const front = cardNoMap.get("BSTH002-転醒X01(A)")!;

  it("効果[6,7]: 相手による離脱トリガー (card_event:leave_field cause spirit パターン)", () => {
    // effects[2] = [6,7] textRef の転醒効果（[0,1] 召喚/アタック時, [1] 攻撃時破壊, [2] 転醒）
    const rebirthEffect = front.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 6 &&
        e.textRef[1] === 7 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    expect(rebirthEffect).toBeDefined();
    expect(rebirthEffect.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(rebirthEffect.executionMode).toBe("optional");
    expect(rebirthEffect.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    // stub 解消済み (cards:fidelity が計上しない)
    expect(rebirthEffect.stub).toBeUndefined();
    const action = rebirthEffect.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") expect(action.maxCount).toBe(5);
  });

  it("相手による破壊待機状態で executeRebirth → 裏面(魅魔)へ flip + pendingLeave 解除", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSTH002-転醒X01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
    });
    // 相手 (bob) の効果でフィールドを離れる待機状態にする (battle/effect 両 cause 対象)
    inst.pendingLeaveKind = "destroy";
    inst.pendingLeaveCause = "effect_resolution";
    inst.pendingLeaveChainId = "chain-bsth002";

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "sp-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-bsth002",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 5,
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "sp-1",
      getDef,
      "test:bsth002-tensei-x01-leave-trigger:98"
    );

    // flip 成立: 裏面 (BSTH002-転醒X01(B) 魅魔) に差し替わる。
    const flipped = after.cardInstances.find((c) => c.instanceId === "sp-1")!;
    expect(flipped.definitionId).toBe("BSTH002-転醒X01(B)");

    // pendingLeave* がすべて解除されフィールドに残る (置換)
    expect(flipped.pendingLeaveKind).toBeNull();
    expect(flipped.pendingLeaveCause).toBeNull();
    expect(flipped.pendingLeaveChainId).toBeNull();
    expect(
      after.pendingLeaveEntities.find((p) => p.instanceId === "sp-1")
    ).toBeUndefined();

    // 「stay-on-field」ログが出ている (executeRebirth が置換を行った印)
    expect(
      after.log.some((l) => l.includes("effect:rebirth:sp-1:stay-on-field"))
    ).toBe(true);
  });
});
