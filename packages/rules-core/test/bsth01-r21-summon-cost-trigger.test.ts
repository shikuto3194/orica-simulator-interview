/**
 * BSTH01-R21「紅魔館」effects[2] の原文忠実度回帰。
 *
 * Lv2 の「系統:『夜族』を持つコスト8以上の自分の赤のスピリットが召喚されたとき、
 * 〔ターンに1回:同名〕自分のライフが5になるようにボイドからコアを置ける」を、
 * game_event:summon の triggerFilter と void→life の core_move で表す。
 *
 * 特に「コスト8以上」は反応する召喚カード側の条件であり、カード本体のコストや
 * 効果解決後の対象選択に置き換えない。7コストは候補外、8コストは候補化され、
 * 実解決で不足したライフコアをボイドから補うことを同じ盤面で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  getAvailableTriggeredEffectSourceChoices,
  applyLegalAction,
  buildFieldCardEffectLookup,
} from "../src";
import type { CardDefinition, GameState, PendingTriggeredEffect } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const 紅魔館 = cardNoMap.get("BSTH01-R21")!;

function makeNightSpirit(cost: number): CardDefinition {
  return {
    cardNo: `TEST-BSTH01-R21-NIGHT-${cost}`,
    name: `test 夜族 ${cost}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "夜族",
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

const SEVEN_COST_NIGHT = makeNightSpirit(7);
const EIGHT_COST_NIGHT = makeNightSpirit(8);
const definitions = [紅魔館, SEVEN_COST_NIGHT, EIGHT_COST_NIGHT];
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  definitions.find((definition) => definition.cardNo === id);
const triggeredLookup = buildTriggeredEffectLookup(definitions);
const fieldLookup = buildFieldCardEffectLookup(definitions);

function summonPending(relatedInstanceId: string): PendingTriggeredEffect {
  return {
    pendingId: `pending-${relatedInstanceId}`,
    actingPlayerId: "alice",
    eventKind: "summon",
    event: {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "require_related_instance_on_field",
    },
    source: "action_resolution",
    chainId: "test:bsth01-r21-summon-cost-trigger:58",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
  };
}

function stateAfterSummon(
  summoned: CardDefinition,
  mansionCount = 1
): GameState {
  const mansions = Array.from({ length: mansionCount }, (_, index) =>
    createCardInstance(紅魔館, {
      instanceId: `alice-scarlet-mansion-${index + 1}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2
    })
  );
  const summonedSpirit = createCardInstance(summoned, {
    instanceId: "alice-summoned-night",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ lifeNormalCoreCount: 3, voidNormalCoreCount: 190 }, {}],
    cardInstances: [...mansions, summonedSpirit],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    pendingTriggeredEffects: [summonPending(summonedSpirit.instanceId)],
  };
}

/** P3-29 の stack 窓を相手の pass で閉じ、宣言済み誘発を実解決する。 */
function passOpponentToResolveTriggeredEffect(state: GameState): GameState {
  if (state.window !== "stack" || !state.stackWindow) return state;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${state.stackWindow.priorityPlayerId}`,
      can: true,
      reason: "BSTH01-R21 shared turn limit regression",
      actingPlayerId: state.stackWindow.priorityPlayerId,
    },
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

describe("BSTH01-R21 紅魔館: 夜族・コスト8以上の召喚時ライフ回復", () => {
  it("7コスト夜族は候補外、8コスト夜族は Lv2 の実カード効果候補になる", () => {
    const sevenCostState = stateAfterSummon(SEVEN_COST_NIGHT);
    const sevenCostChoices = getAvailableTriggeredEffectSourceChoices({
      state: sevenCostState,
      pendingEffect: sevenCostState.pendingTriggeredEffects[0]!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(sevenCostChoices).toHaveLength(0);

    const eightCostState = stateAfterSummon(EIGHT_COST_NIGHT);
    const eightCostChoices = getAvailableTriggeredEffectSourceChoices({
      state: eightCostState,
      pendingEffect: eightCostState.pendingTriggeredEffects[0]!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    expect(eightCostChoices).toHaveLength(1);
    expect(eightCostChoices[0]).toMatchObject({
      sourceCard: { instanceId: "alice-scarlet-mansion-1" },
      sourceDefinition: { cardNo: "BSTH01-R21" },
      actionRegistration: { effectIndex: 2 },
    });
  });

  it("8コストの候補から実効果を解決すると、ライフを5まで回復する", () => {
    const state = stateAfterSummon(EIGHT_COST_NIGHT);
    const after = executeEffect({
      chainId: "test:bsth01-r21-summon-cost-trigger:158",
      state,
      effect: 紅魔館.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "alice-scarlet-mansion-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const beforeAlice = state.players.find((player) => player.id === "alice")!;
    const afterAlice = after.players.find((player) => player.id === "alice")!;
    expect(afterAlice).toMatchObject({
      lifeNormalCoreCount: 5,
      reserveNormalCoreCount: beforeAlice.reserveNormalCoreCount,
    });
    expect(afterAlice.voidNormalCoreCount).toBe(
      beforeAlice.voidNormalCoreCount - 2
    );
  });

  it("同名2枚の実際の pending 解決では、1枚目だけが同ターンに使用できる", () => {
    const state = stateAfterSummon(EIGHT_COST_NIGHT, 2);
    const initialActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.eventKind === "summon"
    );

    // 同じイベントには同名2枚とも反応候補になるが、実行できるのは先に選んだ1枚だけ。
    expect(initialActions).toHaveLength(2);
    const firstAction = initialActions.find(
      (action) => action.sourceInstanceId === "alice-scarlet-mansion-1"
    );
    expect(firstAction).toBeDefined();
    if (
      !firstAction ||
      firstAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected the first Scarlet Mansion trigger action");
    }

    const declared = applyLegalAction({
      state,
      action: firstAction,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    const afterFirstResolution = passOpponentToResolveTriggeredEffect(declared);
    const afterAlice = afterFirstResolution.players.find(
      (player) => player.id === "alice"
    )!;

    expect(afterAlice.lifeNormalCoreCount).toBe(5);
    expect(afterFirstResolution.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: 紅魔館.cardNo,
          sourceInstanceId: "alice-scarlet-mansion-1",
        }),
      ])
    );

    // 〔ターンに1回:同名〕は個体ごとではなく同名共有: 残る2枚目は候補にも戻らない。
    expect(
      afterFirstResolution.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "summon"
      )
    ).toHaveLength(0);
    expect(
      getLegalActions({
        state: afterFirstResolution,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "alice-scarlet-mansion-2"
      )
    ).toHaveLength(0);
  });
});
