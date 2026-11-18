import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { finalizeBattleEndScopeExpirations } from "../src/battle/battle-end-scope-finalize";
import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSSA01 (ソードアートオンライン-アリシゼーション-公理協会編) カードの effects 検証テスト。
 * 夜錆／カウント／転醒・合体・煌臨・創界神中心。
 * 第1サブバッチ（C01/C04/C05/C06/X01/X02）: draw / count_increase / core_move /
 * destroy / send_to_deck / prevent_battle / summon(free) 等の確定効果のみ DSL 変換済み。
 * 自己効果の再発揮起動・発揮税・移動先変更・特定ブレイヴ合体許可は
 * 基盤/DSL 未対応のため per-effect stub。
 * 転醒X01〜X04 / XX01 創界神は転醒-合体/神技 基盤拡張待ちのため未着手（todo 残）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  advanceStep,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getEffectiveReductionSymbolEntries,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  runStateBasedActions,
} from "../src";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import {
  expandCardDefinitionsWithBackFaces,
  generateBattleImmediateEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const expandedCardDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expandedCardDefinitions.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getCardDefinitionById,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
    expandedCardDefinitions
  ),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
    expandedCardDefinitions
  ),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup(
    expandedCardDefinitions
  ),
  getRegisteredHandActivatedEffectActions: buildHandActivatedEffectLookup(
    expandedCardDefinitions
  ),
  getRegisteredMagicActions: buildMagicLookup(expandedCardDefinitions),
};

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bssa01-cards:74",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSSA01-C01 アリス・ツーベルク", () => {
  const c = card("BSSA01-C01");
  it("召喚時 draw + カウント0で+1 / ライフ条件コア移動 / 夜錆支払い時シンボル化", () => {
    const draw = c.effects![0]!;
    expect(draw.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(draw.steps[0]!.action).toEqual({
      kind: "draw",
      count: 1,
      position: "bottom",
    });
    // 下からドロー位置指定が実装され、effects[0] の stub は解消済み。
    expect(draw.stub).toBeUndefined();
    expect(draw.steps[1]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(draw.steps[1]!.condition).toEqual([
      { kind: "count_value", player: "self", max: 0 },
    ]);
    expect(draw.steps[1]!.executionMode).toBe("optional");
    expect(draw.steps[1]!.prompt?.sourceText).toBe(
      "自分のカウント0のとき、自分のカウント+1できる。"
    );

    const coreEff = c.effects![1]!;
    // 「ことで」構文全体が任意のため effect-level optional。各 step は任意化しない。
    expect(coreEff.executionMode).toBe("optional");
    expect(coreEff.steps.map((step) => step.executionMode)).toEqual([
      undefined,
      undefined,
    ]);
    expect(coreEff.condition).toEqual([
      { kind: "life_value", player: "self", max: 5 },
    ]);
    expect(coreEff.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(coreEff.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "life", player: "self" },
      effectKind: "normal_only",
    });
    expect(coreEff.steps[1]!.connector).toBe("conditional_cost");
    // 配置先「このスピリット」= this_card（自分フィールド曖昧配置でなく source 固定）。
    // 《ソウルコア》以外は effectKind:"normal_only" で明示除外する
    // （省略するとトラッシュに通常+ソウル混在時に pendingLifeCoreSelection でソウルコアも
    // 選択候補に出てしまう GUI 誤表示バグを誘発する）。
    expect(coreEff.stub).toBeUndefined();
    expect(coreEff.steps[1]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "this_card" },
    });

    // [6,7] 夜錆カードの召喚/配置コスト支払い時限定でシンボルを白/紫としても扱う。
    // 支払い文脈限定 treat_as (whenPayingForFilter) で実装され stub 解消済み。
    const symbolEff = c.effects![2]!;
    expect(symbolEff.stub).toBeUndefined();
    const action = symbolEff.steps[0]!.action;
    expect(action.kind).toBe("treat_as");
    if (action.kind === "treat_as") {
      expect(action.whenPayingForFilter).toEqual({ tribes: ["夜錆"] });
      expect(action.asColor).toEqual(["white", "purple"]);
    }
  });

  it("ライフ条件コア移動 実行: trash→life(通常コア) + void→this_card", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "alice-self",
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
        p.id === "alice"
          ? {
              ...p,
              lifeNormalCoreCount: 3, // ライフ5以下条件を満たす
              trashNormalCoreCount: 2,
              voidNormalCoreCount: 4,
            }
          : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "alice-self", "alice");
    const alice = result.players.find((p) => p.id === "alice")!;
    // trash→life: 通常コア1個（ソウルコアは動かさない）
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(alice.trashNormalCoreCount).toBe(1);
    // void→this_card: ボイド1個がこのスピリットへ
    expect(alice.voidNormalCoreCount).toBe(3);
    const updated = result.cardInstances.find(
      (x) => x.instanceId === "alice-self"
    )!;
    expect(updated.normalCoreCount).toBe(2);
  });

  it("召喚時 実行: ドロー後のカウント0なら+1は step optional として実行/辞退を選べる", () => {
    const self = createCardInstance(c, {
      instanceId: "alice-self",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSA01-C04"), {
      instanceId: "deck-bottom",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self, deckCard],
      playerOverrides: [{ countValue: 0 }, {}],
    });

    const pending = runEffect(state, c.effects![0]!, "alice-self", "alice");
    expect(
      pending.cardInstances.filter(
        (x) => x.zone === "hand" && x.controllerPlayerId === "alice"
      )
    ).toHaveLength(1);
    expect(pending.players.find((p) => p.id === "alice")!.countValue).toBe(0);
    expect(pending.pendingStepOptionalChoice).toMatchObject({
      stepIndex: 1,
      prompt: {
        sourceText: "自分のカウント0のとき、自分のカウント+1できる。",
      },
    });

    const choices = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...effectLookups,
    }).filter(
      (action) => action.kind === "resolve_pending_step_optional_choice"
    );
    const execute = choices.find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    const decline = choices.find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(execute).toBeDefined();
    expect(decline).toBeDefined();

    const afterDecline = applyLegalAction({
      state: pending,
      action: decline!,
      ...effectLookups,
    }).state;
    expect(afterDecline.players.find((p) => p.id === "alice")!.countValue).toBe(
      0
    );
    expect(afterDecline.pendingStepOptionalChoice).toBeNull();

    const afterExecute = applyLegalAction({
      state: pending,
      action: execute!,
      ...effectLookups,
    }).state;
    expect(afterExecute.players.find((p) => p.id === "alice")!.countValue).toBe(
      1
    );
    expect(afterExecute.pendingStepOptionalChoice).toBeNull();
  });

  it("ライフ条件コア移動 実行: トラッシュに通常+ソウル混在でもソウルコアは候補外・持ち主選択待ちを発生させない", () => {
    // GUI バグ報告の再現: トラッシュに通常コアとソウルコアが両方あるとき、
    // 「《ソウルコア》以外の」制約により選択の余地なく通常コアだけが動くはず。
    // effectKind:"normal_only" が無いと pendingLifeCoreSelection が立ち、
    // ソウルコアまで選択候補として GUI に出てしまっていた。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "alice-self",
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
        p.id === "alice"
          ? {
              ...p,
              lifeNormalCoreCount: 3, // ライフ5以下条件を満たす
              trashNormalCoreCount: 1,
              trashSoulCoreCount: 1,
              soulCoreLocation: { kind: "trash" as const },
              voidNormalCoreCount: 4,
            }
          : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "alice-self", "alice");
    // 通常/ソウル混在でも真の選択肢が無いため owner-choice pending は発生しない。
    expect(result.pendingLifeCoreSelection).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    // trash→life: 通常コア1個のみ移動。ソウルコアはトラッシュに残ったまま。
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.trashSoulCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    // void→this_card: ボイド1個がこのスピリットへ（conditional_cost 側は影響なし）
    expect(alice.voidNormalCoreCount).toBe(3);
    const updated = result.cardInstances.find(
      (x) => x.instanceId === "alice-self"
    )!;
    expect(updated.normalCoreCount).toBe(2);
  });

  it("召喚時ライフ条件コア移動の legal action は optional として出る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "alice-self",
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
        p.id === "alice"
          ? {
              ...p,
              lifeNormalCoreCount: 3,
              trashNormalCoreCount: 2,
              voidNormalCoreCount: 4,
            }
          : p
      ),
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: "alice",
          eventKind: "summon",
          source: "action_resolution",
          chainId: "test:bssa01-cards:341",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "alice-self",
          amount: 1,
        },
      ],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          effectLookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => undefined,
      }
    );
    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...effectLookups,
    });
    const summonActions = actions.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "alice-self"
    );
    const drawAction = summonActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 0
    );
    const coreAction = summonActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 1
    );
    expect(
      drawAction?.kind === "resolve_pending_triggered_effect" &&
        drawAction.executionMode
    ).toBe("optional");
    expect(
      coreAction?.kind === "resolve_pending_triggered_effect" &&
        coreAction.executionMode
    ).toBe("optional");
  });
});

