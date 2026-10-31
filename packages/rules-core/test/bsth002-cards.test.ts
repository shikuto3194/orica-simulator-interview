/**
 * BSTH002 (東方封魔録) カードの effects 検証テスト。
 * ミラージュ/封魔/転召/転醒 中心。mirage セット・転召・セット中効果の多くは stub。
 * 注: M01 戦車むすめのみるゆめ。旧 cardNo 誤記 "BSAZ01-C12"（実 BSAZ01-C12 を遮蔽）は
 * 修正済みのため cardNo "BSTH002-M01" で参照する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  rebuildContinuousEffectsFromField,
} from "../src/runtime";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

describe("BSTH002-C01 化け化け (mirage set stub resolved)", () => {
  const card = cardNoMap.get("BSTH002-C01")!;
  it("セット可能枚数除外は mirageData.exemptSetCountLimits、effects[0,1] はセット中メイン/常時効果として全解消済み (詳細は bsth002-c01-mirage-set-draw-and-reduction-assist.test.ts)", () => {
    expect(card.mirageData?.exemptSetCountLimits).toBe(true);
    expect(card.mirageData?.cost).toBe(2);
    expect(card.effects?.length).toBe(2);
    expect(card.effects!.every((e) => e.stub === undefined)).toBe(true);
  });
});

describe.each([
  ["BSTH002-C02", "purple", true],
  ["BSTH002-C03", "white", false],
])("%s 里香/呪い子", (cardNo, color, hasCore) => {
  const card = cardNoMap.get(cardNo)!;
  it("召喚時 deck_reveal(封魔ミラージュ + 除外封魔) + treat_as + ネクサス発生源限定耐性", () => {
    const summon = card.effects![0]!;
    const reveal = summon.steps.find(
      (s) => s.action.kind === "deck_reveal"
    )!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[0]!.filter?.hasMechanic).toEqual(["mirage"]);
      expect(reveal.picks[1]!.filter?.exclude).toBeDefined();
    }
    expect(summon.steps[0]!.action.kind).toBe(
      hasCore ? "core_move" : "deck_reveal"
    );
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe(color);

    // 「相手のネクサスの効果を受けない」(発生源カテゴリ限定 immunity)。
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    expect(immune.stub).toBeUndefined();
    const a = immune.steps[0]!.action;
    if (a.kind === "effect_immunity") {
      expect(a.target).toEqual({ kind: "self" });
      expect(a.duration).toEqual({ scope: "while_on_field" });
      expect(a.sourceScope).toEqual({ categories: ["nexus"] });
    }
  });
});

describe.each([["BSTH002-C02"], ["BSTH002-C03"]])(
  "%s ネクサス発生源限定免疫 behaviour",
  (cardNo) => {
    function setUp() {
      const card = cardNoMap.get(cardNo)!;
      const self = createCardInstance(card, {
        instanceId: `${cardNo}-self`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [self],
      };
      const immune = card.effects!.find(
        (e) => e.steps[0]?.action.kind === "effect_immunity"
      )!;
      const next = executeEffect({
        chainId: "test:bsth002-cards:106",
        state,
        effect: immune,
        sourceInstanceId: `${cardNo}-self`,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const target = next.cardInstances.find(
        (c) => c.instanceId === `${cardNo}-self`
      )!;
      return { state: next, target, base: self };
    }

    it("発生源 nexus → 免疫成立", () => {
      const { state, target, base } = setUp();
      const nexusSource: CardDefinition = {
        ...base,
        cardNo: "TEST-NEXUS",
        printedCategory: "nexus",
      } as unknown as CardDefinition;
      expect(
        isCardImmuneToOpponentEffect(state, target, "bob", "none", {
          definition: nexusSource,
        })
      ).toBe(true);
    });

    it("発生源 spirit → 免疫不成立 (素通し)", () => {
      const { state, target, base } = setUp();
      const spiritSource: CardDefinition = {
        ...base,
        cardNo: "TEST-SPIRIT",
        printedCategory: "spirit",
      } as unknown as CardDefinition;
      expect(
        isCardImmuneToOpponentEffect(state, target, "bob", "none", {
          definition: spiritSource,
        })
      ).toBe(false);
    });

    it("発生源 magic → 免疫不成立 (素通し)", () => {
      const { state, target, base } = setUp();
      const magicSource: CardDefinition = {
        ...base,
        cardNo: "TEST-MAGIC",
        printedCategory: "magic",
      } as unknown as CardDefinition;
      expect(
        isCardImmuneToOpponentEffect(state, target, "bob", "none", {
          definition: magicSource,
        })
      ).toBe(false);
    });
  }
);

describe("BSTH002-C04 三面道中", () => {
  const card = cardNoMap.get("BSTH002-C04")!;
  it("effects[0] ボイド→ライフ配置禁止 + effects[1] セット時ドロー (詳細は bsth002-c04-mirage-set-restrict-core-placement-void-to-life.test.ts / engine-mirage-set-card-event-trigger.test.ts) + 召喚時 draw", () => {
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![1]!.stub).toBeUndefined();
    const summon = card.effects![2]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action.kind).toBe("draw");
  });
});

describe("BSTH002-M01 戦車むすめのみるゆめ", () => {
  const card = cardNoMap.get("BSTH002-M01")!;
  it("トラッシュ耐性stub + 系統付与 + フラッシュstub + スタック bounce", () => {
    expect(card.effects![0]!.applicability).toEqual({ zone: "trash" });
    const t = card.effects![1]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想", "封魔"]);
    }
    const stack = card.effects![3]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.steps[0]!.action.kind).toBe("bounce");
  });
});

describe("BSTH002-M02 Complete Darkness", () => {
  const card = cardNoMap.get("BSTH002-M02")!;
  it("系統付与 + フラッシュ destroy/send_to_deck choice", () => {
    const flash = card.effects![1]!;
    expect(flash.steps[0]!.action.kind).toBe("destroy");
    expect(flash.steps[0]!.choice?.[0]?.action.kind).toBe("send_to_deck");
  });

  it("[board] スタック: 最低Lvコスト1の相手2体を、コアが1個ずつになるようリザーブへ", () => {
    const stack = card.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "stack"
    )!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    const targetA = createCardInstance(cardNoMap.get("BSGE01-CX03")!, {
      instanceId: "m02-lv1cost1-a",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const targetB = createCardInstance(cardNoMap.get("BSGE01-CX03")!, {
      instanceId: "m02-lv1cost1-b",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const source = createCardInstance(card, {
      instanceId: "darkness-m02-stack",
      ownerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [targetA, targetB, source],
        playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const after = executeEffect({
      chainId: "test:bsth002-cards:229",
      state: before,
      effect: stack,
      sourceInstanceId: "darkness-m02-stack",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["m02-lv1cost1-a", "m02-lv1cost1-b"],
    });
    const afterA = after.cardInstances.find(
      (x) => x.instanceId === "m02-lv1cost1-a"
    )!;
    const afterB = after.cardInstances.find(
      (x) => x.instanceId === "m02-lv1cost1-b"
    )!;
    expect(afterA.normalCoreCount).toBe(1);
    expect(afterB.normalCoreCount).toBe(1);
    const bob = after.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(6);
  });
});

describe("BSTH002-R01 明羅", () => {
  const card = cardNoMap.get("BSTH002-R01")!;
  it("召喚時 send_to_deck(nexus) / Lv2 メイン symbol_add(field_lacks grandwalker)", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("send_to_deck");
    const sym = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "symbol_add"
    )!;
    expect(sym.condition).toContainEqual({
      kind: "field_lacks",
      player: "self",
      grandwalkerKind: "any",
    });
  });
});

describe("BSTH002-R02 ふらわ～戦車 (nexus)", () => {
  const card = cardNoMap.get("BSTH002-R02")!;
  it("系統付与 + mirage stub + symbol_add + Lv2 stay(離脱時 デッキ2トラッシュ)", () => {
    const leave = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.steps.some((s) => s.action.kind === "stay_on_field")
    )!;
    expect(leave).toBeDefined();
    expect(leave.steps[0]!.action.kind).toBe("move_card");
  });
});

describe("BSTH002-R03 魔天使", () => {
  const card = cardNoMap.get("BSTH002-R03")!;
  it("召喚時 destroy(nexus) / 離脱時 core/draw choice / フラッシュ 疲労 choice", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("destroy");
    const leave = card.effects![1]!;
    expect(leave.steps[0]!.choice?.[0]?.action.kind).toBe("draw");
    const flash = card.effects![2]!;
    expect(flash.steps[0]!.action.kind).toBe("exhaust");
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  it("召喚時 destroy 実行: 相手ネクサスが leave enqueue", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "matenshi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyNexus = createCardInstance(cardNoMap.get("BSTH002-R02")!, {
      instanceId: "nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemyNexus],
    };
    const result = executeEffect({
      chainId: "test:bsth002-cards:314",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "matenshi-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "nexus-1")
    ).toBeDefined();
  });

  it("[board] Lv2-Lv3 フラッシュを宣言・解決すると疲労/ボイド→リザーブとなり、同名はターン内で共有する", () => {
    const firstCopy = createCardInstance(card, {
      instanceId: "matenshi-alice-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const sameNameCopy = createCardInstance(card, {
      instanceId: "matenshi-alice-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentCopy = createCardInstance(card, {
      instanceId: "matenshi-bob-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0, voidNormalCoreCount: 2 },
          { reserveNormalCoreCount: 0, voidNormalCoreCount: 2 },
        ],
        cardInstances: [firstCopy, sameNameCopy, opponentCopy],
      }),
      turnNumber: 3,
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-group:3:bob:battle-entity:none",
        primaryEntityId: "battle-entity:none",
        participantEntityIds: [],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        // 相手ターンのフラッシュ窓で、非アクティブ側の Alice が優先権を持つ。
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    };

    const flashAction = (
      state: GameState,
      playerId: string,
      sourceId: string
    ) =>
      getLegalActions({
        state,
        actingPlayerId: playerId,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.timing === "flash" &&
          action.sourceInstanceId === sourceId
      );
    const resolveDeclaredFlash = (
      state: GameState,
      sourceInstanceId: string,
      actingPlayerId: string
    ): GameState => {
      const responderId =
        state.stackWindow?.priorityPlayerId ??
        state.activeAttack?.flashWindowState?.priorityPlayerId;
      expect(responderId).toBeDefined();
      const pass = getLegalActions({
        state,
        actingPlayerId: responderId!,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (action) =>
          action.kind === "pass_stack" || action.kind === "pass_battle_flash"
      );
      expect(pass).toBeDefined();
      let resolved = applyLegalAction({
        state,
        action: pass!,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      const choice = resolved.pendingStepChoice;
      expect(choice).toMatchObject({
        actingPlayerId,
        choosingPlayerId: actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: card.cardNo,
        effectIndex: 2,
      });
      const choiceAction = getLegalActions({
        state: resolved,
        actingPlayerId: choice!.choosingPlayerId,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_step_choice" &&
          action.choiceIndex === 0
      );
      expect(choiceAction).toBeDefined();
      resolved = applyLegalAction({
        state: resolved,
        action: choiceAction!,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      expect(resolved.pendingStepChoice).toBeNull();
      return resolved;
    };

    const firstAction = flashAction(initial, "alice", firstCopy.instanceId);
    expect(firstAction).toBeDefined();
    const afterFirstDeclaration = applyLegalAction({
      state: initial,
      action: firstAction!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(afterFirstDeclaration.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: firstCopy.instanceId,
        sourceDefinitionId: card.cardNo,
        effectLabel: `${firstAction!.sourceKind}:${firstAction!.registrationIndex}`,
      })
    );
    const afterFirstResolution = resolveDeclaredFlash(
      afterFirstDeclaration,
      firstCopy.instanceId,
      "alice"
    );

    expect(
      afterFirstResolution.cardInstances.find(
        (instance) => instance.instanceId === firstCopy.instanceId
      )?.exhaustState
    ).toBe("exhausted");
    expect(
      afterFirstResolution.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(1);
    expect(
      afterFirstResolution.players.find((player) => player.id === "alice")
        ?.voidNormalCoreCount
    ).toBe(1);

    // 使用後の優先権は Bob へ移り、別プレイヤーの同名は引き続き発揮できる。
    const opponentAction = flashAction(
      afterFirstResolution,
      "bob",
      opponentCopy.instanceId
    );
    expect(opponentAction).toBeDefined();
    const afterOpponentDeclaration = applyLegalAction({
      state: afterFirstResolution,
      action: opponentAction!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(afterOpponentDeclaration.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: opponentCopy.instanceId,
        sourceDefinitionId: card.cardNo,
        effectLabel: `${opponentAction!.sourceKind}:${opponentAction!.registrationIndex}`,
      })
    );
    const afterOpponentResolution = resolveDeclaredFlash(
      afterOpponentDeclaration,
      opponentCopy.instanceId,
      "bob"
    );
    expect(
      afterOpponentResolution.cardInstances.find(
        (instance) => instance.instanceId === opponentCopy.instanceId
      )?.exhaustState
    ).toBe("exhausted");
    expect(
      afterOpponentResolution.players.find((player) => player.id === "bob")
        ?.reserveNormalCoreCount
    ).toBe(1);
    expect(
      afterOpponentResolution.players.find((player) => player.id === "bob")
        ?.voidNormalCoreCount
    ).toBe(1);

    // Bob の解決後は Alice が実フラッシュ優先権を得るが、Alice の同名 2 体はいずれも候補外。
    expect(afterOpponentResolution.window).toBe("flash_before_block");
    expect(
      afterOpponentResolution.activeAttack?.flashWindowState
    ).toMatchObject({
      kind: "before_block",
      priorityPlayerId: "alice",
      stackResponseSourcePlayerId: "alice",
      consecutivePassCount: 0,
      pendingStackAction: null,
    });
    expect(
      flashAction(afterOpponentResolution, "alice", firstCopy.instanceId)
    ).toBeUndefined();
    expect(
      flashAction(afterOpponentResolution, "alice", sameNameCopy.instanceId)
    ).toBeUndefined();

    // Alice が pass すると Bob が次の優先権を受けるが、同じ Bob 個体も使用済みで候補外。
    const alicePass = getLegalActions({
      state: afterOpponentResolution,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    expect(alicePass).toBeDefined();
    const afterAlicePass = applyLegalAction({
      state: afterOpponentResolution,
      action: alicePass!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(afterAlicePass.activeAttack?.flashWindowState).toMatchObject({
      kind: "before_block",
      priorityPlayerId: "bob",
      stackResponseSourcePlayerId: "bob",
      consecutivePassCount: 1,
      pendingStackAction: null,
    });
    expect(afterAlicePass.window).toBe("flash_before_block");
    expect(
      flashAction(afterAlicePass, "bob", opponentCopy.instanceId)
    ).toBeUndefined();
  });
});

describe("BSTH002-X01 里香(EX)", () => {
  const card = cardNoMap.get("BSTH002-X01")!;
  it("BSTH002-X01: 転召 + アタック時 hand→mirage conditional_cost + Lv2 自分ターン効果耐性", () => {
    expect(card.tenshoSummon).toBeDefined();
    expect(card.tenshoSummon!.minCores).toBe(1);
    expect(card.tenshoSummon!.destination).toBe("void");
    expect(card.tenshoSummon!.targetFilter.tribesRequired).toEqual(["幻想"]);
    const attack = card.effects![0]!;
    expect(attack.stub).toBeUndefined();
    expect(attack.executionMode).toBe("optional");
    expect(attack.usageLimit).toBeUndefined();
    expect(attack.preventionLevel).toBeUndefined();
    expect(attack.preventionRestriction).toEqual({
      onlyPreventableByColors: ["white"],
      colorMatchMode: "exact",
    });
    expect(attack.steps[0]!.id).toBe("selectMirage");
    expect(attack.steps[0]!.action).toEqual({
      kind: "noop",
      target: {
        kind: "filter",
        player: "self",
        zone: "hand",
        filter: { colors: ["white", "purple"], hasMirageData: true },
        count: { min: 0, max: 1 },
      },
    });
    expect(attack.steps[1]!.id).toBe("mirage-cost");
    expect(attack.steps[1]!.action).toEqual({
      kind: "set_self_as_mirage",
      target: { kind: "ref", stepId: "selectMirage" },
    });
    expect(attack.steps[2]!.id).toBe("rika-ex-bottom-deck-targets");
    expect(attack.steps[2]!.connector).toBe("conditional_cost");
    expect(attack.steps[2]!.conditionalCostAlternativeStepIds).toEqual([
      "rika-ex-recover",
    ]);
    expect(attack.steps[2]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mirage-cost",
    });
    expect(attack.steps[2]!.action.kind).toBe("send_to_deck");
    expect(attack.steps[3]!.id).toBe("rika-ex-recover");
    expect(attack.steps[3]!.action.kind).toBe("recover");
    expect(attack.steps[3]!.executionMode).toBe("optional");
    expect(attack.steps[3]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(attack.steps[3]!.stepCondition).toEqual({
      kind: "ref_executed",
      stepId: "mirage-cost",
    });
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    expect(immune.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "turn_player", player: "self" },
    ]);
  });

  it("BSTH002-X01: Lv2-Lv3『自分のターン』は rebuild 後、相手効果だけを受けない", () => {
    const self = createCardInstance(card, {
      instanceId: "rika-ex-lv2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentEffectSource = cardNoMap.get("BSTH002-R03")!;
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [self],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      base,
      getCardDefinitionById
    );
    const target = rebuilt.cardInstances.find(
      (c) => c.instanceId === "rika-ex-lv2"
    )!;

    expect(
      isCardImmuneToOpponentEffect(rebuilt, target, "bob", "none", {
        definition: opponentEffectSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(rebuilt, target, "alice", "none", {
        definition: opponentEffectSource,
      })
    ).toBe(false);
  });

  it("BSTH002-X01: 相手ターン中は Lv2 でも『自分のターン』耐性を登録しない", () => {
    const self = createCardInstance(card, {
      instanceId: "rika-ex-lv2-bob-turn",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentEffectSource = cardNoMap.get("BSTH002-R03")!;
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [self],
      }),
      activePlayerId: "bob",
      step: "main",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      base,
      getCardDefinitionById
    );
    const target = rebuilt.cardInstances.find(
      (c) => c.instanceId === "rika-ex-lv2-bob-turn"
    )!;

    expect(
      isCardImmuneToOpponentEffect(rebuilt, target, "bob", "none", {
        definition: opponentEffectSource,
      })
    ).toBe(false);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "rika-ex-lv2-bob-turn" &&
          ce.modifierTag === "defense_immune"
      )
    ).toBe(false);
  });
});

describe("BSTH002-C05 封魔録三面 固定砲台", () => {
  const card = cardNoMap.get("BSTH002-C05")!;
  it("nexus / mirageコスト3<白> + セット中召喚誘発 bounce + 相手ターン手札増加時破棄 (BSTH002-C05 cluster で実装済)", () => {
    expect(card.printedCategory).toBe("nexus");
    expect(card.colors).toEqual(["white"]);
    expect(card.cost).toBe(4);
    expect(card.mirageData).toEqual({ cost: 3, reduction: ["white"] });
    expect(card.effects?.length).toBe(2);
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![0]!.timing).toMatchObject({
      kind: "game_event",
      event: "summon",
    });
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("bounce");
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "increase_hand",
      cause: ["self_effect"],
    });
    expect(card.effects![1]!.condition).toEqual([
      { kind: "turn_player", player: "opponent" },
    ]);
    expect(card.effects![1]!.executionMode).toBe("mandatory");
    expect(card.effects![1]!.steps[0]!.action).toEqual({
      kind: "discard",
      player: "opponent",
      count: { source: { kind: "event_amount" } },
      targetHandSize: 1,
      capCount: { source: { kind: "event_amount" } },
    });
    // textRef は [mirage+set中main, Lv1相手ターン] の2区分
    expect(card.effects![0]!.textRef).toEqual([0, 2, 3]);
    expect(card.effects![1]!.textRef).toEqual([5, 6]);
  });
});

describe("BSTH002-転醒R01(A) 魔界", () => {
  const card = cardNoMap.get("BSTH002-転醒R01(A)")!;
  it("rebirth(3) 2分岐(第三者離脱/自己離脱) + 配置時 discard→draw / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    const branch1 = card.effects![0]!;
    const branch2 = card.effects![1]!;
    expect(branch1.timing).toMatchObject({
      kind: "game_event",
      player: "opponent",
      event: "leave_field",
    });
    expect(branch2.timing).toMatchObject({
      kind: "card_event",
      event: "leave_field",
    });
    for (const branch of [branch1, branch2]) {
      const rebirth = branch.steps[0]!.action;
      if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(3);
      expect(branch.stub).toBeUndefined();
    }
    const place = card.effects![2]!;
    expect(place.steps[0]!.action.kind).toBe("discard");
    expect(place.steps[1]!.connector).toBe("conditional_cost");
  });
});

describe("BSTH002-転醒R01(B) 現世", () => {
  const expandedDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const definitions = new Map<string, CardDefinition>(
    expandedDefinitions.map((definition) => [definition.cardNo, definition])
  );
  const getDefinition = (id: string) => definitions.get(id);
  const triggeredLookup = buildTriggeredEffectLookup(expandedDefinitions);
  const front = getDefinition("BSTH002-転醒R01(A)")!;
  const back = getDefinition("BSTH002-転醒R01(B)")!;

  it("[board] A面から転醒するとB面転醒時をproduction lookupで解決し、指定したスピリットへ1回のフラッシュ回復を付与する", () => {
    const nexus = createCardInstance(front, {
      instanceId: "makai-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const target = createCardInstance(cardNoMap.get("BSTH002-X01")!, {
      instanceId: "marisa-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const otherSpirit = createCardInstance(cardNoMap.get("BSTH002-X01")!, {
      instanceId: "marisa-other",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [nexus, target, otherSpirit],
    };

    const rebirthAction = front
      .effects!.flatMap((effect) => effect.steps)
      .find((step) => step.action.kind === "rebirth")?.action;
    expect(rebirthAction?.kind).toBe("rebirth");
    if (rebirthAction?.kind !== "rebirth")
      throw new Error("rebirth is required");

    const flipped = executeRebirth(
      state,
      "alice",
      rebirthAction,
      nexus.instanceId,
      getDefinition,
      "test:bsth002-cards:827"
    );
    expect(
      flipped.cardInstances.find(
        (instance) => instance.instanceId === nexus.instanceId
      )?.definitionId
    ).toBe(back.cardNo);
    expect(
      flipped.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);

    const queued = collectAndQueueTriggerReactions({
      beforeState: state,
      afterState: flipped,
      source: "action_resolution",
      chainId: "bsth002-r01-rebirth",
      attackId: null,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const rebirthPending = queued.pendingTriggeredEffects.find(
      (pending) =>
        pending.eventKind === "rebirth" &&
        pending.relatedInstanceId === nexus.instanceId
    );
    expect(
      rebirthPending,
      "B面の転醒時効果がproduction lookupからqueueされる"
    ).toBeDefined();

    const legalActions = (current: GameState, actingPlayerId = "alice") =>
      getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
    const passStackUntilClosed = (current: GameState) => {
      let next = current;
      for (let guard = 0; next.stackWindow && guard < 8; guard += 1) {
        const pass = legalActions(next, next.stackWindow.priorityPlayerId).find(
          (action) => action.kind === "pass_stack"
        );
        expect(pass, "スタック窓の各優先者がパスできる").toBeDefined();
        next = (
          applyLegalAction({
            state: next,
            action: pass!,
            getCardDefinitionById: getDefinition,
            getRegisteredTriggeredEffectActions: triggeredLookup,
          }) as { state: GameState }
        ).state;
      }
      expect(next.stackWindow).toBeNull();
      return next;
    };

    const declareRebirth = legalActions(queued).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === rebirthPending!.pendingId
    );
    expect(declareRebirth, "B面転醒時の解決宣言が列挙される").toBeDefined();
    let granted = (
      applyLegalAction({
        state: queued,
        action: declareRebirth!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }) as { state: GameState }
    ).state;
    granted = passStackUntilClosed(granted);

    const grantedActions = (current: GameState) =>
      legalActions(current).filter(
        (action) =>
          action.kind === "use_field_card_effect" &&
          (action as { grantedEffectCeId?: string }).grantedEffectCeId !==
            undefined
      );

    const [activation] = grantedActions(granted);
    expect(activation, "転醒後の付与フラッシュが列挙される").toBeDefined();
    expect(
      (activation as { sourceInstanceId?: string }).sourceInstanceId,
      "転醒時に先頭の指定対象だけへ付与される"
    ).toBe(target.instanceId);
    let resolved = (
      applyLegalAction({
        state: granted,
        action: activation!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }) as { state: GameState }
    ).state;
    resolved = passStackUntilClosed(resolved);

    expect(
      resolved.cardInstances.find(
        (instance) => instance.instanceId === target.instanceId
      )?.exhaustState
    ).toBe("recovered");
    expect(
      resolved.cardInstances.find(
        (instance) => instance.instanceId === otherSpirit.instanceId
      )?.exhaustState
    ).toBe("exhausted");
    expect(grantedActions(resolved)).toHaveLength(0);
  });

  it("[ruling board] 同一ターンに2枚の魔界が同じ対象へ付与した回復権は、grant CEごとに1回ずつ使える", () => {
    const firstNexus = createCardInstance(front, {
      instanceId: "makai-a-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const secondNexus = createCardInstance(front, {
      instanceId: "makai-a-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const target = createCardInstance(cardNoMap.get("BSTH002-X01")!, {
      instanceId: "shared-recovery-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const initial: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [firstNexus, secondNexus, target],
    };
    const rebirthAction = front
      .effects!.flatMap((effect) => effect.steps)
      .find((step) => step.action.kind === "rebirth")?.action;
    expect(rebirthAction?.kind).toBe("rebirth");
    if (rebirthAction?.kind !== "rebirth") {
      throw new Error("rebirth is required");
    }

    const legalActions = (current: GameState, actingPlayerId = "alice") =>
      getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
    const passStackUntilClosed = (current: GameState) => {
      let next = current;
      for (let guard = 0; next.stackWindow && guard < 8; guard += 1) {
        const pass = legalActions(next, next.stackWindow.priorityPlayerId).find(
          (action) => action.kind === "pass_stack"
        );
        expect(pass, "スタック窓の各優先者がパスできる").toBeDefined();
        next = (
          applyLegalAction({
            state: next,
            action: pass!,
            getCardDefinitionById: getDefinition,
            getRegisteredTriggeredEffectActions: triggeredLookup,
          }) as { state: GameState }
        ).state;
      }
      expect(next.stackWindow).toBeNull();
      return next;
    };
    const grantedActions = (current: GameState) =>
      legalActions(current).filter(
        (action) =>
          action.kind === "use_field_card_effect" &&
          (action as { grantedEffectCeId?: string }).grantedEffectCeId !==
            undefined
      );
    const rebirthAndGrant = (
      beforeState: GameState,
      nexusInstanceId: string,
      chainId: string
    ) => {
      const flipped = executeRebirth(
        beforeState,
        "alice",
        rebirthAction,
        nexusInstanceId,
        getDefinition,
        "test:bsth002-cards:1022"
      );
      expect(
        flipped.cardInstances.find(
          (instance) => instance.instanceId === nexusInstanceId
        )?.definitionId
      ).toBe(back.cardNo);
      const queued = collectAndQueueTriggerReactions({
        beforeState,
        afterState: flipped,
        source: "action_resolution",
        chainId,
        attackId: null,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      });
      const rebirthPending = queued.pendingTriggeredEffects.find(
        (pending) =>
          pending.eventKind === "rebirth" &&
          pending.relatedInstanceId === nexusInstanceId
      );
      expect(rebirthPending, "各B面の転醒時効果がqueueされる").toBeDefined();
      const declaration = legalActions(queued).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.pendingId === rebirthPending!.pendingId
      );
      expect(declaration, "B面転醒時の解決宣言が列挙される").toBeDefined();
      const declared = (
        applyLegalAction({
          state: queued,
          action: declaration!,
          getCardDefinitionById: getDefinition,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }) as { state: GameState }
      ).state;
      return passStackUntilClosed(declared);
    };

    const afterFirstGrant = rebirthAndGrant(
      initial,
      firstNexus.instanceId,
      "bsth002-r01-first-rebirth"
    );
    const afterSecondGrant = rebirthAndGrant(
      afterFirstGrant,
      secondNexus.instanceId,
      "bsth002-r01-second-rebirth"
    );
    const twoRights = grantedActions(afterSecondGrant);
    expect(twoRights).toHaveLength(2);
    expect(
      twoRights.map(
        (action) => (action as { sourceInstanceId?: string }).sourceInstanceId
      )
    ).toEqual([target.instanceId, target.instanceId]);
    expect(
      new Set(
        twoRights.map(
          (action) =>
            (action as { grantedEffectCeId?: string }).grantedEffectCeId
        )
      ).size,
      "同じ対象でも各転醒時付与のCE IDは別々"
    ).toBe(2);

    let afterFirstUse = (
      applyLegalAction({
        state: afterSecondGrant,
        action: twoRights[0]!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }) as { state: GameState }
    ).state;
    afterFirstUse = passStackUntilClosed(afterFirstUse);
    expect(
      afterFirstUse.cardInstances.find(
        (instance) => instance.instanceId === target.instanceId
      )?.exhaustState
    ).toBe("recovered");
    expect(
      grantedActions(afterFirstUse),
      "1回目の使用後ももう一方のgrant CEの回復権が残る"
    ).toHaveLength(1);

    let afterSecondUse = (
      applyLegalAction({
        state: afterFirstUse,
        action: grantedActions(afterFirstUse)[0]!,
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }) as { state: GameState }
    ).state;
    afterSecondUse = passStackUntilClosed(afterSecondUse);
    expect(
      grantedActions(afterSecondUse),
      "2つの付与権を使い切ると3回目は列挙されない"
    ).toHaveLength(0);
  });
});

describe("BSTH002-転醒X01(A) 霧雨魔梨沙", () => {
  const card = cardNoMap.get("BSTH002-転醒X01(A)")!;
  it("召喚/アタック時 core_move(field→reserve) 解消 + rebirth(5)", () => {
    expect(card.isDoubleSided).toBe(true);
    const coreRemoval = card.effects![0]!;
    expect(coreRemoval.stub).toBeUndefined();
    expect(coreRemoval.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "field", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 2,
    });
    const rebirth = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "rebirth"
    )!;
    if (rebirth.steps[0]?.action.kind === "rebirth") {
      expect(rebirth.steps[0].action.maxCount).toBe(5);
    }
  });

  it("[board] 召喚時: 相手フィールドカードのコア2個→相手リザーブへ移動", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "marisa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyNexus = createCardInstance(cardNoMap.get("BSTH002-R02")!, {
      instanceId: "enemy-nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemyNexus],
    };
    const result = executeEffect({
      chainId: "test:bsth002-cards:1171",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-nexus-1"
    )!;
    expect(enemyAfter.normalCoreCount).toBe(1);
    const bobBefore = base.players.find((p) => p.id === "bob")!;
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 2
    );
    expect(result.pendingCoreShootSelection).toBeNull();
  });

  it("[board][フィールド横断] 相手フィールドに2枚コアがあるとき pending 選択を生成し、分配どおりコアが移動する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "marisa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemySpirit = createCardInstance(cardNoMap.get("BSTH002-R03")!, {
      instanceId: "enemy-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const enemyNexus = createCardInstance(cardNoMap.get("BSTH002-R02")!, {
      instanceId: "enemy-nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemySpirit, enemyNexus],
    };
    const generated = executeEffect({
      chainId: "test:bsth002-cards:1219",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    // 候補2枚・合計4個 > amount2 のため pending が生成される（単一候補/合計<=amount のみ自動解決）。
    expect(generated.pendingCoreShootSelection).not.toBeNull();
    expect(generated.pendingCoreShootSelection!.totalAmount).toBe(2);
    const candidateIds = generated.pendingCoreShootSelection!.candidates.map(
      (c) => c.instanceId
    );
    expect(candidateIds).toContain("enemy-spirit-1");
    expect(candidateIds).toContain("enemy-nexus-1");

    const actions = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const action = actions.find((a) => a.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: generated,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      coreShootDistribution: { "enemy-spirit-1": 1, "enemy-nexus-1": 1 },
    }).state;
    expect(after.pendingCoreShootSelection).toBeNull();
    const spiritAfter = after.cardInstances.find(
      (c) => c.instanceId === "enemy-spirit-1"
    )!;
    const nexusAfter = after.cardInstances.find(
      (c) => c.instanceId === "enemy-nexus-1"
    )!;
    expect(spiritAfter.normalCoreCount).toBe(1);
    expect(nexusAfter.normalCoreCount).toBe(1);
    const bobBefore = base.players.find((p) => p.id === "bob")!;
    const bobAfter = after.players.find((p) => p.id === "bob")!;
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 2
    );
  });
});
