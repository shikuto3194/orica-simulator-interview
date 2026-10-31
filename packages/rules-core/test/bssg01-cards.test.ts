import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSSG01 (戦姫絶唱シンフォギア-切歌＆調-) カードの effects 検証テスト。
 * 装者／聖詠／煌臨中心。
 * draw / core_move / deck_reveal / exhaust / destroy / move_card /
 * prevent_battle / effect_immunity / end_attack_step / bp_modify /
 * 複数色 treat_as（軽減/シンボル ×5）の確定効果は DSL 変換済み。
 * 煌臨（フラッシュ【煌臨：…＆コスト4以上】）は CardDefinition.adventData で表現
 * （M03/M04/X01/X02/X04/X05。コスト4以上=minCost:4、名前条件は AdventCondition.cardNames
 * 未実装で未表現＝P3-89 残タスク）。
 * 待機状態の同名1体制限・聖詠（フィールド⇄手札入れ替え）・装者/錬金術師
 * デッキオープン置換・任意コア配置の離脱残置（stay_on_field にコア配置パラメータ無し）・
 * スタック発揮制限・ミラージュ・host 側煌臨許可付与（M01/M02）・多重煌臨（X03）・
 * 疲労状態 filter/コア数 filter/月読在場-20000 は基盤/DSL 未対応のため per-effect stub
 * （doc 行引用付き）。X04「本来のBP」/破壊数の割り算は bpBasis:"printed" +
 * DynamicCount.divisor + destroy 用 numericAmount(engine-drain-claude-explore) で解消済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  executeEffect,
  flushPendingLeaves,
  buildMagicLookup,
  getEffectiveBp,
  getLegalActions,
  recordEffectUsageIfLimited,
} from "../src";
import {
  canSummonUltimate,
  executeReevaluationCheck,
  getCandidateTargetInstanceIds,
} from "../src/legal/legal-actions-shared";
import {
  generateBattleImmediateEffectRegistrations,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  generateFieldCardEffectRegistrations,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { findRevealedEffect } from "../src/effect/structured-effect-interpreter";
import {
  collectAndQueueTriggerReactions,
  isRegisteredLeaveFieldPreFlushEffect,
} from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import {
  resolveDeferredMagicStack,
  useMagicCardWithoutPayingCostAsAction,
} from "../src/mechanics/magic-system";
import type {
  ActiveStack,
  CardDefinition,
  CardCostPaymentSource,
  ContinuousEffect,
  GameState,
  RecordedEffectUsage,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  choiceIndex?: number,
  targetInstanceIds?: string[],
  targetStepId?: string,
  recordedUsage?: RecordedEffectUsage,
  payCostPaymentSources?: CardCostPaymentSource[]
) {
  return acceptOptionalSteps(
    executeEffect({
      chainId: "test:bssg01-cards:90",
      state,
      effect,
      sourceInstanceId,
      actingPlayerId,
      getCardDefinitionById,
      ...(choiceIndex !== undefined ? { choiceIndex } : {}),
      ...(targetInstanceIds ? { targetInstanceIds } : {}),
      ...(targetStepId !== undefined ? { targetStepId } : {}),
      ...(recordedUsage !== undefined ? { recordedUsage } : {}),
      ...(payCostPaymentSources !== undefined ? { payCostPaymentSources } : {}),
    }),
    getCardDefinitionById,
    { targetInstanceIds, targetStepId, choiceIndex, payCostPaymentSources }
  );
}

describe("BSSG01-C01 暁 切歌", () => {
  const c = card("BSSG01-C01");
  it("uniqueness stub / 召喚時 ボイド→自身コア + 装者デッキオープン / 効果不可+アタブロ不可 / 聖詠 実装済み", () => {
    // 同名フィールド唯一性は field_name_uniqueness で実装済み（旧 stub 解消）。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");

    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
    });
    const reveal = summon.steps[1]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    // 「さらに、〔ターンに1回：同名〕」は前段のコア配置ではなく、後段の
    // デッキオープンだけを制限する。effect-level へ置くと二体目のコア配置まで
    // 不当に止まるため、step carrier でなければならない。
    expect(summon.usageLimit).toBeUndefined();
    expect(summon.steps[1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    if (reveal.kind === "deck_reveal") {
      expect(reveal.picks[0]!.filter!.tribes).toEqual(["装者"]);
      expect(reveal.remainder).toBe("bottom");
    }

    const cont = c.effects![2]!;
    expect(cont.steps[0]!.action.kind).toBe("effect_immunity");
    const pb = cont.steps[1]!.action;
    expect(pb.kind).toBe("prevent_battle");
    if (pb.kind === "prevent_battle") {
      expect(pb.restriction).toEqual(["attack", "block"]);
    }

    const song = c.effects![3]!;
    expect(song.stub).toBeUndefined();
    expect(song.timing).toEqual({
      kind: "phase",
      step: "attack",
      subPhase: "start",
      whose: "either",
    });
    expect(song.executionMode).toBe("optional");
    expect(song.steps[0]!.action).toEqual({
      kind: "queue_field_hand_swap",
      effectScope: "shouei",
      incomingFilter: {
        category: ["spirit"],
        cardName: "self",
        minCost: 4,
        maxCost: 5,
      },
      enterRecovered: true,
    });
    expect(song.steps[0]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    expect(song.steps[1]!.action).toMatchObject({
      kind: "queue_field_hand_swap",
      enterRecovered: false,
    });
    expect(song.steps[1]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
        minCount: 0,
        maxCount: 0,
      },
    ]);
  });

  it("召喚時 実行: ボイドのコア1個が自身へ移動", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "kirika-1",
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
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 3 } : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "kirika-1", "alice");
    const inst = result.cardInstances.find((c) => c.instanceId === "kirika-1")!;
    expect(inst.normalCoreCount).toBe(2);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(2);
  });

  it("同名の二体目が同ターンに再登場しても前段コア配置は解決し、後段デッキオープンだけを止める", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const kirika1 = createCardInstance(c, {
      instanceId: "kirika-usage-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const kirika2 = createCardInstance(c, {
      instanceId: "kirika-usage-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckCards = ["a", "b", "c"].map((suffix) =>
      createCardInstance(c, {
        instanceId: `kirika-usage-deck-${suffix}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [kirika1, kirika2, ...deckCards],
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, voidNormalCoreCount: 4, deckCount: 3 }
          : player
      ),
    };

    const first = runEffect(state, c.effects![1]!, "kirika-usage-1", "alice");
    expect(
      first.cardInstances.find((card) => card.instanceId === "kirika-usage-1")
        ?.normalCoreCount
    ).toBe(2);
    expect(first.pendingDeckReveal).not.toBeNull();
    const revealAction = getLegalActions({
      state: first,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(revealAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: first,
      action: revealAction!,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["kirika-usage-deck-a"],
    }).state;
    const orderAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    const afterFirst = applyLegalAction({
      state: afterPick,
      action: orderAction!,
      getCardDefinitionById,
      deckRevealRemainderOrder: orderAction!.remainingCardInstanceIds,
    }).state;
    expect(afterFirst.pendingDeckReveal).toBeNull();

    // 同名1体制限を破らないよう、一体目が離れた後に二体目を召喚した盤面を作る。
    // 実際の離脱処理と召喚時配置でコアを戻して1個を置いた結果だけを、この回帰の
    // 焦点である使用制限の継続確認へ引き渡す。
    const afterFirstLeavesAndSecondSummons: GameState = {
      ...afterFirst,
      cardInstances: afterFirst.cardInstances.map((card) =>
        card.instanceId === "kirika-usage-1"
          ? { ...card, zone: "trash" as const, normalCoreCount: 0 }
          : card.instanceId === "kirika-usage-2"
            ? { ...card, zone: "field" as const, normalCoreCount: 1 }
            : card
      ),
      players: afterFirst.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              reserveNormalCoreCount: player.reserveNormalCoreCount + 2,
            }
          : player
      ),
    };

    const afterSecond = runEffect(
      afterFirstLeavesAndSecondSummons,
      c.effects![1]!,
      "kirika-usage-2",
      "alice"
    );
    expect(
      afterSecond.cardInstances.find(
        (card) => card.instanceId === "kirika-usage-2"
      )?.normalCoreCount
    ).toBe(2);
    expect(
      afterSecond.players.find((player) => player.id === "alice")
        ?.voidNormalCoreCount
    ).toBe(2);
    expect(afterSecond.pendingDeckReveal).toBeNull();
    expect(afterSecond.log).toContain(
      "effect:step-usage-exhausted:kirika-usage-2:1:1"
    );
  });

  it("聖詠 実行: 「月読 調」がいないと回復状態を強制せず入れ替える（盤面変化）", () => {
    const song = c.effects![3]!;
    const kirikaLv4: CardDefinition = {
      ...c,
      cardNo: "BSSG01-C01-LV4-TEST",
      cost: 4,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === kirikaLv4.cardNo ? kirikaLv4 : getCardDefinitionById(id);
    const fieldKirika = createCardInstance(c, {
      instanceId: "kirika-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const handKirika = createCardInstance(kirikaLv4, {
      instanceId: "kirika-hand-4",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "attack",
      window: "step_start",
      cardInstances: [fieldKirika, handKirika],
    };
    const queued = executeEffect({
      chainId: "test:bssg01-cards:352",
      state,
      effect: song,
      sourceInstanceId: "kirika-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    // 「月読 調」不在: step[0](enterRecovered:true)は condition 不成立でスキップ、
    // step[1](enterRecovered:false)のみ pending を積む。
    expect(queued.pendingFieldHandSwapChoice).not.toBeNull();
    expect(queued.pendingFieldHandSwapChoice!.enterRecovered).toBe(false);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-field-hand-no-partner",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: queued.pendingFieldHandSwapChoice!.pendingId,
        sourceInstanceId: "kirika-field",
        sourceCardNo: c.cardNo,
        incomingCardInstanceId: "kirika-hand-4",
        incomingCardNo: kirikaLv4.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const incoming = result.cardInstances.find(
      (x) => x.instanceId === "kirika-hand-4"
    )!;
    expect(incoming.zone).toBe("field");
    // Q5846: 回復指定のない入替は、場のスピリットの疲労状態を引き継ぐ。
    expect(incoming.exhaustState).toBe("exhausted");
  });

  it("聖詠 実行: 「月読 調」がいると回復状態で入れ替える（盤面変化）", () => {
    const song = c.effects![3]!;
    const kirikaLv4: CardDefinition = {
      ...c,
      cardNo: "BSSG01-C01-LV4-TEST-2",
      cost: 4,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === kirikaLv4.cardNo ? kirikaLv4 : getCardDefinitionById(id);
    const fieldKirika = createCardInstance(c, {
      instanceId: "kirika-field-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handKirika = createCardInstance(kirikaLv4, {
      instanceId: "kirika-hand-4b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      exhaustState: "exhausted",
    });
    const shirabe = createCardInstance(card("BSSG01-C02"), {
      instanceId: "shirabe-partner",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "attack",
      window: "step_start",
      cardInstances: [fieldKirika, handKirika, shirabe],
    };
    const queued = executeEffect({
      chainId: "test:bssg01-cards:427",
      state,
      effect: song,
      sourceInstanceId: "kirika-field-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(queued.pendingFieldHandSwapChoice).not.toBeNull();
    expect(queued.pendingFieldHandSwapChoice!.enterRecovered).toBe(true);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-field-hand-partner",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: queued.pendingFieldHandSwapChoice!.pendingId,
        sourceInstanceId: "kirika-field-2",
        sourceCardNo: c.cardNo,
        incomingCardInstanceId: "kirika-hand-4b",
        incomingCardNo: kirikaLv4.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const incoming = result.cardInstances.find(
      (x) => x.instanceId === "kirika-hand-4b"
    )!;
    expect(incoming.zone).toBe("field");
    expect(incoming.exhaustState).toBe("recovered");
  });
});

describe("BSSG01-C02 月読 調", () => {
  const c = card("BSSG01-C02");
  it("召喚時 draw + 装者デッキオープン / 効果不可+アタブロ不可 / 聖詠 実装済み", () => {
    const summon = c.effects![1]!;
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    expect(summon.steps[1]!.action.kind).toBe("deck_reveal");
    expect(c.effects![2]!.steps[0]!.action.kind).toBe("effect_immunity");
    const song = c.effects![3]!;
    expect(song.stub).toBeUndefined();
    expect(song.timing).toEqual({
      kind: "phase",
      step: "attack",
      subPhase: "start",
      whose: "either",
    });
    expect(song.steps[0]!.action).toMatchObject({
      kind: "queue_field_hand_swap",
      enterRecovered: true,
    });
    expect(song.steps[0]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
      },
    ]);
    expect(song.steps[1]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
        minCount: 0,
        maxCount: 0,
      },
    ]);
  });

  it("召喚時 実行: 1枚ドロー", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "shirabe-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSG01-C01"), {
      instanceId: "deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, deckCard],
    };
    const result = runEffect(state, c.effects![1]!, "shirabe-1", "alice");
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand.length).toBe(1);
  });

  it("聖詠 実行: 「暁 切歌」がいると回復状態で入れ替える（盤面変化）", () => {
    const song = c.effects![3]!;
    const shirabeLv5: CardDefinition = {
      ...c,
      cardNo: "BSSG01-C02-LV5-TEST",
      cost: 5,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === shirabeLv5.cardNo ? shirabeLv5 : getCardDefinitionById(id);
    const fieldShirabe = createCardInstance(c, {
      instanceId: "shirabe-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handShirabe = createCardInstance(shirabeLv5, {
      instanceId: "shirabe-hand-5",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      exhaustState: "exhausted",
    });
    const kirika = createCardInstance(card("BSSG01-C01"), {
      instanceId: "kirika-partner",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      window: "step_start",
      cardInstances: [fieldShirabe, handShirabe, kirika],
    };
    const queued = executeEffect({
      chainId: "test:bssg01-cards:565",
      state,
      effect: song,
      sourceInstanceId: "shirabe-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(queued.pendingFieldHandSwapChoice!.enterRecovered).toBe(true);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-field-hand-shirabe",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: queued.pendingFieldHandSwapChoice!.pendingId,
        sourceInstanceId: "shirabe-field",
        sourceCardNo: c.cardNo,
        incomingCardInstanceId: "shirabe-hand-5",
        incomingCardNo: shirabeLv5.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    const incoming = result.cardInstances.find(
      (x) => x.instanceId === "shirabe-hand-5"
    )!;
    expect(incoming.zone).toBe("field");
    expect(incoming.exhaustState).toBe("recovered");
    const outgoing = result.cardInstances.find(
      (x) => x.instanceId === "shirabe-field"
    )!;
    expect(outgoing.zone).toBe("hand");
  });
});

describe("BSSG01-C03 暁 切歌「イガリマ-GX-」", () => {
  const c = card("BSSG01-C03");
  it("召喚時 自身コア + 月読条件で相手疲労 / 離脱残置 stub / Lv2 アタブロ時 自身コア", () => {
    const summon = c.effects![1]!;
    expect(summon.steps[0]!.action).toMatchObject({
      kind: "core_move",
      to: { kind: "this_card" },
    });
    const ex = summon.steps[1]!;
    expect(ex.action.kind).toBe("exhaust");
    expect(ex.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);

    // [5,6] 離脱残置: stay_on_field + core_distribute (同じ状態で残せる)。
    const stayEff = c.effects![2]!;
    expect(stayEff.stub).toBeUndefined();
    expect(stayEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(stayEff.steps[0]!.action.kind).toBe("stay_on_field");

    const atk = c.effects![3]!;
    expect(atk.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(atk.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(atk.steps[0]!.action).toMatchObject({
      kind: "core_move",
      to: { kind: "this_card" },
    });
  });

  it("召喚時 実行: 月読がいれば相手スピリットが疲労", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "gx-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const tsukuyomi = createCardInstance(card("BSSG01-C02"), {
      instanceId: "tsukuyomi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, tsukuyomi, enemy],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 3 } : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "gx-1", "alice");
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    )!;
    expect(enemyAfter.exhaustState).toBe("exhausted");
  });
});

describe("BSSG01-C04 月読 調「シャルシャガナ-GX-」", () => {
  const c = card("BSSG01-C04");
  it("召喚時 draw + 暁条件でBP7000以下破壊 / Lv2 アタブロ時 draw", () => {
    const summon = c.effects![1]!;
    expect(summon.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    const d = summon.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      expect(d.target.filter.maxBp).toBe(7000);
    }
    expect(summon.steps[1]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
      },
    ]);
    expect(c.effects![3]!.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
  });

  it("召喚時 実行: 暁がいれば相手BP7000以下が leave enqueue", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "gx2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const akatsuki = createCardInstance(card("BSSG01-C01"), {
      instanceId: "akatsuki-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // BSSG01-C01 は Lv1 BP1000 → maxBp 7000 で対象になる。
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "enemy2-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSG01-C02"), {
      instanceId: "deck2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, akatsuki, enemy, deckCard],
    };
    const result = runEffect(state, c.effects![1]!, "gx2-1", "alice");
    expect(
      result.cardInstances.find(
        (e) =>
          e.instanceId === "enemy2-1" &&
          (e.zone === "trash" || e.pendingLeaveKind === "destroy")
      )
    ).toBeDefined();
  });
});

describe("BSSG01-C05 ギアペンダント", () => {
  const c = card("BSSG01-C05");
  it("軽減5色 treat_as / ミラージュ stub / メイン トラッシュ装者2枚を手札へ", () => {
    const treat = c.effects![0]!;
    expect(treat.stub).toBeUndefined();
    expect(treat.steps.length).toBe(5);
    expect(
      treat.steps.map((s) => (s.action as { asColor: string }).asColor)
    ).toEqual(["red", "purple", "green", "white", "yellow"]);
    for (const s of treat.steps) {
      expect(s.action.kind).toBe("treat_as");
      if (s.action.kind === "treat_as") {
        expect(s.action.aspects).toEqual(["reduction_symbol"]);
      }
    }

    expect(c.mirageData).toEqual({ cost: 2, reduction: [] });
    const setEffect = c.effects![1]!;
    expect(setEffect.stub).toBeUndefined();
    expect(setEffect.applicability).toEqual({ zone: "mirage_set" });
    expect(setEffect.timing).toEqual({
      kind: "game_event",
      event: "field_hand_swap",
      effectScope: "shouei",
      player: "self",
    });
    expect(setEffect.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    });
    expect(setEffect.steps[1]!.action).toEqual({ kind: "draw", count: 1 });

    const main = c.effects![2]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    const mv = main.steps[0]!.action;
    // ENGINE-step-optional-zone-pick-pending-selection-NARROW (2026-06-21):
    // 旧 move_card 経路は target を持たないため engine が candidates.slice(0,2)
    // で auto-select していた。原文「2枚を手札に戻す」(終止形=強制) のため
    // search_zone(mandatory:true) 経路へ移行。複数候補時に pendingZoneSelection
    // (canSkip:false) を発行しプレイヤーに2枚を選ばせる。
    expect(mv.kind).toBe("search_zone");
    if (mv.kind === "search_zone") {
      expect(mv.zone).toBe("trash");
      expect(mv.filter!.tribes).toEqual(["装者"]);
      expect(mv.destination).toBe("hand");
      expect(mv.count).toBe(2);
      expect(mv.mandatory).toBe(true);
    }
  });

  it("軽減5色 treat_as 実行: cardStateOnly なので継続効果は登録しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "gear-treat",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const before = state.activeContinuousEffects.length;
    const result = runEffect(state, c.effects![0]!, "gear-treat", "alice");
    expect(
      c.effects![0]!.steps.every(
        (step) =>
          step.action.kind === "treat_as" && step.action.cardStateOnly === true
      )
    ).toBe(true);
    expect(result.activeContinuousEffects.length).toBe(before);
  });

  it("メイン 実行: トラッシュの装者2枚が手札へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // 発動元マジックは手元 (set_aside) に置き、トラッシュ filter に自分が混ざらないようにする。
    const self = createCardInstance(c, {
      instanceId: "gear-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const t1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "t1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const t2 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "t2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, t1, t2],
    };
    const result = runEffect(state, c.effects![2]!, "gear-1", "alice");
    const hand = result.cardInstances.filter(
      (c) =>
        c.ownerPlayerId === "alice" &&
        c.zone === "hand" &&
        (c.instanceId === "t1" || c.instanceId === "t2")
    );
    expect(hand.length).toBe(2);
  });

  // ENGINE-step-optional-zone-pick-pending-selection-NARROW (2026-06-21):
  // トラッシュに装者カードが count(2) より多くあるときは pendingZoneSelection
  // (canSkip:false) でプレイヤーに2枚を選ばせる (旧 move_card 経路は engine 自動選択)。
  it("メイン: 装者カードが3枚以上のとき pendingZoneSelection(canSkip:false) を発行する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "gear-mandatory",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const t1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "trash-sou-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const t2 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "trash-sou-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const t3 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "trash-sou-3",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, t1, t2, t3],
    };
    const result = runEffect(state, c.effects![2]!, "gear-mandatory", "alice");

    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection!.actionKind).toBe("return_from_trash");
    expect(result.pendingZoneSelection!.destination).toBe("hand");
    expect(result.pendingZoneSelection!.maxCount).toBe(2);
    expect(
      result.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(["trash-sou-1", "trash-sou-2", "trash-sou-3"].sort());
    // 原文「2枚を手札に戻す」(終止形=強制) → canSkip:false で空選択を拒否。
    expect(result.pendingZoneSelection!.canSkip).toBe(false);

    // resolve-path: 空選択は throw、有効選択 (2 枚) はそれだけを手札へ移動する。
    expect(() =>
      applyLegalAction({
        state: result,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: [],
        getCardDefinitionById,
      })
    ).toThrow(/cannot be skipped/);

    const resolved = applyLegalAction({
      state: result,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-sou-1", "trash-sou-2"],
      getCardDefinitionById,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "trash-sou-1")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "trash-sou-2")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((x) => x.instanceId === "trash-sou-3")?.zone
    ).toBe("trash");
  });

  // ENGINE-field-hand-swap-trigger: 【聖詠】入れ替え成立 (swap_field_hand) を
  // game_event:field_hand_swap(player:"self") として観測し、セット中のギアペンダントの
  // 【セット中】効果が再発揮される（盤面変化: ボイド→リザーブ+1コア、+1ドロー）。
  it("聖詠入れ替え成立でセット中のギアペンダントがボイド→リザーブ+1コア・+1ドローする", () => {
    const gear = createCardInstance(c, {
      instanceId: "gear-mirage",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "mirage",
    });
    const fieldOut = createCardInstance(card("BSSG01-C01"), {
      instanceId: "swap-out-gear",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handIn = createCardInstance(card("BSSG01-C01"), {
      instanceId: "swap-in-gear",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckCard = createCardInstance(card("BSSG01-C02"), {
      instanceId: "deck-draw-gear",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [gear, fieldOut, handIn, deckCard],
      mirageSetStates: [{ playerId: "alice", cardInstanceId: "gear-mirage" }],
    });
    const state: GameState = {
      ...base,
      pendingFieldHandSwapChoice: {
        pendingId: "test-swap-gear",
        chainId: "test-swap-gear",
        effectScope: "shouei",
        actingPlayerId: "alice",
        sourceInstanceId: "swap-out-gear",
        sourceDefinitionId: card("BSSG01-C01").cardNo,
        incomingCandidateInstanceIds: ["swap-in-gear"],
        enterRecovered: false,
      },
    };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;

    const result = applyLegalAction({
      state,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-gear",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: "test-swap-gear",
        sourceInstanceId: "swap-out-gear",
        sourceCardNo: card("BSSG01-C01").cardNo,
        incomingCardInstanceId: "swap-in-gear",
        incomingCardNo: card("BSSG01-C01").cardNo,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
      getRegisteredBurstActions: buildBurstEffectLookup([c]),
    }).state;

    const pending = result.pendingTriggeredEffects.find(
      (p) => p.eventKind === "field_hand_swap"
    );
    expect(pending).toBeDefined();

    const lookups = {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
      getRegisteredBurstActions: buildBurstEffectLookup([c]),
    };
    const resolveAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_triggered_effect");
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: result,
      action: resolveAction!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    // 誘発効果はスタック窓を開くため、相手が pass するまで解決しない。
    expect(declared.stackWindow).not.toBeNull();
    const resolved = acceptOptionalSteps(
      applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "test:pass-gear-stack",
          can: true,
          reason: "test",
          actingPlayerId: declared.stackWindow!.priorityPlayerId,
        },
        getCardDefinitionById,
        ...lookups,
      }).state,
      getCardDefinitionById,
      lookups
    );

    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount + 1
    );
    expect(aliceAfter.voidNormalCoreCount).toBe(
      aliceBefore.voidNormalCoreCount - 1
    );
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });
});

// ENGINE-field-hand-swap-trigger: 聖詠入れ替え成立 (swap_field_hand) は card_event でも
// 入れ替え先カード自身の召喚時効果を再発揮できる (BSSG01-C03/C04「この効果は、手札から
// 入れ替えたときにも発揮できる」)。
describe("ENGINE-field-hand-swap-trigger", () => {
  it("聖詠入れ替え成立でイガリマ-GXの召喚時効果 (optional) が pendingTriggeredEffects に積まれ、解決後にボイド→自身コア+1される", () => {
    const gx = card("BSSG01-C03");
    const fieldOut = createCardInstance(card("BSSG01-C01"), {
      instanceId: "swap-out-gx",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handIn = createCardInstance(gx, {
      instanceId: "swap-in-gx",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [fieldOut, handIn],
      }),
      pendingFieldHandSwapChoice: {
        pendingId: "test-swap-gx",
        chainId: "test-swap-gx",
        actingPlayerId: "alice",
        sourceInstanceId: "swap-out-gx",
        sourceDefinitionId: card("BSSG01-C01").cardNo,
        incomingCandidateInstanceIds: ["swap-in-gx"],
        enterRecovered: false,
      },
    };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;

    const lookups = {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([gx]),
      getRegisteredBurstActions: buildBurstEffectLookup([gx]),
    };
    const result = applyLegalAction({
      state,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-gx",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: "test-swap-gx",
        sourceInstanceId: "swap-out-gx",
        sourceCardNo: card("BSSG01-C01").cardNo,
        incomingCardInstanceId: "swap-in-gx",
        incomingCardNo: gx.cardNo,
      },
      getCardDefinitionById,
      ...lookups,
    }).state;

    const pending = result.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "field_hand_swap" &&
        p.relatedInstanceId === "swap-in-gx"
    );
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: result,
      action: resolveAction!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    // 誘発効果はスタック窓を開くため、相手が pass するまで解決しない。
    expect(declared.stackWindow).not.toBeNull();
    const resolved = acceptOptionalSteps(
      applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "test:pass-gx-stack",
          can: true,
          reason: "test",
          actingPlayerId: declared.stackWindow!.priorityPlayerId,
        },
        getCardDefinitionById,
        ...lookups,
      }).state,
      getCardDefinitionById,
      lookups
    );

    const swappedInAfter = resolved.cardInstances.find(
      (i) => i.instanceId === "swap-in-gx"
    )!;
    expect(swappedInAfter.zone).toBe("field");
    // 入替元から引き継いだ1個 + 入替時効果でボイドから置いた1個。
    expect(swappedInAfter.normalCoreCount).toBe(2);
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.voidNormalCoreCount).toBe(
      aliceBefore.voidNormalCoreCount - 1
    );
  });

  it("聖詠入れ替え成立でシャルシャガナ-GXの召喚時効果 (optional) が解決後に1枚ドローする", () => {
    const shal = card("BSSG01-C04");
    const fieldOut = createCardInstance(card("BSSG01-C02"), {
      instanceId: "swap-out-shal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // normalCoreCount:1: C04 は自身に召喚時コアを置かない (draw のみ) ため、0 コアのまま
    // 解決すると requiredCores:1 の維持コア不足で resolveEffect 後の SBA が即座に消滅させる
    // (swap_field_hand 自体は本テストの対象外のコア配置メカニズム)。このテストは
    // field_hand_swap トリガー起因の draw 発動だけを検証する。
    const handIn = createCardInstance(shal, {
      instanceId: "swap-in-shal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSG01-C01"), {
      instanceId: "deck-swap-shal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [fieldOut, handIn, deckCard],
      }),
      pendingFieldHandSwapChoice: {
        pendingId: "test-swap-shal",
        chainId: "test-swap-shal",
        actingPlayerId: "alice",
        sourceInstanceId: "swap-out-shal",
        sourceDefinitionId: card("BSSG01-C02").cardNo,
        incomingCandidateInstanceIds: ["swap-in-shal"],
        enterRecovered: false,
      },
    };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;

    const lookups = {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([shal]),
      getRegisteredBurstActions: buildBurstEffectLookup([shal]),
    };
    const result = applyLegalAction({
      state,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-shal",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: "test-swap-shal",
        sourceInstanceId: "swap-out-shal",
        sourceCardNo: card("BSSG01-C02").cardNo,
        incomingCardInstanceId: "swap-in-shal",
        incomingCardNo: shal.cardNo,
      },
      getCardDefinitionById,
      ...lookups,
    }).state;

    const pending = result.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "field_hand_swap" &&
        p.relatedInstanceId === "swap-in-shal"
    );
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: result,
      action: resolveAction!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    const resolved = acceptOptionalSteps(
      applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "test:pass-shal-stack",
          can: true,
          reason: "test",
          actingPlayerId: declared.stackWindow!.priorityPlayerId,
        },
        getCardDefinitionById,
        ...lookups,
      }).state,
      getCardDefinitionById,
      lookups
    );

    const swappedInAfter = resolved.cardInstances.find(
      (i) => i.instanceId === "swap-in-shal"
    )!;
    expect(swappedInAfter.zone).toBe("field");
    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });
});

describe("BSSG01-C06 生きるのを諦めるな！", () => {
  const c = card("BSSG01-C06");
  it("軽減5色 treat_as / フラッシュ end_attack_step(deferTo battle_end) / スタック attackerSelectedTarget", () => {
    const treat = c.effects![0]!;
    expect(treat.stub).toBeUndefined();
    expect(treat.steps.length).toBe(5);
    expect(
      treat.steps.map((s) => (s.action as { asColor: string }).asColor)
    ).toEqual(["red", "purple", "green", "white", "blue"]);
    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.steps[0]!.action.kind).toBe("end_attack_step");
    expect(flash.steps[0]!.deferTo).toBe("battle_end");
    const stack = c.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.stub).toBeUndefined();
    const action = stack.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.attackerSelectedTarget).toBe(true);
      expect(action.mode).toBe("replace");
    }
  });

  it("軽減5色 treat_as 実行: cardStateOnly なので継続効果は登録しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "akirameru-treat",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const before = state.activeContinuousEffects.length;
    const result = runEffect(state, c.effects![0]!, "akirameru-treat", "alice");
    expect(
      c.effects![0]!.steps.every(
        (step) =>
          step.action.kind === "treat_as" && step.action.cardStateOnly === true
      )
    ).toBe(true);
    expect(result.activeContinuousEffects.length).toBe(before);
  });
});

describe("BSSG01-C07 SONG司令室", () => {
  const c = card("BSSG01-C07");
  it("オープン置換 swap disposition(実装) / シンボル5色 treat_as / メイン 装者破棄→2ドロー / スタック制限 stub", () => {
    // [0] 装者/錬金術師効果でオープンされたら手札1枚と入れ替え（swap 型 disposition）。
    expect(c.effects![0]!.cardEventDisposition).toEqual({ kind: "swap" });
    expect(c.effects![0]!.stub).toBeUndefined();

    const treat = c.effects![1]!;
    expect(treat.stub).toBeUndefined();
    expect(treat.steps.length).toBe(5);
    expect(
      treat.steps.map((s) => (s.action as { asColor: string }).asColor)
    ).toEqual(["purple", "green", "white", "yellow", "blue"]);
    for (const s of treat.steps) {
      if (s.action.kind === "treat_as") {
        expect(s.action.aspects).toEqual(["symbol"]);
      }
    }

    const main = c.effects![2]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    const dis = main.steps[0]!.action;
    expect(dis.kind).toBe("discard");
    if (dis.kind === "discard") {
      expect(dis.filter!.tribes).toEqual(["装者", "錬金術師"]);
      expect(dis.filter!.tribesLogic).toBe("or");
    }
    expect(main.steps[1]!.action).toEqual({ kind: "draw", count: 2 });
    expect(main.steps[1]!.connector).toBe("conditional_cost");
    expect(main.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    // P3-75: restrict_stack 実装済み。stub なし。
    const stackRestrict = c.effects![3]!;
    expect(stackRestrict.stub).toBeUndefined();
    expect(stackRestrict.steps[0]!.action.kind).toBe("restrict_stack");
    expect(stackRestrict.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    // 発揮条件: Lv2 + 装者スピリット/アルティメット在場
    expect(stackRestrict.condition).toContainEqual({
      kind: "min_level",
      value: 2,
    });
    expect(stackRestrict.condition).toContainEqual(
      expect.objectContaining({
        kind: "field_has",
        tribes: ["装者"],
      })
    );
  });

  it("メイン 実行: 装者1枚破棄して2枚ドロー", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "song-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCost = createCardInstance(card("BSSG01-C01"), {
      instanceId: "hc-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const d1 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "d1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const d2 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "d2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, handCost, d1, d2],
    };
    const result = runEffect(state, c.effects![2]!, "song-1", "alice");
    const trashed = result.cardInstances.find((c) => c.instanceId === "hc-1")!;
    expect(trashed.zone).toBe("trash");
    const drawn = result.cardInstances.filter(
      (c) =>
        c.zone === "hand" && (c.instanceId === "d1" || c.instanceId === "d2")
    );
    expect(drawn.length).toBe(2);
  });

  it("[legal action] 破棄コストを払える手札がなければ宣言候補に出さない", () => {
    const registrations = generateFieldCardEffectRegistrations(c);
    const registrationIndex = registrations.findIndex(
      (r) => r.effectIndex === 2
    );
    const registration = registrations[registrationIndex];
    expect(registration?.requiredDiscardCost).toEqual({
      sourcePlayer: "self",
      sourceFilter: { tribes: ["装者", "錬金術師"], tribesLogic: "or" },
      amount: 1,
    });

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const song = createCardInstance(c, {
      instanceId: "song-no-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // replay と同様に、手札はあるが装者/錬金術師の破棄コストには使えない。
    const unrelatedHand = createCardInstance(card("BSLH01-R01"), {
      instanceId: "song-unrelated-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [song, unrelatedHand],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "song-no-cost" &&
          action.registrationIndex === registrationIndex
      )
    ).toBe(false);
  });

  it("[legal action] ドロー先のデッキが空なら破棄コスト効果を宣言しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const song = createCardInstance(c, {
      instanceId: "song-empty-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const matchingHand = createCardInstance(card("BSSG01-C01"), {
      instanceId: "song-matching-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 0 } : player
      ),
      cardInstances: [song, matchingHand],
    };

    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
      }).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === song.instanceId
      )
    ).toBe(false);
  });

  it("[legal action] stack 解決後も同一ターンに再発揮候補へ戻さない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const song = createCardInstance(c, {
      instanceId: "song-once-per-turn",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handCost = createCardInstance(card("BSSG01-C01"), {
      instanceId: "song-discard-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deck1 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "song-deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deck2 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "song-deck-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const lookups = {
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
    };
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [song, handCost, deck1, deck2],
    };

    const fieldAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === song.instanceId
    );
    expect(fieldAction).toBeDefined();
    state = applyLegalAction({ state, action: fieldAction!, ...lookups }).state;

    // A single pass closes this response window and resolves the delayed field
    // effect (02_turn-flow-and-timing.md, "スタック解決").
    const passAction = getLegalActions({
      state,
      actingPlayerId: state.stackWindow!.priorityPlayerId,
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();
    state = applyLegalAction({ state, action: passAction!, ...lookups }).state;

    expect(state.stackWindow).toBeNull();
    expect(
      state.cardInstances.find(
        (card) => card.instanceId === handCost.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === song.instanceId
      )
    ).toBe(false);
  });
});

describe("BSSG01-C08 エルフナイン", () => {
  const c = card("BSSG01-C08");
  function makeTrashPlaceState(overrides: Partial<GameState> = {}): GameState {
    const self = createCardInstance(c, {
      instanceId: "elf-trash-place",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      window: "main_step",
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 3 } : p
      ),
      ...overrides,
    };
  }

  function findTrashPlaceAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "place_nexus" && a.sourceInstanceId === "elf-trash-place"
    );
  }

  it("オープン時トラッシュ置換 / トラッシュ配置 / シンボル軽減5色 treat_as / 配置時 装者コスト5以下を場へ / Lv2離脱反応", () => {
    const revealToTrash = c.effects![0]!;
    expect(revealToTrash.stub).toBeUndefined();
    expect(revealToTrash.timing).toEqual({
      kind: "card_event",
      event: "revealed",
    });
    expect(revealToTrash.executionMode).toBe("optional");
    expect(revealToTrash.cardEventDisposition).toEqual({
      kind: "move",
      destination: "trash",
    });
    expect(revealToTrash.condition).toEqual([
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);

    const trashPlace = c.effects![1]!;
    expect(trashPlace.stub).toBeUndefined();
    expect(trashPlace.applicability).toEqual({ zone: ["trash"] });
    expect(trashPlace.timing).toEqual({ kind: "continuous" });
    expect(trashPlace.timingScope).toEqual({
      player: "self",
      period: "main",
    });
    expect(trashPlace.executionMode).toBe("optional");
    expect(trashPlace.steps[0]?.action).toMatchObject({
      kind: "summon",
      normalActionPermission: true,
    });
    expect(trashPlace.steps[0]!.action).toEqual({
      kind: "summon",
      normalActionPermission: true,
      target: { kind: "self" },
    });

    const treat = c.effects![2]!;
    expect(treat.stub).toBeUndefined();
    expect(treat.steps.length).toBe(5);
    expect(
      treat.steps.map((s) => (s.action as { asColor: string }).asColor)
    ).toEqual(["red", "purple", "green", "white", "blue"]);
    for (const s of treat.steps) {
      if (s.action.kind === "treat_as") {
        expect(s.action.aspects).toEqual(["symbol", "reduction_symbol"]);
      }
    }

    const place = c.effects![3]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    const reveal = place.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(4);
      expect(reveal.picks[0]!.filter!.maxCost).toBe(5);
      expect(reveal.picks[0]!.destination).toBe("field");
      expect(reveal.remainder).toBe("bottom");
    }
    expect(place.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const leaveEffect = c.effects![4]!;
    expect(leaveEffect.stub).toBeUndefined();
    expect(leaveEffect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      cause: "opponent_effect",
      triggerFilter: { category: ["spirit", "ultimate"] },
    });
    expect(leaveEffect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(leaveEffect.executionMode).toBe("optional");
    expect(isRegisteredLeaveFieldPreFlushEffect(leaveEffect, "destroy")).toBe(
      true
    );
    expect(
      isRegisteredLeaveFieldPreFlushEffect(leaveEffect, "leave_field")
    ).toBe(true);
    expect(leaveEffect.steps[0]!.action).toEqual({
      kind: "summon",
      target: {
        kind: "from_zone",
        zone: "trash",
        filter: {
          category: ["spirit", "ultimate", "brave"],
          tribes: ["装者"],
          minCost: 4,
          maxCost: 5,
        },
        count: "all",
        includeAdventSource: true,
        restrictToTriggerLeaveAdventSource: true,
      },
      costModifier: "free",
    });
  });

  it("BSSG01-C08: オープン時 optional で選んだ自身をトラッシュへ置く", () => {
    const self = createCardInstance(c, {
      instanceId: "elf-open-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
    });
    const match = findRevealedEffect(
      state,
      self.instanceId,
      c,
      getCardDefinitionById,
      { fromZone: "deck" }
    );
    expect(match).toBeDefined();
    expect(match!.disposition).toEqual({ kind: "move", destination: "trash" });

    const pendingState: GameState = {
      ...state,
      pendingDeckReveal: {
        pendingId: "dr-elf",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [self.instanceId],
        picks: [],
        remainder: "bottom",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [self.instanceId],
        revealedDispositionMap: {
          [self.instanceId]: { kind: "move", destination: "trash" },
        },
      },
    };
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById,
      selectedDeckRevealCardIds: [self.instanceId],
    });
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === self.instanceId)!
        .zone
    ).toBe("trash");
    expect(resolved.pendingDeckReveal).toBeNull();
  });

  it("BSSG01-C08: トラッシュにある自身は自分メインステップに通常コストで配置できる", () => {
    const state = makeTrashPlaceState();
    const lookups = {
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
      getRegisteredBurstActions: buildBurstEffectLookup([c]),
    };
    const action = findTrashPlaceAction(state);
    expect(action).toBeDefined();
    if (!action || action.kind !== "place_nexus") {
      throw new Error("BSSG01-C08 place_nexus action not found");
    }
    expect(action.reason).toBe("legal_place_nexus_by_hand_permission");
    expect(action.finalCost).toBe(3);

    const { state: declared } = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      ...lookups,
    });
    expect(
      declared.cardInstances.find((ci) => ci.instanceId === "elf-trash-place")!
        .zone
    ).toBe("in_use");
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "place_nexus"
    );
    expect(declared.pendingEnterFieldPlacement).toBeNull();
    expect(
      declared.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: declared.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    let resolved = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    if (resolved.pendingEnterFieldPlacement) {
      const placement = getLegalActions({
        state: resolved,
        actingPlayerId: resolved.pendingEnterFieldPlacement.actingPlayerId,
        getCardDefinitionById,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_enter_field_placement");
      expect(placement).toBeDefined();
      resolved = applyLegalAction({
        state: resolved,
        action: placement!,
        enterFieldCorePlacements: [],
        getCardDefinitionById,
        ...lookups,
      }).state;
    }
    expect(
      resolved.cardInstances.find((ci) => ci.instanceId === "elf-trash-place")!
        .zone
    ).toBe("field");
  });

  it("BSSG01-C08: トラッシュ配置は自分メインステップ以外では提示されない", () => {
    expect(
      findTrashPlaceAction(
        makeTrashPlaceState({ activePlayerId: "bob", step: "main" })
      )
    ).toBeUndefined();
    expect(
      findTrashPlaceAction(
        makeTrashPlaceState({ step: "attack", window: "declare_attack" })
      )
    ).toBeUndefined();
    expect(
      findTrashPlaceAction(
        makeTrashPlaceState({
          step: "attack",
          window: "flash_before_block",
          activeAttack: {
            attackId: "attack:elf-negative",
            primaryEntityId: "battle-entity:dummy",
            participantEntityIds: ["battle-entity:dummy"],
            groupMode: "single",
            target: { kind: "player", playerId: "bob" },
            blockAssignments: [],
            symbolResolutionOrder: ["battle-entity:dummy"],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "before_block",
              priorityPlayerId: "alice",
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: "alice",
              pendingStackAction: null,
            },
          } as GameState["activeAttack"],
        })
      )
    ).toBeUndefined();
  });

  it("配置時 実行: 装者コスト5以下スピリットがフィールドへ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "elf-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // BSSG01-C01 は 装者 コスト3 スピリット → 召喚対象。
    const d1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "deck-elf-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, d1],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 3 } : p
      ),
    };
    const result = runEffect(state, c.effects![3]!, "elf-1", "alice");
    // deck_reveal の絞り込みピックは player_choice の pendingDeckReveal を生成する。
    // 候補カードはオープン中 (revealed) になり、選択解決でフィールドへ召喚される。
    expect(result.pendingDeckReveal).not.toBeNull();
    const revealed = result.cardInstances.find(
      (c) => c.instanceId === "deck-elf-1"
    )!;
    expect(revealed.zone).toBe("revealed");
  });

  it("Lv2離脱反応 実行: 相手起因destroyで自分のスピリットが離れ、その煌臨元(コスト4/5装者)がコストなしで場へ (engine-advent-source-leave-summon)", () => {
    const elf = createCardInstance(c, {
      instanceId: "elf-lv2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const hostDef = card("BSSG01-M03");
    const host = createCardInstance(hostDef, {
      instanceId: "leaving-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // createCardInstance は underCards を options から受け取らないため直接代入する
    // (advent-source-field-exit-replacement.test.ts 等の既存パターンと同じ)。
    host.underCards = [
      { cardInstanceId: "advent-src-1", role: "advent_source" as const },
    ];
    const adventSourceDef = card("BSSG01-M02");
    const adventSource = createCardInstance(adventSourceDef, {
      instanceId: "advent-src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [elf, host, adventSource],
    });
    const aliceWithReserve: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 3 } : p
      ),
    };
    const chainId = "elf-leave-chain";
    const afterLeave = queuePendingLeave({
      state: aliceWithReserve,
      instanceId: "leaving-host",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId,
    });
    const lookup = buildTriggeredEffectLookup([c, hostDef]);
    // pre-flush の pending leave 中は、煌臨元はまだ host の下に残っている。
    expect(
      afterLeave.cardInstances.find((i) => i.instanceId === "advent-src-1")
        ?.zone
    ).toBe("field");
    const queued = collectAndQueueTriggerReactions({
      beforeState: aliceWithReserve,
      afterState: afterLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === "leaving-host"
    );
    expect(pending).toBeDefined();
    expect(pending!.eventKind).toBe("destroy");
    expect(pending!.cause).toBe("opponent_effect");
    // 真に新規スコープ: pending leave 中の host からスナップショットされた煌臨元チェーン。
    expect(pending!.adventSourceInstanceIds).toEqual(["advent-src-1"]);

    const lookups = {
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    };
    let readyForTrigger = queued;
    for (
      let guard = 0;
      readyForTrigger.pendingBurstChecks.length > 0;
      guard += 1
    ) {
      if (guard > 8) throw new Error("pendingBurstChecks did not drain");
      const burstAction = getLegalActions({
        state: readyForTrigger,
        actingPlayerId: readyForTrigger.pendingBurstChecks[0]!.actingPlayerId,
        getCardDefinitionById,
        ...lookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_burst_check" ||
          action.kind === "decline_pending_burst_check"
      );
      expect(burstAction).toBeDefined();
      readyForTrigger = applyLegalAction({
        state: readyForTrigger,
        action: burstAction!,
        getCardDefinitionById,
        ...lookups,
      }).state;
    }
    const resolveAction = getLegalActions({
      state: readyForTrigger,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: readyForTrigger,
      action: resolveAction!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    const resolved = acceptOptionalSteps(
      applyLegalAction({
        state: declared,
        action: {
          kind: "pass_stack",
          actionId: "test:pass-elf-leave-stack",
          can: true,
          reason: "test",
          actingPlayerId: declared.stackWindow!.priorityPlayerId,
        },
        getCardDefinitionById,
        ...lookups,
      }).state,
      getCardDefinitionById,
      lookups
    );

    // effect:summon ログでコスト0 (cost=0) 召喚を確認。煌臨元から直接出るため trash 経由ではない。
    const summonLog = resolved.log.find((entry) =>
      entry.startsWith("effect:summon:advent-src-1:")
    );
    expect(summonLog).toContain(":cost=0");
    expect(summonLog).not.toContain(":from=trash:");
    expect(resolved.pendingMultiPlacement).toMatchObject({
      actingPlayerId: "alice",
      sourceInstanceId: elf.instanceId,
      targets: [
        {
          instanceId: "advent-src-1",
          minimumCoreCount: 1,
        },
      ],
    });
    const summonedBeforePlacement = resolved.cardInstances.find(
      (i) => i.instanceId === "advent-src-1"
    )!;
    expect(summonedBeforePlacement.zone).toBe("field");
    expect(summonedBeforePlacement.normalCoreCount).toBe(0);
    expect(
      resolved.cardInstances.find((i) => i.instanceId === "leaving-host")
        ?.underCards
    ).toEqual([]);

    const placementAction = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(placementAction).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: resolved,
      action: placementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "advent-src-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById,
      ...lookups,
    }).state;

    const summoned = afterPlacement.cardInstances.find(
      (i) => i.instanceId === "advent-src-1"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.normalCoreCount).toBe(1);
    // C08 は host を残す効果ではない。C08 の派生処理後、host は通常どおり実移動する。
    expect(
      afterPlacement.cardInstances.find((i) => i.instanceId === "leaving-host")
        ?.zone
    ).toBe("trash");
    expect(
      afterPlacement.cardInstances.find((i) => i.instanceId === "leaving-host")
        ?.pendingLeaveKind
    ).toBeNull();
    expect(
      afterPlacement.cardInstances.find((i) => i.instanceId === "leaving-host")
        ?.underCards
    ).toEqual([]);
    expect(
      afterPlacement.pendingLeaveEntities.some(
        (entry) => entry.instanceId === "leaving-host"
      )
    ).toBe(false);
  });
});

describe("BSSG01-M01 暁 切歌「イガリマ-XV-」", () => {
  const c = card("BSSG01-M01");
  it("uniqueness stub / アタブロ時 自身コア + 月読条件で相手疲労 / 離脱残置 stub / host側煌臨許可付与", () => {
    const atk = c.effects![1]!;
    expect(atk.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(atk.steps[0]!.action).toMatchObject({
      kind: "core_move",
      to: { kind: "this_card" },
    });
    expect(atk.steps[1]!.action.kind).toBe("exhaust");
    expect(atk.steps[1]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    // [5] 相手によって離れるとき同じ状態で残せる: card_event leave_field +
    //   stay_on_field(newExhaustState 省略=同じ状態) + core_distribute(任意配置)。
    const stayEff = c.effects![2]!;
    expect(stayEff.stub).toBeUndefined();
    expect(stayEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(stayEff.executionMode).toBe("optional");
    expect(stayEff.steps[0]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    expect(stayEff.steps[1]!.action).toMatchObject({
      kind: "core_distribute",
      from: { kind: "field_and_reserve_self" },
      mode: "player_choice",
    });
    // [8] host側煌臨許可付与は hostDualAdventGrant (effects[] ではなく top-level field、
    //   BSDB01-CX01【真バディ】と同型 SSOT)。1スロットのみ・通常経路無効・ターン制限無し
    //   (needs-ruling.jsonl cardNo BSSG01-M01/M02 裁定確定2026-07-25、案A)。
    expect(c.hostDualAdventGrant).toEqual({
      slots: [{ cardNames: [{ contains: "暁 切歌" }] }],
      timing: "main_and_flash",
      normalPathDisabled: true,
      alternateCost: { timing: "main_and_flash", turnLimitDisabled: true },
    });
  });

  it("アタック時 実行: ボイドのコア1個が自身へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xv-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 2 } : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "xv-1", "alice");
    const inst = result.cardInstances.find((c) => c.instanceId === "xv-1")!;
    expect(inst.normalCoreCount).toBe(2);
  });

  it("離脱残置 実行: 相手効果で離脱待機中の自身が同じ状態で field に残る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // 相手 (bob) 効果で破壊待機中。疲労状態は exhausted。
    const self = createCardInstance(c, {
      instanceId: "xv-stay",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-xv-stay",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self],
      pendingLeaveEntities: [
        {
          instanceId: "xv-stay",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-xv-stay",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const result = runEffect(state, c.effects![2]!, "xv-stay", "alice");
    const inst = result.cardInstances.find((c) => c.instanceId === "xv-stay")!;
    // field に残り、疲労状態は据え置き、離脱待機解除。
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("exhausted");
    expect(inst.pendingLeaveKind).toBeNull();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "xv-stay")
    ).toBeUndefined();
  });
});

describe("BSSG01-M02 月読 調「シャルシャガナ-XV-」", () => {
  const c = card("BSSG01-M02");
  it("アタブロ時 draw + 暁条件でシンボル1つ破壊 / 離脱残置 stub / host側煌臨許可付与", () => {
    const atk = c.effects![1]!;
    expect(atk.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    const d = atk.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      expect(d.target.filter.symbolCount).toBe(1);
    }
    expect(atk.steps[1]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
      },
    ]);
    // [5] 離脱残置: BSSG01-M01 と同構造 (stay_on_field + core_distribute)。
    const stayEff = c.effects![2]!;
    expect(stayEff.stub).toBeUndefined();
    expect(stayEff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(stayEff.steps[0]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    // [8] host側煌臨許可付与。BSSG01-M01 と同構造・同裁定。
    expect(c.hostDualAdventGrant).toEqual({
      slots: [{ cardNames: [{ contains: "月読 調" }] }],
      timing: "main_and_flash",
      normalPathDisabled: true,
      alternateCost: { timing: "main_and_flash", turnLimitDisabled: true },
    });
  });

  it("アタック時 実行: 暁がいればシンボル1つの相手が leave enqueue", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xv2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const akatsuki = createCardInstance(card("BSSG01-C01"), {
      instanceId: "akatsuki-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // BSSG01-C01 は シンボル1つ → 対象になる。
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "enemy-xv2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSG01-C02"), {
      instanceId: "deck-xv2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, akatsuki, enemy, deckCard],
    };
    const result = runEffect(state, c.effects![1]!, "xv2-1", "alice");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "enemy-xv2")
    ).toBeDefined();
  });
});

describe("BSSG01-M03 暁 切歌「イガリマ-IGNITE-」", () => {
  const c = card("BSSG01-M03");
  it("煌臨は adventData で表現 / uniqueness stub / 煌臨アタック時 ボイド→自身コア2+重疲労+コア4移動 / Lv2フラッシュ creator破壊+回復", () => {
    // [0,1] フラッシュ【煌臨：「暁 切歌＆コスト4以上」『お互いのアタックステップ』】→ adventData。
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 同名フィールド唯一性は field_name_uniqueness で実装済み（旧 stub 解消）。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");

    const main = c.effects![1]!;
    expect(main.timing).toEqual({
      kind: "card_event",
      event: ["advent", "attack"],
    });
    expect(main.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(main.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
      amount: 2,
    });
    const ex = main.steps[1]!.action;
    expect(ex.kind).toBe("exhaust");
    if (ex.kind === "exhaust") expect(ex.degree).toBe("heavy_exhaust");

    // BSSG01-M03 effects[1] step[2]: 「疲労状態の相手のスピリット/アルティメット1体のコア4個を
    // リザーブに置ける」= 単一対象コアシュート (core_move.target + from:target_card)。
    // 旧 field_card 近似 (任意1体・疲労限定なし) を target_card に置換。
    // filter は exhaustState:"exhausted" (重疲労含む) + minCores:4 (固定 amount=4 のため)。
    expect(main.stub).toBeUndefined();
    const coreShoot = main.steps[2]!.action;
    expect(coreShoot.kind).toBe("core_move");
    if (coreShoot.kind === "core_move") {
      expect(coreShoot.from).toEqual({ kind: "target_card" });
      expect(coreShoot.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(coreShoot.amount).toBe(4);
      if (coreShoot.target && coreShoot.target.kind === "filter") {
        expect(coreShoot.target.player).toBe("opponent");
        expect(coreShoot.target.count).toBe(1);
        expect(coreShoot.target.filter.exhaustState).toBe("exhausted");
        expect(coreShoot.target.filter.minCores).toBe(4);
        expect(coreShoot.target.filter.category).toEqual([
          "spirit",
          "ultimate",
        ]);
      }
    }

    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.condition).toEqual([
      {
        kind: "self_state",
        state: "on_field",
        reference: "self",
        battleState: "attacking",
      },
      { kind: "min_level", value: 2 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    const d = flash.steps[0]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      // P3-137: tribes:["創界神"] narrowing 除去、導界者ネクサスも対象に含める。
      expect(d.target.filter.targetsGrandwalker).toBe("only");
    }
    expect(flash.steps[1]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("煌臨/アタック時 実行: ボイドのコア2個が自身へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "ignite-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 3 } : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "ignite-1", "alice");
    const inst = result.cardInstances.find((c) => c.instanceId === "ignite-1")!;
    expect(inst.normalCoreCount).toBe(3);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(1);
  });
});

describe("BSSG01-M04 月読 調「シャルシャガナ-IGNITE-」", () => {
  const c = card("BSSG01-M04");
  it("煌臨は adventData で表現 / uniqueness stub / 煌臨アタック時 2ドロー+破壊+creatorコアボイド / Lv2フラッシュ nexus破壊+回復", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 同名フィールド唯一性は field_name_uniqueness で実装済み（旧 stub 解消）。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");

    const main = c.effects![1]!;
    expect(main.stub).toBeUndefined();
    expect(main.steps[0]!.action).toEqual({ kind: "draw", count: 2 });
    const destroy = main.steps[1]!.action;
    expect(destroy.kind).toBe("destroy");
    // BSSG01-M04 効果テキスト「コア3個以下の相手のスピリット/アルティメット1体を破壊」
    // → destroy target の filter.maxCores: 3 で表現（旧 stub 解消）。
    if (destroy.kind === "destroy" && destroy.target.kind === "filter") {
      expect(destroy.target.filter.maxCores).toBe(3);
      expect(destroy.target.filter.category).toEqual(["spirit", "ultimate"]);
    }
    expect(main.steps[2]!.connector).toBe("conditional_result");
    const cm = main.steps[2]!.action;
    expect(cm.kind).toBe("core_move");
    if (cm.kind === "core_move" && cm.from.kind === "field_card") {
      // P3-137: tribes:["創界神"] narrowing 除去、導界者ネクサスも対象に含める。
      expect(cm.from.filter.targetsGrandwalker).toBe("only");
      expect(cm.amount).toBe(3);
    }

    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.condition).toEqual([
      {
        kind: "self_state",
        state: "on_field",
        reference: "self",
        battleState: "attacking",
      },
      { kind: "min_level", value: 2 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
      },
    ]);
    expect(flash.steps[1]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("煌臨/アタック時 実行: デッキから2枚ドロー", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "ignite2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = ["d1", "d2", "d3"].map((id) =>
      createCardInstance(card("BSSG01-C01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, ...deck],
    };
    const result = runEffect(state, c.effects![1]!, "ignite2-1", "alice");
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand.length).toBe(2);
  });
});

describe("BSSG01-R01 ポリフィリム錵恋夢", () => {
  const c = card("BSSG01-R01");
  it("トラッシュ耐性 (while_in_trash effect_immunity) / フラッシュ 二択(重疲労 OR self-turn ネクサス破壊) / スタック 相手4体疲労", () => {
    const trashImmunity = c.effects![0]!;
    expect(trashImmunity.stub).toBeUndefined();
    expect(trashImmunity.applicability).toEqual({ zone: "trash" });
    const imm = trashImmunity.steps[0]!.action;
    expect(imm.kind).toBe("effect_immunity");
    if (imm.kind === "effect_immunity") {
      expect(imm.duration.scope).toBe("while_in_trash");
    }

    const flash = c.effects![1]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    const flashStep = flash.steps[0]!;
    const ex = flashStep.action;
    expect(ex.kind).toBe("exhaust");
    if (ex.kind === "exhaust") {
      expect(ex.degree).toBe("heavy_exhaust");
      expect(ex.target.kind).toBe("filter");
      if (ex.target.kind === "filter") expect(ex.target.count).toBe("all");
    }
    // choices[1]: 自分のターンなら相手のネクサス/創界神ネクサスすべて破壊。
    expect(flashStep.choice).toHaveLength(1);
    const altBranch = flashStep.choice![0]!;
    expect(altBranch.condition).toEqual([
      { kind: "turn_player", player: "self" },
    ]);
    expect(altBranch.action.kind).toBe("destroy");
    if (altBranch.action.kind === "destroy") {
      expect(altBranch.action.target.kind).toBe("filter");
      if (altBranch.action.target.kind === "filter") {
        expect(altBranch.action.target.filter.targetsGrandwalker).toBe(true);
        expect(altBranch.action.target.count).toBe("all");
      }
    }

    const stack = c.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    const sx = stack.steps[0]!.action;
    if (sx.kind === "exhaust" && sx.target.kind === "filter") {
      expect(sx.target.count).toBe(4);
    }
  });

  it("フラッシュ 実行: 相手スピリットすべてが重疲労", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "poli-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const e1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "e1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const e2 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "e2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, e1, e2],
    };
    const result = runEffect(state, c.effects![1]!, "poli-1", "alice");
    expect(
      result.cardInstances.find((c) => c.instanceId === "e1")!.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      result.cardInstances.find((c) => c.instanceId === "e2")!.exhaustState
    ).toBe("heavily_exhausted");
  });

  it("フラッシュ 実行(choices[1] 自分のターン): 相手の通常ネクサスと創界神ネクサスを破壊", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "poli-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    // 通常ネクサス（targetsGrandwalker でも対象に含む）。
    const plainNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "nx1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    // 創界神/導界者ネクサス（targetsGrandwalker:true で初めて対象になる）。
    const guidedNexus = createCardInstance(card("BSES01-CX01"), {
      instanceId: "nx2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, plainNexus, guidedNexus],
    };
    const result = executeEffect({
      chainId: "test:bssg01-cards:2657",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "poli-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    // 両ネクサス（通常 + 創界神）が破壊として leave enqueue される。
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "nx1")
    ).toBeDefined();
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "nx2")
    ).toBeDefined();
  });

  it("choices[1] は相手のターンでは合法でない（turn_player:self 条件）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const cond = c.effects![1]!.steps[0]!.choice![0]!.condition!;
    // bob のターン中は self=alice のターンではないので条件不成立。
    const opponentTurn: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "attack",
    };
    expect(
      evaluateCondition(
        opponentTurn,
        cond,
        "poli-1",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    const ownTurn: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
    };
    expect(
      evaluateCondition(ownTurn, cond, "poli-1", "alice", getCardDefinitionById)
    ).toBe(true);
  });
});

describe("BSSG01-R02 絶唱", () => {
  const c = card("BSSG01-R02");
  const holderDef: CardDefinition = {
    cardNo: "TEST-BSSG01-R02-SOUJA",
    name: "装者条件テスト",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "装者",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const localGetCardDefinitionById = (id: string) =>
    id === holderDef.cardNo ? holderDef : getCardDefinitionById(id);

  function handState(hasSouja: boolean): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const magic = createCardInstance(c, {
      instanceId: "bssg01-r02-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const holder = createCardInstance(holderDef, {
      instanceId: "souja-holder",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: hasSouja ? "field" : "trash",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [magic, holder],
    };
  }

  it("オープン置換 swap disposition / 条件付きコスト override / self-turnフラッシュ suppress / アタック時抑止スタック", () => {
    // [0] デッキからオープンされたら手札1枚と入れ替え（swap 型 disposition・系統限定なし）。
    expect(c.effects![0]!.cardEventDisposition).toEqual({ kind: "swap" });
    expect(c.effects![0]!.stub).toBeUndefined();
    const cost = c.effects![1]!;
    expect(cost.stub).toBeUndefined();
    expect(cost.applicability).toEqual({ zone: ["hand"] });
    expect(cost.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
        tribes: ["装者"],
        minCount: 1,
      },
    ]);
    expect(cost.steps[0]!.action).toEqual({
      kind: "cost_modify",
      target: { kind: "self" },
      modifier: { override: 4 },
    });
    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.stub).toBeUndefined();
    expect(flash.condition).toEqual([{ kind: "turn_player", player: "self" }]);
    expect(flash.steps[0]!.action).toMatchObject({
      kind: "exhaust",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: "all",
      },
    });
    expect(flash.steps[1]!.connector).toBe("simultaneous");
    expect(flash.steps[1]!.action).toMatchObject({
      kind: "suppress_effect",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["nexus"], targetsGrandwalker: true },
        count: "all",
      },
      duration: { scope: "turn" },
    });
    expect(flash.steps[2]!.connector).toBe("sequential");
    expect(flash.steps[2]!.action).toEqual({
      kind: "remove_from_game",
      target: { kind: "self" },
    });
    const stack = c.effects![3]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.stub).toBeUndefined();
    expect(stack.steps[0]!.action).toMatchObject({
      kind: "negate",
      negateTarget: "effect",
      targetController: "opponent",
      targetEffectFilter: {
        effectLabels: ["spirit_attack_time", "ultimate_attack_time"],
      },
    });
  });

  it("BSSG01-R02 は手札で装者の自分スピリットがいるときコストを4に上書きする", () => {
    const result = calculateReduction({
      state: handState(true),
      actingPlayerId: "alice",
      card: c,
      sourceInstanceId: "bssg01-r02-hand",
      getCardDefinitionById: localGetCardDefinitionById,
    });

    expect(result.reducedCost).toBe(4);
    expect(result.finalCost).toBe(4);
    expect(result.effectiveCost).toBe(4);
  });

  it("BSSG01-R02 は装者条件を満たさないと印字コスト8のまま", () => {
    const result = calculateReduction({
      state: handState(false),
      actingPlayerId: "alice",
      card: c,
      sourceInstanceId: "bssg01-r02-hand",
      getCardDefinitionById: localGetCardDefinitionById,
    });

    expect(result.reducedCost).toBe(8);
    expect(result.finalCost).toBe(8);
    expect(result.effectiveCost).toBe(8);
  });

  it("[board] フラッシュ: 相手全体疲労 + ネクサス効果抑止 CE + 自身除外", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const oppSpirit = createCardInstance(card("BSSG01-C01"), {
      instanceId: "opp-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, oppSpirit, oppNexus],
    };

    const result = runEffect(state, c.effects![2]!, "zessho-1", "alice");

    expect(
      result.cardInstances.find((x) => x.instanceId === "opp-spirit")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.metadata?.suppressTargetPlayer === "opponent" &&
          ce.metadata?.suppressTargetFilter !== undefined &&
          ce.duration.scope === "turn"
      )
    ).toBe(true);
    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("removed_from_game");
  });

  it("[board] in_use の self remove_from_game は自身側リザーブへコアを返す", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
      cores: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) => ({
        ...player,
        reserveNormalCoreCount: 0,
      })),
      cardInstances: [self],
    };

    const result = runEffect(state, c.effects![2]!, "zessho-1", "alice");

    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("removed_from_game");
    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!
        .normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((player) => player.id === "alice")!
        .reserveNormalCoreCount
    ).toBe(2);
    expect(
      result.players.find((player) => player.id === "bob")!
        .reserveNormalCoreCount
    ).toBe(0);
  });

  it("[magic] フラッシュ解決後 cleanup は自身除外を trash で上書きしない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const oppSpirit = createCardInstance(card("BSSG01-C01"), {
      instanceId: "opp-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, oppSpirit, oppNexus],
    };
    const activeStack: ActiveStack = {
      stackId: "stack:zessho-1",
      actionKind: "magic",
      chainId: "chain:zessho-1",
      actingPlayerId: "alice",
      cardInstanceId: "zessho-1",
      cardDefinitionId: c.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "flash",
      magicEffectIndex: 2,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const result = resolveDeferredMagicStack({
      state,
      activeStack,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
      getRegisteredBurstActions: () => undefined,
    });

    expect(
      result.cardInstances.find((x) => x.instanceId === "opp-spirit")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.metadata?.suppressTargetPlayer === "opponent" &&
          ce.duration.scope === "turn"
      )
    ).toBe(true);
    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("removed_from_game");
    expect(result.log).not.toContain("magic:trash:chain:zessho-1:zessho-1");
  });

  it("[magic] コストなし使用は main filter のみを解決し flash/stack 効果を走らせない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const oppSpirit = createCardInstance(card("BSSG01-C01"), {
      instanceId: "opp-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const defs = [c, card("BSSG01-C01"), card("BSSG01-C07")];
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, handCount: 1 } : player
      ),
      cardInstances: [self, oppSpirit, oppNexus],
    };

    const result = useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "zessho-1",
      ...lookups,
    }).state;

    expect(
      result.cardInstances.find((x) => x.instanceId === "opp-spirit")!
        .exhaustState
    ).toBe("recovered");
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(false);
    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("trash");
    expect(
      result.log.some((line) => line.startsWith("effect:remove_from_game"))
    ).toBe(false);
  });

  it("[legal action] 手札から使用して in_use 経由で自身除外し、cleanup は trash 上書きしない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const oppSpirit = createCardInstance(card("BSSG01-C01"), {
      instanceId: "opp-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const bobDiscardCost = createCardInstance(card("BSSG01-C01"), {
      instanceId: "bob-discard-cost",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const defs = [c, card("BSSG01-C01"), card("BSSG01-C07")];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, handCount: 1, reserveNormalCoreCount: 8 }
          : player.id === "bob"
            ? { ...player, deckCount: 10, handCount: 1 }
            : player
      ),
      cardInstances: [self, oppSpirit, oppNexus, bobDiscardCost],
    };

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useMagic = aliceActions.find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "zessho-1" &&
        action.timing === "flash" &&
        action.effectIndex === 2
    );
    expect(useMagic).toBeDefined();
    expect(useMagic!.finalCost).toBe(8);

    const afterUse = applyLegalAction({
      state,
      action: useMagic!,
      paymentSources: [{ kind: "reserve", amount: 8 }],
      ...lookups,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();
    expect(
      afterUse.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("in_use");
    expect(afterUse.players.find((p) => p.id === "alice")!.handCount).toBe(0);
    expect(
      afterUse.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(0);
    expect(
      afterUse.log.some((line) => line.includes(":zessho-1:BSSG01-R02"))
    ).toBe(true);

    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const result = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(
      result.cardInstances.find((x) => x.instanceId === "opp-spirit")!
        .exhaustState
    ).toBe("exhausted");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.metadata?.suppressTargetPlayer === "opponent" &&
          ce.duration.scope === "turn"
      )
    ).toBe(true);
    expect(
      result.cardInstances.find((x) => x.instanceId === "zessho-1")!.zone
    ).toBe("removed_from_game");
    expect(result.log).toContain(
      "magic:in-use:magic:1:alice:main:zessho-1:zessho-1"
    );
    expect(result.log).toContain(
      "magic:cost-paid:magic:1:alice:main:zessho-1:alice:8"
    );
    expect(result.log).not.toContain(
      "magic:trash:magic:1:alice:main:zessho-1:zessho-1"
    );

    const bobMainState: GameState = {
      ...result,
      activePlayerId: "bob",
      step: "main",
    };
    const bobDeckBefore = bobMainState.players.find(
      (p) => p.id === "bob"
    )!.deckCount;
    const bobHandBefore = bobMainState.players.find(
      (p) => p.id === "bob"
    )!.handCount;
    const bobFieldEffect = getLegalActions({
      state: bobMainState,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "opp-nexus"
    );
    expect(bobFieldEffect).toBeUndefined();
    expect(bobMainState.players.find((p) => p.id === "bob")!.deckCount).toBe(
      bobDeckBefore
    );
    expect(bobMainState.players.find((p) => p.id === "bob")!.handCount).toBe(
      bobHandBefore
    );
    expect(
      bobMainState.cardInstances.find(
        (x) => x.instanceId === "bob-discard-cost"
      )!.zone
    ).toBe("hand");
  });

  it("[reevaluation] dynamic suppress はフィールド外ネクサス効果を止めない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const zessho = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "removed_from_game",
    });
    const handNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "hand-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      cardInstances: [zessho, handNexus],
      activeContinuousEffects: [
        {
          effectId: "ce:zessho-dynamic-suppress",
          sourceInstanceId: "zessho-1",
          sourceDefinitionId: "BSSG01-R02",
          actingPlayerId: "alice",
          modifierTag: "effect_suppression",
          duration: { scope: "turn" },
          createdAtTurn: base.turnNumber,
          metadata: {
            suppressTargetPlayer: "opponent",
            suppressTargetFilter: {
              category: ["nexus"],
              targetsGrandwalker: true,
            },
          },
        },
      ],
    };

    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: "hand-nexus",
        targetInstanceIds: [],
        getCardDefinitionById,
      })
    ).toBe(true);
  });

  it("[legal action] 絶唱を受けないネクサスは dynamic suppress 下でも効果を発揮できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const oppSpirit = createCardInstance(card("BSSG01-C01"), {
      instanceId: "opp-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const bobDiscardCost = createCardInstance(card("BSSG01-C01"), {
      instanceId: "bob-discard-cost",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const bobDeck1 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "bob-deck-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const bobDeck2 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "bob-deck-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const nexusMagicImmunity: ContinuousEffect = {
      effectId: "ce:nexus-magic-immunity",
      sourceInstanceId: "opp-nexus",
      sourceDefinitionId: "BSSG01-C07",
      actingPlayerId: "bob",
      targetInstanceId: "opp-nexus",
      modifierTag: "defense_immune",
      immunitySourceScope: { categories: ["magic"] },
      duration: { scope: "while_on_field" },
      createdAtTurn: base.turnNumber,
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      players: base.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 2, handCount: 1 } : player
      ),
      cardInstances: [
        self,
        oppSpirit,
        oppNexus,
        bobDiscardCost,
        bobDeck1,
        bobDeck2,
      ],
      activeContinuousEffects: [nexusMagicImmunity],
    };

    const zesshoResult = runEffect(state, c.effects![2]!, "zessho-1", "alice");
    expect(
      zesshoResult.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(true);

    const defs = [c, card("BSSG01-C01"), card("BSSG01-C07")];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const bobMainState: GameState = {
      ...zesshoResult,
      activePlayerId: "bob",
      step: "main",
    };
    const bobFieldEffect = getLegalActions({
      state: bobMainState,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "opp-nexus"
    );
    expect(bobFieldEffect).toBeDefined();

    const afterNexusUse = applyLegalAction({
      state: bobMainState,
      action: bobFieldEffect!,
      ...lookups,
    }).state;
    const alicePassNexus = getLegalActions({
      state: afterNexusUse,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(alicePassNexus).toBeDefined();

    const afterNexusResolution = applyLegalAction({
      state: afterNexusUse,
      action: alicePassNexus!,
      ...lookups,
    }).state;
    expect(
      afterNexusResolution.log.some((line) =>
        line.includes("reevaluation:before_each_step:failed:effect_suppression")
      )
    ).toBe(false);
    expect(
      afterNexusResolution.cardInstances.find(
        (x) => x.instanceId === "bob-discard-cost"
      )!.zone
    ).toBe("trash");
    expect(
      afterNexusResolution.cardInstances.filter(
        (x) =>
          (x.instanceId === "bob-deck-1" || x.instanceId === "bob-deck-2") &&
          x.zone === "hand"
      )
    ).toHaveLength(2);
  });

  it("[legal action] 絶唱を受けないネクサスは instance suppress 下でも効果を発揮できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const zessho = createCardInstance(c, {
      instanceId: "zessho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "removed_from_game",
    });
    const oppNexus = createCardInstance(card("BSSG01-C07"), {
      instanceId: "opp-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const bobDiscardCost = createCardInstance(card("BSSG01-C01"), {
      instanceId: "bob-discard-cost",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const bobDeck1 = createCardInstance(card("BSSG01-C02"), {
      instanceId: "bob-deck-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const bobDeck2 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "bob-deck-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const instanceSuppress: ContinuousEffect = {
      effectId: "ce:instance-suppress",
      sourceInstanceId: "zessho-1",
      sourceDefinitionId: "BSSG01-R02",
      actingPlayerId: "alice",
      targetInstanceId: "opp-nexus",
      modifierTag: "effect_suppression",
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
    };
    const nexusMagicImmunity: ContinuousEffect = {
      effectId: "ce:nexus-magic-immunity",
      sourceInstanceId: "opp-nexus",
      sourceDefinitionId: "BSSG01-C07",
      actingPlayerId: "bob",
      targetInstanceId: "opp-nexus",
      modifierTag: "defense_immune",
      immunitySourceScope: { categories: ["magic"] },
      duration: { scope: "while_on_field" },
      createdAtTurn: base.turnNumber,
    };
    const state: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "main",
      players: base.players.map((player) =>
        player.id === "bob" ? { ...player, deckCount: 2, handCount: 1 } : player
      ),
      cardInstances: [zessho, oppNexus, bobDiscardCost, bobDeck1, bobDeck2],
      activeContinuousEffects: [instanceSuppress, nexusMagicImmunity],
    };
    const defs = [c, card("BSSG01-C01"), card("BSSG01-C07")];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const bobFieldEffect = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "opp-nexus"
    );
    expect(bobFieldEffect).toBeDefined();

    const afterNexusUse = applyLegalAction({
      state,
      action: bobFieldEffect!,
      ...lookups,
    }).state;
    const alicePassNexus = getLegalActions({
      state: afterNexusUse,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(alicePassNexus).toBeDefined();

    const afterNexusResolution = applyLegalAction({
      state: afterNexusUse,
      action: alicePassNexus!,
      ...lookups,
    }).state;
    expect(
      afterNexusResolution.log.some((line) =>
        line.includes("reevaluation:before_each_step:failed:effect_suppression")
      )
    ).toBe(false);
    expect(
      afterNexusResolution.cardInstances.find(
        (x) => x.instanceId === "bob-discard-cost"
      )!.zone
    ).toBe("trash");
    expect(
      afterNexusResolution.cardInstances.filter(
        (x) =>
          (x.instanceId === "bob-deck-1" || x.instanceId === "bob-deck-2") &&
          x.zone === "hand"
      )
    ).toHaveLength(2);
  });
});

describe("BSSG01-X01 暁 切歌「イガリマ-エクスドライブ-」", () => {
  const c = card("BSSG01-X01");
  it("煌臨は adventData で表現 / uniqueness stub / 煌臨アタック時 2体重疲労+2体デッキ下(防げない) / Lv2フラッシュ 回復", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 同名フィールド唯一性は field_name_uniqueness で実装済み（旧 stub 解消）。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");

    const main = c.effects![1]!;
    const ex = main.steps[0]!.action;
    expect(ex.kind).toBe("exhaust");
    if (ex.kind === "exhaust") {
      expect(ex.degree).toBe("heavy_exhaust");
      expect(ex.maxPreventable).toBe(0);
    }
    const std = main.steps[1]!.action;
    expect(std.kind).toBe("send_to_deck");
    if (std.kind === "send_to_deck") {
      expect(std.position).toBe("bottom");
      expect(std.maxPreventable).toBe(0);
    }

    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flash.condition).toEqual([
      {
        kind: "self_state",
        state: "on_field",
        reference: "self",
        battleState: "attacking",
      },
      { kind: "min_level", value: 2 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    expect(flash.steps[0]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("煌臨/アタック時 実行: 重疲労後、相手2体がデッキの下へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xd-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemies = ["ex1", "ex2"].map((id) =>
      createCardInstance(card("BSSG01-C01"), {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, ...enemies],
    };
    const result = flushPendingLeaves(
      runEffect(state, c.effects![1]!, "xd-1", "alice"),
      getCardDefinitionById
    );
    // step0 重疲労 → step1 send_to_deck(bottom)。デッキ移動で疲労状態はリセットされるため
    // 最終盤面の観測点はゾーン=deck（送りが効いていること）で検証する。
    expect(result.cardInstances.find((c) => c.instanceId === "ex1")!.zone).toBe(
      "deck"
    );
    expect(result.cardInstances.find((c) => c.instanceId === "ex2")!.zone).toBe(
      "deck"
    );
  });
});

describe("BSSG01-X02 月読 調「シャルシャガナ-エクスドライブ-」", () => {
  const c = card("BSSG01-X02");
  it("煌臨は adventData で表現 / uniqueness / 煌臨ブロック時 2体破壊(効果抑止)+回復 / 暁条件 ブロック貫通", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 同名フィールド唯一性は field_name_uniqueness で実装済み（旧 stub 解消）。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");

    const main = c.effects![1]!;
    expect(main.timing).toEqual({
      kind: "card_event",
      event: ["advent", "block"],
    });
    const d = main.steps[0]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy") {
      expect(d.suppressDestroyedEffects).toBe("destroyed_only");
    }
    expect(main.steps[1]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
    const blockUnblockable = c.effects![2]!;
    expect(blockUnblockable.stub).toBeUndefined();
    expect(blockUnblockable.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "暁 切歌" }],
      },
    ]);
    expect(blockUnblockable.steps[0]!.action).toEqual({
      kind: "block_unblockable",
      target: { kind: "self" },
      duration: { scope: "while_on_field" },
    });
  });

  it("煌臨/ブロック時 実行: 相手2体が leave enqueue", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xd2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemies = ["dx1", "dx2"].map((id) =>
      createCardInstance(card("BSSG01-C01"), {
        instanceId: id,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, ...enemies],
    };
    const result = runEffect(state, c.effects![1]!, "xd2-1", "alice");
    expect(
      result.cardInstances.filter(
        (e) =>
          ["dx1", "dx2"].includes(e.instanceId) &&
          (e.zone === "trash" || e.pendingLeaveKind === "destroy")
      ).length
    ).toBe(2);
  });

  it("暁 切歌がいる間、block_unblockable CE を自身に登録する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xd2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const kirika = createCardInstance(card("BSSG01-C01"), {
      instanceId: "kirika-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, kirika],
    };
    const result = runEffect(state, c.effects![2]!, "xd2-1", "alice");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "block_unblockable" &&
          ce.targetInstanceId === "xd2-1" &&
          ce.duration.scope === "while_on_field"
      )
    ).toBe(true);
  });

  it("暁 切歌を含む変種名でも、block_unblockable CE を自身に登録する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xd2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const kirikaVariant = createCardInstance(card("BSSG01-M03"), {
      instanceId: "kirika-variant",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, kirikaVariant],
    };
    const result = runEffect(state, c.effects![2]!, "xd2-1", "alice");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "block_unblockable" &&
          ce.targetInstanceId === "xd2-1" &&
          ce.duration.scope === "while_on_field"
      )
    ).toBe(true);
  });

  it("暁 切歌がいない場合、block_unblockable CE は登録されない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "xd2-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const result = runEffect(state, c.effects![2]!, "xd2-1", "alice");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "block_unblockable" &&
          ce.targetInstanceId === "xd2-1"
      )
    ).toBe(false);
  });
});

describe("BSSG01-X03 暁 切歌＆月読 調「アマルガム」", () => {
  const c = card("BSSG01-X03");
  it("多重煌臨は dualHostAdventData で表現 (P3-133) / uniqueness 配線済み / アタック時は降臨元経路が到達可能", () => {
    // 多重煌臨（2 host 同時）は単一対象 AdventData ではなく dualHostAdventData で表現する
    // (declare_dual_host_advent、mechanics/multi-host-advent.ts、P3-133 解消)。
    expect(c.adventData).toBeUndefined();
    expect(c.dualHostAdventData).toBeDefined();
    expect(c.dualHostAdventData!.hostSlotConditions[0]!.cardNames).toEqual([
      { contains: "暁 切歌" },
    ]);
    expect(c.dualHostAdventData!.hostSlotConditions[1]!.cardNames).toEqual([
      { contains: "月読 調" },
    ]);
    expect(c.dualHostAdventData!.adventTiming).toBe("own_turn");
    expect(c.dualHostAdventData!.soulCoreDest).toBe("trash");
    // 『暁 切歌』/『月読 調』それぞれの唯一性は field_name_uniqueness で実装済み。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");
    // アタック時効果: self_advent_source_names の唯一の populate 経路だった
    // dualHostAdventData が実装されたため到達可能になった (P3-133 解消)。
    const atk = c.effects![1]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.stub).toBeUndefined();
    expect(atk.steps.length).toBeGreaterThan(0);
  });
});

// self_advent_source_names（ConditionClause）/ symbol_count_from_ref（DynamicCountSource）
// primitive 自体の検証。BSSG01-X03 effects[1] (実際のカード定義) で使用されている
// (P3-133 解消)。ここでは fixed count 変種で primitive 自体の計算ロジックを独立検証する。
describe("self_advent_source_names / symbol_count_from_ref primitives (BSSG01-X03 effects[1] で使用)", () => {
  const c = card("BSSG01-X03");

  it("self_advent_source_names(and): 降臨元に両名がいるときのみ成立", () => {
    const condition = [
      {
        kind: "self_advent_source_names" as const,
        names: [{ contains: "暁 切歌" }, { contains: "月読 調" }],
        logic: "and" as const,
      },
    ];
    const self = {
      ...createCardInstance(c, {
        instanceId: "amal-cond",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        { cardInstanceId: "src-kirika", role: "advent_source" as const },
        { cardInstanceId: "src-shirabe", role: "advent_source" as const },
      ],
    };
    const kirika = createCardInstance(card("BSSG01-C01"), {
      instanceId: "src-kirika",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const shirabe = createCardInstance(card("BSSG01-C02"), {
      instanceId: "src-shirabe",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const bothState: GameState = {
      ...base,
      cardInstances: [self, kirika, shirabe],
    };
    expect(
      evaluateCondition(
        bothState,
        condition,
        "amal-cond",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);

    // 片方（暁 切歌）のみ → and 不成立。
    const onlyOne = { ...self, underCards: [self.underCards[0]!] };
    const oneState: GameState = {
      ...base,
      cardInstances: [onlyOne, kirika],
    };
    expect(
      evaluateCondition(
        oneState,
        condition,
        "amal-cond",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("[board] symbol_count_from_ref: 複数 step 破壊シンボル合計を divisor:2 cap:3 で相手ライフのコアをボイドへ", () => {
    // BSSG01-X03 の filter 定義（category:["spirit","ultimate"] / category:["nexus"]+
    // targetsGrandwalker:true）を fixed count 変種で流用し、symbol_count_from_ref
    // (複数 stepId 合算) + divisor + cap の計算を検証する。
    const variant: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "x03destroySpiritUltimate",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 4,
            },
          },
        },
        {
          id: "x03destroyNexus",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["nexus"], targetsGrandwalker: true },
              count: 3,
            },
          },
          connector: "sequential",
        },
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "void", player: "opponent" },
            amount: {
              source: {
                kind: "symbol_count_from_ref",
                stepIds: ["x03destroySpiritUltimate", "x03destroyNexus"],
              },
              divisor: 2,
              cap: 3,
            },
          },
          connector: "sequential",
        },
      ],
    };

    const self = createCardInstance(c, {
      instanceId: "amal-board",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // spirit/ultimate 群: シンボル計 1+1+1+2=5（BSSG01-X04 は symbolColors 2つ）。
    const e1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal-e1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const e2 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal-e2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const e3 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal-e3",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const e4 = createCardInstance(card("BSSG01-X04"), {
      instanceId: "amal-e4",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    // nexus 群: シンボル計 1+1+1=3。合計 5+3=8 → floor(8/2)=4 → cap:3 で 3 個に制限。
    const nx1 = createCardInstance(card("BSSG01-C07"), {
      instanceId: "amal-nx1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const nx2 = createCardInstance(card("BSSG01-C08"), {
      instanceId: "amal-nx2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const nx3 = createCardInstance(card("BSSG01-C07"), {
      instanceId: "amal-nx3",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, e1, e2, e3, e4, nx1, nx2, nx3],
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, lifeNormalCoreCount: 5 } : p
      ),
    };
    const result = runEffect(state, variant, "amal-board", "alice");
    const destroyedIds = [e1, e2, e3, e4, nx1, nx2, nx3].map(
      (e) => e.instanceId
    );
    expect(
      destroyedIds.every((id) =>
        result.pendingLeaveEntities.some((entity) => entity.instanceId === id)
      )
    ).toBe(true);
    const bob = result.players.find((p) => p.id === "bob")!;
    // floor(8/2)=4 だが cap:3 で 5-3=2。
    expect(bob.lifeNormalCoreCount).toBe(2);
  });

  it("[board] symbol_count_from_ref: 合体スピリットはブレイヴ追加分込みの実効シンボル数で数える", () => {
    const variant: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "destroyCombinedSpirit",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "void", player: "opponent" },
            amount: {
              source: {
                kind: "symbol_count_from_ref",
                stepIds: ["destroyCombinedSpirit"],
              },
            },
          },
          connector: "sequential",
        },
      ],
    };
    const self = createCardInstance(c, {
      instanceId: "amal-symbol-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const combinedSpirit = {
      ...createCardInstance(card("BSSG01-C01"), {
        instanceId: "combined-spirit",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["symbol-brave"],
    };
    const brave = {
      ...createCardInstance(card("BSAZ01-CX01"), {
        instanceId: "symbol-brave",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      }),
      attachedToInstanceId: "combined-spirit",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, combinedSpirit, brave],
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, lifeNormalCoreCount: 5 } : p
      ),
    };

    const result = runEffect(state, variant, "amal-symbol-source", "alice");
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(3);
  });
});

describe("BSSG01-X04 月読 調「シャルシャガナ-アマルガム-」", () => {
  const c = card("BSSG01-X04");
  it("煌臨は adventData で表現 / 召喚条件は summonCondition / アタック時 BP15000以下破壊+バトル終了時回復", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    // 『自分のターン』= own_turn。
    expect(c.adventData!.adventTiming).toBe("own_turn");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 《召喚条件》は CardDefinition.summonCondition（宣言前チェック）で表現（旧 stub effect 撤去）。
    expect(c.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      cardNames: [{ contains: "暁 切歌" }],
    });

    const atk = c.effects![0]!;
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    const d = atk.steps[0]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      expect(d.target.filter.maxBp).toBe(15000);
      expect(d.target.filter.bpBasis).toBe("printed");
      expect(d.target.count).toBe("all");
    }
    const coreMove = atk.steps[1]!.action;
    expect(coreMove).toMatchObject({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: {
        source: { kind: "step_numeric_amount", stepId: "x04destroy" },
        divisor: 3,
      },
    });
    const rec = atk.steps[2]!;
    expect(rec.deferTo).toBe("battle_end");
    expect(rec.action).toEqual({ kind: "recover", target: { kind: "self" } });
    expect(rec.condition).toEqual([
      {
        kind: "field_has",
        player: "opponent",
        category: ["spirit", "ultimate"],
      },
    ]);
    expect(atk.stub).toBeUndefined();
  });

  it("アタック時 実行: BP15000以下の相手が leave enqueue (実効 BP を無視し印字 Lv1 BP で判定)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "amal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // BSSG01-C01 Lv1 BP1000 → maxBp 15000 で対象。effectiveBp 側に BP+ 修正を
    // 混ぜても bpBasis:"printed" は印字 Lv1 BP のみを見るため判定に影響しない
    // （実効 BP 近似との差分を確認する）。
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal-e1",
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
    const result = runEffect(state, c.effects![0]!, "amal-1", "alice");
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "amal-e1")
    ).toBeDefined();
  });

  it("アタック時 実行: 破壊3体につき相手ライフのコア1個をリザーブへ (floor)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "amal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 4体破壊 → floor(4/3) = 1 個だけリザーブへ移動する。
    const enemies = ["e1", "e2", "e3", "e4"].map((suffix) =>
      createCardInstance(card("BSSG01-C01"), {
        instanceId: `amal-${suffix}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, ...enemies],
      players: base.players.map((p) =>
        p.id === "bob" ? { ...p, lifeNormalCoreCount: 5 } : p
      ),
    };
    const result = runEffect(state, c.effects![0]!, "amal-1", "alice");
    expect(
      enemies.every((e) =>
        result.pendingLeaveEntities.some(
          (entity) => entity.instanceId === e.instanceId
        )
      )
    ).toBe(true);
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(4);
    // 既定 reserveNormalCoreCount(4, factories.ts) + floor(4/3)=1 個移動。
    expect(bob.reserveNormalCoreCount).toBe(5);
  });
});

