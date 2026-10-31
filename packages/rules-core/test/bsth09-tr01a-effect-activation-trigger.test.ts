/**
 * BSTH09-TR01(A) 柱斧 の転醒トリガー検証テスト。
 * cluster: bsth09-tr01a-any-effect-activation-trigger
 *
 * Lv1【転醒：自分のカウント1以上】系統「勇傑」を持つ自分のスピリットが召喚されたか、
 * 効果を発揮したとき、このネクサスを裏返せる。このとき、この転醒後ブレイヴを
 * 自分のスピリットに合体できる。
 *
 * 「効果を発揮したとき」は非バースト観測トリガー TriggerEventKind:"effect_activated"
 * (ENGINE-effect-activation-card-event-observer) で表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
  getAvailableTriggeredEffectSourceChoices,
  queueEffectActivationTriggers,
} from "../src/effect/trigger-system";
import { executeRebirth } from "../src/effect/structured-card-replacement";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH09-TR01(A) 柱斧", () => {
  const front = cardNoMap.get("BSTH09-TR01(A)")!;

  it("effects[0]: game_event(summon|effect_activated) + tribe:勇傑 + count_value min:1", () => {
    const eff = front.effects![0]!;
    expect(eff.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["summon", "effect_activated"],
      triggerFilter: { category: ["spirit"], tribes: ["勇傑"] },
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "count_value", player: "self", min: 1 },
    ]);
    expect(eff.stub).toBeUndefined();
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("rebirth");
    if (action.kind === "rebirth") {
      expect(action.postRebirthChoice).toEqual({
        kind: "brave_combine",
        optional: true,
      });
    }
  });

  it("backFace: 合体条件のみを持ち、A面【転醒】の postRebirthChoice を B面誘発へ分離しない", () => {
    const back = front.backFace!;
    expect(back.braveCondition).toEqual({ tribes: ["勇傑"], minCost: 5 });
    const spiritStateEffect = back.effects![0]!;
    expect(spiritStateEffect.timing).toEqual({ kind: "continuous" });
    expect(spiritStateEffect.applicability?.combined).toBe(false);
    const exhaust = spiritStateEffect.steps[0]!.action;
    expect(exhaust.kind).toBe("effect_resistance");
    if (exhaust.kind === "effect_resistance") {
      expect(exhaust.resistsOutcome).toBe("exhaust");
      expect(exhaust.ruleStrength).toBe(true);
    }
    const battleBan = spiritStateEffect.steps[1]!.action;
    expect(battleBan.kind).toBe("prevent_battle");
    if (battleBan.kind === "prevent_battle") {
      expect(battleBan.restriction).toEqual(["attack", "block"]);
      expect(battleBan.ruleStrength).toBe(true);
    }
    expect(
      (back.effects ?? []).some(
        (effect) =>
          effect.timing.kind === "card_event" &&
          effect.timing.event === "rebirth"
      )
    ).toBe(false);
  });

  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  const getCardDefinitionById = (id: string) => map.get(id);
  const getRegisteredTriggeredEffectActions =
    buildTriggeredEffectLookup(expanded);

  function fieldWithNexusAndTribeSpirit(
    nexusCores: number,
    countValue: number
  ) {
    const nexusDef = getCardDefinitionById("BSTH09-TR01(A)")!;
    const nexus = createCardInstance(nexusDef, {
      instanceId: "nx-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: nexusCores,
    });
    const spiritDef = getCardDefinitionById("BSTH09-X01")!; // 少名針妙丸 (幻想・勇傑)
    const spirit = createCardInstance(spiritDef, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, spirit],
      playerOverrides: [{ countValue }, {}],
    });
    return state;
  }

  it("勇傑スピリットの召喚 (game_event:summon) で転醒トリガーが誘発キューに乗る", () => {
    const before = fieldWithNexusAndTribeSpirit(0, 1);
    const spiritDef = getCardDefinitionById("BSTH09-X01")!;
    const handSpirit = createCardInstance(spiritDef, {
      instanceId: "sp-2",
      ownerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const beforeWithHand: GameState = {
      ...before,
      cardInstances: [...before.cardInstances, handSpirit],
    };
    const after: GameState = {
      ...beforeWithHand,
      cardInstances: beforeWithHand.cardInstances.map((c) =>
        c.instanceId === "sp-2"
          ? { ...c, zone: "field", zoneRoleName: "spirit", normalCoreCount: 1 }
          : c
      ),
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: beforeWithHand,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById,
    });
    expect(events.some((e) => e.eventKind === "summon")).toBe(true);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth09-tr01a-effect-activation-trigger:155",
      beforeState: beforeWithHand,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    // relatedInstanceId は主語 (召喚された勇傑スピリット sp-2)。柱斧 (nx-1) は
    // relatedInstanceIdsBySourceRegistrationKey 側で発火元候補として記録される。
    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "summon" && p.relatedInstanceId === "sp-2"
    );
    expect(rebirthPendings.length).toBe(1);
    expect(
      Object.keys(
        rebirthPendings[0]!.relatedInstanceIdsBySourceRegistrationKey ?? {}
      ).some((key) => key.startsWith("nx-1"))
    ).toBe(true);
  });

  it("勇傑スピリットの効果発揮 (queueEffectActivationTriggers) で転醒トリガーが誘発キューに乗る", () => {
    const state = fieldWithNexusAndTribeSpirit(0, 1);

    const queued = queueEffectActivationTriggers({
      chainId: "test:bsth09-tr01a-effect-activation-trigger:179",
      state,
      activatorPlayerId: "alice",
      relatedInstanceId: "sp-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "effect_activated" && p.relatedInstanceId === "sp-1"
    );
    expect(rebirthPendings.length).toBe(1);
    expect(
      Object.keys(
        rebirthPendings[0]!.relatedInstanceIdsBySourceRegistrationKey ?? {}
      ).some((key) => key.startsWith("nx-1"))
    ).toBe(true);
  });

  it("カウント0 (【転醒：自分のカウント1以上】不成立) では柱斧の転醒トリガーが誘発キューに乗らない", () => {
    // count_value min:1 は effect レベル condition (trigger-system.ts:2431-2440,
    // P3-57 コメント参照) として listing 段階 (queueReactionsInternal 内の候補スキャン)
    // で評価される。柱斧以外に発揮元候補が無いフィールドでは、条件不成立時に
    // 候補が0件になり pending 自体が作られない (「勇傑以外のスピリットの効果発揮では
    // 誘発しない」テストと同じ規約)。countValue:1 では同じフィールド構成で pending が
    // 作られ、getAvailableTriggeredEffectSourceChoices の候補一覧にも柱斧 (nx-1) が
    // 現れることで、条件が実際に発火可否を左右していることを対比検証する。
    const countZeroState = fieldWithNexusAndTribeSpirit(0, 0);
    const countOneState = fieldWithNexusAndTribeSpirit(0, 1);

    const queuedZero = queueEffectActivationTriggers({
      chainId: "test:bsth09-tr01a-effect-activation-trigger:211",
      state: countZeroState,
      activatorPlayerId: "alice",
      relatedInstanceId: "sp-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const pendingZero = queuedZero.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_activated" && p.relatedInstanceId === "sp-1"
    );
    expect(pendingZero).toBeUndefined();

    const queuedOne = queueEffectActivationTriggers({
      chainId: "test:bsth09-tr01a-effect-activation-trigger:225",
      state: countOneState,
      activatorPlayerId: "alice",
      relatedInstanceId: "sp-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const pendingOne = queuedOne.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "effect_activated" && p.relatedInstanceId === "sp-1"
    )!;
    expect(pendingOne).toBeDefined();
    const choicesOne = getAvailableTriggeredEffectSourceChoices({
      state: queuedOne,
      pendingEffect: pendingOne,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
    expect(choicesOne.some((c) => c.sourceCard.instanceId === "nx-1")).toBe(
      true
    );
  });

  it("勇傑以外のスピリットの効果発揮では誘発しない (triggerFilter.tribes)", () => {
    const nexusDef = getCardDefinitionById("BSTH09-TR01(A)")!;
    const nexus = createCardInstance(nexusDef, {
      instanceId: "nx-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    // BSTH09-C01 輝針城チルノ (妖戒, 勇傑ではない)。
    const otherDef = getCardDefinitionById("BSTH09-C01")!;
    const other = createCardInstance(otherDef, {
      instanceId: "sp-other",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, other],
      playerOverrides: [{ countValue: 1 }, {}],
    });

    const queued = queueEffectActivationTriggers({
      chainId: "test:bsth09-tr01a-effect-activation-trigger:273",
      state,
      activatorPlayerId: "alice",
      relatedInstanceId: "sp-other",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    // triggerFilter.tribes:["勇傑"] に一致しないため、柱斧のどの source choice も
    // マッチせず pending 自体が積まれない (queueReactionsInternal のソーススキャンで空振り)。
    expect(queued.pendingTriggeredEffects.length).toBe(0);
  });

  it.each([false, true])(
    "【転醒】任意合体を確定すると裏返る (JSON往復=%s)",
    (roundTrip) => {
      const before = fieldWithNexusAndTribeSpirit(0, 1);

      const after = executeRebirth(
        before,
        "alice",
        {
          kind: "rebirth",
          maxCount: Number.POSITIVE_INFINITY,
          triggerDescription: "",
          postRebirthChoice: { kind: "brave_combine", optional: true },
        },
        "nx-1",
        getCardDefinitionById,
        "test:bsth09-tr01a-effect-activation-trigger:290"
      );

      const virtual = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
      expect(virtual.definitionId).toBe("BSTH09-TR01(A)");
      expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
      expect(after.pendingStoneFlipCombine).toMatchObject({
        braveInstanceId: "nx-1",
        braveDefinitionId: "BSTH09-TR01(B)",
        hostCandidateInstanceIds: ["sp-1"],
        allowNoCombineChoice: true,
      });

      const combineAction = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      }).find(
        (a) =>
          a.kind === "resolve_brave_combine_choice" &&
          a.chosenHostInstanceId === "sp-1"
      );
      expect(combineAction).toBeDefined();

      const resolved = applyLegalAction({
        state: roundTrip ? JSON.parse(JSON.stringify(after)) : after,
        action: combineAction!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      }).state;
      const flipped = resolved.cardInstances.find(
        (c) => c.instanceId === "nx-1"
      )!;
      expect(flipped.definitionId).toBe("BSTH09-TR01(B)");
      expect(flipped.attachedToInstanceId).toBe("sp-1");
      expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(
        2
      );
      expect(resolved.pendingStoneFlipCombine).toBeNull();
    }
  );

  it("選択再開時に転醒できなくなった場合はA面を合体せずカウントも増やさない", () => {
    const pending = executeRebirth(
      fieldWithNexusAndTribeSpirit(0, 1),
      "alice",
      {
        kind: "rebirth",
        maxCount: 1,
        triggerDescription: "",
        postRebirthChoice: { kind: "brave_combine", optional: true },
      },
      "nx-1",
      getCardDefinitionById,
      "failed-rebirth"
    );
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "sp-1"
    )!;
    pending.players[0]!.countValue = 2;
    const resolved = applyLegalAction({
      state: pending,
      action,
      getCardDefinitionById,
    }).state;
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "nx-1")
    ).toMatchObject({
      definitionId: "BSTH09-TR01(A)",
      attachedToInstanceId: null,
    });
    expect(resolved.players[0]!.countValue).toBe(2);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "sp-1")!
        .attachedChildrenIds
    ).toEqual([]);
  });

  it("勇傑スピリットの起動効果 (メインステップ) を実際の action 解決経路で発揮すると転醒トリガーが誘発キューに乗る", () => {
    // 誘発効果 (card_event/game_event の triggered effect) 経路だけでなく、
    // プレイヤーが能動的に発揮する起動効果 (timing.kind:"activated") の resolveDeferredFieldEffectStack
    // 完了点でも queueEffectActivationTriggers が呼ばれることを実解決経路で確認する
    // (ENGINE-effect-activation-card-event-observer verifier round1 Lens2/5 指摘の再発防止)。
    const yuketsuActivated: CardDefinition = {
      cardNo: "TEST-YUKETSU-ACTIVATED-01",
      name: "Test Yuketsu Activated Spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: [],
      textLines: ["テスト用: 自分のメインステップ、ターンに1回ドローできる。"],
      keywordTags: [],
      tribe: "勇傑",
      image: "",
      rarity: "C",
      pack: "TEST",
      maxDeckCount: 3,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [0],
        },
      ],
    };

    const testExpanded = expandCardDefinitionsWithBackFaces([
      ...ALL_CARDS,
      yuketsuActivated,
    ]);
    const testMap = new Map(testExpanded.map((d) => [d.cardNo, d]));
    const testGetCardDefinitionById = (id: string) => testMap.get(id);
    const testGetRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(testExpanded);
    const testGetRegisteredFieldCardEffectActions =
      buildFieldCardEffectLookup(testExpanded);

    const nexus = createCardInstance(
      testGetCardDefinitionById("BSTH09-TR01(A)")!,
      {
        instanceId: "nx-1",
        ownerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "nexus",
        normalCoreCount: 0,
      }
    );
    const spirit = createCardInstance(yuketsuActivated, {
      instanceId: "sp-activated-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, spirit],
        playerOverrides: [{ countValue: 1 }, {}],
      }),
      step: "main",
      activePlayerId: "alice",
    };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: testGetCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        testGetRegisteredFieldCardEffectActions,
    });
    const useAction = legalActions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "sp-activated-1"
    );
    expect(useAction).toBeDefined();

    const declaredState = applyLegalAction({
      state,
      action: useAction!,
      getCardDefinitionById: testGetCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        testGetRegisteredFieldCardEffectActions,
      getRegisteredTriggeredEffectActions:
        testGetRegisteredTriggeredEffectActions,
    }).state;
    // 宣言はスタック窓を開くだけで即解決しない (コスト支払い完了後にスタック窓が開く裁定)。
    // 相手 (bob) が pass_stack することで応答なしとして窓を閉じ、解決を進める。
    expect(declaredState.window).toBe("stack");
    const resolvedState = applyLegalAction({
      state: declaredState,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close_stack",
        actingPlayerId: "bob",
      },
      getCardDefinitionById: testGetCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        testGetRegisteredFieldCardEffectActions,
      getRegisteredTriggeredEffectActions:
        testGetRegisteredTriggeredEffectActions,
    }).state;

    const rebirthPendings = resolvedState.pendingTriggeredEffects.filter(
      (p) =>
        p.eventKind === "effect_activated" &&
        p.relatedInstanceId === "sp-activated-1"
    );
    expect(rebirthPendings.length).toBe(1);
  });
});
