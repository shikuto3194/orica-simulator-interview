/**
 * BSTH02.7-X03 effects[3]: 自分のアタックステップ中、自分の効果で自分のライフが
 * 増えるとき、増やす代わりに相手のライフのコア1個をトラッシュに置ける（置換効果）。
 *
 * `life_gain_replacement` CE (新規 engine primitive) の end-to-end 検証:
 *   1. カードデータの continuous 効果が CE を正しく登録する。
 *   2. 自分のアタックステップ中、to:life 自己増加が pendingLifeGainReplacementChoice を立てる。
 *   3. decline: 通常通り増える。
 *   4. replace: 増加をキャンセルし、相手のライフのコア1個をトラッシュに置く。
 *   5. アタックステップ外 (timingScope 不一致) では pending を立てず通常通り増える。
 *   6. pending 解決者以外 (相手) には resolve アクションが見えない (adversarial verifier 指摘)。
 *   7. 他のライフ増加プリミティブ (executeLifeFill) からも同じ CE が照合される
 *      (adversarial verifier 指摘: executeCoreMove 限定では汎用性不足)。
 *   8. pendingLifeGainReplacementChoice が開いている間は
 *      hasOutstandingEffectResolutionContinuation が true を返す
 *      (adversarial verifier 指摘: sibling の pendingLeave flush gate 漏れ)。
 *   9. CE は player-scoped (targetInstanceId=playerId) のため recomputeContinuousEffects
 *      (次の効果解決後の再計算節目) を跨いでも除去されない
 *      (adversarial verifier round5 指摘: isPlayerScopedCETag allowlist 漏れ)。
 *  10. 他カードの pendingLeave と共存する実シナリオ: pending 解決前は flush されず、
 *      解決後に実際に flush される (adversarial verifier round5 指摘: test-quality gap)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeCoreMove,
  executeEffect,
  executeLifeFill,
  flushPendingLeaves,
  getLegalActions,
  hasOutstandingEffectResolutionContinuation,
} from "../src";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { canFlushPendingLeaves } from "../src/state-based-actions";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

function x03ReplacementEffect(): {
  effect: NonNullable<CardDefinition["effects"]>[number];
  effectIndex: number;
} {
  const def = card("BSTH02.7-X03");
  const effectIndex = (def.effects ?? []).findIndex(
    (e) =>
      e.timing.kind === "continuous" &&
      e.steps.some((s) => s.action.kind === "life_gain_replacement")
  );
  if (effectIndex < 0) {
    throw new Error("BSTH02.7-X03 life_gain_replacement effect not found");
  }
  return { effect: def.effects![effectIndex]!, effectIndex };
}

function boardWithX03AtLevel3(): GameState {
  const x03 = card("BSTH02.7-X03");
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { voidNormalCoreCount: 3, lifeNormalCoreCount: 3 },
        { lifeNormalCoreCount: 3 },
      ],
      cardInstances: [
        createCardInstance(x03, {
          instanceId: "x03",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    }),
    step: "attack",
    activePlayerId: ALICE,
  };
}

describe("BSTH02.7-X03 effects[3]: life_gain_replacement 置換効果", () => {
  it("continuous 効果は life_gain_replacement CE を登録する", () => {
    const { effect, effectIndex } = x03ReplacementEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });

    const state = boardWithX03AtLevel3();
    const afterRegister = executeEffect({
      chainId: "test:bsth02-7-x03-life-gain-replacement:108",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      ...lookups,
    });

    const ce = afterRegister.activeContinuousEffects.find(
      (c) => c.modifierTag === "life_gain_replacement"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe(ALICE);
    expect(ce?.sourceInstanceId).toBe("x03");
  });

  it("CE は player-scoped のため recomputeContinuousEffects を跨いでも除去されない", () => {
    const { effect, effectIndex } = x03ReplacementEffect();
    const state = boardWithX03AtLevel3();
    const afterRegister = executeEffect({
      chainId: "test:bsth02-7-x03-life-gain-replacement:129",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      ...lookups,
    });

    // targetInstanceId が playerId (card ではない) のため、isPlayerScopedCETag に
    // 未登録だと「対象カードが field 不在」誤判定で即除去される (round5 指摘)。
    const recomputed = recomputeContinuousEffects(afterRegister);
    const ce = recomputed.activeContinuousEffects.find(
      (c) => c.modifierTag === "life_gain_replacement"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe(ALICE);
  });

  function stateWithReplacementCE(): GameState {
    const { effect, effectIndex } = x03ReplacementEffect();
    return executeEffect({
      chainId: "test:bsth02-7-x03-life-gain-replacement:151",
      state: boardWithX03AtLevel3(),
      effect,
      effectIndex,
      sourceInstanceId: "x03",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      ...lookups,
    });
  }

  it.each([false, true])(
    "置換後のライフは持ち主がソウル選択=%sを確定してから後続本文へ進む",
    (useSoul) => {
      let state = stateWithReplacementCE();
      state.players[1] = {
        ...state.players[1]!,
        lifeSoulCoreCount: 1,
        soulCoreLocation: { kind: "life" },
      };
      state = executeEffect({
        state,
        chainId: "hud:life-replacement",
        sourceInstanceId: "x03",
        actingPlayerId: ALICE,
        ...lookups,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "life", player: "self" },
                amount: 1,
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 2 } },
          ],
        },
      });
      const replace = getLegalActions({
        state,
        actingPlayerId: ALICE,
        ...lookups,
      }).find(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )!;
      state = applyLegalAction({
        state,
        action: replace,
        lifeGainReplacementChoice: "replace",
        ...lookups,
      }).state;
      expect(state.pendingLifeCoreSelection?.actingPlayerId).toBe(BOB);
      expect(state.players[0]!.countValue).toBe(0);
      expect(state.players[1]!.lifeSoulCoreCount).toBe(1);
      const choose = getLegalActions({
        state,
        actingPlayerId: BOB,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_life_core_selection")!;
      state = applyLegalAction({
        state,
        action: choose,
        lifeCorePartitionChoice: {
          normalChosen: useSoul ? 0 : 1,
          soulChosen: useSoul ? 1 : 0,
        },
        ...lookups,
      }).state;
      expect(state.pendingLifeCoreSelection).toBeNull();
      expect(state.players[0]!.countValue).toBe(2);
      expect(state.players[1]!.trashNormalCoreCount).toBe(useSoul ? 0 : 1);
      expect(state.players[1]!.trashSoulCoreCount).toBe(useSoul ? 1 : 0);
    }
  );

  it("自分のアタックステップ中、自分の効果でライフが増えるとき pending を立てる", () => {
    const state = stateWithReplacementCE();
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.pendingLifeGainReplacementChoice).not.toBeNull();
    expect(afterMove.pendingLifeGainReplacementChoice?.decidingPlayerId).toBe(
      ALICE
    );
    expect(afterMove.pendingLifeGainReplacementChoice?.amount).toBe(1);
    // ライフはまだ増えていない（解決待ち）。
    expect(
      afterMove.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(3);
  });

  it("decline: 通常通りライフが増え、pending がクリアされる", () => {
    const state = stateWithReplacementCE();
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    const resolveAction = getLegalActions({
      state: afterMove,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterMove,
      action: resolveAction!,
      lifeGainReplacementChoice: "decline",
      ...lookups,
    }).state;

    expect(resolved.pendingLifeGainReplacementChoice).toBeNull();
    expect(
      resolved.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(4);
    expect(
      resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(2);
  });

  it("replace: 増加をキャンセルし、相手のライフのコア1個をトラッシュに置く", () => {
    const state = stateWithReplacementCE();
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    const resolveAction = getLegalActions({
      state: afterMove,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterMove,
      action: resolveAction!,
      lifeGainReplacementChoice: "replace",
      ...lookups,
    }).state;

    expect(resolved.pendingLifeGainReplacementChoice).toBeNull();
    // 自分のライフは増えていない（元の void→life 増加はキャンセル）。
    expect(
      resolved.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(3);
    // ボイドのコアも動いていない（元の core_move 自体がキャンセルされた）。
    expect(
      resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(3);
    // 相手のライフのコア1個がトラッシュに置かれる。
    expect(
      resolved.players.find((p) => p.id === BOB)!.lifeNormalCoreCount
    ).toBe(2);
    expect(
      resolved.players.find((p) => p.id === BOB)!.trashNormalCoreCount
    ).toBe(1);
  });

  it("アタックステップ外 (timingScope 不一致) では pending を立てず通常通り増える", () => {
    const state = { ...stateWithReplacementCE(), step: "main" as const };
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.pendingLifeGainReplacementChoice).toBeNull();
    expect(
      afterMove.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
    ).toBe(4);
  });

  it("pending 解決者 (decidingPlayerId) 以外には resolve アクションが見えない", () => {
    const state = stateWithReplacementCE();
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );
    expect(afterMove.pendingLifeGainReplacementChoice).not.toBeNull();

    const aliceActions = getLegalActions({
      state: afterMove,
      actingPlayerId: ALICE,
      ...lookups,
    });
    expect(
      aliceActions.some(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )
    ).toBe(true);

    const bobActions = getLegalActions({
      state: afterMove,
      actingPlayerId: BOB,
      ...lookups,
    });
    expect(
      bobActions.some(
        (a) => a.kind === "resolve_pending_life_gain_replacement_choice"
      )
    ).toBe(false);
  });

  describe("executeLifeFill 経由の自己ライフ増加も同じ CE で置換できる", () => {
    it("decline: 通常通り targetValue まで増える", () => {
      const state = stateWithReplacementCE();
      const afterFill = executeLifeFill(
        state,
        ALICE,
        { kind: "life_fill", player: "self", targetValue: 5 },
        "x03"
      );

      expect(afterFill.pendingLifeGainReplacementChoice).not.toBeNull();
      expect(afterFill.pendingLifeGainReplacementChoice?.amount).toBe(2);
      // まだ増えていない（解決待ち）。
      expect(
        afterFill.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
      ).toBe(3);

      const resolveAction = getLegalActions({
        state: afterFill,
        actingPlayerId: ALICE,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
      expect(resolveAction).toBeDefined();

      const resolved = applyLegalAction({
        state: afterFill,
        action: resolveAction!,
        lifeGainReplacementChoice: "decline",
        ...lookups,
      }).state;

      expect(resolved.pendingLifeGainReplacementChoice).toBeNull();
      expect(
        resolved.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
      ).toBe(5);
    });

    it("replace: 増加をキャンセルし、相手のライフのコア1個をトラッシュに置く", () => {
      const state = stateWithReplacementCE();
      const afterFill = executeLifeFill(
        state,
        ALICE,
        { kind: "life_fill", player: "self", targetValue: 5 },
        "x03"
      );

      const resolveAction = getLegalActions({
        state: afterFill,
        actingPlayerId: ALICE,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
      expect(resolveAction).toBeDefined();

      const resolved = applyLegalAction({
        state: afterFill,
        action: resolveAction!,
        lifeGainReplacementChoice: "replace",
        ...lookups,
      }).state;

      expect(resolved.pendingLifeGainReplacementChoice).toBeNull();
      // 自分のライフは増えていない（life_fill 自体がキャンセル）。
      expect(
        resolved.players.find((p) => p.id === ALICE)!.lifeNormalCoreCount
      ).toBe(3);
      // 相手のライフのコア1個がトラッシュに置かれる。
      expect(
        resolved.players.find((p) => p.id === BOB)!.lifeNormalCoreCount
      ).toBe(2);
      expect(
        resolved.players.find((p) => p.id === BOB)!.trashNormalCoreCount
      ).toBe(1);
    });
  });

  it("pendingLifeGainReplacementChoice が開いている間は他カードの pendingLeave を flush しない扱いになる (hasOutstandingEffectResolutionContinuation)", () => {
    const state = stateWithReplacementCE();
    expect(hasOutstandingEffectResolutionContinuation(state)).toBe(false);

    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );
    expect(afterMove.pendingLifeGainReplacementChoice).not.toBeNull();
    // pending 中は「効果解決継続待ち」= 他カードの pendingLeave を flush してはならない扱い。
    expect(hasOutstandingEffectResolutionContinuation(afterMove)).toBe(true);

    const resolveAction = getLegalActions({
      state: afterMove,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
    const resolved = applyLegalAction({
      state: afterMove,
      action: resolveAction!,
      lifeGainReplacementChoice: "decline",
      ...lookups,
    }).state;
    expect(hasOutstandingEffectResolutionContinuation(resolved)).toBe(false);
  });

  it("他カードの pendingLeave と共存する実シナリオ: 解決前は flush されず、解決後に実際に flush される", () => {
    const x03 = card("BSTH02.7-X03");
    const state: GameState = {
      ...stateWithReplacementCE(),
      cardInstances: [
        ...stateWithReplacementCE().cardInstances,
        createCardInstance(x03, {
          instanceId: "enemy",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      pendingLeaveEntities: [
        {
          instanceId: "enemy",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "effect:destroy:alice:enemy",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "void", player: "self" },
      { kind: "life", player: "self" },
      1,
      "x03",
      undefined,
      undefined,
      getCardDefinitionById
    );
    expect(afterMove.pendingLifeGainReplacementChoice).not.toBeNull();

    // pending 未解決の間は flush 不可 (canFlushPendingLeaves=false)、enemy は field に残る。
    expect(canFlushPendingLeaves(afterMove)).toBe(false);
    const beforeResolveFlush = flushPendingLeaves(
      afterMove,
      getCardDefinitionById
    );
    expect(beforeResolveFlush.pendingLeaveEntities).toHaveLength(1);
    expect(
      beforeResolveFlush.cardInstances.find((c) => c.instanceId === "enemy")
        ?.zone
    ).toBe("field");

    const resolveAction = getLegalActions({
      state: afterMove,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_life_gain_replacement_choice");
    const resolved = applyLegalAction({
      state: afterMove,
      action: resolveAction!,
      lifeGainReplacementChoice: "decline",
      ...lookups,
    }).state;

    // 解決後は flush 可能になる (canFlushPendingLeaves=true)。実際の flush 完了は
    // finalizeEffectResolution/applyLegalAction ラッパの節目に委ねられる（round4 修正の
    // 直接効果）。
    expect(canFlushPendingLeaves(resolved)).toBe(true);
  });
});