describe("BSSA01-C02 ユージオ", () => {
  const c = card("BSSA01-C02");
  it("召喚時 void→reserve + 夜錆1枚探索 + カウント0で+1 / 夜錆支払い時シンボル黄紫扱い", () => {
    expect(c.effects).toHaveLength(2);
    const summon = c.effects![0]!;
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps.map((step) => step.executionMode)).toEqual([
      "optional",
      "optional",
      "optional",
    ]);
    expect(summon.steps.map((step) => step.prompt?.sourceText)).toEqual([
      "ボイドからコア1個を自分のリザーブに置ける。",
      "自分のデッキを上から3枚オープンできる。",
      "自分のカウント0のとき、自分のカウント+1できる。",
    ]);
    expect(summon.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
      amount: 1,
    });
    const reveal = summon.steps[1]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(3);
      expect(reveal.picks).toEqual([
        { mandatory: true, count: 1, filter: { tribes: ["夜錆"] } },
      ]);
      expect(reveal.remainder).toBe("bottom");
    }
    expect(summon.steps[2]!.condition).toEqual([
      { kind: "count_value", player: "self", max: 0 },
    ]);

    const treat = c.effects![1]!.steps[0]!.action;
    expect(treat.kind).toBe("treat_as");
    if (treat.kind === "treat_as") {
      expect(treat.asColor).toEqual(["yellow", "purple"]);
      expect(treat.whenPayingForFilter).toEqual({ tribes: ["夜錆"] });
    }
  });

  it("召喚時 実行: ボイドからリザーブへ1個移る", () => {
    const self = createCardInstance(c, {
      instanceId: "eugeo-c02",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
      playerOverrides: [
        { voidNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        {},
      ],
    });
    const coreOnly = { ...c.effects![0]!, steps: [c.effects![0]!.steps[0]!] };
    const pending = runEffect(before, coreOnly, "eugeo-c02", "alice");
    expect(pending.pendingStepOptionalChoice).toMatchObject({
      stepIndex: 0,
      prompt: {
        label: "ボイドからコア1個を自分のリザーブに置く",
        question: "ボイドからコア1個を自分のリザーブに置きますか？",
        sourceText: "ボイドからコア1個を自分のリザーブに置ける。",
      },
    });
    const execute = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(execute).toMatchObject({
      prompt: {
        question: "ボイドからコア1個を自分のリザーブに置きますか？",
      },
    });
    const after = applyLegalAction({
      state: pending,
      action: execute!,
      ...effectLookups,
    }).state;
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(2);
    expect(alice.reserveNormalCoreCount).toBe(1);
  });
});

describe("BSSA01-C03 キリト", () => {
  const c03 = card("BSSA01-C03");

  it("召喚時は2枚まで破棄した枚数を+した合計枚数をドロー + カウント0で+1 / 夜錆支払い時シンボル白黄扱い", () => {
    expect(c03.effects).toHaveLength(2);
    const summon = c03.effects![0]!;
    expect(summon.steps[0]!.id).toBe("discarded");
    expect(summon.steps[0]!.action).toMatchObject({
      kind: "discard",
      count: { min: 0, max: 2 },
    });
    expect(summon.steps[1]!.action).toEqual({
      kind: "draw",
      count: {
        source: { kind: "cards_from_ref", stepId: "discarded" },
        offset: 1,
      },
    });
    expect(summon.steps[0]!.executionMode).toBe("optional");
    expect(summon.steps[1]!.connector).toBe("conditional_cost");
    expect(summon.steps[2]).toMatchObject({
      executionMode: "optional",
      stepCondition: { kind: "ref_count", stepId: "discarded", min: 0, max: 0 },
      action: { kind: "draw", count: 1 },
    });
    expect(summon.steps[3]!.action).toEqual({
      kind: "count_increase",
      player: "self",
      amount: 1,
    });
    expect(summon.steps[3]!.condition).toEqual([
      { kind: "count_value", player: "self", max: 0 },
    ]);
    expect(summon.steps[3]!.executionMode).toBe("optional");
    expect(summon.steps[3]!.prompt?.sourceText).toBe(
      "自分のカウント0のとき、自分のカウント+1できる。"
    );
    const treat = c03.effects![1]!.steps[0]!.action;
    expect(treat.kind).toBe("treat_as");
    if (treat.kind === "treat_as") {
      expect(treat.asColor).toEqual(["white", "yellow"]);
      expect(treat.whenPayingForFilter).toEqual({ tribes: ["夜錆"] });
    }
  });

  it("[board] 召喚時: 2枚破棄すると合計3枚ドローする", () => {
    const filler = card("BSSA01-C01");
    const source = createCardInstance(c03, {
      instanceId: "kirito-c03",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCards = ["hand-1", "hand-2"].map((instanceId) =>
      createCardInstance(filler, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    const deckCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(filler, {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...handCards, ...deckCards],
      playerOverrides: [{ countValue: 1, handCount: 2, deckCount: 5 }, {}],
    });

    const optional = executeEffect({
      chainId: "test:bssa01-cards:555",
      state,
      effect: c03.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "kirito-c03",
      actingPlayerId: "alice",
      ...effectLookups,
    });
    const executeCost = getLegalActions({
      state: optional,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    expect(executeCost).toBeDefined();
    const pending = applyLegalAction({
      state: optional,
      action: executeCost!,
      ...effectLookups,
    }).state;
    expect(pending.pendingZoneSelection).toMatchObject({
      actionKind: "discard_hand",
      maxCount: 2,
      candidateCardInstanceIds: ["hand-1", "hand-2"],
    });
    const beforeDiscard = pending.players.find((p) => p.id === "alice")!;
    expect(beforeDiscard.handCount).toBe(2);
    expect(beforeDiscard.deckCount).toBe(5);

    const resolved = applyLegalAction({
      state: pending,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-1", "hand-2"],
      ...effectLookups,
    }).state;

    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(resolved.pendingZoneSelection).toBeNull();
    expect(alice.handCount).toBe(3);
    expect(alice.deckCount).toBe(2);
    expect(
      resolved.cardInstances
        .filter((ci) => ci.zone === "trash" && ci.ownerPlayerId === "alice")
        .map((ci) => ci.instanceId)
    ).toEqual(expect.arrayContaining(["hand-1", "hand-2"]));
  });
});

describe("BSSA01-R01 ソルティリーナ・セルルト", () => {
  const c = card("BSSA01-R01");
  it("召喚時導界者破壊 / ゲーム1回メイン自己疲労で夜錆3枚まで探索 / シンボル紫白扱い", () => {
    expect(c.effects).toHaveLength(3);
    const destroy = c.effects![0]!.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy" && "filter" in destroy.target) {
      expect(destroy.target.filter.targetsGrandwalker).toBe(true);
      expect(destroy.target.filter.hasMechanic).toEqual(["guided"]);
    }

    const main = c.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
    expect(main.steps[0]!.action).toEqual({
      kind: "set_exhaust_state",
      target: { kind: "self" },
      state: "exhausted",
    });
    const reveal = main.steps[1]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(8);
      expect(reveal.picks).toEqual([
        { count: 3, filter: { tribes: ["夜錆"] } },
      ]);
      expect(reveal.remainder).toBe("top_bottom_split");
    }

    expect(c.effects![2]!.steps[0]!.action).toMatchObject({
      kind: "treat_as",
      aspects: ["symbol"],
      asColor: ["purple", "white"],
    });
  });

  it("メイン効果実行: 残りカードをカードごとにデッキ上/下へ分けて戻せる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "solty-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const nightRust = card("BSSA01-C01");
    const other = card("BSTH01-C01");
    const deckCards = [
      ["r01-night-1", nightRust],
      ["r01-rem-bottom-1", other],
      ["r01-night-2", nightRust],
      ["r01-rem-top-1", other],
      ["r01-rem-bottom-2", other],
      ["r01-night-3", nightRust],
      ["r01-rem-top-2", other],
      ["r01-rem-bottom-3", other],
      ["r01-anchor-1", other],
      ["r01-anchor-2", other],
    ].map(([instanceId, def]) =>
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deckCards],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: deckCards.length } : p
      ),
    };

    const afterReveal = runEffect(state, c.effects![1]!, "solty-1", "alice");
    expect(
      afterReveal.cardInstances.find((ci) => ci.instanceId === "solty-1")
        ?.exhaustState
    ).toBe("exhausted");
    expect(afterReveal.pendingDeckReveal).toMatchObject({
      actingPlayerId: "alice",
      sourceInstanceId: "solty-1",
      remainder: "top_bottom_split",
      revealedCardInstanceIds: [
        "r01-night-1",
        "r01-rem-bottom-1",
        "r01-night-2",
        "r01-rem-top-1",
        "r01-rem-bottom-2",
        "r01-night-3",
        "r01-rem-top-2",
        "r01-rem-bottom-3",
      ],
    });

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    if (!pickAction || pickAction.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("expected deck reveal pick action");
    }
    expect(pickAction.candidateCardInstanceIds).toEqual([
      "r01-night-1",
      "r01-night-2",
      "r01-night-3",
    ]);
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction,
      ...effectLookups,
      selectedDeckRevealCardIds: ["r01-night-1", "r01-night-2", "r01-night-3"],
    }).state;

    const orderAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    if (
      !orderAction ||
      orderAction.kind !== "resolve_pending_deck_reveal_order"
    ) {
      throw new Error("expected deck reveal order action");
    }
    expect(orderAction.remainder).toBe("top_bottom_split");
    expect(orderAction.remainingCardInstanceIds.slice().sort()).toEqual([
      "r01-rem-bottom-1",
      "r01-rem-bottom-2",
      "r01-rem-bottom-3",
      "r01-rem-top-1",
      "r01-rem-top-2",
    ]);

    const resolved = applyLegalAction({
      state: afterPick,
      action: orderAction,
      ...effectLookups,
      deckRevealRemainderOrder: [
        "r01-rem-bottom-1",
        "r01-rem-top-1",
        "r01-rem-bottom-2",
        "r01-rem-top-2",
        "r01-rem-bottom-3",
      ],
      deckRevealRemainderPlacements: {
        "r01-rem-bottom-1": "bottom",
        "r01-rem-top-1": "top",
        "r01-rem-bottom-2": "bottom",
        "r01-rem-top-2": "top",
        "r01-rem-bottom-3": "bottom",
      },
    }).state;

    expect(resolved.pendingDeckReveal).toBeNull();
    expect(
      resolved.cardInstances
        .filter((ci) => ci.ownerPlayerId === "alice" && ci.zone === "hand")
        .map((ci) => ci.instanceId)
    ).toEqual(["r01-night-1", "r01-night-2", "r01-night-3"]);
    expect(
      resolved.cardInstances
        .filter((ci) => ci.ownerPlayerId === "alice" && ci.zone === "deck")
        .map((ci) => ci.instanceId)
    ).toEqual([
      "r01-rem-top-2",
      "r01-rem-top-1",
      "r01-anchor-1",
      "r01-anchor-2",
      "r01-rem-bottom-3",
      "r01-rem-bottom-2",
      "r01-rem-bottom-1",
    ]);
  });
});

