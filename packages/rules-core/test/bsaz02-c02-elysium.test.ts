/**
 * BSAZ02-C02「エリシウム」effects[0,1] 検証。
 *
 * 原文 (textLines[2,4,5,7,8]):
 *   【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3
 *   このアルティメットは、アタックできず、相手のコスト5以下の効果を受けない。
 *   Lv3『各ステップ開始時』
 *   このアルティメット以外のスピリット/アルティメット/相手のネクサスすべてを指定する。
 *   このターンの間、指定したスピリット/アルティメット/ネクサスすべてのLvコスト+1する。
 *
 * 検証点:
 *  - effects[0]: prevent_battle(attack) + effect_immunity(sourceScope.maxCost:5)
 *    （BSLH01-C08「相手のコスト5以下の効果を受けない」precedent 同型、アルドノアドライブ
 *    ゲート付き）。
 *  - effects[1]: override_properties.levelCostDelta を (スピリット/アルティメット=either
 *    excludeSelf) + (ネクサス=opponent) の2 group に分割 (BSKB01-M01/BSLH01-M04 precedent、
 *    count:"all" は BSFT01.ts precedent) で適用する。levelCostDelta は効果耐性/対象取得 gate
 *    の対象なので、count:"all" でも dynamic global CE にはせず、resolveTargets() が確定した
 *    gate 後の各対象へ snapshot per-instance CE を張る（global 高速パスは addTribes 専用）。
 *    excludeSelf は resolveTargetSpec 側の既存 excludeInstanceId 機構で処理され、0件なら no-op。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getEffectiveLevelCostDelta } from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const C02 = card("BSAZ02-C02");

function srcC02() {
  const src = createCardInstance(C02, {
    instanceId: "src-c02",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv3
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-c02",
  });
}

function runEffect(state: GameState, effectIndex: number): GameState {
  return executeEffect({
    chainId: "test:bsaz02-c02-elysium:75",
    state,
    effect: C02.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId: "src-c02",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

describe("BSAZ02-C02 effects[0]（Lv3継続: アタックできず + コスト5以下の相手効果を受けない）", () => {
  it("prevent_battle(attack) CE が登録される", () => {
    const src = srcC02();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const pb = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "prevent_battle_attack" &&
        ce.targetInstanceId === "src-c02"
    );
    expect(pb).toBeDefined();
  });

  it("コスト5以下の相手発生源には免疫が成立し、コスト6の相手発生源には成立しない", () => {
    const src = srcC02();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const target = after.cardInstances.find((c) => c.instanceId === "src-c02")!;

    const cheapSource: CardDefinition = {
      ...card("BSDB01-C05"),
      cost: 5,
    };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: cheapSource,
      })
    ).toBe(true);

    const expensiveSource: CardDefinition = {
      ...card("BSDB01-C05"),
      cost: 6,
    };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: expensiveSource,
      })
    ).toBe(false);
  });
});

describe("BSAZ02-C02 effects[1]（Lv3各ステップ開始時: 自分以外のスピ/アルティ+相手ネクサスのLvコスト+1）", () => {
  function setUp() {
    const src = srcC02();
    const aliceOther = createCardInstance(card("BSSL01-M01"), {
      instanceId: "alice-other",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const bobUnit = createCardInstance(card("BSSL01-M01"), {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const bobNexus = createCardInstance(card("BSAZ02-C09"), {
      instanceId: "bob-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const aliceNexus = createCardInstance(card("BSAZ02-C09"), {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        underFiller(),
        aliceOther,
        bobUnit,
        bobNexus,
        aliceNexus,
      ],
    });
    return runEffect(state, 1);
  }

  it("自分以外のスピリット/アルティメット(両陣営)+相手ネクサスに+1、自身と相手でないネクサスは対象外", () => {
    const after = setUp();
    const byId = (id: string) =>
      after.cardInstances.find((c) => c.instanceId === id)!;
    const defOf = (id: string) => getDef(byId(id).definitionId)!;

    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("alice-other"),
        defOf("alice-other"),
        getDef
      )
    ).toBe(1);
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("bob-unit"),
        defOf("bob-unit"),
        getDef
      )
    ).toBe(1);
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("bob-nexus"),
        defOf("bob-nexus"),
        getDef
      )
    ).toBe(1);
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("alice-nexus"),
        defOf("alice-nexus"),
        getDef
      )
    ).toBe(0);
    // 自分自身は「このアルティメット以外」で除外される。
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("src-c02"),
        defOf("src-c02"),
        getDef
      )
    ).toBe(0);
  });

  it('count:"all" の levelCostDelta は gate 後の対象へ snapshot CE を張る', () => {
    const after = setUp();
    const lvCostCes = after.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        (ce.metadata?.properties as Record<string, unknown> | undefined)
          ?.levelCostDelta === 1
    );
    const targetIds = lvCostCes
      .map((ce) => ce.targetInstanceId)
      .filter((id): id is string => id !== undefined);

    expect(lvCostCes.some((ce) => ce.targetFilter !== undefined)).toBe(false);
    expect(targetIds).toEqual(
      expect.arrayContaining(["alice-other", "bob-unit", "bob-nexus"])
    );
    expect(targetIds).not.toContain("src-c02");
    expect(targetIds).not.toContain("alice-nexus");
  });

  it("境界条件: 他のスピリット/アルティメットがフィールドに存在しない（0件マッチ）とき、自分自身にも levelCostDelta が付与されない", () => {
    // filter が0件マッチすると resolveTargets() が undefined を返し、
    // native-ce-registration-handlers.ts の isAllScopeFilter 高速パスに到達しうる
    // （通常ケースの per-instance 経路とは別の経路）。この経路でも自己除外が保たれることを検証する。
    const src = srcC02();
    const bobNexus = createCardInstance(card("BSAZ02-C09"), {
      instanceId: "bob-nexus",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), bobNexus],
    });
    const after = runEffect(state, 1);
    const byId = (id: string) =>
      after.cardInstances.find((c) => c.instanceId === id)!;
    const defOf = (id: string) => getDef(byId(id).definitionId)!;

    // ネクサス group は1件マッチするので +1。
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("bob-nexus"),
        defOf("bob-nexus"),
        getDef
      )
    ).toBe(1);
    // スピリット/アルティメット group は0件マッチ（自分以外に対象なし）。
    // 自分自身が誤って global CE にマッチしないことを確認する。
    expect(
      getEffectiveLevelCostDelta(
        after,
        byId("src-c02"),
        defOf("src-c02"),
        getDef
      )
    ).toBe(0);
  });
});