describe("BSSG01-X05 暁 切歌「イガリマーアマルガム-」", () => {
  const c = card("BSSG01-X05");
  it("煌臨は adventData / 召喚条件は summonCondition / 月読 調 在場↔不在で BP-20000/-10000 を排他2効果で表現", () => {
    expect(c.adventData).toBeDefined();
    expect(c.adventData!.adventCondition.targetCategory).toEqual(["spirit"]);
    expect(c.adventData!.adventCondition.minCost).toBe(4);
    expect(c.adventData!.adventTiming).toBe("both_attack_step");
    expect(c.adventData!.soulCoreDest).toBe("trash");

    // 《召喚条件》は CardDefinition.summonCondition（宣言前チェック）で表現（旧 stub effect 撤去）。
    expect(c.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      cardNames: [{ contains: "月読 調" }],
    });

    // effects[0] = 月読 調 在場: field_has cardNames → BP-20000。
    const present = c.effects![0]!;
    expect(present.timing).toEqual({
      kind: "card_event",
      event: ["advent", "block"],
    });
    expect(present.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    expect(present.limitGroupId).toBe("BSSG01-X05-advent-bp-down");
    expect(present.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(present.stub).toBeUndefined();
    const bpPresent = present.steps[0]!.action;
    expect(bpPresent.kind).toBe("bp_modify");
    if (bpPresent.kind === "bp_modify") expect(bpPresent.amount).toBe(-20000);

    // effects[1] = 月読 調 不在: field_lacks cardNames → BP-10000。
    const absent = c.effects![1]!;
    expect(absent.condition).toEqual([
      {
        kind: "field_lacks",
        player: "self",
        cardNames: [{ contains: "月読 調" }],
      },
    ]);
    expect(absent.limitGroupId).toBe("BSSG01-X05-advent-bp-down");
    expect(absent.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(absent.stub).toBeUndefined();
    const bpAbsent = absent.steps[0]!.action;
    expect(bpAbsent.kind).toBe("bp_modify");
    if (bpAbsent.kind === "bp_modify") expect(bpAbsent.amount).toBe(-10000);

    // 共通 payload: BP0 デッキ下 + ことで構文の「支払わない/2コスト回復」分岐。
    for (const eff of [present, absent]) {
      expect(eff.steps).toHaveLength(4);
      expect(eff.steps[1]!.connector).toBe("conditional_result");
      const std = eff.steps[1]!.action;
      expect(std.kind).toBe("send_to_deck");
      if (std.kind === "send_to_deck" && std.target.kind === "ref") {
        expect(std.target.result).toBe("bp_became_zero");
      }
      expect(eff.steps[2]).toMatchObject({
        id: "recover_choice",
        action: { kind: "noop" },
        choice: [{ action: { kind: "pay_cost", amount: 2 } }],
      });
      expect(eff.steps[3]).toMatchObject({
        action: {
          kind: "recover",
          target: {
            kind: "filter",
            player: "self",
            filter: {
              category: ["spirit", "ultimate"],
              exhaustState: "exhausted",
            },
            count: 2,
          },
        },
        stepCondition: {
          kind: "ref_choice",
          stepId: "recover_choice",
          choiceIndex: 1,
        },
        connector: "conditional_cost",
      });
    }

    expect(
      generateTriggeredEffectRegistrations(c)
        .filter((r) => r.effectIndex === 0 || r.effectIndex === 1)
        .every((r) => r.choices === undefined)
    ).toBe(true);
    const registrations =
      generateTriggeredEffectRegistrations(recoverDefinition);
    const x05Regs = registrations.filter(
      (r) => r.effectIndex === 0 || r.effectIndex === 1
    );
    expect(x05Regs.length).toBeGreaterThan(0);
    for (const reg of x05Regs) {
      expect(reg.choices?.map((choice) => choice.label)).toEqual([
        "支払わない",
        "コスト支払い",
      ]);
      expect(reg.choices?.[0]).not.toHaveProperty("requiredTargetCount");
      expect(reg.choices?.[1]).toMatchObject({
        requiredTargetCount: 2,
        requiredPayCostAmount: 2,
        candidateTargetPlayerScope: "acting_player",
        candidateTargetZones: ["field"],
        targetStepId: "__step_1",
        targetGatedByConditionalCost: true,
        targetCardFilter: {
          category: ["spirit", "ultimate"],
          exhaustState: "exhausted",
        },
      });
    }
    const battleRegistrations =
      generateBattleImmediateEffectRegistrations(recoverDefinition);
    const blockRegs = battleRegistrations.filter(
      (r) => r.effectIndex === 0 || r.effectIndex === 1
    );
    expect(blockRegs.length).toBeGreaterThan(0);
    for (const reg of blockRegs) {
      expect(reg.choices?.[1]).toMatchObject({
        requiredTargetCount: 2,
        requiredPayCostAmount: 2,
        targetStepId: "__step_1",
        targetGatedByConditionalCost: true,
      });
    }
  });

  function runX05(...args: Parameters<typeof runEffect>): GameState {
    // この補助は前段の実行を選んだ後の原子的な支払い/rollbackを検証する。
    // GUI相当の任意選択・支払い源選択は下の battle immediate テストで完走する。
    let state = executeEffect({
      chainId: "test:bssg01-cards:4349",
      state: args[0],
      effect: args[1],
      sourceInstanceId: args[2],
      actingPlayerId: args[3],
      choiceIndex: args[4],
      targetInstanceIds: args[5],
      targetStepId: args[6],
      recordedUsage: args[7],
      payCostPaymentSources: args[8],
      optionalExecuteResumeStepIndex: 0,
      getCardDefinitionById,
    });
    for (let i = 0; i < 10; i++) {
      const choice = state.pendingStepChoice;
      const target = state.pendingEffectTargetSelection;
      if (!choice && !target) return state;
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const action = choice
        ? actions.find(
            (a) =>
              a.kind === "resolve_pending_step_choice" &&
              a.choiceIndex === (args[4] ?? 0)
          )
        : actions.find((a) => a.kind === "resolve_pending_effect_target");
      if (!action) throw new Error("X05 continuation action missing");
      state = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
        targetInstanceIds: args[5] ?? ["amal5-r1", "amal5-r2"],
        payCostPaymentSources: args[8],
      }).state;
      state = acceptOptionalSteps(state, getCardDefinitionById);
    }
    throw new Error("X05 continuation did not finish");
  }

  // 後段に到達した時点の分岐メタデータ。発揮宣言時には持ち上げない。
  const recoverDefinition = {
    ...c,
    effects: c
      .effects!.slice(0, 2)
      .map((e) => ({ ...e, steps: e.steps.slice(2) })),
  };

  function setup(withTsukuyomi: boolean): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "amal5-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(card("BSSG01-X01"), {
      instanceId: "amal5-e1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const instances = [self, enemy];
    if (withTsukuyomi) {
      // BSSG01-C02 = 「月読 調」（在場）。
      instances.push(
        createCardInstance(card("BSSG01-C02"), {
          instanceId: "amal5-tsuku",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        })
      );
    }
    return {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: instances,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 3 } : p
      ),
    };
  }

  function setupWithRecoverTargets(
    reserveNormalCoreCount: number,
    options: {
      soulCoreInReserve?: boolean;
      recoverTargetCount?: 1 | 2 | 3;
    } = {}
  ): GameState {
    const base = setup(false);
    const recoverTargetCount = options.recoverTargetCount ?? 2;
    const recoverTarget1 = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal5-r1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const recoverTarget2 = createCardInstance(card("BSSG01-M01"), {
      instanceId: "amal5-r2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const recoverTarget3 = createCardInstance(card("BSSG01-C03"), {
      instanceId: "amal5-r3",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const recoverTargets = [
      recoverTarget1,
      ...(recoverTargetCount >= 2 ? [recoverTarget2] : []),
      ...(recoverTargetCount >= 3 ? [recoverTarget3] : []),
    ];
    return {
      ...base,
      cardInstances: [...base.cardInstances, ...recoverTargets],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveNormalCoreCount,
              ...(options.soulCoreInReserve === false
                ? { soulCoreLocation: { kind: "trash" as const } }
                : {}),
            }
          : p
      ),
    };
  }

  const exhaustStateOf = (state: GameState, instanceId: string) =>
    state.cardInstances.find((c) => c.instanceId === instanceId)?.exhaustState;

  const reserveOf = (state: GameState, playerId: string) =>
    state.players.find((p) => p.id === playerId)?.reserveNormalCoreCount ?? 0;

  function recordX05Usage(state: GameState) {
    const usageLimit = c.effects![1]!.usageLimit!;
    const recordedUsage: RecordedEffectUsage = {
      effectLabel: "effect:1",
      usageLimit,
      groupId: "BSSG01-X05-advent-bp-down",
    };
    return {
      recordedUsage,
      state: recordEffectUsageIfLimited({
        state,
        sourceInstanceId: "amal5-1",
        sourceDefinitionId: "BSSG01-X05",
        playerId: "alice",
        effectLabel: recordedUsage.effectLabel,
        usageLimit,
        groupId: recordedUsage.groupId,
      }),
    };
  }

  it("任意ことで構文: 支払わない分岐ではBP-だけ解決し、回復も2コスト支払いも行わない", () => {
    const state = setupWithRecoverTargets(3);
    const after = runX05(state, c.effects![1]!, "amal5-1", "alice", 0);

    expect(reserveOf(after, "alice")).toBe(reserveOf(state, "alice"));
    expect(exhaustStateOf(after, "amal5-r1")).toBe("exhausted");
    expect(exhaustStateOf(after, "amal5-r2")).toBe("exhausted");
    expect(
      after.log.some((line) => line.startsWith("effect:pay_cost:alice:2"))
    ).toBe(false);
  });

  it("任意ことで構文: 2コスト支払う分岐では自分の2体を回復する", () => {
    const state = setupWithRecoverTargets(3);
    const noPay = runX05(state, c.effects![1]!, "amal5-1", "alice", 0);
    const after = runX05(state, c.effects![1]!, "amal5-1", "alice", 1);

    expect(reserveOf(after, "alice")).toBe(reserveOf(noPay, "alice") - 2);
    expect(exhaustStateOf(after, "amal5-r1")).toBe("recovered");
    expect(exhaustStateOf(after, "amal5-r2")).toBe("recovered");
    expect(
      after.players.find((player) => player.id === "alice")!
        .trashNormalCoreCount
    ).toBe(2);
    expect(
      after.log.filter((entry) => entry.startsWith("effect:pay_cost:alice:2:"))
    ).toHaveLength(1);
    expect(after.log).toContain("effect:recover:amal5-r1");
    expect(after.log).toContain("effect:recover:amal5-r2");
  });

  it("任意ことで構文: 前段BP-が成立しなくても後段の2コスト支払いを選べる", () => {
    const state = setupWithRecoverTargets(3, { recoverTargetCount: 2 });
    const noOpponentTargets: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (cardInstance) => cardInstance.controllerPlayerId !== "bob"
      ),
    };
    const after = runX05(
      noOpponentTargets,
      c.effects![1]!,
      "amal5-1",
      "alice",
      1,
      ["amal5-r1", "amal5-r2"],
      "__step_3"
    );

    expect(reserveOf(after, "alice")).toBe(
      reserveOf(noOpponentTargets, "alice") - 2
    );
    expect(exhaustStateOf(after, "amal5-r1")).toBe("recovered");
    expect(exhaustStateOf(after, "amal5-r2")).toBe("recovered");
    expect(
      after.log.some((line) => line.startsWith("effect:pay_cost:alice:2"))
    ).toBe(true);
    expect(after.log).toContain("effect:recover:amal5-r1");
    expect(after.log).toContain("effect:recover:amal5-r2");
  });

  it("任意ことで構文: 指定した回復対象IDは後続recover stepでだけ消費する", () => {
    const state = setupWithRecoverTargets(3, { recoverTargetCount: 3 });
    const after = runX05(
      state,
      c.effects![1]!,
      "amal5-1",
      "alice",
      1,
      ["amal5-r2", "amal5-r3"],
      "__step_3"
    );

    expect(exhaustStateOf(after, "amal5-r1")).toBe("exhausted");
    expect(exhaustStateOf(after, "amal5-r2")).toBe("recovered");
    expect(exhaustStateOf(after, "amal5-r3")).toBe("recovered");
    expect(after.log).toContain("effect:recover:amal5-r2");
    expect(after.log).toContain("effect:recover:amal5-r3");
  });

  it("任意ことで構文: 支払わない分岐でも前段BP-効果のusageLimitは払い戻さない", () => {
    const state = setupWithRecoverTargets(3);
    const recorded = recordX05Usage(state);
    expect(recorded.state.effectUsageRecords).toHaveLength(1);

    const after = runX05(
      recorded.state,
      c.effects![1]!,
      "amal5-1",
      "alice",
      0,
      undefined,
      undefined,
      recorded.recordedUsage
    );

    expect(after.effectUsageRecords).toHaveLength(1);
    expect(after.effectUsageRecords[0]).toMatchObject({
      effectLabel: "effect:1",
      groupId: "BSSG01-X05-advent-bp-down",
      count: 1,
    });
  });

  it("任意ことで構文: 支払い分岐のregistration候補は疲労中の自分3体を列挙し2体選択を要求する", () => {
    const state = setupWithRecoverTargets(3, { recoverTargetCount: 3 });
    const reg = generateTriggeredEffectRegistrations(recoverDefinition).find(
      (r) => r.effectIndex === 1
    )!;
    const payChoice = reg.choices?.[1];
    if (!payChoice) throw new Error("expected X05 pay choice");

    const candidates = getCandidateTargetInstanceIds(
      state,
      "alice",
      payChoice,
      {
        getCardDefinitionById,
        sourceInstanceId: "amal5-1",
      }
    );

    expect(payChoice.requiredTargetCount).toBe(2);
    expect(payChoice.requiredPayCostAmount).toBe(2);
    expect(payChoice.targetStepId).toBe("__step_1");
    expect(candidates).toEqual(["amal5-r1", "amal5-r2", "amal5-r3"]);
  });

  it("任意ことで構文: 回復対象が1体だけなら2コスト支払い分岐でも部分回復しない", () => {
    const state = setupWithRecoverTargets(3, { recoverTargetCount: 1 });
    const noPay = runX05(state, c.effects![1]!, "amal5-1", "alice", 0);
    const after = runX05(state, c.effects![1]!, "amal5-1", "alice", 1);

    expect(reserveOf(after, "alice")).toBe(reserveOf(noPay, "alice"));
    expect(exhaustStateOf(after, "amal5-r1")).toBe("exhausted");
    expect(after.log).toContain(
      "effect:conditional-cost-target-shortage:amal5-1"
    );
    expect(
      after.log.some((line) => line.startsWith("effect:pay_cost:alice:2"))
    ).toBe(false);
  });

  it("任意ことで構文: 支払いで選択済み回復対象が消えるなら支払い分岐はrollbackする", () => {
    const state = setupWithRecoverTargets(2, { recoverTargetCount: 2 });
    const noPay = runX05(state, c.effects![1]!, "amal5-1", "alice", 0);
    const after = runX05(
      state,
      c.effects![1]!,
      "amal5-1",
      "alice",
      1,
      undefined,
      undefined,
      undefined,
      [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "amal5-r1", amount: 1 },
      ]
    );

    expect(after.log).toContain(
      "effect:conditional-cost-target-shortage:amal5-1"
    );
    expect(
      after.log.some((line) => line.startsWith("effect:pay_cost:alice:2"))
    ).toBe(false);
    expect(reserveOf(after, "alice")).toBe(reserveOf(noPay, "alice"));
    expect(exhaustStateOf(after, "amal5-r1")).toBe("exhausted");
    expect(exhaustStateOf(after, "amal5-r2")).toBe("exhausted");
    expect(
      after.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "amal5-r1"
      )?.pendingLeaveKind
    ).toBeNull();
  });

  it("任意ことで構文: 回復対象不足で支払い分岐が失敗しても前段BP-効果のusageLimitは払い戻さない", () => {
    const base = setupWithRecoverTargets(3, { recoverTargetCount: 1 });
    const recorded = recordX05Usage(base);
    const after = runX05(
      recorded.state,
      c.effects![1]!,
      "amal5-1",
      "alice",
      1,
      undefined,
      undefined,
      recorded.recordedUsage
    );

    expect(after.log).toContain(
      "effect:conditional-cost-target-shortage:amal5-1"
    );
    expect(after.effectUsageRecords).toHaveLength(1);
    expect(after.effectUsageRecords[0]).toMatchObject({
      effectLabel: "effect:1",
      groupId: "BSSG01-X05-advent-bp-down",
      count: 1,
    });
  });

  function withoutPayableCores(state: GameState): GameState {
    return {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveNormalCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
            }
          : p
      ),
      cardInstances: state.cardInstances.map((cardInstance) =>
        cardInstance.controllerPlayerId === "alice" &&
        cardInstance.zone === "field"
          ? { ...cardInstance, normalCoreCount: 0 }
          : cardInstance
      ),
    };
  }

  it("任意ことで構文: リザーブ0でもフィールド上コアで2コストを支払えるならpending triggeredの支払い分岐は合法手に出る", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const state: GameState = {
      ...setupWithRecoverTargets(0, { soulCoreInReserve: false }),
      pendingTriggeredEffects: [
        {
          pendingId: "x05-pay-cost-gate",
          eventKind: "advent",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:bssg01-cards:4744",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "amal5-1",
          amount: null,
          step: "attack",
          window: "default",
          resolvedSourceInstanceIds: [],
          declaredFromPrivateZone: true,
          declaredSourceInstanceId: "amal5-1",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: registrationIndex,
        },
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");

    expect(actions).toHaveLength(1);
    expect(actions[0]?.choiceIndex).toBeUndefined();
    expect(actions[0]?.deferredChoiceIndexes).toBeUndefined();
    expect(actions[0]?.requiredTargetCount).toBe(0);
    expect(actions[0]?.requiredPayCostAmount).toBeUndefined();
  });

  it("任意ことで構文: リザーブ/フィールド上コアが不足するならpending triggeredの支払い分岐は合法手に出ない", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const state: GameState = {
      ...withoutPayableCores(
        setupWithRecoverTargets(0, { soulCoreInReserve: false })
      ),
      pendingTriggeredEffects: [
        {
          pendingId: "x05-pay-cost-gate-insufficient",
          eventKind: "advent",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:bssg01-cards:4787",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "amal5-1",
          amount: null,
          step: "attack",
          window: "default",
          resolvedSourceInstanceIds: [],
          declaredFromPrivateZone: true,
          declaredSourceInstanceId: "amal5-1",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: registrationIndex,
        },
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");

    expect(actions).toHaveLength(1);
    expect(actions[0]?.choiceIndex).toBeUndefined();
    expect(actions[0]?.deferredChoiceIndexes).toBeUndefined();
  });

  it("任意ことで構文: リザーブ0でもフィールド上コアで2コストを支払えるならbattle immediateの支払い分岐は合法手に出る", () => {
    const regs = generateBattleImmediateEffectRegistrations(c);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const state: GameState = {
      ...setupWithRecoverTargets(0, { soulCoreInReserve: false }),
      battleImmediateEffects: [
        {
          promptId: "x05-battle-pay-cost-gate",
          attackId: "attack-x05",
          timing: "block",
          sourceKind: "spirit",
          sourceInstanceId: "amal5-1",
          sourceDefinitionId: c.cardNo,
          sourceCardNo: c.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:alice:amal5-1",
          registrationIndex,
        },
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).filter(
      (a) => a.kind === "resolve_battle_immediate_effect" && a.skipOnly !== true
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.choiceIndex).toBeUndefined();
    expect(actions[0]?.deferredChoiceIndexes).toBeUndefined();
    expect(actions[0]?.requiredTargetCount).toBe(0);
    expect(actions[0]?.targetStepId).toBeUndefined();
  });

  it("任意ことで構文: battle immediate queueは月読 調の在場条件に合う片側だけを積む", () => {
    const regs = generateBattleImmediateEffectRegistrations(c);
    const presentIndex = regs.findIndex((r) => r.effectIndex === 0);
    const absentIndex = regs.findIndex((r) => r.effectIndex === 1);

    const queueBlockPrompts = (state: GameState) =>
      queueRegisteredBattleImmediateEffects({
        state,
        attackId: "attack-x05",
        participantEntityId: "battle-entity:alice:amal5-1",
        actingPlayerId: "alice",
        sourceCard: state.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "amal5-1"
        )!,
        sourceDefinition: c,
        timing: "block",
        getCardDefinitionById,
        getRegisteredBattleImmediateEffectActions: (cardNo) =>
          cardNo === c.cardNo ? regs : undefined,
      }).battleImmediateEffects.map((prompt) => prompt.registrationIndex);

    expect(queueBlockPrompts(setup(true))).toEqual([presentIndex]);
    expect(queueBlockPrompts(setup(false))).toEqual([absentIndex]);
  });

  it("任意ことで構文: battle immediate legalは条件不成立promptを通常解決に出さずskipOnlyにする", () => {
    const regs = generateBattleImmediateEffectRegistrations(c);
    const presentIndex = regs.findIndex((r) => r.effectIndex === 0);
    const absentIndex = regs.findIndex((r) => r.effectIndex === 1);
    const state: GameState = {
      ...setup(true),
      battleImmediateEffects: [
        {
          promptId: "x05-battle-present",
          attackId: "attack-x05",
          timing: "block",
          sourceKind: "spirit",
          sourceInstanceId: "amal5-1",
          sourceDefinitionId: c.cardNo,
          sourceCardNo: c.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:alice:amal5-1",
          registrationIndex: presentIndex,
        },
        {
          promptId: "x05-battle-absent",
          attackId: "attack-x05",
          timing: "block",
          sourceKind: "spirit",
          sourceInstanceId: "amal5-1",
          sourceDefinitionId: c.cardNo,
          sourceCardNo: c.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:alice:amal5-1",
          registrationIndex: absentIndex,
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).filter((a) => a.kind === "resolve_battle_immediate_effect");

    expect(
      actions.some(
        (a) => a.promptId === "x05-battle-present" && a.skipOnly !== true
      )
    ).toBe(true);
    expect(
      actions.some(
        (a) => a.promptId === "x05-battle-absent" && a.skipOnly !== true
      )
    ).toBe(false);
    expect(
      actions.some(
        (a) => a.promptId === "x05-battle-absent" && a.skipOnly === true
      )
    ).toBe(true);
  });

  it("任意ことで構文: battle immediate支払い分岐は指定したフィールド上コアで2コストを支払い2体回復する", () => {
    const regs = generateBattleImmediateEffectRegistrations(c);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = setupWithRecoverTargets(0, {
      soulCoreInReserve: false,
      recoverTargetCount: 3,
    });
    const payer = createCardInstance(card("BSSG01-C01"), {
      instanceId: "amal5-payer",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, payer],
      battleImmediateEffects: [
        {
          promptId: "x05-battle-pay-field-core",
          attackId: "attack-x05",
          timing: "block",
          sourceKind: "spirit",
          sourceInstanceId: "amal5-1",
          sourceDefinitionId: c.cardNo,
          sourceCardNo: c.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:alice:amal5-1",
          registrationIndex,
        },
      ],
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).find((a) => a.kind === "resolve_battle_immediate_effect");
    expect(action).toBeDefined();
    expect(action?.choiceIndex).toBeUndefined();
    expect(action?.deferredChoiceIndexes).toBeUndefined();

    const payCostPaymentSources: CardCostPaymentSource[] = [
      { kind: "card", instanceId: "amal5-payer", amount: 2 },
    ];
    const declaredState = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).state;
    // 発揮宣言でスタック窓が開く (02:200) → 相手 pass でクローズし、
    // 原文中の「ことで」分岐を選んでから対象・支払い源を確定する。
    let result = declaredState;
    if (result.window === "stack" && result.stackWindow) {
      const opponentId = result.stackWindow.priorityPlayerId;
      result = applyLegalAction({
        state: result,
        action: {
          kind: "pass_stack",
          actionId: `pass:${opponentId}`,
          can: true,
          reason: "test_close",
          actingPlayerId: opponentId,
        },
        getCardDefinitionById,
        getRegisteredBattleImmediateEffectActions: (cardNo) =>
          cardNo === c.cardNo ? regs : undefined,
      }).state;
    }

    result = acceptOptionalSteps(result, getCardDefinitionById);
    expect(result.pendingStepChoice).not.toBeNull();
    const choiceAction = getLegalActions({
      state: result,
      actingPlayerId: result.pendingStepChoice!.choosingPlayerId,
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === 1
    );
    expect(choiceAction).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: choiceAction!,
      payCostPaymentSources,
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).state;

    expect(result.pendingCoreSourceAllocation).not.toBeNull();
    const coreAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    result = applyLegalAction({
      state: result,
      action: coreAction,
      coreSourceAllocations: { "amal5-payer": 2 },
      getCardDefinitionById,
    }).state;
    expect(result.pendingStepOptionalTargetSelection).not.toBeNull();
    const targetAction = getLegalActions({
      state: result,
      actingPlayerId: result.pendingStepOptionalTargetSelection!.actingPlayerId,
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(targetAction).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: targetAction!,
      targetInstanceIds: ["amal5-r1", "amal5-r2"],
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: (cardNo) =>
        cardNo === c.cardNo ? regs : undefined,
    }).state;

    expect(
      result.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "amal5-payer"
      )?.normalCoreCount
    ).toBe(0);
    expect(exhaustStateOf(result, "amal5-r1")).toBe("recovered");
    expect(exhaustStateOf(result, "amal5-r2")).toBe("recovered");
    expect(result.log).toContain("effect:pay_cost:alice:2:sources=1");
  });

  it("月読 調 在場: field_has -20000 が発揮し field_lacks -10000 は不発", () => {
    const state = setup(true);
    const before = state.activeContinuousEffects.length;
    const present = runX05(state, c.effects![0]!, "amal5-1", "alice");
    expect(present.activeContinuousEffects.length).toBeGreaterThan(before);
    const absent = runX05(state, c.effects![1]!, "amal5-1", "alice");
    expect(absent.activeContinuousEffects.length).toBe(before);
  });

  it("月読 調 不在: field_lacks -10000 が発揮し field_has -20000 は不発", () => {
    const state = setup(false);
    const before = state.activeContinuousEffects.length;
    const present = runX05(state, c.effects![0]!, "amal5-1", "alice");
    expect(present.activeContinuousEffects.length).toBe(before);
    const absent = runX05(state, c.effects![1]!, "amal5-1", "alice");
    expect(absent.activeContinuousEffects.length).toBeGreaterThan(before);
  });

  it("全体BP-10000は後から出た相手にも継続適用されるが、BP0後段は再発揮しない", () => {
    const state = setup(false);
    const after = runX05(state, c.effects![1]!, "amal5-1", "alice");
    const lateDef = card("BSDB01-C02");
    const late = createCardInstance(lateDef, {
      instanceId: "late-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const withLate: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, late],
    };
    expect(
      getEffectiveBp(withLate, late, lateDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    expect(
      withLate.log.some((l) => l.startsWith("effect:send_to_deck:late-spirit:"))
    ).toBe(false);
  });

  it("全体BP-10000の動的CEは相手の効果を受けない対象には適用されない", () => {
    const state = setup(false);
    const immuneCE: ContinuousEffect = {
      effectId: "immune-ce",
      sourceInstanceId: "immune-source",
      sourceDefinitionId: "BSSG01-C02",
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "amal5-e1",
      metadata: { source: "opponent_effect" },
    };
    const protectedState: GameState = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, immuneCE],
    };
    const enemy = protectedState.cardInstances.find(
      (i) => i.instanceId === "amal5-e1"
    )!;
    const enemyDef = card(enemy.definitionId);
    const before = getEffectiveBp(
      protectedState,
      enemy,
      enemyDef,
      getCardDefinitionById
    );

    const after = runX05(protectedState, c.effects![1]!, "amal5-1", "alice");

    expect(getEffectiveBp(after, enemy, enemyDef, getCardDefinitionById)).toBe(
      before
    );
  });
});

describe("BSSG01-X04/X05 《召喚条件》（declarative summonCondition）", () => {
  // 召喚条件は CardDefinition.summonCondition（ConditionClause 配列）で宣言し、
  // canSummonUltimate が evaluateCondition（SSOT）で宣言前判定する。10_rules/04 L190-194。
  function handState(
    ultNo: string,
    fieldNo: string | null
  ): { state: GameState; instId: string } {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ult = createCardInstance(card(ultNo), {
      instanceId: "ult-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const insts = [ult];
    if (fieldNo) {
      insts.push(
        createCardInstance(card(fieldNo), {
          instanceId: "field-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        })
      );
    }
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: insts,
    };
    return { state, instId: "ult-1" };
  }
  const evalOpts = (instId: string) => ({
    sourceInstanceId: instId,
    evaluateCondition,
  });

  it("X04: summonCondition が field_has「暁 切歌」で宣言され、旧 stub effect は撤去", () => {
    const x = card("BSSG01-X04");
    expect(x.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "暁 切歌" }],
      minCount: 1,
    });
    expect((x.effects ?? []).some((e) => e.stub?.includes("召喚条件"))).toBe(
      false
    );
  });

  it("X04: 「暁 切歌」不在では召喚不可、在場で召喚可", () => {
    const x = card("BSSG01-X04");
    const absent = handState("BSSG01-X04", null);
    expect(
      canSummonUltimate(
        absent.state,
        "alice",
        x,
        getCardDefinitionById,
        evalOpts(absent.instId)
      )
    ).toBe(false);
    // BSSG01-C01 の name は "暁 切歌"（部分一致）。
    const present = handState("BSSG01-X04", "BSSG01-C01");
    expect(
      canSummonUltimate(
        present.state,
        "alice",
        x,
        getCardDefinitionById,
        evalOpts(present.instId)
      )
    ).toBe(true);
  });

  it("X05: 「月読 調」不在では召喚不可、在場で召喚可", () => {
    const x = card("BSSG01-X05");
    expect(x.summonCondition?.[0]).toMatchObject({
      kind: "field_has",
      cardNames: [{ contains: "月読 調" }],
    });
    const absent = handState("BSSG01-X05", null);
    expect(
      canSummonUltimate(
        absent.state,
        "alice",
        x,
        getCardDefinitionById,
        evalOpts(absent.instId)
      )
    ).toBe(false);
    // BSSG01-C02 の name は "月読 調"。
    const present = handState("BSSG01-X05", "BSSG01-C02");
    expect(
      canSummonUltimate(
        present.state,
        "alice",
        x,
        getCardDefinitionById,
        evalOpts(present.instId)
      )
    ).toBe(true);
  });

  it("evaluator 注入が無いと条件付き ultimate は塞がれる（配線漏れ検知）", () => {
    const present = handState("BSSG01-X04", "BSSG01-C01");
    expect(
      canSummonUltimate(
        present.state,
        "alice",
        card("BSSG01-X04"),
        getCardDefinitionById,
        {
          sourceInstanceId: present.instId,
        }
      )
    ).toBe(false);
  });
});
