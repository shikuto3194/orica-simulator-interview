/**
 * BSLH01-TR01(A) [碧の軌跡]ノエル・シーカー 転醒トリガーの DSL 配線テスト。
 *
 * engine-drain iteration 2026-06-17:
 * 効果[3,4] の【転醒：自分のカウント5以下】「相手による離脱時、魂状態の自分の
 * 『ENIGMA』があれば、裏返せる」を旧 stub から 10_rules/08a §2 line 93 写像
 * (spirit:相手離脱 = card_event:leave_field cause:["opponent_effect","battle"]・
 * condition count_value(max:5)・steps:[rebirth]) ＋追加ゲート field_has(cardNames:
 * "ENIGMA", includeSoulState:true) で実装した。
 *
 * 検証内容:
 *  1. timing/condition/executionMode が rule line 93 写像 + ENIGMA 魂状態ゲートと一致する。
 *  2. stub が解消されている (cards:fidelity 計上対象から外れる)。
 *  3. 相手による破壊待機 (pendingLeave) 状態で executeRebirth を呼ぶと裏面
 *     ([クロスベル国防軍]ノエル・シーカー) へ flip し、pendingLeave* が解除されて
 *     フィールドに残る (08a:83 + 04:14 離脱待機状態での置換)。
 *  4. ENIGMA 不在 + 魂状態 0 のとき evaluateCondition が false を返す（ENIGMA
 *     未保有時には転醒トリガーが発火しない）。
 *  5. ENIGMA が魂状態にあるとき evaluateCondition が true を返す
 *     （includeSoulState:true 経路が魂状態 ENIGMA を計上する）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import {
  evaluateCondition,
  executeRebirth,
} from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import type {
  CardDefinition,
  Condition,
  GameState,
  RebirthAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSLH01-TR01(A) [碧の軌跡]ノエル・シーカー 転醒トリガー", () => {
  const front = cardNoMap.get("BSLH01-TR01(A)")!;

  it("B面[2,3]: 転醒/ブロック時に相手スピリット1体を当ターンのアタック/ブロック不可にする", () => {
    const back = front.backFace!;
    const effect = back.effects!.find(
      (candidate) =>
        Array.isArray(candidate.textRef) &&
        candidate.textRef[0] === 2 &&
        candidate.textRef[1] === 3
    )!;

    expect(effect).toBeDefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["rebirth", "block"],
      effectSourceEvents: ["rebirth"],
    });
    // 原文は「できる」ではないため mandatory (03c)。〔ターンに1回〕も無い。
    expect(effect.executionMode).toBeUndefined();
    expect(effect.usageLimit).toBeUndefined();
    expect(effect.steps[0]!.action).toEqual({
      kind: "prevent_battle",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      restriction: ["attack", "block"],
      duration: { scope: "turn" },
    });
    expect(effect.stub).toBeUndefined();
  });

  it("B面[2,3]: 同一ターンに繰り返し解決しても各回の対象へ戦闘禁止 CE を登録する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const definitions = new Map(expanded.map((card) => [card.cardNo, card]));
    const getDef = (id: string) => definitions.get(id);
    const back = getDef("BSLH01-TR01(B)")!;
    const effect = back.effects![0]!;
    const source = createCardInstance(back, {
      instanceId: "tr01-back",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponent = createCardInstance(front, {
      instanceId: "opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, opponent],
    });

    const afterFirst = executeEffect({
      chainId: "test:bslh01-tr01-rebirth-trigger:105",
      state: before,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const afterSecond = executeEffect({
      chainId: "test:bslh01-tr01-rebirth-trigger:113",
      state: afterFirst,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(afterFirst.pendingEffectTargetSelection).toBeNull();
    expect(
      afterSecond.activeContinuousEffects.filter(
        (continuous) =>
          continuous.modifierTag === "prevent_battle_both" &&
          continuous.targetInstanceId === opponent.instanceId
      )
    ).toHaveLength(2);
  });

  it("効果[3,4]: 相手離脱トリガー + ENIGMA 魂状態ゲート (DSL 配線)", () => {
    const rebirthEffect = front.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 3 &&
        e.textRef[1] === 4 &&
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
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ENIGMA" }],
        includeSoulState: true,
      },
    ]);
    // stub 解消済み (cards:fidelity が計上しない)
    expect(rebirthEffect.stub).toBeUndefined();
    const action = rebirthEffect.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") {
      expect(action.maxCount).toBe(5);
      // B面 textLines[0]「この面に裏返ったとき、フィールドに残る。」にカウント増減の
      // 記述が無いため、定型文由来の自動+1(デフォルト)を明示的に抑止する (P3-132)。
      expect(action.countBonusMode).toBe("none");
    }
  });

  it("相手による破壊待機状態で executeRebirth → 裏面へ flip + pendingLeave 解除", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSLH01-TR01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
    });
    // 相手 (bob) の効果でフィールドを離れる待機状態にする
    inst.pendingLeaveKind = "destroy";
    inst.pendingLeaveCause = "effect_resolution";
    inst.pendingLeaveChainId = "chain-bslh01-tr01";

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "sp-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-bslh01-tr01",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 5,
      countBonusMode: "none",
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "sp-1",
      getDef,
      "test:bslh01-tr01-rebirth-trigger:208"
    );

    // flip 成立: 裏面 (BSLH01-TR01(B)) に差し替わる。
    const flipped = after.cardInstances.find((c) => c.instanceId === "sp-1")!;
    expect(flipped.definitionId).toBe("BSLH01-TR01(B)");
    // B面に「カウント+1する」定型文が無いため、転醒してもカウントは変動しない (P3-132)。
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(2);

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

  it("ENIGMA 魂状態不在 → field_has ゲート不成立", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSLH01-TR01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });
    // カウント 0 = max:5 を満たす。ENIGMA 不在のため field_has は不成立。
    const rebirthEffect = frontDef.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 3 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    const ok = evaluateCondition(
      state,
      rebirthEffect.condition as Condition,
      "sp-1",
      "alice",
      getDef
    );
    expect(ok).toBe(false);
  });

  it("ENIGMA 魂状態あり → field_has(includeSoulState:true) ゲート成立", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const frontDef = getDef("BSLH01-TR01(A)")!;
    // ENIGMA を含むカードを ALL_CARDS から拾う（BSLH01 内の ENIGMA 系契約スピリット）。
    const enigmaCard = ALL_CARDS.find((c) => c.name.includes("ENIGMA"));
    expect(enigmaCard).toBeDefined();

    const inst = createCardInstance(frontDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const enigmaInst = createCardInstance(enigmaCard!, {
      instanceId: "enigma-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "soul_state",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst, enigmaInst],
    });
    // ENIGMA を alice の魂状態に登録（field_has の includeSoulState 経路）。
    const alice = state.players.find((p) => p.id === "alice")!;
    alice.soulStateInstanceIds.push("enigma-1");

    const rebirthEffect = frontDef.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 3 &&
        e.steps[0]?.action.kind === "rebirth"
    )!;
    const ok = evaluateCondition(
      state,
      rebirthEffect.condition as Condition,
      "sp-1",
      "alice",
      getDef
    );
    expect(ok).toBe(true);
  });
});