describe("BSSA01-X03 アリス・シンセシス・サーティ", () => {
  const c = card("BSSA01-X03");
  it("軽減<六>扱い / ライフ条件コア / エンドステップ回復 / 疲労時相手ライフコア", () => {
    expect(c.effects).toHaveLength(4);
    expect(c.effects![0]!.steps[0]!.action).toEqual({
      kind: "treat_as",
      appliesToCard: true,
      aspects: ["reduction_symbol"],
      asColor: "six",
      cardStateOnly: true,
    });
    expect(c.effects![1]!.condition).toEqual([
      { kind: "life_value", player: "self", max: 6 },
    ]);
    // 《ソウルコア》以外の明示（BSSA01-C01 と同型の GUI 誤表示バグの再発防止）。
    expect(c.effects![1]!.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "life", player: "self" },
      effectKind: "normal_only",
    });
    expect(c.effects![1]!.steps[1]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: {
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"] },
      },
    });
    expect(c.effects![2]!.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "either",
    });
    expect(c.effects![2]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "game",
    });
    expect(c.effects![3]!.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });
  });
});

describe("BSSA01-C04 ロニエ・アラベル", () => {
  const c = card("BSSA01-C04");
  it("召喚時 draw + 導界者ネクサス破壊（hasMechanic guided で創界神除外）", () => {
    const summon = c.effects![0]!;
    expect(summon.stub).toBeUndefined();
    expect(summon.steps[0]!.action.kind).toBe("draw");
    const d = summon.steps[1]!.action;
    expect(d.kind).toBe("destroy");
    if (d.kind === "destroy" && "filter" in d.target) {
      expect(d.target.filter.category).toEqual(["nexus"]);
      expect(d.target.filter.targetsGrandwalker).toBe(true);
      // 「導界者ネクサス」限定（創界神ネクサスは除く）。
      expect(d.target.filter.hasMechanic).toEqual(["guided"]);
    }
  });

  it("メイン再発揮: 疲労コスト+召喚時 payload を activated/main で表現", () => {
    const reexec = c.effects![1]!;
    expect(reexec.stub).toBeUndefined();
    expect(reexec.timing).toEqual({ kind: "activated", mode: "main" });
    expect(reexec.applicability).toEqual({ level: { min: 2, max: 3 } });
    expect(reexec.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    // コスト = set_exhaust_state(self), payload は conditional_cost で連結。
    expect(reexec.steps[0]!.action).toEqual({
      kind: "set_exhaust_state",
      target: { kind: "self" },
      state: "exhausted",
    });
    expect(reexec.steps[1]!.connector).toBe("conditional_cost");
    expect(reexec.steps[1]!.action).toMatchObject({
      kind: "borrow_card_event_effect",
      borrowEvents: ["summon"],
      attributeToBorrowedCard: true,
    });
  });

  it("メイン再発揮 実行: 自身疲労 + 1ドロー + 導界者ネクサスのみ破壊（創界神は対象外）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "ronie-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
      exhaustState: "recovered",
    });
    const deckCard = createCardInstance(card("BSSA01-C01"), {
      instanceId: "deck-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    // 導界者ネクサス（対象になる）と創界神ネクサス（対象外）を両方置く。
    const guidedNexus = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "guided-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const godNexus = createCardInstance(card("BSSA01-XX01"), {
      instanceId: "god-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, deckCard, guidedNexus, godNexus],
    };
    const handBefore = state.players.find((p) => p.id === "alice")!.handCount;
    const result = acceptOptionalSteps(
      runEffect(state, c.effects![1]!, "ronie-2", "alice"),
      getCardDefinitionById
    );
    const ronie = result.cardInstances.find((x) => x.instanceId === "ronie-2")!;
    expect(ronie.exhaustState).toBe("exhausted");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(handBefore + 1);
    expect(
      result.cardInstances.find((e) => e.instanceId === "guided-1")?.zone
    ).toBe("trash");
    // 創界神ネクサスは hasMechanic guided 不一致で対象にならない。
    expect(
      result.cardInstances.find((e) => e.instanceId === "god-1")?.zone
    ).toBe("field");
  });

  it("召喚時 destroy 実行: 相手の導界者ネクサスがトラッシュへ移る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "ronie-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckCard = createCardInstance(card("BSSA01-C01"), {
      instanceId: "deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const enemyNexus = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "nexus-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, deckCard, enemyNexus],
    };
    const result = acceptOptionalSteps(
      runEffect(state, c.effects![0]!, "ronie-1", "alice"),
      getCardDefinitionById
    );
    expect(
      result.cardInstances.find((e) => e.instanceId === "nexus-1")?.zone
    ).toBe("trash");
  });
});

describe("BSSA01-C05 ティーゼ・シュトリーネン", () => {
  const c = card("BSSA01-C05");
  it("召喚時 ボイド→リザーブ + 導界者ネクサスをデッキ下へ / メイン再発揮 stub", () => {
    const summon = c.effects![0]!;
    expect(summon.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: { kind: "reserve", player: "self" },
    });
    const s = summon.steps[1]!.action;
    expect(s.kind).toBe("send_to_deck");
    if (s.kind === "send_to_deck") {
      expect(s.position).toBe("bottom");
      if ("filter" in s.target) {
        expect(s.target.filter.hasMechanic).toEqual(["guided"]);
      }
    }
    expect(summon.stub).toBeUndefined();
    // [1] 再発揮は activated/main + Lv2 限定 + 同名ターン1回。
    const reexec = c.effects![1]!;
    expect(reexec.stub).toBeUndefined();
    expect(reexec.timing).toEqual({ kind: "activated", mode: "main" });
    expect(reexec.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(reexec.steps[0]!.action).toEqual({
      kind: "set_exhaust_state",
      target: { kind: "self" },
      state: "exhausted",
    });
    expect(reexec.steps[1]!.connector).toBe("conditional_cost");
  });

  it("召喚時 実行: ボイドのコア1個がリザーブへ + 相手導界者ネクサスが deck へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "tieze-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyNexus = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "nexus-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemyNexus],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, voidNormalCoreCount: 5, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const result = flushPendingLeaves(
      acceptOptionalSteps(
        runEffect(state, c.effects![0]!, "tieze-1", "alice"),
        getCardDefinitionById
      ),
      getCardDefinitionById
    );
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(4);
    // send_to_deck は pendingLeave を経由し、効果解決後の flush でデッキへ移動する。
    const nexus = result.cardInstances.find((c) => c.instanceId === "nexus-2")!;
    expect(nexus.zone).toBe("deck");
  });

  it("メイン再発揮 実行: 自身疲労 + ボイド→リザーブ + 導界者ネクサスを deck へ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "tieze-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
      exhaustState: "recovered",
    });
    const enemyNexus = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "nexus-3",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemyNexus],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, voidNormalCoreCount: 5, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const result = flushPendingLeaves(
      acceptOptionalSteps(
        runEffect(state, c.effects![1]!, "tieze-2", "alice"),
        getCardDefinitionById
      ),
      getCardDefinitionById
    );
    const tieze = result.cardInstances.find((x) => x.instanceId === "tieze-2")!;
    expect(tieze.exhaustState).toBe("exhausted");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(4);
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-3")!;
    expect(nexus.zone).toBe("deck");
  });
});

