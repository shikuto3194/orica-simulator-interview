/**
 * BSTH07.8-C03 [妖精大戦争]リリーホワイト Lv2:
 *   「相手はネクサスを配置するとき、軽減できない。」
 *
 * 検証:
 *  - C03 が Lv2 (requiredCores:2) のとき、相手 (opponent) の place_nexus 軽減が
 *    無効化され、軽減シンボルが揃っていても finalCost が印字コストのまま。
 *  - C03 が Lv1 (requiredCores:1) のときは制限が成立せず、通常通り軽減される
 *    (min_level condition の on/off で restriction が動的に切り替わる)。
 *  - 制限は「相手」限定 (targetScope=player, player:"opponent")。C03 の保有者
 *    自身 (自分) が自分のネクサスを配置するときは軽減が通常通り適用される。
 *
 * ルール根拠: カード本文 (独自カード source precedence)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildFieldCardEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C03 = cardNoMap.get("BSTH07.8-C03")!;

function makeSimpleSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeWhiteNexus(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: ["white"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const WHITE_SPIRIT = makeSimpleSpirit("TEST-WHITE-SPIRIT");
const WHITE_NEXUS = makeWhiteNexus("TEST-WHITE-NEXUS");

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  (id === WHITE_SPIRIT.cardNo
    ? WHITE_SPIRIT
    : id === WHITE_NEXUS.cardNo
      ? WHITE_NEXUS
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
 * alice: BSTH07.8-C03 を場に (cores 指定で Lv 決定)。bob: 白シンボルを持つ
 * 味方スピリット (軽減供給源) + 手札に白軽減ネクサス。
 */
function setup(c03Cores: number): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(C03, {
        instanceId: "alice-c03",
        ownerPlayerId: "alice",
        zone: "field",
        cores: c03Cores,
      }),
      createCardInstance(WHITE_SPIRIT, {
        instanceId: "bob-white-spirit",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(WHITE_NEXUS, {
        instanceId: "bob-nexus",
        ownerPlayerId: "bob",
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
    activePlayerId: "bob",
  };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

function findBobPlaceNexus(state: GameState) {
  return actionsFor(state, "bob").find(
    (action) =>
      action.kind === "place_nexus" && action.sourceInstanceId === "bob-nexus"
  ) as
    | Extract<ReturnType<typeof actionsFor>[number], { kind: "place_nexus" }>
    | undefined;
}

describe("BSTH07.8-C03 Lv2「相手はネクサスを配置するとき、軽減できない」", () => {
  it("Lv2 (cores:2) では相手 (bob) のネクサス配置が軽減シンボル一致でも軽減されない", () => {
    const state = setup(2);
    const action = findBobPlaceNexus(state);
    expect(action).toBeDefined();
    expect(action?.totalReduction).toBe(0);
    expect(action?.finalCost).toBe(2);
  });

  it("Lv2 の軽減禁止 CE は step 遷移時の再計算を跨いで維持される", () => {
    const afterRecompute = recomputeContinuousEffects(setup(2));
    const restriction = afterRecompute.activeContinuousEffects.filter(
      (effect) =>
        effect.sourceInstanceId === "alice-c03" &&
        effect.modifierTag === "prevent_cost_reduction"
    );

    expect(restriction).toHaveLength(1);
    expect(restriction[0]!.targetInstanceId).toBe("bob");
    expect(findBobPlaceNexus(afterRecompute)?.totalReduction).toBe(0);
  });

  it("Lv1 (cores:1) では制限が成立せず通常通り軽減される", () => {
    const state = setup(1);
    const action = findBobPlaceNexus(state);
    expect(action).toBeDefined();
    expect(action?.totalReduction).toBe(1);
    expect(action?.finalCost).toBe(1);
  });

  it("Lv2 でも C03 の保有者自身 (alice) が自分のネクサスを配置するときは軽減される", () => {
    const base = setup(2);
    const aliceState: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(WHITE_SPIRIT, {
          instanceId: "alice-white-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(WHITE_NEXUS, {
          instanceId: "alice-nexus",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      activePlayerId: "alice",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      aliceState,
      getCardDefinitionById
    );
    const action = actionsFor(rebuilt, "alice").find(
      (a) => a.kind === "place_nexus" && a.sourceInstanceId === "alice-nexus"
    ) as
      | Extract<ReturnType<typeof actionsFor>[number], { kind: "place_nexus" }>
      | undefined;
    expect(action).toBeDefined();
    expect(action?.totalReduction).toBe(1);
    expect(action?.finalCost).toBe(1);
  });

  it("useKind:'place_nexus' を明示する呼び出し元 (effect 駆動召喚パイプライン等) でも軽減が無効化される", () => {
    const state = setup(2);
    const reduction = calculateReduction({
      state,
      actingPlayerId: "bob",
      card: WHITE_NEXUS,
      getCardDefinitionById,
      sourceInstanceId: "bob-nexus",
      useKind: "place_nexus",
    });
    expect(reduction.totalReduction).toBe(0);
    expect(reduction.finalCost).toBe(2);
  });

  it("useKind 省略時は restrict_use と同じ fail-open 既定で、restrictedKinds 限定の CE はこの呼び出しをブロックしない", () => {
    const state = setup(2);
    const reduction = calculateReduction({
      state,
      actingPlayerId: "bob",
      card: WHITE_NEXUS,
      getCardDefinitionById,
      sourceInstanceId: "bob-nexus",
    });
    expect(reduction.totalReduction).toBe(1);
    expect(reduction.finalCost).toBe(1);
  });
});
