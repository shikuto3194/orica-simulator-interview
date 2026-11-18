/**
 * BSTH02.7-C02「紅毛の和蘭人形」 effects[0] 二択検証。
 *
 * 原文 (Lv1-Lv2-Lv3『このスピリットの召喚時』):
 * 「自分はデッキの下から2枚ドローできる。または、〔ゲームに1回:同名〕自分のトラッシュに
 * ある系統：「幻想」と「動玩」を持つカード3枚を除外することで、次の自分のスタートステップ
 * まで、相手のスピリット/アルティメット/ネクサス/創界神ネクサスのシンボルを0に固定する。」
 *
 * choice + ref_choice + conditional_cost で排他化 (BSTH02-C03 effects[0] 同型)。
 * 「次の自分のスタートステップまで」= duration{scope:"step",step:"start",whose:"self"}
 * (removeExpiredContinuousEffects の step-scope whose フィルタを本カードで新規配線。
 * continuous-effect-duration.test.ts にプリミティブ単体テストあり)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  getEffectiveSymbols,
} from "../src";
import type { CardDefinition, GameState, PendingTriggeredEffect } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const legalOptions = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

const card = cardNoMap.get("BSTH02.7-C02")!;

describe("BSTH02.7-C02 effects[0] shape: 二択 (choice + ref_choice + conditional_cost)", () => {
  const e0 = card.effects![0]!;

  it("stub が消えている", () => {
    expect(e0.stub).toBeUndefined();
    expect(e0.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(e0.executionMode).toBe("optional");
    expect(e0.steps).toHaveLength(2);
  });

  it("step0 (id:mode) = デフォルト draw 2 (bottom), choice[0] = remove_from_game トラッシュ幻想&動玩3枚", () => {
    const step0 = e0.steps[0]!;
    expect(step0.id).toBe("mode");
    expect(step0.action.kind).toBe("draw");
    if (step0.action.kind === "draw") {
      expect(step0.action.count).toBe(2);
      expect(step0.action.position).toBe("bottom");
    }
    expect(step0.choice).toHaveLength(1);
    const variant1 = step0.choice![0]!;
    expect(variant1.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(variant1.action.kind).toBe("remove_from_game");
    if (variant1.action.kind === "remove_from_game") {
      expect(variant1.action.target).toEqual({
        kind: "filter",
        player: "self",
        zone: "trash",
        filter: { tribesRequired: ["幻想", "動玩"] },
        count: 3,
      });
    }
    expect(variant1.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribesRequired: ["幻想", "動玩"],
        minCount: 3,
      },
    ]);
  });

  it("step1 = override_properties symbols:[] (相手 spirit/ultimate/nexus incl. grandwalker, all), ref_choice mode/1, conditional_cost", () => {
    const step1 = e0.steps[1]!;
    expect(step1.connector).toBe("conditional_cost");
    expect(step1.stepCondition).toEqual({
      kind: "ref_choice",
      stepId: "mode",
      choiceIndex: 1,
    });
    expect(step1.action.kind).toBe("override_properties");
    if (step1.action.kind === "override_properties") {
      expect(step1.action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: {
          filterOr: [
            { category: ["spirit"] },
            { category: ["ultimate"] },
            { category: ["nexus"], targetsGrandwalker: true },
          ],
        },
        count: "all",
      });
      expect(step1.action.properties).toEqual({
        symbols: [],
        symbolCountFixed: true,
      });
      expect(step1.action.duration).toEqual({
        scope: "step",
        step: "start",
        whose: "self",
      });
    }
  });
});

describe("BSTH02.7-C02 effects[0] 実行: mode 0 (choiceIndex=0) デッキ下から2枚ドロー", () => {
  function buildState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(card, {
      instanceId: "oranda-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // top -> bottom 順: top-1, top-2, bottom-1, bottom-2
    const deckCards = ["top-1", "top-2", "bottom-1", "bottom-2"].map((id) =>
      createCardInstance(card, {
        instanceId: `deck-${id}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const opponentSpirit = createCardInstance(card, {
      instanceId: "bob-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      cardInstances: [src, ...deckCards, opponentSpirit],
    };
  }

  it("デッキ下2枚 (bottom-1, bottom-2) が手札へ。上2枚は不変。相手のシンボルは上書きされない", () => {
    const state = buildState();
    const after = executeEffect({
      chainId: "test:bsth02-7-c02-choice-symbol-lock:161",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "oranda-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-bottom-1")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-bottom-2")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-top-1")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-top-2")?.zone
    ).toBe("deck");

    const bobSpirit = after.cardInstances.find(
      (c) => c.instanceId === "bob-spirit-1"
    )!;
    const symbols = getEffectiveSymbols(
      after,
      bobSpirit,
      card,
      getCardDefinitionById
    );
    expect(symbols.length).toBeGreaterThan(0);
  });
});

describe("BSTH02.7-C02 effects[0] 実行: mode 1 (choiceIndex=1) トラッシュ3枚除外→相手シンボル0固定", () => {
  // 系統マッチングは getCardDefinitionById 経由で解決されるため、cardNoMap に存在しない
  // 合成 CardDefinition ではなく実在カードを使う (合成 cardNo は解決不能で候補から漏れる)。
  const matchingTribeDef = card; // BSTH02.7-C02 自身: tribe "幻想・動玩" (合致)
  const nonMatchingTribeDef = cardNoMap.get("BSFT01-X01")!; // tribe "光導・星霊" (不一致)
  const bobSpiritDef = card; // printedCategory "spirit"
  const bobUltimateDef = cardNoMap.get("BSFT01-X01")!; // printedCategory "ultimate"
  const bobNexusDef = cardNoMap.get("BSFT01-C03")!; // printedCategory "nexus" (非創界神)
  const grandwalkerNexusDef = cardNoMap.get("BSTH01-XX01")!; // 導界者ネクサス (targetsGrandwalker 対象)

  function makeTrashCard(instanceId: string, matching: boolean) {
    return createCardInstance(
      matching ? matchingTribeDef : nonMatchingTribeDef,
      {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      }
    );
  }

  function buildState(args: { matchingTrashCount: number }): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(card, {
      instanceId: "oranda-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const matching = Array.from({ length: args.matchingTrashCount }, (_, i) =>
      makeTrashCard(`trash-match-${i}`, true)
    );
    const nonMatching = makeTrashCard("trash-nomatch", false);

    const bobCards = [
      createCardInstance(bobSpiritDef, {
        instanceId: "bob-spirit-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(bobUltimateDef, {
        instanceId: "bob-ultimate-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      }),
      createCardInstance(bobNexusDef, {
        instanceId: "bob-nexus-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      }),
      createCardInstance(grandwalkerNexusDef, {
        instanceId: "bob-grandwalker-nexus-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      }),
    ];

    return {
      ...base,
      turnNumber: 3,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [src, ...matching, nonMatching, ...bobCards],
    };
  }

  it("トラッシュに幻想&動玩3枚以上: 3枚除外され、相手 spirit/ultimate/nexus/創界神ネクサス のシンボルが0になる", () => {
    const state = buildState({ matchingTrashCount: 3 });
    const after = executeEffect({
      chainId: "test:bsth02-7-c02-choice-symbol-lock:271",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "oranda-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });

    const removedCount = after.cardInstances.filter(
      (c) =>
        c.instanceId.startsWith("trash-match-") &&
        c.zone === "removed_from_game"
    ).length;
    expect(removedCount).toBe(3);
    // 系統不一致のトラッシュカードは対象外で残留
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-nomatch")?.zone
    ).toBe("trash");

    for (const id of [
      "bob-spirit-1",
      "bob-ultimate-1",
      "bob-nexus-1",
      "bob-grandwalker-nexus-1",
    ]) {
      const instance = after.cardInstances.find((c) => c.instanceId === id)!;
      const def = getCardDefinitionById(instance.definitionId)!;
      const symbols = getEffectiveSymbols(
        after,
        instance,
        def,
        getCardDefinitionById
      );
      expect(symbols).toEqual([]);
    }

    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.duration.scope === "step" &&
          ce.duration.step === "start" &&
          ce.duration.whose === "self"
      )
    ).toBe(true);
  });

  it("トラッシュに幻想&動玩が2枚しかない: conditional_cost ロールバックで除外もシンボル上書きも起きない", () => {
    const state = buildState({ matchingTrashCount: 2 });
    const after = executeEffect({
      chainId: "test:bsth02-7-c02-choice-symbol-lock:320",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "oranda-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });

    const stillInTrash = after.cardInstances.filter(
      (c) => c.instanceId.startsWith("trash-match-") && c.zone === "trash"
    ).length;
    expect(stillInTrash).toBe(2);

    const bobSpirit = after.cardInstances.find(
      (c) => c.instanceId === "bob-spirit-1"
    )!;
    const def = getCardDefinitionById(bobSpirit.definitionId)!;
    const symbols = getEffectiveSymbols(
      after,
      bobSpirit,
      def,
      getCardDefinitionById
    );
    expect(symbols.length).toBeGreaterThan(0);
  });

  it("【盤面】同名の別個体で mode 1 を使うと再選択できず、mode 0 のドローは続けて選べる", () => {
    const secondSource = createCardInstance(card, {
      instanceId: "oranda-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCards = ["top-1", "top-2", "bottom-1", "bottom-2"].map((id) =>
      createCardInstance(card, {
        instanceId: `repeat-deck-${id}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const base = buildState({ matchingTrashCount: 6 });
    const initial: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, secondSource, ...deckCards],
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 4 } : player
      ),
      pendingTriggeredEffects: [makeSummonPending("oranda-first", "oranda-1")],
    };

    const firstAction = findTriggeredAction(initial, "oranda-1");
    expect(firstAction.deferredChoiceIndexes).toEqual([0, 1]);
    const afterMode1 = declareAndResolveChoice(initial, firstAction, 1, [
      "trash-match-0",
      "trash-match-1",
      "trash-match-2",
    ]);
    const requeued: GameState = {
      ...afterMode1,
      pendingTriggeredEffects: [makeSummonPending("oranda-second", "oranda-2")],
    };
    const secondAction = findTriggeredAction(requeued, "oranda-2");
    // 同名ゲーム中制限は mode 1 だけを候補から外す。通常ドローは残る。
    expect(secondAction.deferredChoiceIndexes).toEqual([0]);
    const afterMode0 = declareAndResolveChoice(requeued, secondAction, 0);

    expect(
      afterMode0.cardInstances.filter(
        (instance) =>
          instance.instanceId.startsWith("trash-match-") &&
          instance.zone === "removed_from_game"
      )
    ).toHaveLength(3);
    expect(
      afterMode0.cardInstances.find(
        (instance) => instance.instanceId === "repeat-deck-bottom-1"
      )?.zone
    ).toBe("hand");
    expect(
      afterMode0.cardInstances.find(
        (instance) => instance.instanceId === "repeat-deck-bottom-2"
      )?.zone
    ).toBe("hand");
  });
});

function makeSummonPending(
  pendingId: string,
  relatedInstanceId: string
): PendingTriggeredEffect {
  return {
    pendingId,
    eventKind: "summon",
    actingPlayerId: "alice",
    source: "action_resolution",
    chainId: "test:bsth02-7-c02-choice-symbol-lock:413",
    attackId: null,
    relatedPlayerId: null,
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "default",
    resolvedSourceInstanceIds: [],
  } as PendingTriggeredEffect;
}

function findTriggeredAction(state: GameState, sourceInstanceId: string) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...legalOptions,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      (candidate.sourceEffectInstanceId ?? candidate.sourceInstanceId) ===
        sourceInstanceId
  );
  if (!action || action.kind !== "resolve_pending_triggered_effect") {
    throw new Error(`missing triggered action for ${sourceInstanceId}`);
  }
  return action;
}

function declareAndResolveChoice(
  state: GameState,
  action: ReturnType<typeof findTriggeredAction>,
  choiceIndex: number,
  targetInstanceIds: string[] = []
): GameState {
  const declared = applyLegalAction({
    state,
    action,
    ...legalOptions,
  }).state;
  const pass = getLegalActions({
    state: declared,
    actingPlayerId: "bob",
    ...legalOptions,
  }).find((candidate) => candidate.kind === "pass_stack");
  if (!pass) throw new Error("missing stack pass");
  let current = applyLegalAction({
    state: declared,
    action: pass,
    ...legalOptions,
  }).state;
  const choice = getLegalActions({
    state: current,
    actingPlayerId: "alice",
    ...legalOptions,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_step_choice" &&
      candidate.choiceIndex === choiceIndex
  );
  if (!choice) throw new Error(`missing choice ${choiceIndex}`);
  current = applyLegalAction({
    state: current,
    action: choice,
    targetInstanceIds,
    ...legalOptions,
  }).state;
  if (current.pendingEffectTargetSelection !== null) {
    const target = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    if (!target) throw new Error("missing effect target selection");
    current = applyLegalAction({
      state: current,
      action: target,
      targetInstanceIds,
      ...legalOptions,
    }).state;
  }
  return current;
}
