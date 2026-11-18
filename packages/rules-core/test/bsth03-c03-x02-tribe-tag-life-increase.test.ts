/**
 * engine-effect-tribe-tag-life-increase-trigger: 効果メタ属性としての系統(tribe)タグ
 * primitive (`Effect.effectTribes` → `TriggerContext.sourceTribes`) を
 * BSTH03-C03「ミスティア・ローレライ」effects[1] × BSTH03-X02「[導界者]八意 永琳」
 * effects[1] の実カード組み合わせで検証する。
 *
 * - BSTH03-C03 Lv2-Lv3『召喚/アタック時』: 自分のカウント0・自分のライフ5以下で、
 *   ボイド→自分のライフへコア1個 (このスピリット固有の usageLimit)。相手のカウント
 *   1以上のとき、この効果は系統：「蓬莱」を持つ (`effectTribes`)。
 * - BSTH03-X02 Lv2『自分のアタックステップ』: 自分の系統：「蓬莱」を持つ効果で自分の
 *   ライフが増えたとき (`game_event: core_placed_on_life` + `trigger_tribes:["蓬莱"]`)、
 *   相手のライフのコア1個を相手のリザーブに置く。
 *
 * ライフ増加検知は core_placed_on_life (P3-14 C-2, reduce_life 対称の既存 game_event) を
 * 再利用し、原因効果の系統フィルタだけを新primitiveで表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
const triggerLookup = buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "alice";
const BOB = "bob";
const C03 = cardNoMap.get("BSTH03-C03")!;
const X02 = cardNoMap.get("BSTH03-X02")!;
const c03LifeIncreaseEffect = C03.effects!.find(
  (effect) =>
    effect.timing.kind === "card_event" &&
    Array.isArray(effect.timing.event) &&
    effect.timing.event.includes("summon")
)!;

function buildState(opponentCountValue: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { countValue: 0, voidNormalCoreCount: 5 },
        { countValue: opponentCountValue },
      ],
      cardInstances: [
        createCardInstance(C03, {
          instanceId: "c03-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2, // Lv2
        }),
        createCardInstance(X02, {
          instanceId: "x02-1",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 5, // Lv2 (requiredCores)
        }),
      ],
    }),
    // X02 effects[1] の timingScope: { player: "self", period: "attack" } を満たす。
    activePlayerId: ALICE,
    step: "attack",
  };
}

function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

/** C03 のライフ増加効果を解決し、続けて third-party trigger を queue する。 */
function resolveC03LifeIncreaseAndQueueReactions(before: GameState): GameState {
  const after = executeEffect({
    chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:82",
    state: before,
    effect: c03LifeIncreaseEffect,
    sourceInstanceId: "c03-1",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
  return collectAndQueueTriggerReactions({
    chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:90",
    beforeState: before,
    afterState: after,
    source: "action_resolution",
    causedByPlayerId: ALICE,
    causedBySourceInstanceId: "c03-1",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggerLookup,
    getRegisteredBurstActions: undefined,
  });
}

function drainStackWindow(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((a) => a.kind === "pass_stack");
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
    }).state;
  }
  return current;
}

