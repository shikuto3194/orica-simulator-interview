/**
 * 創界神ネクサスコア除去プリミティブ (core_move from field_card / targetsGrandwalker)
 * の横展開検証。BSTH02-M03 / BSTH03-M03 の grandwalker コア除去ステップが
 * 「相手の創界神ネクサス」のみを対象に正しくコアをボイドへ移すことを盤面で確認する。
 *
 * 正源: 10_rules/06_core-system.md L130/L136（相手のコアを相手側ボイドへ移動）/
 * [[project_core_move_field_card_grandwalker_strip]]。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function withGrandwalker(
  extra: Partial<GameState>,
  self: ReturnType<typeof createCardInstance>
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
    instanceId: "bob-grandwalker",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 6,
  });
  // 創界神でない通常ネクサス（巻き込まれないことの確認用）。
  const plainNexus = createCardInstance(cardNoMap.get("BSTH08-C04")!, {
    instanceId: "bob-plain",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 5,
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [self, grandwalker, plainNexus],
    ...extra,
  };
}

describe("BSTH02-M03 Lv2-3 アタック時: 創界神ネクサスのコア4個ボイド", () => {
  const card = cardNoMap.get("BSTH02-M03")!;
  it("effects[2] は creature-only core_move（stub 解消）", () => {
    const e = card.effects![2]!;
    expect(e.stub).toBeUndefined();
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("core_move");
    if (a.kind === "core_move") {
      expect(a.amount).toBe(4);
      expect(a.from.kind).toBe("field_card");
      if (a.from.kind === "field_card") {
        // P3-137: tribes:["創界神"] narrowing 除去、導界者ネクサスも対象に含める。
        expect(a.from.filter?.targetsGrandwalker).toBe("only");
      }
    }
  });

  it("実行で創界神ネクサスのコアが4個ボイドへ（通常ネクサスは不変）", () => {
    const self = createCardInstance(card, {
      instanceId: "yuyuko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const state = withGrandwalker({}, self);
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:78",
      state,
      effect: card.effects![2]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-grandwalker")!
        .normalCoreCount
    ).toBe(2);
    // 創界神でない通常ネクサスのコアは巻き込まれない。
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-plain")!
        .normalCoreCount
    ).toBe(5);
  });

  it("[board] 導界者ネクサスも創界神対象効果を受ける (P3-137、10_rules/07 §55)", () => {
    const self = createCardInstance(card, {
      instanceId: "yuyuko-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    // BSLH01-X01 = [導界者]キーア (tribe: "導界者・CB・S.S.S")。
    const guidedNexus = createCardInstance(cardNoMap.get("BSLH01-X01")!, {
      instanceId: "bob-guided",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 6,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, guidedNexus],
    };
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:119",
      state,
      effect: card.effects![2]!,
      sourceInstanceId: "yuyuko-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(2);
  });
});

describe("BSTH02-M03 バースト: 相手の創界神ネクサス1つのコアすべてボイド", () => {
  const card = cardNoMap.get("BSTH02-M03")!;
  it("effects[1] は target+core_move(target_card, all) + summon（stub 解消）", () => {
    const e = card.effects![1]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toMatchObject({ kind: "burst" });
    const move = e.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.amount).toBe("all");
      expect(move.from).toEqual({ kind: "target_card" });
      expect(move.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
      if (move.target && move.target.kind === "filter") {
        expect(move.target.filter?.targetsGrandwalker).toBe(true);
        // 10_rules/07 §55: 導界者ネクサスも創界神ネクサス対象効果を受ける。
        expect(move.target.filter?.tribes).toEqual(["導界者", "創界神"]);
      }
      expect(move.to).toEqual({ kind: "void", player: "opponent" });
    }
    expect(e.steps[1]).toMatchObject({
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      connector: "sequential",
    });
  });

  it("[board] 選んだ相手の創界神ネクサス1つの全コアのみが相手ボイドへ（同列の通常ネクサス・他創界神は不変）", () => {
    const self = createCardInstance(card, {
      instanceId: "reimu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const targetGw = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-gw-tgt",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const otherGw = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-gw-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const plain = createCardInstance(cardNoMap.get("BSTH08-C04")!, {
      instanceId: "bob-plain",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, targetGw, otherGw, plain],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-1" }],
    };
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:202",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["bob-gw-tgt"],
    });
    // 選んだ創界神 (5→0) のみが空になり、他の創界神/通常ネクサスは不変。
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-gw-tgt")!
        .normalCoreCount
    ).toBe(0);
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-gw-other")!
        .normalCoreCount
    ).toBe(3);
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-plain")!
        .normalCoreCount
    ).toBe(4);
    const bob = result.players.find((p) => p.id === "bob")!;
    // 全 5 個が相手ボイドへ。
    expect(bob.voidNormalCoreCount).toBeGreaterThanOrEqual(5);
  });

  it("[board] 導界者ネクサスも 創界神 対象効果を受ける (10_rules/07 §55)", () => {
    const self = createCardInstance(card, {
      instanceId: "reimu-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // BSLH01-X01 = [導界者]キーア (tribe: "導界者・CB・S.S.S")。
    const guidedNexus = createCardInstance(cardNoMap.get("BSLH01-X01")!, {
      instanceId: "bob-guided",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, guidedNexus],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-2" }],
    };
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:251",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["bob-guided"],
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(0);
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.voidNormalCoreCount).toBeGreaterThanOrEqual(4);
  });
});

describe("BSTH03-M03 バースト: 創界神ネクサスのコアすべてボイド", () => {
  const card = cardNoMap.get("BSTH03-M03")!;
  it("effects[0] は core_move(all) + summon（stub 解消）", () => {
    const e = card.effects![0]!;
    expect(e.stub).toBeUndefined();
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("core_move");
    if (a.kind === "core_move") {
      expect(a.amount).toBe("all");
      if (a.from.kind === "field_card") {
        // P3-137: tribes:["創界神"] narrowing 除去、導界者ネクサスも対象に含める。
        expect(a.from.filter?.targetsGrandwalker).toBe("only");
      }
    }
    expect(e.steps[1]!.action.kind).toBe("summon");
  });

  it("実行で創界神ネクサスの全コアがボイドへ（通常ネクサスは不変）", () => {
    const self = createCardInstance(card, {
      instanceId: "remilia-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state = withGrandwalker(
      { setBurstStates: [{ playerId: "alice", cardInstanceId: "remilia-1" }] },
      self
    );
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:296",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "remilia-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-grandwalker")!
        .normalCoreCount
    ).toBe(0);
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-plain")!
        .normalCoreCount
    ).toBe(5);
  });

  it("[board] 導界者ネクサスも創界神対象効果を受ける (P3-137、10_rules/07 §55)", () => {
    const self = createCardInstance(card, {
      instanceId: "remilia-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const guidedNexus = createCardInstance(cardNoMap.get("BSLH01-X01")!, {
      instanceId: "bob-guided",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, guidedNexus],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "remilia-2" }],
    };
    const result = executeEffect({
      chainId: "test:grandwalker-core-strip-extension:335",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "remilia-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(0);
  });
});
