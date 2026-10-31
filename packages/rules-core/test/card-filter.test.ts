import { describe, it, expect } from "vitest";
import {
  matchesCardFilter,
  cardHasPrintedEffectText,
  isCardDefinitionToken,
  resolveSelfCountThreshold,
  getSelfCountThresholdValue,
} from "../src/card/card-filter";
import { createCardInstance } from "../src/factories";
import { createEmptyGameState } from "../src/factories";
import { getTotalCoresOnCardById } from "../src/core/core-system";
import type { BattleEntity, CardDefinition, CardInstance } from "../src/model";
import type { CardFilter } from "../src/dsl-types";

// ============================================================
// テスト用ヘルパー
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

// ============================================================
// テストケース
// ============================================================

describe("matchesCardFilter", () => {
  describe("category", () => {
    it("カテゴリ一致", () => {
      const def = makeDef({ printedCategory: "spirit" });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { category: ["spirit"] })).toBe(true);
      expect(matchesCardFilter(card, def, { category: ["nexus"] })).toBe(false);
    });

    it("複数カテゴリ OR", () => {
      const def = makeDef({ printedCategory: "nexus" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, { category: ["spirit", "nexus"] })
      ).toBe(true);
    });
  });

  describe("colors", () => {
    it("色一致", () => {
      const def = makeDef({ colors: ["red", "blue"] });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { colors: ["red"] })).toBe(true);
      expect(matchesCardFilter(card, def, { colors: ["green"] })).toBe(false);
    });
  });

  describe("colorCount", () => {
    it("mono — 単色", () => {
      const mono = makeDef({ colors: ["red"] });
      const multi = makeDef({ colors: ["red", "blue"] });
      expect(
        matchesCardFilter(makeInstance(mono), mono, { colorCount: "mono" })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(multi), multi, { colorCount: "mono" })
      ).toBe(false);
    });

    it("multi — 多色", () => {
      const mono = makeDef({ colors: ["red"] });
      const multi = makeDef({ colors: ["red", "blue"] });
      expect(
        matchesCardFilter(makeInstance(mono), mono, { colorCount: "multi" })
      ).toBe(false);
      expect(
        matchesCardFilter(makeInstance(multi), multi, { colorCount: "multi" })
      ).toBe(true);
    });

    it("数値範囲 — min/max 同値でちょうどN色", () => {
      const six = makeDef({
        colors: ["red", "purple", "green", "white", "yellow", "blue"],
      });
      const seven = makeDef({
        colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
      });
      const exactlySix = { colorCount: { min: 6, max: 6 } } as const;
      expect(matchesCardFilter(makeInstance(six), six, exactlySix)).toBe(true);
      expect(matchesCardFilter(makeInstance(seven), seven, exactlySix)).toBe(
        false
      );
    });
  });

  describe("colorsLogic (全色 AND マッチ — engine batch2-7)", () => {
    const allSix = makeDef({
      colors: ["red", "purple", "green", "white", "yellow", "blue"],
    });
    const fiveColor = makeDef({
      colors: ["red", "purple", "green", "white", "yellow"],
    });
    const sixFilter = [
      "red",
      "purple",
      "green",
      "white",
      "yellow",
      "blue",
    ] as const;

    it("and: 6色カードは6色フィルタに合致, 5色カードは除外", () => {
      expect(
        matchesCardFilter(makeInstance(allSix), allSix, {
          colors: [...sixFilter],
          colorsLogic: "and",
        })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(fiveColor), fiveColor, {
          colors: [...sixFilter],
          colorsLogic: "and",
        })
      ).toBe(false);
    });

    it("and: 単色カードは2色 AND フィルタから除外 (片方しか持たない)", () => {
      const mono = makeDef({ colors: ["red"] });
      expect(
        matchesCardFilter(makeInstance(mono), mono, {
          colors: ["red", "blue"],
          colorsLogic: "and",
        })
      ).toBe(false);
    });

    it("and: 列挙色をすべて持つ多色カードは合致 (余分な色があってもよい)", () => {
      const def = makeDef({ colors: ["red", "blue", "green"] });
      expect(
        matchesCardFilter(makeInstance(def), def, {
          colors: ["red", "blue"],
          colorsLogic: "and",
        })
      ).toBe(true);
    });

    it("or (既定): いずれかの色を持てば合致 — 従来挙動は不変", () => {
      const def = makeDef({ colors: ["red", "blue"] });
      // colorsLogic 未指定 = "or"
      expect(
        matchesCardFilter(makeInstance(def), def, { colors: ["red"] })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(def), def, { colors: ["green"] })
      ).toBe(false);
      // 明示 "or" でも同じ
      expect(
        matchesCardFilter(makeInstance(def), def, {
          colors: ["red", "green"],
          colorsLogic: "or",
        })
      ).toBe(true);
    });
  });

  describe("cost", () => {
    it("minCost / maxCost", () => {
      const def = makeDef({ cost: 5 });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { minCost: 3 })).toBe(true);
      expect(matchesCardFilter(card, def, { minCost: 6 })).toBe(false);
      expect(matchesCardFilter(card, def, { maxCost: 5 })).toBe(true);
      expect(matchesCardFilter(card, def, { maxCost: 4 })).toBe(false);
    });

    it("既定では additional_cost を含め、costBasis:printed は本来コストだけを見る", () => {
      const def = makeDef({ cost: 4 });
      const card = makeInstance(def);
      const opts = { additionalCosts: [7] };

      expect(matchesCardFilter(card, def, { minCost: 7 }, opts)).toBe(true);
      expect(
        matchesCardFilter(card, def, { minCost: 7, costBasis: "printed" }, opts)
      ).toBe(false);
      expect(matchesCardFilter(card, def, { maxCost: 4 }, opts)).toBe(true);
      expect(
        matchesCardFilter(card, def, { maxCost: 6, costBasis: "printed" }, opts)
      ).toBe(true);
    });

    it("effectiveCost 指定時も additional_cost 候補を併用し、costBasis:printed は印字だけを見る", () => {
      const def = makeDef({ cost: 8 });
      const card = makeInstance(def);
      const opts = { effectiveCost: 4, additionalCosts: [7] };

      expect(matchesCardFilter(card, def, { maxCost: 4 }, opts)).toBe(true);
      expect(matchesCardFilter(card, def, { minCost: 7 }, opts)).toBe(true);
      expect(matchesCardFilter(card, def, { minCost: 8 }, opts)).toBe(false);
      expect(
        matchesCardFilter(card, def, { minCost: 8, costBasis: "printed" }, opts)
      ).toBe(true);
    });

    it("minCost と maxCost は同じ cost 候補で同時に満たす必要がある", () => {
      const def = makeDef({ cost: 8 });
      const card = makeInstance(def);
      const opts = { effectiveCost: 4, additionalCosts: [8] };

      expect(
        matchesCardFilter(card, def, { minCost: 5, maxCost: 7 }, opts)
      ).toBe(false);
      expect(
        matchesCardFilter(card, def, { minCost: 5, maxCost: 8 }, opts)
      ).toBe(true);
    });
  });

  describe("BP", () => {
    it("minBp / maxBp", () => {
      const def = makeDef({
        levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { minBp: 3000 })).toBe(true);
      expect(matchesCardFilter(card, def, { maxBp: 5000 })).toBe(true);
      expect(matchesCardFilter(card, def, { maxBp: 4999 })).toBe(false);
    });

    it("既定では effectiveBp を優先し、bpBasis:printed は印字 Lv1 BP だけを見る", () => {
      // 印字 Lv1 BP=5000 だが BP+10000 修飾などで実効 BP=15000 のケース
      // (BSSG01-X04 の「本来のBP」近似スタブ、BSGE01-TR01(B) と同型)。
      const def = makeDef({
        levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      });
      const card = makeInstance(def);
      const opts = { effectiveBp: 15000 };

      // 既定 (bpBasis 未指定): 実効 BP=15000 で判定される。
      expect(matchesCardFilter(card, def, { maxBp: 6000 }, opts)).toBe(false);
      expect(matchesCardFilter(card, def, { maxBp: 15000 }, opts)).toBe(true);
      // bpBasis:"printed": 実効 BP を無視し、印字 Lv1 BP=5000 だけを見る。
      expect(
        matchesCardFilter(card, def, { maxBp: 6000, bpBasis: "printed" }, opts)
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, { maxBp: 4999, bpBasis: "printed" }, opts)
      ).toBe(false);
    });
  });

  describe("maxCores / minCores (engine batch2-1)", () => {
    it("maxCores:3 — 2コア/3コアは合致, 4コアは除外", () => {
      const def = makeDef();
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, { maxCores: 3 }, { coreCount: 2 })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, { maxCores: 3 }, { coreCount: 3 })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, { maxCores: 3 }, { coreCount: 4 })
      ).toBe(false);
    });

    it("minCores:2 — 1コアは除外, 2コア以上は合致", () => {
      const def = makeDef();
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, { minCores: 2 }, { coreCount: 1 })
      ).toBe(false);
      expect(
        matchesCardFilter(card, def, { minCores: 2 }, { coreCount: 2 })
      ).toBe(true);
    });

    it("coreCount 未注入 (場外カード等) なら maxCores/minCores 指定があってもマッチしない", () => {
      const def = makeDef();
      const card = makeInstance(def);
      // 判定不能 → 保守的に false (effectiveBp と同様、フィルタ条件を満たせない)
      expect(matchesCardFilter(card, def, { maxCores: 3 })).toBe(false);
      expect(matchesCardFilter(card, def, { minCores: 2 })).toBe(false);
    });

    it("maxCores/minCores 未指定なら coreCount に関係なくフィルタしない", () => {
      const def = makeDef();
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, {}, { coreCount: 99 })).toBe(true);
      expect(matchesCardFilter(card, def, {}, { coreCount: undefined })).toBe(
        true
      );
    });

    it("ソウルコア込み: 通常コア2 + ソウルコア1 = 合計3 (06_core-system.md L41 generic コアは soul を含む)", () => {
      // SSOT = getTotalCoresOnCardById (= normalCoreCount + soul)。注入経路と同じ helper を使う。
      const def = makeDef();
      const card = createCardInstance(def, {
        instanceId: "s1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2, // 通常コア2
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
        playerOverrides: [
          { soulCoreLocation: { kind: "card", instanceId: "s1" } },
        ],
      });
      const coreCount = getTotalCoresOnCardById(state, "s1");
      expect(coreCount).toBe(3); // 通常2 + soul1

      // 合計3 なので maxCores:3 は合致, maxCores:2 は除外 (soul を数えている証拠)
      expect(matchesCardFilter(card, def, { maxCores: 3 }, { coreCount })).toBe(
        true
      );
      expect(matchesCardFilter(card, def, { maxCores: 2 }, { coreCount })).toBe(
        false
      );
    });
  });

  describe("minLevel / maxLevel", () => {
    it("現在Lvの注入値で判定し、未注入なら不一致", () => {
      const def = makeDef();
      const card = makeInstance(def);
      const filter = { minLevel: 1, maxLevel: 1 };
      expect(matchesCardFilter(card, def, filter, { effectiveLevel: 1 })).toBe(
        true
      );
      expect(matchesCardFilter(card, def, filter, { effectiveLevel: 2 })).toBe(
        false
      );
      expect(matchesCardFilter(card, def, filter)).toBe(false);
    });
  });

  describe("symbolCount", () => {
    it("シンボル数", () => {
      const def1 = makeDef({ symbolColors: ["red"] });
      const def2 = makeDef({ symbolColors: ["red", "blue"] });
      expect(
        matchesCardFilter(makeInstance(def1), def1, { symbolCount: 1 })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(def2), def2, { symbolCount: 1 })
      ).toBe(false);
    });
  });

  describe("tribes", () => {
    it("OR 結合（デフォルト）", () => {
      const def = makeDef({ tribe: "星竜・導魔" });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { tribes: ["星竜"] })).toBe(true);
      expect(matchesCardFilter(card, def, { tribes: ["紅魔"] })).toBe(false);
      expect(matchesCardFilter(card, def, { tribes: ["星竜", "紅魔"] })).toBe(
        true
      );
    });

    it("AND 結合", () => {
      const def = makeDef({ tribe: "星竜・導魔" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, {
          tribes: ["星竜", "導魔"],
          tribesLogic: "and",
        })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, {
          tribes: ["星竜", "紅魔"],
          tribesLogic: "and",
        })
      ).toBe(false);
    });

    it("tribesRequired（必須 + 通常の組み合わせ）", () => {
      const def = makeDef({ tribe: "星竜・導魔・楽族" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, {
          tribesRequired: ["星竜"],
          tribes: ["導魔", "紅魔"],
        })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, {
          tribesRequired: ["紅魔"],
          tribes: ["導魔"],
        })
      ).toBe(false);
    });

    it("系統なしのカード", () => {
      const def = makeDef({ tribe: undefined });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { tribes: ["星竜"] })).toBe(false);
    });

    it("excludeTribeSubstring（否定部分一致、契約合体【合体条件：GE＆系統名に「O」を含まない】型）", () => {
      const ge = makeDef({ tribe: "GE" });
      const geo = makeDef({ tribe: "GE・GEO" });
      const ge1 = makeDef({ tribe: "GE・GE1" });

      // GE のみ: "O" を含むトークンが無い → 合致
      expect(
        matchesCardFilter(makeInstance(ge), ge, {
          tribes: ["GE"],
          excludeTribeSubstring: ["O"],
        })
      ).toBe(true);

      // GEO トークンが "O" を含む → 除外
      expect(
        matchesCardFilter(makeInstance(geo), geo, {
          tribes: ["GE"],
          excludeTribeSubstring: ["O"],
        })
      ).toBe(false);

      // 複数指定 (OR): "O" 不一致でも "1" を含む GE1 トークンで除外
      expect(
        matchesCardFilter(makeInstance(ge1), ge1, {
          tribes: ["GE"],
          excludeTribeSubstring: ["O", "1"],
        })
      ).toBe(false);

      // 複数指定でどちらも含まなければ合致
      expect(
        matchesCardFilter(makeInstance(ge), ge, {
          tribes: ["GE"],
          excludeTribeSubstring: ["O", "1"],
        })
      ).toBe(true);
    });
  });

  describe("cardName", () => {
    it("exact マッチ", () => {
      const def = makeDef({ name: "テストスピリット" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, {
          cardName: { exact: "テストスピリット" },
        })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, { cardName: { exact: "別のカード" } })
      ).toBe(false);
    });

    it("contains マッチ", () => {
      const def = makeDef({ name: "[スターシーカー]霧雨 魔理沙" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, { cardName: { contains: "魔理沙" } })
      ).toBe(true);
      expect(
        matchesCardFilter(card, def, { cardName: { contains: "アリス" } })
      ).toBe(false);
    });

    it("self マッチ", () => {
      const sourceDef = makeDef({ name: "テストスピリット" });
      const def = makeDef({ name: "テストスピリット" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(
          card,
          def,
          { cardName: "self" },
          { sourceDefinition: sourceDef }
        )
      ).toBe(true);

      const otherDef = makeDef({ name: "別のカード" });
      const otherCard = makeInstance(otherDef);
      expect(
        matchesCardFilter(
          otherCard,
          otherDef,
          { cardName: "self" },
          { sourceDefinition: sourceDef }
        )
      ).toBe(false);
    });

    it("配列で OR 結合", () => {
      const def = makeDef({ name: "テストA" });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, {
          cardName: [{ exact: "テストA" }, { exact: "テストB" }],
        })
      ).toBe(true);
    });
  });

  describe("hasMechanic", () => {
    it("accel", () => {
      const def = makeDef({
        accelData: { timing: "flash", cost: 3, reduction: [], effects: [] },
      });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { hasMechanic: ["accel"] })).toBe(
        true
      );
      expect(matchesCardFilter(card, def, { hasMechanic: ["change"] })).toBe(
        false
      );
    });

    it("burst（印字バーストヘッダ）", () => {
      const def = makeDef({ textLines: ["【バースト：自分のライフ減少後】"] });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { hasMechanic: ["burst"] })).toBe(
        true
      );
    });

    it("burst mechanic は keywordTags だけでは一致しない", () => {
      const def = makeDef({
        textLines: ["相手のバースト1つを破棄する。"],
        keywordTags: ["burst"],
      });
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, { hasMechanic: ["burst"] })).toBe(
        false
      );
    });

    it("stack_effect（activated stack 効果）", () => {
      const def = makeDef({
        printedCategory: "magic",
        effects: [{ timing: { kind: "activated", mode: "stack" }, steps: [] }],
      });
      const card = makeInstance(def);
      expect(
        matchesCardFilter(card, def, { hasMechanic: ["stack_effect"] })
      ).toBe(true);
      expect(matchesCardFilter(card, def, { hasMechanic: ["accel"] })).toBe(
        false
      );
    });
  });

  describe("filterOr", () => {
    it("いずれかのサブフィルタにマッチすれば true", () => {
      const def = makeDef({
        printedCategory: "nexus",
        colors: ["green"],
        cost: 5,
      });
      const card = makeInstance(def);

      const filter: CardFilter = {
        filterOr: [
          { category: ["spirit"], colors: ["red"] },
          { category: ["nexus"], minCost: 3 },
        ],
      };
      expect(matchesCardFilter(card, def, filter)).toBe(true);
    });

    it("どのサブフィルタにもマッチしなければ false", () => {
      const def = makeDef({
        printedCategory: "magic",
        colors: ["yellow"],
        cost: 2,
      });
      const card = makeInstance(def);

      const filter: CardFilter = {
        filterOr: [{ category: ["spirit"] }, { category: ["nexus"] }],
      };
      expect(matchesCardFilter(card, def, filter)).toBe(false);
    });
  });

  describe("exclude", () => {
    it("exclude に合致するカードを除外", () => {
      const def = makeDef({
        printedCategory: "spirit",
        colors: ["red"],
        cost: 3,
      });
      const card = makeInstance(def);

      expect(
        matchesCardFilter(card, def, {
          category: ["spirit"],
          exclude: { colors: ["red"] },
        })
      ).toBe(false);

      expect(
        matchesCardFilter(card, def, {
          category: ["spirit"],
          exclude: { colors: ["blue"] },
        })
      ).toBe(true);
    });

    it("filterOr + exclude", () => {
      const def = makeDef({
        printedCategory: "spirit",
        colors: ["red"],
        cost: 3,
        tribe: "星竜",
      });
      const card = makeInstance(def);

      expect(
        matchesCardFilter(card, def, {
          filterOr: [{ category: ["spirit"] }],
          exclude: { tribes: ["星竜"] },
        })
      ).toBe(false);
    });
  });

  describe("soulState", () => {
    it("デフォルト: 魂状態を除外", () => {
      const def = makeDef();
      const card = makeInstance(def);
      const soulIds = new Set(["soul-card"]);

      // 非魂状態 → マッチ
      expect(matchesCardFilter(card, def, {}, { soulStateIds: soulIds })).toBe(
        true
      );

      // 魂状態 → 除外
      const soulCard = makeInstance(def, { instanceId: "soul-card" });
      expect(
        matchesCardFilter(soulCard, def, {}, { soulStateIds: soulIds })
      ).toBe(false);
    });

    it("soulState: 'include' — 魂状態も含める", () => {
      const def = makeDef();
      const soulCard = makeInstance(def, { instanceId: "soul-card" });
      const soulIds = new Set(["soul-card"]);

      expect(
        matchesCardFilter(
          soulCard,
          def,
          { soulState: "include" },
          { soulStateIds: soulIds }
        )
      ).toBe(true);
    });

    it("soulState: 'only' — 魂状態のみ", () => {
      const def = makeDef();
      const normalCard = makeInstance(def, { instanceId: "normal-card" });
      const soulCard = makeInstance(def, { instanceId: "soul-card" });
      const soulIds = new Set(["soul-card"]);

      expect(
        matchesCardFilter(
          normalCard,
          def,
          { soulState: "only" },
          { soulStateIds: soulIds }
        )
      ).toBe(false);
      expect(
        matchesCardFilter(
          soulCard,
          def,
          { soulState: "only" },
          { soulStateIds: soulIds }
        )
      ).toBe(true);
    });
  });

  describe("excludeInstanceId", () => {
    it("指定インスタンスを除外", () => {
      const def = makeDef();
      const card = makeInstance(def, { instanceId: "exclude-me" });
      expect(
        matchesCardFilter(card, def, {}, { excludeInstanceId: "exclude-me" })
      ).toBe(false);
      expect(
        matchesCardFilter(card, def, {}, { excludeInstanceId: "other" })
      ).toBe(true);
    });
  });

  describe("battleState", () => {
    const attackingEntity: BattleEntity = {
      entityId: "be-atk",
      memberInstanceIds: ["atk-card"],
      resolvedBp: 5000,
      resolvedSymbols: ["red"],
      attackState: "attacking",
    };
    const blockingEntity: BattleEntity = {
      entityId: "be-blk",
      memberInstanceIds: ["blk-card"],
      resolvedBp: 3000,
      resolvedSymbols: ["blue"],
      attackState: "blocking",
    };
    const battleEntities = [attackingEntity, blockingEntity];

    it("in_battle — アタック中/ブロック中のカードにマッチ", () => {
      const def = makeDef();
      const atkCard = makeInstance(def, { instanceId: "atk-card" });
      const blkCard = makeInstance(def, { instanceId: "blk-card" });
      const otherCard = makeInstance(def, { instanceId: "other-card" });

      expect(
        matchesCardFilter(
          atkCard,
          def,
          { battleState: "in_battle" },
          { battleEntities }
        )
      ).toBe(true);
      expect(
        matchesCardFilter(
          blkCard,
          def,
          { battleState: "in_battle" },
          { battleEntities }
        )
      ).toBe(true);
      expect(
        matchesCardFilter(
          otherCard,
          def,
          { battleState: "in_battle" },
          { battleEntities }
        )
      ).toBe(false);
    });

    it("not_in_battle — バトルしていないカードにマッチ", () => {
      const def = makeDef();
      const atkCard = makeInstance(def, { instanceId: "atk-card" });
      const otherCard = makeInstance(def, { instanceId: "other-card" });

      expect(
        matchesCardFilter(
          atkCard,
          def,
          { battleState: "not_in_battle" },
          { battleEntities }
        )
      ).toBe(false);
      expect(
        matchesCardFilter(
          otherCard,
          def,
          { battleState: "not_in_battle" },
          { battleEntities }
        )
      ).toBe(true);
    });

    it("attacking — アタック中のカードのみ", () => {
      const def = makeDef();
      const atkCard = makeInstance(def, { instanceId: "atk-card" });
      const blkCard = makeInstance(def, { instanceId: "blk-card" });

      expect(
        matchesCardFilter(
          atkCard,
          def,
          { battleState: "attacking" },
          { battleEntities }
        )
      ).toBe(true);
      expect(
        matchesCardFilter(
          blkCard,
          def,
          { battleState: "attacking" },
          { battleEntities }
        )
      ).toBe(false);
    });

    it("blocking — ブロック中のカードのみ", () => {
      const def = makeDef();
      const atkCard = makeInstance(def, { instanceId: "atk-card" });
      const blkCard = makeInstance(def, { instanceId: "blk-card" });

      expect(
        matchesCardFilter(
          atkCard,
          def,
          { battleState: "blocking" },
          { battleEntities }
        )
      ).toBe(false);
      expect(
        matchesCardFilter(
          blkCard,
          def,
          { battleState: "blocking" },
          { battleEntities }
        )
      ).toBe(true);
    });

    it("battleEntities 未指定時は battleState フィルタ不一致", () => {
      const def = makeDef();
      const card = makeInstance(def, { instanceId: "atk-card" });

      // battleEntities がなければ in_battle はマッチしない
      expect(matchesCardFilter(card, def, { battleState: "in_battle" })).toBe(
        false
      );
      // not_in_battle はバトル情報なし = バトルしていない扱い
      expect(
        matchesCardFilter(card, def, { battleState: "not_in_battle" })
      ).toBe(true);
    });

    it("battleState + category 複合条件", () => {
      const spiritDef = makeDef({ printedCategory: "spirit" });
      const nexusDef = makeDef({ printedCategory: "nexus" });
      const spiritCard = makeInstance(spiritDef, { instanceId: "atk-card" });
      const nexusCard = makeInstance(nexusDef, { instanceId: "blk-card" });

      // アタック中のスピリット → マッチ
      expect(
        matchesCardFilter(
          spiritCard,
          spiritDef,
          {
            battleState: "attacking",
            category: ["spirit"],
          },
          { battleEntities }
        )
      ).toBe(true);

      // ブロック中だがネクサス → category 不一致
      expect(
        matchesCardFilter(
          nexusCard,
          nexusDef,
          {
            battleState: "blocking",
            category: ["spirit"],
          },
          { battleEntities }
        )
      ).toBe(false);
    });
  });

  describe("exhaustState (疲労状態フィルタ)", () => {
    it('"exhausted" — 疲労状態にマッチ, 回復状態は除外', () => {
      const def = makeDef();
      const exhausted = makeInstance(def, { exhaustState: "exhausted" });
      const recovered = makeInstance(def, { exhaustState: "recovered" });
      expect(
        matchesCardFilter(exhausted, def, { exhaustState: "exhausted" })
      ).toBe(true);
      expect(
        matchesCardFilter(recovered, def, { exhaustState: "exhausted" })
      ).toBe(false);
    });

    it('"exhausted" — 重疲労状態も「疲労状態」に含む (重疲労→疲労状態コンボ設計)', () => {
      const def = makeDef();
      const heavy = makeInstance(def, { exhaustState: "heavily_exhausted" });
      expect(matchesCardFilter(heavy, def, { exhaustState: "exhausted" })).toBe(
        true
      );
    });

    it('"recovered" — 回復状態のみマッチ', () => {
      const def = makeDef();
      const recovered = makeInstance(def, { exhaustState: "recovered" });
      const exhausted = makeInstance(def, { exhaustState: "exhausted" });
      const heavy = makeInstance(def, { exhaustState: "heavily_exhausted" });
      expect(
        matchesCardFilter(recovered, def, { exhaustState: "recovered" })
      ).toBe(true);
      expect(
        matchesCardFilter(exhausted, def, { exhaustState: "recovered" })
      ).toBe(false);
      expect(matchesCardFilter(heavy, def, { exhaustState: "recovered" })).toBe(
        false
      );
    });

    it("未指定なら状態を問わずマッチ (従来挙動は不変)", () => {
      const def = makeDef();
      expect(
        matchesCardFilter(
          makeInstance(def, { exhaustState: "exhausted" }),
          def,
          {}
        )
      ).toBe(true);
      expect(
        matchesCardFilter(
          makeInstance(def, { exhaustState: "recovered" }),
          def,
          {}
        )
      ).toBe(true);
    });

    it("category と複合 — 疲労状態のスピリットのみ", () => {
      const spiritDef = makeDef({ printedCategory: "spirit" });
      const nexusDef = makeDef({ printedCategory: "nexus" });
      const exhaustedSpirit = makeInstance(spiritDef, {
        exhaustState: "exhausted",
      });
      const exhaustedNexus = makeInstance(nexusDef, {
        exhaustState: "exhausted",
      });
      expect(
        matchesCardFilter(exhaustedSpirit, spiritDef, {
          category: ["spirit"],
          exhaustState: "exhausted",
        })
      ).toBe(true);
      // ネクサスは category 不一致
      expect(
        matchesCardFilter(exhaustedNexus, nexusDef, {
          category: ["spirit"],
          exhaustState: "exhausted",
        })
      ).toBe(false);
    });
  });

  describe("空フィルタ", () => {
    it("フィールド指定なし → 全てマッチ", () => {
      const def = makeDef();
      const card = makeInstance(def);
      expect(matchesCardFilter(card, def, {})).toBe(true);
    });
  });

  describe("複合条件", () => {
    it("category + colors + tribes + maxCost", () => {
      const def = makeDef({
        printedCategory: "spirit",
        colors: ["red"],
        tribe: "星竜・導魔",
        cost: 5,
      });
      const card = makeInstance(def);

      expect(
        matchesCardFilter(card, def, {
          category: ["spirit"],
          colors: ["red"],
          tribes: ["星竜"],
          maxCost: 5,
        })
      ).toBe(true);

      expect(
        matchesCardFilter(card, def, {
          category: ["spirit"],
          colors: ["red"],
          tribes: ["星竜"],
          maxCost: 4,
        })
      ).toBe(false);
    });
  });

  describe("hasEffectText（効果の記述を持つ／持たない）", () => {
    const withText = makeDef({
      cardNo: "TEST-EFFTEXT",
      textLines: ["Lv1-Lv2『このスピリットの召喚時』", "", "1枚ドローする。"],
    });
    const vanilla = makeDef({
      cardNo: "TEST-VANILLA",
      textLines: [],
    });
    const flavorOnlyEmpty = makeDef({
      cardNo: "TEST-EMPTY-LINES",
      // 空文字・空白のみの行はバニラ扱い（印字の効果記述なし）。
      textLines: ["", "  "],
    });

    it("cardHasPrintedEffectText: 印字テキスト有無を SSOT 判定", () => {
      expect(cardHasPrintedEffectText(withText)).toBe(true);
      expect(cardHasPrintedEffectText(vanilla)).toBe(false);
      expect(cardHasPrintedEffectText(flavorOnlyEmpty)).toBe(false);
    });

    it("hasEffectText:true は効果記述を持つカードのみマッチ", () => {
      expect(
        matchesCardFilter(makeInstance(withText), withText, {
          hasEffectText: true,
        })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(vanilla), vanilla, {
          hasEffectText: true,
        })
      ).toBe(false);
    });

    it("hasEffectText:false はバニラ（効果記述なし）のみマッチ", () => {
      expect(
        matchesCardFilter(makeInstance(vanilla), vanilla, {
          hasEffectText: false,
        })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(withText), withText, {
          hasEffectText: false,
        })
      ).toBe(false);
    });
  });

  describe("isToken（トークンカード判定、BSLH01-X06 導力器トークンマジック限定）", () => {
    const tokenMagic = makeDef({
      cardNo: "BSLH01-T13",
      printedCategory: "magic",
      tribe: "導力器",
      maxTokenDeckCount: 1,
    });
    const nonTokenMagic = makeDef({
      cardNo: "BSLH01-C08",
      printedCategory: "magic",
      tribe: "導力器",
    });

    it("isCardDefinitionToken: maxTokenDeckCount 設定有無を SSOT 判定", () => {
      expect(isCardDefinitionToken(tokenMagic)).toBe(true);
      expect(isCardDefinitionToken(nonTokenMagic)).toBe(false);
    });

    it("isToken:true は maxTokenDeckCount を持つトークンカードのみマッチ", () => {
      expect(
        matchesCardFilter(makeInstance(tokenMagic), tokenMagic, {
          tribes: ["導力器"],
          isToken: true,
        })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(nonTokenMagic), nonTokenMagic, {
          tribes: ["導力器"],
          isToken: true,
        })
      ).toBe(false);
    });

    it("isToken:false は非トークンカードのみマッチ", () => {
      expect(
        matchesCardFilter(makeInstance(nonTokenMagic), nonTokenMagic, {
          isToken: false,
        })
      ).toBe(true);
      expect(
        matchesCardFilter(makeInstance(tokenMagic), tokenMagic, {
          isToken: false,
        })
      ).toBe(false);
    });
  });
});

