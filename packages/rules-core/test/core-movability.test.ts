/**
 * P3-47 F-5 Step 1: core-movability helper の単体テスト。
 *
 * `canMoveCoresFrom` は「自分のコア1個以上をそれらのカードに置く」 (フランドール
 * 【フォーオブアカインド】) など、`from: { kind: "any_movable_self" }` 展開時に
 * フィールドカードがコア移動元になり得るかを判定する。
 */
import { describe, it, expect } from "vitest";
import { canMoveCoresFrom } from "../src/core/core-movability";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  GrandwalkerData,
} from "../src/model";

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
    tribe: "紅魔",
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
    instanceId: "test-card",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(
  card: CardInstance,
  opts: { soulOnCard?: boolean } = {}
): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
    playerOverrides: opts.soulOnCard
      ? [{ soulCoreLocation: { kind: "card", instanceId: card.instanceId } }]
      : undefined,
  });
}

const grandwalkerStub: GrandwalkerData = {
  kind: "grandwalker",
  oracleTriggerKinds: ["summon"] as const,
  oracleConditions: [],
};

describe("canMoveCoresFrom", () => {
  it("通常スピリット (normalCoreCount >= 1) はソース可", () => {
    const def = makeDef();
    const card = makeInstance(def, { normalCoreCount: 2 });
    expect(canMoveCoresFrom(makeState(card), card, def)).toBe(true);
  });

  it("コア 0 のスピリット (フィールドにいないはずだが) はソース不可", () => {
    const def = makeDef();
    const card = makeInstance(def, { normalCoreCount: 0 });
    expect(canMoveCoresFrom(makeState(card), card, def)).toBe(false);
  });

  it("ソウルコアのみ持つカード (通常コア 0) はソース可", () => {
    const def = makeDef();
    const card = makeInstance(def, { normalCoreCount: 0 });
    expect(
      canMoveCoresFrom(makeState(card, { soulOnCard: true }), card, def)
    ).toBe(true);
  });

  it("創界神ネクサスはコア >= 1 でもソース不可", () => {
    const def = makeDef({
      printedCategory: "nexus",
      grandwalkerData: grandwalkerStub,
    });
    const card = makeInstance(def, { normalCoreCount: 3 });
    expect(canMoveCoresFrom(makeState(card), card, def)).toBe(false);
  });

  it("導界者ネクサス (kind=guided) もソース不可", () => {
    const def = makeDef({
      printedCategory: "nexus",
      grandwalkerData: { ...grandwalkerStub, kind: "guided" },
    });
    const card = makeInstance(def, { normalCoreCount: 1 });
    expect(canMoveCoresFrom(makeState(card), card, def)).toBe(false);
  });

  it("def 未取得 (undefined) はソース不可 (定義なしカード除外)", () => {
    const def = makeDef();
    const card = makeInstance(def, { normalCoreCount: 5 });
    expect(canMoveCoresFrom(makeState(card), card, undefined)).toBe(false);
  });

  it("裏向きカード (faceDown=true) でもコアを保持していればソース可 (helper 自身は faceDown を許容)", () => {
    const def = makeDef();
    const card = makeInstance(def, {
      normalCoreCount: 1,
      faceDown: true,
    });
    expect(canMoveCoresFrom(makeState(card), card, def)).toBe(true);
  });
});