describe("BSSA01-C06 Find Your Sword in this Land", () => {
  const c = card("BSSA01-C06");
  const tr07b = card("BSFT01-TR07(B)");

  function registerAttackExhaustCostGate(state: GameState): GameState {
    const gate = tr07b.effects!.find((effect) =>
      effect.steps.some(
        (step) => step.action.kind === "require_attack_exhaust_cost"
      )
    );
    if (!gate) throw new Error("BSFT01-TR07(B) exhaust gate effect missing");
    return runEffect(state, gate, "alice-tr07b", "alice");
  }

  it("BSSA01-C06 effects: 軽減シンボル紫/白扱い + 使用後フィールド残置 + スタック prevent_battle", () => {
    const treat = c.effects![0]!;
    expect(treat.stub).toBeUndefined();
    const treatAction = treat.steps[0]!.action;
    expect(treatAction.kind).toBe("treat_as");
    if (treatAction.kind === "treat_as") {
      expect(treatAction.appliesToCard).toBe(true);
      expect(treatAction.aspects).toEqual(["reduction_symbol"]);
      expect(treatAction.asColor).toEqual(["purple", "white"]);
    }

    expect(c.effects![1]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.steps.at(-1)!.action).toEqual({
      kind: "move_self",
      destination: "field",
    });
    const stack = c.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    const pb = stack.steps[0]!.action;
    expect(pb.kind).toBe("prevent_battle");
    if (pb.kind === "prevent_battle") {
      expect(pb.restriction).toEqual(["attack", "block"]);
      expect(pb.duration.scope).toBe("battle");
    }
    expect(stack.steps.at(-1)!.action).toEqual({
      kind: "move_self",
      destination: "field",
    });
  });

  it("BSSA01-C06 reductionSymbols は黄スロットを紫/白としても扱う", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const entries = getEffectiveReductionSymbolEntries(
      c,
      state,
      "alice",
      getCardDefinitionById,
      undefined,
      undefined
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [...entry.colors].sort())).toEqual([
      ["purple", "white", "yellow"].sort(),
      ["purple", "white", "yellow"].sort(),
    ]);
  });

  it("BSSA01-C06 を use_magic で使用すると効果解決後にフィールドへ置かれる", () => {
    const magic = createCardInstance(c, {
      instanceId: "find-sword-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magic],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { reserveNormalCoreCount: 0 },
      ],
    });
    const mainState: GameState = {
      ...state,
      activePlayerId: "alice",
      step: "main",
    };
    const useMagic = getLegalActions({
      state: mainState,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "find-sword-1"
    );
    expect(useMagic).toBeDefined();
    const afterUse = applyLegalAction({
      state: mainState,
      action: useMagic!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...effectLookups,
    }).state;
    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...effectLookups,
    }).state;
    const placed = afterPass.cardInstances.find(
      (instance) => instance.instanceId === "find-sword-1"
    )!;
    expect(placed.zone).toBe("field");
  });

  it("BSSA01-C06 スタック効果は指定スピリットを次の battle_end まで攻防不可にする", () => {
    const magic = createCardInstance(c, {
      instanceId: "find-sword-stack",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const target = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magic, target],
    });

    const resolved = executeEffect({
      chainId: "test:bssa01-cards:1204",
      state: { ...state, activePlayerId: "alice", step: "attack" },
      effect: c.effects![2]!,
      sourceInstanceId: "find-sword-stack",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    const battleBan = resolved.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "prevent_battle_both" &&
        ce.targetInstanceId === "bob-target"
    );
    expect(battleBan).toMatchObject({
      duration: { scope: "battle" },
      createdAtAttackId: null,
    });
    expect(
      getAttackDeclarationBlockReason({
        state: {
          ...resolved,
          activePlayerId: "bob",
          step: "attack",
          window: "none",
          activeAttack: null,
        },
        actingPlayerId: "bob",
        sourceInstanceId: "bob-target",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");

    const afterBattleEnd = {
      ...resolved,
      activeContinuousEffects: removeExpiredContinuousEffects(resolved, {
        kind: "battle_end",
        attackId: "attack:next:1",
      }),
    };
    expect(
      afterBattleEnd.activeContinuousEffects.find(
        (ce) => ce.effectId === battleBan!.effectId
      )
    ).toBeUndefined();
    expect(
      getAttackDeclarationBlockReason({
        state: {
          ...afterBattleEnd,
          activePlayerId: "bob",
          step: "attack",
          window: "none",
          activeAttack: null,
        },
        actingPlayerId: "bob",
        sourceInstanceId: "bob-target",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("BSSA01-C06 の pre-declaration stack 使用で攻撃宣言が不正化したらキャンセルする", () => {
    const magic = createCardInstance(c, {
      instanceId: "find-sword-pre-stack",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-pre-stack-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, attacker],
        playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      turnNumber: 2,
    };

    const attack = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "attack" && a.sourceInstanceId === "bob-pre-stack-attacker"
    );
    expect(attack).toBeDefined();
    const tentative = applyLegalAction({
      state,
      action: attack!,
      ...effectLookups,
    }).state;
    expect(tentative.window).toBe("pre_declaration_stack");
    expect(tentative.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-pre-stack-attacker",
      priorityPlayerId: "alice",
    });

    const stackMagic = getLegalActions({
      state: tentative,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "find-sword-pre-stack" &&
        a.timing === "stack"
    );
    expect(stackMagic).toBeDefined();
    const afterMagic = applyLegalAction({
      state: tentative,
      action: stackMagic!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...effectLookups,
    }).state;

    const pass = getLegalActions({
      state: afterMagic,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterMagic,
      action: pass!,
      ...effectLookups,
    }).state;

    expect(afterPass.preDeclarationStackWindow).toBeNull();
    expect(afterPass.activeAttack).toBeNull();
    expect(afterPass.pendingPreDeclarationConfirmation).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-pre-stack-attacker",
    });
    expect(afterPass.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(
      afterPass.pendingEffectTargetSelection?.candidateInstanceIds
    ).toEqual(["bob-pre-stack-attacker"]);

    const resolveTarget = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolveTarget!,
      targetInstanceIds: ["bob-pre-stack-attacker"],
      ...effectLookups,
    }).state;

    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(resolved.preDeclarationStackWindow).toBeNull();
    expect(resolved.activeAttack).toBeNull();
    expect(resolved.log).toContain(
      "attack:cancelled:bob-pre-stack-attacker:legality-changed:source_not_ready"
    );
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "prevent_battle_both" &&
          ce.targetInstanceId === "bob-pre-stack-attacker"
      )
    ).toBe(true);
  });

  it("BSSA01-C06 の pre-declaration stack 後再検証は支払済み攻撃疲労コストを誤キャンセルしない", () => {
    const tr07 = createCardInstance(tr07b, {
      instanceId: "alice-tr07b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const magic = createCardInstance(c, {
      instanceId: "find-sword-pre-stack-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-cost-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const costBuddy = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-cost-buddy",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const otherTarget = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-other-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = registerAttackExhaustCostGate({
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [tr07, magic, attacker, costBuddy, otherTarget],
        playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      turnNumber: 2,
    });

    const attack = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "attack" &&
        a.sourceInstanceId === "bob-cost-attacker" &&
        a.attackExhaustCostSourceInstanceId === "bob-cost-buddy"
    );
    expect(attack).toBeDefined();
    const tentative = applyLegalAction({
      state,
      action: attack!,
      ...effectLookups,
    }).state;
    expect(
      tentative.cardInstances.find(
        (card) => card.instanceId === "bob-cost-buddy"
      )?.exhaustState
    ).toBe("exhausted");
    expect(tentative.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-cost-attacker",
      attackExhaustCostSourceInstanceId: "bob-cost-buddy",
    });

    const stackMagic = getLegalActions({
      state: tentative,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "find-sword-pre-stack-cost" &&
        a.timing === "stack"
    );
    expect(stackMagic).toBeDefined();
    const afterMagic = applyLegalAction({
      state: tentative,
      action: stackMagic!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...effectLookups,
    }).state;

    const pass = getLegalActions({
      state: afterMagic,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterMagic,
      action: pass!,
      ...effectLookups,
    }).state;
    expect(afterPass.pendingPreDeclarationConfirmation).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-cost-attacker",
      attackExhaustCostSourceInstanceId: "bob-cost-buddy",
    });
    expect(
      afterPass.pendingEffectTargetSelection?.candidateInstanceIds
    ).toEqual(["bob-cost-attacker", "bob-cost-buddy", "bob-other-target"]);

    const resolveTarget = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolveTarget!,
      targetInstanceIds: ["bob-other-target"],
      ...effectLookups,
    }).state;

    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(resolved.preDeclarationStackWindow).toBeNull();
    expect(resolved.window).toBe("declare_attack");
    expect(resolved.activeAttack).not.toBeNull();
    expect(
      resolved.log.some((entry) => entry.startsWith("attack:cancelled:"))
    ).toBe(false);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "bob-cost-attacker"
      )?.exhaustState
    ).toBe("exhausted");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "bob-cost-buddy"
      )?.exhaustState
    ).toBe("exhausted");
    const attackingEntity = resolved.battleEntities.find(
      (entity) => entity.entityId === resolved.activeAttack!.primaryEntityId
    );
    expect(attackingEntity?.memberInstanceIds).toEqual(["bob-cost-attacker"]);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "prevent_battle_both" &&
          ce.targetInstanceId === "bob-other-target"
      )
    ).toBe(true);
  });
});

