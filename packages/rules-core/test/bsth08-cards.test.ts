import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH08 (東方神霊廟) カードの effects 検証テスト。
 * カード番号順に最小 1 ケース、効果実行後の盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  getAvailableDivineSkillLegalActions,
  generateBurstRegistrations,
  getLegalActions,
  getCombinedUnitSymbols,
  getEffectiveSymbols,
  runReevaluationAtTiming,
} from "../src/runtime";
import { matchesCardFilter } from "../src/card/card-filter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import { advanceStep } from "../src/turn-system";
import {
  getPlayerLifeCoreCount,
  resolveLifeDamage,
} from "../src/core/core-system";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  SymbolColor,
} from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function symbolAdditionCE(
  targetInstanceId: string,
  symbol: SymbolColor
): ContinuousEffect {
  return {
    effectId: `ce-extra-symbol-${targetInstanceId}`,
    sourceInstanceId: "external-symbol-source",
    sourceDefinitionId: "TEST-SYMBOL-SOURCE",
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "symbol_addition",
    modifierSymbol: [symbol],
    targetInstanceId,
  };
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffectWithChosenMinimumCores({
    chainId: "test:bsth08-cards:64",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH08-C01 神光", () => {
  const card = cardNoMap.get("BSTH08-C01")!;
  it("トラッシュ耐性stub / 系統付与 / フラッシュ(cap:1 ライフ下限保護) / スタック bounce", () => {
    expect(card.effects![0]!.applicability).toEqual({ zone: "trash" });
    const t = card.effects![1]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["起幻", "幻想"]);
    }
    // [2] フラッシュ「このターン自分のライフは1しか減らない」=
    // life_damage_interception(turn_cap, cap:1) ＝ ターン累積上限（全原因合算 / 自ターン開始
    // リセット、10_rules/05 §ライフ減少の上限キャップ、裁定 2026-06-15）。
    expect(card.effects![2]!.stub).toBeUndefined();
    const flashAction = card.effects![2]!.steps[0]!.action;
    expect(flashAction.kind).toBe("life_damage_interception");
    if (flashAction.kind === "life_damage_interception") {
      expect(flashAction.mode).toBe("turn_cap");
      expect(flashAction.cap).toBe(1);
    }
    const stack = card.effects![3]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.steps[0]!.action.kind).toBe("bounce");
  });
});

describe.each([
  ["BSTH08-C02", "blue"],
  ["BSTH08-C03", "white"],
])("%s 幽々子/響子 (シンボル %s 化)", (cardNo, color) => {
  const card = cardNoMap.get(cardNo)!;
  it("treat_as + メイン疲労コスト deck_reveal(除外名 exclude, ゲーム1回)", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe(color);
    const e = card.effects![1]!;
    expect(e.usageLimit).toEqual([
      { kind: "per_card_name", duration: "turn" },
      { kind: "per_instance", duration: "game" },
    ]);
    const reveal = e.steps[1]!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[1]!.filter?.exclude).toEqual({
        cardName: [{ exact: "[神霊廟]西行寺 幽々子" }, { exact: "幽谷 響子" }],
      });
    }
  });
});

describe("BSTH08-C04 [五欲]霊夢 (burst)", () => {
  const card = cardNoMap.get("BSTH08-C04")!;
  it("シンボル白青 / burst召喚 / Lv2 創界神コア4個ボイド+回復", () => {
    const colors = card.effects![0]!.steps.map((s) =>
      s.action.kind === "treat_as" ? s.action.asColor : null
    );
    expect(colors).toEqual(["white", "blue"]);
    expect(card.effects![1]!.timing.kind).toBe("burst");
    const lv2 = card.effects![2]!;
    expect(lv2.stub).toBeUndefined();
    expect(lv2.steps[0]!.action.kind).toBe("core_move");
    expect(lv2.steps[1]!.action.kind).toBe("recover");
  });

  it("Lv2効果実行: 相手創界神ネクサスのコア4個がボイドへ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "reimu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 6,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, grandwalker],
    };
    const result = runEffect(state, card.effects![2]!, "reimu-1", "alice");
    // 創界神ネクサスのコアは 6 → 2 (4個ボイドへ)。
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-grandwalker")!
        .normalCoreCount
    ).toBe(2);
  });

  it("[board] アタックごとに創界神コア4個をボイドへ置き、回復だけが個体ごとターン1回", () => {
    const attackEffect = card.effects![2]!;
    // 原文の「ターンに1回」は読点後の「このスピリットは回復する」だけに属する。
    // effect 全体へ昇格すると、本文にない創界神コア移動の回数制限を加えてしまう。
    expect(attackEffect.usageLimit).toBeUndefined();
    expect(attackEffect.steps[1]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });

    const source = createCardInstance(card, {
      instanceId: "reimu-step-limit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
      exhaustState: "exhausted",
    });
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "opponent-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const before: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 7,
      cardInstances: [source, grandwalker],
    };

    const afterFirst = executeEffect({
      chainId: "test:bsth08-c04-step-usage:first",
      state: before,
      effect: attackEffect,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      afterFirst.cardInstances.find(
        (instance) => instance.instanceId === grandwalker.instanceId
      )!.normalCoreCount
    ).toBe(4);
    expect(
      afterFirst.cardInstances.find(
        (instance) => instance.instanceId === source.instanceId
      )!.exhaustState
    ).toBe("recovered");
    expect(
      afterFirst.effectUsageRecords.filter(
        (record) => record.effectLabel === "__step:BSTH08-C04:2:1"
      )
    ).toHaveLength(1);

    // 同一ターンの次のアタック。前段はもう一度解決するが、後段の回復だけが skip される。
    const secondAttack: GameState = {
      ...afterFirst,
      cardInstances: afterFirst.cardInstances.map((instance) =>
        instance.instanceId === source.instanceId
          ? { ...instance, exhaustState: "exhausted" }
          : instance
      ),
    };
    const afterSecond = executeEffect({
      chainId: "test:bsth08-c04-step-usage:second",
      state: secondAttack,
      effect: attackEffect,
      effectIndex: 2,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      afterSecond.cardInstances.find(
        (instance) => instance.instanceId === grandwalker.instanceId
      )!.normalCoreCount
    ).toBe(0);
    expect(
      afterSecond.cardInstances.find(
        (instance) => instance.instanceId === source.instanceId
      )!.exhaustState
    ).toBe("exhausted");
    expect(
      afterSecond.log.some((entry) =>
        entry.startsWith("effect:step-usage-exhausted:reimu-step-limit:2:1")
      )
    ).toBe(true);
  });
});

