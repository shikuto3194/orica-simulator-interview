/**
 * BSTH07-転醒R01(A) [東方星蓮船]聖蓮船 Lv2:
 *   「お互い、カードを召喚/配置/使用するとき、創界神ネクサス/導界者ネクサスでは、
 *    1つしか軽減シンボルを満たせない。」
 *
 * 検証:
 *  - Lv2 (requiredCores:1) のとき、軽減供給源が創界神/導界者ネクサス (grandwalkerData
 *    持ち) であれば、複数シンボルを持っていても軽減マッチ数が1に上限される。
 *  - 通常のスピリット/ネクサス (grandwalkerData 無し) の軽減供給は上限されない。
 *  - 「お互い」なので自分・相手どちらの軽減計算でも上限が成立する (self/opponent 2-step)。
 *  - Lv1 (requiredCores:0) のときは制限が成立せず、通常通り軽減される。
 *
 * ルール根拠: カード本文 (独自カード source precedence)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildFieldCardEffectLookup,
  calculateAccelChangeReduction,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import {
  getAvailableMiragePaymentSources,
  useSetMirageAsAction,
} from "../src/mechanics/mirage-system";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const R01A = cardNoMap.get("BSTH07-転醒R01(A)")!;

function makeGrandwalkerNexus(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["blue", "blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
    effects: [],
  };
}

function makePlainNexus(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["blue", "blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeBlueSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "blue", "blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const GRANDWALKER_NEXUS = makeGrandwalkerNexus("TEST-GRANDWALKER-NEXUS");
const PLAIN_NEXUS = makePlainNexus("TEST-PLAIN-NEXUS");
const BLUE_SPIRIT = makeBlueSpirit("TEST-BLUE-SPIRIT-R01A");
const BLUE_MIRAGE: CardDefinition = {
  ...BLUE_SPIRIT,
  cardNo: "TEST-BLUE-MIRAGE-R01A",
  name: "test blue mirage",
  keywordTags: ["mirage"],
  mirageData: { cost: 5, reduction: ["blue", "blue", "blue"] },
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  (id === GRANDWALKER_NEXUS.cardNo
    ? GRANDWALKER_NEXUS
    : id === PLAIN_NEXUS.cardNo
      ? PLAIN_NEXUS
      : id === BLUE_SPIRIT.cardNo
        ? BLUE_SPIRIT
        : id === BLUE_MIRAGE.cardNo
          ? BLUE_MIRAGE
          : undefined);

const getRegisteredFieldCardEffectActions = buildFieldCardEffectLookup(
  ALL_CARDS as readonly CardDefinition[]
);

function actionsFor(state: GameState, playerId: string) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions,
  });
}

/**
 * alice: BSTH07-転醒R01(A) を場に (cores 指定で Lv 決定)。
 * 供給源は alice 自身の創界神ネクサス (2シンボル)。手札に軽減対象の青スピリット。
 */