// ============================================================
// 自分のカウント閾値 (self_count) — maxCostSource / maxCoresSource
// ============================================================

describe("resolveSelfCountThreshold (self_count)", () => {
  it("maxCostSource:self_count を maxCost 数値へ解決し、ソース指定を取り除く", () => {
    const filter: CardFilter = {
      category: ["spirit"],
      maxCostSource: "self_count",
    };
    const resolved = resolveSelfCountThreshold(filter, 4);
    expect(resolved.maxCost).toBe(4);
    expect(resolved.maxCostSource).toBeUndefined();
    expect(resolved.category).toEqual(["spirit"]);
  });

  it("maxCoresSource:self_count を maxCores 数値へ解決する", () => {
    const filter: CardFilter = {
      category: ["spirit", "ultimate"],
      maxCoresSource: "self_count",
    };
    const resolved = resolveSelfCountThreshold(filter, 3);
    expect(resolved.maxCores).toBe(3);
    expect(resolved.maxCoresSource).toBeUndefined();
  });

  it("静的 maxCost と併用時は厳しい方 (Math.min) を採る", () => {
    expect(
      resolveSelfCountThreshold({ maxCost: 6, maxCostSource: "self_count" }, 4)
        .maxCost
    ).toBe(4);
    expect(
      resolveSelfCountThreshold({ maxCost: 2, maxCostSource: "self_count" }, 4)
        .maxCost
    ).toBe(2);
  });

  it("ソースカウント undefined のとき閾値 0 (fail-closed)", () => {
    expect(
      resolveSelfCountThreshold({ maxCostSource: "self_count" }, undefined)
        .maxCost
    ).toBe(0);
  });

  it("self_count ソースを持たないフィルタは素通り (no-op)", () => {
    const filter: CardFilter = {
      category: ["spirit"],
      maxCost: 5,
    };
    expect(resolveSelfCountThreshold(filter, 3)).toBe(filter);
  });
});

describe("getSelfCountThresholdValue", () => {
  it("発動元プレイヤーの countValue を返す", () => {
    const def = makeDef();
    const src = makeInstance(def, {
      instanceId: "src-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
    });
    const state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    expect(getSelfCountThresholdValue(state, src, def)).toBe(5);
  });

  it("ソースが undefined のとき undefined", () => {
    const state = createEmptyGameState({});
    expect(getSelfCountThresholdValue(state, undefined, undefined)).toBe(
      undefined
    );
  });
});
