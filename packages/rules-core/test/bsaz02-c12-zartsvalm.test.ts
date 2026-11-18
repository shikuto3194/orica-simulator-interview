/**
 * BSAZ02-C12「ザーツバルム」effects[1,2,3] 検証。
 *
 * 原文 (textLines[0,6,7]):
 *   スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず、自分の系統：「火星」を
 *   持つアルティメット/ネクサスがあるとき、相手によってフィールドを離れない。
 *   【合体中】『自分のアタックステップ』
 *   相手の手札のマジックカード/【アクセル】のコストを+3する。
 *
 * 検証点:
 *  - effects[1]: スピリット状態 (combined:false) の疲労耐性 + アタック/ブロック不可
 *    (BSAZ02-C10 precedent 同型)。
 *  - effects[2]: 火星アルティメット/ネクサス存在時のみ leave_field 耐性 (source:opponent)。
 *    continuous 効果の condition は effect-level のみ live 再評価される
 *    (continuous-effect-rebuild.ts:1236) ため、effects[1] とは別 continuous 効果に分割。
 *  - effects[3]: 【合体中】(combined:true) かつ自分のアタックステップ中 (condition:step_phase)
 *    のみ、相手の手札のマジックカード/【アクセル】カードのコストが+3される。cardFilter の
 *    filterOr (category:magic OR hasMechanic:accel) は matchesCostCETargetFilter が
 *    従来 filterOr/hasMechanic を評価していなかったため、本カード実装に合わせて
 *    card-filter.ts に再帰対応 (matchesCostCEFilterClause) を追加した。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getApplicableAdditionalCostDelta,
  rebuildContinuousEffectsFromField,
} from "../src";
import { getAvailableAccelChangePaymentSources } from "../src/mechanics/accel-change-system";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";
const C12 = card("BSAZ02-C12");
// 火星系統を持つアルティメット (effects[2] の field_has 条件用フィクスチャ)。
const MARS_ULTIMATE = card("BSAZ02-C01");
// 相手手札のマジックカードフィクスチャ (category: magic)。
const OPPONENT_MAGIC = card("BSAZ02-C13");
// 相手手札の【アクセル】カードフィクスチャ (keywordTags: ["accel"], category: spirit)。
const OPPONENT_ACCEL = card("BSTH01-R05");
// マジックでも【アクセル】でもない相手手札カードフィクスチャ (category: spirit, no accel)。
const OPPONENT_PLAIN = card("BSAZ02-C06");

function buildState(
  cardInstances: GameState["cardInstances"],
  overrides?: Partial<GameState>
): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    activePlayerId: ALICE,
    step: "main",
    cardInstances,
    ...overrides,
  };
}

describe("BSAZ02-C12 effects[1]（スピリット状態: 疲労せずアタック/ブロック不可）", () => {
  it("非合体で prevent_battle_both + cannot_be_exhausted CE が自身に登録される", () => {
    const state = buildState([
      createCardInstance(C12, {
        instanceId: "c12-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect((pb[0]!.metadata as { ruleStrength?: boolean }).ruleStrength).toBe(
      true
    );
    const exhaustResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustResist).toHaveLength(1);
    expect(
      (exhaustResist[0]!.metadata as { ruleStrength?: boolean }).ruleStrength
    ).toBe(true);
  });

  it("合体中(host へ attach 済み)は combined:false ゲートにより CE が登録されない", () => {
    const state = buildState([
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["c12-1"],
        normalCoreCount: 1,
      }),
      createCardInstance(C12, {
        instanceId: "c12-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-1",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(0);
    const exhaustResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustResist).toHaveLength(0);
  });
});

describe("BSAZ02-C12 effects[2]（火星アルティメット/ネクサス存在時のみ相手によって離脱しない）", () => {
  it("火星アルティメット/ネクサスが存在しないとき cannot_leave_field CE は登録されない", () => {
    const state = buildState([
      createCardInstance(C12, {
        instanceId: "c12-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const leaveResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "cannot_leave_field"
    );
    expect(leaveResist).toHaveLength(0);
  });

  it("自分の火星アルティメットが存在するとき cannot_leave_field CE (source:opponent) が登録される", () => {
    const state = buildState([
      createCardInstance(C12, {
        instanceId: "c12-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "mars-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const leaveResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c12-1" &&
        ce.modifierTag === "cannot_leave_field"
    );
    expect(leaveResist).toHaveLength(1);
  });
});

describe("BSAZ02-C12 effects[3]（合体中の自分のアタックステップ: 相手手札のマジック/【アクセル】のコスト+3）", () => {
  function combinedState(overrides?: Partial<GameState>): GameState {
    return buildState(
      [
        createCardInstance(MARS_ULTIMATE, {
          instanceId: "host-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedChildrenIds: ["c12-1"],
          normalCoreCount: 1,
        }),
        createCardInstance(C12, {
          instanceId: "c12-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          attachedToInstanceId: "host-1",
        }),
      ],
      { activePlayerId: ALICE, step: "attack", ...overrides }
    );
  }

  it("合体中+自分のアタックステップ中は相手手札のマジックカードのコストが+3される", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState(),
      getCardDefinitionById
    );
    const magicCardInstance = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_MAGIC,
      {
        card: magicCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(3);
  });

  it("合体中+自分のアタックステップ中でも、手札以外(フィールド)のマジックカードのコストは変わらない", () => {
    // 回帰防止: filterOr が設定された CardFilter は他の直接フィールド(zone等)が無視される
    // 意味論 (matchesCardFilter と同一) のため、zone:["hand"] を filterOr の外側に置くと
    // 黙って脱落し手札以外のマジックカードにも+3が適用されてしまう
    // (adversarial verifier round2 lens3 指摘、card-data 側は filterOr の各枝に zone を複製して解消)。
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState(),
      getCardDefinitionById
    );
    const magicCardInstance = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic-field",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_MAGIC,
      {
        card: magicCardInstance,
        cardZone: "field",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(0);
  });

  it("合体中+自分のアタックステップ中は相手手札の【アクセル】カードのコストが+3される", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState(),
      getCardDefinitionById
    );
    const accelCardInstance = createCardInstance(OPPONENT_ACCEL, {
      instanceId: "bob-accel",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_ACCEL,
      {
        card: accelCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(3);
  });

  it("アクセル支払いソース計算でも、実カード定義の hasMechanic:accel によりコストが+3される", () => {
    const accelCardInstance = createCardInstance(OPPONENT_ACCEL, {
      instanceId: "bob-accel-pay",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const base = combinedState();
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...base,
        cardInstances: [...base.cardInstances, accelCardInstance],
      },
      getCardDefinitionById
    );

    const result = getAvailableAccelChangePaymentSources({
      state: rebuilt,
      actingPlayerId: BOB,
      cost: OPPONENT_ACCEL.accelData!.cost,
      reductionSymbols: OPPONENT_ACCEL.accelData!.reduction,
      useKind: "accel",
      sourceInstanceId: accelCardInstance.instanceId,
      getCardDefinitionById,
    });

    expect(result.reduction.additionalCost).toBe(3);
  });

  it("合体中+自分のアタックステップ中でも、マジックでも【アクセル】でもない相手手札カードのコストは変わらない", () => {
    // 回帰防止: native-action-registry.ts の cost_modify player 分岐が cardFilter を
    // targetFilter へ組み立てる際の allowlist コピーに filterOr/hasMechanic が漏れていると、
    // zone:["hand"] だけの制約になり相手の手札カード全てに+3が適用されてしまう
    // (project_core_move_field_card_grandwalker_strip と同型の allowlist 漏れ、round1 verifier 指摘)。
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState(),
      getCardDefinitionById
    );
    const plainCardInstance = createCardInstance(OPPONENT_PLAIN, {
      instanceId: "bob-plain",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_PLAIN,
      {
        card: plainCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(0);
  });

  it("自分のアタックステップ以外では相手手札のマジックカードのコストは変わらない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState({ step: "main" }),
      getCardDefinitionById
    );
    const magicCardInstance = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_MAGIC,
      {
        card: magicCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(0);
  });

  it("相手のアタックステップ(自分のアタックステップでない)では相手手札のマジックカードのコストは変わらない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      combinedState({ activePlayerId: BOB, step: "attack" }),
      getCardDefinitionById
    );
    const magicCardInstance = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_MAGIC,
      {
        card: magicCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(0);
  });

  it("非合体(スピリット状態)では自分のアタックステップ中でも相手手札のコストは変わらない", () => {
    const state = buildState(
      [
        createCardInstance(C12, {
          instanceId: "c12-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
      ],
      { activePlayerId: ALICE, step: "attack" }
    );
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const magicCardInstance = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "bob-magic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const delta = getApplicableAdditionalCostDelta(
      rebuilt,
      BOB,
      OPPONENT_MAGIC,
      {
        card: magicCardInstance,
        cardZone: "hand",
        getCardDefinitionById,
      }
    );
    expect(delta).toBe(0);
  });
});
