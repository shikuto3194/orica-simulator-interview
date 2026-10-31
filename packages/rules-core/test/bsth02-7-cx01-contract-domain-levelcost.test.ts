/**
 * BSTH02.7-CX01「［魔導と叡智の契約者］アリス・マーガトロイド」【契約域】Lv2『自分のターン』
 * 「自分の契約ネクサス以外の黄1色の導界者ネクサスすべてのLv2コストを3に固定する。」の検証。
 *
 * levelCost（Lv 別必要コア数の絶対値上書き）は従来 lv1 必須で、省略レベルは
 * 「常に到達不能」扱いだった。フィルタ型 global CE で複数の異なる印字コストを持つ対象へ
 * 一部レベルのみ固定するには、省略レベルを対象自身の印字 levelDefs へフォールバックする
 * 必要があり battle-shared.ts / state-based-actions.ts の 2 経路を修正した。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import {
  createEmptyGameState,
  createCardInstance,
  getEffectiveLevel,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const ALICE = "player-1";
const BOB = "player-2";

function guidedNexusDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 0 },
      { level: 2, requiredCores: 5, bp: 0 },
    ],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "導界者",
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
    ...overrides,
  };
}

describe("BSTH02.7-CX01 effects[1]【契約域】Lv2コスト固定", () => {
  const card = cardNoMap.get("BSTH02.7-CX01")!;
  const effect = card.effects![1]!;

  function buildRegisteredState(
    otherDefs: CardDefinition[],
    otherCards: ReturnType<typeof createCardInstance>[]
  ): { state: GameState; getDef: (id: string) => CardDefinition | undefined } {
    const defMap = new Map(cardNoMap);
    for (const def of otherDefs) defMap.set(def.cardNo, def);
    const getDef = (id: string): CardDefinition | undefined => defMap.get(id);

    const source = createCardInstance(card, {
      instanceId: "cx01-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // C1 でLv2。カード上のコアは不要。
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, ...otherCards],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    return {
      state: executeEffect({
        chainId: "test:bsth02-7-cx01-contract-domain-levelcost:77",
        state,
        effect,
        sourceInstanceId: "cx01-source",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef,
    };
  }

  it("levelCost:{lv2:3}（lv1省略）でtargetFilter付きglobal CEを登録する（自己参照除外はtargetExcludeSelf）", () => {
    const { state } = buildRegisteredState([], []);
    const overrideCEs = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(overrideCEs).toHaveLength(1);
    const ce = overrideCEs[0]!;
    expect(ce.targetInstanceId).toBeUndefined();
    expect(ce.targetExcludeSelf).toBe(true);
    expect(
      (
        ce.metadata?.properties as {
          levelCost?: { lv1?: number; lv2?: number };
        }
      )?.levelCost
    ).toMatchObject({ lv2: 3 });
    expect(ce.targetFilter).toMatchObject({
      player: "self",
      category: ["nexus"],
      colors: ["yellow"],
      colorCount: "mono",
      tribes: ["導界者"],
      targetsGrandwalker: true,
    });
    expect((ce.targetFilter as { exclude?: unknown }).exclude).toBeUndefined();
  });

  it("[self-exclude] このネクサス自身(CX01)は黄1色導界者ネクサスとして自身の対象条件を満たすが、excludeSelfで印字Lv2コストのまま", () => {
    const { state, getDef } = buildRegisteredState([], []);
    // 契約ネクサスは対象外。自身は上のコア数ではなくC1でLv2になる。
    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find((c) => c.instanceId === "cx01-source")!,
        getDef("BSTH02.7-CX01"),
        getDef
      )
    ).toBe(2);
  });

  it("[dynamic] 登録後に場に加わった黄1色導界者ネクサスにもLv2コスト固定が適用される", () => {
    const { state, getDef } = buildRegisteredState([], []);
    const lateAlly = createCardInstance(guidedNexusDef("ALLY-LATE-GUIDED"), {
      instanceId: "ally-late-guided",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const defMap = new Map(cardNoMap);
    defMap.set("ALLY-LATE-GUIDED", guidedNexusDef("ALLY-LATE-GUIDED"));
    const getDefWithLate = (id: string): CardDefinition | undefined =>
      id === "ALLY-LATE-GUIDED" ? defMap.get(id) : getDef(id);
    const stateWithLateAlly: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, lateAlly],
    };

    // 印字Lv2コストは5だが固定で3: コア3個でLv2に到達する（登録時には存在しなかった対象）
    expect(
      getEffectiveLevel(
        stateWithLateAlly,
        stateWithLateAlly.cardInstances.find(
          (c) => c.instanceId === "ally-late-guided"
        )!,
        getDefWithLate("ALLY-LATE-GUIDED"),
        getDefWithLate
      )
    ).toBe(2);
  });

  it("[board] 自分の黄1色導界者ネクサス(非契約)はLv2コストが3に固定され、Lv1は印字値のまま", () => {
    const ally = createCardInstance(guidedNexusDef("ALLY-GUIDED"), {
      instanceId: "ally-guided",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const { state, getDef } = buildRegisteredState(
      [guidedNexusDef("ALLY-GUIDED")],
      [ally]
    );

    // 印字Lv1コストは1のまま: コア1個でLv1に到達する
    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find((c) => c.instanceId === "ally-guided")!,
        getDef("ALLY-GUIDED"),
        getDef
      )
    ).toBe(1);

    // 印字Lv2コストは5だが固定で3: コア3個でLv2に到達する
    const stateWith3Cores: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "ally-guided" ? { ...c, normalCoreCount: 3 } : c
      ),
    };
    expect(
      getEffectiveLevel(
        stateWith3Cores,
        stateWith3Cores.cardInstances.find(
          (c) => c.instanceId === "ally-guided"
        )!,
        getDef("ALLY-GUIDED"),
        getDef
      )
    ).toBe(2);
  });

  it("[board] 自分の契約ネクサスは他個体もLvコスト固定から除外される", () => {
    const contractNexus = guidedNexusDef("ALLY-CONTRACT-NEXUS", {
      keywordTags: ["contract"],
    });
    const ally = createCardInstance(contractNexus, {
      instanceId: "ally-contract-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const { state, getDef } = buildRegisteredState([contractNexus], [ally]);

    // 契約ネクサスは印字Lv2コスト5のまま。コア3個ではLv1。
    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find(
          (c) => c.instanceId === "ally-contract-nexus"
        )!,
        getDef("ALLY-CONTRACT-NEXUS"),
        getDef
      )
    ).toBe(1);
  });

  it("[board] 黄1色でない(多色)導界者ネクサスは対象外", () => {
    const multiColorNexus = guidedNexusDef("ALLY-MULTICOLOR", {
      colors: ["yellow", "red"],
    });
    const ally = createCardInstance(multiColorNexus, {
      instanceId: "ally-multicolor",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const { state, getDef } = buildRegisteredState([multiColorNexus], [ally]);

    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find((c) => c.instanceId === "ally-multicolor")!,
        getDef("ALLY-MULTICOLOR"),
        getDef
      )
    ).toBe(1);
  });

  it("[turn scope] 相手のターンには固定が適用されない", () => {
    const ally = createCardInstance(guidedNexusDef("ALLY-OPPONENT-TURN"), {
      instanceId: "ally-opponent-turn",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const { state, getDef } = buildRegisteredState(
      [guidedNexusDef("ALLY-OPPONENT-TURN")],
      [ally]
    );
    const stateOpponentTurn: GameState = { ...state, activePlayerId: BOB };

    expect(
      getEffectiveLevel(
        stateOpponentTurn,
        stateOpponentTurn.cardInstances.find(
          (c) => c.instanceId === "ally-opponent-turn"
        )!,
        getDef("ALLY-OPPONENT-TURN"),
        getDef
      )
    ).toBe(1);
  });
});
