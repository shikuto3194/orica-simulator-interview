/**
 * BSTH07 (東方星蓮船) カードの effects 検証テスト。
 *
 * カード番号順に最小 1 ケース、効果実行後の盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  calculateReduction,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateBurstRegistrations,
  getAvailableBurstSourceChoices,
  getCombinedUnitBp,
  getCombinedUnitSymbols,
  getEffectiveBp,
  getSymbolAdditions,
  queuePendingLeave,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { coreShootCardMatchesFilter } from "../src/effect/structured-core-shoot";
import { resolveTargetCards } from "../src/effect/structured-effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { flushPendingLeaves } from "../src/state-based-actions";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import {
  canReceiveBraveWithinCombineLimit,
  getCombinedUnitCost,
  canUseEffectByUsageLimit,
  evaluateContinuousDynamicAmount,
  getEffectiveTribes,
  getEffectSourceTribePreventionBypass,
  recordEffectUsage,
} from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  Effect,
  GameState,
  PendingTriggeredEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function buildDeck(def: CardDefinition, ownerId: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    createCardInstance(def, {
      instanceId: `${ownerId}-deck-${i + 1}`,
      ownerPlayerId: ownerId,
      controllerPlayerId: ownerId,
      zone: "deck",
    })
  );
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth07-cards:70",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

// ============================================================
// BSTH07-C01 / C02 ナズーリン / 多々良 小傘 (同一効果)
// ============================================================
describe.each([
  ["BSTH07-C01", "ナズーリン"],
  ["BSTH07-C02", "多々良 小傘"],
])("%s %s", (cardNo) => {
  const card = cardNoMap.get(cardNo)!;

  it("effects[0] 召喚/アタック時 deck_reveal (3枚, ターン1回, 幻想&起幻 AND)", () => {
    const e = card.effects![0]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    expect(e.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind === "deck_reveal") {
      expect(action.picks[1]!.filter?.tribesLogic).toBe("and");
    }
  });

  it("effects[1] メイン: 疲労コスト→ボイドコア→リザーブ", () => {
    const e = card.effects![1]!;
    expect(e.steps[0]!.action.kind).toBe("set_exhaust_state");
    expect(e.steps[1]!.connector).toBe("conditional_cost");
    expect(e.steps[1]!.action.kind).toBe("core_move");
  });
});

// ============================================================
// BSTH07-M01 [星蓮船]東風谷 早苗 (バースト)
// ============================================================
describe("BSTH07-M01 [星蓮船]東風谷 早苗", () => {
  const card = cardNoMap.get("BSTH07-M01")!;

  it("effects[0] バースト(相手手札増加) 3ドロー→破棄→召喚", () => {
    const e = card.effects![0]!;
    expect(e.timing).toEqual({
      kind: "burst",
      trigger: { kind: "hand_increase", player: "opponent" },
      cause: ["self_effect"],
    });
    expect(e.steps.map((s) => s.action.kind)).toEqual([
      "draw",
      "discard",
      "summon",
    ]);
  });

  it("effects[1] 召喚/アタック時 コスト6以下スピリット破壊 (実行で leave enqueue)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const self = createCardInstance(card, {
      instanceId: "sanae-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH07-C01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
    };
    const result = runEffect(state, card.effects![1]!, "sanae-1", "alice");
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "enemy-1"
    );
    expect(leave).toBeDefined();
  });
});

// ============================================================
// BSTH07-M02 [星蓮船]霧雨 魔理沙 (バースト)
// ============================================================
describe("BSTH07-M02 [星蓮船]霧雨 魔理沙", () => {
  const card = cardNoMap.get("BSTH07-M02")!;

  it("バースト(自スピリット離脱) 破壊→召喚 / アタック時 破壊→ドロー(conditional_result)", () => {
    expect(card.effects![0]!.timing.kind).toBe("burst");
    const atk = card.effects![1]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.steps[1]!.connector).toBe("conditional_result");
    expect(atk.steps[1]!.action.kind).toBe("draw");
  });

  it("バースト registration: triggerFilter category:[spirit] で非スピリット離脱を除外", () => {
    const regs = generateBurstRegistrations(card);
    const leaveReg = regs.find((r) => r.eventKind === "leave_field")!;
    expect(leaveReg).toBeDefined();
    expect(leaveReg.triggerFilter).toEqual({ category: ["spirit"] });
  });

  // ENGINE-burst-pending-leave-declaration-window: 相手由来の破壊で pendingLeave が
  // 積まれた時点 (flushPendingLeaves 実行前) で burst 発動宣言窓が開くこと、かつ離脱した
  // カードがスピリットでない場合は triggerFilter で候補から除外されることを検証する。
  describe("[board] pending leave 時点 (pre-flush) の発動宣言窓", () => {
    const burstLookup = buildBurstEffectLookup(ALL_CARDS);
    const nexusDef = ALL_CARDS.find((c) => c.printedCategory === "nexus")!;

    function buildBeforeState(victim: GameState["cardInstances"][number]) {
      const source = createCardInstance(card, {
        instanceId: "marisa-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      return {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "bob",
        step: "attack",
        cardInstances: [source, victim],
        setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-burst" }],
      };
    }

    function destroyByOpponentPreFlush(before: GameState, victimId: string) {
      const afterPendingLeave = queuePendingLeave({
        state: before,
        instanceId: victimId,
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-1",
      });
      // flushPendingLeaves は未実行 — victim はまだ zone:"field" のまま。
      const victimStillOnField = afterPendingLeave.cardInstances.find(
        (c) => c.instanceId === victimId
      );
      expect(victimStillOnField?.zone).toBe("field");
      expect(victimStillOnField?.pendingLeaveKind).toBe("destroy");

      return collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: afterPendingLeave,
        source: "action_resolution",
        chainId: "chain-1",
        causedByPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: burstLookup,
      });
    }

    it("自分のスピリットが相手起因で破壊 pending → flush 前でも発動候補に含まれる", () => {
      const victim = createCardInstance(cardNoMap.get("BSTH07-C01")!, {
        instanceId: "alice-spirit",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
      });
      const before = buildBeforeState(victim);
      const afterReactions = destroyByOpponentPreFlush(before, "alice-spirit");

      const check = afterReactions.pendingBurstChecks.find(
        (c) => c.relatedInstanceId === "alice-spirit"
      );
      expect(check).toBeDefined();
      const choices = getAvailableBurstSourceChoices({
        state: afterReactions,
        pendingBurstCheck: check!,
        getCardDefinitionById,
        getRegisteredBurstActions: burstLookup,
      });
      expect(
        choices.some((c) => c.sourceCard.instanceId === "marisa-burst")
      ).toBe(true);
    });

    it("自分のネクサスが相手起因で破壊 pending → triggerFilter で発動候補から除外", () => {
      const victim = createCardInstance(nexusDef, {
        instanceId: "alice-nexus",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "nexus",
        normalCoreCount: 1,
      });
      const before = buildBeforeState(victim);
      const afterReactions = destroyByOpponentPreFlush(before, "alice-nexus");

      // triggerFilter category:["spirit"] により、ネクサス離脱では応答可能な burst
      // source が誰にも存在しないため、pendingBurstCheck 自体が生成されない
      // (queueReactionsInternal の per-player prune、trigger-system.ts ~3680)。
      const check = afterReactions.pendingBurstChecks.find(
        (c) => c.relatedInstanceId === "alice-nexus"
      );
      expect(check).toBeUndefined();
    });
  });
});

// ============================================================
// BSTH07-M03 [星蓮船]博麗 霊夢 (バースト)
// ============================================================
describe("BSTH07-M03 [星蓮船]博麗 霊夢", () => {
  const card = cardNoMap.get("BSTH07-M03")!;

  it("バースト(相手召喚時): 創界神1つ全コア除去 → 自身召喚 / 召喚アタック時 ドロー+カウント2以上で回復", () => {
    const burst = card.effects![0]!;
    expect(burst.timing.kind).toBe("burst");
    expect(burst.stub).toBeUndefined();
    // step0: 単一対象コアシュート (targetsGrandwalker + from:target_card + amount:"all")
    const strip = burst.steps[0]!.action;
    expect(strip.kind).toBe("core_move");
    if (strip.kind === "core_move") {
      expect(strip.amount).toBe("all");
      expect(strip.from).toEqual({ kind: "target_card" });
      expect(strip.to).toEqual({ kind: "void", player: "opponent" });
      if (strip.target?.kind === "filter") {
        expect(strip.target.count).toBe(1);
        expect(strip.target.player).toBe("opponent");
        expect(strip.target.filter.tribes).toEqual(["導界者", "創界神"]);
        expect(strip.target.filter.targetsGrandwalker).toBe(true);
      }
    }
    // step1: 自身召喚 (sequential)
    expect(burst.steps[1]!.connector).toBe("sequential");
    expect(burst.steps[1]!.action.kind).toBe("summon");

    const e1 = card.effects![1]!;
    expect(e1.steps[0]!.action.kind).toBe("draw");
    const recover = e1.steps[1]!;
    expect(recover.action.kind).toBe("recover");
    expect(recover.condition).toEqual([
      { kind: "count_value", player: "self", min: 2 },
    ]);
    expect(recover.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
  });

  it("バースト 対象取得 + 実行: 候補は創界神/導界者のみ・実行で全コアがボイドへ + 自身召喚", () => {
    const burst = card.effects![0]!;
    const grandwalkerCard: CardDefinition = {
      cardNo: "TEST-GW-BSTH07M03",
      orikaId: 999100,
      orikaIndex: 999100,
      name: "テスト創界神",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "創界神",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
      effects: [],
    };
    const guidedCard: CardDefinition = {
      cardNo: "TEST-GD-BSTH07M03",
      orikaId: 999101,
      orikaIndex: 999101,
      name: "テスト導界者",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "導界者・起幻",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "guided" },
      effects: [],
    };
    const plainNexusCard: CardDefinition = {
      cardNo: "TEST-NEX-BSTH07M03",
      orikaId: 999102,
      orikaIndex: 999102,
      name: "テスト通常ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "幻想",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    cardNoMap.set(grandwalkerCard.cardNo, grandwalkerCard);
    cardNoMap.set(guidedCard.cardNo, guidedCard);
    cardNoMap.set(plainNexusCard.cardNo, plainNexusCard);
    const stripStep = burst.steps[0]!.action;
    if (stripStep.kind !== "core_move" || stripStep.target?.kind !== "filter") {
      throw new Error("expected core_move with filter target");
    }
    const filter = stripStep.target.filter;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const burstSelf = createCardInstance(card, {
      instanceId: "reimu-m03-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst_set",
    });
    const grandwalker = createCardInstance(grandwalkerCard, {
      instanceId: "gw-bsth07m03",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const guided = createCardInstance(guidedCard, {
      instanceId: "gd-bsth07m03",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const plainNexus = createCardInstance(plainNexusCard, {
      instanceId: "nex-bsth07m03",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "main",
      cardInstances: [burstSelf, grandwalker, guided, plainNexus],
    };
    // 対象取得: 創界神/導界者は候補化、通常ネクサスは除外。
    expect(
      matchesCardFilter(grandwalker, grandwalkerCard, filter, { state })
    ).toBe(true);
    expect(matchesCardFilter(guided, guidedCard, filter, { state })).toBe(true);
    expect(
      matchesCardFilter(plainNexus, plainNexusCard, filter, { state })
    ).toBe(false);

    // 実行: 創界神を対象 → 全コア除去 + 自身召喚。
    const result = executeEffect({
      chainId: "test:bsth07-cards:452",
      state,
      effect: burst,
      sourceInstanceId: "reimu-m03-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["gw-bsth07m03"],
    });
    const gwAfter = result.cardInstances.find(
      (c) => c.instanceId === "gw-bsth07m03"
    )!;
    expect(gwAfter.normalCoreCount).toBe(0);
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.voidNormalCoreCount).toBe(4);
    const selfAfter = result.cardInstances.find(
      (c) => c.instanceId === "reimu-m03-1"
    )!;
    expect(selfAfter.zone).toBe("field");
  });

  it("召喚/アタック時は毎回ドローし、カウント2以上の回復だけを個体ごとにターン1回にする", () => {
    const source = createCardInstance(card, {
      instanceId: "reimu-m03-once-per-turn",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 2, deckCount: 2, handCount: 0 }, {}],
      cardInstances: [source, ...buildDeck(card, "alice", 2)],
    });
    const effect = card.effects![1]!;
    const afterFirst = executeEffect({
      chainId: "test:bsth07-cards:488",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      afterFirst.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )?.exhaustState
    ).toBe("recovered");
    expect(
      afterFirst.players.find((player) => player.id === "alice")?.handCount
    ).toBe(1);

    const afterFirstExhausted: GameState = {
      ...afterFirst,
      cardInstances: afterFirst.cardInstances.map((entry) =>
        entry.instanceId === source.instanceId
          ? { ...entry, exhaustState: "exhausted" }
          : entry
      ),
    };
    const afterSecond = executeEffect({
      chainId: "test:bsth07-cards:513",
      state: afterFirstExhausted,
      effect,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      afterSecond.players.find((player) => player.id === "alice")?.handCount
    ).toBe(2);
    expect(
      afterSecond.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )?.exhaustState
    ).toBe("exhausted");
    expect(afterSecond.log).toContain(
      "effect:step-usage-exhausted:reimu-m03-once-per-turn:1:1"
    );
    expect(
      afterSecond.effectUsageRecords.filter(
        (record) =>
          record.effectLabel === "__step:BSTH07-M03:1:1" &&
          record.sourceInstanceId === source.instanceId
      )
    ).toHaveLength(1);
  });
});

// ============================================================
// BSTH07-R01 雲居 一輪
// ============================================================
describe("BSTH07-R01 雲居 一輪", () => {
  const card = cardNoMap.get("BSTH07-R01")!;

  it("召喚/アタック時 2ドロー+1破棄 / BSTH07-R01 雲山合体扱いは既存CEで表現", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("draw");
    expect(card.effects![0]!.steps[1]!.action.kind).toBe("discard");
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("override_properties");
    const virtualBrave =
      card.effects![1]!.steps[0]!.action.kind === "override_properties"
        ? card.effects![1]!.steps[0]!.action.properties
            .virtualAttachedBraves?.[0]
        : undefined;
    expect(virtualBrave).toMatchObject({
      cardName: "雲山",
      tribes: ["入道"],
      cost: 2,
      symbols: [],
      combinedBoost: 2000,
      countsTowardLimit: true,
    });
    expect(card.effects![1]!.textRef).toEqual([3, 4]);
    expect(card.textLines[4]).toContain("コスト2");
    expect(card.textLines[4]).toContain("カード名：「雲山」");
    expect(card.textLines[4]).toContain("系統：「入道」");
    expect(card.textLines[4]).toContain("合体中BP+2000");
    expect(card.textLines[4]).toContain("シンボル0");
    expect(card.effects![2]!.condition).toEqual([{ kind: "combined" }]);
    expect(card.effects![2]!.steps[0]!.action.kind).toBe("recover");
    expect(card.effects![2]!.textRef).toEqual([3, 4]);
    expect(card.textLines[4]).toContain(
      "ターンに1回、このスピリットは回復する"
    );
  });

  it("BSTH07-R01 雲山合体扱い: combined gate / cost6 / BP+2000 / アタック時回復が盤面に反映される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const selfAfterCe = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01"
    )!;

    expect(
      matchesCardFilter(
        selfAfterCe,
        card,
        { combined: true },
        { state: rebuilt }
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        selfAfterCe,
        card,
        { attachedBrave: { cardName: { exact: "雲山" } } },
        { state: rebuilt, getCardDefinitionById }
      )
    ).toBe(true);
    expect(
      getCombinedUnitCost(rebuilt, selfAfterCe, card, getCardDefinitionById)
    ).toBe(6);
    expect(
      getEffectiveBp(rebuilt, selfAfterCe, card, getCardDefinitionById)
    ).toBe(3000);
    expect(
      getCombinedUnitBp(rebuilt, selfAfterCe, card, getCardDefinitionById)
    ).toBe(5000);
    expect(
      getCombinedUnitSymbols(rebuilt, selfAfterCe, card, getCardDefinitionById)
    ).toEqual(["blue"]);
    const otherBrave: CardDefinition = {
      cardNo: "TEST-BSTH07-R01-BRAVE",
      name: "追加ブレイヴ",
      printedCategory: "brave",
      colors: ["blue"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      tribe: "入道",
      sourceUrls: [],
      sourceConfidence: "C",
      braveCondition: { categories: ["spirit"] },
    };
    expect(
      canReceiveBraveWithinCombineLimit({
        state: rebuilt,
        host: selfAfterCe,
        incomingBraveDef: otherBrave,
        getCardDefinitionById,
      })
    ).toBe(false);

    const recovered = executeEffect({
      chainId: "test:bsth07-cards:657",
      state: rebuilt,
      effect: card.effects![2]!,
      sourceInstanceId: "ichirin-bsth07-r01",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      recovered.cardInstances.find((c) => c.instanceId === "ichirin-bsth07-r01")
        ?.exhaustState
    ).toBe("recovered");
    const usageLimit = card.effects![2]!.usageLimit!;
    expect(
      canUseEffectByUsageLimit({
        state: rebuilt,
        sourceInstanceId: "ichirin-bsth07-r01",
        sourceDefinitionId: "BSTH07-R01",
        effectLabel: "BSTH07-R01-attack-recover",
        usageLimit,
      })
    ).toBe(true);
    const afterUsage = {
      ...rebuilt,
      effectUsageRecords: recordEffectUsage({
        state: rebuilt,
        sourceInstanceId: "ichirin-bsth07-r01",
        sourceDefinitionId: "BSTH07-R01",
        effectLabel: "BSTH07-R01-attack-recover",
        duration: "turn",
      }),
    };
    expect(
      canUseEffectByUsageLimit({
        state: afterUsage,
        sourceInstanceId: "ichirin-bsth07-r01",
        sourceDefinitionId: "BSTH07-R01",
        effectLabel: "BSTH07-R01-attack-recover",
        usageLimit,
      })
    ).toBe(false);

    const guestConditionEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      condition: [{ kind: "combined_guest_tribes", tribes: ["入道"] }],
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    };
    const exhaustedAgain: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((c) =>
        c.instanceId === "ichirin-bsth07-r01"
          ? { ...c, exhaustState: "exhausted" }
          : c
      ),
    };
    const recoveredByGuest = executeEffect({
      chainId: "test:bsth07-cards:711",
      state: exhaustedAgain,
      effect: guestConditionEffect,
      sourceInstanceId: "ichirin-bsth07-r01",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      recoveredByGuest.cardInstances.find(
        (c) => c.instanceId === "ichirin-bsth07-r01"
      )?.exhaustState
    ).toBe("recovered");
  });

  // engine-virtual-brave-combine-bsth07-r01: 引用符内の【合体中】能力(effects[2] 回復)は
  // 仮想ブレイヴ「雲山」自身の印字テキストだが、本体(雲居一輪)の effect として登録されている。
  // sourceDefinitionId/sourceInstanceId の境界が本体のままであることを固定し、
  // 「系統：入道」を発生源スコープにした negate/suppress/trigger が(現行カードプールに
  // 該当カードが無いため)現状は影響しないことを回帰テストで裏付ける。
  it("BSTH07-R01 仮想ブレイヴ由来能力の source 境界: getEffectiveTribes は系統「入道」を含まない(本体のまま)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      cardInstances: [self],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const selfAfterCe = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01-source"
    )!;
    expect(
      matchesCardFilter(
        selfAfterCe,
        card,
        { combined: true },
        { state: rebuilt }
      )
    ).toBe(true);

    const effectiveTribes = getEffectiveTribes(
      rebuilt,
      selfAfterCe,
      card,
      getCardDefinitionById
    );
    expect(effectiveTribes).not.toContain("入道");
    expect(effectiveTribes).toEqual(["起幻", "幻想", "星蓮"]);
  });

  it("BSTH07-R01 仮想ブレイヴ由来能力の source 境界: 系統「入道」スコープの grant_effect_source_prevention_immunity は本体を発生源とする効果に適用されない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-prevention",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...base,
      cardInstances: [self],
    };
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);

    const grantTribeImmunityToNyudo = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "grant_effect_source_prevention_immunity",
            player: "self",
            sourceScope: { tribes: ["入道"] },
            duration: { scope: "battle" },
          },
        },
      ],
    } as unknown as Effect;
    state = executeEffect({
      chainId: "test:bsth07-cards:797",
      state,
      effect: grantTribeImmunityToNyudo,
      sourceInstanceId: "ichirin-bsth07-r01-prevention",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_source_prevention_immunity"
      )
    ).toBe(true);
    expect(
      getEffectSourceTribePreventionBypass(
        state,
        "ichirin-bsth07-r01-prevention",
        "alice",
        getCardDefinitionById
      )
    ).toBeUndefined();
  });

  it("BSTH07-R01 仮想ブレイヴ由来能力の source 境界: trigger_tribes「入道」は本体由来の TriggerContext.sourceTribes に一致しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-trigger",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      cardInstances: [self],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const selfAfterCe = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01-trigger"
    )!;
    // trigger-system.ts が実際に組み立てる TriggerContext.sourceTribes と同一の導出
    // (getEffectiveTribes ∪ getEffectTribeGrants、BSTH07-R01 は effectTribes 未設定)。
    const triggerContext = {
      sourceTribes: getEffectiveTribes(
        rebuilt,
        selfAfterCe,
        card,
        getCardDefinitionById
      ),
      sourceInstanceId: selfAfterCe.instanceId,
    };
    expect(
      evaluateCondition(
        rebuilt,
        [{ kind: "trigger_tribes", tribes: ["入道"] }],
        "third-party-observer",
        "bob",
        getCardDefinitionById,
        triggerContext
      )
    ).toBe(false);
  });

  it("BSTH07-R01 雲山合体扱い: triggerFilter minBp は仮想ブレイヴBP+2000込みの合体BPを見る", () => {
    function choicesForMinBp(minBp: number) {
      const filteredDef: CardDefinition = {
        ...card,
        cardNo: `TEST-BSTH07-R01-TRIGGER-BP-${minBp}`,
        effects: [
          card.effects![1]!,
          {
            timing: {
              kind: "game_event",
              event: "attack",
              triggerFilter: { category: ["spirit"], minBp },
            },
            steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          },
        ],
      };
      const lookup = (id: string) =>
        id === filteredDef.cardNo ? filteredDef : cardNoMap.get(id);
      const self = createCardInstance(filteredDef, {
        instanceId: "ichirin-bsth07-r01-trigger-bp",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const rebuilt = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activePlayerId: "alice",
          step: "attack",
          cardInstances: [self],
        },
        lookup
      );

      const pendingEffect: PendingTriggeredEffect = {
        pendingId: `pending-bsth07-r01-trigger-bp-${minBp}`,
        actingPlayerId: "alice",
        eventKind: "attack",
        source: "action_resolution",
        chainId: "chain-bsth07-r01-trigger-bp",
        attackId: "attack-bsth07-r01-trigger-bp",
        relatedPlayerId: "alice",
        relatedInstanceId: "ichirin-bsth07-r01-trigger-bp",
        amount: 0,
        step: "attack",
        window: "flash_before_block",
        resolvedSourceInstanceIds: [],
      };

      return getAvailableTriggeredEffectSourceChoices({
        state: rebuilt,
        pendingEffect,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          filteredDef,
        ]),
      }).filter(
        (choice) =>
          choice.sourceCard.instanceId === "ichirin-bsth07-r01-trigger-bp"
      );
    }

    expect(choicesForMinBp(5000)).toHaveLength(1);
    expect(choicesForMinBp(5001)).toHaveLength(0);
  });

  it("BSTH07-R01 雲山合体扱い: EffectTarget maxBp は仮想ブレイヴBP+2000込みの合体BPを見る", () => {
    const sourceDef = cardNoMap.get("BSTH07-C01")!;
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-target-bp",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(sourceDef, {
      instanceId: "nazrin-bsth07-r01-target-bp",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "bob",
        step: "attack",
        cardInstances: [self, source],
      },
      getCardDefinitionById
    );
    const selfBefore = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01-target-bp"
    )!;
    expect(
      getCombinedUnitBp(rebuilt, selfBefore, card, getCardDefinitionById)
    ).toBe(5000);

    const targets = resolveTargetCards(
      rebuilt,
      "alice",
      {
        player: "opponent",
        category: ["spirit"],
        maxBp: 4000,
        count: -1,
      },
      getCardDefinitionById,
      "nazrin-bsth07-r01-target-bp",
      undefined,
      "bob",
      "none",
      undefined,
      true
    );

    expect(targets.map((c) => c.instanceId)).not.toContain(
      "ichirin-bsth07-r01-target-bp"
    );
    const inclusiveTargets = resolveTargetCards(
      rebuilt,
      "alice",
      {
        player: "opponent",
        category: ["spirit"],
        maxBp: 5000,
        count: -1,
      },
      getCardDefinitionById,
      "nazrin-bsth07-r01-target-bp",
      undefined,
      "bob",
      "none",
      undefined,
      true
    );
    expect(inclusiveTargets.map((c) => c.instanceId)).toContain(
      "ichirin-bsth07-r01-target-bp"
    );
  });

  it("BSTH07-R01 雲山合体扱い: core_move field filter maxBp は仮想ブレイヴBP+2000込みの合体BPを見る", () => {
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-core-shoot-bp",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [self],
      },
      getCardDefinitionById
    );
    const selfBefore = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01-core-shoot-bp"
    )!;
    expect(
      getCombinedUnitBp(rebuilt, selfBefore, card, getCardDefinitionById)
    ).toBe(5000);

    expect(
      coreShootCardMatchesFilter(
        rebuilt,
        selfBefore,
        { category: ["spirit"], maxBp: 4000 },
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      coreShootCardMatchesFilter(
        rebuilt,
        selfBefore,
        { category: ["spirit"], maxBp: 5000 },
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("BSTH07-R01 雲山合体扱い: Condition/DynamicCount の CardFilter BP は仮想ブレイヴBP+2000込みの合体BPを見る", () => {
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-condition-bp",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        turnNumber: 3,
        step: "attack",
        cardInstances: [self],
      },
      getCardDefinitionById
    );
    const selfBefore = rebuilt.cardInstances.find(
      (c) => c.instanceId === "ichirin-bsth07-r01-condition-bp"
    )!;
    expect(
      getCombinedUnitBp(rebuilt, selfBefore, card, getCardDefinitionById)
    ).toBe(5000);

    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: { category: ["spirit"], maxBp: 4000 },
            min: 1,
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: { category: ["spirit"], maxBp: 5000 },
            min: 1,
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);

    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "field_all_match",
            player: "self",
            filter: { category: ["spirit"], minBp: 5000 },
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "field_all_match",
            player: "self",
            filter: { category: ["spirit"], maxBp: 4000 },
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);

    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: { category: ["spirit"], maxBp: 4000 },
          },
        },
        getCardDefinitionById
      )
    ).toBe(0);
    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: { category: ["spirit"], maxBp: 5000 },
          },
        },
        getCardDefinitionById
      )
    ).toBe(1);
    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: {
              filterOr: [
                { category: ["spirit"], maxBp: 4000 },
                { category: ["nexus"] },
              ],
            },
          },
        },
        getCardDefinitionById
      )
    ).toBe(0);
    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: {
              filterOr: [
                { category: ["spirit"], maxBp: 5000 },
                { category: ["nexus"] },
              ],
            },
          },
        },
        getCardDefinitionById
      )
    ).toBe(1);
    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: {
              category: ["spirit"],
              exclude: { maxBp: 4000 },
            },
          },
        },
        getCardDefinitionById
      )
    ).toBe(1);
    expect(
      evaluateContinuousDynamicAmount(
        rebuilt,
        "alice",
        {
          source: {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: {
              category: ["spirit"],
              exclude: { maxBp: 5000 },
            },
          },
        },
        getCardDefinitionById
      )
    ).toBe(0);

    const withAttackLog = {
      ...rebuilt,
      attackDeclarationLog: [
        {
          playerId: "bob",
          cardInstanceId: "attacker-bsth07-r01-condition-bp",
          cardDefinitionId: "BSTH07-C01",
          turnNumber: 3,
          step: "attack" as const,
          attackId: null,
          designatedTargetInstanceId: selfBefore.instanceId,
          designatedTargetDefinitionId: card.cardNo,
          designatedTargetControllerLifeAtDeclaration: 5,
        },
      ],
    };
    expect(
      evaluateCondition(
        withAttackLog,
        [
          {
            kind: "attack_occurred",
            scope: "turn",
            player: "opponent",
            targetFilter: { category: ["spirit"], maxBp: 4000 },
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        withAttackLog,
        [
          {
            kind: "attack_occurred",
            scope: "turn",
            player: "opponent",
            targetFilter: { category: ["spirit"], maxBp: 5000 },
          },
        ],
        selfBefore.instanceId,
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("BSTH07-R01 雲山合体扱い: braves_on_source は仮想ブレイヴ1体を追加回数に数える", () => {
    const enemyDef = cardNoMap.get("BSTH07-C01")!;
    const self = createCardInstance(card, {
      instanceId: "ichirin-bsth07-r01-repeat",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-bsth07-r01-repeat",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [self, enemy],
      },
      getCardDefinitionById
    );

    const repeatByBravesEffect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            amount: -1000,
            duration: { scope: "turn" },
          },
          repeat: { additional: { source: { kind: "braves_on_source" } } },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:bsth07-cards:1342",
      state: rebuilt,
      effect: repeatByBravesEffect,
      sourceInstanceId: "ichirin-bsth07-r01-repeat",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-bsth07-r01-repeat"
    )!;
    // Lv1 BP2000 に基本1回 + 仮想ブレイヴ1体ぶんの追加1回で -2000。
    // 旧実装は物理 attached だけを数えて追加0回となり BP1000 が残る。
    expect(
      getEffectiveBp(result, enemyAfter, enemyDef, getCardDefinitionById)
    ).toBe(0);
  });
});

// ============================================================
// BSTH07-R02 村紗 水蜜
// ============================================================
describe("BSTH07-R02 村紗 水蜜", () => {
  const card = cardNoMap.get("BSTH07-R02")!;

  it("召喚時 3ドロー / Lv2スタック 疲労コスト→アタック不可", () => {
    const stack = card.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(stack.steps[0]!.action.kind).toBe("exhaust");
    expect(stack.steps[1]!.connector).toBe("conditional_cost");
    expect(stack.steps[1]!.action.kind).toBe("prevent_battle");
  });

  it("召喚時効果実行: 3ドローで手札+3", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "minamitsu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...buildDeck(card, "alice", 5)],
    };
    const result = runEffect(state, card.effects![0]!, "minamitsu-1", "alice");
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand.length).toBe(3);
  });
});

// ============================================================
// BSTH07-R10 / R11 マジック
// ============================================================
describe("BSTH07-R10 習合「垂迹大日如来」", () => {
  const card = cardNoMap.get("BSTH07-R10")!;
  it("系統付与 / フラッシュ(cap:1 ライフ下限保護) / スタック 相手効果ライフ減少防止", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想", "起幻"]);
    }
    // [1] フラッシュ「効果記述を持つ相手のアタックではライフは1しか減らない」=
    // life_damage_interception(replace, cap:1)+attackerFilter を実装。
    expect(card.effects![1]!.stub).toBeUndefined();
    const flashAction = card.effects![1]!.steps[0]!.action;
    expect(flashAction.kind).toBe("life_damage_interception");
    if (flashAction.kind === "life_damage_interception") {
      expect(flashAction.mode).toBe("replace");
      expect(flashAction.cap).toBe(1);
      expect(flashAction.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        hasEffectText: true,
      });
    }
    // [2] スタック「相手の効果で自分のライフは減らない」=
    // life_damage_interception(cause:"opponent_effect", mode:"replace", duration:battle)。
    expect(card.effects![2]!.stub).toBeUndefined();
    const stackAction = card.effects![2]!.steps[0]!.action;
    expect(stackAction.kind).toBe("life_damage_interception");
    if (stackAction.kind === "life_damage_interception") {
      expect(stackAction.cause).toBe("opponent_effect");
      expect(stackAction.mode).toBe("replace");
      expect(stackAction.duration).toEqual({ scope: "battle" });
    }
  });

  it("[board] BSTH07-R10 スタック: 相手効果ライフ減少のみ replace、バトル damage は通過", async () => {
    const { resolveLifeDamage, getPlayerLifeCoreCount } =
      await import("../src/core/core-system");
    const src = createCardInstance(card, {
      instanceId: "th07-r10-src",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, card.effects![2]!, "th07-r10-src", "player-1");
    // 相手の効果による 1 ダメージ → replace で 0 へ。
    const afterOpp = resolveLifeDamage(state, "player-1", 1, [], {
      cause: "opponent_effect",
      actingPlayerId: "player-2",
    });
    expect(getPlayerLifeCoreCount(afterOpp.players[0]!)).toBe(3);
    // バトル damage は通常解決される (cause:"opponent_effect" ゲートに引っ掛かる)。
    const afterBattle = resolveLifeDamage(state, "player-1", 1, [], {
      cause: "battle",
      actingPlayerId: "player-2",
    });
    expect(getPlayerLifeCoreCount(afterBattle.players[0]!)).toBe(2);
  });
});

describe("BSTH07-R11 鵺符「アンディファインドダークネス」", () => {
  const card = cardNoMap.get("BSTH07-R11")!;
  it("系統付与 / メイン外部転醒(rebirth.target, hasMechanic:rebirth filter) / フラッシュ 2ドロー+破棄choice", () => {
    const main = card.effects![1]!;
    expect(main.stub).toBeUndefined();
    const action = main.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") {
      // 原文に「転醒条件を満たしたものとして」等の明示句が無い（BSSA01-XX01 神技4 と異なる）
      // ため forceTriggerCondition は付与しない。
      expect(action.forceTriggerCondition).toBeUndefined();
      expect(action.target).toBeDefined();
      if (action.target?.kind === "filter") {
        expect(action.target.filter.category).toEqual(["spirit"]);
        expect(action.target.filter.tribes).toEqual(["星蓮"]);
        expect(action.target.filter.hasMechanic).toEqual(["rebirth"]);
      }
    }
    const flash = card.effects![2]!;
    expect(flash.steps[0]!.action.kind).toBe("draw");
    expect(flash.steps[1]!.action.kind).toBe("discard"); // choiceIndex 0 (2枚)
    expect(flash.steps[1]!.choice?.[0]?.action.kind).toBe("discard"); // 1枚(起幻青)
  });

  it("メイン発揮(カウント3以下): 対象がアタックしていなくても外部強制でflipする（盤面変化）", () => {
    // BSTH07-転醒X01(A) 自身の転醒トリガーは『このスピリットがアタックしたとき』
    // (card_event:"attack", maxCount:5)。本テストは card_event:"attack" を一切発火させず
    // R11 の main 効果 (activated) を直接実行しても flip が成立することを示す＝
    // 「対象指定の転醒強制」＝target の自トリガー(attack event)を経由しない外部転醒primitiveの
    // 意味を検証する（rebirth.target は executeRebirth を対象 instance へ直接呼ぶため、対象
    // 自身の card_event:"attack" 効果の発火有無に依存しない構造上の性質。forceTriggerCondition
    // は付与していないため、対象自身の maxCount:5 とは無関係にこの構造だけで flip する）。
    const target = createCardInstance(cardNoMap.get("BSTH07-転醒X01(A)")!, {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(card, {
      instanceId: "r11-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, target],
      players: [{ ...base.players[0]!, countValue: 3 }, base.players[1]!],
    };
    const main = card.effects![1]!;
    const flippedState = executeEffect({
      chainId: "test:bsth07-cards:1517",
      state,
      effect: main,
      sourceInstanceId: "r11-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    const flipped = flippedState.cardInstances.find(
      (x) => x.instanceId === "yoru-1"
    )!;
    expect(flipped.definitionId).toBe("BSTH07-転醒X01(B)");
  });

  it("メイン発揮(negative): 自分のカウント4(>3)では発揮条件を満たさずflipしない", () => {
    // R11 自身の main 効果は condition:[{kind:"count_value", player:"self", max:3}] で
    // ゲートされている。countValue:4 なら executeEffect の condition 評価で steps が
    // 実行されず、対象は flip されない（この gate が実際に効いていることの盤面確認）。
    const target = createCardInstance(cardNoMap.get("BSTH07-転醒X01(A)")!, {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(card, {
      instanceId: "r11-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, target],
      players: [{ ...base.players[0]!, countValue: 4 }, base.players[1]!],
    };
    const main = card.effects![1]!;
    const result = executeEffect({
      chainId: "test:bsth07-cards:1559",
      state,
      effect: main,
      sourceInstanceId: "r11-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    const notFlipped = result.cardInstances.find(
      (x) => x.instanceId === "yoru-1"
    )!;
    expect(notFlipped.definitionId).toBe("BSTH07-転醒X01(A)");
  });
});

// ============================================================
// BSTH07-X01 [導界者]聖 白蓮 (ネクサス)
// ============================================================
describe("BSTH07-X01 [導界者]聖 白蓮", () => {
  const card = cardNoMap.get("BSTH07-X01")!;

  it("treat_as 青 / Lv2 symbol_add(青) filterOr + 重複不可(no_duplicate) / stub なし", () => {
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe("blue");
    const symbolAdd = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "symbol_add"
    )!;
    const sa = symbolAdd.steps[0]!.action;
    expect(sa.kind).toBe("symbol_add");
    if (sa.kind === "symbol_add") {
      expect(sa.symbol).toBe("blue");
      if (typeof sa.target === "object" && "filter" in sa.target) {
        expect(sa.target.filter.filterOr?.length).toBe(2);
      }
    }
    // 「この効果は重複しない」= 〔重複不可〕→ usageLimit: no_duplicate。
    expect(symbolAdd.usageLimit).toEqual({ kind: "no_duplicate" });
    // 本体ルール+導託は grandwalkerData へ移行、転者は divine_transform DSL 化、
    // symbol_add は no_duplicate 化 → 残 stub なし。
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("重複不可: 同名の白蓮が2体いてもシンボル付与の継続効果は1体ぶんしか活きない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // 付与対象: コスト5以上の星蓮スピリット 1 体。
    const targetDef = cardNoMap.get("BSTH07-M01")!; // [星蓮船]東風谷 早苗（コスト適合の実在カードを流用）
    const target = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 同名の [導界者]聖 白蓮 を 2 体（ともに Lv2 = コア4）。
    const byakuren1 = createCardInstance(card, {
      instanceId: "byakuren-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const byakuren2 = createCardInstance(card, {
      instanceId: "byakuren-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [target, byakuren1, byakuren2],
    };
    const symbolAdd = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "symbol_add"
    )!;
    // 1 体目の継続効果を登録。
    const afterFirst = runEffect(state, symbolAdd, "byakuren-1", "alice");
    // 2 体目（同名・同コントローラー・同 effectIndex）→ no_duplicate でスキップ。
    const afterSecond = runEffect(afterFirst, symbolAdd, "byakuren-2", "alice");
    const ces = afterSecond.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "symbol_addition"
    );
    // 継続効果は動的に対象を判定し、対象に加わる青シンボルも1つだけ。
    expect(ces.length).toBe(1);
    expect(
      getSymbolAdditions(afterSecond, "target-1", getCardDefinitionById)
    ).toEqual([["blue"]]);
    expect(
      afterSecond.log.some((l) => l.includes("no-duplicate-skipped"))
    ).toBe(true);
  });

  it("Lv2 symbol_add: 共有系統の導界者ネクサスはコストを問わず、スピリットだけコスト5以上", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const highCostSpiritDef = cardNoMap.get("BSTH07-M01")!;
    const byakuren = createCardInstance(card, {
      instanceId: "byakuren-cost-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const highCostSpirit = createCardInstance(highCostSpiritDef, {
      instanceId: "star-lotus-cost-6",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const symbolAdd = card.effects!.find(
      (effect) => effect.steps[0]?.action.kind === "symbol_add"
    )!;
    const initial: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [byakuren, highCostSpirit],
    };

    const result = runEffect(initial, symbolAdd, "byakuren-cost-2", "alice");

    // [導界者]聖 白蓮自身は導界者ネクサスで、印字コスト2でも左のOR枝で対象となる。
    expect(
      getSymbolAdditions(result, "byakuren-cost-2", getCardDefinitionById)
    ).toEqual([["blue"]]);
    // 右のOR枝はスピリットだけにコスト5以上を要求し、コスト6の星蓮スピリットを対象にする。
    expect(
      getSymbolAdditions(result, "star-lotus-cost-6", getCardDefinitionById)
    ).toEqual([["blue"]]);
  });

  it("grandwalkerData: guided + 導託〔星蓮/闘神＆コスト3以上〕〔転醒ネクサス〕+ コア配置禁止タグ", () => {
    const gw = card.grandwalkerData!;
    expect(gw.kind).toBe("guided");
    expect(gw.oracleConditions).toEqual([
      {
        tribes: ["星蓮", "闘神"],
        minCost: 3,
        categories: ["spirit", "nexus"],
      },
      { hasMechanic: ["rebirth"], categories: ["nexus"] },
    ]);
    expect(gw.placementOracle).toBeUndefined();
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("【転者：2】は divineSkills(coreCost:2, attack/own) + divine_transform(self, Lv1/Lv2 BP4000, 非創界神破壊耐性)", () => {
    // 転者=転神扱い → grandwalkerData.divineSkills へ移管。コア2個コストはエンジン側。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(2);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "own",
      mode: "flash",
    });
    expect(skill.minLevel).toBe(1);
    expect(skill.maxLevel).toBe(2);
    const transform = skill.effects![0]!.steps[0]!.action;
    expect(transform.kind).toBe("divine_transform");
    if (transform.kind === "divine_transform") {
      expect(transform.target).toEqual({ kind: "self" });
      expect(transform.bpByLevel).toEqual([
        { level: 1, bp: 4000 },
        { level: 2, bp: 4000 },
      ]);
      expect(transform.protectedFromNonGrandwalker).toBe(true);
    }
    // effects[] 側に activated の転者は残っていない。
    expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(
      false
    );
  });

  it("転者本体実行: divineTransformState が付与される（コア消費はエンジン側）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const byakuren = createCardInstance(card, {
      instanceId: "byakuren-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const skill = card.grandwalkerData!.divineSkills![0]!;
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [byakuren],
    };
    const result = runEffect(state, skill.effects![0]!, "byakuren-1", "alice");
    const after = result.cardInstances.find(
      (c) => c.instanceId === "byakuren-1"
    )!;
    expect(after.divineTransformState).toEqual({
      bpByLevel: [
        { level: 1, bp: 4000 },
        { level: 2, bp: 4000 },
      ],
      protectedFromNonGrandwalker: true,
    });
  });
});

// ============================================================
// BSTH07-転醒R01(A) 聖蓮船
// ============================================================
describe("BSTH07-転醒R01(A) 聖蓮船", () => {
  const card = cardNoMap.get("BSTH07-転醒R01(A)")!;

  it("rebirth(maxCount3, ライフ減少/起幻ドロートリガー) / 配置時 2ドロー+1破棄 / Lv2軽減制限", () => {
    expect(card.isDoubleSided).toBe(true);
    const lifeTrigger = card.effects![0]!;
    expect(lifeTrigger.stub).toBeUndefined();
    expect(lifeTrigger.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "reduce_life",
    });
    const rebirthFromLife = lifeTrigger.steps[0]!.action;
    if (rebirthFromLife.kind === "rebirth")
      expect(rebirthFromLife.maxCount).toBe(3);

    const drawTrigger = card.effects![1]!;
    expect(drawTrigger.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "after_draw",
    });
    expect(drawTrigger.condition).toEqual([
      { kind: "trigger_tribes", tribes: ["起幻"], excludeSelfSource: true },
      { kind: "trigger_source_player", player: "self" },
      { kind: "count_value", player: "self", max: 3 },
    ]);
    const rebirthFromDraw = drawTrigger.steps[0]!.action;
    if (rebirthFromDraw.kind === "rebirth")
      expect(rebirthFromDraw.maxCount).toBe(3);

    const place = card.effects![2]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    expect(place.steps[0]!.action.kind).toBe("draw");
    const reductionLimit = card.effects![3]!;
    expect(reductionLimit.stub).toBeUndefined();
    expect(reductionLimit.steps).toMatchObject([
      {
        action: {
          kind: "limit_cost_reduction",
          player: "self",
          sourceFilter: { targetsGrandwalker: "only" },
          maxSymbols: 1,
          duration: { scope: "while_on_field" },
        },
      },
      {
        action: {
          kind: "limit_cost_reduction",
          player: "opponent",
          sourceFilter: { targetsGrandwalker: "only" },
          maxSymbols: 1,
          duration: { scope: "while_on_field" },
        },
        connector: "simultaneous",
      },
    ]);
  });

  it("Lv2 軽減制限は導界者/創界神ネクサス由来の軽減だけを合計1つに cap する", () => {
    const guideNexus: CardDefinition = {
      cardNo: "TEST-GUIDE-NEXUS-BSTH07R01",
      name: "test guided nexus",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["guide", "guide"],
      tribe: "導界者",
      grandwalkerData: { kind: "guided" },
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const blueSpirit: CardDefinition = {
      cardNo: "TEST-BLUE-SPIRIT-BSTH07R01",
      name: "test blue spirit",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["blue"],
      tribe: "起幻",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const targetCard: CardDefinition = {
      cardNo: "TEST-PAYING-FOR-BSTH07R01",
      name: "test paying target",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 6,
      reductionSymbols: ["guide", "guide", "blue", "blue"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["blue"],
      tribe: "起幻",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = new Map(cardNoMap);
    for (const def of [guideNexus, blueSpirit, targetCard]) {
      defs.set(def.cardNo, def);
    }
    const getDef = (id: string) => defs.get(id);
    const buildState = (normalCoreCount: number) =>
      rebuildContinuousEffectsFromField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(card, {
              instanceId: "seirensen",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              normalCoreCount,
            }),
            createCardInstance(guideNexus, {
              instanceId: "bob-guide-1",
              ownerPlayerId: "bob",
              controllerPlayerId: "bob",
              zone: "field",
            }),
            createCardInstance(blueSpirit, {
              instanceId: "bob-blue-spirit",
              ownerPlayerId: "bob",
              controllerPlayerId: "bob",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        }),
        getDef
      );

    expect(
      calculateReduction({
        state: buildState(0),
        actingPlayerId: "bob",
        card: targetCard,
        getCardDefinitionById: getDef,
        useKind: "summon",
      }).totalReduction
    ).toBe(3);
    expect(
      calculateReduction({
        state: buildState(1),
        actingPlayerId: "bob",
        card: targetCard,
        getCardDefinitionById: getDef,
        useKind: "summon",
      }).totalReduction
    ).toBe(2);
  });

  it("B面 命蓮寺 は転醒時destroy効果を持つ (既存)", () => {
    const b = card.backFace;
    expect(b?.effects?.[0]?.steps[0]?.action.kind).toBe("destroy");
  });

  it("[board] B面 命蓮寺の本来コスト6以下破壊は、他の青シンボルでだけ上限8へ拡張する", () => {
    const back = card.backFace!;
    const costTarget = (cardNo: string, cost: number): CardDefinition => ({
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["white"],
      cost,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["white"],
      tribe: "テスト",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    });
    const blueSymbol: CardDefinition = {
      cardNo: "TEST-BLUE-SYMBOL-BSTH07R01B",
      name: "青シンボル",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["blue"],
      tribe: "テスト",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const costSix = costTarget("TEST-COST-6-BSTH07R01B", 6);
    const costSeven = costTarget("TEST-COST-7-BSTH07R01B", 7);
    const definitions = new Map(cardNoMap);
    for (const definition of [back, blueSymbol, costSix, costSeven])
      definitions.set(definition.cardNo, definition);
    const getDef = (id: string) => definitions.get(id);
    const destroy = back.effects![0]!;
    const buildState = (target: CardDefinition, withOtherBlueSymbol: boolean) =>
      rebuildContinuousEffectsFromField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(back, {
              instanceId: "myourenji",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              zoneRoleName: "nexus",
            }),
            createCardInstance(target, {
              instanceId: "target",
              ownerPlayerId: "bob",
              controllerPlayerId: "bob",
              zone: "field",
            }),
            ...(withOtherBlueSymbol
              ? [
                  createCardInstance(blueSymbol, {
                    instanceId: "other-blue-symbol",
                    ownerPlayerId: "alice",
                    controllerPlayerId: "alice",
                    zone: "field",
                    zoneRoleName: "nexus",
                  }),
                ]
              : []),
          ],
        }),
        getDef
      );
    const resolveDestroy = (state: GameState) => {
      const pending = executeEffect({
        chainId: "test:bsth07-cards:1976",
        state,
        effect: destroy,
        sourceInstanceId: "myourenji",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      return flushPendingLeaves(pending, getDef);
    };

    expect(
      resolveDestroy(buildState(costSix, false)).cardInstances.find(
        (instance) => instance.instanceId === "target"
      )!.zone
    ).toBe("trash");
    expect(
      resolveDestroy(buildState(costSeven, false)).cardInstances.find(
        (instance) => instance.instanceId === "target"
      )!.zone
    ).toBe("field");
    expect(
      resolveDestroy(buildState(costSeven, true)).cardInstances.find(
        (instance) => instance.instanceId === "target"
      )!.zone
    ).toBe("trash");
  });

  it("[board] 起幻ドロートリガー: 他カード発生源+起幻+自分なら転醒成立、このネクサス自身が発生源なら excludeSelfSource で不成立", () => {
    const drawTrigger = card.effects![1]!;
    const buildState = () =>
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "seirensen-trigger",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 0,
          }),
        ],
      });

    const metByOtherSource = executeEffect({
      chainId: "test:bsth07-cards:2019",
      state: buildState(),
      effect: drawTrigger,
      sourceInstanceId: "seirensen-trigger",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => undefined,
      triggerSourceTribes: ["起幻"],
      triggerSourcePlayerId: "alice",
      triggerSourceInstanceId: "other-tribe-card",
    });
    expect(
      metByOtherSource.cardInstances.find(
        (c) => c.instanceId === "seirensen-trigger"
      )!.definitionId
    ).toBe("BSTH07-転醒R01(B)");

    const unmetBySelfSource = executeEffect({
      chainId: "test:bsth07-cards:2036",
      state: buildState(),
      effect: drawTrigger,
      sourceInstanceId: "seirensen-trigger",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => undefined,
      triggerSourceTribes: ["起幻"],
      triggerSourcePlayerId: "alice",
      triggerSourceInstanceId: "seirensen-trigger",
    });
    expect(
      unmetBySelfSource.cardInstances.find(
        (c) => c.instanceId === "seirensen-trigger"
      )!.definitionId
    ).toBe("BSTH07-転醒R01(A)");

    const unmetByOpponentSource = executeEffect({
      chainId: "test:bsth07-cards:2053",
      state: buildState(),
      effect: drawTrigger,
      sourceInstanceId: "seirensen-trigger",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => undefined,
      triggerSourceTribes: ["起幻"],
      triggerSourcePlayerId: "bob",
      triggerSourceInstanceId: "other-tribe-card",
    });
    expect(
      unmetByOpponentSource.cardInstances.find(
        (c) => c.instanceId === "seirensen-trigger"
      )!.definitionId
    ).toBe("BSTH07-転醒R01(A)");
  });

  // ENGINE-rebirth-event-trigger-condition 統合テスト: legal-actions が実際に使う
  // listing gate (getAvailableTriggeredEffectSourceChoices) を production lookup
  // (buildTriggeredEffectLookup(ALL_CARDS)) 経由で通し、trigger_tribes.excludeSelfSource
  // が「発生源=このネクサス自身」を実際に除外することを検証する
  // (adversarial verifier round1 指摘: executeEffect 直呼びのテストだけでは
  // effect-resolution.ts / trigger-system.ts の配線漏れを検出できない)。
  it("[board] 起幻ドロートリガー (legal-actions listing gate 経由): このネクサス自身が発生源なら候補0件、他カード発生源なら候補1件", () => {
    const kitsuneDef: CardDefinition = {
      cardNo: "TEST-BSTH07R01-OTHER-KISHIN",
      name: "test other 起幻 card",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["blue"],
      tribe: "起幻",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const defs = [...ALL_CARDS, kitsuneDef];
    const lookupGetCardDefinitionById = (id: string) =>
      id === kitsuneDef.cardNo ? kitsuneDef : cardNoMap.get(id);
    const registeredTriggeredEffectActions = buildTriggeredEffectLookup(defs);

    function buildPendingEffect(
      effectSourceInstanceId: string
    ): PendingTriggeredEffect {
      return {
        pendingId: "pending-increase-hand-test",
        actingPlayerId: "alice",
        eventKind: "after_draw",
        source: "action_resolution",
        chainId: "test:bsth07-cards:2102",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        effectSourceInstanceId,
        amount: 1,
        step: "main",
        window: "main",
        resolvedSourceInstanceIds: [],
      };
    }

    function countChoices(otherSourceInstanceId: string) {
      const nexus = createCardInstance(card, {
        instanceId: "seirensen-listing",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const other = createCardInstance(kitsuneDef, {
        instanceId: "other-kitsune",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, other],
      });
      return getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: buildPendingEffect(otherSourceInstanceId),
        getCardDefinitionById: lookupGetCardDefinitionById,
        getRegisteredTriggeredEffectActions: registeredTriggeredEffectActions,
      }).filter((c) => c.sourceCard.instanceId === "seirensen-listing");
    }

    // 発生源=このネクサス自身 → excludeSelfSource で候補0件のはず。
    expect(countChoices("seirensen-listing")).toHaveLength(0);
    // 発生源=別の起幻カード → 候補1件 (このネクサスの増加ドロー転醒トリガー)。
    expect(countChoices("other-kitsune")).toHaveLength(1);
  });
});

// ============================================================
// BSTH07-転醒X01(A) / 転醒X02(A)
// ============================================================
describe("BSTH07-転醒X01(A)", () => {
  const card = cardNoMap.get("BSTH07-転醒X01(A)")!;
  it("召喚時 3ドロー+破棄+負バースト抑制(negate) / 転醒rebirth", () => {
    const summon = card.effects![0]!;
    expect(summon.steps[2]!.action.kind).toBe("negate");
    if (summon.steps[2]!.action.kind === "negate") {
      expect(summon.steps[2]!.action.negateTarget).toBe("opponent_burst");
    }
    const rebirth = card.effects![1]!.steps[0]!.action;
    if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(5);
  });
});

describe("BSTH07-転醒X02(B) 寅丸 星 — 効果記述を持つ相手を破壊", () => {
  const front = cardNoMap.get("BSTH07-転醒X02(A)")!;
  const back = front.backFace!;

  it("effects[0] 転醒/アタック時: hasEffectText + suppressDestroyedEffects + 系統 preventionRestriction", () => {
    const e = back.effects![0]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: ["rebirth", "attack"],
    });
    expect(e.preventionRestriction).toEqual({
      onlyPreventableByTribes: ["星蓮", "闘神"],
    });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind === "destroy") {
      expect(action.suppressDestroyedEffects).toBe("destroyed_only");
      expect(action.target.kind).toBe("filter");
      if (action.target.kind === "filter") {
        expect(action.target.filter.hasEffectText).toBe(true);
        expect(action.target.count).toBe(2);
      }
    }
    // stub が解消されていること（全 effect が stub なし）
    expect(back.effects!.every((eff) => eff.stub === undefined)).toBe(true);
  });

  it("効果記述を持つ相手のみ破壊し、バニラは場に残る", () => {
    // 印字テキストのある相手スピリット 2 体 + バニラ（textLines 空）1 体。
    // count=2 で候補がちょうど effect-bearing 2 体 → それらだけ破壊、バニラは残置。
    const vanillaDef: CardDefinition = {
      cardNo: "TEST-VANILLA-SPIRIT",
      name: "バニラスピリット",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      tribe: "無",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    // 効果記述を持つ相手スピリット（実在カードを流用）。
    const effDef = cardNoMap.get("BSTH07-C01")!;
    expect(effDef.textLines.some((l) => l.trim().length > 0)).toBe(true);

    const getDef = (id: string) =>
      id === vanillaDef.cardNo ? vanillaDef : getCardDefinitionById(id);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(back as CardDefinition, {
      instanceId: "torawa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const oppEff1 = createCardInstance(effDef, {
      instanceId: "opp-eff-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const oppEff2 = createCardInstance(effDef, {
      instanceId: "opp-eff-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const oppVanilla = createCardInstance(vanillaDef, {
      instanceId: "opp-vanilla",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, oppEff1, oppEff2, oppVanilla],
    };

    const result = executeEffect({
      chainId: "test:bsth07-cards:2257",
      state,
      effect: back.effects![0]!,
      sourceInstanceId: "torawa-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // 破壊は pendingLeaveEntities に enqueue される（実フラッシュは安定点）。
    const queued = new Set(
      result.pendingLeaveEntities.map((e) => e.instanceId)
    );
    // 効果記述持ち 2 体は破壊待機にキューされる。
    expect(queued.has("opp-eff-1")).toBe(true);
    expect(queued.has("opp-eff-2")).toBe(true);
    // バニラは効果記述を持たないため対象外 → 破壊されない。
    expect(queued.has("opp-vanilla")).toBe(false);
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-vanilla")?.zone
    ).toBe("field");
  });
});

// ============================================================
// BSTH07-転醒X01(B) 封獣 ぬえ (backFace 転醒時)
//   青1色ネクサス(field_has colorCount:mono) を発揮条件に、相手手札全破棄→
//   相手3ドロー→相手トラッシュ全カードをデッキ送り(search_zone player:opponent)。
// ============================================================
describe("BSTH07-転醒X01(B) 封獣 ぬえ [2,3]", () => {
  const card = cardNoMap.get("BSTH07-転醒X01(A)")!;
  const back = card.backFace!;
  const rebirthEffect = back.effects![0]!;
  const blueNexus = cardNoMap.get("BSTH07-転醒X02(A)")!; // colors: ["blue"] = 単色青

  it("DSL: 発揮条件 field_has colorCount:mono colors:[blue] + steps(discard/draw/search_zone deck)", () => {
    expect(rebirthEffect.timing).toEqual({
      kind: "card_event",
      event: "rebirth",
    });
    expect(rebirthEffect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        colors: ["blue"],
        colorCount: "mono",
      },
    ]);
    const kinds = rebirthEffect.steps.map((s) => s.action.kind);
    expect(kinds).toEqual(["discard", "draw", "search_zone"]);
    const drawAction = rebirthEffect.steps[1]!.action;
    expect(drawAction.kind === "draw" && drawAction.player).toBe("opponent");
    const sz = rebirthEffect.steps[2]!.action;
    expect(sz.kind === "search_zone" && sz.player).toBe("opponent");
    expect(sz.kind === "search_zone" && sz.destination).toBe("deck");
  });

  function buildBoard() {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // 源は 封獣 ぬえ (spirit) 相当: nexus でないため field_has category:[nexus] に
    // 自分自身は数えられない。別途 青1色ネクサスを場に置いて条件を満たす。
    const self = createCardInstance(cardNoMap.get("BSTH07-C01")!, {
      instanceId: "nue-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(blueNexus, {
      instanceId: "blue-nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobHand = [1, 2].map((i) =>
      createCardInstance(cardNoMap.get("BSTH07-C01")!, {
        instanceId: `bob-hand-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "hand",
      })
    );
    const bobTrash = [1, 2, 3].map((i) =>
      createCardInstance(cardNoMap.get("BSTH07-C01")!, {
        instanceId: `bob-trash-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      })
    );
    const bobDeck = buildDeck(cardNoMap.get("BSTH07-C01")!, "bob", 10);
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, nexus, ...bobHand, ...bobTrash, ...bobDeck],
      players: base.players.map((p) =>
        p.id === "bob"
          ? { ...p, handCount: 2, deckCount: 10 }
          : { ...p, handCount: 0, deckCount: 0 }
      ),
    };
    return state;
  }

  it("発揮: 相手手札全破棄→相手3ドロー→相手トラッシュ全カードがデッキへ", () => {
    const state = buildBoard();
    const result = runEffect(state, rebirthEffect, "nue-1", "alice");
    const bob = result.players.find((p) => p.id === "bob")!;
    // 手札2枚全破棄(→トラッシュ)→3ドロー = 手札3枚。
    expect(bob.handCount).toBe(3);
    // 効果解決順: 手札破棄(2枚→トラッシュ)→3ドロー→トラッシュ全カードをデッキへ。
    // トラッシュは破棄後 5枚(元3+破棄2)、それが全てデッキへ → トラッシュ0。
    const bobTrashAfter = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "trash"
    );
    expect(bobTrashAfter).toHaveLength(0);
    // 元デッキ10 - 3ドロー(手札へ) + トラッシュ5戻し = 12。
    expect(bob.deckCount).toBe(12);
    const bobDeckInstances = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "deck"
    );
    expect(bobDeckInstances.length).toBe(12);
  });

  it("発揮条件 gate: 青を含むが多色のネクサスは青1色に該当せず condition-unmet で盤面不変", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(cardNoMap.get("BSTH07-C01")!, {
      instanceId: "nue-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 赤青2色のネクサス → 青を含むが「青1色」ではない = colorCount:mono 不成立。
    const multiColorNexus = cardNoMap.get("BSDB01-C07")!; // nexus colors: ["red","blue"]
    const multi = createCardInstance(multiColorNexus, {
      instanceId: "multi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobHand = createCardInstance(cardNoMap.get("BSTH07-C01")!, {
      instanceId: "bob-hand-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, multi, bobHand],
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, handCount: 1 } : p
      ),
    };
    const result = runEffect(state, rebirthEffect, "nue-1", "alice");
    const bob = result.players.find((p) => p.id === "bob")!;
    // 条件不成立 → 手札破棄もドローも起きない。
    expect(bob.handCount).toBe(1);
    expect(result.log.some((l) => l.includes("condition-unmet"))).toBe(true);
  });
});

describe("BSTH07-転醒X02(A) 毘沙門天の宝塔", () => {
  const card = cardNoMap.get("BSTH07-転醒X02(A)")!;
  it("grandstoneData(解封: 起幻+青の手札増加, 転醒: コア4・カウント5・1個残しボイド・コア配置)", () => {
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const gs = card.grandstoneData!;
    expect(gs).toBeDefined();
    expect(gs.unsealConditions).toHaveLength(1);
    expect(gs.unsealConditions[0]!.events).toEqual(["hand_increase"]);
    expect(gs.unsealConditions[0]!.causeFilter?.tribes).toEqual(["起幻"]);
    expect(gs.unsealConditions[0]!.causeFilter?.colors).toEqual(["blue"]);
    expect(gs.rebirthCoreThreshold).toBe(4);
    expect(gs.rebirthMaxCount).toBe(5);
    expect(gs.rebirthRetainCores).toBe(1);
    expect(gs.postRebirth).toBe("charge_cores_from_field_reserve");
    // 【神秘】は ENGINE-triggered-hand-zone-immunity で解消済み (下記 describe)。
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("effects[0] (トリガー): game_event(increase_hand, self) + trigger_tribes(星蓮/闘神) + trigger_source_player(self) → correlate_pending_trigger", () => {
    const e = card.effects![0]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "increase_hand",
    });
    expect(e.condition).toEqual([
      { kind: "trigger_tribes", tribes: ["星蓮", "闘神"] },
      { kind: "trigger_source_player", player: "self" },
    ]);
    expect(e.steps[0]!.action).toEqual({
      kind: "correlate_pending_trigger",
      key: "mystery_hand_immunity",
    });
  });

  it("effects[1] (継続): correlated_pending_trigger_active ゲート + effect_immunity(target.zone:[hand], sourceScope.categories:[spirit,nexus])", () => {
    const e = card.effects![1]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.condition).toEqual([
      {
        kind: "correlated_pending_trigger_active",
        key: "mystery_hand_immunity",
      },
    ]);
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
      expect(action.sourceScope).toEqual({ categories: ["spirit", "nexus"] });
    }
  });
});

describe("BSTH07-転醒X02(A)【神秘】盤面変化 (P3-129 ENGINE-triggered-hand-zone-immunity-dynamic-scope)", () => {
  const card = cardNoMap.get("BSTH07-転醒X02(A)")!;
  const triggerEffect = card.effects![0]!;
  const continuousEffect = card.effects![1]!;

  function makePendingTriggeredEffect(
    pendingId: string,
    actingPlayerId: string
  ): PendingTriggeredEffect {
    return {
      pendingId,
      actingPlayerId,
      eventKind: "increase_hand",
      source: "action_resolution",
      chainId: "test:bsth07-cards:2495",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
  }

  function buildState(options: {
    correlatedPendingIds?: string[];
    livePendingTriggeredEffects?: PendingTriggeredEffect[];
  }): GameState {
    const nexus = createCardInstance(card, {
      instanceId: "x02-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      ...(options.correlatedPendingIds
        ? {
            pendingTriggerCorrelations: {
              mystery_hand_immunity: options.correlatedPendingIds,
            },
          }
        : {}),
    });
    const handCard = createCardInstance(card, {
      instanceId: "alice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [nexus, handCard],
      pendingTriggeredEffects: options.livePendingTriggeredEffects ?? [],
    };
  }

  it("自分が系統「星蓮」を持つ自分の効果で手札を増やしたとき: 解決中 pendingId が相関記録される", () => {
    const before = buildState({});
    const after = executeEffect({
      chainId: "test:bsth07-cards:2543",
      state: before,
      effect: triggerEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["星蓮"],
      triggerSourcePlayerId: "alice",
      pendingEffectPendingId: "pending-1",
    });
    const nexus = after.cardInstances.find((c) => c.instanceId === "x02-1")!;
    expect(nexus.pendingTriggerCorrelations).toEqual({
      mystery_hand_immunity: ["pending-1"],
    });
  });

  it("同一 event に他の登録 source が無い (pendingEffectPendingId 未指定): 相関は記録されない (no-op)", () => {
    // 同時誘発でない (相手側の反応が存在しない) ため相関すべき対象が無い。
    const before = buildState({});
    const after = executeEffect({
      chainId: "test:bsth07-cards:2563",
      state: before,
      effect: triggerEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["星蓮"],
      triggerSourcePlayerId: "alice",
    });
    const nexus = after.cardInstances.find((c) => c.instanceId === "x02-1")!;
    expect(nexus.pendingTriggerCorrelations).toBeUndefined();
  });

  it("原因効果が系統「星蓮」/「闘神」を持たない: 相関は記録されない (condition不成立で no-op)", () => {
    const before = buildState({});
    const after = executeEffect({
      chainId: "test:bsth07-cards:2579",
      state: before,
      effect: triggerEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["起幻"],
      triggerSourcePlayerId: "alice",
      pendingEffectPendingId: "pending-1",
    });
    const nexus = after.cardInstances.find((c) => c.instanceId === "x02-1")!;
    expect(nexus.pendingTriggerCorrelations).toBeUndefined();
  });

  it("原因効果が系統「星蓮」を持つが相手(opponent)コントロール: 「自分が」を満たさず相関は記録されない", () => {
    // adversarial verifier round1 指摘: 姉妹能力【解封】(grandstone-system.ts
    // checkAndQueueUnsealChoicesForHandIncrease) は原因カードのコントローラーが
    // 手札増加プレイヤーと一致することを要求する。神秘も同じ「自分が…効果で」の
    // 主体一致を trigger_source_player:self で明示する。
    const before = buildState({});
    const after = executeEffect({
      chainId: "test:bsth07-cards:2600",
      state: before,
      effect: triggerEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["星蓮"],
      triggerSourcePlayerId: "bob",
      pendingEffectPendingId: "pending-1",
    });
    const nexus = after.cardInstances.find((c) => c.instanceId === "x02-1")!;
    expect(nexus.pendingTriggerCorrelations).toBeUndefined();
  });

  it("相関 pendingId が state.pendingTriggeredEffects に現存 (相手側誘発が未解決): 継続効果が発揮され、自分の手札は相手のスピリット/ネクサスの効果を受けない", () => {
    const before = buildState({
      correlatedPendingIds: ["pending-1"],
      livePendingTriggeredEffects: [
        makePendingTriggeredEffect("pending-1", "alice"),
      ],
    });
    const after = executeEffect({
      chainId: "test:bsth07-cards:2622",
      state: before,
      effect: continuousEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const handCard = after.cardInstances.find(
      (c) => c.instanceId === "alice-hand-1"
    )!;
    // sourceScope.categories:[spirit,nexus] のため、effectSource に相手ネクサス (本カード
    // 自身、printedCategory:"nexus") を渡して照合する。
    const opponentNexusSource = createCardInstance(card, {
      instanceId: "bob-nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    expect(
      isCardImmuneToOpponentEffect(
        after,
        handCard,
        "bob",
        "none",
        { instance: opponentNexusSource, definition: card },
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("相関 pendingId が state.pendingTriggeredEffects に存在しない (相手側誘発は既に解決済み): 免疫は自動的に切れる", () => {
    const before = buildState({
      correlatedPendingIds: ["pending-1"],
      livePendingTriggeredEffects: [],
    });
    const after = executeEffect({
      chainId: "test:bsth07-cards:2657",
      state: before,
      effect: continuousEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const handCard = after.cardInstances.find(
      (c) => c.instanceId === "alice-hand-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        after,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("相関記録が全く無い: 継続効果の condition が不成立のため免疫は登録されない", () => {
    const before = buildState({});
    const after = executeEffect({
      chainId: "test:bsth07-cards:2681",
      state: before,
      effect: continuousEffect,
      sourceInstanceId: "x02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const handCard = after.cardInstances.find(
      (c) => c.instanceId === "alice-hand-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        after,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});