describe("BSTH08-C05 [強欲]魔理沙 (burst)", () => {
  const card = cardNoMap.get("BSTH08-C05")!;
  it("burst召喚 / 合体stub / アタックブロック時 BP-5000×3体 + BP0破壊", () => {
    expect(card.effects![0]!.timing.kind).toBe("burst");
    const bp = card.effects![2]!;
    expect(bp.stub).toBeUndefined();
    expect(bp.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    const a = bp.steps[0]!.action;
    if (a.kind === "bp_modify") {
      expect(a.amount).toBe(-5000);
      if (typeof a.target === "object" && "count" in a.target)
        expect(a.target.count).toBe(3);
      // 「このスピリットとバトルしていない」= not_in_battle 対象限定。
      if (typeof a.target === "object" && a.target.kind === "filter")
        expect(a.target.filter.battleState).toBe("not_in_battle");
    }
    // 2段目: BP0 になった相手を破壊 (maxBp:0 連動)。
    expect(bp.steps[1]!.action.kind).toBe("destroy");
  });

  it("実行: BP5000 の相手スピリットが BP-5000 で BP0 → 破壊 enqueue", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "mari-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 2,
      normalCoreCount: 3,
    });
    // BP5000 のバトルしていない相手スピリット → BP-5000 で BP0 → 破壊。
    const target = createCardInstance(cardNoMap.get("BSDB01-C02")!, {
      instanceId: "tgt-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, target],
    };
    const result = runEffect(state, card.effects![2]!, "mari-1", "alice");
    // bp_modify(-5000) で BP0 になった対象が maxBp:0 destroy ステップで破壊 enqueue される。
    expect(
      result.pendingLeaveEntities.find(
        (e) => e.instanceId === "tgt-1" && e.kind === "destroy"
      )
    ).toBeDefined();
  });
});

describe.each([
  ["BSTH08-C06", "spirit_destroyed"],
  ["BSTH08-C07", "life_decrease"],
])("%s burst send_to_deck", (cardNo, triggerKind) => {
  const card = cardNoMap.get(cardNo)!;
  it(`burst(${triggerKind}) で send_to_deck(bottom)`, () => {
    const burst = card.effects!.find((e) => e.timing.kind === "burst")!;
    if (
      burst.timing.kind === "burst" &&
      burst.timing.trigger &&
      typeof burst.timing.trigger === "object"
    ) {
      expect(burst.timing.trigger.kind).toBe(triggerKind);
    }
    const a = burst.steps[0]!.action;
    expect(a.kind).toBe("send_to_deck");
    if (a.kind === "send_to_deck") expect(a.position).toBe("bottom");
  });
});

describe("BSTH08-C06 バースト registration: triggerFilter category:[spirit]", () => {
  // ENGINE-burst-pending-leave-declaration-window: spirit_destroyed は leave_field family に
  // 丸められネクサス等の離脱も拾ってしまうため、triggerFilter で「自分のスピリット」限定を
  // 明示する (BSTH03-M01 / BSTH06-M01 / BSTH07-M02 と同型)。
  it("triggerFilter category:[spirit] が登録される", () => {
    const card = cardNoMap.get("BSTH08-C06")!;
    const regs = generateBurstRegistrations(card);
    const leaveReg = regs.find((r) => r.eventKind === "leave_field")!;
    expect(leaveReg).toBeDefined();
    expect(leaveReg.triggerFilter).toEqual({ category: ["spirit"] });
  });
});

