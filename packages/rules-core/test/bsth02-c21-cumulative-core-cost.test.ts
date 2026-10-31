/**
 * engine-bsth02-c21-cumulative-core-cost-fix の回帰テスト。
 *
 * BSTH02-C21 Lv2「自分の『西行妖』があるとき、相手のネクサスと、ゲーム中にコア1個以上を
 * 置かれた相手の創界神ネクサスのLv1コストを1にする。」を検証する。
 *
 * 「Lv1コスト」は 10_rules/03a_cost-payment.md の SSOT に従い
 * `levelDefs[0].requiredCores`（レベル維持に必要なコア数）を指し、召喚/使用コスト
 * (`card.cost`) とは別概念（adversarial verifier round1 refute で判明・修正）。
 *
 * - `CardInstance.everHadCorePlaced`（コア配置の一方向ラッチ）が normalCoreCount/soulCoreCount
 *   増加時にのみ立ち、コアが全て離れても false に戻らないこと
 * - 実カードの effects[1] を発揮すると、通常ネクサス向けと「創界神ネクサス限定 +
 *   everHadCorePlaced」向けの 2 本の override_properties(levelCost) CE が登録されること
 * - `getEffectiveLevel` がその CE を消費し、通常ネクサスと「コアを一度でも置かれた
 *   創界神ネクサス」の Lv1 必要コア数を 1 に上書きする一方、コア履歴の無い創界神ネクサスは
 *   印字 requiredCores のまま変化しないこと
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";
import {
  collectStateBasedActions,
  createEmptyGameState,
  createCardInstance,
  moveNormalCores,
  getEffectiveLevel,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const ALICE = "player-1";
const BOB = "player-2";

function nexusDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 3, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "テスト",
    ...overrides,
  };
}

function grandwalkerNexusDef(cardNo: string): CardDefinition {
  return nexusDef(cardNo, {
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
  });
}

function guidedNexusDef(cardNo: string): CardDefinition {
  return nexusDef(cardNo, {
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
  });
}

describe("CardInstance.everHadCorePlaced 一方向ラッチ", () => {
  it("moveNormalCores でコアが増えると true になり、全て離れても false に戻らない", () => {
    const def = nexusDef("LATCH-TEST-1");
    const card = createCardInstance(def, {
      instanceId: "latch-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    let state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "latch-1")
        ?.everHadCorePlaced
    ).toBe(false);

    state = moveNormalCores(
      state,
      { kind: "reserve", playerId: ALICE },
      { kind: "card", instanceId: "latch-1" },
      1
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "latch-1")
        ?.everHadCorePlaced
    ).toBe(true);

    state = moveNormalCores(
      state,
      { kind: "card", instanceId: "latch-1" },
      { kind: "reserve", playerId: ALICE },
      1
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "latch-1")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      state.cardInstances.find((c) => c.instanceId === "latch-1")
        ?.everHadCorePlaced
    ).toBe(true);
  });
});

describe("BSTH02-C21 Lv2: 西行妖連動 Lv1コスト(requiredCores)固定", () => {
  const card = cardNoMap.get("BSTH02-C21")!;
  const effect = card.effects![1]!;

  // 合成した相手カード定義 (nexusDef/grandwalkerNexusDef) は ALL_CARDS/cardNoMap に
  // 存在しないため、cardNoMap だけを引く getDef ではフィルタ解決の
  // getCardDefinitionById(candidate.definitionId) が undefined を返し候補が黙って
  // 脱落する。各テストの相手カード定義を defs に加えた合成 getDef を使うこと。
  function buildRegisteredState(
    opponentDefs: CardDefinition[],
    opponentCards: ReturnType<typeof createCardInstance>[]
  ): { state: GameState; getDef: (id: string) => CardDefinition | undefined } {
    const defMap = new Map(cardNoMap);
    for (const def of opponentDefs) defMap.set(def.cardNo, def);
    const getDef = (id: string): CardDefinition | undefined => defMap.get(id);

    const source = createCardInstance(card, {
      instanceId: "c21-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // requiredCores:3 -> Lv2
    });
    const saigyouayaDef = cardNoMap.get("BSTH02-X01")!;
    const saigyouaya = createCardInstance(saigyouayaDef, {
      instanceId: "saigyouaya-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, saigyouaya, ...opponentCards],
    });
    return {
      state: executeEffect({
        chainId: "test:bsth02-c21-cumulative-core-cost:152",
        state,
        effect,
        sourceInstanceId: "c21-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef,
    };
  }

  it("西行妖 + Lv2 が揃った時点で相手ネクサスが0件なら、通常ネクサス向け/創界神ネクサス限定(everHadCorePlaced)の2本とも動的メンバーシップCE(targetFilter)として登録される", () => {
    // resolveTargets の候補が0件のときのみ executeOverrideProperties の
    // isFilterTarget 判定が成立し、targetFilter ベースの動的メンバーシップ CE
    // (今後の新規対象にも自動追従) になる。既存 CardFilter で明示的に絞ってターゲット
    // ID を"事前確定"する経路は、対象が1件でも存在すると per-instance 経路に落ちる
    // （ENGINE-override-properties-dynamic-membership-preexisting-match、下記参照）。
    const { state } = buildRegisteredState([], []);
    const overrideCEs = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(overrideCEs).toHaveLength(2);
    for (const ce of overrideCEs) {
      expect(
        (ce.metadata?.properties as { levelCost?: { lv1: number } })?.levelCost
      ).toMatchObject({ lv1: 1 });
      expect(ce.targetInstanceId).toBeUndefined();
      expect(ce.targetFilter).toBeDefined();
    }
    const branch1 = overrideCEs.find(
      (ce) => ce.targetFilter?.targetsGrandwalker === undefined
    );
    const branch2 = overrideCEs.find(
      (ce) => ce.targetFilter?.targetsGrandwalker === "only"
    );
    expect(branch1?.targetFilter).toMatchObject({
      player: "opponent",
      category: ["nexus"],
    });
    expect(branch2?.targetFilter).toMatchObject({
      player: "opponent",
      category: ["nexus"],
      targetsGrandwalker: "only",
      everHadCorePlaced: true,
    });
    expect(branch2?.targetFilter?.grandwalkerKind).toBeUndefined();
  });

  it('登録時点で既に一致する相手ネクサスがあっても、count:"all" の levelCost は動的メンバーシップCEになる', () => {
    const plainDef = nexusDef("BOB-PLAIN-REG");
    const plain = createCardInstance(plainDef, {
      instanceId: "bob-plain-reg",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const { state, getDef } = buildRegisteredState([plainDef], [plain]);
    const overrideCEs = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    const branch1 = overrideCEs.find(
      (ce) => ce.targetFilter?.targetsGrandwalker === undefined
    );
    expect(branch1?.targetInstanceId).toBeUndefined();
    expect(branch1?.targetFilter).toMatchObject({
      player: "opponent",
      category: ["nexus"],
    });
    expect(
      (branch1?.metadata?.properties as { levelCost?: { lv1: number } })
        ?.levelCost
    ).toMatchObject({ lv1: 1 });

    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find((c) => c.instanceId === "bob-plain-reg")!,
        plainDef,
        getDef
      )
    ).toBe(1);

    const lateDef = nexusDef("BOB-PLAIN-REG-LATE");
    const late = createCardInstance(lateDef, {
      instanceId: "bob-plain-reg-late",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWithLateCard: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, late],
    };
    const getDefWithLate = (id: string): CardDefinition | undefined =>
      id === lateDef.cardNo ? lateDef : getDef(id);

    expect(
      getEffectiveLevel(stateWithLateCard, late, lateDef, getDefWithLate)
    ).toBe(1);
  });

  it("[dynamic] 登録後に新しく場へ出た相手の通常ネクサスにも自動追従してLv1コスト固定が効く", () => {
    const plainDef = nexusDef("BOB-PLAIN-LATE");
    // 登録時点では相手ネクサスが存在しない状態で先に効果を発揮させる。
    const { state: registeredState, getDef } = buildRegisteredState([], []);
    const overrideCEsBefore = registeredState.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(overrideCEsBefore).toHaveLength(2);

    // 登録後に相手が新規ネクサスを場に出す（executeEffect は再実行しない）。
    const late = createCardInstance(plainDef, {
      instanceId: "bob-plain-late",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWithLateCard: GameState = {
      ...registeredState,
      cardInstances: [...registeredState.cardInstances, late],
    };
    const getDefWithLate = (id: string): CardDefinition | undefined =>
      id === plainDef.cardNo ? plainDef : getDef(id);

    const lv = getEffectiveLevel(
      stateWithLateCard,
      stateWithLateCard.cardInstances.find(
        (c) => c.instanceId === "bob-plain-late"
      )!,
      plainDef,
      getDefWithLate
    );
    expect(lv).toBe(1);
  });

  it("[dynamic] global levelCost CE は include_all gate で cannot_include に遮断される", () => {
    const plainDef = nexusDef("BOB-PLAIN-LOCKED");
    const { state: registeredState, getDef } = buildRegisteredState([], []);
    const late = createCardInstance(plainDef, {
      instanceId: "bob-plain-locked",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const lockCe: ContinuousEffect = {
      effectId: "ce-cannot-include-lvcost",
      sourceInstanceId: "bob-lock-source",
      sourceDefinitionId: plainDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_include",
      targetInstanceId: late.instanceId,
      metadata: { source: "opponent_effect" },
    };
    const stateWithLateCard: GameState = {
      ...registeredState,
      cardInstances: [...registeredState.cardInstances, late],
      activeContinuousEffects: [
        ...registeredState.activeContinuousEffects,
        lockCe,
      ],
    };
    const getDefWithLate = (id: string): CardDefinition | undefined =>
      id === plainDef.cardNo ? plainDef : getDef(id);

    const lv = getEffectiveLevel(
      stateWithLateCard,
      stateWithLateCard.cardInstances.find(
        (c) => c.instanceId === "bob-plain-locked"
      )!,
      plainDef,
      getDefWithLate
    );
    expect(lv).toBe(0);
  });

  it("[dynamic] global levelCost CE で0コア通常ネクサスが実効Lv1コスト1になったらSBA消滅する", () => {
    const zeroCostNexusDef = nexusDef("BOB-ZERO-COST-NEXUS", {
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    });
    const zeroCoreNexus = createCardInstance(zeroCostNexusDef, {
      instanceId: "bob-zero-cost-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [zeroCoreNexus],
    });
    const getOnlyZeroCostDef = (id: string): CardDefinition | undefined =>
      id === zeroCostNexusDef.cardNo ? zeroCostNexusDef : cardNoMap.get(id);
    expect(
      collectStateBasedActions(base, getOnlyZeroCostDef).some(
        (check) =>
          check.kind === "vanish_due_to_core_deficit" &&
          check.instanceId === "bob-zero-cost-nexus"
      )
    ).toBe(false);

    const { state: registeredState, getDef } = buildRegisteredState([], []);
    const stateWithLateCard: GameState = {
      ...registeredState,
      cardInstances: [...registeredState.cardInstances, zeroCoreNexus],
    };
    const getDefWithLate = (id: string): CardDefinition | undefined =>
      id === zeroCostNexusDef.cardNo ? zeroCostNexusDef : getDef(id);

    expect(
      collectStateBasedActions(stateWithLateCard, getDefWithLate).some(
        (check) =>
          check.kind === "vanish_due_to_core_deficit" &&
          check.instanceId === "bob-zero-cost-nexus"
      )
    ).toBe(true);
  });

  it("[board][P3-134] 導界者ネクサスもgrandwalkerKindを絞らないため、everHadCorePlacedがtrueならLv1コスト固定を受ける", () => {
    const guidedDef = guidedNexusDef("BOB-GUIDED-CORED");
    const guided = createCardInstance(guidedDef, {
      instanceId: "bob-guided-cored",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: true,
    });
    const { state, getDef } = buildRegisteredState([guidedDef], [guided]);
    const lv = getEffectiveLevel(
      state,
      state.cardInstances.find((c) => c.instanceId === "bob-guided-cored")!,
      guidedDef,
      getDef
    );
    expect(lv).toBe(1);
  });

  it("[board][P3-134] コア履歴の無い導界者ネクサスはLv1コスト固定の対象外（印字requiredCoresのまま）", () => {
    const guidedDef = guidedNexusDef("BOB-GUIDED-FRESH");
    const guided = createCardInstance(guidedDef, {
      instanceId: "bob-guided-fresh",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const { state, getDef } = buildRegisteredState([guidedDef], [guided]);
    const lv = getEffectiveLevel(
      state,
      state.cardInstances.find((c) => c.instanceId === "bob-guided-fresh")!,
      guidedDef,
      getDef
    );
    expect(lv).toBe(0);
  });

  it("[board] 相手の通常ネクサスは印字Lv1コスト(requiredCores)3のままでもコア1個でLv1になる", () => {
    const plainDef = nexusDef("BOB-PLAIN-NEXUS");
    const plain = createCardInstance(plainDef, {
      instanceId: "bob-plain-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const { state, getDef } = buildRegisteredState([plainDef], [plain]);
    const lv = getEffectiveLevel(
      state,
      state.cardInstances.find((c) => c.instanceId === "bob-plain-nexus")!,
      plainDef,
      getDef
    );
    expect(lv).toBe(1);
  });

  it("[board] コア履歴の無い相手の創界神ネクサスはLv1コスト固定の対象外（印字requiredCoresのまま、コア1個ではLv0）", () => {
    const grandwalkerDef = grandwalkerNexusDef("BOB-GRANDWALKER-FRESH");
    const fresh = createCardInstance(grandwalkerDef, {
      instanceId: "bob-grandwalker-fresh",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const { state, getDef } = buildRegisteredState([grandwalkerDef], [fresh]);
    const lv = getEffectiveLevel(
      state,
      state.cardInstances.find(
        (c) => c.instanceId === "bob-grandwalker-fresh"
      )!,
      grandwalkerDef,
      getDef
    );
    expect(lv).toBe(0);
  });

  it("[board] ゲーム中にコア1個以上を置かれた相手の創界神ネクサスはコア1個でLv1になる", () => {
    const grandwalkerDef = grandwalkerNexusDef("BOB-GRANDWALKER-CORED");
    const cored = createCardInstance(grandwalkerDef, {
      instanceId: "bob-grandwalker-cored",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      everHadCorePlaced: true,
    });
    const { state, getDef } = buildRegisteredState([grandwalkerDef], [cored]);
    const lv = getEffectiveLevel(
      state,
      state.cardInstances.find(
        (c) => c.instanceId === "bob-grandwalker-cored"
      )!,
      grandwalkerDef,
      getDef
    );
    expect(lv).toBe(1);
  });
});
