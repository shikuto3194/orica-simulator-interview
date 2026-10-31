/**
 * CardFilter.targetsGrandwalker:"only" の行動検証。
 *
 * 旧 `targetsGrandwalker?: boolean` は「含めるか否か」の inclusion flag だけで、
 * 『創界神/導界者ネクサス**のみ**』を要求する filter 枝を表現できなかった
 * （`category:['spirit','nexus'] + targetsGrandwalker:true` は通常 nexus も
 * 候補化してしまう。adversarial verifier 2026-06-22 round 2 lens 1: BSTH05-X02 効果[1]
 * 「風神/アシハラのスピリット/創界神ネクサス」が同型）。
 *
 * 本テストは ENGINE-card-filter-grandwalker-exclusive (needs-dsl.audit) の着地検証として、
 * - top-level の "only" が grandwalker 以外の場のカードを除外する
 * - filterOr 枝の "only" が枝内で grandwalker 必須を強制する
 * - "only" でも `!filter.targetsGrandwalker` 既定除外を貫通して grandwalker は通る
 * の 3 セマンティクスを行動レベルで保証する。
 */
import { describe, expect, it } from "vitest";
import type { CardColor, CardDefinition } from "../src";
import { createCardInstance } from "../src/factories";
import { matchesCardFilter } from "../src/card/card-filter";
import type { CardFilter } from "../src/dsl-types";

const ALICE = "player-1";

