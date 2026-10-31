/**
 * BSTH02.7-M01 博愛のオルレアン人形 effects[0] — 召喚コスト『トラッシュ○枚まで除外、
 * 1枚につきコスト-N』の可変枚数コスト軽減プリミティブ。
 *
 * カード本文 (Ver.17.0 エターナル独自拡張):
 * - Lv1「このカードを召喚するとき、自分のトラッシュにあるカード2枚までを除外し、
 *   除外したカード1枚につきコストを-1する。」
 *
 * pendingDrawStepCostChoice (model A, 10_rules/02) と同型の「コストより前に任意選択を解決」
 * パターンを summon 経路に新設した primitive (summon-cost-exclude-choice.ts) の検証。
 *
 * 本テストで検証する:
 * - トラッシュに候補がある場合、summon legal action が opensCostExcludeChoice 版になる。
 * - opensCostExcludeChoice を選ぶと即座には召喚せず pendingSummonCostExcludeChoice を立てる。
 * - 2 枚除外を選択: 選択カードが removed_from_game へ移動し、コストが 7→5 に軽減されて召喚。
 * - 0 枚選択 (辞退相当): 除外なし、通常コスト 7 で召喚。
 * - トラッシュに候補が無い場合は通常の summon action (opensCostExcludeChoice 無し)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

const オルレアン人形 = cardNoMap.get("BSTH02.7-M01")!;
const トラッシュ埋め = cardNoMap.get("BSTH01-C12")!; // 除外候補の汎用フィラー

const ALICE = "alice";
const BOB = "bob";

function buildState(options: {
  trashCount: number;
  reserveNormalCoreCount: number;
}): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(オルレアン人形, {
        instanceId: "orleans-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
      ...Array.from({ length: options.trashCount }, (_, i) =>
        createCardInstance(トラッシュ埋め, {
          instanceId: `trash-${i}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "trash",
        })
      ),
    ],
    playerOverrides: [
      { reserveNormalCoreCount: options.reserveNormalCoreCount },
    ],
  });
  return { ...base, step: "main", activePlayerId: ALICE };
}

function actionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lookup,
  });
}

describe("BSTH02.7-M01 召喚コスト・トラッシュ除外による可変軽減", () => {
  it("カード stub が解消されている (cost_modify + useCostPayment.kind:exclude)", () => {
    const eff = オルレアン人形.effects![0]!;
    expect(eff.stub).toBeUndefined();
    const step = eff.steps[0]!;
    expect(step.action.kind).toBe("cost_modify");
    if (step.action.kind === "cost_modify") {
      expect(step.action.useCostPayment).toEqual({
        kind: "exclude",
        sourceZone: "trash",
        maxCount: 2,
      });
    }
  });

  it("トラッシュに候補がある場合、summon legal action が opensCostExcludeChoice 版になる", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const actions = actionsFor(state, ALICE);
    const summon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "orleans-1"
    );
    expect(summon).toBeDefined();
    if (summon?.kind === "summon") {
      expect(summon.opensCostExcludeChoice).toBe(true);
      expect(summon.costExcludeMaxCount).toBe(2);
      expect(summon.costExcludeDiscountPerCard).toBe(1);
      expect(summon.costExcludeCandidateInstanceIds).toEqual([
        "trash-0",
        "trash-1",
        "trash-2",
      ]);
    }
  });

  it("トラッシュに候補が無い場合は通常の summon action (opensCostExcludeChoice 無し)", () => {
    const state = buildState({ trashCount: 0, reserveNormalCoreCount: 8 });
    const actions = actionsFor(state, ALICE);
    const summon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "orleans-1"
    );
    expect(summon).toBeDefined();
    if (summon?.kind === "summon") {
      expect(summon.opensCostExcludeChoice ?? false).toBe(false);
    }
  });

  it("opensCostExcludeChoice を選ぶと即座には召喚せず pendingSummonCostExcludeChoice を立てる", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const actions = actionsFor(state, ALICE);
    const summon = actions.find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "orleans-1"
    )!;

    const opened = applyLegalAction({
      state,
      action: summon,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    expect(opened.pendingSummonCostExcludeChoice).not.toBeNull();
    const pending = opened.pendingSummonCostExcludeChoice!;
    expect(pending.actingPlayerId).toBe(ALICE);
    expect(pending.sourceInstanceId).toBe("orleans-1");
    expect(pending.maxCount).toBe(2);
    expect(pending.discountPerCard).toBe(1);
    expect(pending.candidateCardInstanceIds).toEqual([
      "trash-0",
      "trash-1",
      "trash-2",
    ]);
    // まだ場に出ていない (in_use に留まる)。
    const card = opened.cardInstances.find(
      (c) => c.instanceId === "orleans-1"
    )!;
    expect(card.zone).not.toBe("field");
  });

  it("2枚除外を選択: removed_from_game へ移動しコスト7→5に軽減されて召喚される", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const summon = actionsFor(state, ALICE).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "orleans-1"
    )!;
    const opened = applyLegalAction({
      state,
      action: summon,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    );
    expect(resolveAction).toBeDefined();
    if (resolveAction?.kind === "resolve_pending_summon_cost_exclude_choice") {
      expect(resolveAction.printedCost).toBe(7);
      expect(resolveAction.reducedCost).toBe(7);
      expect(resolveAction.maxCount).toBe(2);
    }

    const afterCostChoice = applyLegalAction({
      state: opened,
      action: resolveAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      summonCostExcludeSelectedCardInstanceIds: ["trash-0", "trash-1"],
      paymentSources: [{ kind: "reserve", amount: 5 }],
    }).state;

    expect(afterCostChoice.pendingSummonCostExcludeChoice ?? null).toBeNull();
    // P3-115 再発防止invariant: resolve_pending_summon_cost_exclude_choice は
    // opens_own_window に分類されており、選択解決直後にスタック窓が開いていなければならない。
    expect(afterCostChoice.stackWindow).not.toBeNull();
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-0")!
        .zone
    ).toBe("removed_from_game");
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-1")!
        .zone
    ).toBe("removed_from_game");
    // trash-2 は選ばれず、そのままトラッシュに残る。
    expect(
      afterCostChoice.cardInstances.find((c) => c.instanceId === "trash-2")!
        .zone
    ).toBe("trash");

    // main step summon はスタック窓を開く。相手 (bob) がパスして配置確定へ。
    const passBob = actionsFor(afterCostChoice, BOB).find(
      (a) => a.kind === "pass_stack"
    )!;
    const afterPass = applyLegalAction({
      state: afterCostChoice,
      action: passBob,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    // 場入りコア配置 (Lv1 requiredCores:1) を解決。
    const resolvePlacement = actionsFor(afterPass, ALICE).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    )!;
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolvePlacement,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "orleans-1"
    )!;
    expect(card.zone).toBe("field");
    // reserve: 8 - (5 支払い + 1 場入りコア) = 2。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(2);
  });

  it("0枚選択 (辞退相当): 除外なし、通常コスト7で召喚される", () => {
    const state = buildState({ trashCount: 3, reserveNormalCoreCount: 8 });
    const summon = actionsFor(state, ALICE).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "orleans-1"
    )!;
    const opened = applyLegalAction({
      state,
      action: summon,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
    const resolveAction = actionsFor(opened, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;

    const afterCostChoice = applyLegalAction({
      state: opened,
      action: resolveAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      summonCostExcludeSelectedCardInstanceIds: [],
      paymentSources: [{ kind: "reserve", amount: 7 }],
    }).state;

    expect(afterCostChoice.pendingSummonCostExcludeChoice ?? null).toBeNull();
    for (const id of ["trash-0", "trash-1", "trash-2"]) {
      expect(
        afterCostChoice.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }

    const passBob = actionsFor(afterCostChoice, BOB).find(
      (a) => a.kind === "pass_stack"
    )!;
    const afterPass = applyLegalAction({
      state: afterCostChoice,
      action: passBob,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    const resolvePlacement = actionsFor(afterPass, ALICE).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    )!;
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolvePlacement,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const card = resolved.cardInstances.find(
      (c) => c.instanceId === "orleans-1"
    )!;
    expect(card.zone).toBe("field");
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
  });
});
