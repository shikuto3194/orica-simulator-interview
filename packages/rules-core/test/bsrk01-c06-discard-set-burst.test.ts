/**
 * BSRK01-C06 飛天御剣流『飛龍閃』 effect[1]:
 *   「スタック〔自分のメインステップ/お互いのアタックステップ〕相手のバースト1つを破棄する。」
 *
 * 新規プリミティブ `discard_set_burst` の最終盤面 assertion。
 * セット中バーストはコアを持たない裏向きカードのため、破棄結果は
 * setBurstStates から除去 + 当該 cardInstance.zone="trash" の2点で表現する。
 *
 * カード本文: 5ステップ「スタック / 〔自分のメインステップ/お互いのアタックステップ〕
 * 相手のバースト1つを破棄する。」(BSRK01-C06)
 */
import { describe, expect, it } from "vitest";
import { executeDiscardSetBurst } from "../src/mechanics/burst-system";
import { createCardInstance, createEmptyGameState } from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { Effect } from "../src/dsl-types";

// バースト裏向きカード (装填側): セットされて zone:"burst" にあると仮定。
const oppBurstCard: CardDefinition = {
  cardNo: "TEST-OPP-BURST",
  name: "テスト相手バースト",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: ["【バースト：適当】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
};

function makeStateWithBursts(burstCount: number): GameState {
  const cards = [];
  const burstStates = [];
  for (let i = 0; i < burstCount; i++) {
    const id = `bob-burst-${i}`;
    cards.push(
      createCardInstance(oppBurstCard, {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "burst",
      })
    );
    burstStates.push({ playerId: "bob", cardInstanceId: id });
  }
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  });
  return {
    ...base,
    setBurstStates: burstStates,
  };
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === oppBurstCard.cardNo ? oppBurstCard : undefined;

describe("BSRK01-C06 discard_set_burst プリミティブ", () => {
  it("BSRK01-C06: 相手バースト1つを破棄 → setBurstStates から消え該当カードは trash へ", () => {
    const state = makeStateWithBursts(2);
    expect(state.setBurstStates).toHaveLength(2);
    const result = executeDiscardSetBurst(
      state,
      "bob",
      1,
      getCardDefinitionById
    );
    // setBurstStates: 1件減 (残るのは 2つ目以降)
    expect(result.setBurstStates).toHaveLength(1);
    expect(result.setBurstStates[0]!.cardInstanceId).toBe("bob-burst-1");
    // 破棄された "bob-burst-0" は trash へ
    const discarded = result.cardInstances.find(
      (c) => c.instanceId === "bob-burst-0"
    )!;
    expect(discarded.zone).toBe("trash");
    // 残ったバーストは zone:"burst" のまま
    const remaining = result.cardInstances.find(
      (c) => c.instanceId === "bob-burst-1"
    )!;
    expect(remaining.zone).toBe("burst");
    // ログに痕跡
    expect(
      result.log.some((l) =>
        l.startsWith("effect:discard_set_burst:bob:bob-burst-0")
      )
    ).toBe(true);
  });

  it("BSRK01-C06: 対象バースト0件なら no-bursts ログのみで state は不変", () => {
    const state = makeStateWithBursts(0);
    const result = executeDiscardSetBurst(
      state,
      "bob",
      1,
      getCardDefinitionById
    );
    expect(result.setBurstStates).toHaveLength(0);
    expect(result.cardInstances).toEqual(state.cardInstances);
    expect(
      result.log.some((l) =>
        l.startsWith("effect:discard_set_burst:bob:0:no-bursts")
      )
    ).toBe(true);
  });

  it("BSRK01-C06: count が実在枚数を超えても上限クリップ(2件中3枚要求→2枚破棄)", () => {
    const state = makeStateWithBursts(2);
    const result = executeDiscardSetBurst(
      state,
      "bob",
      3,
      getCardDefinitionById
    );
    expect(result.setBurstStates).toHaveLength(0);
    const trashed = result.cardInstances.filter((c) => c.zone === "trash");
    expect(trashed).toHaveLength(2);
  });

  it("BSRK01-C06: count<=0 は no-op (state そのまま)", () => {
    const state = makeStateWithBursts(2);
    const result = executeDiscardSetBurst(
      state,
      "bob",
      0,
      getCardDefinitionById
    );
    expect(result).toBe(state);
  });

  it("BSRK01-C06: 自分(alice)のバーストは対象外", () => {
    const state = makeStateWithBursts(1);
    // bob のバーストが 1件積まれている → alice 指定では何も破棄されない
    const result = executeDiscardSetBurst(
      state,
      "alice",
      1,
      getCardDefinitionById
    );
    expect(result.setBurstStates).toHaveLength(1);
    expect(result.setBurstStates[0]!.playerId).toBe("bob");
  });
});

// ENGINE-composite-heterogeneous-removal-budget: DiscardSetBurstAction.count を
// 固定 number から Count (DynamicCount 可) へ拡張した (BSTH09-X01 準備、dsl-types.ts
// DiscardSetBurstAction コメント参照)。DSL action 層 (resolveTargets /
// native-action-registry の discard_set_burst ハンドラ) を経由した単一動的値解決を
// 直接 executeDiscardSetBurst を呼ぶ既存テストとは別に検証する。
describe("discard_set_burst action.count の DynamicCount 解決 (ENGINE-composite-heterogeneous-removal-budget)", () => {
  const aliceSource: CardDefinition = {
    cardNo: "TEST-ALICE-SOURCE",
    name: "テスト発動元",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const getDef = (id: string): CardDefinition | undefined =>
    id === aliceSource.cardNo
      ? aliceSource
      : id === oppBurstCard.cardNo
        ? oppBurstCard
        : undefined;

  it("count: DynamicCount(cards_in_zone opponent burst) が相手バースト全数を動的に解決して全破棄する", () => {
    const bursts = makeStateWithBursts(3);
    const src = createCardInstance(aliceSource, {
      instanceId: "alice-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state: GameState = {
      ...bursts,
      cardInstances: [...bursts.cardInstances, src],
    };
    const effect: Effect = {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "discard_set_burst",
            player: "opponent",
            count: {
              source: {
                kind: "cards_in_zone",
                zone: "burst",
                player: "opponent",
              },
            },
          },
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:bsrk01-c06-discard-set-burst:206",
      state,
      effect,
      sourceInstanceId: "alice-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.setBurstStates).toHaveLength(0);
    const trashed = after.cardInstances.filter((c) => c.zone === "trash");
    expect(trashed).toHaveLength(3);
  });
});
