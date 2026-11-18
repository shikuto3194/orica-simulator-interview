import { finishCoreChoices } from "./helpers/core-choice-driver";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH02.7-C06 試験中「レベルティターニア」effects[1] フラッシュ二択 branch2 の検証。
 *
 * 原文 (textLines[2,3] 抜粋、branch2 のみ):
 * "フラッシュ
 *  ...または、〔ゲームに1回:同名〕手札/手元にある系統：「幻想」/「動玩」を持つコスト7以下
 *  のスピリットカード2枚までを軽減シンボルすべてを満たして召喚できる。このとき、トラッシュ
 *  にある黄1色のカード8枚までを除外することで、除外したカード4枚につき、召喚するスピリット
 *  カード1枚のコストを0にする。"
 *
 * choice[0] = summon (target:from_zone, count:{min:0,max:2}) +
 * groupedExcludeOverride（新規 primitive、mechanics/grouped-summon-cost-override-choice.ts）。
 * branch1 (life_damage_interception) の検証は
 * bsth02-7-c06-flash-life-prevention.test.ts を参照。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction, getLegalActions } from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";

function actionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("BSTH02.7-C06 effects[1] choice[0]: フラッシュ二択 branch2 (グループ化召喚コストオーバーライド)", () => {
  const c06 = card("BSTH02.7-C06");
  const flashChoice = c06.effects![1]!;

  it("DSL 構造: choice[0] は summon(from_zone, count:{min:0,max:2}) + groupedExcludeOverride", () => {
    const step0 = flashChoice.steps[0]!;
    expect(step0.choice).toHaveLength(1);
    const variant = step0.choice![0]!;
    expect(variant.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(variant.action.kind).toBe("summon");
    if (variant.action.kind === "summon") {
      expect(variant.action.target).toEqual({
        kind: "from_zone",
        zone: ["hand", "set_aside"],
        filter: {
          category: ["spirit"],
          tribes: ["幻想", "動玩"],
          maxCost: 7,
        },
        count: { min: 0, max: 2 },
      });
      expect(variant.action.groupedExcludeOverride).toEqual({
        sourceZone: "trash",
        maxCount: 8,
        groupSize: 4,
        filter: { colors: ["yellow"], colorCount: "mono" },
        overrideCost: 0,
      });
      expect(variant.action.costModifier).toBe("full_reduction");
    }
  });

  it("[board] トラッシュに除外候補が無ければ、pending を開かず印字コストで即座に2体召喚される", () => {
    const source = createCardInstance(c06, {
      instanceId: "c06-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritA = createCardInstance(card("BSTH02.7-C02"), {
      instanceId: "target-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritB = createCardInstance(card("BSTH02.7-C03"), {
      instanceId: "target-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    let state = createEmptyGameState({
      cardInstances: [source, spiritA, spiritB],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
    });

    state = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth02-7-c06-branch2-grouped-summon:104",
      state,
      effect: flashChoice,
      sourceInstanceId: "c06-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
      targetInstanceIds: ["target-a", "target-b"],
    });

    expect(state.pendingGroupedSummonCostOverrideChoice ?? null).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-a")!.zone
    ).toBe("field");
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-b")!.zone
    ).toBe("field");
    // costModifier:"full_reduction" により両対象とも軽減シンボル全数分軽減される:
    // BSTH02.7-C02 cost:5-3(reductionSymbols)=2 + BSTH02.7-C03 cost:4-3(reductionSymbols)=1
    // = 3 + 場入り維持コア Lv1 requiredCores 1個ずつ = 5。
    const alice = state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(20 - 5);
  });

  it("[board] トラッシュに除外候補があれば pendingGroupedSummonCostOverrideChoice を開く", () => {
    const source = createCardInstance(c06, {
      instanceId: "c06-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritA = createCardInstance(card("BSTH02.7-C02"), {
      instanceId: "target-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritB = createCardInstance(card("BSTH02.7-C03"), {
      instanceId: "target-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const yellowFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSTH02.7-C01"), {
        instanceId: `yellow-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    let state = createEmptyGameState({
      cardInstances: [source, spiritA, spiritB, ...yellowFillers],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
    });

    state = executeEffect({
      chainId: "test:bsth02-7-c06-branch2-grouped-summon:161",
      state,
      effect: flashChoice,
      sourceInstanceId: "c06-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
      targetInstanceIds: ["target-a", "target-b"],
    });

    const pending = state.pendingGroupedSummonCostOverrideChoice;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe(ALICE);
    expect(pending!.summonTargetInstanceIds).toEqual(["target-a", "target-b"]);
    expect(pending!.candidateCardInstanceIds).toEqual([
      "yellow-0",
      "yellow-1",
      "yellow-2",
      "yellow-3",
    ]);
    expect(pending!.maxCount).toBe(8);
    expect(pending!.groupSize).toBe(4);
    expect(pending!.overrideCost).toBe(0);
    // まだ場に出ていない。
    expect(
      state.cardInstances.find((c) => c.instanceId === "target-a")!.zone
    ).not.toBe("field");
  });

  it("[board] 4枚除外を選択: target-a のコストが0にオーバーライドされ、target-b は印字コストで支払われる", () => {
    const source = createCardInstance(c06, {
      instanceId: "c06-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritA = createCardInstance(card("BSTH02.7-C02"), {
      instanceId: "target-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritB = createCardInstance(card("BSTH02.7-C03"), {
      instanceId: "target-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const yellowFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSTH02.7-C01"), {
        instanceId: `yellow-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    let state = createEmptyGameState({
      cardInstances: [source, spiritA, spiritB, ...yellowFillers],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
    });

    state = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth02-7-c06-branch2-grouped-summon:223",
      state,
      effect: flashChoice,
      sourceInstanceId: "c06-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
      targetInstanceIds: ["target-a", "target-b"],
    });
    expect(state.pendingGroupedSummonCostOverrideChoice).not.toBeNull();

    const resolveAction = actionsFor(state, ALICE).find(
      (a) => a.kind === "resolve_pending_grouped_summon_cost_override_choice"
    );
    expect(resolveAction).toBeDefined();

    const resolved = finishCoreChoices(
      applyLegalAction({
        state,
        action: resolveAction!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        groupedSummonCostOverrideSelectedCardInstanceIds: [
          "yellow-0",
          "yellow-1",
          "yellow-2",
          "yellow-3",
        ],
      }).state,
      getDef
    );

    expect(resolved.pendingGroupedSummonCostOverrideChoice ?? null).toBeNull();
    for (const id of ["yellow-0", "yellow-1", "yellow-2", "yellow-3"]) {
      expect(
        resolved.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("removed_from_game");
    }
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-a")!.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "target-b")!.zone
    ).toBe("field");
    // target-a (先頭) はコスト0オーバーライド + 場入り維持コア1、target-b は
    // costModifier:"full_reduction" によるコスト1 (印字4-reductionSymbols3) +
    // 場入り維持コア1 = 合計3。
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(20 - 3);
  });

  it("[board] 0枚除外 (辞退相当): 両対象とも印字コストで召喚される", () => {
    const source = createCardInstance(c06, {
      instanceId: "c06-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritA = createCardInstance(card("BSTH02.7-C02"), {
      instanceId: "target-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spiritB = createCardInstance(card("BSTH02.7-C03"), {
      instanceId: "target-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const yellowFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSTH02.7-C01"), {
        instanceId: `yellow-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    );
    let state = createEmptyGameState({
      cardInstances: [source, spiritA, spiritB, ...yellowFillers],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
    });

    state = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth02-7-c06-branch2-grouped-summon:304",
      state,
      effect: flashChoice,
      sourceInstanceId: "c06-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      choiceIndex: 1,
      targetInstanceIds: ["target-a", "target-b"],
    });

    const resolveAction = actionsFor(state, ALICE).find(
      (a) => a.kind === "resolve_pending_grouped_summon_cost_override_choice"
    )!;
    const resolved = finishCoreChoices(
      applyLegalAction({
        state,
        action: resolveAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        groupedSummonCostOverrideSelectedCardInstanceIds: [],
      }).state,
      getDef
    );

    expect(resolved.pendingGroupedSummonCostOverrideChoice ?? null).toBeNull();
    for (const id of ["yellow-0", "yellow-1", "yellow-2", "yellow-3"]) {
      expect(
        resolved.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }
    const alice = resolved.players.find((p) => p.id === ALICE)!;
    // 除外0枚でも costModifier:"full_reduction" は両対象に適用される (pending が開いた
    // 時点で nonOverrideFullReduction は確定済み): 2 (C02) + 1 (C03) = 3
    // + 場入り維持コア1個ずつ = 5。
    expect(alice.reserveNormalCoreCount).toBe(20 - 5);
  });
});
