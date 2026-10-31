/**
 * 導界者/創界神ネクサス限定の filter 修正（第3バッチ・MULTI 監査）行動検証
 *
 * 対象: BSTH04-C01 / BSTH04-C02 / BSTH003-C01 / BSTH003-C02 / BSTH003-R01 /
 *       BSTH003-X04 / BSTH07-X01 / BSSG01-M03 / BSSG01-M04 /
 *       BSTH003-X05（[夢時空]霧雨魔梨沙: field_has 内 grandwalkerKind）
 *
 * 各カードのテキストは「導界者ネクサス」または「創界神ネクサス」と明示限定するが、
 * CardFilter が `category:[nexus] + targetsGrandwalker:true` のみ（または
 * tribesLogic 既定 or で 'X OR 導界者' になっていた）。これでは同系統の非導界者
 * ネクサス（転醒/創界石）・別カテゴリの grandwalker（創界神 ↔ 導界者）まで
 * 候補化してしまう。
 *
 * 修正方針（card-filter SSOT に従う独立 AND conjunct）:
 *   - 導界者限定: `hasMechanic: ["guided"]`
 *   - 創界神限定: `tribes: ["創界神"]`（実在 tribe 文字列との一致）
 *   - field_has 条件は `hasMechanic` を持たないので `grandwalkerKind: "guided"`
 *     を独立指定（[夢時空]霧雨魔梨沙）
 *
 * このテストは matchesCardFilter SSOT に「同系統を持つ非 guided ネクサス」または
 * 「導界者ネクサス（創界神限定の効果に対して）」を流し、限定が排他に効くことを
 * 行動レベルで保証する。同時に filter shape の機械ガードも実施。
 *
 * 参考: bsth-guided-nexus-pick.test.ts（第2バッチ deck_reveal 専用版）。
 *
 * P3-137 (2026-08-04) 補正: 下記 BSSG01-M03/M04 の `tribes:["創界神"]` 排他は
 * 10_rules/07:62-67 の一般化裁定 (2026-08-02、作用系は導界者ネクサスも受ける) により
 * 誤りと判明。両カードは destroy/core_move (作用系) であり、導界者ネクサスも対象に
 * 含めるべき。`targetsGrandwalker:"only"` へ置換し、以降のテストは「導界者ネクサスを
 * 対象に含める」ことを検証する（旧「弾く」アサーションは反転）。
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

type ActionLike = {
  kind?: string;
  picks?: { filter?: CardFilter }[];
  filter?: CardFilter;
  from?: { filter?: CardFilter };
  to?: { filter?: CardFilter };
  target?: { filter?: CardFilter };
};

/**
 * カードの effects[].steps[].action ツリーを辿り、述語に一致する CardFilter を返す。
 * テスト対象の特定効果が 1 つしかない前提のヘルパ。
 */
function findFilter(
  cardNo: string,
  pred: (a: ActionLike, filter: CardFilter) => boolean
): CardFilter {
  const def = card(cardNo);
  const effects = def.effects ?? [];
  for (const eff of effects) {
    for (const step of eff.steps ?? []) {
      const action = step.action as ActionLike;
      // search candidate filters
      const candidates: { f: CardFilter; tag: string }[] = [];
      if (action?.picks) {
        for (const p of action.picks) {
          if (p.filter) candidates.push({ f: p.filter, tag: "pick" });
        }
      }
      if (action?.filter) candidates.push({ f: action.filter, tag: "action" });
      if (action?.from?.filter)
        candidates.push({ f: action.from.filter, tag: "from" });
      if (action?.to?.filter)
        candidates.push({ f: action.to.filter, tag: "to" });
      if (action?.target?.filter)
        candidates.push({ f: action.target.filter, tag: "target" });
      for (const c of candidates) {
        if (pred(action, c.f)) return c.f;
      }
    }
  }
  throw new Error(`no matching filter found for ${cardNo}`);
}

/** 同系統の「転醒/創界石ネクサス」相当（非 guided/非 grandwalker）。 */
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
    keywordTags: [],
    tribe: opts.tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/** guided 導界者ネクサス（grandwalkerData.kind = "guided"）合成。 */