function setup(options: {
  r01aCores: number;
  supplySource: CardDefinition;
}): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(R01A, {
        instanceId: "alice-r01a",
        ownerPlayerId: "alice",
        zone: "field",
        cores: options.r01aCores,
      }),
      createCardInstance(options.supplySource, {
        instanceId: "alice-supply",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(BLUE_SPIRIT, {
        instanceId: "alice-hand-spirit",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    playerOverrides: [
      { reserveNormalCoreCount: 5 },
      { reserveNormalCoreCount: 5 },
    ],
  });
  const state: GameState = {
    ...base,
    step: "main",
    activePlayerId: "alice",
  };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

describe("BSTH07-転醒R01(A) Lv2「創界神/導界者ネクサスでは、1つしか軽減シンボルを満たせない」", () => {
  // 供給源は常に alice-r01a 自身の印字シンボル (blue×1、grandwalkerData 無しなので
  // 上限対象外) + alice-supply (創界神/導界者ネクサス相当かどうかを差し替え) の合計。
  // BLUE_SPIRIT は軽減シンボル blue×3 を要求するため、上限の有無が totalReduction に
  // そのまま現れる (cap 無し: 1+2=3 満了、cap 有り: 1+min(2,1)=2 のみ満了)。
  it("Lv2 では創界神ネクサス供給源 (2シンボル) からの軽減が1に上限される", () => {
    const state = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: BLUE_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
      useKind: "summon",
    });
    expect(reduction.totalReduction).toBe(2);
    expect(reduction.finalCost).toBe(3);
  });

  it("[regression] 配置後の再計算を経ても両プレイヤー向け軽減上限 CE を保持する", () => {
    const state = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });
    const recomputed = recomputeContinuousEffects(state);
    const limits = recomputed.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "limit_cost_reduction"
    );

    expect(limits).toHaveLength(2);
    expect(limits.map((ce) => ce.targetInstanceId).sort()).toEqual([
      "alice",
      "bob",
    ]);

    const reduction = calculateReduction({
      state: recomputed,
      actingPlayerId: "alice",
      card: BLUE_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
      useKind: "summon",
    });
    expect(reduction.totalReduction).toBe(2);
  });

  it("[regression] 本文の召喚/配置/使用以外であるミラージュセットでは軽減上限を適用しない", () => {
    const state = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });
    const mirageState: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(BLUE_MIRAGE, {
          instanceId: "alice-hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      players: state.players.map((player) =>
        player.id === "alice"
          ? { ...player, handCount: player.handCount + 1 }
          : player
      ),
    };
    const { reduction } = getAvailableMiragePaymentSources({
      state: mirageState,
      actingPlayerId: "alice",
      mirageData: { cost: 5, reduction: ["blue", "blue", "blue"] },
      sourceInstanceId: "alice-hand-mirage",
      getCardDefinitionById,
    });

    expect(reduction.totalReduction).toBe(3);
    expect(reduction.finalCost).toBe(2);
    expect(
      R01A.effects![3]!.steps.map((step) => step.action?.restrictedKinds)
    ).toEqual([
      ["summon", "place_nexus", "magic", "accel", "change"],
      ["summon", "place_nexus", "magic", "accel", "change"],
    ]);

    const action = actionsFor(mirageState, "alice").find(
      (candidate) =>
        candidate.kind === "set_mirage" &&
        candidate.sourceInstanceId === "alice-hand-mirage"
    ) as
      | Extract<ReturnType<typeof actionsFor>[number], { kind: "set_mirage" }>
      | undefined;
    expect(action?.finalCost).toBe(2);

    const result = useSetMirageAsAction({
      state: mirageState,
      actingPlayerId: "alice",
      sourceInstanceId: "alice-hand-mirage",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    expect(
      result.state.cardInstances.find(
        (card) => card.instanceId === "alice-hand-mirage"
      )?.zone
    ).toBe("mirage");
  });

  it("[regression] 本文の「使用」はアクセル/チェンジの軽減にも上限を適用する", () => {
    const state = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });

    for (const useKind of ["accel", "change"] as const) {
      const reduction = calculateAccelChangeReduction({
        state,
        actingPlayerId: "alice",
        cost: 5,
        reductionSymbols: ["blue", "blue", "blue"],
        useKind,
        sourceInstanceId: "alice-hand-spirit",
        getCardDefinitionById,
      });

      expect(reduction.totalReduction).toBe(2);
      expect(reduction.finalCost).toBe(3);
    }
  });

  it("Lv2 でも通常のネクサス (grandwalkerData 無し) 供給源は上限されない", () => {
    const state = setup({ r01aCores: 1, supplySource: PLAIN_NEXUS });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: BLUE_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
      useKind: "summon",
    });
    expect(reduction.totalReduction).toBe(3);
    expect(reduction.finalCost).toBe(2);
  });

  it("Lv1 (cores:0) では制限が成立せず、創界神ネクサス供給源でも通常通り軽減される", () => {
    const state = setup({ r01aCores: 0, supplySource: GRANDWALKER_NEXUS });
    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: BLUE_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "alice-hand-spirit",
      useKind: "summon",
    });
    expect(reduction.totalReduction).toBe(3);
    expect(reduction.finalCost).toBe(2);
  });

  it("「お互い」制限のため、bob (相手) 側の軽減計算でも上限が成立する", () => {
    const base = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });
    const state: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(GRANDWALKER_NEXUS, {
          instanceId: "bob-supply",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(BLUE_SPIRIT, {
          instanceId: "bob-hand-spirit",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const reduction = calculateReduction({
      state: rebuilt,
      actingPlayerId: "bob",
      card: BLUE_SPIRIT,
      getCardDefinitionById,
      sourceInstanceId: "bob-hand-spirit",
      useKind: "summon",
    });
    expect(reduction.totalReduction).toBe(1);
    expect(reduction.finalCost).toBe(4);
  });

  it("legal action (summon) でも上限された finalCost が反映される", () => {
    const state = setup({ r01aCores: 1, supplySource: GRANDWALKER_NEXUS });
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "alice-hand-spirit"
    ) as
      | Extract<ReturnType<typeof actionsFor>[number], { kind: "summon" }>
      | undefined;
    expect(action).toBeDefined();
    expect(action?.finalCost).toBe(3);
  });
});