describe("BSTH03-C03 effects[1]: 相手カウント1以上のとき、この効果は系統「蓬莱」を持つ", () => {
  it("card-data: effectTribes が条件付きで系統「蓬莱」を宣言し、stub が外れている", () => {
    expect(c03LifeIncreaseEffect.stub).toBeUndefined();
    expect(c03LifeIncreaseEffect.effectTribes).toEqual({
      tribes: ["蓬莱"],
      condition: [{ kind: "count_value", player: "opponent", min: 1 }],
    });
  });

  it("ボイドから自分のライフへコア1個を置く (相手カウントに関わらず効果本体は変わらない)", () => {
    const after = executeEffect({
      chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:134",
      state: buildState(1),
      effect: c03LifeIncreaseEffect,
      sourceInstanceId: "c03-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(player(after, ALICE).lifeNormalCoreCount).toBe(6);
    expect(player(after, ALICE).voidNormalCoreCount).toBe(4);
  });
});

describe("BSTH03-X02 effects[1]: 自分の系統「蓬莱」を持つ効果でライフが増えたとき、相手のライフコアをリザーブへ", () => {
  it("card-data: game_event(core_placed_on_life) + trigger_tribes(蓬莱) + min_level2 で表現され、stub が外れている", () => {
    const x02Effect = X02.effects!.find(
      (effect) =>
        effect.timing.kind === "game_event" &&
        effect.timing.event === "core_placed_on_life"
    )!;
    expect(x02Effect.stub).toBeUndefined();
    expect(x02Effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "trigger_source_player", player: "self" },
      { kind: "trigger_tribes", tribes: ["蓬莱"] },
    ]);
    expect(x02Effect.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "life", player: "opponent" },
      to: { kind: "reserve", player: "opponent" },
      amount: 1,
    });
  });

  it("相手のカウント1以上: 系統タグが付与され、X02 が発火して相手のライフコアをリザーブへ移す", () => {
    const before = buildState(1);
    const bobBefore = player(before, BOB);
    const queued = resolveC03LifeIncreaseAndQueueReactions(before);

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "core_placed_on_life"
    );
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: queued,
      action: resolveAction!,
      getCardDefinitionById,
    }).state;
    const final = drainStackWindow(resolved);

    expect(player(final, BOB).lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount - 1
    );
    expect(player(final, BOB).reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
  });

  it("相手のカウント0: 系統タグが付与されず trigger_tribes 条件未充足のため X02 はリスナー候補にならず、pending が積まれない (盤面変化なし)", () => {
    const before = buildState(0);
    const bobBefore = player(before, BOB);
    const queued = resolveC03LifeIncreaseAndQueueReactions(before);

    // trigger_tribes 未充足は listing 段階 (getAvailableTriggeredEffectSourceChoices)
    // の P3-57 condition 事前評価で候補から除外されるため、リスナー不在と同じ扱いで
    // pending 自体が積まれない (「空 pending は積まれない」既存規約)。
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "core_placed_on_life"
    );
    expect(pending).toBeUndefined();

    expect(player(queued, BOB).lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount
    );
    expect(player(queued, BOB).reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount
    );
  });

  it("engine-effect-tribe-tag-life-increase-trigger E2E: 系統「蓬莱」タグ付き効果の発生源が相手(BOB)コントロールなら、collectAndQueueTriggerReactions の listing 段階で X02 が候補外になり pending 自体が積まれない (盤面変化なし)", () => {
    // BOB が C03 をコントロールする状態。C03 effects[1] の effectTribes 条件
    // (「相手のカウント1以上のとき」= C03 コントローラーである BOB から見た相手 = ALICE の
    // カウント) を満たすよう ALICE の countValue を1にする。ALICE の X02 は 自分の(=ALICE
    // 自身の)ライフが「自分の系統：「蓬莱」を持つ効果」(=X02 コントローラー自身の効果) で
    // 増えたときにしか発火してはならないため、BOB コントロールの系統タグ付き効果による
    // ALICE のライフ増加では発火しないことを、実際の state delta 検出パイプライン
    // (collectAndQueueTriggerReactions → 内部の getAvailableTriggeredEffectSourceChoices
    // listing 段階 condition 事前評価) を通して確認する。
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [
          { countValue: 1 },
          { countValue: 0, voidNormalCoreCount: 5 },
        ],
        cardInstances: [
          createCardInstance(C03, {
            instanceId: "c03-bob",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 2, // Lv2
          }),
          createCardInstance(X02, {
            instanceId: "x02-1",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 5, // Lv2 (requiredCores)
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack",
    };
    const aliceBefore = player(before, ALICE);
    const bobBefore = player(before, BOB);

    // BOB コントロールの c03-bob (系統「蓬莱」タグ付き, effectTribes 条件 opponent(=ALICE)
    // count>=1 済) が原因で、ALICE 自身のライフにボイドからコアが1個置かれたことを表す
    // state delta を直接構築する (C03 の DSL 本体は「自分の(=コントローラー自身の)ライフ」
    // にしか置けないため、「相手コントロールの蓬莱タグ付き効果が対象プレイヤーのライフを
    // 増やした」ケースを模擬する目的で before/after を手組みする)。
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              lifeNormalCoreCount: p.lifeNormalCoreCount + 1,
              voidNormalCoreCount: p.voidNormalCoreCount - 1,
            }
          : p
      ),
    };

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:283",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
      causedBySourceInstanceId: "c03-bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "core_placed_on_life"
    );
    expect(pending).toBeUndefined();

    const resolveActions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "x02-1"
    );
    expect(resolveActions).toHaveLength(0);

    expect(player(queued, ALICE).lifeNormalCoreCount).toBe(
      aliceBefore.lifeNormalCoreCount + 1
    );
    const bobAfter = player(queued, BOB);
    expect(bobAfter.lifeNormalCoreCount).toBe(bobBefore.lifeNormalCoreCount);
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount
    );
  });

  it("engine-effect-tribe-tag-life-increase-trigger: trigger_source_player ゲート — 系統タグが一致していても発生源が相手(opponent)由来なら発火しない", () => {
    const x02Effect = X02.effects!.find(
      (effect) =>
        effect.timing.kind === "game_event" &&
        effect.timing.event === "core_placed_on_life"
    )!;
    const before = buildState(1);
    const bobBefore = player(before, BOB);
    const after = executeEffect({
      chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:329",
      state: before,
      effect: x02Effect,
      sourceInstanceId: "x02-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["蓬莱"],
      triggerSourcePlayerId: BOB,
    });
    expect(player(after, BOB).lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount
    );
    expect(player(after, BOB).reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount
    );
  });

  it("engine-effect-tribe-tag-life-increase-trigger: trigger_source_player ゲート — 発生源が自分(self)由来なら系統タグ一致で発火する", () => {
    const x02Effect = X02.effects!.find(
      (effect) =>
        effect.timing.kind === "game_event" &&
        effect.timing.event === "core_placed_on_life"
    )!;
    const before = buildState(1);
    const bobBefore = player(before, BOB);
    const after = executeEffect({
      chainId: "test:bsth03-c03-x02-tribe-tag-life-increase:355",
      state: before,
      effect: x02Effect,
      sourceInstanceId: "x02-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      triggerSourceTribes: ["蓬莱"],
      triggerSourcePlayerId: ALICE,
    });
    expect(player(after, BOB).lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount - 1
    );
    expect(player(after, BOB).reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
  });
});
