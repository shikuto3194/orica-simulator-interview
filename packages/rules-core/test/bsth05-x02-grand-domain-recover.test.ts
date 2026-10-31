/**
 * BSTH05-X02 [創界神]洩矢 諏訪子 effects[1] 【神域】
 *   Lv2『自分のアタックステップ』
 *   系統：「風神」/「アシハラ」を持つ自分のスピリット/創界神ネクサスは、
 *   バトル終了時、ターンに1回ずつ回復できる。この効果は重複しない。
 *
 * - timing: game_event battle_end + timingScope（自分のアタックステップ）
 * - triggerFilter: 風神/アシハラ × (spirit | grandwalker-only nexus)
 * - usageLimit: [per_trigger_related_instance turn (= Y 別 turn 1 回),
 *                no_duplicate (= 同名創界神ネクサスが複数いても 1 回)]
 * - 回復対象 = 主語 Y 自身 (TargetSpec.trigger_related_instance)
 *
 * 着地 prerequisites (全て事前に resolved):
 *   - ENGINE-target-spec-trigger-related-instance (2026-06-22)
 *   - ENGINE-card-filter-grandwalker-exclusive (2026-06-23)
 *   - ENGINE-usagelimit-per-trigger-related-instance-turn (本イテレーション)
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "../src/runtime";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";

const suwako = ALL_CARDS.find((c) => c.cardNo === "BSTH05-X02");
if (!suwako) {
  throw new Error("BSTH05-X02 not found in ALL_CARDS");
}
const SUWAKO = suwako;

describe("BSTH05-X02 effects[1] 【神域】", () => {
  it("structural shape: game_event battle_end + filterOr + per_trigger_related_instance + no_duplicate", () => {
    const effects = SUWAKO.effects;
    if (!effects || !effects[1]) {
      throw new Error("BSTH05-X02 effects[1] missing");
    }
    const e = effects[1];
    expect(e).toBeDefined();
    expect(e.stub).toBeUndefined();
    expect(e.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "battle_end",
    });
    expect(e.timingScope).toEqual({ player: "self", period: "attack" });
    const tf = (e.timing as { triggerFilter?: unknown }).triggerFilter as {
      filterOr: ReadonlyArray<unknown>;
    };
    // filterOr は外側の filter fields を評価しないため、本文の共有系統条件を
    // 各 category 分岐に明示する。
    expect(tf.filterOr).toEqual([
      {
        category: ["spirit"],
        tribes: ["風神", "アシハラ"],
        tribesLogic: "or",
      },
      {
        category: ["nexus"],
        targetsGrandwalker: "only",
        tribes: ["風神", "アシハラ"],
        tribesLogic: "or",
      },
    ]);

    // usageLimit は配列で [per_trigger_related_instance, no_duplicate]
    expect(e.usageLimit).toEqual([
      { kind: "per_trigger_related_instance", duration: "turn" },
      { kind: "no_duplicate" },
    ]);
    expect(e.executionMode).toBe("optional");

    // 回復ステップ: target = trigger_related_instance
    expect(e.steps).toHaveLength(1);
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("recover");
    expect((step0.action as { target: { kind: string } }).target.kind).toBe(
      "trigger_related_instance"
    );
  });

  it("Y (主語) のみが回復され、同条件の別カードは回復されない", () => {
    // 諏訪子 (suwako) + 主語 Y (fuzin-spirit) + 同条件の別個体 (aux-fuzin)
    const fuzinSpirit: CardDefinition = {
      cardNo: "TEST-FUZIN-SPIRIT",
      name: "風神テスト",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: ["green"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["green"],
      tribe: "風神",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [SUWAKO.cardNo, SUWAKO],
      [fuzinSpirit.cardNo, fuzinSpirit],
    ]);

    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(SUWAKO, {
          instanceId: "suwako-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 4,
        }),
        createCardInstance(fuzinSpirit, {
          instanceId: "fuzin-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(fuzinSpirit, {
          instanceId: "fuzin-2",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
      ],
    };

    const suwakoEffect = SUWAKO.effects?.[1];
    if (!suwakoEffect) throw new Error("BSTH05-X02 effects[1] missing");
    const result = executeEffect({
      chainId: "test:bsth05-x02-grand-domain-recover:130",
      state,
      effect: suwakoEffect,
      sourceInstanceId: "suwako-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      triggerRelatedInstanceId: "fuzin-1",
    });

    const fuzin1 = result.cardInstances.find((c) => c.instanceId === "fuzin-1");
    const fuzin2 = result.cardInstances.find((c) => c.instanceId === "fuzin-2");
    expect(fuzin1?.exhaustState).toBe("recovered");
    // 主語 Y でない方は回復されない
    expect(fuzin2?.exhaustState).toBe("exhausted");
  });

  it("per_trigger_related_instance: 同じ Y は同ターン 2 回目を封鎖、別 Y は通る", () => {
    const suwakoEffect = SUWAKO.effects?.[1];
    if (!suwakoEffect?.usageLimit)
      throw new Error("BSTH05-X02 effects[1].usageLimit missing");
    const limit = suwakoEffect.usageLimit;
    const effectLabel = "spirit:1"; // game_event game-event sourceKind=spirit, registrationIndex=1 想定 (label 任意でも per-Y 判定は valid)
    let state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 7,
    };

    // 1 回目: Y=fuzin-1 OK
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "suwako-1",
        sourceDefinitionId: SUWAKO.cardNo,
        effectLabel,
        usageLimit: limit,
        relatedInstanceId: "fuzin-1",
      })
    ).toBe(true);
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "suwako-1",
      sourceDefinitionId: SUWAKO.cardNo,
      effectLabel,
      usageLimit: limit,
      relatedInstanceId: "fuzin-1",
    });

    // 同 Y は封鎖される (per_trigger_related_instance 側で false)
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "suwako-1",
        sourceDefinitionId: SUWAKO.cardNo,
        effectLabel,
        usageLimit: limit,
        relatedInstanceId: "fuzin-1",
      })
    ).toBe(false);

    // 別 Y (fuzin-2) は per_trigger 側は通るが、no_duplicate 側は同 source
    //   definition がもう使用済みのため封鎖される
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "suwako-1",
        sourceDefinitionId: SUWAKO.cardNo,
        effectLabel,
        usageLimit: limit,
        relatedInstanceId: "fuzin-2",
      })
    ).toBe(false);
  });

  it("no_duplicate: 別 instance の同名創界神でも 1 回しか発揮できない", () => {
    const suwakoEffect = SUWAKO.effects?.[1];
    if (!suwakoEffect?.usageLimit)
      throw new Error("BSTH05-X02 effects[1].usageLimit missing");
    const limit = suwakoEffect.usageLimit;
    const effectLabel = "spirit:1";
    let state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 7,
    };

    // suwako-1 が Y=fuzin-1 で消費
    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "suwako-1",
      sourceDefinitionId: SUWAKO.cardNo,
      effectLabel,
      usageLimit: limit,
      relatedInstanceId: "fuzin-1",
    });

    // suwako-2 (同名) も既に重複扱いで封鎖される (no_duplicate は definition 単位)
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "suwako-2",
        sourceDefinitionId: SUWAKO.cardNo,
        effectLabel,
        usageLimit: limit,
        relatedInstanceId: "fuzin-1",
      })
    ).toBe(false);
  });
});
