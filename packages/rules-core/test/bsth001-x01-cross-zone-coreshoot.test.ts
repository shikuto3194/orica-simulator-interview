/**
 * BSTH001-X01 サリエル [0]『このスピリットのアタック時』
 *   「自分のカウント2以上のとき、相手のフィールド/リザーブのコア2個をボイドに置ける。」
 *
 * フィールド/リザーブ横断コア除去 primitive（core_move from field + includeReserve）の検証。
 * 相手のフィールドカードのコアとリザーブの通常コアを同一プールとして扱い、合計2個まで
 * （ボイドへ移動なのでソウルコアは含めない）プレイヤーが移動元を選んで除去する。
 * 候補が複数ある（フィールドカード + リザーブ擬似候補）/合計が amount を超えるとき
 * pendingCoreShootSelection を生成し、`reserve:<playerId>` sentinel でリザーブ分を分配する。
 * 候補が単一/合計 <= amount なら従来どおり自動解決（リザーブ補填含む）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";

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

describe("BSTH001-X01 サリエル — アタック時 フィールド/リザーブ横断コア除去", () => {
  const c = card("BSTH001-X01");
  const atk = c.effects![0]!;

  it("構造: [0] は core_move(field, includeReserve) → void。stub 解消済み", () => {
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.stub).toBeUndefined();
    const move = atk.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({
        kind: "field",
        player: "opponent",
        includeReserve: true,
      });
      expect(move.to).toEqual({ kind: "void", player: "opponent" });
      expect(move.amount).toBe(2);
    }
  });

  function setup(opts: { fieldCores: number; reserveCores: number }): {
    state: GameState;
  } {
    const src = createCardInstance(c, {
      instanceId: "sariel",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSTH001-R01"), {
      instanceId: "enemy",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: opts.fieldCores,
    });
    const state = createEmptyGameState({
      // 効果条件: 自分(ALICE)のカウント2以上。
      cardInstances: [src, enemy],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        { countValue: 2 },
        { reserveNormalCoreCount: opts.reserveCores },
      ],
    });
    return { state };
  }

  function run(state: GameState): GameState {
    return executeEffect({
      chainId: "test:bsth001-x01-cross-zone-coreshoot:83",
      state,
      effect: atk,
      sourceInstanceId: "sariel",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
  }

  it("[pending] フィールドカード + リザーブの両方に源があるとき、リザーブ擬似候補を含む pending を生成", () => {
    const { state } = setup({ fieldCores: 3, reserveCores: 2 });
    const after = run(state);
    const pending = after.pendingCoreShootSelection;
    expect(pending).not.toBeNull();
    expect(pending!.totalAmount).toBe(2);
    // フィールドカード候補 + リザーブ sentinel 候補の 2 候補。
    const reserveCand = pending!.candidates.find(
      (cand) => cand.instanceId === `reserve:${BOB}`
    );
    expect(reserveCand).toBeDefined();
    expect(reserveCand!.isReserve).toBe(true);
    expect(
      pending!.candidates.some((cand) => cand.instanceId === "enemy")
    ).toBe(true);
  });

  it("[board] リザーブ1個 + フィールド1個を選んでボイドへ → フィールド3→2・リザーブ2→1・相手ボイド +2", () => {
    const { state } = setup({ fieldCores: 3, reserveCores: 2 });
    const generated = run(state);
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find((a) => a.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById: getDef,
      coreShootDistribution: { enemy: 1, [`reserve:${BOB}`]: 1 },
    }).state;
    expect(after.pendingCoreShootSelection).toBeNull();
    const enemy = after.cardInstances.find((x) => x.instanceId === "enemy")!;
    expect(enemy.normalCoreCount).toBe(2);
    expect(bob(after).reserveNormalCoreCount).toBe(1);
    expect(bob(after).voidNormalCoreCount).toBe(2);
  });

  it("[board] リザーブ2個を選んでボイドへ → フィールド不変・リザーブ3→1・相手ボイド +2", () => {
    const { state } = setup({ fieldCores: 3, reserveCores: 3 });
    const generated = run(state);
    const actions = getLegalActions({
      state: generated,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const action = actions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    )!;
    const after = applyLegalAction({
      state: generated,
      action,
      getCardDefinitionById: getDef,
      coreShootDistribution: { [`reserve:${BOB}`]: 2 },
    }).state;
    const enemy = after.cardInstances.find((x) => x.instanceId === "enemy")!;
    expect(enemy.normalCoreCount).toBe(3);
    expect(bob(after).reserveNormalCoreCount).toBe(1);
    expect(bob(after).voidNormalCoreCount).toBe(2);
  });

  it("[board] 自動解決: フィールド1個 + リザーブ1個で合計2個ちょうど → 両方ボイドへ（pending なし）", () => {
    const { state } = setup({ fieldCores: 1, reserveCores: 1 });
    const after = run(state);
    // 合計 2 = amount かつ候補2でも totalAvailable <= amount なので自動解決。
    expect(after.pendingCoreShootSelection ?? null).toBeNull();
    const enemy = after.cardInstances.find((x) => x.instanceId === "enemy")!;
    expect(enemy.normalCoreCount).toBe(0);
    expect(bob(after).reserveNormalCoreCount).toBe(0);
    expect(bob(after).voidNormalCoreCount).toBe(2);
  });
});