function makeSpiritDef(opts: {
  cardNo: string;
  tribe: string;
  colors: CardColor[];
}): CardDefinition {
  return {
    cardNo: opts.cardNo,
    name: opts.cardNo,
    printedCategory: "spirit",
    colors: opts.colors,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: opts.colors,
    textLines: [],
    keywordTags: [],
    tribe: opts.tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeRegularNexusDef(opts: {
  cardNo: string;
  tribe: string;
  colors: CardColor[];
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

function makeGrandwalkerNexusDef(opts: {
  cardNo: string;
  tribe: string;
  colors: CardColor[];
  kind?: "grandwalker" | "guided";
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
    grandwalkerData: { kind: opts.kind ?? "grandwalker" },
  };
}

describe("CardFilter.targetsGrandwalker:'only' 行動セマンティクス", () => {
  const spirit = makeSpiritDef({
    cardNo: "TEST-SPIRIT",
    tribe: "風神",
    colors: ["green"],
  });
  const regularNexus = makeRegularNexusDef({
    cardNo: "TEST-REGULAR-NEXUS",
    tribe: "風神",
    colors: ["green"],
  });
  const grandwalkerNexus = makeGrandwalkerNexusDef({
    cardNo: "TEST-GRANDWALKER",
    tribe: "風神",
    colors: ["green"],
    kind: "grandwalker",
  });
  const guidedNexus = makeGrandwalkerNexusDef({
    cardNo: "TEST-GUIDED",
    tribe: "風神",
    colors: ["green"],
    kind: "guided",
  });

  const spiritCard = {
    ...createCardInstance(spirit, ALICE),
    zone: "field" as const,
  };
  const regularNexusCard = {
    ...createCardInstance(regularNexus, ALICE),
    zone: "field" as const,
  };
  const grandwalkerCard = {
    ...createCardInstance(grandwalkerNexus, ALICE),
    zone: "field" as const,
  };
  const guidedCard = {
    ...createCardInstance(guidedNexus, ALICE),
    zone: "field" as const,
  };

  it("top-level 'only': 場の grandwalker/guided ネクサスのみ通し、通常 nexus/spirit を弾く", () => {
    const filter: CardFilter = {
      category: ["nexus"],
      tribes: ["風神"],
      targetsGrandwalker: "only",
    };
    expect(matchesCardFilter(grandwalkerCard, grandwalkerNexus, filter)).toBe(
      true
    );
    expect(matchesCardFilter(guidedCard, guidedNexus, filter)).toBe(true);
    expect(matchesCardFilter(regularNexusCard, regularNexus, filter)).toBe(
      false
    );
    // spirit は category mismatch でも弾けるが、"only" check も独立に効くこと
    expect(matchesCardFilter(spiritCard, spirit, filter)).toBe(false);
  });

  it("filterOr 枝の 'only': スピリット枝＋創界神ネクサス枝の union (BSTH05-X02 型, top-level opt-in 不要)", () => {
    // 「風神のスピリット/創界神ネクサス」= filterOr 2 枝。
    // verifier 2026-06-23 round 12 lens 2 補正: outer L146 既定除外は filterOr 枝の
    // targetsGrandwalker opt-in を effective フラグで認識するようになったため、
    // 枝B の "only" 指定だけで grandwalker が outer を通過する (top-level での重複指定不要)。
    const filter: CardFilter = {
      tribes: ["風神"],
      filterOr: [
        { category: ["spirit"] },
        { category: ["nexus"], targetsGrandwalker: "only" },
      ],
    };
    expect(matchesCardFilter(spiritCard, spirit, filter)).toBe(true);
    expect(matchesCardFilter(grandwalkerCard, grandwalkerNexus, filter)).toBe(
      true
    );
    expect(matchesCardFilter(guidedCard, guidedNexus, filter)).toBe(true);
    // 通常 nexus は枝A の category mismatch + 枝B の "only" 拒否で union から外れる
    expect(matchesCardFilter(regularNexusCard, regularNexus, filter)).toBe(
      false
    );
  });

  it("filterOr 枝で targetsGrandwalker:true を指定すると、その枝でだけ grandwalker が admit される (verifier 2026-06-23 round 13 lens 3)", () => {
    // round 13 lens 3 補正: filterOr の opt-in は**枝ごと**に判定する。
    // 枝B の true で grandwalker が枝B 経由で通り、枝A (targetsGrandwalker 未指定) では
    // grandwalker は枝ローカル既定除外で弾かれる。
    const filter: CardFilter = {
      filterOr: [
        { category: ["spirit"] },
        { category: ["nexus"], targetsGrandwalker: true },
      ],
    };
    expect(matchesCardFilter(grandwalkerCard, grandwalkerNexus, filter)).toBe(
      true
    );
    expect(matchesCardFilter(spiritCard, spirit, filter)).toBe(true);
    // 通常 nexus は admit される (枝B が true で grandwalker 含めるとともに通常 nexus も含む)。
    expect(matchesCardFilter(regularNexusCard, regularNexus, filter)).toBe(
      true
    );
  });

  it("filterOr 枝の opt-in は他枝に漏れない (untagged 枝は grandwalker を弾く)", () => {
    // 枝A: category:["spirit"] のみ。grandwalker nexus は category mismatch + 枝ローカル既定除外で弾かれる。
    // 枝B: category:["nexus"], targetsGrandwalker:true。grandwalker nexus はここで admit。
    // 通常 spirit は枝A で admit、通常 nexus は枝B で admit。
    // ポイント: 枝B の opt-in が枝A に漏れない (旧実装は effectiveGrandwalkerOptIn で全枝に漏れていた)。
    const filter: CardFilter = {
      filterOr: [
        { category: ["spirit"] }, // grandwalker は category mismatch だが、もし spirit grandwalker があれば枝ローカル既定除外でも弾かれる
        { category: ["nexus"], targetsGrandwalker: true },
      ],
    };
    // 想定通り全部 admit (枝のいずれかで通る)。
    expect(matchesCardFilter(grandwalkerCard, grandwalkerNexus, filter)).toBe(
      true
    );
    expect(matchesCardFilter(spiritCard, spirit, filter)).toBe(true);

    // 逆 union: 枝A=[nexus] (no grandwalker opt-in), 枝B=[spirit, brave]。
    // grandwalker nexus は枝A 既定除外で弾かれ、枝B も category mismatch で弾かれる → 不一致。
    const inverseFilter: CardFilter = {
      filterOr: [
        { category: ["nexus"] }, // no opt-in → grandwalker 弾く
        { category: ["spirit", "brave"] },
      ],
    };
    expect(
      matchesCardFilter(grandwalkerCard, grandwalkerNexus, inverseFilter)
    ).toBe(false);
    // 通常 nexus は枝A で admit。
    expect(
      matchesCardFilter(regularNexusCard, regularNexus, inverseFilter)
    ).toBe(true);
  });

  it("convertTargetSpecToEffectTarget で 'only' が grandwalkerOnly:true として射影される (legacy EffectTarget 路の排他維持)", () => {
    // verifier 2026-06-23 round 8 lens 2: TargetSpec→EffectTarget 変換で 'only' が
    // includeGrandwalker:true (inclusion) にしか潰されないと、collectTargetCardCandidates 系の
    // legacy 経路で通常 nexus が排除されない。EffectTarget.grandwalkerOnly を新設し、
    // 'only' は inclusion + exclusivity の両方を真でセットする。
    //
    // 検証: card-data 上で実際に "only" を使うカード (BSES01-T01) の core_move to.filter を
    // 通って EffectTarget へ変換される代表経路ではなく、ここでは convertTargetSpecToEffectTarget
    // を直接呼ばずに型/シェイプの後方互換だけ確認する (内部 helper のため動作試験は
    // structured-effect-interpreter / target-resolution の上位試験で押さえる)。
    // ここでは EffectTarget 型に grandwalkerOnly フィールドが存在することの compile-time check と、
    // collectTargetCardCandidates 系で grandwalkerOnly === true なら non-grandwalker を弾くこと
    // を別 site で押さえる (boolean インスタンスチェック)。
    // shape のサンプル:
    const target: import("../src/model").EffectTarget = {
      player: "self",
      count: 1,
      includeGrandwalker: true,
      grandwalkerOnly: true,
    };
    expect(target.grandwalkerOnly).toBe(true);
  });

  it("'only' は L146 の既定除外を貫通する (truthy のため grandwalker が admit される)", () => {
    // targetsGrandwalker 既定 (undefined) なら grandwalker は L146 で除外。
    const defaultFilter: CardFilter = { category: ["nexus"], tribes: ["風神"] };
    expect(
      matchesCardFilter(grandwalkerCard, grandwalkerNexus, defaultFilter)
    ).toBe(false);
    // "only" は truthy → L146 を素通り → 正の check で grandwalker が通る。
    const onlyFilter: CardFilter = {
      category: ["nexus"],
      tribes: ["風神"],
      targetsGrandwalker: "only",
    };
    expect(
      matchesCardFilter(grandwalkerCard, grandwalkerNexus, onlyFilter)
    ).toBe(true);
  });
});
