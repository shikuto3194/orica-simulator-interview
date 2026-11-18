/**
 * bounce destination:"set_aside"（「手元に置く」）の検証。
 *
 * SBR 上バウンスは手札 / デッキ / 手元へ戻す単一カテゴリで、差は理由と移動先のみ
 * （10_rules/04_state-based-rules.md）。destination 省略時は従来どおり手札、
 * "set_aside" 指定でフィールド→手元（オープンゾーン、handCount に含めない）へ移動する。
 *
 * 代表カード: BSTS01-M01［黒風星狼］ランガ バースト
 *   「相手のスピリット/アルティメット2体を手元に置く」。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeBounce,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "暴嵐",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const SP = spiritDef("SP-1");

function getCardDef(id: string): CardDefinition | undefined {
  return id === "SP-1" ? SP : undefined;
}

function fieldSpirit(
  instanceId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(SP, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

describe("bounce destination:set_aside（手元に置く）", () => {
  it("相手スピリット2体を手元(set_aside)へ移動し、handCount は増えない", () => {
    const s1 = fieldSpirit("s1", BOB);
    const s2 = fieldSpirit("s2", BOB);
    const state = makeState([s1, s2]);
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const handBefore = bobBefore.handCount;

    const queued = executeBounce(
      state,
      ALICE,
      {
        kind: "bounce",
        target: {
          player: "opponent",
          category: ["spirit", "ultimate"],
          count: 2,
        },
        destination: "set_aside",
      },
      getCardDef,
      "alice-src"
    );
    const result = flushPendingLeaves(queued, getCardDef);

    const r1 = result.cardInstances.find((c) => c.instanceId === "s1")!;
    const r2 = result.cardInstances.find((c) => c.instanceId === "s2")!;
    expect(r1.zone).toBe("set_aside");
    expect(r2.zone).toBe("set_aside");
    // 手元はオープンゾーン: 手札枚数には加算されない
    const bobAfter = result.players.find((p) => p.id === BOB)!;
    expect(bobAfter.handCount).toBe(handBefore);
    // コアはリザーブへ戻る（1 体 1 コア × 2）
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 2
    );
    // ログに to_set_aside が記録される
    expect(
      result.log.some((l) => l.includes("effect:bounce:s1:to_set_aside"))
    ).toBe(true);
  });

  it("destination 省略時は従来どおり手札へ戻り handCount が増える", () => {
    const s1 = fieldSpirit("s1", BOB);
    const state = makeState([s1]);
    const handBefore = state.players.find((p) => p.id === BOB)!.handCount;

    const queued = executeBounce(
      state,
      ALICE,
      {
        kind: "bounce",
        target: { player: "opponent", category: ["spirit"], count: 1 },
      },
      getCardDef,
      "alice-src"
    );
    const result = flushPendingLeaves(queued, getCardDef);

    const r1 = result.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(r1.zone).toBe("hand");
    expect(result.players.find((p) => p.id === BOB)!.handCount).toBe(
      handBefore + 1
    );
  });
});