describe("BSSA01-X01 修剣士キリト", () => {
  const c = card("BSSA01-X01");

  function kiritoCoreMoveState(
    kiritoCoreCount: number,
    continuousEffects: ContinuousEffect[] = [],
    includeOpponentNexus = false
  ): GameState {
    return rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(c, {
              instanceId: "kirito-x01",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              normalCoreCount: kiritoCoreCount,
            }),
            createCardInstance(card("BSSA01-C01"), {
              instanceId: "bob-spirit",
              ownerPlayerId: "bob",
              controllerPlayerId: "bob",
              zone: "field",
              normalCoreCount: 4,
            }),
            ...(includeOpponentNexus
              ? [
                  createCardInstance(card("BSDB01-C06"), {
                    instanceId: "bob-nexus",
                    ownerPlayerId: "bob",
                    controllerPlayerId: "bob",
                    zone: "field",
                    normalCoreCount: 4,
                  }),
                ]
              : []),
          ],
          playerOverrides: [
            {},
            { reserveNormalCoreCount: 0, trashNormalCoreCount: 0 },
          ],
        }),
        battleEntities: [
          {
            entityId: "kirito-attack",
            memberInstanceIds: ["kirito-x01"],
            resolvedBp: 15000,
            resolvedSymbols: ["purple"],
            attackState: "attacking",
          },
        ],
        activeContinuousEffects: continuousEffects,
        activePlayerId: "alice",
        step: "attack",
      },
      getCardDefinitionById
    );
  }

  function executeKiritoCoreMove(
    kiritoCoreCount: number,
    choiceIndex: number,
    continuousEffects: ContinuousEffect[] = [],
    includeOpponentNexus = false
  ): GameState {
    return executeEffect({
      chainId: "test:bssa01-cards:1607",
      state: kiritoCoreMoveState(
        kiritoCoreCount,
        continuousEffects,
        includeOpponentNexus
      ),
      effect: c.effects![3]!,
      effectIndex: 3,
      sourceInstanceId: "kirito-x01",
      actingPlayerId: "alice",
      choiceIndex,
      getCardDefinitionById,
    });
  }

  function kiritoOverrideProperties(
    properties: NonNullable<ContinuousEffect["metadata"]>["properties"]
  ): ContinuousEffect {
    return {
      effectId: `test-kirito-override-${JSON.stringify(properties)}`,
      sourceInstanceId: "test-source",
      sourceDefinitionId: "TEST-SOURCE",
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: "kirito-x01",
      metadata: { properties },
    };
  }

  function resolveKiritoCoreShoot(state: GameState, amount: number): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      ...effectLookups,
      coreShootDistribution: { "bob-spirit": amount },
    }).state;
  }

  it("軽減多色treat_as実装 / 手札破棄gate / Lv2-3 アタック時コア最大3・Lv3移動先選択", () => {
    // [0] 軽減シンボル白/黄 複数色 treat_as は実装済 (stub でない)。
    const treat = c.effects![0]!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    expect(t.kind).toBe("treat_as");
    if (t.kind === "treat_as") {
      expect(t.aspects).toEqual(["reduction_symbol"]);
      expect(t.appliesToCard).toBe(true);
      expect([...(t.asColor as string[])].sort()).toEqual(["white", "yellow"]);
    }
    // [2,3] 「夜空の剣」「赤薔薇の剣」との合体許可は maxCombinedBraves (host 側名指し合体
    // 許可、BSTH01-X02 と同型) で表現済み。詳細検証は
    // bssa01-x01-named-brave-combine.test.ts。
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.maxCombinedBraves).toEqual({
      count: 2,
      condition: { cardNameContains: ["夜空の剣", "赤薔薇の剣"] },
      effectIndex: 1,
      nameLimits: [
        { cardNameContains: "夜空の剣", maxCount: 1 },
        { cardNameContains: "赤薔薇の剣", maxCount: 1 },
      ],
    });
    expect(c.effects![1]!.applicability).toEqual({
      level: { min: 1, max: 3 },
    });
    const handGate = c.effects![2]!;
    expect(handGate.stub).toBeUndefined();
    expect(handGate.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    expect(handGate.steps[0]!.action).toEqual({
      kind: "gate_flash_stack_hand_discard",
      player: "opponent",
      count: 1,
      targetEffectLabels: ["flash", "stack"],
      duration: { scope: "while_on_field" },
    });
    const atk = c.effects![3]!;
    expect(atk.stub).toBeUndefined();
    expect(atk.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(atk.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(atk.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: {
        kind: "field",
        player: "opponent",
        filter: { category: ["spirit"] },
      },
      to: { kind: "reserve", player: "opponent" },
      amount: { min: 0, max: 3 },
    });
  });

  it("アタック時コア移動: トラッシュ変更は3コア以上でだけ登録し、不成立時はリザーブへ戻る", () => {
    const registration = generateBattleImmediateEffectRegistrations(c).find(
      (reg) => reg.effectIndex === 3
    );
    expect(registration?.choices).toBeUndefined(); // 移動先は効果解決時に動的に選択。

    const twoCoreTrashChoiceFallsBackToReserve = executeKiritoCoreMove(2, 1, [
      kiritoOverrideProperties({ level: "max" }),
    ]);
    expect(
      twoCoreTrashChoiceFallsBackToReserve.pendingCoreShootSelection?.toKind
    ).toBe("reserve");
    expect(
      twoCoreTrashChoiceFallsBackToReserve.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "core_move_destination_replacement"
      )
    ).toBe(false);

    const threeCoreEffectiveLv2TrashChoice = executeKiritoCoreMove(3, 1, [
      kiritoOverrideProperties({ levelCostDelta: 1 }),
    ]);
    expect(
      threeCoreEffectiveLv2TrashChoice.pendingCoreShootSelection?.totalAmount
    ).toBe(3);
    expect(
      threeCoreEffectiveLv2TrashChoice.pendingCoreShootSelection?.toKind
    ).toBe("trash");
  });

  it("アタック時コア移動 実行: choiceIndexでリザーブ/トラッシュの移動先が分岐する", () => {
    const reservePending = executeKiritoCoreMove(3, 0);
    expect(reservePending.pendingCoreShootSelection?.totalAmount).toBe(3);
    const reserveResult = resolveKiritoCoreShoot(reservePending, 3);
    const bobAfterReserve = reserveResult.players.find((p) => p.id === "bob")!;
    expect(bobAfterReserve.reserveNormalCoreCount).toBe(3);
    expect(bobAfterReserve.trashNormalCoreCount).toBe(0);
    expect(
      reserveResult.cardInstances.find((i) => i.instanceId === "bob-spirit")
        ?.normalCoreCount
    ).toBe(1);

    const trashPending = executeKiritoCoreMove(3, 1);
    expect(trashPending.pendingCoreShootSelection?.totalAmount).toBe(3);
    const trashResult = resolveKiritoCoreShoot(trashPending, 3);
    const bobAfterTrash = trashResult.players.find((p) => p.id === "bob")!;
    expect(bobAfterTrash.reserveNormalCoreCount).toBe(0);
    expect(bobAfterTrash.trashNormalCoreCount).toBe(3);
    expect(
      trashResult.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "core_move_destination_replacement"
      )
    ).toBe(true);
    expect(
      trashResult.cardInstances.find((i) => i.instanceId === "bob-spirit")
        ?.normalCoreCount
    ).toBe(1);

    const withNexusPending = executeKiritoCoreMove(3, 0, [], true);
    expect(
      withNexusPending.pendingCoreShootSelection?.candidates.map(
        (candidate) => candidate.instanceId
      )
    ).toEqual(["bob-spirit"]);
  });

  it("BSSA01-X01 は夜空の剣1つと赤薔薇の剣1つだけを追加合体できる", () => {
    expect(c.cardNo).toBe("BSSA01-X01");
    const host = createCardInstance(c, {
      instanceId: "kirito-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nightSword = createCardInstance(card("BSSA01-転醒X01(B)"), {
      instanceId: "night-sword",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const redRoseSword = createCardInstance(card("BSSA01-転醒X02(B)"), {
      instanceId: "red-rose-sword",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const blueRoseSword = createCardInstance(card("BSSA01-転醒X02(A)"), {
      instanceId: "blue-rose-sword",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const suppressor = createCardInstance(card("BSSA01-C01"), {
      instanceId: "suppressor-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const makeState = (
      countValue: number,
      cardInstances = [host, nightSword, redRoseSword, blueRoseSword],
      activeContinuousEffects: ContinuousEffect[] = []
    ): GameState => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      return {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice" ? { ...p, countValue } : p
        ),
        activePlayerId: "alice",
        step: "main",
        window: "none",
        cardInstances,
        activeContinuousEffects,
      };
    };
    const getHostCombineActions = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: "alice",
        ...effectLookups,
      }).filter(
        (action) =>
          action.kind === "brave_combine" &&
          action.targetInstanceId === "kirito-host"
      );

    expect(
      getHostCombineActions(makeState(0)).map(
        (action) => action.braveInstanceId
      )
    ).toEqual([]);
    const levelZeroHost = {
      ...host,
      normalCoreCount: 0,
      attachedChildrenIds: ["night-sword"],
    };
    const levelZeroAttachedNightSword = {
      ...nightSword,
      attachedToInstanceId: "kirito-host",
    };
    expect(
      getHostCombineActions(
        makeState(3, [
          levelZeroHost,
          levelZeroAttachedNightSword,
          redRoseSword,
          blueRoseSword,
        ])
      ).map((action) => action.braveInstanceId)
    ).toEqual([]);
    const suppressedHostWithNight = {
      ...host,
      attachedChildrenIds: ["night-sword"],
    };
    const suppressedAttachedNightSword = {
      ...nightSword,
      attachedToInstanceId: "kirito-host",
    };
    const suppressedState = makeState(
      3,
      [
        suppressedHostWithNight,
        suppressedAttachedNightSword,
        redRoseSword,
        blueRoseSword,
        suppressor,
      ],
      [
        {
          effectId: "suppress:kiritox01:combine",
          sourceInstanceId: "suppressor-1",
          sourceDefinitionId: suppressor.definitionId,
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          targetInstanceId: "kirito-host",
        },
      ]
    );
    expect(
      getHostCombineActions(suppressedState).map(
        (action) => action.braveInstanceId
      )
    ).toEqual([]);
    const suppressedTwoAttachedState = makeState(
      3,
      [
        {
          ...host,
          attachedChildrenIds: ["night-sword", "red-rose-sword"],
        },
        {
          ...nightSword,
          attachedToInstanceId: "kirito-host",
        },
        {
          ...redRoseSword,
          attachedToInstanceId: "kirito-host",
          normalCoreCount: 1,
        },
        blueRoseSword,
        suppressor,
      ],
      suppressedState.activeContinuousEffects
    );
    const afterSuppressedSba = runStateBasedActions(
      suppressedTwoAttachedState,
      getCardDefinitionById
    );
    expect(afterSuppressedSba.state.pendingZoneSelection).toMatchObject({
      actionKind: "brave_separation",
      actingPlayerId: "alice",
      candidateCardInstanceIds: ["night-sword"],
      alternateSelections: [
        { count: 1, candidateInstanceIds: ["red-rose-sword"] },
      ],
    });
    expect(
      afterSuppressedSba.state.cardInstances.find(
        (card) => card.instanceId === "kirito-host"
      )?.attachedChildrenIds
    ).toEqual(["night-sword", "red-rose-sword"]);
    expect(
      getHostCombineActions(makeState(2))
        .map((action) => action.braveInstanceId)
        .sort()
    ).toEqual(["blue-rose-sword", "night-sword"]);

    const combineActions = getHostCombineActions(makeState(3));
    expect(
      combineActions.map((action) => action.braveInstanceId).sort()
    ).toEqual(["blue-rose-sword", "night-sword", "red-rose-sword"]);

    expect(
      combineActions.some(
        (action) => action.braveInstanceId === "blue-rose-sword"
      )
    ).toBe(true);
    const blueAsRedNameLimitState = makeState(
      3,
      [
        {
          ...host,
          attachedChildrenIds: ["red-rose-sword"],
        },
        {
          ...redRoseSword,
          attachedToInstanceId: "kirito-host",
        },
        blueRoseSword,
      ],
      [
        {
          effectId: "rename:blue-as-red",
          sourceInstanceId: "kirito-host",
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties",
          targetInstanceId: "blue-rose-sword",
          metadata: { properties: { cardName: "赤薔薇の剣・複製" } },
        },
      ]
    );
    expect(
      getHostCombineActions(blueAsRedNameLimitState).map(
        (action) => action.braveInstanceId
      )
    ).toEqual([]);

    const hostWithNight = {
      ...host,
      attachedChildrenIds: ["night-sword"],
    };
    const attachedNightSword = {
      ...nightSword,
      attachedToInstanceId: "kirito-host",
    };
    const secondNight = createCardInstance(card("BSSA01-転醒X01(B)"), {
      instanceId: "second-night-sword",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const withSecondNight = makeState(3, [
      hostWithNight,
      attachedNightSword,
      redRoseSword,
      secondNight,
    ]);
    const secondActions = getHostCombineActions(withSecondNight);
    expect(
      secondActions.map((action) => action.braveInstanceId).sort()
    ).toEqual(["red-rose-sword"]);

    const redAction = secondActions[0]!;
    const afterRed = applyLegalAction({
      state: withSecondNight,
      action: redAction,
      ...effectLookups,
    }).state;
    const updatedHost = afterRed.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "kirito-host"
    )!;
    expect(updatedHost.attachedChildrenIds?.sort()).toEqual([
      "night-sword",
      "red-rose-sword",
    ]);
    expect(
      afterRed.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "red-rose-sword"
      )?.attachedToInstanceId
    ).toBe("kirito-host");
  });
});

describe("BSSA01-X02 反逆者アリス", () => {
  const c = card("BSSA01-X02");
  it("召喚/アタック時 夜錆コストなし召喚 / Lv2-3 ライフ条件コア / 疲労時相手ライフコア奪取", () => {
    // [0] 軽減シンボル紫/白 複数色 treat_as は実装済 (stub でない)。
    const treat = c.effects![0]!;
    expect(treat.stub).toBeUndefined();
    const t0 = treat.steps[0]!.action;
    if (t0.kind === "treat_as") {
      expect(t0.aspects).toEqual(["reduction_symbol"]);
      expect(t0.appliesToCard).toBe(true);
      expect([...(t0.asColor as string[])].sort()).toEqual(["purple", "white"]);
    }

    const freeSummon = c.effects![1]!;
    expect(freeSummon.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    const sm = freeSummon.steps[0]!.action;
    expect(sm.kind).toBe("summon");
    if (sm.kind === "summon" && sm.target.kind === "from_zone") {
      expect(sm.target.zone).toEqual(["hand", "set_aside"]);
      expect(sm.target.filter?.tribes).toEqual(["夜錆"]);
      expect(sm.costModifier).toBe("free");
    }

    const lifeCore = c.effects![2]!;
    expect(lifeCore.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "life_value", player: "self", max: 6 },
    ]);

    const exhaustEff = c.effects![3]!;
    expect(exhaustEff.timing).toEqual({ kind: "card_event", event: "exhaust" });
    expect(exhaustEff.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });

    // [5,6] ライフ条件コア: 配置先「自分のスピリット」= field_card spirit filter。stub 解消。
    expect(lifeCore.stub).toBeUndefined();
    // 《ソウルコア》以外の明示（BSSA01-C01 と同型の GUI 誤表示バグの再発防止）。
    expect(lifeCore.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "life", player: "self" },
      effectKind: "normal_only",
    });
    expect(lifeCore.steps[1]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: {
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"] },
      },
    });
  });

  it("ライフ条件コア 実行: void→自分のスピリット(単一候補は自動配置)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "rebel-alice",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              lifeNormalCoreCount: 4, // ライフ6以下条件を満たす
              trashNormalCoreCount: 1,
              voidNormalCoreCount: 3,
            }
          : p
      ),
    };
    const result = runEffect(state, c.effects![2]!, "rebel-alice", "alice");
    const alice = result.players.find((p) => p.id === "alice")!;
    // trash→life: 通常コア1個
    expect(alice.lifeNormalCoreCount).toBe(5);
    // void→field_card(自分のスピリット、候補は自身のみ): 1個配置
    expect(alice.voidNormalCoreCount).toBe(2);
    const updated = result.cardInstances.find(
      (x) => x.instanceId === "rebel-alice"
    )!;
    expect(updated.normalCoreCount).toBe(3);
  });

  it("ライフ条件コア 実行: 候補スピリット複数なら pendingCoreDistribution(プレイヤー選択)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "rebel-alice-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const ally = createCardInstance(card("BSSA01-C01"), {
      instanceId: "ally-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ally],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              lifeNormalCoreCount: 4,
              trashNormalCoreCount: 1,
              voidNormalCoreCount: 3,
            }
          : p
      ),
    };
    const result = runEffect(state, c.effects![2]!, "rebel-alice-2", "alice");
    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.fromKind).toBe("void");
    expect(result.pendingCoreDistribution!.hasSoulCore).toBe(false);
    expect(result.pendingCoreDistribution!.totalNormalCores).toBe(1);
    const candidateIds = result.pendingCoreDistribution!.candidates.map(
      (x) => x.instanceId
    );
    expect(candidateIds).toContain("rebel-alice-2");
    expect(candidateIds).toContain("ally-spirit");
  });
});

