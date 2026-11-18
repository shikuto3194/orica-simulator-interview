/**
 * 系統 AND フィルタ（「系統：「A」と「B」を持つ」）の印字テキスト ↔ DSL 整合ガード。
 *
 * `CardFilter.tribes` は既定 OR（いずれか1つを持てば一致）。印字テキストの
 *   - 「系統：「A」と「B」を持つ」        = AND（両方必須）
 *   - 「系統：「A」/「B」を持つ」          = OR（いずれか）
 *   - 「系統：「A」と「B」/「C」を持つ」   = AND(A, OR(B,C)) → tribesRequired:[A] + tribes:[B,C]
 * を DSL 化するとき、AND なのに `tribes:[A,B]` とだけ書くと **型が通ったまま OR に化ける**。
 * 実例: BSTH04-C01/C02「系統：「幻想」と「起幻」を持つ黄/紫のカード1枚」が
 * `tribesLogic` 欠落で「幻想 または 起幻」になり、片方しか持たないカードまで
 * デッキオープンの選択候補に出ていた（同型の正実装が BSTH03-C04/BSTH07-C01 等に存在）。
 *
 * 印字テキストと DSL の乖離は型でも単体テストでも検出できないため、全カードを
 * 走査する機械ガードで止める（`.claude/rules/card-data.md` の allowlist 漏れ対策と同型）。
 *
 * 判定は「AND/OR グループの系統集合と `tribes` 配列が**完全一致**するノード」だけを
 * 対象にする。部分集合まで拾うと、AND(幻想, OR(導魔,動玩)) を tribesRequired + tribes に
 * 分解した正しい実装（BSTH01-C21 / BSTH02.7-R01 等）や、同一カード内の別テキスト行に
 * 由来する OR フィルタを誤検知するため。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { matchesCardFilter } from "../src/card/card-filter";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardFilter, Effect } from "../src/dsl-types";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "player-1";

// ============================================================
// 印字テキストからの系統グループ抽出
// ============================================================

/**
 * AND 表現。「と」区切り（「系統：「幻想」と「起幻」」）と「・」区切り
 * （「系統：「地球」・「ＣＦ」」= 複合系統表記＝両方を持つ）を拾う。
 */
function extractAndTribeGroups(text: string): string[][] {
  const groups: string[][] = [];
  const re = /系統\s*[：:]\s*((?:「[^」]+」)(?:\s*[と・]\s*「[^」]+」)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    groups.push([...m[1]!.matchAll(/「([^」]+)」/g)].map((x) => x[1]!));
  }
  return groups;
}

/** OR 表現。「/」「／」区切り（「系統：「鍵」/「星霊」」）。 */
function extractOrTribeGroups(text: string): string[][] {
  const groups: string[][] = [];
  const re = /系統\s*[：:]\s*((?:「[^」]+」)(?:\s*[/／]\s*「[^」]+」)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    groups.push([...m[1]!.matchAll(/「([^」]+)」/g)].map((x) => x[1]!));
  }
  return groups;
}

// ============================================================
// カード定義からの tribes ノード収集
// ============================================================

type TribeNode = {
  path: string;
  tribes: string[];
  tribesLogic?: "and" | "or";
};

/**
 * `tribes: string[]` を持つノードを再帰収集する。
 *
 * `statBlueprint` 配下は除外する。あちらは分身スピリットへ**付与する**系統の定義
 * （「系統：「地球」・「ＣＦ」の黄の分身スピリットとして扱う」BSAZ01-C12 等）で、
 * フィルタではないため AND/OR の概念を持たない。
 */
