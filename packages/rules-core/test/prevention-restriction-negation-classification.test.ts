/**
 * preventionRestriction（限定的防止不可「○○の効果では防げない」）の
 * 原文の型 → フィールドの型（onlyPreventableBy / notPreventableBy）対応を
 * card-data 横断で固定する回帰ガード。
 *
 * 原文には向きが真逆の 2 型がある（公式裁定 Q8745/Q9751、10_rules/04b2、P3-140）。
 * - 「X以外の効果では防げない」「Xを持たない効果では防げない」= X だけが防げる → `onlyPreventableBy*`
 * - 「Xの効果では防げない」「Xを持つ効果で防げない」= X 以外が防げる → `notPreventableBy*`
 *
 * P3-140 実測（2026-08-04）で card-data 全 13 サイトを確認し、2 件
 * （BSTH06-転醒X01(B) / BSTH01-R11）が反転していたことが判明・修正済み。
 * このテストは (a) 各サイトの分類が正しい向きに固定されていること、
 * (b) 原文の逐語引用が実在すること、(c) 新規カードが分類済みリストに
 * 追加されない限り preventionRestriction サイト総数が変わらないこと、
 * の 3 点を assert する（「原文の語尾で機械的に決めず、カードごとに読んで判定する」
 * ガードレールに従い、正規表現での自動分類ではなく手動分類の存在チェックとして実装する）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { CardDefinition } from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

type PreventionField = "colors" | "categories" | "tribes" | "keywords";

interface ExpectedClassification {
  cardNo: string;
  /** 原文中の防げないriderの逐語引用（textLines に実在することを確認する）。 */
  quote: string;
  kind: "only" | "not";
  field: PreventionField;
  values: string[];
}

/**
 * P3-140 実測の 13 サイト全件。新規カードで preventionRestriction を使うときは
 * ここに追加しないと下の「総数一致」テストが落ちる（分類漏れの機械検出）。
 */
const EXPECTED: ExpectedClassification[] = [
  {
    cardNo: "BSTH002-X01",
    quote: "この効果は白以外の効果では防げない。",
    kind: "only",
    field: "colors",
    values: ["white"],
  },
  {
    cardNo: "BSTH01-R11",
    quote: "この効果は白の効果では防げない。",
    kind: "not",
    field: "colors",
    values: ["white"],
  },
  {
    cardNo: "BSTH03-M04",
    quote: "この効果は系統：「起幻」を持たない効果では防げない。",
    kind: "only",
    field: "tribes",
    values: ["起幻"],
  },
  {
    cardNo: "BSTH03-X01",
    quote: "この効果は黄の効果以外では防げない。",
    kind: "only",
    field: "colors",
    values: ["yellow"],
  },
  {
    cardNo: "BSTH03-転醒X01(B)",
    quote: "この効果は系統：「蓬莱」を持つ一切の効果で防げず",
    kind: "not",
    field: "tribes",
    values: ["蓬莱"],
  },
  {
    cardNo: "BSTH05-M02",
    quote: "この効果は【超重装甲】以外では防げない。",
    kind: "only",
    field: "keywords",
    values: ["超重装甲"],
  },
  {
    cardNo: "BSTH05-M03",
    quote: "この効果は【超重装甲】以外では防げない。",
    kind: "only",
    field: "keywords",
    values: ["超重装甲"],
  },
  {
    cardNo: "BSTH05-X04",
    quote: "この効果は【超重装甲】以外では防げない。",
    kind: "only",
    field: "keywords",
    values: ["超重装甲"],
  },
  {
    cardNo: "BSTH06-転醒X01(B)",
    quote: "この効果はスピリット/アルティメットの効果では防げない。",
    kind: "not",
    field: "categories",
    values: ["spirit", "ultimate"],
  },
  {
    cardNo: "BSTH07-転醒X02(B)",
    quote: "系統：「星蓮」/「闘神」を持たない効果では防げない。",
    kind: "only",
    field: "tribes",
    values: ["星蓮", "闘神"],
  },
  {
    cardNo: "BSTH08-C06",
    quote: "この効果は系統：「起幻」を持たない効果では防げない。",
    kind: "only",
    field: "tribes",
    values: ["起幻"],
  },
  {
    cardNo: "BSTH08-C07",
    quote: "この効果は系統：「起幻」を持たない効果では防げない。",
    kind: "only",
    field: "tribes",
    values: ["起幻"],
  },
  {
    cardNo: "BSTH08-X03",
    quote: "この効果は、【超重装甲】以外では防げない。",
    kind: "only",
    field: "keywords",
    values: ["超重装甲"],
  },
];

function fieldKey(kind: "only" | "not", field: PreventionField): string {
  const cap = field[0]!.toUpperCase() + field.slice(1);
  return `${kind}PreventableBy${cap}`;
}

describe("preventionRestriction: 原文の型→フィールドの型 横断分類 (P3-140)", () => {
  for (const expected of EXPECTED) {
    it(`${expected.cardNo}: 「${expected.quote}」は ${fieldKey(expected.kind, expected.field)}`, () => {
      const def = card(expected.cardNo);
      expect(def.textLines?.some((line) => line.includes(expected.quote))).toBe(
        true
      );
      const effect = def.effects?.find(
        (e) => e.preventionRestriction !== undefined
      );
      expect(effect).toBeDefined();
      const pr = effect!.preventionRestriction as Record<string, unknown>;
      const key = fieldKey(expected.kind, expected.field);
      expect(pr[key]).toEqual(expected.values);
      // 反対向きのフィールドが同時に立っていない（符号の取り違え防止）。
      const oppositeKey = fieldKey(
        expected.kind === "only" ? "not" : "only",
        expected.field
      );
      expect(pr[oppositeKey]).toBeUndefined();
    });
  }

  it("card-data 全件の preventionRestriction サイト総数が分類済みリストと一致する（新規カード分類漏れ検出）", () => {
    let total = 0;
    for (const def of expanded) {
      for (const effect of def.effects ?? []) {
        if (effect.preventionRestriction !== undefined) total++;
      }
    }
    expect(total).toBe(EXPECTED.length);
  });
});