describe("BSSA01-転醒X03(A) 修剣士ユージオ", () => {
  const c = card("BSSA01-転醒X03(A)");
  it("召喚時 void→自分のスピリット コア3個 配置先 field_card spirit filter（stub 解消）", () => {
    const summon = c.effects![1]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.stub).toBeUndefined();
    expect(summon.steps[0]!.action).toMatchObject({
      kind: "core_move",
      from: { kind: "void", player: "self" },
      to: {
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"] },
      },
      amount: 3,
    });
  });

  it("召喚時 実行: void3個が自身（単一候補スピリット）へ自動配置", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "blue-alice",
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
        p.id === "alice" ? { ...p, voidNormalCoreCount: 5 } : p
      ),
    };
    const result = runEffect(state, c.effects![1]!, "blue-alice", "alice");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(2);
    const updated = result.cardInstances.find(
      (x) => x.instanceId === "blue-alice"
    )!;
    expect(updated.normalCoreCount).toBe(4);
  });
});

describe("BSSA01-転醒X03(B) ユージオ-物質変換-", () => {
  const front = card("BSSA01-転醒X03(A)");
  const back = card("BSSA01-転醒X03(B)");
  const blueRoseSword = card("BSSA01-転醒X02(A)");

  it("BSSA01-転醒X03(B) printed-cannot-combine-restriction: [board] 効果抑止中の合体と復帰時の強制分離を盤面で再現する", () => {
    // 原文 textLines[6]「このスピリットは合体できない。」は抑制可能な継続効果。
    // 05:26 の通常メイン合体候補と、Q24907 の「抑止中は合体可、復帰時は即分離」を
    // 同一盤面で検証する。静的な【合体条件：合体不可】とは別 carrier である。
    expect(back.textLines?.[6]).toBe("このスピリットは合体できない。");
    expect(back.keywordTags).not.toContain("cannot_combine");
    expect(
      back.effects?.find((effect) => effect.textRef?.includes(6))
    ).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { level: { min: 1, max: 3 } },
      steps: [
        {
          action: {
            kind: "override_properties",
            properties: { keywords: ["cannot_combine"] },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    });

    const ordinaryEugeo = createCardInstance(front, {
      instanceId: "ordinary-eugeo",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const transmutedEugeo = createCardInstance(back, {
      instanceId: "transmuted-eugeo",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const blueRose = createCardInstance(blueRoseSword, {
      instanceId: "blue-rose",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const unrebuiltState: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      window: "none",
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, countValue: 1 } : player
      ),
      cardInstances: [ordinaryEugeo, transmutedEugeo, blueRose],
    };
    const state = rebuildContinuousEffectsFromField(
      unrebuiltState,
      getCardDefinitionById
    );

    const combineActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...effectLookups,
    }).filter(
      (action) =>
        action.kind === "brave_combine" &&
        action.braveInstanceId === "blue-rose"
    );
    expect(combineActions.map((action) => action.targetInstanceId)).toContain(
      "ordinary-eugeo"
    );
    expect(
      combineActions.map((action) => action.targetInstanceId)
    ).not.toContain("transmuted-eugeo");

    // 通常面は候補になることを確認した後、Q24907 と同じ「制約を持つ host と
    // 合体ブレイヴだけ」の盤面へ絞る。分離に必要なコアはリザーブ/host の両方から
    // 選べるため、下で選択を実解決して最終盤面まで検証する。
    const singleHostState: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (instance) => instance.instanceId !== "ordinary-eugeo"
      ),
    };

    const suppression: ContinuousEffect = {
      effectId: "test-suppress-transmuted-eugeo-restriction",
      sourceInstanceId: "test-suppressor",
      sourceDefinitionId: "TEST-SUPPRESSOR",
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      targetInstanceId: "transmuted-eugeo",
      metadata: {
        effectFilter: {
          sourceDefinitionId: back.cardNo,
          effectIndex: 0,
        },
      },
    };
    const whileSuppressed = rebuildContinuousEffectsFromField(
      {
        ...singleHostState,
        activeContinuousEffects: [
          ...singleHostState.activeContinuousEffects,
          suppression,
        ],
      },
      getCardDefinitionById
    );
    const suppressedCombine = getLegalActions({
      state: whileSuppressed,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "brave_combine" &&
        action.braveInstanceId === "blue-rose" &&
        action.targetInstanceId === "transmuted-eugeo"
    );
    expect(suppressedCombine).toBeDefined();
    const afterCombine = applyLegalAction({
      state: whileSuppressed,
      action: suppressedCombine!,
      ...effectLookups,
    }).state;
    expect(
      afterCombine.cardInstances.find(
        (instance) => instance.instanceId === "blue-rose"
      )?.attachedToInstanceId
    ).toBe("transmuted-eugeo");
    expect(
      afterCombine.cardInstances.find(
        (instance) => instance.instanceId === "transmuted-eugeo"
      )?.attachedChildrenIds
    ).toContain("blue-rose");

    const resolveRestoredCannotCombineSeparation = (stabilized: GameState) => {
      expect(
        stabilized.pendingCoreDistribution?.stateBasedBraveSeparation
      ).toEqual({
        hostInstanceId: "transmuted-eugeo",
        braveInstanceId: "blue-rose",
      });
      const coreDistribution = getLegalActions({
        state: stabilized,
        actingPlayerId: "alice",
        ...effectLookups,
      }).find((action) => action.kind === "resolve_pending_core_distribution");
      expect(coreDistribution).toBeDefined();
      const separated = applyLegalAction({
        state: stabilized,
        action: coreDistribution!,
        coreDistributionAllocations: { "blue-rose": 1 },
        coreDistributionSourceAllocations: { reserve: 1 },
        ...effectLookups,
      }).state;
      expect(
        separated.cardInstances.find(
          (instance) => instance.instanceId === "blue-rose"
        )?.attachedToInstanceId
      ).toBeNull();
      expect(
        separated.cardInstances.find(
          (instance) => instance.instanceId === "transmuted-eugeo"
        )?.attachedChildrenIds
      ).not.toContain("blue-rose");
      expect(separated.pendingCoreDistribution).toBeNull();
    };

    // 効果抑制の終了は手作業で CE を差し替えず、実際の End Step cleanup
    // 経路で通す。復帰した合体禁止により SBA が保留コア分配まで作ることを確認する。
    const atEndStep = {
      ...afterCombine,
      step: "end" as const,
      window: "end_step_effects" as const,
    };
    const afterEndStepCleanup = advanceStep(
      atEndStep,
      getCardDefinitionById,
      effectLookups.getRegisteredTriggeredEffectActions
    );
    resolveRestoredCannotCombineSeparation(afterEndStepCleanup);

    // 同じ制約が battle / step scope の抑制から復帰する場合も、各終了経路で
    // source 再構築だけで止めずに SBA まで安定化する。
    const afterBattleEnd = finalizeBattleEndScopeExpirations(
      {
        ...afterCombine,
        activeContinuousEffects: afterCombine.activeContinuousEffects.map(
          (effect) =>
            effect.effectId === suppression.effectId
              ? {
                  ...effect,
                  duration: { scope: "battle" },
                  createdAtAttackId: "suppression-battle",
                }
              : effect
        ),
      },
      "suppression-battle",
      getCardDefinitionById
    );
    resolveRestoredCannotCombineSeparation(afterBattleEnd);

    const afterStepEnd = advanceStep(
      {
        ...afterCombine,
        turnNumber: 2,
        activeContinuousEffects: afterCombine.activeContinuousEffects.map(
          (effect) =>
            effect.effectId === suppression.effectId
              ? { ...effect, duration: { scope: "step" } }
              : effect
        ),
      },
      getCardDefinitionById,
      effectLookups.getRegisteredTriggeredEffectActions
    );
    resolveRestoredCannotCombineSeparation(afterStepEnd);
  });
});

describe("BSSA01-転醒X02(B) 赤薔薇の剣", () => {
  const c = card("BSSA01-転醒X02(B)");

  function buildRedRoseBoardState(): GameState {
    const host = createCardInstance(card("BSSA01-C03"), {
      instanceId: "kirito-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
      attachedChildrenIds: ["red-rose"],
    });
    const brave = createCardInstance(c, {
      instanceId: "red-rose",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
      attachedToInstanceId: "kirito-host",
    });
    const grandwalker = createCardInstance(card("BSSA01-XX01"), {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const guidedNexus = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "bob-guided-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const plainNexus = createCardInstance(card("BSSA01-転醒X01(A)"), {
      instanceId: "bob-plain-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave, grandwalker, guidedNexus, plainNexus],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };
  }

  function resolveRedRoseAttackImmediateEffect(): GameState {
    const state = buildRedRoseBoardState();
    const attack = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "attack" && action.sourceInstanceId === "kirito-host"
    );
    expect(attack).toBeDefined();
    const tentative = applyLegalAction({
      state,
      action: attack!,
      ...effectLookups,
    }).state;
    expect(tentative.window).toBe("pre_declaration_stack");

    const passDeclarationStack = getLegalActions({
      state: tentative,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(passDeclarationStack).toBeDefined();
    const declared = applyLegalAction({
      state: tentative,
      action: passDeclarationStack!,
      ...effectLookups,
    }).state;
    expect(declared.battleImmediateEffects).toHaveLength(1);
    expect(declared.battleImmediateEffects[0]).toMatchObject({
      timing: "attack",
      sourceInstanceId: "kirito-host",
      sourceDefinitionId: "BSSA01-C03",
      sourceEffectInstanceId: "red-rose",
      sourceEffectDefinitionId: "BSSA01-転醒X02(B)",
      sourceCardNo: "BSSA01-転醒X02(B)",
      participantEntityId: "battle-entity:kirito-host",
    });

    const battleImmediate = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceInstanceId === "kirito-host" &&
        action.sourceEffectInstanceId === "red-rose" &&
        action.sourceCardNo === "BSSA01-転醒X02(B)"
    );
    expect(battleImmediate).toBeDefined();
    const openedStack = applyLegalAction({
      state: declared,
      action: battleImmediate!,
      ...effectLookups,
    }).state;
    expect(openedStack.window).toBe("stack");
    expect(openedStack.stackWindow?.pendingStackAction).toMatchObject({
      actionKind: "battle_immediate_effect",
      cardInstanceId: "kirito-host",
      cardDefinitionId: "BSSA01-C03",
      effectSourceInstanceId: "red-rose",
      effectSourceDefinitionId: "BSSA01-転醒X02(B)",
    });

    const passEffectStack = getLegalActions({
      state: openedStack,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(passEffectStack).toBeDefined();
    const resolved = applyLegalAction({
      state: openedStack,
      action: passEffectStack!,
      ...effectLookups,
    }).state;
    expect(resolved.battleImmediateEffects).toHaveLength(0);
    return resolved;
  }

  function resolveOpenCoreDistribution(state: GameState): GameState {
    if (state.pendingCoreDistribution === null) return state;
    const action = getLegalActions({
      state,
      actingPlayerId: state.pendingCoreDistribution.actingPlayerId,
      ...effectLookups,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_core_distribution"
    );
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      ...effectLookups,
      coreDistributionAllocations: {},
    }).state;
  }

  function resolveOpenBurstChecks(state: GameState): GameState {
    let current = state;
    for (let guard = 0; current.pendingBurstChecks.length > 0; guard += 1) {
      if (guard > 8) {
        throw new Error("pendingBurstChecks did not drain");
      }
      const action = ["bob", "alice"]
        .flatMap((actingPlayerId) =>
          getLegalActions({
            state: current,
            actingPlayerId,
            ...effectLookups,
          })
        )
        .find(
          (candidate) =>
            candidate.kind === "resolve_pending_burst_check" ||
            candidate.kind === "decline_pending_burst_check"
        );
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: action!,
        ...effectLookups,
      }).state;
    }
    return current;
  }

  function closeRedRoseBeforeBlockFlash(state: GameState): GameState {
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...effectLookups,
    });
    const openFlash = aliceActions.find(
      (action) =>
        action.kind === "open_battle_flash" &&
        action.flashKind === "before_block"
    );
    expect(openFlash).toBeDefined();
    const opened = applyLegalAction({
      state,
      action: openFlash!,
      ...effectLookups,
    }).state;
    expect(opened.window).toBe("flash_before_block");

    const bobPass = getLegalActions({
      state: opened,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "pass_battle_flash" &&
        action.flashKind === "before_block"
    );
    expect(bobPass).toBeDefined();
    const afterBobPass = applyLegalAction({
      state: opened,
      action: bobPass!,
      ...effectLookups,
    }).state;

    const alicePass = getLegalActions({
      state: afterBobPass,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "pass_battle_flash" &&
        action.flashKind === "before_block"
    );
    expect(alicePass).toBeDefined();
    const closed = applyLegalAction({
      state: afterBobPass,
      action: alicePass!,
      ...effectLookups,
    }).state;
    expect(closed.activeAttack?.flashBeforeBlockCompleted).toBe(true);
    return closed;
  }

  function declineBlockAndResolveBattle(state: GameState): GameState {
    const declineBlock = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    }).find((action) => action.kind === "decline_block");
    expect(declineBlock).toBeDefined();
    return applyLegalAction({
      state,
      action: declineBlock!,
      ...effectLookups,
    }).state;
  }

  it("合体中アタック時: 相手創界神ネクサスすべて破壊 + battle_end 自壊予約 (stub 解消)", () => {
    const eff = c.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(eff.condition).toEqual([{ kind: "combined" }]);

    const destroyGrandwalkers = eff.steps[0]!.action;
    expect(destroyGrandwalkers).toEqual({
      kind: "destroy",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: "only",
        },
        count: "all",
      },
    });
    expect(eff.steps[1]).toMatchObject({
      action: { kind: "destroy", target: { kind: "source_card" } },
      connector: "sequential",
      deferTo: "battle_end",
    });
  });

  it("実行: 創界神対象破壊で導界者も破壊し、このブレイヴ自身は battle_end まで残す", () => {
    const after = resolveOpenBurstChecks(
      resolveOpenCoreDistribution(resolveRedRoseAttackImmediateEffect())
    );

    const grandwalkerAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-grandwalker"
    )!;
    const plainAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-plain-nexus"
    )!;
    const guidedAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-guided-nexus"
    )!;
    const braveAfter = after.cardInstances.find(
      (x) => x.instanceId === "red-rose"
    )!;
    expect(grandwalkerAfter.zone).toBe("trash");
    expect(grandwalkerAfter.pendingLeaveKind).toBeNull();
    expect(guidedAfter.zone).toBe("trash");
    expect(guidedAfter.pendingLeaveKind).toBeNull();
    expect(plainAfter.zone).toBe("field");
    expect(plainAfter.pendingLeaveKind).toBeNull();
    expect(braveAfter.zone).toBe("field");
    expect(braveAfter.pendingLeaveKind).toBeNull();
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    const attackId = after.activeAttack?.attackId;
    expect(attackId).toBeDefined();
    expect(after.pendingBattleEndDeferrals[0]).toMatchObject({
      attackId,
      sourceInstanceId: "kirito-host",
      effectSourceInstanceId: "red-rose",
      effectSourceDefinitionId: "BSSA01-転醒X02(B)",
      resumeFromStepIndex: 1,
    });

    const resolved = {
      state: resolveOpenBurstChecks(
        declineBlockAndResolveBattle(closeRedRoseBeforeBlockFlash(after))
      ),
    };
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    const braveAfterBattleEnd = resolved.state.cardInstances.find(
      (x) => x.instanceId === "red-rose"
    )!;
    expect(braveAfterBattleEnd.zone).toBe("trash");
    expect(braveAfterBattleEnd.pendingLeaveKind).toBeNull();

    const grandwalkerFinal = resolved.state.cardInstances.find(
      (x) => x.instanceId === "bob-grandwalker"
    )!;
    const redRoseFinal = resolved.state.cardInstances.find(
      (x) => x.instanceId === "red-rose"
    )!;
    const guidedFinal = resolved.state.cardInstances.find(
      (x) => x.instanceId === "bob-guided-nexus"
    )!;
    const hostFinal = resolved.state.cardInstances.find(
      (x) => x.instanceId === "kirito-host"
    )!;
    expect(grandwalkerFinal.zone).toBe("trash");
    expect(grandwalkerFinal.pendingLeaveKind).toBeNull();
    expect(guidedFinal.zone).toBe("trash");
    expect(guidedFinal.pendingLeaveKind).toBeNull();
    expect(redRoseFinal.zone).toBe("trash");
    expect(redRoseFinal.pendingLeaveKind).toBeNull();
    expect(redRoseFinal.attachedToInstanceId).toBeNull();
    expect(hostFinal.attachedChildrenIds).not.toContain("red-rose");
  });

  it("battle_end の optional source_card 自壊は pending 再開後も合体ブレイヴを参照する", () => {
    const base = resolveOpenBurstChecks(
      resolveOpenCoreDistribution(resolveRedRoseAttackImmediateEffect())
    );
    const optionalSourceCardDestroy = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          executionMode: "optional",
          deferTo: "battle_end",
          action: { kind: "destroy", target: { kind: "source_card" } },
        },
      ],
      textRef: [0],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const queued = executeEffect({
      chainId: "test:bssa01-cards:2824",
      state: {
        ...base,
        pendingBattleEndDeferrals: [],
      },
      effect: optionalSourceCardDestroy,
      sourceInstanceId: "kirito-host",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: effectLookups.getRegisteredBurstActions,
      effectIndex: 99,
      effectSourceInstanceId: "red-rose",
      effectSourceDefinitionId: c.cardNo,
      sourceCardReferenceInstanceId: "red-rose",
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);
    expect(queued.pendingBattleEndDeferrals[0]).toMatchObject({
      sourceInstanceId: "kirito-host",
      effectSourceInstanceId: "red-rose",
      effectSourceDefinitionId: "BSSA01-転醒X02(B)",
      sourceCardReferenceInstanceId: "red-rose",
      resumeFromStepIndex: 0,
    });

    const pending = declineBlockAndResolveBattle(
      closeRedRoseBeforeBlockFlash(queued)
    );
    expect(pending.pendingStepOptionalChoice).toMatchObject({
      sourceInstanceId: "kirito-host",
      sourceDefinitionId: "BSSA01-C03",
      effectIndex: 99,
      stepIndex: 0,
      continuation: {
        effectSourceInstanceId: "red-rose",
        effectSourceDefinitionId: "BSSA01-転醒X02(B)",
        sourceCardReferenceInstanceId: "red-rose",
      },
    });

    const execute = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    expect(execute).toBeDefined();
    const resolved = applyLegalAction({
      state: pending,
      action: execute!,
      ...effectLookups,
    }).state;

    const redRose = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "red-rose"
    )!;
    const host = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "kirito-host"
    )!;
    expect(redRose.zone).toBe("trash");
    expect(redRose.pendingLeaveKind).toBeNull();
    expect(redRose.attachedToInstanceId).toBeNull();
    expect(host.zone).toBe("field");
    expect(host.pendingLeaveKind).toBeNull();
    expect(host.attachedChildrenIds).not.toContain("red-rose");
  });

  it("battle_end 前にこのブレイヴが場を離れていれば source_card 自壊は no-op", () => {
    const queued = resolveOpenBurstChecks(
      resolveOpenCoreDistribution(resolveRedRoseAttackImmediateEffect())
    );
    const sourceGone: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "red-rose"
          ? {
              ...cardInstance,
              zone: "trash",
              attachedToInstanceId: undefined,
              pendingLeaveKind: null,
            }
          : cardInstance.instanceId === "kirito-host"
            ? { ...cardInstance, attachedChildrenIds: [] }
            : cardInstance
      ),
    };

    const resolved = {
      state: declineBlockAndResolveBattle(
        closeRedRoseBeforeBlockFlash(sourceGone)
      ),
    };

    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    const redRose = resolved.state.cardInstances.find(
      (x) => x.instanceId === "red-rose"
    )!;
    expect(redRose.zone).toBe("trash");
    expect(redRose.pendingLeaveKind).toBeNull();
  });

  it("[2,3] 構造: 転醒時トリガー + optional combine(カード名「キリト」)→ref_succeededゲート付きrecover / stub 解消", () => {
    const eff = c.effects![0]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({ kind: "card_event", event: "rebirth" });
    expect(eff.executionMode).toBe("optional");
    expect(eff.steps[0]).toMatchObject({
      id: "combine",
      action: {
        kind: "brave_combine_effect",
        target: {
          kind: "filter",
          player: "self",
          filter: {
            category: ["spirit", "ultimate"],
            cardName: { contains: "キリト" },
          },
          count: 1,
        },
      },
    });
    expect(eff.steps[1]).toMatchObject({
      action: {
        kind: "set_exhaust_state",
        state: "recovered",
        target: { kind: "ref", stepId: "combine" },
      },
      connector: "sequential",
      stepCondition: { kind: "ref_succeeded", stepId: "combine" },
    });
  });

  it.each(["exhausted", "heavily_exhausted"] as const)(
    "実行: このブレイヴを自分の『キリト』に合体させ、%sから回復状態にする",
    (exhaustState) => {
      const eff = c.effects![0]!;
      const host = createCardInstance(card("BSSA01-X01"), {
        instanceId: "kirito-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
        exhaustState,
      });
      const brave = createCardInstance(c, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "brave",
        normalCoreCount: 1,
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      });
      const state: GameState = {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice" ? { ...p, countValue: 3 } : p
        ),
      };

      const after = runEffect(state, eff, "brave-1", "alice");

      const braveAfter = after.cardInstances.find(
        (x) => x.instanceId === "brave-1"
      )!;
      const hostAfter = after.cardInstances.find(
        (x) => x.instanceId === "kirito-1"
      )!;
      expect(braveAfter.attachedToInstanceId).toBe("kirito-1");
      expect(hostAfter.attachedChildrenIds).toContain("brave-1");
      expect(hostAfter.exhaustState).toBe("recovered");
    }
  );

  it("実行: 自分の『キリト』が場に無ければ合体せず、recoverもゲートで発揮されない", () => {
    const eff = c.effects![0]!;
    const brave = createCardInstance(c, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    });
    const other = createCardInstance(card("BSSA01-C01"), {
      instanceId: "other-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, other],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 3 } : p
      ),
    };

    const after = runEffect(state, eff, "brave-1", "alice");

    const braveAfter = after.cardInstances.find(
      (x) => x.instanceId === "brave-1"
    )!;
    const otherAfter = after.cardInstances.find(
      (x) => x.instanceId === "other-1"
    )!;
    expect(braveAfter.attachedToInstanceId).toBeNull();
    expect(otherAfter.exhaustState).toBe("exhausted");
  });
});
