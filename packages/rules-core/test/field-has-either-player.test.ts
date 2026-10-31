/**
 * field_has.player:"either" （自分/相手いずれかが条件を満たせば true。
 * needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C、2026-07-17）。
 *
 * bug: resolvePlayerRef は EffectPlayerRef を単一 playerId へ解決する関数のため、
 *   "self" 以外は無条件で opponent を返していた ("either" も opponent 扱い)。
 *   field_has ケースだけ "either" を特別扱いし、self / opponent それぞれに解決した
 *   clause を再帰評価して OR することで解消する（閾値は各プレイヤー単独で満たす
 *   必要があり、両者のカードを合算してカウントするわけではない）。
 *
 * BSTH02-R01/R02/R03 effects[1] の「ネクサスがあるとき」ゲートはこの primitive を
 * 使って解禁する想定（本 cluster の後続作業）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Condition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { evaluateCondition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const ALICE = "player-1";
const BOB = "player-2";

const SPIRIT_BLUE = "BSDB01-C02";

describe('field_has.player:"either"', () => {
  it("自分のカードのみでも true", () => {
    const own = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "own-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [own] });
    const cond: Condition = [
      { kind: "field_has", player: "either", minCount: 1 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(true);
  });

  it("相手のカードのみでも true (旧実装は opponent 固定解決で偶然 true だったケースの回帰確認)", () => {
    const opp = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "opp-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [opp] });
    const cond: Condition = [
      { kind: "field_has", player: "either", minCount: 1 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(true);
  });

  it("minCount は各プレイヤー単独で満たす必要があり両者を合算しない", () => {
    // 自分1枚・相手1枚 (どちらも単独では minCount:2 を満たさない) → false。
    const own = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "own-2",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const opp = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "opp-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [own, opp] });
    const cond: Condition = [
      { kind: "field_has", player: "either", minCount: 2 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(false);
  });

  it("片方のプレイヤーだけで minCount を満たせば true", () => {
    const own1 = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "own-3a",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const own2 = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "own-3b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [own1, own2] });
    const cond: Condition = [
      { kind: "field_has", player: "either", minCount: 2 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(true);
  });

  it("フィールドにカードが無ければ either でも false", () => {
    const state = createEmptyGameState({ cardInstances: [] });
    const cond: Condition = [
      { kind: "field_has", player: "either", minCount: 1 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(false);
  });

  it("player:'self' は引き続き自分のカードのみをカウントする (回帰確認)", () => {
    const opp = createCardInstance(card(SPIRIT_BLUE), {
      instanceId: "opp-3",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [opp] });
    const cond: Condition = [
      { kind: "field_has", player: "self", minCount: 1 },
    ];
    expect(evaluateCondition(state, cond, "", ALICE, getDef)).toBe(false);
  });
});