describe("BSTH08-C06 burst 実行: 相手1体がデッキ下へ", () => {
  const card = cardNoMap.get("BSTH08-C06")!;
  it("send_to_deck で相手スピリットが deck へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, enemy],
    };
    const result = flushPendingLeaves(
      runEffect(state, card.effects![0]!, "sanae-1", "alice"),
      getCardDefinitionById
    );
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    )!;
    expect(enemyAfter.zone).toBe("deck");
  });

  it("BSTH08-C06 の battleState filter は実モデルの activeAttack から attacking を解決する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const enemyDef = cardNoMap.get("BSTH08-M01")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, enemy],
      battleEntities: [
        {
          entityId: "entity-attacker",
          memberInstanceIds: ["enemy-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["green"],
          attackState: "idle",
        },
      ],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: "entity-attacker",
        participantEntityIds: ["entity-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [
          { participantEntityId: "entity-attacker", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["entity-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    };
    const action = card.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("send_to_deck");
    if (action.kind !== "send_to_deck") return;
    expect(
      matchesCardFilter(enemy, enemyDef, action.target.filter, { state })
    ).toBe(true);
    const result = flushPendingLeaves(
      runEffect(state, card.effects![0]!, "sanae-1", "alice"),
      getCardDefinitionById
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-attacker")?.zone
    ).toBe("deck");
  });

  it("[実挙動] 疲労状態でも非spirit/ultimate(ネクサス)は対象外", () => {
    const action = card.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("send_to_deck");
    if (action.kind !== "send_to_deck") return;

    const exhaustedNexusDef: CardDefinition = {
      cardNo: "TEST-EXHAUSTED-NEXUS",
      name: "テスト疲労ネクサス",
      printedCategory: "nexus",
      colors: ["green"],
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
    const exhaustedNexus = createCardInstance(exhaustedNexusDef, {
      instanceId: "exhausted-nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      exhaustState: "exhausted",
    });
    expect(
      matchesCardFilter(exhaustedNexus, exhaustedNexusDef, action.target.filter)
    ).toBe(false);
  });
});

describe("BSTH08-C06 Lv2 スタック効果コストのフィールド支払い制限", () => {
  const card = cardNoMap.get("BSTH08-C06")!;
  it("effects[1]: continuous + timingScope(自分のアタックステップ) + min_level:2 + restrict_field_cost_payment(effectModes:[stack])", () => {
    const e = card.effects![1]!;
    expect(e.stub).toBeUndefined();
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.timingScope).toEqual({ player: "self", period: "attack" });
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("restrict_field_cost_payment");
    if (a.kind === "restrict_field_cost_payment") {
      expect(a.player).toBe("opponent");
      expect(a.effectModes).toEqual(["stack"]);
    }
  });

  it("効果実行: 相手プレイヤー宛の restrict_field_cost_payment CE が登録される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const result = runEffect(state, card.effects![1]!, "sanae-2", "alice");
    const ce = result.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_field_cost_payment"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("bob");
  });

  it("盤面変化: 制限中は相手のスタック効果コストがフィールドのコアで支払えない (main コストは影響なし)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "sanae-3",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const restricted = runEffect(state, card.effects![1]!, "sanae-3", "alice");

    const bobSpirit = createCardInstance(cardNoMap.get("BSTH08-M02")!, {
      instanceId: "bob-payer",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const withPayer: GameState = {
      ...restricted,
      cardInstances: [...restricted.cardInstances, bobSpirit],
    };
    const magicDef = cardNoMap.get("BSTH08-M01")!;

    const stackSources = getAvailableCardCostPaymentSources({
      state: withPayer,
      actingPlayerId: "bob",
      card: magicDef,
      getCardDefinitionById,
      effectMode: "stack",
    });
    expect(stackSources.onBoardCoreSources).toHaveLength(0);

    const mainSources = getAvailableCardCostPaymentSources({
      state: withPayer,
      actingPlayerId: "bob",
      card: magicDef,
      getCardDefinitionById,
      effectMode: "main",
    });
    expect(mainSources.onBoardCoreSources.length).toBeGreaterThan(0);
  });
});

describe("BSTH08-C07 メイン symbol_add", () => {
  const card = cardNoMap.get("BSTH08-C07")!;
  it("Lv1-Lv2 メイン: 青シンボル継続追加 (ルーミア型 continuous)", () => {
    const e = card.effects![1]!;
    // 『自分のメインステップ』symbol_add は activated+permanent ではなく
    // continuous + timingScope(main) で表現する (起動毎の永続CE累積を防ぐ)。
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.timingScope).toEqual({ player: "self", period: "main" });
    expect(e.applicability).toEqual({ level: { min: 1, max: 2 } });
    const a = e.steps[0]!.action;
    expect(a.kind).toBe("symbol_add");
    if (a.kind === "symbol_add") {
      expect(a.symbol).toBe("blue");
      expect(a.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

describe("BSTH08-M01 物部 布都", () => {
  const card = cardNoMap.get("BSTH08-M01")!;
  it("アタック時 send_to_deck / 超重装甲(赤緑白) sourceScope.colors / フラッシュ回復(turn)", () => {
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("send_to_deck");
    const immune = card.effects![1]!;
    expect(immune.stub).toBeUndefined();
    const a = immune.steps[0]!.action;
    expect(a.kind).toBe("effect_immunity");
    if (a.kind === "effect_immunity") {
      expect(a.sourceScope).toEqual({ colors: ["red", "green", "white"] });
    }
    const flash = card.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
  });

  it("アタック時 実行: 相手がデッキ下へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "futo-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH08-M02")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
    };
    const result = flushPendingLeaves(
      runEffect(state, card.effects![0]!, "futo-1", "alice"),
      getCardDefinitionById
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-1")!.zone
    ).toBe("deck");
  });
});

describe("BSTH08-M02 蘇我 屠自古", () => {
  const card = cardNoMap.get("BSTH08-M02")!;
  it("アタック時 青条件→デッキ7破棄 / 超重装甲(紫黄青) sourceScope.colors / フラッシュ回復", () => {
    const e = card.effects![0]!;
    expect(e.stub).toBeUndefined();
    expect(e.condition?.[0]?.kind).toBe("field_has");
    if (e.condition?.[0]?.kind === "field_has") {
      expect(e.condition[0].symbolColors).toEqual(["blue"]);
      expect(e.condition[0].excludeSelf).toBe(true);
    }
    const a = e.steps[0]!.action;
    if (a.kind === "move_card") expect(a.count).toBe(7);
    expect(e.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "deck_discard",
    });
    expect(e.steps[1]!.action).toMatchObject({
      kind: "life_damage_interception",
      player: "opponent",
      cause: "opponent",
      mode: "replace",
      duration: { scope: "turn" },
    });
    const immune = card.effects![1]!;
    expect(immune.stub).toBeUndefined();
    const i = immune.steps[0]!.action;
    expect(i.kind).toBe("effect_immunity");
    if (i.kind === "effect_immunity") {
      expect(i.sourceScope).toEqual({ colors: ["purple", "yellow", "blue"] });
    }
  });

  it("[board] BSTH08-M02: deck 破棄成功後、このターン Alice によって Bob のライフは減らない", () => {
    const tojiko = createCardInstance(card, {
      instanceId: "tojiko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const blueSymbol = createCardInstance(card, {
      instanceId: "blue-symbol",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobDeck = Array.from({ length: 7 }, (_, i) =>
      createCardInstance(cardNoMap.get("BSTH08-C02")!, {
        instanceId: `bob-deck-${i}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [tojiko, blueSymbol, ...bobDeck],
      activePlayerId: "alice",
      step: "attack",
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = runEffect(state, card.effects![0]!, "tojiko-1", "alice");

    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "trash"
      ).length
    ).toBe(7);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "life_damage_interception" &&
          ce.targetInstanceId === "bob"
      )
    ).toBe(true);

    state = resolveLifeDamage(state, "bob", 2, [], {
      cause: "opponent_effect",
      actingPlayerId: "alice",
    });

    expect(
      getPlayerLifeCoreCount(state.players.find((p) => p.id === "bob")!)
    ).toBe(5);

    state = resolveLifeDamage(state, "bob", 1, [], {
      cause: "battle",
      actingPlayerId: "alice",
    });

    expect(
      getPlayerLifeCoreCount(state.players.find((p) => p.id === "bob")!)
    ).toBe(5);

    state = resolveLifeDamage(state, "bob", 1, [], {
      cause: "self_effect",
      actingPlayerId: "bob",
    });

    expect(
      getPlayerLifeCoreCount(state.players.find((p) => p.id === "bob")!)
    ).toBe(4);
  });

  it("[board] BSTH08-M02: hidden deckCount だけの deck 破棄でも後段のライフ減少防止が登録される", () => {
    const tojiko = createCardInstance(card, {
      instanceId: "tojiko-hidden",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const blueSymbol = createCardInstance(card, {
      instanceId: "blue-symbol-hidden",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [tojiko, blueSymbol],
      activePlayerId: "alice",
      step: "attack",
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { deckCount: 7, lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    state = runEffect(state, card.effects![0]!, "tojiko-hidden", "alice");

    expect(state.players.find((p) => p.id === "bob")!.deckCount).toBe(0);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "life_damage_interception" &&
          ce.targetInstanceId === "bob"
      )
    ).toBe(true);

    state = resolveLifeDamage(state, "bob", 1, [], {
      cause: "battle",
      actingPlayerId: "alice",
    });

    expect(
      getPlayerLifeCoreCount(state.players.find((p) => p.id === "bob")!)
    ).toBe(5);
  });
});

describe("BSTH08-R01 [神霊廟]小傘", () => {
  const card = cardNoMap.get("BSTH08-R01")!;
  it("メイン疲労→差分ドロー(相手手札−自分手札) / Lv2 起幻青白へ effect_immunity(sourceScope.colors:[red,green])", () => {
    const e0 = card.effects![0]!;
    expect(e0.steps[0]!.action.kind).toBe("set_exhaust_state");
    // 疲労後に「手札が相手と同じ枚数になるよう」差分ドロー（stub 解消済み）。
    const draw = e0.steps[1]!.action;
    expect(draw.kind).toBe("draw");
    if (draw.kind === "draw") {
      const count = draw.count as { source?: unknown; subtract?: unknown };
      expect(count.source).toEqual({
        kind: "cards_in_zone",
        zone: "hand",
        player: "opponent",
      });
      expect(count.subtract).toEqual({
        kind: "cards_in_zone",
        zone: "hand",
        player: "self",
      });
    }
    expect(e0.stub).toBeUndefined();
    // Lv2 effects[1] 起幻の自分の青/白スピリットへ【超重装甲：赤/緑】(stub 解消)。
    const grant = card.effects![1]!;
    expect(grant.stub).toBeUndefined();
    expect(grant.timing).toEqual({ kind: "continuous" });
    expect(grant.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const a = grant.steps[0]!.action;
    expect(a.kind).toBe("effect_immunity");
    if (a.kind === "effect_immunity") {
      expect(a.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {
          category: ["spirit"],
          tribes: ["起幻"],
          colors: ["blue", "white"],
        },
        count: "all",
      });
      expect(a.sourceScope).toEqual({
        categories: ["spirit", "ultimate", "nexus", "magic"],
        colors: ["red", "green"],
      });
      expect(a.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("Lv2 起幻青/白スピリットへ赤/緑発生源 immunity が成立し、起幻赤スピや非起幻には付かない", () => {
    const granter = cardNoMap.get("BSTH08-R01")!;
    const blueQigen = cardNoMap.get("BSTH08-C03")!; // spirit, colors:[blue], 起幻
    const whiteQigen = cardNoMap.get("BSTH08-C02")!; // spirit, colors:[white], 起幻
    const redQigen = cardNoMap.get("BSTH08-C04")!; // spirit, colors:[red], 起幻 (色不一致)

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const r01 = createCardInstance(granter, {
      instanceId: "r01-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const blueTgt = createCardInstance(blueQigen, {
      instanceId: "blue-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const whiteTgt = createCardInstance(whiteQigen, {
      instanceId: "white-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const redTgt = createCardInstance(redQigen, {
      instanceId: "red-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [r01, blueTgt, whiteTgt, redTgt],
    };
    const next = runEffect(state, granter.effects![1]!, "r01-1", "alice");

    const redSource: CardDefinition = {
      ...granter,
      cardNo: "TEST-RED-SRC",
      colors: ["red"],
      printedCategory: "spirit",
    } as unknown as CardDefinition;
    const greenSource: CardDefinition = {
      ...granter,
      cardNo: "TEST-GREEN-SRC",
      colors: ["green"],
      printedCategory: "magic",
    } as unknown as CardDefinition;
    const blueSource: CardDefinition = {
      ...granter,
      cardNo: "TEST-BLUE-SRC",
      colors: ["blue"],
      printedCategory: "spirit",
    } as unknown as CardDefinition;
    const redBraveSource: CardDefinition = {
      ...granter,
      cardNo: "TEST-RED-BRAVE-SRC",
      colors: ["red"],
      printedCategory: "brave",
    } as unknown as CardDefinition;

    const blueOnField = next.cardInstances.find(
      (c) => c.instanceId === "blue-1"
    )!;
    const whiteOnField = next.cardInstances.find(
      (c) => c.instanceId === "white-1"
    )!;
    const redOnField = next.cardInstances.find(
      (c) => c.instanceId === "red-1"
    )!;

    // 起幻×青/白: 赤/緑発生源は免疫成立、青発生源は通る (sourceScope 限定)。
    expect(
      isCardImmuneToOpponentEffect(next, blueOnField, "bob", "none", {
        definition: redSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(next, whiteOnField, "bob", "none", {
        definition: greenSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(next, blueOnField, "bob", "none", {
        definition: blueSource,
      })
    ).toBe(false);

    // 起幻×赤 (色不一致): どの発生源色でも CE 未登録のため通る。
    expect(
      isCardImmuneToOpponentEffect(next, redOnField, "bob", "none", {
        definition: redSource,
      })
    ).toBe(false);

    // 発生源が brave: 原文「スピリット/アルティメット/ネクサス/マジック」は brave を含まないため
    // sourceScope.categories で除外され免疫不成立。
    expect(
      isCardImmuneToOpponentEffect(next, blueOnField, "bob", "none", {
        definition: redBraveSource,
      })
    ).toBe(false);
  });
});

describe.each(["BSTH08-X01", "BSTH08-XX01"])("%s 導界者ネクサス", (cardNo) => {
  const card = cardNoMap.get(cardNo)!;
  it("grandwalkerData(guided, 幻想コスト3+/転醒ネクサス) + treat_as(白青)", () => {
    expect(card.grandwalkerData!.kind).toBe("guided");
    expect(card.grandwalkerData!.oracleConditions).toEqual([
      { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
      { hasMechanic: ["rebirth"], categories: ["nexus"] },
    ]);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = treat.steps.map((s) =>
      s.action.kind === "treat_as" ? s.action.asColor : null
    );
    expect(colors).toContain("white");
    expect(colors).toContain("blue");
  });
});

describe("BSTH08-X01 [導界者]霍 青娥", () => {
  const card = cardNoMap.get("BSTH08-X01")!;
  it("導域は条件(field_has trash 幻想青白3+)付き召喚時 suppress / 導技は divineSkills(coreCost:4, Lv2) + コスト6以下破壊", () => {
    const zone = card.effects![1]!;
    expect(zone.stub).toBeUndefined();
    expect(zone.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        zone: "trash",
        tribes: ["幻想"],
        colors: ["blue", "white"],
        minCount: 3,
      },
    ]);
    expect(zone.steps).toHaveLength(2);
    for (const step of zone.steps) {
      expect(step.action.kind).toBe("suppress_effect");
      if (step.action.kind === "suppress_effect") {
        expect(step.action.effectFilter).toEqual({
          sourceKinds: ["spirit", "ultimate"],
          timingKind: "card_event",
          eventAction: "summon",
        });
        expect(step.action.duration).toEqual({ scope: "while_on_field" });
      }
    }
    // 導技=神技扱い → grandwalkerData.divineSkills へ移管（コア4個コストはエンジン側）。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "both",
      mode: "flash",
    });
    expect(skill.minLevel).toBe(2);
    expect(skill.turnLimit).toBe("once");
    const destroy = skill.effects![0]!.steps[0]!;
    if (
      destroy.action.kind === "destroy" &&
      destroy.action.target.kind === "filter"
    ) {
      expect(destroy.action.target.filter.maxCost).toBe(6);
      expect(destroy.action.target.count).toBe(1);
    }
    // effects[] 側に activated の導技は残っていない。
    expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(
      false
    );
  });

  it("BSTH08-X01 導域は後から場に出たスピリットの召喚時効果を動的に抑止する", () => {
    const trashDef = cardNoMap.get("BSTH08-C01")!;
    const summonedDef = cardNoMap.get("BSTH08-M01")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "seiga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const trashCards = [0, 1, 2].map((index) =>
      createCardInstance(trashDef, {
        instanceId: `trash-fantasy-${index}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      })
    );
    const summoned = createCardInstance(summonedDef, {
      instanceId: "bob-summoned-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [self, ...trashCards, summoned],
    };
    const withSuppression = runEffect(
      state,
      card.effects![1]!,
      self.instanceId,
      "alice"
    );
    const registration = {
      reevaluationPoints: [
        {
          timing: "before_each_step" as const,
          checks: ["effect_suppression" as const],
          failurePolicy: "abort_remaining" as const,
        },
      ],
    };

    expect(
      runReevaluationAtTiming({
        state: withSuppression,
        registration,
        timing: "before_each_step",
        sourceInstanceId: summoned.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "summon",
        },
        getCardDefinitionById,
      })
    ).toMatchObject({
      passed: false,
      failurePolicy: "abort_remaining",
      failedChecks: ["effect_suppression"],
    });

    expect(
      runReevaluationAtTiming({
        state: withSuppression,
        registration,
        timing: "before_each_step",
        sourceInstanceId: summoned.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          sourceKind: "spirit",
          timingKind: "card_event",
          eventAction: "attack",
        },
        getCardDefinitionById,
      }).passed
    ).toBe(true);
  });

  it("導技本体実行: コスト6以下の相手1体が破壊待機（コア消費はエンジン側）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "seiga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH08-C02")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
    };
    // 本体 effect（コスト後）を実行: 対象1体のみのため自動選択で破壊待機。
    const skill = card.grandwalkerData!.divineSkills![0]!;
    const result = runEffect(state, skill.effects![0]!, "seiga-1", "alice");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "enemy-1")
    ).toBeDefined();
  });
});

