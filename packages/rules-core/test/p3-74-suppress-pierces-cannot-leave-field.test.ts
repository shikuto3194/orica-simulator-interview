/**
 * P3-74 Phase A: `suppressDestroyedEffects` (「効果は発揮されない」) を伴う破壊効果は
 * `cannot_leave_field` 常時効果を貫通する (Q19 裁定 2026-01-17)。
 *
 * 公式 Q&A:
 *   Q19: 美鈴の「離れない」効果は、レミリアのような相手の「発揮させない/発揮されない」状態の
 *        破壊効果、「手札/デッキに戻す」効果などを受けたときはフィールドを離れるの?
 *        A: はい。離れます。
 *
 * 保守的スコープ: Q19 は `cannot_leave_field` のみを言及。outcome-specific な
 * `cannot_be_destroyed` 等は貫通対象外として扱う。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeDestroy,
  executeEffectResistance,
} from "../src";
import { filterOutResistantCards } from "../src/effect/effect-resistance-check";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string, tribes: string[]): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: tribes.join("・"),
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const 紅魔スピリット = spiritDef("KMS-1", ["幻想", "紅魔"]);

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "KMS-1") return 紅魔スピリット;
  return undefined;
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

function fieldSpirit(
  instanceId: string,
  defId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(getCardDef(defId)!, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

/** 美鈴型: cannot_leave_field 常時効果を持つスピリット */
function setupCannotLeaveFieldSpirit(): GameState {
  const target = fieldSpirit("s1", "KMS-1", ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_leave_field",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    "s1",
    getCardDef
  );
  return state;
}

/** cannot_be_destroyed (outcome-specific) を持つスピリット */
function setupCannotBeDestroyedSpirit(): GameState {
  const target = fieldSpirit("s2", "KMS-1", ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_be_destroyed",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    "s2",
    getCardDef
  );
  return state;
}

describe("P3-74 Phase A: suppressDestroyedEffects pierces cannot_leave_field (Q19)", () => {
  it("filterOutResistantCards: pierceCannotLeaveField=true で cannot_leave_field を貫通", () => {
    const state = setupCannotLeaveFieldSpirit();
    const target = state.cardInstances.find((c) => c.instanceId === "s1")!;

    const baseline = filterOutResistantCards(
      state,
      [target],
      "destroy",
      BOB,
      getCardDef
    );
    expect(baseline.allowed.length).toBe(0);
    expect(baseline.blocked.length).toBe(1);

    const pierced = filterOutResistantCards(
      state,
      [target],
      "destroy",
      BOB,
      getCardDef,
      "none",
      true
    );
    expect(pierced.allowed.length).toBe(1);
    expect(pierced.blocked.length).toBe(0);
  });

  it("filterOutResistantCards: pierceCannotLeaveField=true でも cannot_be_destroyed は貫通しない (Q19 スコープ外)", () => {
    const state = setupCannotBeDestroyedSpirit();
    const target = state.cardInstances.find((c) => c.instanceId === "s2")!;

    const pierced = filterOutResistantCards(
      state,
      [target],
      "destroy",
      BOB,
      getCardDef,
      "none",
      true
    );
    expect(pierced.allowed.length).toBe(0);
    expect(pierced.blocked.length).toBe(1);
  });

  it("executeDestroy + suppressDestroyedEffects: 美鈴型 cannot_leave_field を貫通して破壊待機", () => {
    const state = setupCannotLeaveFieldSpirit();

    // 「発揮されない」無し: 通常通り阻止される (Q16/Q18 動作: 破壊判定の有無は Phase B で別途扱う)
    const blocked = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === "s1")?.pendingLeaveKind
    ).toBeNull();

    // 「発揮されない」付き: cannot_leave_field を貫通して破壊待機に入る (Q19)
    const pierced = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      pierced.cardInstances.find((c) => c.instanceId === "s1")?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("executeDestroy + suppressDestroyedEffects: cannot_be_destroyed は貫通しない", () => {
    const state = setupCannotBeDestroyedSpirit();

    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "s2")?.pendingLeaveKind
    ).toBeNull();
  });

  it("suppressDestroyedEffects='all_opponent' でも cannot_leave_field を貫通", () => {
    const state = setupCannotLeaveFieldSpirit();
    const pierced = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "all_opponent",
      "none"
    );
    expect(
      pierced.cardInstances.find((c) => c.instanceId === "s1")?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("Phase C ログ: Q19 貫通時に cannot-leave-field-pierced ログが出る", () => {
    const state = setupCannotLeaveFieldSpirit();
    const pierced = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      pierced.log.some((l) =>
        l.startsWith("effect:destroy:cannot-leave-field-pierced:bob:s1")
      )
    ).toBe(true);
  });

  it("Phase C ログ: pierce 無し (耐性無しカード) では pierced ログが出ない", () => {
    // 耐性なしカード単体
    const target = fieldSpirit("s3", "KMS-1", ALICE);
    const state = makeState([target]);
    const result = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only", // suppressDestroyedEffects 付き
      "none"
    );
    // 対象に cannot_leave_field 効果がないので、pierce フラグは立っているが「実際に貫通した」状況ではない
    expect(
      result.log.some((l) =>
        l.startsWith("effect:destroy:cannot-leave-field-pierced:")
      )
    ).toBe(false);
  });
});
