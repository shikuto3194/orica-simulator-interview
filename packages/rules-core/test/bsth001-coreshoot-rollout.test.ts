/**
 * BSTH001-転醒R02(A) ユウゲンマガン [0,1]『召喚時』
 *   「相手のスピリット/アルティメット1体のコア1個をリザーブに置く。」
 *
 * 単一対象コアシュート primitive（core_move.target で相手1体を選択 → from: target_card、
 * 固定 amount 1）の横展開。選んだ1体のコアのみを源にし、相手リザーブへ移す
 * （BSSL01-C05【合体中】アタック時と同型・[[project_single_target_coreshoot]]）。
 * 従来は「対象指定コア除去 DSL 未対応」で stub だった効果の解消を board 変化で検証する。
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

const bob = (s: GameState) => s.players.find((p) => p.id === BOB)!;

describe("BSTH001-転醒R02(A) ユウゲンマガン — 召喚時 単一対象コアシュート", () => {
  const c = card("BSTH001-転醒R02(A)");

  it("構造: [0,1] は core_move.target + from target_card (固定1個)。stub 解消済み", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.stub).toBeUndefined();
    const move = summon.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "target_card" });
      expect(move.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
      expect(move.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(move.amount).toBe(1);
    }
  });

  it("[board] 召喚時: 選んだ相手1体のコア1個のみが相手リザーブへ移り、他の相手スピリットは不変", () => {
    const src = createCardInstance(c, {
      instanceId: "yugen",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const other = createCardInstance(card("BSTH001-R02"), {
      instanceId: "enemy-other",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [src, target, other],
      playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
    });
    const after = executeEffect({
      chainId: "test:bsth001-coreshoot-rollout:75",
      state: before,
      effect: c.effects![0]!,
      sourceInstanceId: "yugen",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-tgt"],
    });
    // 選んだ1体（3→2）のみ減り、相手リザーブ +1。
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!;
    expect(tgt.normalCoreCount).toBe(2);
    const oth = after.cardInstances.find(
      (x) => x.instanceId === "enemy-other"
    )!;
    expect(oth.normalCoreCount).toBe(2);
    expect(bob(after).reserveNormalCoreCount).toBe(1);
  });
});

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH001-転醒R02(B) ユウゲンマガン[裏] — アタック時 単一対象コアシュート + 消滅連動ドロー", () => {
  const c = card("BSTH001-転醒R02(A)");
  const back = c.backFace!;

  it("構造: [2,3] は core_move(target_card, 固定2) + after_state_check で ref_leave_established を発火条件にした draw。stub 解消済み", () => {
    const eff = back.effects![0]!;
    expect(eff.stub).toBeUndefined();
    const move = eff.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "target_card" });
      expect(move.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(move.amount).toBe(2);
    }
    const drawStep = eff.steps[1]!;
    expect(drawStep.connector).toBe("after_state_check");
    expect(drawStep.stepCondition).toEqual({
      kind: "ref_leave_established",
      stepId: "r02b-coreshoot",
      leaveKind: "vanish",
    });
    expect(drawStep.action).toEqual({ kind: "draw", count: 1 });
  });

  function run(targetCores: number): GameState {
    const src = createCardInstance(back, {
      instanceId: "yugen-b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy-tgt",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: targetCores,
    });
    const aliceDeckCard = createCardInstance(card("BSTH001-R02"), {
      instanceId: "alice-deck-top",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, target, aliceDeckCard],
      playerOverrides: [
        { deckCount: 1, handCount: 0 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    return executeEffect({
      chainId: "test:bsth001-coreshoot-rollout:146",
      state: before,
      effect: back.effects![0]!,
      sourceInstanceId: "yugen-b",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["enemy-tgt"],
    });
  }

  it("[board] 消滅した場合（コア2→0）: 対象がフィールドを離れ、自分はドロー1する", () => {
    const after = run(2);
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!;
    expect(tgt.zone).toBe("field");
    expect(tgt.pendingLeaveKind).toBe("vanish");
    // 消滅連動ドロー: デッキ→手札。
    expect(alice(after).handCount).toBe(1);
    expect(alice(after).deckCount).toBe(0);
    const drawn = after.cardInstances.find(
      (x) => x.instanceId === "alice-deck-top"
    )!;
    expect(drawn.zone).toBe("hand");
  });

  it("[board] 消滅しない場合（コア5→3）: 対象は場に残り、ドローしない", () => {
    const after = run(5);
    const tgt = after.cardInstances.find((x) => x.instanceId === "enemy-tgt")!;
    expect(tgt.zone).toBe("field");
    expect(tgt.normalCoreCount).toBe(3);
    expect(alice(after).handCount).toBe(0);
    expect(alice(after).deckCount).toBe(1);
  });
});
