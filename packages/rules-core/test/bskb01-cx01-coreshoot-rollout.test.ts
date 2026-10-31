import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSKB01-CX01 [仮面の騎士]メタナイト [5,6]『このスピリットのアタック時』
 *   「自分のカウント+2する。その後、相手のスピリット/アルティメット1体のコアを、
 *    自分のカウント2につき、1個リザーブに置ける。」
 *
 * 単一対象コアシュート primitive（core_move.target で相手1体を選択 → from: target_card、
 * 動的 max = floor(count/2)）の横展開。count_increase が先に解決されるため、max は
 * +2 後のカウントを 1/2 した値になる（BSSL01-C05【合体中】アタック時と同型・
 * [[project_single_target_coreshoot]]）。従来「カウント依存・端数処理の可変コア除去未対応」
 * で stub だった効果の解消を構造と board 変化で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;
const bob = (s: GameState) => s.players.find((p) => p.id === BOB)!;

describe("BSKB01-CX01 [仮面の騎士]メタナイト — アタック時 単一対象コアシュート", () => {
  const c = card("BSKB01-CX01");

  it("構造: [5,6] は count_increase(+2) → core_move.target + from target_card (max=count/2)。stub 解消済み", () => {
    const atk = c.effects![2]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.stub).toBeUndefined();
    expect(atk.executionMode).toBeUndefined();

    const inc = atk.steps[0]!.action;
    expect(inc).toMatchObject({
      kind: "count_increase",
      player: "self",
      amount: 2,
    });

    const move = atk.steps[1]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "target_card" });
      expect(move.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
      expect(move.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(move.amount).toEqual({
        min: 0,
        max: { source: { kind: "count_value", player: "self" }, divisor: 2 },
      });
    }
  });

  it("[board] カウント3 → +2=5 → max=floor(5/2)=2 の pending を選んだ相手1体に対して生成", () => {
    const src = createCardInstance(c, {
      instanceId: "metaknight",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const target = createCardInstance(card("BSKB01-M01"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const before = createEmptyGameState({
      cardInstances: [src, target],
      playerOverrides: [{ countValue: 3 }, { reserveNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bskb01-cx01-coreshoot-rollout:85",
      state: before,
      effect: c.effects![2]!,
      sourceInstanceId: "metaknight",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-tgt"],
    });
    // count_increase が先に解決され +2 = 5。
    expect(alice(after).countValue).toBe(5);
    // 選んだ1体（コア3）を源にした max=floor(5/2)=2 の数選択 pending。
    expect(after.pendingCoreCountSelection).not.toBeNull();
    expect(after.pendingCoreCountSelection!.min).toBe(0);
    expect(after.pendingCoreCountSelection!.max).toBe(2);
    expect(after.pendingCoreCountSelection!.fromLocation).toEqual({
      kind: "card_instance",
      instanceId: "enemy-tgt",
    });
    // 数選択前なので相手リザーブ・対象コアは未変化。
    expect(bob(after).reserveNormalCoreCount).toBe(0);
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!;
    expect(tgt.normalCoreCount).toBe(3);
  });
});

describe("BSKB01-CX01 [仮面の騎士]メタナイト — メインステップ終了時 コア配置→BP比べ破壊", () => {
  const c = card("BSKB01-CX01");

  it("構造: [2,3] は core_move(target→to:target_card) → count_increase → bp_compare_destroy(ref)。stub 解消済み", () => {
    const eff = c.effects![1]!;
    expect(eff.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "either",
      subPhase: "end",
    });
    expect(eff.stub).toBeUndefined();
    expect(eff.executionMode).toBe("optional");

    const move = eff.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "reserve", player: "opponent" });
      expect(move.to).toEqual({ kind: "target_card" });
      expect(move.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
      expect(move.amount).toBe(1);
    }

    const inc = eff.steps[1]!.action;
    expect(inc).toMatchObject({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(eff.steps[1]!.connector).toBe("conditional_result");

    const cmp = eff.steps[2]!.action;
    expect(cmp.kind).toBe("bp_compare_destroy");
    if (cmp.kind === "bp_compare_destroy") {
      expect(cmp.target).toEqual({ kind: "ref", stepId: "place-core" });
      // Pattern 1: 源は発生源カード自身（comparer 省略）。
      expect(cmp.comparer).toBeUndefined();
    }
    expect(eff.steps[2]!.connector).toBe("conditional_result");
  });

  it("[board] 相手リザーブのコアを選んだ相手1体へ→カウント+1→低BP対象が破壊、源は残る", () => {
    // メタナイト Lv2 = BP6000（2コア）。
    const src = createCardInstance(c, {
      instanceId: "metaknight",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    // 相手 = BSDB01-C05 クリリン Lv1 BP2000（1コア）。コア配置で 2 個でも Lv1 据置（C05 levelDefs 依存）でも
    // BP は 6000 未満に留まる → 同じか低いので破壊される。
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      cardInstances: [src, opp],
      playerOverrides: [{ countValue: 0 }, { reserveNormalCoreCount: 1 }],
    });
    const after = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bskb01-cx01-coreshoot-rollout:177",
        state: before,
        effect: c.effects![1]!,
        sourceInstanceId: "metaknight",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        targetInstanceIds: ["enemy-tgt"],
      }),
      getDef,
      { targetInstanceIds: ["enemy-tgt"] }
    );

    // 1個を置いた対象が破壊され、元のコアと合わせて2個がリザーブへ戻る。
    expect(bob(after).reserveNormalCoreCount).toBe(2);
    // コアを置けたとき → 自分のカウント +1。
    expect(alice(after).countValue).toBe(1);
    // 対象は BP6000 以下なので破壊される。源（メタナイト BP6000）は対象より高いので残る。
    const oppCard = after.cardInstances.find(
      (x) => x.instanceId === "enemy-tgt"
    )!;
    const srcCard = after.cardInstances.find(
      (x) => x.instanceId === "metaknight"
    )!;
    expect(
      oppCard.zone !== "field" || oppCard.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(srcCard.zone).toBe("field");
    expect(srcCard.pendingLeaveKind).toBeNull();
  });
});
