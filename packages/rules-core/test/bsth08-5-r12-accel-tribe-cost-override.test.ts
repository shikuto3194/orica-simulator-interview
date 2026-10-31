/**
 * BSTH08.5-R12 effects[0]: 「このカードが手元に置かれたターンの間、自分の系統：
 * 「面霊」を持つカードの【アクセル】のコストすべてを0にできる。この効果はゲーム中に
 * 1回しか使えない。」(ENGINE-accel-tribe-cost-override)
 *
 * primitives:
 * - 「置かれたターンの間」= CardInstance.zoneEnteredAtTurn (moveCardZone がスタンプ) +
 *   ConditionClause.self_state:"zone_entered_this_turn"
 * - 「アクセルのコストを0にできる」= cost_modify(player:"self", tribes:["面霊"],
 *   usingEffectMode:["accel"], modifier:"free") → cost_override CE →
 *   getAccelFreeUseSource (accel-change-system.ts) が dual-legal-action で提示
 * - 「ゲーム中に1回」= Effect.usageLimit(kind:"per_card_name", duration:"game")
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import { moveCardZone } from "../src/core/core-system";
import { advanceStep } from "../src/turn-system";
import type { CardDefinition, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH08.5-R12 effects[0]: 面霊アクセルコスト0 (ENGINE-accel-tribe-cost-override)", () => {
  const r12 = cardNoMap.get("BSTH08.5-R12")!;
  const c20 = cardNoMap.get("BSTH08.5-C20")!;

  function buildState(): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const r12Card = createCardInstance(r12, {
      instanceId: "r12-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const c20CardA = createCardInstance(c20, {
      instanceId: "c20-a",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const c20CardB = createCardInstance(c20, {
      instanceId: "c20-b",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    let state: GameState = {
      ...base,
      step: "main",
      window: "none",
      activePlayerId: ALICE,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: 10 } : p
      ),
      cardInstances: [
        r12Card,
        c20CardA,
        c20CardB,
        ...Array.from({ length: 12 }, (_, i) =>
          createCardInstance(cardNoMap.get("BSTH001-C01")!, {
            instanceId: `deck-${i}`,
            ownerPlayerId: ALICE,
            zone: "deck",
          })
        ),
      ],
    };
    // R12 を「今ターン」手元へ (moveCardZone が zoneEnteredAtTurn をスタンプする唯一経路)
    state = moveCardZone(state, "r12-1", "set_aside");
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    return state;
  }

  function listActions(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: () => undefined,
    });
  }

  it("置かれた今ターンは、自分の面霊カードのアクセルが free legal action として列挙される", () => {
    const state = buildState();
    const freeAccel = listActions(state).find(
      (a) =>
        a.kind === "use_accel" &&
        a.sourceInstanceId === "c20-a" &&
        a.costMode === "free"
    );
    expect(freeAccel).toBeDefined();
    expect(freeAccel).toMatchObject({
      finalCost: 0,
      costOverrideSourceInstanceId: "r12-1",
    });
  });

  function apply(
    state: GameState,
    action: LegalAction,
    paymentSources: { kind: "reserve"; amount: number }[] = []
  ) {
    return applyLegalAction({
      state,
      action,
      paymentSources,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
  }
  function settle(state: GameState) {
    for (let i = 0; i < 20; i++) {
      const responses = [ALICE, BOB].flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, getCardDefinitionById })
      );
      const response = responses.find(
        (a) =>
          a.kind === "resolve_pending_deck_reveal_pick" ||
          a.kind === "pass_stack" ||
          a.kind === "pass_pre_declaration_stack" ||
          a.kind === "resolve_pending_burst_check"
      );
      if (!response) {
        expect(state.stackWindow).toBeNull();
        expect(
          state.pendingAccelCleanups,
          JSON.stringify({
            responses,
            queue: state.effectQueueEntries,
            log: state.log.slice(-12),
          })
        ).toHaveLength(0);
        return state;
      }
      state = apply(state, response);
    }
    throw new Error("accel resolution did not settle");
  }
  const free = (state: GameState, id = "c20-a") =>
    listActions(state).find(
      (a) =>
        a.kind === "use_accel" &&
        a.sourceInstanceId === id &&
        a.costMode === "free"
    );
  const usage = (state: GameState) =>
    state.effectUsageRecords.filter((r) => r.sourceInstanceId === "r12-1");
  function useFree(state: GameState, id = "c20-a") {
    expect(free(state, id)).toBeDefined();
    return settle(apply(state, free(state, id)!));
  }

  it("同じターンに面霊アクセル2枚を順に無料宣言・解決し、開始1回だけを記録する", () => {
    let state = buildState();
    expect(usage(state)).toHaveLength(0);
    for (const [i, id] of ["c20-a", "c20-b"].entries()) {
      state = useFree(state, id);
      expect(
        state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
      ).toBe(10);
      expect(state.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "set_aside"
      );
      expect(state.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
        12 - 4 * (i + 1)
      );
      expect(
        state.cardInstances.filter((c) => c.zone === "trash")
      ).toHaveLength(4 * (i + 1));
      expect(usage(state)).toHaveLength(1);
      expect(usage(state)[0]).toMatchObject({ count: 1, duration: "game" });
    }
  });

  it("通常有償variantだけを選んでも無料化は未使用で、続くアクセルを無料にできる", () => {
    let state = buildState();
    const paid = listActions(state).find(
      (a) =>
        a.kind === "use_accel" &&
        a.sourceInstanceId === "c20-a" &&
        a.costMode === "paid"
    )!;
    expect(paid).toMatchObject({ finalCost: 3 });
    state = settle(apply(state, paid, [{ kind: "reserve", amount: 3 }]));
    expect(
      state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(7);
    expect(usage(state)).toHaveLength(0);
    expect(
      state.activeContinuousEffects
        .filter((ce) => ce.modifierTag === "cost_override")
        .every((ce) => !ce.usageLimitConsumed)
    ).toBe(true);
    state = useFree(state, "c20-b");
    expect(
      state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(7);
    expect(usage(state)).toHaveLength(1);
  });

  it("開始済みCEの保存復元とリビルド後も継続し、別の同名個体は開始できない", () => {
    let state = useFree(buildState());
    state = rebuildContinuousEffectsFromField(
      JSON.parse(JSON.stringify(state)) as GameState,
      getCardDefinitionById
    );
    expect(free(state, "c20-b")).toBeDefined();
    state = moveCardZone(state, "r12-1", "trash");
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(r12, {
          instanceId: "r12-2",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    state = moveCardZone(state, "r12-2", "set_aside");
    state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);
    expect(free(state, "c20-b")).toBeUndefined();
    expect(usage(state)).toHaveLength(1);
  });

  it("使用後のターン終了で無料化が消え、以後の同名別個体と再入場もゲーム中制限で拒否する", () => {
    let state = useFree(buildState());
    const start = state.turnNumber;
    for (let i = 0; i < 12 && state.turnNumber === start; i++)
      state = advanceStep(
        state,
        getCardDefinitionById,
        () => [],
        () => undefined
      );
    expect(state.turnNumber).toBeGreaterThan(start);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "cost_override"
      )
    ).toBe(false);
    // 後の自分のメインへ進めてから、使用元の再入場と同名別個体を置く。
    for (
      let i = 0;
      i < 20 && !(state.activePlayerId === ALICE && state.step === "main");
      i++
    )
      state = advanceStep(
        state,
        getCardDefinitionById,
        () => [],
        () => undefined
      );
    expect(state).toMatchObject({ activePlayerId: ALICE, step: "main" });
    state = moveCardZone(
      moveCardZone(state, "r12-1", "hand"),
      "r12-1",
      "set_aside"
    );
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(r12, {
          instanceId: "r12-later",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    state = moveCardZone(state, "r12-later", "set_aside");
    state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
    expect(free(state, "c20-b")).toBeUndefined();
    expect(usage(state)).toHaveLength(1);
    expect(
      listActions(state).some(
        (a) =>
          a.kind === "use_accel" &&
          a.sourceInstanceId === "c20-b" &&
          a.costMode === "paid"
      )
    ).toBe(true);
  });

  it("面霊以外・アクセル以外・相手のカードには無料化せず通常有償variantを保持する", () => {
    const other = ALL_CARDS.find(
      (c) => c.accelData?.timing === "main" && !c.tribe?.includes("面霊")
    )!;
    expect(other).toBeDefined();
    let state = buildState();
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(other, {
          instanceId: "other-tribe",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(c20, {
          instanceId: "opponent-accel",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
      ],
    };
    expect(free(state, "other-tribe")).toBeUndefined();
    expect(
      listActions(state).some(
        (a) =>
          a.kind === "use_accel" &&
          a.sourceInstanceId === "other-tribe" &&
          a.costMode === "paid"
      )
    ).toBe(true);
    expect(
      listActions(state).some(
        (a) =>
          a.kind === "use_accel" &&
          a.sourceInstanceId === "c20-a" &&
          a.costMode === "paid"
      )
    ).toBe(true);
    const normal = listActions(state).filter(
      (a) => a.sourceInstanceId === "c20-a" && a.kind !== "use_accel"
    );
    expect(normal).toContainEqual(
      expect.objectContaining({ kind: "summon", finalCost: 5 })
    );
    expect(
      normal.every((a) => !("costMode" in a) || a.costMode !== "free")
    ).toBe(true);
    const opponentActions = getLegalActions({
      state: {
        ...state,
        activePlayerId: BOB,
        players: state.players.map((p) =>
          p.id === BOB ? { ...p, reserveNormalCoreCount: 10 } : p
        ),
      },
      actingPlayerId: BOB,
      getCardDefinitionById,
    });
    expect(
      opponentActions.some(
        (a) =>
          a.kind === "use_accel" &&
          a.sourceInstanceId === "opponent-accel" &&
          a.costMode === "paid"
      )
    ).toBe(true);
    expect(
      opponentActions.some(
        (a) => a.kind === "use_accel" && a.costMode === "free"
      )
    ).toBe(false);
  });

  it("置かれたターンを過ぎると free variant は消える（本番のターン進行 advanceStep 経由、配置ターン起点 duration 検証）", () => {
    // adversarial verifier 2026-07-31 round1 lens4 指摘: 手動で turnNumber を書き換えて
    // recomputeAndRebuildContinuousEffects を直接呼ぶテストは、本番経路
    // (server/game-api.ts → engine.advanceStep、finalizeEffectResolution を経由しない)
    // を再現できていなかった。実際に advanceStep を繰り返し呼んで次ターンへ進める。
    const state = buildState();
    const startTurn = state.turnNumber;
    let current = state;
    for (let i = 0; i < 10 && current.turnNumber === startTurn; i++) {
      current = advanceStep(
        current,
        getCardDefinitionById,
        () => [],
        () => undefined
      );
    }
    expect(current.turnNumber).toBeGreaterThan(startTurn);

    expect(
      current.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "r12-1" && ce.modifierTag === "cost_override"
      )
    ).toBe(false);

    const freeAccel = listActions(current).find(
      (a) =>
        a.kind === "use_accel" &&
        a.sourceInstanceId === "c20-a" &&
        a.costMode === "free"
    );
    expect(freeAccel).toBeUndefined();
  });
});