describe("BSTH08-XX01 [導界者]豊聡耳 神子", () => {
  const card = cardNoMap.get("BSTH08-XX01")!;
  it("導技: divineSkills(coreCost:4, 相手のアタックステップ) で trash 除外 + prevent_life_damage(battle) / 導域は白シンボル3固定 override", () => {
    // 導技 = grandwalkerData.divineSkills (memory project_divine_skill_model_target_maxuses)。
    // coreCost:4 でエンジンが自カードコア4個を支払い、timing { step:"attack", whose:"opponent" }
    //   で「相手のアタックステップ」中のみ提示。
    // 効果は search_zone trash→removed_from_game (mandatory:true「除外する」終止形) と、
    //   conditional_cost で続く prevent_life_damage(battle)。
    // search_zone destination:"removed_from_game" は 2026-06-28 lane で executeReturnFromTrash と
    // PendingZoneSelection / return_from_trash apply に追加した新枝。
    expect(card.grandwalkerData?.divineSkills).toBeDefined();
    const skills = card.grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.label).toBe("guided_skill");
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "opponent",
      mode: "flash",
    });
    expect(skill.minLevel).toBe(1);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once_per_name");
    expect(skill.effects).toHaveLength(1);
    const eff = skill.effects![0]!;
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.steps).toHaveLength(2);
    const sz = eff.steps[0]!.action;
    expect(sz.kind).toBe("search_zone");
    if (sz.kind === "search_zone") {
      expect(sz.zone).toBe("trash");
      expect(sz.destination).toBe("removed_from_game");
      expect(sz.mandatory).toBe(true);
      expect(sz.filter).toEqual({
        tribes: ["幻想"],
        colors: ["white", "blue"],
      });
    }
    const prev = eff.steps[1]!.action;
    // prevent_life_damage は consumer 未配線 silent disabled のため life_damage_interception を使う。
    expect(prev.kind).toBe("life_damage_interception");
    if (prev.kind === "life_damage_interception") {
      expect(prev.mode).toBe("replace");
      expect(prev.cause).toBe("any");
      expect(prev.duration).toEqual({ scope: "battle" });
    }
    expect(eff.steps[1]!.connector).toBe("conditional_cost");
    // effects[1] は placeholder (textRef のみ)
    const placeholder = card.effects![1]!;
    expect(placeholder.steps).toEqual([]);
    expect(placeholder.timing).toEqual({ kind: "continuous" });
    const zone = card.effects![2]!;
    expect(zone.stub).toBeUndefined();
    expect(zone.timingScope).toEqual({ player: "self", period: "attack" });
    expect(zone.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const o = zone.steps[0]!.action;
    expect(o.kind).toBe("override_properties");
    if (o.kind === "override_properties") {
      expect(o.properties.symbols).toEqual(["white", "white", "white"]);
      expect(o.properties.symbolCountFixed).toBe(true);
      if (o.target.kind === "filter") {
        expect(o.target.filter.minCost).toBe(7);
        expect(o.target.filter.tribes).toEqual(["起幻"]);
        expect(o.target.count).toBe("all");
      }
    }
  });

  it("導技 効果実行: divineSkills.effects[0] を直接 runEffect で実行すると trash→removed_from_game + prevent_life_damage CE 登録 (engine 側でコア4個支払い後のシナリオ)", () => {
    // legal-actions 経由のコア支払いはこのテストではスキップし、divineSkill 内の効果のみ検証。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "miko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0, // コア支払い後の状態を仮定
    });
    const trashCard = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "futo-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self, trashCard],
    };
    const eff = card.grandwalkerData!.divineSkills![0]!.effects![0]!;
    const result = runEffect(state, eff, "miko-1", "alice");
    const updatedTrash = result.cardInstances.find(
      (c) => c.instanceId === "futo-trash"
    )!;
    expect(updatedTrash.zone).toBe("removed_from_game");
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
  });

  it("導技 効果実行: トラッシュ空で search_zone が空 no-op → prevent_life_damage CE 未登録", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "miko-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [self],
    };
    const eff = card.grandwalkerData!.divineSkills![0]!.effects![0]!;
    const result = runEffect(state, eff, "miko-2", "alice");
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(false);
  });

  it("[board] 導技は同名別個体でターン中に共有し、相手側の同名は次ターンに独立して発揮できる", () => {
    const selfFirst = createCardInstance(card, {
      instanceId: "miko-alice-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const selfSecond = createCardInstance(card, {
      instanceId: "miko-alice-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const opponent = createCardInstance(card, {
      instanceId: "miko-bob",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const aliceTrash = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "alice-fantasy-trash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const bobTrash = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "bob-fantasy-trash",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const bobAttacker = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "bob-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 10 }, { deckCount: 10 }],
      }),
      activePlayerId: "bob",
      turnNumber: 2,
      step: "attack",
      window: "flash_before_block",
      battleEntities: [
        {
          entityId: "battle-entity:bob-attacker",
          memberInstanceIds: ["bob-attacker"],
          resolvedBp: 7000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "miko-skill-attack",
        primaryEntityId: "battle-entity:bob-attacker",
        participantEntityIds: ["battle-entity:bob-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:bob-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:bob-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
      cardInstances: [
        selfFirst,
        selfSecond,
        opponent,
        aliceTrash,
        bobTrash,
        bobAttacker,
      ],
    };
    const noRegisteredEffectActions = {
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    };

    const resolveDivineSkill = (
      state: GameState,
      actingPlayerId: string,
      action: ReturnType<typeof getAvailableDivineSkillLegalActions>[number],
      targetInstanceId: string
    ): GameState => {
      const declared = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
        ...noRegisteredEffectActions,
      });
      expect(declared.ok).toBe(true);
      if (!declared.ok) return state;

      let settled = declared.state;
      // 正規の stack 優先権を双方が pass して解決する。宣言レジャーだけを
      // 人為的に残すのではなく、コア支払い・対象選択・効果完走まで同じ経路を通す。
      for (let passes = 0; passes < 8; passes++) {
        const flashWindow = settled.activeAttack?.flashWindowState;
        const priorityPlayerId =
          settled.stackWindow?.priorityPlayerId ??
          settled.preDeclarationStackWindow?.priorityPlayerId ??
          flashWindow?.priorityPlayerId;
        if (!priorityPlayerId) break;
        const expectedPassKind =
          settled.stackWindow !== null
            ? "pass_stack"
            : settled.preDeclarationStackWindow !== null
              ? "pass_pre_declaration_stack"
              : flashWindow?.pendingStackAction !== null
                ? "pass_battle_flash"
                : null;
        if (!expectedPassKind) break;
        const pass = getLegalActions({
          state: settled,
          actingPlayerId: priorityPlayerId,
          getCardDefinitionById,
          ...noRegisteredEffectActions,
        }).find((candidate) => candidate.kind === expectedPassKind);
        expect(pass).toBeDefined();
        settled = applyLegalAction({
          state: settled,
          action: pass!,
          getCardDefinitionById,
          ...noRegisteredEffectActions,
        }).state;
      }
      expect(settled.stackWindow).toBeNull();
      expect(settled.preDeclarationStackWindow).toBeNull();
      expect(
        settled.activeAttack?.flashWindowState?.pendingStackAction
      ).toBeNull();

      const selectionActions = getLegalActions({
        state: settled,
        actingPlayerId,
        getCardDefinitionById,
        ...noRegisteredEffectActions,
      });
      const chooseZone = selectionActions.find(
        (candidate) => candidate.kind === "resolve_pending_zone_selection"
      );
      if (chooseZone && chooseZone.kind === "resolve_pending_zone_selection") {
        expect(
          settled.pendingZoneSelection?.candidateCardInstanceIds
        ).toContain(targetInstanceId);
        return applyLegalAction({
          state: settled,
          action: chooseZone,
          selectedZoneCardIds: [targetInstanceId],
          getCardDefinitionById,
          ...noRegisteredEffectActions,
        }).state;
      }
      const chooseTarget = selectionActions.find(
        (candidate) => candidate.kind === "resolve_pending_effect_target"
      );
      // 適格なトラッシュが一意なら通常の解決器は選択 prompt を開かず自動選択する。
      // その場合も、実際に指定のカードが除外されていることを確認してから返す。
      if (!chooseTarget) {
        expect(
          settled.cardInstances.find(
            (instance) => instance.instanceId === targetInstanceId
          )?.zone
        ).toBe("removed_from_game");
        return settled;
      }
      if (chooseTarget.kind !== "resolve_pending_effect_target") return settled;
      expect(chooseTarget.candidateTargetInstanceIds).toContain(
        targetInstanceId
      );
      return applyLegalAction({
        state: settled,
        action: chooseTarget,
        targetInstanceIds: [targetInstanceId],
        getCardDefinitionById,
        ...noRegisteredEffectActions,
      }).state;
    };

    const initialActions = getAvailableDivineSkillLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(initialActions.map((action) => action.sourceInstanceId)).toEqual([
      "miko-alice-first",
      "miko-alice-second",
    ]);

    const afterAliceSkill = resolveDivineSkill(
      initial,
      "alice",
      initialActions[0]!,
      "alice-fantasy-trash"
    );
    expect(afterAliceSkill.usedDivineSkillKeysThisTurn).toEqual([
      "alice:BSTH08-XX01:0",
    ]);
    const aliceLifeBefore = getPlayerLifeCoreCount(
      afterAliceSkill.players.find((player) => player.id === "alice")!
    );
    const intercepted = resolveLifeDamage(
      afterAliceSkill,
      "alice",
      1,
      [],
      {
        cause: "battle",
        actingPlayerId: "bob",
      },
      getCardDefinitionById
    );
    expect(
      getPlayerLifeCoreCount(
        intercepted.players.find((player) => player.id === "alice")!
      )
    ).toBe(aliceLifeBefore);
    expect(
      afterAliceSkill.cardInstances.find(
        (instance) => instance.instanceId === "alice-fantasy-trash"
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterAliceSkill.activeContinuousEffects.some(
        (effect) =>
          effect.sourceInstanceId === "miko-alice-first" &&
          effect.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
    expect(
      getAvailableDivineSkillLegalActions({
        state: afterAliceSkill,
        actingPlayerId: "alice",
        getCardDefinitionById,
      })
    ).toEqual([]);

    // 実際の end -> start 遷移でターン限りのレジャーをリセットする。
    // 「他プレイヤーに移ったのに前ターンの台帳を合成する」偽状態は用いない。
    let aliceTurn = advanceStep(
      {
        ...afterAliceSkill,
        step: "end",
        window: "none",
        activeAttack: null,
        battleEntities: [],
      },
      getCardDefinitionById,
      () => []
    );
    expect(aliceTurn.activePlayerId).toBe("alice");
    expect(aliceTurn.step).toBe("start");
    expect(aliceTurn.usedDivineSkillKeysThisTurn).toEqual([]);
    // start -> core -> draw -> refresh -> main -> attack も正規 step 遷移で進める。
    for (
      let advances = 0;
      aliceTurn.step !== "attack" && advances < 12;
      advances++
    ) {
      aliceTurn = advanceStep(aliceTurn, getCardDefinitionById, () => []);
    }
    expect(aliceTurn.step).toBe("attack");

    const aliceAttacker = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobOpportunity: GameState = {
      ...aliceTurn,
      window: "flash_before_block",
      cardInstances: [...aliceTurn.cardInstances, aliceAttacker],
      battleEntities: [
        {
          entityId: "battle-entity:alice-attacker",
          memberInstanceIds: ["alice-attacker"],
          resolvedBp: 7000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "alice-next-turn-attack",
        primaryEntityId: "battle-entity:alice-attacker",
        participantEntityIds: ["battle-entity:alice-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: null,
        },
      },
    };
    const bobActions = getAvailableDivineSkillLegalActions({
      state: bobOpportunity,
      actingPlayerId: "bob",
      getCardDefinitionById,
    });
    expect(bobActions.map((action) => action.sourceInstanceId)).toEqual([
      "miko-bob",
    ]);
    const afterBobSkill = resolveDivineSkill(
      bobOpportunity,
      "bob",
      bobActions[0]!,
      "bob-fantasy-trash"
    );
    expect(afterBobSkill.usedDivineSkillKeysThisTurn).toEqual([
      "bob:BSTH08-XX01:0",
    ]);
    expect(
      afterBobSkill.cardInstances.find(
        (instance) => instance.instanceId === "miko-bob"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      afterBobSkill.cardInstances.find(
        (instance) => instance.instanceId === "bob-fantasy-trash"
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterBobSkill.activeContinuousEffects.some(
        (effect) =>
          effect.sourceInstanceId === "miko-bob" &&
          effect.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
  });

  it("導域 実行: 印字Lv2の4コアで起幻・本来コスト7以上を白3シンボルに固定する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "miko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    // BSTH08-M01 物部 布都: 白 / コスト7 / 起幻 スピリット → 対象
    const spirit = createCardInstance(cardNoMap.get("BSTH08-M01")!, {
      instanceId: "futo-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["futo-brave"],
    });
    const braveDef = cardNoMap.get("BSGE01-C05")!;
    const brave = createCardInstance(braveDef, {
      instanceId: "futo-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      attachedToInstanceId: "futo-1",
    });
    const lowCostWhiteDef = cardNoMap.get("BSTH08-C07")!;
    const lowCostWhite = createCardInstance(lowCostWhiteDef, {
      instanceId: "low-cost-white-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, spirit, brave, lowCostWhite],
    };
    const zoneEffect = card.effects![2]!;
    const result = runEffect(state, zoneEffect, "miko-1", "alice");
    const override = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "override_properties"
    );
    expect(override?.targetInstanceId).toBeUndefined();
    expect(override?.targetFilter).toMatchObject({
      player: "self",
      category: ["spirit"],
      colors: ["white"],
      tribes: ["起幻"],
      minCost: 7,
      costBasis: "printed",
    });
    const withExternalSymbols: GameState = {
      ...result,
      activeContinuousEffects: [
        ...result.activeContinuousEffects,
        symbolAdditionCE("futo-1", "purple"),
      ],
    };
    expect(
      getEffectiveSymbols(
        withExternalSymbols,
        withExternalSymbols.cardInstances.find(
          (c) => c.instanceId === "futo-1"
        )!,
        cardNoMap.get("BSTH08-M01")!,
        getCardDefinitionById
      )
    ).toEqual(["white", "white", "white"]);
    expect(
      getCombinedUnitSymbols(
        withExternalSymbols,
        withExternalSymbols.cardInstances.find(
          (c) => c.instanceId === "futo-1"
        )!,
        cardNoMap.get("BSTH08-M01")!,
        getCardDefinitionById
      )
    ).toEqual(["white", "white", "white"]);
    expect(
      getEffectiveSymbols(
        withExternalSymbols,
        withExternalSymbols.cardInstances.find(
          (c) => c.instanceId === "low-cost-white-1"
        )!,
        lowCostWhiteDef,
        getCardDefinitionById
      )
    ).toEqual(["white"]);
  });
});

describe("BSTH08-X02 [神霊廟]封獣 ぬえ", () => {
  const card = cardNoMap.get("BSTH08-X02")!;
  it("アタック時 デッキ破棄 DynamicCount(count_value×5)", () => {
    const a = card.effects![0]!.steps[0]!.action;
    if (
      a.kind === "move_card" &&
      typeof a.count === "object" &&
      "source" in a.count
    ) {
      expect(a.count.source).toEqual({ kind: "count_value", player: "self" });
      expect(a.count.multiplier).toBe(5);
    }
  });
});

describe("BSTH08-M01/M02 超重装甲 behaviour", () => {
  // BSTH08-M01 物部 布都 (赤/緑/白 限定免疫) を場に出して effect_immunity CE を登録し、
  // 発生源の colors で免疫が成立/不成立になることを確認する。
  function setUpMutsubu() {
    const card = cardNoMap.get("BSTH08-M01")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "futo-x",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    // effects[1] = 超重装甲 (continuous effect_immunity)
    const next = runEffect(state, card.effects![1]!, "futo-x", "alice");
    return { state: next, self };
  }

  it("BSTH08-M01 [赤/緑/白]: 赤発生源は免疫、青発生源は受ける", () => {
    const { state, self } = setUpMutsubu();
    const target = state.cardInstances.find((c) => c.instanceId === "futo-x")!;
    const redSource: CardDefinition = {
      ...self,
      cardNo: "TEST-RED",
      colors: ["red"],
      printedColors: ["red"],
    } as unknown as CardDefinition;
    const blueSource: CardDefinition = {
      ...self,
      cardNo: "TEST-BLUE",
      colors: ["blue"],
      printedColors: ["blue"],
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: redSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(state, target, "bob", "none", {
        definition: blueSource,
      })
    ).toBe(false);
  });

  it("BSTH08-M02 [紫/黄/青]: 青発生源は免疫、赤発生源は受ける", () => {
    const card = cardNoMap.get("BSTH08-M02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tojiko-x",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const next = runEffect(state, card.effects![1]!, "tojiko-x", "alice");
    const target = next.cardInstances.find((c) => c.instanceId === "tojiko-x")!;
    const blueSource: CardDefinition = {
      ...self,
      cardNo: "TEST-BLUE",
      colors: ["blue"],
      printedColors: ["blue"],
    } as unknown as CardDefinition;
    const redSource: CardDefinition = {
      ...self,
      cardNo: "TEST-RED",
      colors: ["red"],
      printedColors: ["red"],
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: blueSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: redSource,
      })
    ).toBe(false);
  });

  it("BSTH08-X03 [全6色]: 赤発生源は免疫、無色発生源(colors=[])は受ける", () => {
    const card = cardNoMap.get("BSTH08-X03")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "mamizou-x",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const next = runEffect(state, card.effects![0]!, "mamizou-x", "alice");
    const target = next.cardInstances.find(
      (c) => c.instanceId === "mamizou-x"
    )!;
    const redSource: CardDefinition = {
      ...self,
      cardNo: "TEST-RED",
      colors: ["red"],
      printedColors: ["red"],
    } as unknown as CardDefinition;
    const colorlessSource: CardDefinition = {
      ...self,
      cardNo: "TEST-COLORLESS",
      colors: [],
      printedColors: [],
    } as unknown as CardDefinition;
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: redSource,
      })
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(next, target, "bob", "none", {
        definition: colorlessSource,
      })
    ).toBe(false);
  });
});

