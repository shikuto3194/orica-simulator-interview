/**
 * field_has soulStateOnly フラグ（BSLH01-C03 effects[2]「魂状態の自分の系統:「導力器」を
 * 持つブレイヴカードがあるとき」型）。
 *
 * 仕様:
 *   - soulStateOnly:true → soulStateInstanceIds に含まれる個体のみマッチ
 *   - 通常フィールドの brave 個体は数えない
 *   - includeSoulState を暗黙に有効化する（魂状態を opt-in した上でさらに限定する）
 *
 * 10_rules/08a「名前参照の包含スコープ」の "魂状態のみ" バリアント。dsl-types.ts
 * CardFilter.soulState:"only" と意味的に等価。
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

// BSLH01-CX01 = ENIGMA[戦術オーブメント] (printedCategory:"brave" / tribe:"導力器")。
// BSLH01-C03 のソウルとして契約された場合を想定する単体カード。
const BRAVE_DORIKIKI = "BSLH01-CX01";

function fieldHasDorikikiBrave(
  opts: { includeSoulState?: boolean; soulStateOnly?: boolean } = {}
): Condition {
  return [
    {
      kind: "field_has",
      player: "self",
      category: ["brave"],
      tribes: ["導力器"],
      minCount: 1,
      ...opts,
    },
  ];
}

const evalIt = (
  state: Parameters<typeof evaluateCondition>[0],
  cond: Condition
) => evaluateCondition(state, cond, "", ALICE, getDef);

describe("field_has soulStateOnly (BSLH01-C03 effects[2] 型)", () => {
  it("魂状態の導力器ブレイヴは soulStateOnly で数える", () => {
    const brave = createCardInstance(card(BRAVE_DORIKIKI), {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [brave],
      playerOverrides: [{ soulStateInstanceIds: ["brave-1"] }, {}],
    });
    // 無印では魂状態を除外 → false
    expect(evalIt(state, fieldHasDorikikiBrave())).toBe(false);
    // includeSoulState で魂状態も含む → true
    expect(
      evalIt(state, fieldHasDorikikiBrave({ includeSoulState: true }))
    ).toBe(true);
    // soulStateOnly で魂状態のみに限定 → true
    expect(evalIt(state, fieldHasDorikikiBrave({ soulStateOnly: true }))).toBe(
      true
    );
  });

  it("通常フィールドの導力器ブレイヴは soulStateOnly では数えない", () => {
    const brave = createCardInstance(card(BRAVE_DORIKIKI), {
      instanceId: "brave-norm",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [brave] });
    // 通常フィールドの brave は無印で数える → true
    expect(evalIt(state, fieldHasDorikikiBrave())).toBe(true);
    // soulStateOnly では除外 → false
    expect(evalIt(state, fieldHasDorikikiBrave({ soulStateOnly: true }))).toBe(
      false
    );
  });

  it("候補不在では soulStateOnly でも false", () => {
    const state = createEmptyGameState({ cardInstances: [] });
    expect(evalIt(state, fieldHasDorikikiBrave({ soulStateOnly: true }))).toBe(
      false
    );
  });
});

// BSLH01-C03 効果アサート: effects[2] の条件が soulStateOnly+brave+導力器 に
// 忠実化されていることを構造的に確認する（stub 解消の二重ガード）。
describe("BSLH01-C03 effects[2] (シャイニングポム『破壊時』)", () => {
  it("条件は field_has(brave / 導力器 / soulStateOnly:true) で表現する", () => {
    const def = card("BSLH01-C03");
    const eff = def.effects?.[2];
    expect(eff).toBeDefined();
    // stub 解消の機械ガード
    expect((eff as { stub?: string }).stub).toBeUndefined();
    const cond = (eff as { condition?: Condition }).condition;
    expect(Array.isArray(cond)).toBe(true);
    expect(cond?.length).toBe(1);
    const clause = cond?.[0];
    expect(clause?.kind).toBe("field_has");
    if (clause?.kind === "field_has") {
      expect(clause.player).toBe("self");
      expect(clause.category).toEqual(["brave"]);
      expect(clause.tribes).toEqual(["導力器"]);
      expect(clause.soulStateOnly).toBe(true);
    }
  });
});