function makeGuidedNexusDef(opts: {
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
    keywordTags: [],
    tribe: opts.tribe,
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: { kind: "guided" },
  };
}

describe("導界者ネクサス deck_reveal/search/distribute pick: hasMechanic guided 限定（第3バッチ）", () => {
  const cases: {
    cardNo: string;
    findGuidedFilter: () => CardFilter;
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
    {
      // BSTH04-C01 召喚時 deck_reveal: 系統「起幻」黄/紫 導界者ネクサス
      cardNo: "BSTH04-C01",
      findGuidedFilter: () =>
        findFilter(
          "BSTH04-C01",
          (a, f) =>
            a.kind === "deck_reveal" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("起幻")
        ),
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      cardNo: "BSTH04-C02",
      findGuidedFilter: () =>
        findFilter(
          "BSTH04-C02",
          (a, f) =>
            a.kind === "deck_reveal" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("起幻")
        ),
      nonGuidedTribe: "起幻・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      // BSTH003-C01 召喚時 deck_reveal: 系統 導魔/秘封 導界者ネクサス
      cardNo: "BSTH003-C01",
      findGuidedFilter: () =>
        findFilter(
          "BSTH003-C01",
          (a, f) =>
            a.kind === "deck_reveal" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("導魔")
        ),
      nonGuidedTribe: "導魔・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      cardNo: "BSTH003-C02",
      findGuidedFilter: () =>
        findFilter(
          "BSTH003-C02",
          (a, f) =>
            a.kind === "deck_reveal" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("導魔")
        ),
      nonGuidedTribe: "導魔・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      // BSTH003-R01 search_zone trash: 系統 導魔 導界者ネクサス
      cardNo: "BSTH003-R01",
      findGuidedFilter: () =>
        findFilter(
          "BSTH003-R01",
          (a, f) =>
            a.kind === "search_zone" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("導魔")
        ),
      nonGuidedTribe: "導魔・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      // BSTH003-X04 core_move target: 系統 導魔/秘封 導界者ネクサスへ各3個。
      cardNo: "BSTH003-X04",
      findGuidedFilter: () =>
        findFilter(
          "BSTH003-X04",
          (a, f) =>
            a.kind === "core_move" &&
            (f.category ?? []).includes("nexus") &&
            (f.tribes ?? []).includes("導魔")
        ),
      nonGuidedTribe: "導魔・転醒",
      nonGuidedColors: ["yellow"],
    },
    {
      // BSTH07-X01 symbol_add filterOr nexus 部: 系統 星蓮/闘神 導界者ネクサス
      cardNo: "BSTH07-X01",
      findGuidedFilter: () => {
        const def = card("BSTH07-X01");
        for (const eff of def.effects ?? []) {
          for (const step of eff.steps ?? []) {
            const action = step.action as ActionLike & {
              target?: { filter?: { filterOr?: CardFilter[] } };
            };
            const orList = action.target?.filter?.filterOr;
            if (orList) {
              for (const f of orList) {
                if (
                  (f.category ?? []).includes("nexus") &&
                  (f.tribes ?? []).includes("星蓮")
                ) {
                  return f;
                }
              }
            }
          }
        }
        throw new Error("BSTH07-X01: filterOr nexus 部が見つからない");
      },
      nonGuidedTribe: "星蓮・転醒",
      nonGuidedColors: ["yellow"],
    },
  ];

  for (const c of cases) {
    it(`${c.cardNo}: 同系統だが非 guided な転醒/創界石ネクサスを弾く`, () => {
      const filter = c.findGuidedFilter();
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
      expect(matchesCardFilter(nonGuidedInst, nonGuidedDef, filter)).toBe(
        false
      );
    });

    it(`${c.cardNo}: guided 限定が無ければ candidate 化される（バグ再現フィクスチャ）`, () => {
      const filter = c.findGuidedFilter();
      // 想定: filter.hasMechanic に "guided" が含まれる。
      // 仮にこれを削除した shape では同系統 nonGuided が通過する＝バグ再現になる。
      const withoutGuided: CardFilter = { ...filter };
      delete withoutGuided.hasMechanic;
      const nonGuidedDef = makeNonGuidedNexusDef({
        cardNo: `TEST-NONGUIDED2-${c.cardNo}`,
        tribe: c.nonGuidedTribe,
        colors: c.nonGuidedColors,
      });
      const nonGuidedInst = createCardInstance(nonGuidedDef, {
        instanceId: `nonguided2-${c.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      expect(
        matchesCardFilter(nonGuidedInst, nonGuidedDef, withoutGuided)
      ).toBe(true);
    });

    it(`${c.cardNo}: filter は hasMechanic:["guided"] を含む`, () => {
      const filter = c.findGuidedFilter();
      expect(filter.hasMechanic).toEqual(["guided"]);
    });
  }
});

describe("創界神ネクサス filter: targetsGrandwalker:only（BSSG01-M03 / BSSG01-M04、P3-137補正）", () => {
  // BSSG01-M03 [8,9] destroy: 相手の創界神ネクサス1つ（作用系→導界者ネクサスも含む）
  it("BSSG01-M03: 導界者ネクサス（tribes に 創界神 を含まない grandwalker 相当）も対象に含める", () => {
    const filter = findFilter(
      "BSSG01-M03",
      (a, f) => a.kind === "destroy" && (f.category ?? []).includes("nexus")
    );
    const guidedDef = makeGuidedNexusDef({
      cardNo: "TEST-GUIDED-FOR-BSSG01-M03",
      tribe: "導界者・起幻",
      colors: ["yellow"],
    });
    const guidedInst = createCardInstance(guidedDef, {
      instanceId: "guided-bssg01-m03",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    expect(matchesCardFilter(guidedInst, guidedDef, filter)).toBe(true);
  });

  it("BSSG01-M03: filter は targetsGrandwalker:'only' のみで tribes を持たない", () => {
    const filter = findFilter(
      "BSSG01-M03",
      (a, f) => a.kind === "destroy" && (f.category ?? []).includes("nexus")
    );
    expect(filter.targetsGrandwalker).toBe("only");
    expect(filter.tribes).toBeUndefined();
  });

  // BSSG01-M04 [5,6] core_move from field_card: 相手の創界神ネクサスのコア3個
  it("BSSG01-M04: 導界者ネクサスソースも対象に含める（コア源 filter）", () => {
    const filter = findFilter(
      "BSSG01-M04",
      (a, f) => a.kind === "core_move" && (f.category ?? []).includes("nexus")
    );
    const guidedDef = makeGuidedNexusDef({
      cardNo: "TEST-GUIDED-FOR-BSSG01-M04",
      tribe: "導界者・起幻",
      colors: ["yellow"],
    });
    const guidedInst = createCardInstance(guidedDef, {
      instanceId: "guided-bssg01-m04",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    expect(matchesCardFilter(guidedInst, guidedDef, filter)).toBe(true);
  });

  it("BSSG01-M04: コア源 filter は targetsGrandwalker:'only' のみで tribes を持たない", () => {
    const filter = findFilter(
      "BSSG01-M04",
      (a, f) => a.kind === "core_move" && (f.category ?? []).includes("nexus")
    );
    expect(filter.targetsGrandwalker).toBe("only");
    expect(filter.tribes).toBeUndefined();
  });
});

describe("[夢時空]霧雨 魔梨沙 field_has: grandwalkerKind guided 限定", () => {
  it("BSTH003-X02: 導魔の field_has condition は grandwalkerKind:'guided' を持つ", () => {
    const def = card("BSTH003-X02");
    const effects = def.effects ?? [];
    let found = false;
    for (const eff of effects) {
      const cond = eff.condition ?? [];
      for (const c of cond) {
        if (
          c.kind === "field_has" &&
          (c.tribes ?? []).includes("導魔") &&
          (c.category ?? []).includes("nexus")
        ) {
          found = true;
          expect(c.grandwalkerKind).toBe("guided");
        }
      }
    }
    expect(found).toBe(true);
  });
});
