/**
 * 名前参照の包含スコープ（card-data 配線。10_rules/08a, 裁定 2026-06-13）。
 *
 * 「魂状態を含む自分の「X」」「魂状態/煌臨元を含む自分の「X」」とテキストに明記されたカードの
 * field_has 条件は、includeSoulState / includeAdventSource を opt-in しなければ魂状態・煌臨元を
 * 数えず undercount する（2026-06-13 に無印スコープが魂状態/煌臨元を除外する裁定へ変わったため、
 * それ以前に「field_has が自然に含む」前提で書かれたカードは退行する）。
 *
 * 本テストは:
 *   1. 該当カードの実定義から field_has 条件を抽出し、期待フラグが付いていることを直接ガードする。
 *   2. 代表 1 件（BSRK01-C03「剣心」）を、魂状態の「剣心」のみ在場の盤面で評価し true を確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Condition, ConditionClause } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { evaluateCondition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

/** カードの全効果（effect レベル + step レベル）の condition から field_has 句を集める。 */
function collectFieldHas(def: CardDefinition): ConditionClause[] {
  const out: ConditionClause[] = [];
  const pushFrom = (cond: Condition | undefined) => {
    if (!cond) return;
    for (const clause of cond) {
      if (clause.kind === "field_has") out.push(clause);
    }
  };
  for (const effect of def.effects ?? []) {
    pushFrom(effect.condition);
    for (const step of effect.steps ?? []) {
      pushFrom(step.condition);
    }
  }
  return out;
}

function nameMatches(clause: ConditionClause, sub: string): boolean {
  if (clause.kind !== "field_has" || !clause.cardNames) return false;
  return clause.cardNames.some(
    (m) =>
      ("contains" in m && m.contains === sub) ||
      ("exact" in m && m.exact === sub)
  );
}

interface Expect {
  cardNo: string;
  nameSub: string;
  soul?: boolean;
  advent?: boolean;
}

const CASES: Expect[] = [
  {
    cardNo: "BSDB01-C08",
    nameSub: "孫悟空＆ベジータ",
    soul: true,
    advent: true,
  },
  { cardNo: "BSFT01-TR09(A)", nameSub: "ルーシィ", soul: true },
  { cardNo: "BSRK01-C03", nameSub: "剣心", soul: true },
  { cardNo: "BSRK01-R01", nameSub: "剣心", soul: true },
  { cardNo: "BSRK01-R02", nameSub: "剣心", soul: true },
  { cardNo: "BSTS01-M01", nameSub: "リムル", soul: true },
];

describe("名前参照の包含スコープ（card-data 配線, 裁定 2026-06-13）", () => {
  for (const c of CASES) {
    it(`${c.cardNo}「${c.nameSub}」の field_has が期待フラグを持つ`, () => {
      const def = cardNoMap.get(c.cardNo);
      expect(def, `card not found: ${c.cardNo}`).toBeDefined();
      const matches = collectFieldHas(def!).filter((cl) =>
        nameMatches(cl, c.nameSub)
      );
      expect(matches.length).toBeGreaterThan(0);
      for (const cl of matches) {
        if (c.soul)
          expect((cl as { includeSoulState?: boolean }).includeSoulState).toBe(
            true
          );
        if (c.advent)
          expect(
            (cl as { includeAdventSource?: boolean }).includeAdventSource
          ).toBe(true);
      }
    });
  }

  it("BSRK01-C03 のスタック条件は魂状態の「剣心」のみで成立する", () => {
    // 魂状態の「緋村 剣心」(BSRK01-CX01, contains "剣心") のみ在場。
    const soul = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "kenshin-soul",
      ownerPlayerId: "player-1",
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [soul],
      playerOverrides: [{ soulStateInstanceIds: ["kenshin-soul"] }, {}],
    });
    const def = card("BSRK01-C03");
    const cond = collectFieldHas(def).filter((cl) => nameMatches(cl, "剣心"));
    expect(cond.length).toBeGreaterThan(0);
    // 実定義の条件（includeSoulState:true 付き）→ 魂状態のみでも true。
    expect(evaluateCondition(state, [cond[0]], "", "player-1", getDef)).toBe(
      true
    );
    // 無印（フラグを外した同条件）→ 魂状態は数えず false（退行ガード）。
    const stripped = { ...cond[0] } as Record<string, unknown>;
    delete stripped.includeSoulState;
    expect(
      evaluateCondition(
        state,
        [stripped as ConditionClause],
        "",
        "player-1",
        getDef
      )
    ).toBe(false);
  });
});
