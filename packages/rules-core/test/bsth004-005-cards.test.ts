/**
 * BSTH004 (東方幻想郷) / BSTH005 (東方怪綺談) カードの effects 検証テスト。
 * SP 弾の少数枚。転召/転醒/BP減少 中心。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  runStateBasedActions,
} from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-card-replacement";
import {
  queuePendingReactionsFromTriggerEvents,
  type CollectedTriggerEvent,
} from "../src/effect/trigger-system";
import { matchesCardFilter } from "../src/card/card-filter";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH004-X03 幻月 (転召)", () => {
  const card = cardNoMap.get("BSTH004-X03")!;
  it("転召(召喚手順内ステップ tenshoSummon,最低3コスト6) + 夢月条件 effect_immunity + アタック destroy(nexus)", () => {
    expect(card.tenshoSummon).toBeDefined();
    expect(card.tenshoSummon!.minCores).toBe(3);
    expect(card.tenshoSummon!.destination).toBe("void");
    expect(card.tenshoSummon!.targetFilter.tribesRequired).toEqual(["幻想"]);
    expect(card.tenshoSummon!.targetFilter.minCost).toBe(6);
    const immuneEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    expect(immuneEffect.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "夢月" }],
    });
    const destroyEffect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "destroy")
    )!;
    const d = destroyEffect.steps.find(
      (s) => s.action.kind === "destroy"
    )!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      // 対象 = 「転醒ネクサス」(hasMechanic:rebirth) OR 「創界神ネクサス」(targetsGrandwalker)。
      // matchesCardFilter の filterOr 分岐は各 sub を outer フィールドとマージせず単独評価する
      // (card-filter.ts:397-439) ため、category はこの filterOr の枝それぞれに複製する必要がある
      // (outer sibling に置くと無視され、ネクサス以外の二面カードも誤って対象化する)。
      expect(d.target.filter.filterOr).toEqual([
        { category: ["nexus"], hasMechanic: ["rebirth"] },
        { category: ["nexus"], targetsGrandwalker: "only" },
      ]);
      expect(d.target.filter.category).toBeUndefined();
      expect(d.suppressDestroyedEffects).toBeUndefined();
      expect(destroyEffect.steps[0]!.action).toMatchObject({
        kind: "restrict_manifest",
        effectFilter: { containsActionKinds: ["rebirth"] },
      });
    }
    expect(destroyEffect.stub).toBeUndefined();

    // 「さらに」の回復は同一効果内で、destroy とは独立条件。
    const recoverStep = destroyEffect.steps.find(
      (s) => s.action.kind === "recover"
    )!;
    expect(destroyEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(recoverStep.condition).toEqual([
      { kind: "count_value", player: "self", max: 0 },
    ]);
    expect(card.effects).toHaveLength(2);
  });

  it("[実挙動] 破壊対象filterはネクサス限定で、非ネクサスの二面/創界神カードを対象外にする", () => {
    const destroyEffect = card.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "destroy")
    )!;
    const d = destroyEffect.steps.find(
      (s) => s.action.kind === "destroy"
    )!.action;
    if (
      d.kind !== "destroy" ||
      typeof d.target !== "object" ||
      !("filter" in d.target)
    ) {
      throw new Error("destroy target が filter 形式ではない");
    }
    const filter = d.target.filter;

    const rebirthNexusDef: CardDefinition = {
      cardNo: "TEST-REBIRTH-NEXUS",
      name: "テスト転醒ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "テスト",
      sourceUrls: [],
      sourceConfidence: "C",
      isDoubleSided: true,
      backFace: {
        name: "テスト転醒後",
        printedCategory: "spirit",
        colors: ["red"],
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        tribe: "テスト",
        cardNo: "TEST-REBIRTH-NEXUS-B",
      },
    };
    const grandwalkerNexusDef: CardDefinition = {
      cardNo: "TEST-GRANDWALKER-NEXUS",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "テスト",
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    };
    const plainNexusDef: CardDefinition = {
      cardNo: "TEST-PLAIN-NEXUS",
      name: "テスト通常ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "テスト",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    // 転醒(二面)持ちだがネクサスではないスピリット。filterOr の category 複製が
    // 無いと hasMechanic:rebirth 単体で誤って対象化してしまう回帰ケース。
    const rebirthSpiritDef: CardDefinition = {
      cardNo: "TEST-REBIRTH-SPIRIT",
      name: "テスト転醒スピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "テスト",
      sourceUrls: [],
      sourceConfidence: "C",
      isDoubleSided: true,
      backFace: {
        name: "テスト転醒スピリット後",
        printedCategory: "spirit",
        colors: ["red"],
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
        symbolColors: [],
        textLines: [],
        keywordTags: [],
        tribe: "テスト",
        cardNo: "TEST-REBIRTH-SPIRIT-B",
      },
    };

    const makeInstance = (def: CardDefinition, instanceId: string) =>
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      });

    expect(
      matchesCardFilter(
        makeInstance(rebirthNexusDef, "rn-1"),
        rebirthNexusDef,
        filter
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        makeInstance(grandwalkerNexusDef, "gn-1"),
        grandwalkerNexusDef,
        filter
      )
    ).toBe(true);
    expect(
      matchesCardFilter(
        makeInstance(plainNexusDef, "pn-1"),
        plainNexusDef,
        filter
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        makeInstance(rebirthSpiritDef, "rs-1"),
        rebirthSpiritDef,
        filter
      )
    ).toBe(false);
  });

  it("[汎用抑止の対照] destroyed_only は対象の離脱時転醒も抑止する", () => {
    const rebirthNexusDef = cardNoMap.get("BSTH005-TX01(A)")!;
    const nexus = createCardInstance(rebirthNexusDef, {
      instanceId: "opp-rebirth-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const lookup = buildTriggeredEffectLookup([rebirthNexusDef]);
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [nexus],
    };
    const baseEvent: CollectedTriggerEvent = {
      actingPlayerId: "bob",
      eventKind: "destroy",
      source: "action_resolution",
      chainId: "test-chain:x03-destroy",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: nexus.instanceId,
      amount: null,
      cause: "opponent_effect",
      step: "attack",
    };
    const resolveOpts = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    };

    // ベースライン: 抑制なしなら BSTH005-TX01(A) effects[1] (leave_field cause:opponent_effect
    // → rebirth) が pending として積まれる。
    const withoutSuppression = queuePendingReactionsFromTriggerEvents(
      state,
      [baseEvent],
      undefined,
      resolveOpts
    );
    expect(
      withoutSuppression.pendingTriggeredEffects.length +
        withoutSuppression.pendingPrivateDeclarations.length
    ).toBeGreaterThan(0);

    // destroyed_only の対照。X03 の転醒限定制限は別途専用回帰で確認する。
    const suppressedEvent: CollectedTriggerEvent = {
      ...baseEvent,
      suppressedSourceInstanceIds: [nexus.instanceId],
    };
    const withSuppression = queuePendingReactionsFromTriggerEvents(
      state,
      [suppressedEvent],
      undefined,
      resolveOpts
    );
    expect(
      withSuppression.pendingTriggeredEffects.length +
        withSuppression.pendingPrivateDeclarations.length
    ).toBe(0);
  });
});

describe("BSTH005-TX01(A) 魔界 (転醒nexus)", () => {
  const card = cardNoMap.get("BSTH005-TX01(A)")!;
  it("転醒トリガー(reduce_life/core_placed_on_life + leave_field) rebirth(9) + 配置時 BP-8000 + ドロー2エントリ / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    // [0] ライフ増減 (game_event: reduce_life/core_placed_on_life)
    const lifeChangeEff = card.effects![0]!;
    expect(lifeChangeEff.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["reduce_life", "core_placed_on_life"],
    });
    expect(lifeChangeEff.condition).toEqual([
      { kind: "count_value", player: "self", max: 9 },
    ]);
    expect(lifeChangeEff.stub).toBeUndefined();
    const rebirth = lifeChangeEff.steps[0]!.action;
    if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(9);
    // [1] このネクサスが相手によって離れる (card_event: leave_field cause:opponent_effect)
    const leaveEff = card.effects![1]!;
    expect(leaveEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leaveEff.stub).toBeUndefined();
    const rebirth2 = leaveEff.steps[0]!.action;
    if (rebirth2.kind === "rebirth") expect(rebirth2.maxCount).toBe(9);
    // [2] 配置時 BP-8000 + 破壊
    const place = card.effects![2]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const bp = place.steps[0]!.action;
    if (bp.kind === "bp_modify") expect(bp.amount).toBe(-8000);
    // 「BPが0になった対象を破壊できる」= maxBp:0 フィルタの destroy ステップ
    const d = place.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxBp).toBe(0);
    }
    expect(place.stub).toBeUndefined();
    // [3,4] 黄1色召喚/使用時 手札5枚以下で1ドロー (summon / effect_declaration 2エントリ)
    const summonDraw = card.effects![3]!;
    expect(summonDraw.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "summon",
      triggerFilter: { colors: ["yellow"], colorCount: "mono" },
      exactEventKind: true,
    });
    expect(summonDraw.condition).toEqual([
      { kind: "hand_count", player: "self", max: 5 },
    ]);
    expect(summonDraw.executionMode).toBe("optional");
    expect(summonDraw.steps).toEqual([{ action: { kind: "draw", count: 1 } }]);
    expect(summonDraw.limitGroupId).toBe("BSTH005-TX01-yellow-mono-draw");
    expect(summonDraw.stub).toBeUndefined();
    const useDraw = card.effects![4]!;
    expect(useDraw.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "effect_declaration",
      triggerEffectActionKind: "magic",
      triggerFilter: { colors: ["yellow"], colorCount: "mono" },
      sourceWhose: "self",
    });
    expect(useDraw.executionMode).toBe("optional");
    expect(useDraw.steps).toEqual([{ action: { kind: "draw", count: 1 } }]);
    expect(useDraw.limitGroupId).toBe("BSTH005-TX01-yellow-mono-draw");
    expect(useDraw.stub).toBeUndefined();
  });

  it("B面 神綺 は転醒/BP-8000 効果テキストを持つ", () => {
    expect(card.backFace?.textLines.join("")).toContain("BP-8000");
  });

  it("転醒成功時はB面のフィールド役割と印字最低コアをinstanceへ反映する", () => {
    const nexus = createCardInstance(card, {
      instanceId: "makai-rebirth",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus],
    });

    const resolved = executeRebirth(
      state,
      "alice",
      { kind: "rebirth", maxCount: 9 },
      nexus.instanceId,
      getCardDefinitionById,
      "test:bsth004-005-cards:388"
    );
    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === nexus.instanceId
    )!;

    expect(flipped.definitionId).toBe("BSTH005-TX01(B)");
    expect(flipped.zoneRoleName).toBe("spirit");
    expect(flipped.minimumRequiredCores).toBe(1);
    expect(flipped.normalCoreCount).toBe(1);
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(1);

    const afterSba = runStateBasedActions(resolved, getCardDefinitionById);
    expect(afterSba.checks).not.toContainEqual(
      expect.objectContaining({
        kind: "vanish_due_to_core_deficit",
        instanceId: nexus.instanceId,
      })
    );
  });

  it("[実挙動] 黄1色スピリット召喚観測(game_event:summon)でドロー用pendingが積まれる", () => {
    const nexus = createCardInstance(card, {
      instanceId: "makai-draw-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const yellowSpiritDef: CardDefinition = {
      cardNo: "TEST-YELLOW-SPIRIT",
      name: "テスト黄スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "テスト",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const summoned = createCardInstance(yellowSpiritDef, {
      instanceId: "yellow-spirit-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const defs: Record<string, CardDefinition> = {
      "BSTH005-TX01(A)": card,
      "TEST-YELLOW-SPIRIT": yellowSpiritDef,
    };
    const getD = (id: string) => defs[id];
    const lookup = buildTriggeredEffectLookup([card]);
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [nexus, summoned],
    };
    const event: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test-chain:tx01-summon",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: summoned.instanceId,
      amount: null,
      step: "attack",
    };
    const resolved = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      }
    );
    const queuedCount =
      resolved.pendingTriggeredEffects.length +
      resolved.pendingPrivateDeclarations.length;
    expect(queuedCount).toBeGreaterThan(0);
  });

  it("[実挙動] 黄1色マジック使用観測(game_event:effect_declaration, sourceWhose:self)でドロー用pendingが積まれる", () => {
    const nexus = createCardInstance(card, {
      instanceId: "makai-draw-use",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const yellowMagicDef: CardDefinition = {
      cardNo: "TEST-YELLOW-MAGIC",
      name: "テスト黄マジック",
      printedCategory: "magic",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const magicUsed = createCardInstance(yellowMagicDef, {
      instanceId: "yellow-magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const defs: Record<string, CardDefinition> = {
      "BSTH005-TX01(A)": card,
      "TEST-YELLOW-MAGIC": yellowMagicDef,
    };
    const getD = (id: string) => defs[id];
    const lookup = buildTriggeredEffectLookup([card]);
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [nexus, magicUsed],
    };
    // production 実態 (trigger-system.ts queueEffectDeclarationTriggers): actingPlayerId には
    // stack.actingPlayerId (実使用者) の逆側 (responder) が積まれ、relatedPlayerId には
    // 実使用者がそのまま積まれる。ここでは alice が使用者、bob が responder。
    const event: CollectedTriggerEvent = {
      actingPlayerId: "bob",
      eventKind: "effect_declaration",
      source: "action_resolution",
      chainId: "test-chain:tx01-use",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: magicUsed.instanceId,
      amount: null,
      effectSourceInstanceId: magicUsed.instanceId,
      effectSourceDefinitionId: "TEST-YELLOW-MAGIC",
      effectActionKind: "magic",
      step: "attack",
    };
    const resolved = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      {
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: undefined,
      }
    );
    const queuedCount =
      resolved.pendingTriggeredEffects.length +
      resolved.pendingPrivateDeclarations.length;
    expect(queuedCount).toBeGreaterThan(0);
  });
});
