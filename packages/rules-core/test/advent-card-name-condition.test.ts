/**
 * AdventCondition.cardNames（煌臨先の名前条件）のユニット。
 * 【契約煌臨：「孫悟空」】【煌臨：「暁 切歌＆コスト4以上」】のように、煌臨先 host を
 * カード名で絞り込む条件を AdventCondition.cardNames で表現する（engine-drain）。
 * 一致条件は card-filter の matchesCardName SSOT（「X」=部分一致）に従う。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  matchesAdventCondition,
  getContractAdventTargets,
} from "../src/mechanics/advent-system";
import type {
  AdventCondition,
  AdventData,
  CardDefinition,
  CardInstance,
} from "../src/model";

const ALICE = "player-1";

function spiritDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-SPIRIT",
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A" as const,
    ...overrides,
  } as CardDefinition;
}

const defs = new Map<string, CardDefinition>();
function register(def: CardDefinition): CardDefinition {
  defs.set(def.cardNo, def);
  return def;
}
function getDef(id: string): CardDefinition | undefined {
  return defs.get(id);
}

// 煌臨先候補
const gokuDef = register(
  spiritDef({ cardNo: "GOKU", name: "孫悟空", cost: 4 })
);
const ssGokuDef = register(
  spiritDef({ cardNo: "SS-GOKU", name: "超サイヤ人 孫悟空", cost: 7 })
);
const vegetaDef = register(
  spiritDef({ cardNo: "VEGETA", name: "ベジータ", cost: 4 })
);

function fieldCard(
  instanceId: string,
  defId: string,
  owner = ALICE,
  cores = 3
): CardInstance {
  return createCardInstance(getDef(defId)!, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
}

describe("AdventCondition.cardNames（煌臨先名前条件）", () => {
  const gokuCondition: AdventCondition = {
    cardNames: [{ contains: "孫悟空" }],
    targetCategory: ["spirit"],
  };

  it("名前を部分一致で含む host を対象にする（孫悟空 / 超サイヤ人 孫悟空）", () => {
    const goku = fieldCard("g1", "GOKU");
    const ssGoku = fieldCard("g2", "SS-GOKU");
    const state = createEmptyGameState({ cardInstances: [goku, ssGoku] });
    expect(
      matchesAdventCondition(goku, gokuDef, gokuCondition, getDef, state)
    ).toBe(true);
    expect(
      matchesAdventCondition(ssGoku, ssGokuDef, gokuCondition, getDef, state)
    ).toBe(true);
  });

  it("名前条件を満たさない host は対象外（ベジータ）", () => {
    const vegeta = fieldCard("v1", "VEGETA");
    const state = createEmptyGameState({ cardInstances: [vegeta] });
    expect(
      matchesAdventCondition(vegeta, vegetaDef, gokuCondition, getDef, state)
    ).toBe(false);
  });

  it("名前条件は他条件（minCost）と AND で評価する", () => {
    const condition: AdventCondition = {
      cardNames: [{ contains: "孫悟空" }],
      minCost: 5,
      targetCategory: ["spirit"],
    };
    const goku = fieldCard("g1", "GOKU"); // cost 4 < 5 → 名前一致でも不可
    const ssGoku = fieldCard("g2", "SS-GOKU"); // cost 7 ≥ 5 → 可
    const state = createEmptyGameState({ cardInstances: [goku, ssGoku] });
    expect(
      matchesAdventCondition(goku, gokuDef, condition, getDef, state)
    ).toBe(false);
    expect(
      matchesAdventCondition(ssGoku, ssGokuDef, condition, getDef, state)
    ).toBe(true);
  });

  it("契約煌臨: 魂状態の契約 host にも名前条件を適用する", () => {
    // 契約カード = VEGETA を魂状態に置く。魂状態 host は getAdventTargets では除外され、
    // soulTargets 経路でのみ拾われるため、この経路の名前フィルタを単独で検証できる。
    const vegeta = fieldCard("v1", "VEGETA");
    const state = createEmptyGameState({ cardInstances: [vegeta] });
    const player = state.players.find((p) => p.id === ALICE)!;
    player.contractCardNo = "VEGETA";
    player.soulStateInstanceIds = ["v1"];

    const adData = (condition: AdventCondition): AdventData => ({
      adventCondition: condition,
      adventTiming: "main_and_flash",
      soulCoreDest: "trash",
    });

    // 名前条件「孫悟空」: 契約 host でも名前不一致なので除外される。
    const goku = getContractAdventTargets(
      state,
      ALICE,
      adData(gokuCondition),
      getDef
    );
    expect(goku.map((t) => t.instanceId)).not.toContain("v1");

    // 名前条件「ベジータ」: 一致するので対象に含まれる。
    const veg = getContractAdventTargets(
      state,
      ALICE,
      adData({
        cardNames: [{ contains: "ベジータ" }],
        targetCategory: ["spirit"],
      }),
      getDef
    );
    expect(veg.map((t) => t.instanceId)).toContain("v1");
  });

  it("cardNames 未指定なら名前で絞らない（後方互換）", () => {
    const condition: AdventCondition = { targetCategory: ["spirit"] };
    const vegeta = fieldCard("v1", "VEGETA");
    const state = createEmptyGameState({ cardInstances: [vegeta] });
    expect(
      matchesAdventCondition(vegeta, vegetaDef, condition, getDef, state)
    ).toBe(true);
  });

  it("isContract:true は印字分類が契約カード (keywordTags:contract) の host だけを対象にする", () => {
    const plainVegeta = vegetaDef; // keywordTags:[] / adventData なし
    const contractVegeta = register(
      spiritDef({
        cardNo: "VEGETA-CONTRACT",
        name: "ベジータ",
        cost: 4,
        keywordTags: ["contract"],
      })
    );
    const condition: AdventCondition = {
      isContract: true,
      targetCategory: ["spirit"],
    };
    const plain = fieldCard("v-plain", "VEGETA");
    const contract = fieldCard("v-contract", "VEGETA-CONTRACT");
    const state = createEmptyGameState({
      cardInstances: [plain, contract],
    });
    expect(
      matchesAdventCondition(plain, plainVegeta, condition, getDef, state)
    ).toBe(false);
    expect(
      matchesAdventCondition(contract, contractVegeta, condition, getDef, state)
    ).toBe(true);
  });

  it("adventState=advented は煌臨中 host だけを対象にする", () => {
    const condition: AdventCondition = {
      adventState: "advented",
      targetCategory: ["spirit"],
    };
    const plain = fieldCard("plain", "GOKU");
    const source = fieldCard("source", "VEGETA");
    const advented: CardInstance = {
      ...fieldCard("advented", "GOKU"),
      underCards: [{ cardInstanceId: "source", role: "advent_source" }],
    };
    const state = createEmptyGameState({
      cardInstances: [plain, advented, source],
    });

    expect(
      matchesAdventCondition(plain, gokuDef, condition, getDef, state)
    ).toBe(false);
    expect(
      matchesAdventCondition(advented, gokuDef, condition, getDef, state)
    ).toBe(true);
  });
});