describe("BSTH08-X03 二ツ岩 マミゾウ", () => {
  const card = cardNoMap.get("BSTH08-X03")!;
  it("超重装甲(6色) sourceScope.colors / アタック時 send_to_deck DynamicCount", () => {
    const immune = card.effects![0]!;
    expect(immune.stub).toBeUndefined();
    const i = immune.steps[0]!.action;
    expect(i.kind).toBe("effect_immunity");
    if (i.kind === "effect_immunity") {
      // 印字通り 6 色（無色効果はスコープ外＝免疫不成立）。
      expect(i.sourceScope).toEqual({
        colors: ["red", "purple", "green", "white", "yellow", "blue"],
      });
    }
    const a = card.effects![1]!.steps[0]!.action;
    if (
      a.kind === "send_to_deck" &&
      typeof a.target === "object" &&
      "count" in a.target
    ) {
      const count = a.target.count;
      expect(typeof count === "object" && "source" in count).toBe(true);
    }
  });
});

describe("BSTH08-転醒R01(A) 宮古 芳香", () => {
  const card = cardNoMap.get("BSTH08-転醒R01(A)")!;
  it("アタック時 destroy(コスト4以下)+core / 転醒rebirth(3)", () => {
    expect(card.isDoubleSided).toBe(true);
    const e = card.effects![0]!;
    expect(e.executionMode).toBe("optional");
    const d = e.steps[0]!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxCost).toBe(4);
    }
    expect(e.steps[1]!.action.kind).toBe("core_move");
    const rebirth = card.effects![1]!.steps[0]!.action;
    if (rebirth.kind === "rebirth") expect(rebirth.maxCount).toBe(3);
  });
});

