/**
 * BSKB01-X01 [英雄を討ち倒し者]メタナイト effects[0]
 *   【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』
 *   ターンに1回、相手のフィールドのコア3個までをトラッシュに置ける。
 *
 * stale-stub sweep: 従来の stub 注記は「煌臨中条件は条件句未対応」としていたが、
 * self_state.advented (10_rules/08a L34) は既存プリミティブとして配線済みだった
 * (BSRK01-X02 effects[1] precedent)。OC = count_value(self,min:7) と AND 結合する
 * condition 節を追加し、煌臨中でなければ発動条件が成立しないことを検証する。
 *
 * ENGINE-paid-prevention-immunity-card-cost Step4: 「鋼騎士3枚除外で防げない」は
 * effects[2] の grant_paid_prevention_immunity (scope.effectIndex:0) で配線済み。
 * stub は解消。effects[0] 自体に stub は無い。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";
import { getPaidPreventionImmunityCost } from "../src/effect/effect-resistance-check";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function placeMetaknight(opts: { advented: boolean; countValue: number }): {
  state: GameState;
  selfId: string;
} {
  const def = cardNoMap.get("BSKB01-X01")!;
  const selfId = "meta-1";
  const card: CardInstance = createCardInstance(def, {
    instanceId: selfId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const withAdvent: CardInstance = opts.advented
    ? {
        ...card,
        underCards: [{ cardInstanceId: "meta-src", role: "advent_source" }],
      }
    : card;
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ countValue: opts.countValue }, {}],
  });
  return {
    state: { ...base, activePlayerId: ALICE, cardInstances: [withAdvent] },
    selfId,
  };
}

describe("BSKB01-X01 effects[0] 【OC中＆煌臨中】相手コア3個までトラッシュ (stale-stub sweep)", () => {
  const def = cardNoMap.get("BSKB01-X01");

  it("effects[0].condition が count_value(7) + self_state.advented を持つ", () => {
    expect(def).toBeDefined();
    const e = def!.effects![0]!;
    expect(e.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
      { kind: "self_state", state: "advented" },
    ]);
    expect(e.stub).toBeUndefined();
  });

  it("OC7 ∧ 煌臨中 → condition 成立", () => {
    const { state, selfId } = placeMetaknight({
      advented: true,
      countValue: 7,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![0]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("OC7 だが煌臨元なし (advented=false) → condition 不成立", () => {
    const { state, selfId } = placeMetaknight({
      advented: false,
      countValue: 7,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![0]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("煌臨中だが count=6 (OC未達) → condition 不成立", () => {
    const { state, selfId } = placeMetaknight({
      advented: true,
      countValue: 6,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![0]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("BSKB01-X01 effects[1] 【OC中＆煌臨中】アタック時BP比較破壊 (adversarial verifier 反証修正)", () => {
  const def = cardNoMap.get("BSKB01-X01");

  it("effects[1].condition が count_value(7) + self_state.advented を持つ（effects[0]と同型）", () => {
    expect(def).toBeDefined();
    const e = def!.effects![1]!;
    expect(e.condition).toEqual([
      { kind: "count_value", player: "self", min: 7 },
      { kind: "self_state", state: "advented" },
    ]);
  });

  it("OC7 ∧ 煌臨中 → condition 成立", () => {
    const { state, selfId } = placeMetaknight({
      advented: true,
      countValue: 7,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![1]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("OC7 だが煌臨元なし (advented=false) → condition 不成立 (修正前は誤って成立していた)", () => {
    const { state, selfId } = placeMetaknight({
      advented: false,
      countValue: 7,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![1]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("煌臨中だが count=6 (OC未達) → condition 不成立", () => {
    const { state, selfId } = placeMetaknight({
      advented: true,
      countValue: 6,
    });
    expect(
      evaluateCondition(
        state,
        def!.effects![1]!.condition!,
        selfId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("BSKB01-X01 effects[2] grant_paid_prevention_immunity scope (ENGINE-paid-prevention-immunity-card-cost Step4)", () => {
  const def = cardNoMap.get("BSKB01-X01")!;

  it("effects[2] が scope.effectIndex:0 の card-resource cost を持つ (『この効果は』= effects[0] 単一スコープ)", () => {
    const e = def.effects![2]!;
    expect(e.timing).toEqual({ kind: "continuous" });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("grant_paid_prevention_immunity");
    if (action.kind !== "grant_paid_prevention_immunity") {
      throw new Error("unreachable");
    }
    expect(action.scope).toEqual({ effectIndex: 0 });
    expect(action.cost).toEqual({
      resource: "card",
      amount: 3,
      zone: "trash",
      filter: { tribes: ["鋼騎士"] },
    });
  });

  it("コア除去効果 (effects[0]) の発揮では対価 offer されるが、BP比較破壊 (effects[1]) では offer されない", () => {
    const selfId = "meta-1";
    const self: CardInstance = createCardInstance(def, {
      instanceId: selfId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [self],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );

    expect(getPaidPreventionImmunityCost(rebuilt, selfId, 0)).toEqual({
      resource: "card",
      amount: 3,
      zone: "trash",
      filter: { tribes: ["鋼騎士"] },
    });
    expect(getPaidPreventionImmunityCost(rebuilt, selfId, 1)).toBeNull();
    expect(
      getPaidPreventionImmunityCost(rebuilt, selfId, undefined)
    ).toBeNull();
  });
});