function collectFilterTribeNodes(
  node: unknown,
  path: string,
  out: TribeNode[],
  seen: Set<object> = new Set()
): void {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (path.includes("statBlueprint")) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) =>
      collectFilterTribeNodes(v, `${path}[${i}]`, out, seen)
    );
    return;
  }
  const rec = node as Record<string, unknown>;
  if (
    Array.isArray(rec.tribes) &&
    rec.tribes.length > 1 &&
    rec.tribes.every((t) => typeof t === "string")
  ) {
    out.push({
      path,
      tribes: rec.tribes as string[],
      ...(rec.tribesLogic === "and" || rec.tribesLogic === "or"
        ? { tribesLogic: rec.tribesLogic }
        : {}),
    });
  }
  for (const [k, v] of Object.entries(rec)) {
    collectFilterTribeNodes(v, `${path}.${k}`, out, seen);
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

type Violation = {
  cardNo: string;
  path: string;
  tribes: string[];
  text: string;
};

function collectViolations(): { andAsOr: Violation[]; orAsAnd: Violation[] } {
  const andAsOr: Violation[] = [];
  const orAsAnd: Violation[] = [];
  for (const def of ALL_CARDS) {
    const text = [
      ...(def.textLines ?? []),
      ...(def.backFace?.textLines ?? []),
    ].join("\n");
    const andGroups = extractAndTribeGroups(text);
    const orGroups = extractOrTribeGroups(text);
    if (andGroups.length === 0 && orGroups.length === 0) continue;
    const nodes: TribeNode[] = [];
    collectFilterTribeNodes(def, "card", nodes);
    for (const node of nodes) {
      if (
        andGroups.some((g) => sameSet(g, node.tribes)) &&
        node.tribesLogic !== "and"
      ) {
        andAsOr.push({
          cardNo: def.cardNo,
          path: node.path,
          tribes: node.tribes,
          text: `系統：「${node.tribes.join("」と「")}」`,
        });
      }
      if (
        orGroups.some((g) => sameSet(g, node.tribes)) &&
        node.tribesLogic === "and"
      ) {
        orAsAnd.push({
          cardNo: def.cardNo,
          path: node.path,
          tribes: node.tribes,
          text: `系統：「${node.tribes.join("」/「")}」`,
        });
      }
    }
  }
  return { andAsOr, orAsAnd };
}

describe("系統 AND フィルタ: 印字テキストと DSL の整合（全カード機械ガード）", () => {
  it("「系統：「A」と「B」を持つ」を tribes 既定 OR のまま書いたカードが無い", () => {
    const { andAsOr } = collectViolations();
    expect(
      andAsOr.map(
        (v) => `${v.cardNo} ${v.path}: ${v.text} が tribesLogic:"and" 未指定`
      )
    ).toEqual([]);
  });

  it('「系統：「A」/「B」を持つ」を tribesLogic:"and" にしたカードが無い', () => {
    const { orAsAnd } = collectViolations();
    expect(
      orAsAnd.map(
        (v) => `${v.cardNo} ${v.path}: ${v.text} が tribesLogic:"and" 指定`
      )
    ).toEqual([]);
  });
});

// ============================================================
// BSTH04-C01/C02 行動検証
// ============================================================

/**
 * 召喚時 deck_reveal の「系統：「幻想」と「起幻」を持つ黄/紫のカード1枚」pick を取り出す。
 * picks[0] は導界者ネクサス pick（category:["nexus"]）なので category 指定の無い方を選ぶ。
 */
function pickTribeAndFilter(cardNo: string): CardFilter {
  const def = card(cardNo);
  for (const eff of def.effects ?? []) {
    for (const step of eff.steps ?? []) {
      const action = step.action as { kind?: string } | undefined;
      if (action?.kind !== "deck_reveal") continue;
      const picks =
        (action as { picks?: { filter?: CardFilter }[] }).picks ?? [];
      for (const p of picks) {
        if (p.filter && p.filter.category === undefined && p.filter.tribes) {
          return p.filter;
        }
      }
    }
  }
  throw new Error(`no deck_reveal tribe-AND pick filter found for ${cardNo}`);
}

function makeCardDef(opts: {
  cardNo: string;
  tribe: string;
  colors: ("red" | "blue" | "green" | "yellow" | "white" | "purple")[];
}): CardDefinition {
  return {
    cardNo: opts.cardNo,
    name: opts.cardNo,
    printedCategory: "spirit",
    colors: opts.colors,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: opts.colors,
    textLines: [],
    keywordTags: [],
    tribe: opts.tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function matches(filter: CardFilter, def: CardDefinition): boolean {
  const inst = createCardInstance(def, {
    instanceId: `inst-${def.cardNo}`,
    ownerPlayerId: ALICE,
    zone: "deck",
  });
  return matchesCardFilter(inst, def, filter);
}

describe.each(["BSTH04-C01", "BSTH04-C02"])(
  "%s 召喚時 deck_reveal: 「系統：「幻想」と「起幻」を持つ黄/紫のカード」",
  (cardNo) => {
    it("「幻想」「起幻」を両方持つ黄のカードは候補になる", () => {
      const filter = pickTribeAndFilter(cardNo);
      expect(
        matches(
          filter,
          makeCardDef({
            cardNo: `TEST-BOTH-${cardNo}`,
            tribe: "起幻・幻想・冥主",
            colors: ["yellow"],
          })
        )
      ).toBe(true);
    });

    it("「幻想」しか持たない黄のカードは候補にならない（既定 OR ならバグ再現）", () => {
      const filter = pickTribeAndFilter(cardNo);
      expect(
        matches(
          filter,
          makeCardDef({
            cardNo: `TEST-ONLY-GENSOU-${cardNo}`,
            tribe: "幻想・冥主",
            colors: ["yellow"],
          })
        )
      ).toBe(false);
    });

    it("「起幻」しか持たない紫のカードは候補にならない（既定 OR ならバグ再現）", () => {
      const filter = pickTribeAndFilter(cardNo);
      expect(
        matches(
          filter,
          makeCardDef({
            cardNo: `TEST-ONLY-KIGEN-${cardNo}`,
            tribe: "起幻・楽族",
            colors: ["purple"],
          })
        )
      ).toBe(false);
    });

    it("両系統を持っていても黄/紫でなければ候補にならない", () => {
      const filter = pickTribeAndFilter(cardNo);
      expect(
        matches(
          filter,
          makeCardDef({
            cardNo: `TEST-WRONG-COLOR-${cardNo}`,
            tribe: "起幻・幻想",
            colors: ["red"],
          })
        )
      ).toBe(false);
    });

    it('filter shape: tribes は ["幻想","起幻"] + tribesLogic:"and"', () => {
      const filter = pickTribeAndFilter(cardNo);
      expect(filter.tribes).toEqual(["幻想", "起幻"]);
      expect(filter.tribesLogic).toBe("and");
    });

    // 反証ガード: 上の「候補にならない」assert が tribesLogic のおかげで通っていることの証明。
    // tribesLogic を外すと matchesTribes は既定 OR に戻り、片系統のカードが一致してしまう
    // （= 修正前の実際の挙動）。この期待値が false になったら、AND 判定が別の条件
    // （色・カテゴリ等）で偶然通っているだけということになり、ガードが空振りしている。
    it("反証: tribesLogic を外すと「幻想」だけのカードが一致してしまう", () => {
      const { tribesLogic: _omitted, ...withoutLogic } =
        pickTribeAndFilter(cardNo);
      expect(
        matches(
          withoutLogic,
          makeCardDef({
            cardNo: `TEST-REGRESSION-${cardNo}`,
            tribe: "幻想・冥主",
            colors: ["yellow"],
          })
        )
      ).toBe(true);
    });
  }
);

// ============================================================
// DSL → v1 native action 射影で系統 AND 条件が落ちないこと
// ============================================================

/**
 * `discard` / `reveal_hand` / summon zone filter は DSL の `CardFilter` を
 * v1 native action の `filter` へ渡す。かつては category/colors/tribes/hasBurstEffect
 * を**列挙コピー**していたため、`tribesLogic` / `tribesRequired` が黙って落ちていた
 * （候補列挙は `matchesCardFilter` SSOT に丸ごと流すので、射影さえ保てば AND が効く）。
 *
 * 印字テキスト側のガード（上の全カード監査）は card-data の書き方しか見ないため、
 * 「DSL は正しいのにエンジンの射影で落ちる」層は捕まえられない。ここは効果を実際に
 * 実行し、手札の破棄候補が AND で絞られる**盤面変化**で担保する。
 */
const HAND_TRIBE_CASES = [
  { id: "both", tribe: "幻想・起幻", shouldMatch: true },
  { id: "only-gensou", tribe: "幻想・冥主", shouldMatch: false },
  { id: "only-kigen", tribe: "起幻・楽族", shouldMatch: false },
];

function makeDiscardSourceDef(filter: CardFilter): CardDefinition {
  const effect: Effect = {
    timing: { kind: "card_event", event: "summon" },
    steps: [{ action: { kind: "discard", count: 1, player: "self", filter } }],
  } as Effect;
  return {
    cardNo: "TEST-DISCARD-SOURCE",
    name: "TEST-DISCARD-SOURCE",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "幻想",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [effect],
  };
}

function runDiscardWithFilter(filter: CardFilter): {
  state: GameState;
  defs: Map<string, CardDefinition>;
} {
  const sourceDef = makeDiscardSourceDef(filter);
  const handDefs = HAND_TRIBE_CASES.map((c) =>
    makeCardDef({
      cardNo: `TEST-HAND-${c.id}`,
      tribe: c.tribe,
      colors: ["yellow"],
    })
  );
  const defs = new Map<string, CardDefinition>(
    [sourceDef, ...handDefs].map((d) => [d.cardNo, d])
  );
  const source = createCardInstance(sourceDef, {
    instanceId: "discard-source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const hand = handDefs.map((d) =>
    createCardInstance(d, {
      instanceId: `hand-${d.cardNo}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    })
  );
  const base = createEmptyGameState({
    playerIds: [ALICE, "player-2"],
    cardInstances: [source, ...hand],
  });
  const state = executeEffect({
    chainId: "test:tribe-and-filter-text-integrity:416",
    state: { ...base, activePlayerId: ALICE, step: "main" },
    effect: sourceDef.effects![0]!,
    sourceInstanceId: "discard-source",
    actingPlayerId: ALICE,
    getCardDefinitionById: (id) => defs.get(id),
    getRegisteredTriggeredEffectActions: () => [],
  });
  return { state, defs };
}

/** 破棄選択の候補 instanceId（pending が立たず即破棄された場合は trash 行きを見る）。 */
function discardCandidateIds(state: GameState): string[] {
  const pending = state.pendingZoneSelection;
  if (pending) return [...pending.candidateCardInstanceIds].sort();
  return state.cardInstances
    .filter((c) => c.zone === "trash")
    .map((c) => c.instanceId)
    .sort();
}

describe("DSL→v1 射影: discard の filter が系統 AND を保持する", () => {
  it('tribesLogic:"and" のとき両系統を持つ手札だけが破棄候補になる', () => {
    const { state } = runDiscardWithFilter({
      tribes: ["幻想", "起幻"],
      tribesLogic: "and",
    });
    expect(discardCandidateIds(state)).toEqual(["hand-TEST-HAND-both"]);
  });

  // 反証ガード: 射影が tribesLogic を落とすと既定 OR に戻り、3枚とも候補になる。
  // この期待値が上と同じになったら、AND が別要因で偶然絞れているだけということになる。
  it("tribesLogic 省略時（既定 OR）はいずれかの系統を持つ手札すべてが候補になる", () => {
    const { state } = runDiscardWithFilter({ tribes: ["幻想", "起幻"] });
    expect(discardCandidateIds(state)).toEqual([
      "hand-TEST-HAND-both",
      "hand-TEST-HAND-only-gensou",
      "hand-TEST-HAND-only-kigen",
    ]);
  });

  it("tribesRequired（AND 必須系統）も射影で落ちない", () => {
    const { state } = runDiscardWithFilter({
      tribesRequired: ["幻想", "起幻"],
    });
    expect(discardCandidateIds(state)).toEqual(["hand-TEST-HAND-both"]);
  });
});