describe("BSTH08-転醒R02(A) 夢殿大祀廟", () => {
  const card = cardNoMap.get("BSTH08-転醒R02(A)")!;
  it("treat_as青 / rebirth(3) / count3以下の召喚時 suppress / アタックステップ開始時 core_distribute", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") expect(t.asColor).toBe("blue");
    const suppress = card.effects![2]!;
    expect(suppress.stub).toBeUndefined();
    expect(suppress.condition).toEqual([
      { kind: "count_value", player: "self", max: 3 },
    ]);
    expect(card.effects![1]!.timing).toMatchObject({
      kind: "game_event",
      event: ["exhaust", "recover"],
    });
    expect(suppress.steps.map((step) => step.action.kind)).toEqual([
      "suppress_effect",
      "suppress_effect",
    ]);
    const phase = card.effects!.find((e) => e.timing.kind === "phase")!;
    expect(phase.steps[0]!.action.kind).toBe("core_distribute");
    if (phase.timing.kind === "phase") {
      expect(phase.timing.step).toBe("attack");
      expect(phase.timing.subPhase).toBe("start");
    }
  });
});

describe("BSTH08-転醒R02(B) 神霊廟", () => {
  const front = cardNoMap.get("BSTH08-転醒R02(A)")!;
  const back = cardNoMap.get("BSTH08-転醒R02(B)")!;

  it("転醒時の起幻白/青回収と、メイン終了時の通常配置型逆転醒を配線する", () => {
    const rebirth = back.effects![0]!;
    expect(rebirth.timing).toEqual({ kind: "card_event", event: "rebirth" });
    const reveal = rebirth.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(2);
      expect(reveal.picks).toEqual([
        {
          count: 1,
          filter: { colors: ["blue", "white"], tribes: ["起幻"] },
          mandatory: true,
          destination: "hand",
        },
      ]);
      expect(reveal.remainder).toBe("trash");
    }
    const reverse = back.effects![1]!;
    expect(reverse.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "self",
      subPhase: "end",
    });
    expect(reverse.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(reverse.steps[0]!.action).toEqual({
      kind: "reverse_rebirth",
      mode: "summon",
    });
  });

  it("転醒後の公開効果を解決すると、対象1枚は手札・残りはトラッシュになる", () => {
    const source = createCardInstance(front, {
      instanceId: "mausoleum-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
    });
    const eligible = createCardInstance(cardNoMap.get("BSTH08-C02")!, {
      instanceId: "eligible-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const remainder = createCardInstance(cardNoMap.get("BSDB01-C01")!, {
      instanceId: "remainder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, eligible, remainder],
      playerOverrides: [{ deckCount: 2 }, {}],
    });
    const reborn = executeRebirth(
      initial,
      "alice",
      { kind: "rebirth", maxCount: 3, triggerDescription: "test" },
      source.instanceId,
      getCardDefinitionById,
      "test:bsth08-cards:1554"
    );
    expect(
      reborn.cardInstances.find((card) => card.instanceId === source.instanceId)
        ?.definitionId
    ).toBe("BSTH08-転醒R02(B)");
    expect(
      reborn.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);

    const afterReveal = runEffect(
      reborn,
      back.effects![0]!,
      source.instanceId,
      "alice"
    );
    const pick = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pick).toBeDefined();
    expect(pick?.canSkip).toBe(false);
    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pick!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        selectedDeckRevealCardIds: [],
      })
    ).toThrow("Deck reveal pick requires 1 selection(s); got 0");

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      selectedDeckRevealCardIds: [eligible.instanceId],
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === eligible.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === remainder.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("公開に適格カードがなければ選択を強制せず、公開カードをトラッシュに置く", () => {
    const source = createCardInstance(front, {
      instanceId: "mausoleum-no-match",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
    });
    const first = createCardInstance(cardNoMap.get("BSDB01-C01")!, {
      instanceId: "no-match-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const second = createCardInstance(cardNoMap.get("BSDB01-C02")!, {
      instanceId: "no-match-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, first, second],
      playerOverrides: [{ deckCount: 2 }, {}],
    });
    const reborn = executeRebirth(
      initial,
      "alice",
      { kind: "rebirth", maxCount: 3, triggerDescription: "test" },
      source.instanceId,
      getCardDefinitionById,
      "test:bsth08-cards:1636"
    );
    const afterReveal = runEffect(
      reborn,
      back.effects![0]!,
      source.instanceId,
      "alice"
    );
    const pick = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pick).toBeDefined();
    expect(pick?.candidateCardInstanceIds).toEqual([]);
    expect(pick?.canSkip).toBe(true);

    const resolved = applyLegalAction({
      state: afterReveal,
      action: pick!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      selectedDeckRevealCardIds: [],
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === first.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === second.instanceId
      )?.zone
    ).toBe("trash");
  });
});
