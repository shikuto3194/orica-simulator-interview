/**
 * `field_core_sum_both_players` 条件 primitive のユニット検証。
 *
 * BSTH02-X01「西行妖」【導域:1】「創界神ネクサス/導界者ネクサス/創界石ネクサス以外の
 * フィールド/リザーブのコアの合計がお互いどちらも5個以上のとき」型の、自分・相手それぞれの
 * field+reserve 合計コア数 (通常+ソウル) を独立集計し AND 判定する条件句。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const dummySpirit: CardDefinition = {
  cardNo: "BSTH02-X01-TEST-SPIRIT",
  name: "field_core_sum_both_players テスト用",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const dummyGrandwalkerNexus: CardDefinition = {
  cardNo: "BSTH02-X01-TEST-GRANDWALKER-NEXUS",
  name: "field_core_sum_both_players テスト用 創界神ネクサス",
  printedCategory: "nexus",
  colors: ["purple"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
};

const cardNoMap = new Map<string, CardDefinition>([
  [dummySpirit.cardNo, dummySpirit],
  [dummyGrandwalkerNexus.cardNo, dummyGrandwalkerNexus],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function buildState(options: {
  aliceFieldNormalCores?: number[];
  bobFieldNormalCores?: number[];
  aliceReserveNormalCores?: number;
  bobReserveNormalCores?: number;
  aliceReserveSoulCores?: number;
  extraGrandwalkerCoresOnField?: { player: "alice" | "bob"; cores: number };
}): GameState {
  const aliceCards = (options.aliceFieldNormalCores ?? []).map((cores, i) =>
    createCardInstance(dummySpirit, {
      instanceId: `alice-spirit-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: cores,
    })
  );
  const bobCards = (options.bobFieldNormalCores ?? []).map((cores, i) =>
    createCardInstance(dummySpirit, {
      instanceId: `bob-spirit-${i}`,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: cores,
    })
  );
  const extraGrandwalker = options.extraGrandwalkerCoresOnField
    ? [
        createCardInstance(dummyGrandwalkerNexus, {
          instanceId: `${options.extraGrandwalkerCoresOnField.player}-grandwalker`,
          ownerPlayerId: options.extraGrandwalkerCoresOnField.player,
          controllerPlayerId: options.extraGrandwalkerCoresOnField.player,
          zone: "field",
          normalCoreCount: options.extraGrandwalkerCoresOnField.cores,
        }),
      ]
    : [];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        reserveNormalCoreCount: options.aliceReserveNormalCores ?? 0,
        reserveSoulCoreCount: options.aliceReserveSoulCores ?? 0,
      },
      { reserveNormalCoreCount: options.bobReserveNormalCores ?? 0 },
    ],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [...aliceCards, ...bobCards, ...extraGrandwalker],
  };
}

describe("BSTH02-X01 field_core_sum_both_players condition primitive", () => {
  it("自分3(field)+2(reserve)=5、相手5(field)=5 → 両者5以上で成立", () => {
    const state = buildState({
      aliceFieldNormalCores: [3],
      aliceReserveNormalCores: 2,
      bobFieldNormalCores: [5],
    });
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_core_sum_both_players", min: 5 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("自分4のみ(相手は5以上) → 不成立 (self が閾値未満)", () => {
    const state = buildState({
      aliceFieldNormalCores: [4],
      bobFieldNormalCores: [5],
    });
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_core_sum_both_players", min: 5 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相手4のみ(自分は5以上) → 不成立 (opponent が閾値未満)", () => {
    const state = buildState({
      aliceFieldNormalCores: [5],
      bobFieldNormalCores: [4],
    });
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_core_sum_both_players", min: 5 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("ソウルコアも合算対象 (generic「コア」は soul 含む)", () => {
    const state = buildState({
      aliceFieldNormalCores: [2],
      aliceReserveNormalCores: 0,
      aliceReserveSoulCores: 3,
      bobFieldNormalCores: [5],
    });
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_core_sum_both_players", min: 5 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("excludeGrandwalker: true のとき creation-god ネクサスのコアは集計から除外される (BSTH02-X01 型)", () => {
    // alice: 通常スピリット2 + 創界神ネクサス10 (除外対象) = 除外後は 2 のみ → 5未満で不成立
    const state = buildState({
      aliceFieldNormalCores: [2],
      extraGrandwalkerCoresOnField: { player: "alice", cores: 10 },
      bobFieldNormalCores: [5],
    });
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_core_sum_both_players",
            min: 5,
            excludeGrandwalker: true,
          },
        ],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("excludeGrandwalker 省略時は創界神ネクサスのコアも合算に含む (対称確認)", () => {
    const state = buildState({
      aliceFieldNormalCores: [2],
      extraGrandwalkerCoresOnField: { player: "alice", cores: 10 },
      bobFieldNormalCores: [5],
    });
    expect(
      evaluateCondition(
        state,
        [{ kind: "field_core_sum_both_players", min: 5 }],
        "n/a",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });
});
