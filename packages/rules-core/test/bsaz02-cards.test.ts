/**
 * BSAZ02 (アルドノア・ゼロ-火星-) カードの effects 検証テスト。
 * アルティメット中心（火星・ＣＦ）。【アルドノアドライブ：1】カードスタック機構・
 * アルティメット召喚条件・転醒（double_sided）・導界者（導託/導域/導技）・分身生成は
 * 基盤未実装のため stub。ungated な召喚時 deck reveal / draw / フラッシュ bounce のみ DSL 変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeSendToDeck,
  flushPendingLeaves,
  getLegalActions,
  initializeGame,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type {
  CardDefinition,
  CollectedTriggerEvent,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

describe("BSAZ02-C06 スカイキャリア", () => {
  const c = card("BSAZ02-C06");
  it("召喚時デッキ5オープン→ＣＦアルティメット1pick（ターンに1回）", () => {
    const summon = c.effects![0]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const reveal = summon.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(5);
      expect(reveal.remainder).toBe("bottom");
    }
    // 【アルドノアドライブ：1】gated フラッシュ効果は実装済み
    // (詳細検証: bsaz02-c06-sky-carrier.test.ts)。
    const drive = c.effects![1]!;
    expect(drive.stub).toBeUndefined();
    expect(drive.timing).toEqual({ kind: "activated", mode: "flash" });
  });
});

describe("BSAZ02-C10 アルドノアドライブ", () => {
  const c = card("BSAZ02-C10");
  it("BSAZ02-C10 maxDeckCount=20 + スピリット状態ルール/下カード配置/合体不可/召喚時ドローを表現する", () => {
    // [0] text[2] 「スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない」
    // = continuous + applicability.combined=false + effect_resistance(exhaust) + prevent_battle
    const spiritStateEffect = c.effects![0]!;
    expect(spiritStateEffect.timing.kind).toBe("continuous");
    expect(spiritStateEffect.applicability?.combined).toBe(false);
    const resistance = spiritStateEffect.steps[0]!.action;
    expect(resistance.kind).toBe("effect_resistance");
    if (resistance.kind === "effect_resistance") {
      expect(resistance.resistsOutcome).toBe("exhaust");
      expect(resistance.source).toBe("all");
      expect(resistance.ruleStrength).toBe(true);
    }
    const battleBan = spiritStateEffect.steps[1]!.action;
    expect(battleBan.kind).toBe("prevent_battle");
    if (battleBan.kind === "prevent_battle") {
      expect(battleBan.restriction).toEqual(["attack", "block"]);
      expect(battleBan.ruleStrength).toBe(true);
    }
    // [1] 【アルドノアドライブ】host 下カード配置 (engine-aldnoah-drive-under-card-keyword で実装済)。
    const placement = c.effects![1]!;
    expect(placement.timing.kind).toBe("game_event");
    expect(placement.steps[0]!.action.kind).toBe("place_text_role_under_card");
    // textLines[0] (20枚までデッキに入れられる) は maxDeckCount、textLines[8]
    // 【合体条件：合体不可】は keywordTags:["cannot_combine"] で宣言的に表現済み (残 stub 無し)。
    expect(c.maxDeckCount).toBe(20);
    expect(c.keywordTags).toContain("cannot_combine");
    // [2] Lv1 召喚時 ドロー1→手札1枚デッキ下
    const summon = c.effects![2]!;
    expect(summon.steps[0]!.action.kind).toBe("draw");
    const send = summon.steps[1]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck") {
      expect(send.position).toBe("bottom");
      expect(send.target.kind).toBe("filter");
      if (send.target.kind === "filter") {
        expect(send.target.zone).toBe("hand");
      }
    }
  });

  it("BSAZ02-C10 maxDeckCount=20: デッキ上限20枚を初期化時に適用する", () => {
    expect(() =>
      initializeGame({
        decks: [[...Array(21).fill(c)], [c]],
        skipPreGame: true,
      })
    ).toThrow(/BSAZ02-C10 has 21 copies, maxDeckCount=20/);

    expect(() =>
      initializeGame({
        decks: [[...Array(20).fill(c)], [c]],
        skipPreGame: true,
      })
    ).not.toThrow();
  });
});

describe("BSAZ02-X04/X05 導域ただちに優先解決", () => {
  const x04 = card("BSAZ02-X04");
  const x05 = card("BSAZ02-X05");
  const hostDefinition = card("BSAZ02-C01");
  const driveDefinition = card("BSAZ02-C10");
  const normalResponder: CardDefinition = {
    ...x04,
    cardNo: "TEST-BSAZ02-NORMAL-ALDNOAH-RESPONDER",
    name: "通常誘発テスト用アルドノア応答",
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: { declaresUnderCardSlot: "アルドノアドライブ" },
        },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0],
      },
    ],
  };
  const testCards = [...ALL_CARDS, normalResponder];
  const testCardMap = new Map<string, CardDefinition>(
    testCards.map((definition) => [definition.cardNo, definition])
  );
  const getTestDef = (id: string) => testCardMap.get(id);
  const triggeredLookup = buildTriggeredEffectLookup(testCards);
  const magicLookup = buildMagicLookup(testCards);

  function passAllStacks(state: GameState): GameState {
    let current = state;
    for (let guard = 0; guard < 8 && current.stackWindow; guard++) {
      const priorityPlayerId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId: priorityPlayerId,
        getCardDefinitionById: getTestDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => undefined,
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(pass).toBeDefined();
      if (!pass) break;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getTestDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }
    return current;
  }

  it("X04/X05 は optional immediate として登録され、通常誘発より先に X04 を解決して下敷きを置く", () => {
    expect(x04.effects![1]!.executionMode).toBe("optional");
    expect(x04.effects![1]!.triggerPriority).toBe("immediate");
    expect(x05.effects![1]!.executionMode).toBe("optional");
    expect(x05.effects![1]!.triggerPriority).toBe("immediate");
    expect(driveDefinition.effects![1]!.triggerPriority).toBe("immediate");

    const x04Instance = createCardInstance(x04, {
      instanceId: "x04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const normalInstance = createCardInstance(normalResponder, {
      instanceId: "normal-responder",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const summonedHost = createCardInstance(hostDefinition, {
      instanceId: "summoned-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const trashDrive = createCardInstance(driveDefinition, {
      instanceId: "trash-drive",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [x04Instance, normalInstance, summonedHost, trashDrive],
      playerOverrides: [
        { reserveNormalCoreCount: 3, deckCount: 10 },
        { reserveNormalCoreCount: 3, deckCount: 10 },
      ],
    });
    const summonEvent: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:bsaz02-cards:224",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "summoned-host",
      amount: null,
      fromZone: "hand",
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent],
      undefined,
      {
        getCardDefinitionById: getTestDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    expect(
      queued.pendingTriggeredEffects.map(
        (pending) => pending.triggerPriority ?? "normal"
      )
    ).toEqual(expect.arrayContaining(["immediate", "normal"]));

    const firstActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getTestDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const firstResolveActions = firstActions.filter(
      (action) => action.kind === "resolve_pending_triggered_effect"
    );
    expect(firstResolveActions).toHaveLength(1);
    const x04Resolve = firstResolveActions[0]!;
    expect(x04Resolve.sourceCardNo).toBe("BSAZ02-X04");
    expect(
      firstActions.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceCardNo === normalResponder.cardNo
      )
    ).toBe(false);

    const declared = applyLegalAction({
      state: queued,
      action: x04Resolve,
      getCardDefinitionById: getTestDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
    const resolved = passAllStacks(declared);

    const hostAfter = resolved.cardInstances.find(
      (instance) => instance.instanceId === "summoned-host"
    )!;
    expect(hostAfter.underCards).toContainEqual({
      cardInstanceId: "trash-drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    });
    const driveAfter = resolved.cardInstances.find(
      (instance) => instance.instanceId === "trash-drive"
    )!;
    expect(driveAfter.zone).toBe("field");
    expect(driveAfter.attachedToInstanceId).toBe("summoned-host");
    expect(
      resolved.pendingTriggeredEffects.some(
        (pending) => pending.triggerPriority === "immediate"
      )
    ).toBe(false);

    const afterActions = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: getTestDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    expect(
      afterActions.some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceCardNo === normalResponder.cardNo
      )
    ).toBe(true);
  });
});

describe("BSAZ02-C12 ザーツバルム", () => {
  const c = card("BSAZ02-C12");
  it("召喚時デッキ4オープン→火星1pick（残り破棄）", () => {
    const summon = c.effects![0]!;
    const reveal = summon.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(4);
      expect(reveal.remainder).toBe("trash");
    }
  });
});

describe("BSAZ02-C15 隕石爆撃", () => {
  const c = card("BSAZ02-C15");
  it("フラッシュ：本来コスト6以下の相手3体までデッキ下（bounce）", () => {
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const send = flash.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck") {
      expect(send.position).toBe("bottom");
      expect(send.target.kind).toBe("filter");
      if (send.target.kind === "filter") {
        expect(send.target.player).toBe("opponent");
        expect(send.target.count).toEqual({ min: 0, max: 3 });
      }
    }
  });
});

describe("BSAZ02-C14 ヘブンズフォール", () => {
  const c = card("BSAZ02-C14");
  const cfUltimate = card("BSAZ02-C01");
  const getDef = (id: string) => cardNoMap.get(id);
  const magicLookup = buildMagicLookup(ALL_CARDS);
  const leaveTriggerSpirit: CardDefinition = {
    ...cfUltimate,
    cardNo: "TEST-C14-LEAVE-SPIRIT",
    name: "leave trigger spirit",
    printedCategory: "spirit",
    summonCondition: undefined,
    effects: [
      {
        timing: { kind: "card_event", event: "leave_field" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0],
      },
    ],
  };
  const leaveTriggerUltimate: CardDefinition = {
    ...cfUltimate,
    cardNo: "TEST-C14-LEAVE-ULTIMATE",
    name: "leave trigger ultimate",
    summonCondition: undefined,
    effects: [
      {
        timing: { kind: "card_event", event: "leave_field" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0],
      },
    ],
  };
  const c14TestCards = [...ALL_CARDS, leaveTriggerSpirit, leaveTriggerUltimate];
  const c14TestCardMap = new Map<string, CardDefinition>(
    c14TestCards.map((definition) => [definition.cardNo, definition])
  );
  const getC14TestDef = (id: string) => c14TestCardMap.get(id);
  const c14TriggeredLookup = buildTriggeredEffectLookup(c14TestCards);

  function cannotLeaveCE(
    targetInstanceId: string,
    tag: ContinuousEffectTag,
    ownerPlayerId: string
  ): ContinuousEffect {
    return {
      effectId: `test-${tag}-${targetInstanceId}`,
      sourceInstanceId: "test-source",
      sourceDefinitionId: "test",
      actingPlayerId: ownerPlayerId,
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: tag,
      targetInstanceId,
      metadata: { source: "opponent_effect" },
    };
  }

  function buildState(): GameState {
    const magic = createCardInstance(c, {
      instanceId: "heavens-fall",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const fieldCf = createCardInstance(cfUltimate, {
      instanceId: "field-cf",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const trashCfA = createCardInstance(cfUltimate, {
      instanceId: "trash-cf-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const trashCfB = createCardInstance(cfUltimate, {
      instanceId: "trash-cf-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const existingDeckCard = createCardInstance(cfUltimate, {
      instanceId: "deck-existing",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [existingDeckCard, magic, fieldCf, trashCfA, trashCfB],
        playerOverrides: [
          { reserveNormalCoreCount: 3, handCount: 1, deckCount: 30 },
          { reserveNormalCoreCount: 3, deckCount: 30 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "main_step",
    };
  }

  it("cost override + 使用時ゾーンコスト + 全体破壊をDSLで表現する", () => {
    expect(c.effects).toHaveLength(3);
    expect(c.effects!.some((effect) => effect.stub)).toBe(false);

    const costOverride = c.effects![0]!.steps[0]!.action;
    expect(costOverride.kind).toBe("cost_modify");
    if (costOverride.kind === "cost_modify") {
      expect(costOverride.modifier).toEqual({ override: 6 });
    }

    const discount = c.effects![1]!.steps[0]!.action;
    expect(discount.kind).toBe("cost_modify");
    if (discount.kind === "cost_modify") {
      expect(discount.modifier).toEqual({ additionalCostValue: -3 });
      expect(discount.useCostPayment).toEqual({
        kind: "return_to_deck_top_bottom",
        sourceZone: "trash",
        count: 2,
        filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
      });
    }

    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.preventionLevel).toBe("unpreventable");
    expect(flash.steps).toHaveLength(1);
    const destroy = flash.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy") {
      expect(destroy.suppressDestroyedEffects).toBe("destroyed_only");
      expect(destroy.target.kind).toBe("filter");
      if (destroy.target.kind === "filter") {
        expect(destroy.target.player).toBe("either");
        expect(destroy.target.filter).toEqual({
          category: ["spirit", "ultimate"],
        });
        expect(destroy.target.count).toBe("all");
      }
    }
  });

  it("CFアルティメット条件でコスト6化し、トラッシュ2枚を戻して3コストで使用する", () => {
    const state = buildState();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "heavens-fall" &&
        a.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.reducedCost).toBe(6);
    expect(action.additionalCost).toBe(-3);
    expect(action.finalCost).toBe(3);
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "trash-cf-a",
      "trash-cf-b",
    ]);

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      selectedZoneCardIds: ["trash-cf-a", "trash-cf-b"],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(result.stackWindow).not.toBeNull();
    expect(
      result.cardInstances.find((x) => x.instanceId === "heavens-fall")?.zone
    ).toBe("in_use");
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-a")?.zone
    ).toBe("deck");
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-b")?.zone
    ).toBe("deck");
    expect(
      result.cardInstances
        .filter((x) => x.ownerPlayerId === "alice" && x.zone === "deck")
        .map((x) => x.instanceId)
    ).toEqual(["trash-cf-a", "deck-existing", "trash-cf-b"]);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.deckCount).toBe(32);
  });

  it("zone_discountは戻す2枚と上/下順序の明示選択を要求する", () => {
    const state = buildState();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "heavens-fall" &&
        a.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(() =>
      applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: 3 }],
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      })
    ).toThrow(/requires selected zone cards/);
    expect(() =>
      applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: 3 }],
        selectedZoneCardIds: ["trash-cf-a", "trash-cf-a"],
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      })
    ).toThrow(/must be unique/);
  });

  it("zone_discountのトラッシュ候補はowner基準で、戻したカード上のコアをリザーブへ返す", () => {
    const base = buildState();
    const state: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((cardInstance) => {
        if (cardInstance.instanceId === "trash-cf-a") {
          return {
            ...cardInstance,
            controllerPlayerId: "bob",
            normalCoreCount: 1,
          };
        }
        if (cardInstance.instanceId === "trash-cf-b") {
          return {
            ...cardInstance,
            controllerPlayerId: "bob",
            normalCoreCount: 2,
          };
        }
        return cardInstance;
      }),
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "heavens-fall" &&
        candidate.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.zoneCostPaymentCandidateIds?.sort()).toEqual([
      "trash-cf-a",
      "trash-cf-b",
    ]);

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      selectedZoneCardIds: ["trash-cf-a", "trash-cf-b"],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-a")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-b")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-a")
        ?.controllerPlayerId
    ).toBe("alice");
    expect(
      result.cardInstances.find((x) => x.instanceId === "trash-cf-b")
        ?.controllerPlayerId
    ).toBe("alice");
  });

  it("zone_discountで軽減後コストが負になる場合は0に丸めて支払いなしで使用できる", () => {
    const lowCostMagic: CardDefinition = {
      ...c,
      cardNo: "TEST-C14-LOW-COST",
      cost: 2,
      effects: [c.effects![1]!, c.effects![2]!],
    };
    const lowCostLookup = buildMagicLookup([...ALL_CARDS, lowCostMagic]);
    const lowCostMap = new Map(c14TestCardMap);
    lowCostMap.set(lowCostMagic.cardNo, lowCostMagic);
    const lowCostGetDef = (id: string) => lowCostMap.get(id);
    const base = buildState();
    const state: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "heavens-fall"
          ? { ...cardInstance, definitionId: lowCostMagic.cardNo }
          : cardInstance
      ),
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lowCostGetDef,
      getRegisteredMagicActions: lowCostLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: c14TriggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "heavens-fall" &&
        a.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;
    expect(action.reducedCost).toBe(2);
    expect(action.additionalCost).toBe(-3);
    expect(action.finalCost).toBe(0);

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [],
      selectedZoneCardIds: ["trash-cf-a", "trash-cf-b"],
      getCardDefinitionById: lowCostGetDef,
      getRegisteredMagicActions: lowCostLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: c14TriggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(result.stackWindow).not.toBeNull();
    expect(
      result.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(3);
  });

  it("スタック解決後に防げない全体破壊を適用し、破壊時効果を発揮させない", () => {
    const base = buildState();
    const selfLeave = createCardInstance(leaveTriggerSpirit, {
      instanceId: "self-leave-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const opponentLeave = createCardInstance(leaveTriggerUltimate, {
      instanceId: "opponent-leave-ultimate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, selfLeave, opponentLeave],
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        cannotLeaveCE("opponent-leave-ultimate", "cannot_be_destroyed", "bob"),
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getC14TestDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: c14TriggeredLookup,
      getRegisteredBurstActions: () => undefined,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "heavens-fall" &&
        a.costMode === "zone_discount"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    let current = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      selectedZoneCardIds: ["trash-cf-a", "trash-cf-b"],
      getCardDefinitionById: getC14TestDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: c14TriggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;

    for (let guard = 0; guard < 8 && current.stackWindow; guard++) {
      const priorityPlayerId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId: priorityPlayerId,
        getCardDefinitionById: getC14TestDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: c14TriggeredLookup,
        getRegisteredBurstActions: () => undefined,
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(pass).toBeDefined();
      if (!pass) break;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getC14TestDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: c14TriggeredLookup,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }

    expect(current.stackWindow).toBeNull();
    expect(
      current.cardInstances.find((x) => x.instanceId === "field-cf")?.zone
    ).toBe("trash");
    expect(
      current.cardInstances.find((x) => x.instanceId === "self-leave-spirit")
        ?.zone
    ).toBe("trash");
    expect(
      current.cardInstances.find(
        (x) => x.instanceId === "opponent-leave-ultimate"
      )?.zone
    ).toBe("trash");
    expect(
      current.pendingTriggeredEffects.some(
        (pending) =>
          pending.sourceInstanceId === "self-leave-spirit" ||
          pending.sourceInstanceId === "opponent-leave-ultimate"
      )
    ).toBe(false);
  });
});

describe("BSAZ02-C18 旋転する罠", () => {
  const c = card("BSAZ02-C18");
  const getDef = (id: string) => cardNoMap.get(id);
  const spirit = card("BSAZ02-C06");
  const ultimate = card("BSAZ02-C01");

  it("フラッシュ：スピリット/アルティメット1体をデッキ下（either）", () => {
    const flash = c.effects![1]!;
    const send = flash.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind === "send_to_deck" && send.target.kind === "filter") {
      expect(send.target.player).toBe("either");
    }
  });

  it("either send_to_deck executor は自分側だけが候補でもデッキ下へ戻せる", () => {
    const send = c.effects![1]!.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind !== "send_to_deck") return;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spirit, {
          instanceId: "alice-existing-deck",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(spirit, {
          instanceId: "self-spirit",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 3, deckCount: 10 },
        { reserveNormalCoreCount: 3, deckCount: 10 },
      ],
    });

    const result = flushPendingLeaves(
      executeSendToDeck(state, "alice", send, getDef, "c18-source"),
      getDef
    );
    const moved = result.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "self-spirit"
    );
    expect(moved?.zone).toBe("deck");
    expect(moved?.controllerPlayerId).toBe("alice");
    expect(
      result.cardInstances
        .filter(
          (cardInstance) =>
            cardInstance.ownerPlayerId === "alice" &&
            cardInstance.zone === "deck"
        )
        .map((cardInstance) => cardInstance.instanceId)
    ).toEqual(["alice-existing-deck", "self-spirit"]);
    const alice = result.players.find((player) => player.id === "alice")!;
    expect(alice.deckCount).toBe(11);
    expect(alice.reserveNormalCoreCount).toBe(5);
  });

  it("either send_to_deck executor は相手側だけが候補でもデッキ下へ戻せる", () => {
    const send = c.effects![1]!.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind !== "send_to_deck") return;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(ultimate, {
          instanceId: "bob-existing-deck",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "deck",
        }),
        createCardInstance(ultimate, {
          instanceId: "opponent-ultimate",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 3, deckCount: 10 },
        { reserveNormalCoreCount: 3, deckCount: 10 },
      ],
    });

    const result = flushPendingLeaves(
      executeSendToDeck(state, "alice", send, getDef, "c18-source"),
      getDef
    );
    const moved = result.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "opponent-ultimate"
    );
    expect(moved?.zone).toBe("deck");
    expect(moved?.controllerPlayerId).toBe("bob");
    expect(
      result.cardInstances
        .filter(
          (cardInstance) =>
            cardInstance.ownerPlayerId === "bob" && cardInstance.zone === "deck"
        )
        .map((cardInstance) => cardInstance.instanceId)
    ).toEqual(["bob-existing-deck", "opponent-ultimate"]);
    const bob = result.players.find((player) => player.id === "bob")!;
    expect(bob.deckCount).toBe(11);
    expect(bob.reserveNormalCoreCount).toBe(4);
  });

  it("send_to_deck executor は position:top なら既存デッキの上に戻す", () => {
    const send = c.effects![1]!.steps[0]!.action;
    expect(send.kind).toBe("send_to_deck");
    if (send.kind !== "send_to_deck") return;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spirit, {
          instanceId: "alice-existing-deck",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(spirit, {
          instanceId: "self-spirit",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 3, deckCount: 10 },
        { reserveNormalCoreCount: 3, deckCount: 10 },
      ],
    });

    const result = flushPendingLeaves(
      executeSendToDeck(
        state,
        "alice",
        { ...send, position: "top" },
        getDef,
        "c18-source"
      ),
      getDef
    );

    expect(
      result.cardInstances
        .filter(
          (cardInstance) =>
            cardInstance.ownerPlayerId === "alice" &&
            cardInstance.zone === "deck"
        )
        .map((cardInstance) => cardInstance.instanceId)
    ).toEqual(["self-spirit", "alice-existing-deck"]);
  });
});
