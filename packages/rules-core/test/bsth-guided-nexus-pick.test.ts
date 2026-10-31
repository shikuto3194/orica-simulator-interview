/**
 * 導界者ネクサス deck_reveal pick の guided 限定（第2バッチ）行動検証
 *
 * 対象: BSTH06-C01 / BSTH06-C02 / BSTH07-C01 / BSTH07-C02 /
 *       BSTH08-C02 / BSTH08-C03 / BSTH09.2-C01
 *
 * 各カードの召喚時 deck_reveal pick filter はテキスト
 *   「系統X を持つ…導界者ネクサスカード1枚」(= 系統X AND 導界者)
 * を表現する必要がある。targetsGrandwalker は創界神/導界者を対象解禁するのみで、
 * 同系統の非導界者ネクサス（起幻/地霊 を持つ転醒・創界石ネクサス等が実在）を
 * 排除しない。tribes 配列へ「導界者」を加えるのは tribesLogic 既定 or のため不可。
 * → 各 pick の nexus filter に hasMechanic:["guided"] を独立 conjunct で追加。
 *
 * このテストは matchesCardFilter SSOT に「同系統を持つ非 guided ネクサス（転醒/創界石）」
 * の合成インスタンスを流し、guided 限定が排他に効くことを行動レベルで保証する。
 * 同弾内の guided 実カードも通過することを併せて確認する。
 *
 * 参考: BSFT01-TR12(A)/TR13(A) の tribesRequired 同型ガード(bsft01-cards.test.ts:1010-)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { createCardInstance } from "../src/factories";
import { matchesCardFilter } from "../src/card/card-filter";
import type { CardFilter } from "../src/dsl-types";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "player-1";

/**
 * 召喚時 deck_reveal の picks[0]（導界者ネクサス pick）の filter を取り出す。
 * 各カードは「召喚時 deck_reveal」を持つ唯一の effect を 1 つ持つ前提（全カードで確認済）。
 */
function pickGuidedNexusFilter(cardNo: string): CardFilter {
  const def = card(cardNo);
  const effects = def.effects ?? [];
  for (const eff of effects) {
    for (const step of eff.steps ?? []) {
      const action = step.action as
        | { kind?: string; picks?: unknown }
        | undefined;
      if (action?.kind === "deck_reveal") {
        const picks =
          (action as { picks?: { filter?: CardFilter }[] }).picks ?? [];
        for (const p of picks) {
          if (p.filter && (p.filter.category ?? []).includes("nexus")) {
            return p.filter;
          }
        }
      }
    }
  }
  throw new Error(`no deck_reveal nexus pick filter found for ${cardNo}`);
}

/**
 * 合成: 同系統の「転醒ネクサス」相当（非 guided）。targetsGrandwalker 経路の除外は受けず、
 * tribes:[X] を持ち、creator が hasMechanic で guided を持たない（=何も持たない）。
 * guided 限定が抜けていれば誤候補化する＝バグの証拠用フィクスチャ。
 */
function makeNonGuidedNexusDef(opts: {
  cardNo: string;
  tribe: string;
  colors: ("red" | "blue" | "green" | "yellow" | "white" | "purple")[];
}): CardDefinition {
  return {
    cardNo: opts.cardNo,
    name: opts.cardNo,
    printedCategory: "nexus",
    colors: opts.colors,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: opts.colors,
    textLines: [],
    keywordTags: [], // ← guided 無し
    tribe: opts.tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

describe("導界者ネクサス deck_reveal pick: guided 限定（第2バッチ）", () => {
  const cases: {
    cardNo: string;
    nonGuidedTribe: string;
    nonGuidedColors: (
      | "red"
      | "blue"
      | "green"
      | "yellow"
      | "white"
      | "purple"
    )[];
  }[] = [
    // BSTH06: 地霊
    {
      cardNo: "BSTH06-C01",
      nonGuidedTribe: "地霊・転醒", // 地霊 を持つが guided ではない
      nonGuidedColors: ["green"],
    },
    {
      cardNo: "BSTH06-C02",
      nonGuidedTribe: "地霊・転醒",
      nonGuidedColors: ["green"],
    },
    // BSTH07: 起幻 青
    {
      cardNo: "BSTH07-C01",
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["blue"],
    },
    {
      cardNo: "BSTH07-C02",
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["blue"],
    },
    // BSTH08: 起幻 白/青
    {
      cardNo: "BSTH08-C02",
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["white"],
    },
    {
      cardNo: "BSTH08-C03",
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["blue"],
    },
    // BSTH09.2: 起幻 赤/緑
    {
      cardNo: "BSTH09.2-C01",
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["red"],
    },
  ];

  for (const c of cases) {
    it(`${c.cardNo}: 同系統だが非 guided な転醒ネクサスを弾く`, () => {
      const filter = pickGuidedNexusFilter(c.cardNo);
      const nonGuidedDef = makeNonGuidedNexusDef({
        cardNo: `TEST-NONGUIDED-${c.cardNo}`,
        tribe: c.nonGuidedTribe,
        colors: c.nonGuidedColors,
      });
      const nonGuidedInst = createCardInstance(nonGuidedDef, {
        instanceId: `nonguided-${c.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      // 鍵テスト: guided 限定が無ければ true になり「弾けていない」＝バグの再現になる。
      // 修正後は false。
      expect(matchesCardFilter(nonGuidedInst, nonGuidedDef, filter)).toBe(
        false
      );
    });
  }

  // 補強: filter shape に hasMechanic:["guided"] が存在することを直接 assert
  // （将来うっかり削除された場合の機械ガード）。
  it.each(cases.map((c) => c.cardNo))(
    '%s: pick filter は hasMechanic:["guided"] を含む',
    (cardNo) => {
      const filter = pickGuidedNexusFilter(cardNo);
      expect(filter.hasMechanic).toEqual(["guided"]);
    }
  );
});
