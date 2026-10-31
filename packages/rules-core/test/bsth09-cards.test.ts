import { finishCoreChoices } from "./helpers/core-choice-driver";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH09 (東方輝針城) カードの effects 検証テスト。
 * 妖戒/勇傑/付喪 アーキタイプ。多くの高度ギミックは stub。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveBp,
  getEffectiveLevel,
  getLegalActions,
  collectTriggerEventsFromStateDelta,
  rebuildContinuousEffectsFromField,
  runActionMainResolution,
  useResolvePendingTriggeredEffectAsAction,
} from "../src/runtime";
import { playBurstFollowUpCardWithoutPayingCost } from "../src/mechanics/burst-system";
import { matchesCardFilter } from "../src/card/card-filter";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  queuePendingLeave,
  applyStateBasedActions,
} from "../src/state-based-actions";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth09-cards:51",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe.each([
  ["BSTH09-C01", 4],
  ["BSTH09-C02", 4],
])("%s 輝針城チルノ/わかさぎ姫", (cardNo, revealCount) => {
  const card = cardNoMap.get(cardNo)!;
  it("メイン疲労コスト deck_reveal(柱斧/針妙丸/妖戒) + 疲労/離脱でカウント+1", () => {
    const e = card.effects![0]!;
    expect(e.steps[0]!.action.kind).toBe("set_exhaust_state");
    const reveal = e.steps[1]!.action;
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(revealCount);
      expect(reveal.picks[0]!.filter?.cardName).toEqual({ exact: "柱斧" });
    }
    const count = card.effects![1]!;
    expect(count.steps[0]!.action.kind).toBe("count_increase");
  });
  // 「疲労したとき」(cause 制限なし) と「相手によって離れたとき」(cause=[opponent_effect,battle])
  // が別効果として分離していること。bundling していると exhaust が opponent_effect 限定になり
  // 自他いずれの疲労原因でも発火する仕様に対し under-fire になる。
  it("effects[1] = exhaust(cause制限なし), effects[2] = leave_field(cause:[opponent_effect,battle])", () => {
    const exhaustEffect = card.effects![1]!;
    expect(exhaustEffect.timing).toEqual({
      kind: "card_event",
      event: "exhaust",
    });
    expect(exhaustEffect.steps[0]!.action.kind).toBe("count_increase");
    const leaveEffect = card.effects![2]!;
    expect(leaveEffect.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(leaveEffect.steps[0]!.action.kind).toBe("count_increase");
  });
});

describe.each(["BSTH09-C03", "BSTH09-C04"])(
  "%s 召喚時 count+deck_reveal5",
  (cardNo) => {
    const card = cardNoMap.get(cardNo)!;
    it("召喚時 count_increase + deck_reveal(5枚)", () => {
      const e = card.effects![0]!;
      expect(e.timing).toEqual({ kind: "card_event", event: "summon" });
      expect(e.steps[0]!.action.kind).toBe("count_increase");
      const reveal = e.steps[1]!.action;
      if (reveal.kind === "deck_reveal") expect(reveal.revealCount).toBe(5);
    });
  }
);

describe("BSTH09-C03 召喚時 実行: カウント+1", () => {
  const card = cardNoMap.get("BSTH09-C03")!;
  it("count_increase で自分のカウントが増える", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "renki-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `d${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    const before = state.players.find((p) => p.id === "alice")!.countValue ?? 0;
    const pending = runEffect(state, card.effects![0]!, "renki-1", "alice");
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(action).toBeDefined();
    const result = applyLegalAction({
      state: pending,
      action: action!,
      getCardDefinitionById,
    }).state;
    const after = result.players.find((p) => p.id === "alice")!.countValue ?? 0;
    expect(after).toBe(before + 1);
  });
});

describe("BSTH09-C03 effects[2]: 相手によって離れるとき、ターンに1回、同じ状態でフィールドに残せる", () => {
  const card = cardNoMap.get("BSTH09-C03")!;

  it("shape: card_event(leave_field, cause:[opponent_effect,battle]) + occurrenceGate(turn,1) + stay_on_field(newExhaustState省略)", () => {
    const e = card.effects![2]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(e.occurrenceGate).toBeUndefined();
    expect(e.usageLimit).toEqual({ kind: "per_instance", duration: "turn" });
    expect(e.executionMode).toBe("optional");
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("stay_on_field");
    if (step0.action.kind === "stay_on_field") {
      expect(step0.action.target).toEqual({ kind: "self" });
      expect(step0.action.newExhaustState).toBeUndefined();
    }
    expect(e.stub).toBeUndefined();
  });

  it("盤面変化: 相手によって離脱時に解決すると、疲労状態を維持したままフィールドに残る", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [
        createCardInstance(card, {
          instanceId: "renki-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
          pendingLeaveKind: "destroy",
          pendingLeaveCause: "effect_resolution",
          pendingLeaveChainId: "chain-renki-1",
        }),
      ],
      pendingLeaveEntities: [
        {
          instanceId: "renki-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-renki-1",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };
    const result = runEffect(state, card.effects![2]!, "renki-1", "alice");
    const inst = result.cardInstances.find((c) => c.instanceId === "renki-1")!;
    expect(inst.zone).toBe("field");
    expect(inst.exhaustState).toBe("exhausted");
    expect(inst.pendingLeaveKind).toBeNull();
  });

  it("最初の離脱時に別効果で残った場合、未使用の残留効果を同ターンの次の離脱時にも発揮できる", () => {
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const base: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "renki-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
      ],
    };

    function fireOpponentLeave(state: GameState): GameState {
      const afterLeave = queuePendingLeave({
        state,
        instanceId: "renki-1",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: `chain-renki-1-${state.log.length}`,
        causePlayerId: "bob",
      });
      return collectAndQueueTriggerReactions({
        chainId: `chain-renki-1-${state.log.length}`,
        beforeState: state,
        afterState: afterLeave,
        source: "action_resolution",
        causedByPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: undefined,
      });
    }

    // 観測回数で制限せず、実際の使用回数を管理する。
    let state = fireOpponentLeave(base);
    expect(
      state.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "renki-1"
      )?.count
    ).toBeUndefined();
    const queuedFirst =
      state.pendingTriggeredEffects.length +
      state.pendingPrivateDeclarations.length;
    expect(queuedFirst).toBeGreaterThan(0);

    // この任意効果を使わず、別の残留効果で離脱を取り消す。
    state = executeEffect({
      chainId: "test:bsth09-cards:264",
      state,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "stay_on_field", target: { kind: "self" } } },
        ],
      },
      effectIndex: 99,
      sourceInstanceId: "renki-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    state = {
      ...state,
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations: [],
    };

    // 同ターン2回目にも未使用の任意効果の候補が作られる。
    state = fireOpponentLeave(state);
    expect(
      state.effectOccurrenceRecords.find(
        (r) => r.sourceInstanceId === "renki-1"
      )?.count
    ).toBeUndefined();
    const queuedSecond =
      state.pendingTriggeredEffects.length +
      state.pendingPrivateDeclarations.length;
    expect(queuedSecond).toBeGreaterThan(0);
  });
});

describe("BSTH09-C05 輝針城 (nexus)", () => {
  const card = cardNoMap.get("BSTH09-C05")!;
  it("配置時 count+deck_reveal5 / Lv2 メイン トラッシュ→デッキ下(同名ターン1回)", () => {
    expect(card.effects![0]!.timing).toEqual({
      kind: "card_event",
      event: "place",
    });
    const m = card.effects![1]!;
    expect(m.usageLimit).toEqual({ kind: "per_card_name", duration: "turn" });
    expect(m.steps[0]!.action.kind).toBe("move_card");
  });

  // 「そうしたとき、このターンの間、自分はデッキの上からしかドロー/オープンできない」
  // (restrict_draw_to_top)。move_card 成功時のみ conditional_result で登録され、
  // 以後 draw(position:"bottom") が top へ強制上書きされることを盤面変化で検証する。
  const drawBottomEffect = {
    timing: { kind: "activated" as const, mode: "main" as const },
    steps: [
      {
        action: {
          kind: "draw" as const,
          count: 1,
          position: "bottom" as const,
        },
      },
    ],
  };

  it("[board] トラッシュに勇傑/付喪/妖戒があるとき: デッキ下へ送った後、ドロー(下指定)が上から強制される", () => {
    const nexus = createCardInstance(card, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      // Lv2 (requiredCores:1) 条件 (min_level:2) を満たすためコア1個を置く。
      normalCoreCount: 1,
    });
    // BSTH09-C05 自身の tribe (幻想・勇傑) を move_card filter の fodder として流用。
    const fodder = createCardInstance(card, {
      instanceId: "fodder-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const deckTop = createCardInstance(card, {
      instanceId: "deck-top",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deckBottom = createCardInstance(card, {
      instanceId: "deck-bottom",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, fodder, deckTop, deckBottom],
    });

    const m = card.effects![1]!;
    const afterMove = runEffect(state, m, "nexus-1", "alice");
    expect(
      afterMove.cardInstances.find((c) => c.instanceId === "fodder-1")!.zone
    ).toBe("deck");
    expect(afterMove.activeContinuousEffects).toContainEqual(
      expect.objectContaining({
        modifierTag: "restrict_draw_to_top",
        targetInstanceId: "alice",
      })
    );

    const afterDraw = runEffect(
      afterMove,
      drawBottomEffect,
      "nexus-1",
      "alice"
    );
    // 制約が無ければ末尾(fodder-1, 実際の下)が引かれるはずだが、上(deck-top)へ強制される。
    expect(
      afterDraw.cardInstances.find((c) => c.instanceId === "deck-top")!.zone
    ).toBe("hand");
    expect(
      afterDraw.cardInstances.find((c) => c.instanceId === "fodder-1")!.zone
    ).toBe("deck");
  });

  it("[board] トラッシュに対象が無いとき: move_card 失敗で制約は登録されずドロー(下指定)は下のまま", () => {
    const nexus = createCardInstance(card, {
      instanceId: "nexus-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deckTop = createCardInstance(card, {
      instanceId: "deck-top-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const deckBottom = createCardInstance(card, {
      instanceId: "deck-bottom-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus, deckTop, deckBottom],
    });

    const m = card.effects![1]!;
    const afterMove = runEffect(state, m, "nexus-2", "alice");
    expect(
      afterMove.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_draw_to_top"
      )
    ).toBe(false);

    const afterDraw = runEffect(
      afterMove,
      drawBottomEffect,
      "nexus-2",
      "alice"
    );
    expect(
      afterDraw.cardInstances.find((c) => c.instanceId === "deck-bottom-2")!
        .zone
    ).toBe("hand");
  });
});

describe("BSTH09-M01 咲夜 (burst)", () => {
  const card = cardNoMap.get("BSTH09-M01")!;
  it("burst(life_decrease) summon+end_attack_step / メイン symbol_add red", () => {
    const burst = card.effects!.find((e) => e.timing.kind === "burst")!;
    expect(burst.steps[0]!.action.kind).toBe("summon");
    expect(burst.steps[1]!.action.kind).toBe("end_attack_step");
    // 「その後、このバトル終了時、アタックステップを終了する」= step 単位 deferTo:battle_end。
    expect(burst.steps[1]!.deferTo).toBe("battle_end");
    const sym = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "symbol_add"
    )!;
    const a = sym.steps[0]!.action;
    if (a.kind === "symbol_add") expect(a.symbol).toBe("red");
  });

  // ruling C (2026-06-24): revealed の可能形「セットできる」効果は executionMode:"optional"
  // 明示が必須。findRevealedEffect の default は optional だが、card_event 系の default 非対称
  // 回避のため per-effect 明示を義務付け (cards:fidelity 監査で fail として検知)。
  const revealed = card.effects!.find(
    (e) =>
      e.timing.kind === "card_event" &&
      (Array.isArray(e.timing.event)
        ? e.timing.event.includes("revealed")
        : e.timing.event === "revealed")
  )!;

  it("[0] 勇傑/妖戒効果でオープンされバースト未セットなら set_as_burst disposition を実装 (stub 解消)", () => {
    expect(revealed.stub).toBeUndefined();
    expect(revealed.executionMode).toBe("optional");
    expect(revealed.cardEventDisposition).toEqual({ kind: "set_as_burst" });
    expect(revealed.condition).toContainEqual({
      kind: "trigger_tribes",
      tribes: ["勇傑", "妖戒"],
    });
    expect(revealed.condition).toContainEqual({
      kind: "trigger_from_zone",
      zones: ["deck"],
    });
    expect(revealed.condition).toContainEqual({
      kind: "burst_set_count",
      player: "self",
      max: 0,
    });
  });

  // 妖戒 (BSTH09-C01) 効果でのデッキオープンを模して、revealed_choice で
  // set_as_burst を受理すると手札を経由せず直接バーストゾーンへ入り
  // setBurstStates に登録されることを確認する (engine-burst-set-runtime-transition)。
  it("[board] 妖戒カードでオープンされ受理すると burst ゾーンへ直行し setBurstStates に登録される", () => {
    const opener = cardNoMap.get("BSTH09-C01")!; // tribe: 幻想・妖精・妖戒
    const openerInstance = createCardInstance(opener, {
      instanceId: "opener-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const sakuya = createCardInstance(card, {
      instanceId: "sakuya-deck-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [openerInstance, sakuya],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    const revealEffect = {
      timing: { kind: "activated" as const, mode: "main" as const },
      steps: [
        {
          action: {
            kind: "deck_reveal" as const,
            revealCount: 1,
            picks: [],
            remainder: "bottom" as const,
          },
        },
      ],
    };
    const revealedState = runEffect(state, revealEffect, "opener-1", "alice");
    expect(revealedState.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(
      revealedState.pendingDeckReveal?.revealedDispositionMap?.["sakuya-deck-1"]
    ).toEqual({ kind: "set_as_burst" });

    const pick = getLegalActions({
      state: revealedState,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const after = applyLegalAction({
      state: revealedState,
      action: pick,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["sakuya-deck-1"],
    }).state;

    const sakuyaAfter = after.cardInstances.find(
      (c) => c.instanceId === "sakuya-deck-1"
    )!;
    expect(sakuyaAfter.zone).toBe("burst");
    expect(after.setBurstStates).toContainEqual({
      playerId: "alice",
      cardInstanceId: "sakuya-deck-1",
    });
  });

  it("[board] 既にバーストがセット済みなら set_as_burst の対象候補にならない", () => {
    const opener = cardNoMap.get("BSTH09-C01")!;
    const openerInstance = createCardInstance(opener, {
      instanceId: "opener-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const existingBurst = createCardInstance(card, {
      instanceId: "already-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const sakuya = createCardInstance(card, {
      instanceId: "sakuya-deck-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [openerInstance, existingBurst, sakuya],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "already-burst" }],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    const revealEffect = {
      timing: { kind: "activated" as const, mode: "main" as const },
      steps: [
        {
          action: {
            kind: "deck_reveal" as const,
            revealCount: 1,
            picks: [],
            remainder: "bottom" as const,
          },
        },
      ],
    };
    const revealedState = runEffect(state, revealEffect, "opener-2", "alice");
    expect(
      revealedState.pendingDeckReveal?.revealedDispositionMap?.["sakuya-deck-2"]
    ).toBeUndefined();
  });

  it.each([
    { cause: "妖戒", accept: true, occupied: "none", sets: true },
    { cause: "勇傑", accept: true, occupied: "none", sets: true },
    { cause: "妖戒", accept: false, occupied: "none", sets: false },
    { cause: "導魔", accept: true, occupied: "none", sets: false },
    { cause: "妖戒", accept: true, occupied: "alice", sets: false },
    { cause: "妖戒", accept: true, occupied: "bob", sets: true },
  ])(
    "[board] BSTH09-M01 cause=$cause accept=$accept occupied=$occupied の最終ゾーンとセット数",
    ({ cause, accept, occupied, sets }) => {
      const opener = ALL_CARDS.find(
        (candidate) =>
          candidate.tribe?.includes(cause) &&
          (cause !== "妖戒" || !candidate.tribe.includes("勇傑")) &&
          (cause !== "勇傑" || !candidate.tribe.includes("妖戒")) &&
          (cause !== "導魔" ||
            (!candidate.tribe.includes("勇傑") &&
              !candidate.tribe.includes("妖戒")))
      )!;
      expect(opener).toBeDefined();
      const state = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(opener, {
              instanceId: "opener",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 8,
            }),
            createCardInstance(card, {
              instanceId: "sakuya",
              ownerPlayerId: "alice",
              zone: "deck",
            }),
            ...(occupied === "none"
              ? []
              : [
                  createCardInstance(card, {
                    instanceId: "existing-burst",
                    ownerPlayerId: occupied,
                    zone: "burst",
                  }),
                ]),
          ],
          setBurstStates:
            occupied === "none"
              ? []
              : [{ playerId: occupied, cardInstanceId: "existing-burst" }],
        }),
        activePlayerId: "alice",
        step: "main" as const,
      };
      let after = runEffect(
        state,
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [],
                remainder: "bottom",
              },
            },
          ],
        },
        "opener",
        "alice"
      );
      if (after.pendingDeckReveal?.phase === "revealed_choice") {
        const action = getLegalActions({
          state: after,
          actingPlayerId: "alice",
          getCardDefinitionById,
        }).find((entry) => entry.kind === "resolve_pending_deck_reveal_pick");
        expect(action).toBeDefined();
        after = applyLegalAction({
          state: after,
          action: action!,
          getCardDefinitionById,
          selectedDeckRevealCardIds: accept ? ["sakuya"] : [],
        }).state;
      }
      for (
        let remaining = 0;
        after.pendingDeckReveal && remaining < 4;
        remaining++
      ) {
        const action = getLegalActions({
          state: after,
          actingPlayerId: "alice",
          getCardDefinitionById,
        }).find(
          (entry) =>
            entry.kind === "resolve_pending_deck_reveal_pick" ||
            entry.kind === "resolve_pending_deck_reveal_order"
        );
        expect(action).toBeDefined();
        after = applyLegalAction({
          state: after,
          action: action!,
          getCardDefinitionById,
          ...(action?.kind === "resolve_pending_deck_reveal_order"
            ? { deckRevealRemainderOrder: action.remainingCardInstanceIds }
            : { selectedDeckRevealCardIds: [] }),
        }).state;
      }
      expect(after.pendingDeckReveal).toBeNull();
      expect(
        after.cardInstances.find((entry) => entry.instanceId === "sakuya")?.zone
      ).toBe(sets ? "burst" : "deck");
      expect(
        after.setBurstStates.filter((entry) => entry.playerId === "alice")
      ).toHaveLength(sets || occupied === "alice" ? 1 : 0);
      expect(
        after.setBurstStates.some((entry) => entry.cardInstanceId === "sakuya")
      ).toBe(sets);
      expect(
        after.players.find((entry) => entry.id === "alice")!.handCount
      ).toBe(state.players.find((entry) => entry.id === "alice")!.handCount);
      if (occupied !== "none")
        expect(after.setBurstStates).toContainEqual({
          playerId: occupied,
          cardInstanceId: "existing-burst",
        });
    }
  );
});

describe("BSTH09-M02 魔理沙 (burst)", () => {
  const card = cardNoMap.get("BSTH09-M02")!;
  it("burst bounce2+summon / 合体stub / BP-15000×2", () => {
    const burst = card.effects![0]!;
    expect(burst.steps[0]!.action.kind).toBe("bounce");
    expect(burst.steps[1]!.action.kind).toBe("summon");
    const bp = card.effects![2]!;
    const a = bp.steps[0]!.action;
    if (a.kind === "bp_modify") expect(a.amount).toBe(-15000);
  });

  it("[BSTH09-M02] アタック時 BP-15000 後段は BP0 遷移対象 ref を破壊する", () => {
    // 「BP0になった」連動 = bp_modify が記録する >0→0 遷移対象を後段で参照する。
    const bpEffect = card.effects![2]!;
    expect(bpEffect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(bpEffect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const bpStep = bpEffect.steps[0]!.action;
    expect(bpStep.kind).toBe("bp_modify");
    if (bpStep.kind === "bp_modify") expect(bpStep.amount).toBe(-15000);
    expect(bpEffect.steps[0]!.id).toBe("bp0");
    const destroyStep = bpEffect.steps[1]!.action;
    expect(destroyStep.kind).toBe("destroy");
    if (destroyStep.kind === "destroy") {
      expect(destroyStep.target).toEqual({
        kind: "ref",
        stepId: "bp0",
        result: "bp_became_zero",
      });
    }
  });

  it("[BSTH09-M02] 合体中だけ魂状態を戻す後続が同じ効果の発揮後に接続される", () => {
    // 「合体中、魂状態の相手のカードすべてを手札へ」= effect-level condition {combined}
    // + bounce filter:{soulState:"only"} count:"all"。
    const combinedBounce = card.effects![2]!;
    expect(combinedBounce.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(combinedBounce.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(combinedBounce.steps[2]!.condition).toEqual([{ kind: "combined" }]);
    expect(combinedBounce.steps[2]!.connector).toBe("after_triggers");
    const step = combinedBounce.steps[2]!.action;
    expect(step.kind).toBe("bounce");
    if (step.kind === "bounce") {
      expect(step.target.kind).toBe("filter");
      if (step.target.kind === "filter") {
        expect(step.target.player).toBe("opponent");
        expect(step.target.count).toBe("all");
        expect(step.target.filter?.soulState).toBe("only");
      }
    }
  });

  it("[BSTH09-M02] アタック効果実行で BP0 相手 2 体が破壊予約 (実効BP & destroy log)", () => {
    // 相手スピリット 2 体 (BP3000) を BP-15000 → 実効 BP -12000 → destroy(maxBp:0) 一括破壊。
    // 既存 BSAZ01-C02 test (bsaz01-repeat-activation.test.ts) と同型で
    // executeEffect 後の effect:destroy ログ + 実効BPで検証する
    // (destroy は pendingLeave に積み、zone 物理変更は flush 後)。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const marisa = createCardInstance(card, {
      instanceId: "marisa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 2,
      normalCoreCount: 3,
    });
    const oppDef = cardNoMap.get("BSTH09-R02")!; // Lv1 BP3000
    const opp1 = createCardInstance(oppDef, {
      instanceId: "opp-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const opp2 = createCardInstance(oppDef, {
      instanceId: "opp-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [marisa, opp1, opp2],
    };
    const result = executeEffect({
      chainId: "test:bsth09-cards:685",
      state,
      effect: card.effects![2]!,
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["opp-1", "opp-2"],
    });
    // BP -15000 で 実効BP <= 0。
    const opp1After = result.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    const opp2After = result.cardInstances.find(
      (c) => c.instanceId === "opp-2"
    )!;
    expect(
      getEffectiveBp(result, opp1After, oppDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    expect(
      getEffectiveBp(result, opp2After, oppDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    // destroy が両者に対し発火 (maxBp:0 filter 一括破壊)。
    expect(
      result.log.some(
        (l) => l.startsWith("effect:destroy:") && l.includes("opp-1")
      )
    ).toBe(true);
    expect(
      result.log.some(
        (l) => l.startsWith("effect:destroy:") && l.includes("opp-2")
      )
    ).toBe(true);
  });
});

describe("BSTH09-M03 霊夢 (burst)", () => {
  const card = cardNoMap.get("BSTH09-M03")!;
  const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
  const nonGuidedNexusDef: CardDefinition = {
    cardNo: "TEST-BSTH09-M03-NONGUIDED",
    name: "非 guided 導界者系統ネクサス",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "導界者・起幻",
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const getReimuCardDefinitionById = (id: string) =>
    id === nonGuidedNexusDef.cardNo
      ? nonGuidedNexusDef
      : getCardDefinitionById(id);
  const createBurstState = (
    targets: readonly ReturnType<typeof createCardInstance>[]
  ) => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const burstSource = createCardInstance(card, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    return {
      ...base,
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [burstSource, ...targets],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
      pendingBurstChecks: [
        {
          checkId: "bsth09-m03-burst",
          actingPlayerId: "alice",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:bsth09-cards:759",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    } satisfies GameState;
  };
  const findReimuBurstAction = (state: GameState) =>
    getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "reimu-burst"
    );
  const resolveReimuBurst = (
    state: GameState,
    targetInstanceIds: readonly string[],
    expectedPendingTargetGroups?: unknown
  ) => {
    const finishPlacement = (state: GameState) => {
      if (!state.pendingMultiPlacement) return state;
      const options = {
        state,
        getCardDefinitionById: getReimuCardDefinitionById,
        getRegisteredBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      };
      const action = getLegalActions({
        ...options,
        actingPlayerId: "alice",
      }).find((a) => a.kind === "resolve_pending_multi_placement");
      expect(action).toBeDefined();
      return applyLegalAction({
        ...options,
        action: action!,
        multiPlacementAllocations: state.pendingMultiPlacement.targets.map(
          (target) => ({
            destinationInstanceId: target.instanceId,
            placements: [
              {
                kind: "reserve_normal" as const,
                amount: target.minimumCoreCount,
              },
            ],
          })
        ),
      }).state;
    };
    const action = findReimuBurstAction(state);
    expect(action).toBeDefined();
    const afterDeclaration = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).state;

    expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");
    const activationPass = getLegalActions({
      state: afterDeclaration,
      actingPlayerId: "bob",
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).find((a) => a.kind === "pass_stack");
    expect(activationPass).toBeDefined();
    const afterActivationPass = applyLegalAction({
      state: afterDeclaration,
      action: activationPass!,
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).state;

    expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    const effectDeclarationPass = getLegalActions({
      state: afterActivationPass,
      actingPlayerId: "bob",
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).find((a) => a.kind === "pass_stack");
    expect(effectDeclarationPass).toBeDefined();
    const afterEffectDeclarationPass = applyLegalAction({
      state: afterActivationPass,
      action: effectDeclarationPass!,
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).state;

    if (afterEffectDeclarationPass.pendingEffectTargetSelection === null) {
      expect(targetInstanceIds).toHaveLength(0);
      return finishPlacement(afterEffectDeclarationPass);
    }

    const pending = afterEffectDeclarationPass.pendingEffectTargetSelection;
    expect(pending.actingPlayerId).toBe("alice");
    expect(pending.deferredStack.actionKind).toBe("burst_activation");
    if (expectedPendingTargetGroups !== undefined) {
      expect(pending.targetGroups).toEqual(expectedPendingTargetGroups);
    }
    const resolveTargets = getLegalActions({
      state: afterEffectDeclarationPass,
      actingPlayerId: "alice",
      getCardDefinitionById: getReimuCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTargets).toBeDefined();
    return finishPlacement(
      applyLegalAction({
        state: afterEffectDeclarationPass,
        action: resolveTargets!,
        targetInstanceIds,
        getCardDefinitionById: getReimuCardDefinitionById,
        getRegisteredBurstActions,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(ALL_CARDS),
        getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      }).state
    );
  };

  it("burst attack_after core_move(grandwalker)+destroy(nexus)+summon / Lv2 回復(turn)", () => {
    const burst = card.effects![0]!;
    expect(burst.stub).toBeUndefined();
    expect(burst.timing).toEqual({
      kind: "burst",
      trigger: { kind: "attack_finished", player: "opponent" },
    });
    expect(burst.steps[0]!.action.kind).toBe("core_move");
    expect(
      burst.steps[0]!.action.kind === "core_move"
        ? burst.steps[0]!.action.target.filter
        : undefined
    ).toEqual({
      category: ["nexus"],
      hasMechanic: ["grandwalker", "guided"],
      targetsGrandwalker: true,
    });
    expect(burst.steps[1]!.action.kind).toBe("destroy");
    expect(burst.steps[2]!.action.kind).toBe("summon");
    expect(getRegisteredBurstActions("BSTH09-M03")?.[0]?.targetGroups).toEqual([
      expect.objectContaining({
        requiredTargetCount: 1,
        targetStepId: "__step_0",
      }),
      expect.objectContaining({
        requiredTargetCount: 1,
        targetStepId: "__step_1",
      }),
    ]);
    const rec = card.effects![1]!;
    expect(rec.usageLimit).toEqual({ kind: "per_instance", duration: "turn" });
  });

  it("創界神/導界者コア移動 filter は非 guided の導界者系統ネクサスを弾く", () => {
    const burst = card.effects![0]!;
    const action = burst.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind !== "core_move") return;
    const filter = action.target.filter!;
    const nonGuidedNexus = createCardInstance(nonGuidedNexusDef, {
      instanceId: "nonguided-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    expect(matchesCardFilter(nonGuidedNexus, nonGuidedNexusDef, filter)).toBe(
      false
    );
  });

  it("バーストは窓後対象選択で創界神コア移動とネクサス破壊を別 targetGroup として提示する", () => {
    const guidedNexus = createCardInstance(cardNoMap.get("BSAZ02-X04")!, {
      instanceId: "bob-guided-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 6,
    });
    const nonGuidedNexus = createCardInstance(nonGuidedNexusDef, {
      instanceId: "bob-nonguided-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const plainNexus = createCardInstance(cardNoMap.get("BSTH09-C05")!, {
      instanceId: "bob-plain-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state = createBurstState([guidedNexus, nonGuidedNexus, plainNexus]);
    const action = findReimuBurstAction(state);

    expect(action).toBeDefined();
    expect(action?.targetMode).toBe("none");
    expect(action?.requiredTargetCount).toBe(0);
    expect(action?.candidateTargetInstanceIds).toEqual([]);
    expect(action?.targetGroups).toBeUndefined();
    const expectedTargetGroups = [
      {
        requiredTargetCount: 1,
        targetStepId: "__step_0",
        candidateTargetZones: ["field"],
        candidateTargetInstanceIds: ["bob-guided-nexus"],
      },
      {
        requiredTargetCount: 1,
        targetStepId: "__step_1",
        candidateTargetZones: ["field"],
        candidateTargetInstanceIds: ["bob-nonguided-nexus", "bob-plain-nexus"],
      },
    ];

    const after = resolveReimuBurst(
      state,
      ["bob-guided-nexus", "bob-plain-nexus"],
      expectedTargetGroups
    );

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-guided-nexus")
        ?.normalCoreCount
    ).toBe(0);
    const nonGuidedAfter = after.cardInstances.find(
      (x) => x.instanceId === "bob-nonguided-nexus"
    );
    expect(nonGuidedAfter?.zone).toBe("field");
    expect(nonGuidedAfter?.normalCoreCount).toBe(4);
    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-plain-nexus")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "reimu-burst")?.zone
    ).toBe("field");
  });

  it("targetGroup ごとに空撃ち補正し、対象不足でも召喚まで解決する", () => {
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 6,
    });
    const onlyGrandwalkerState = createBurstState([grandwalker]);
    const onlyGrandwalkerAction = findReimuBurstAction(onlyGrandwalkerState);
    expect(onlyGrandwalkerAction).toBeDefined();
    expect(onlyGrandwalkerAction?.targetMode).toBe("none");
    expect(onlyGrandwalkerAction?.requiredTargetCount).toBe(0);
    expect(onlyGrandwalkerAction?.candidateTargetInstanceIds).toEqual([]);
    const onlyGrandwalkerGroups = [
      expect.objectContaining({
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["bob-grandwalker"],
      }),
      expect.objectContaining({
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      }),
    ];
    const afterOnlyGrandwalker = resolveReimuBurst(
      onlyGrandwalkerState,
      ["bob-grandwalker"],
      onlyGrandwalkerGroups
    );
    expect(
      afterOnlyGrandwalker.cardInstances.find(
        (x) => x.instanceId === "bob-grandwalker"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      afterOnlyGrandwalker.cardInstances.find(
        (x) => x.instanceId === "reimu-burst"
      )?.zone
    ).toBe("field");

    const plainNexus = createCardInstance(cardNoMap.get("BSTH09-C05")!, {
      instanceId: "bob-plain-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const onlyNexusState = createBurstState([plainNexus]);
    const onlyNexusAction = findReimuBurstAction(onlyNexusState);
    expect(onlyNexusAction).toBeDefined();
    expect(onlyNexusAction?.targetMode).toBe("none");
    expect(onlyNexusAction?.requiredTargetCount).toBe(0);
    expect(onlyNexusAction?.candidateTargetInstanceIds).toEqual([]);
    const onlyNexusGroups = [
      expect.objectContaining({
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      }),
      expect.objectContaining({
        requiredTargetCount: 1,
        candidateTargetInstanceIds: ["bob-plain-nexus"],
      }),
    ];
    const afterOnlyNexus = resolveReimuBurst(
      onlyNexusState,
      ["bob-plain-nexus"],
      onlyNexusGroups
    );
    expect(
      afterOnlyNexus.cardInstances.find(
        (x) => x.instanceId === "bob-plain-nexus"
      )?.zone
    ).toBe("trash");
    expect(
      afterOnlyNexus.cardInstances.find((x) => x.instanceId === "reimu-burst")
        ?.zone
    ).toBe("field");

    const noTargetState = createBurstState([]);
    const noTargetAction = findReimuBurstAction(noTargetState);
    expect(noTargetAction).toBeDefined();
    expect(noTargetAction?.requiredTargetCount).toBe(0);
    expect(noTargetAction?.targetGroups).toBeUndefined();
    const afterNoTarget = resolveReimuBurst(noTargetState, []);
    expect(
      afterNoTarget.cardInstances.find((x) => x.instanceId === "reimu-burst")
        ?.zone
    ).toBe("field");
  });
});

describe("BSTH09-R01 弁々", () => {
  const card = cardNoMap.get("BSTH09-R01")!;
  it("効果召喚時 destroy / 弁々と八橋にBP+5000(no_duplicate) / restrict_end_attack_step", () => {
    expect(card.effects![0]!.timing).toEqual({
      kind: "card_event",
      event: "summon",
      cause: ["self_effect", "opponent_effect"],
    });
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("destroy");
    const bpEffect = card.effects![1]!;
    expect(bpEffect.usageLimit).toEqual({ kind: "no_duplicate" });
    const bp = bpEffect.steps[0]!.action;
    expect(bp.kind).toBe("bp_modify");
    if (bp.kind === "bp_modify") {
      expect(bp.amount).toBe(5000);
      if (bp.target.kind === "filter") {
        expect(bp.target.filter?.cardName).toEqual([
          { contains: "弁々" },
          { contains: "八橋" },
        ]);
      }
    }
    const restrict = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "restrict_end_attack_step"
    );
    expect(restrict).toBeDefined();
  });

  it("八橋がいるとき 弁々/八橋ともに実効BP+5000 (盤面変化)", () => {
    const benDef = cardNoMap.get("BSTH09-R01")!; // 九十九 弁々
    const yatsuDef = cardNoMap.get("BSTH09-R02")!; // 九十九 八橋
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ben = createCardInstance(benDef, {
      instanceId: "ben-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const yatsu = createCardInstance(yatsuDef, {
      instanceId: "yatsu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ben, yatsu],
    };
    const benBefore = getEffectiveBp(state, ben, benDef, getCardDefinitionById);
    const yatsuBefore = getEffectiveBp(
      state,
      yatsu,
      yatsuDef,
      getCardDefinitionById
    );

    // 弁々の継続効果 (条件: 八橋がいる) を発揮 → CE 登録。
    const afterBen = runEffect(state, benDef.effects![1]!, "ben-1", "alice");

    const benAfter = getEffectiveBp(
      afterBen,
      afterBen.cardInstances.find((c) => c.instanceId === "ben-1")!,
      benDef,
      getCardDefinitionById
    );
    const yatsuAfter = getEffectiveBp(
      afterBen,
      afterBen.cardInstances.find((c) => c.instanceId === "yatsu-1")!,
      yatsuDef,
      getCardDefinitionById
    );
    expect(benAfter).toBe(benBefore + 5000);
    expect(yatsuAfter).toBe(yatsuBefore + 5000);
  });

  it("BSTH09-R01: 通常召喚では発揮せず、効果召喚では pending から相手スピリットを破壊できる", () => {
    const targetDef = cardNoMap.get("BSTH09-C01")!;
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(ALL_CARDS),
    };
    const before = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const inHand = createCardInstance(card, {
      instanceId: "ben-effect-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const onField = {
      ...inHand,
      zone: "field" as const,
      zoneRoleName: "spirit" as const,
      normalCoreCount: 1,
    };
    const bobTarget = createCardInstance(targetDef, {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const beforeState: GameState = {
      ...before,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [inHand, bobTarget],
    };
    const afterState: GameState = {
      ...beforeState,
      log: [
        ...beforeState.log,
        "effect:summon:ben-effect-summon:self:from=hand:cost=0:cores=1",
      ],
      cardInstances: [onField, bobTarget],
    };

    const normalEvents = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
      getCardDefinitionById,
    });
    const normalSummon = normalEvents.find((e) => e.eventKind === "summon");
    expect(normalSummon?.cause).toBeUndefined();
    const normalQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsth09-cards:1272",
      beforeState,
      afterState,
      source: "action_resolution",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(normalQueued.pendingTriggeredEffects).toHaveLength(0);

    const normalProductionHand = createCardInstance(card, {
      instanceId: "ben-normal-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const normalProductionTarget = createCardInstance(targetDef, {
      instanceId: "bob-target-normal",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const normalProductionState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { handCount: 1, reserveNormalCoreCount: card.cost + 1 },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [normalProductionHand, normalProductionTarget],
    };
    const normalSummonAction = getLegalActions({
      state: normalProductionState,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "ben-normal-summon"
    );
    expect(normalSummonAction).toBeDefined();
    const normalDeclared = applyLegalAction({
      state: normalProductionState,
      action: normalSummonAction!,
      paymentSources: [{ kind: "reserve", amount: card.cost }],
      ...lookups,
    }).state;
    const normalPassActor = normalDeclared.stackWindow?.priorityPlayerId;
    expect(normalPassActor).toBeDefined();
    const normalPass = getLegalActions({
      state: normalDeclared,
      actingPlayerId: normalPassActor!,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(normalPass).toBeDefined();
    const normalAfterPass = applyLegalAction({
      state: normalDeclared,
      action: normalPass!,
      ...lookups,
    }).state;
    const normalPlacement = getLegalActions({
      state: normalAfterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_enter_field_placement");
    expect(normalPlacement).toBeDefined();
    const normalResolved = applyLegalAction({
      state: normalAfterPass,
      action: normalPlacement!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      ...lookups,
    }).state;
    expect(
      normalResolved.pendingTriggeredEffects.some(
        (p) => p.relatedInstanceId === "ben-normal-summon"
      )
    ).toBe(false);

    const effectEvents = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
      getCardDefinitionById,
      enterFieldCausedByPlayerId: "alice",
    });
    const effectSummon = effectEvents.find((e) => e.eventKind === "summon");
    expect(effectSummon?.cause).toBe("self_effect");
    const effectQueued = collectAndQueueTriggerReactions({
      chainId: "test:bsth09-cards:1363",
      beforeState,
      afterState,
      source: "action_resolution",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
      enterFieldCausedByPlayerId: "alice",
    });
    expect(effectQueued.pendingTriggeredEffects).toHaveLength(1);
    expect(effectQueued.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "ben-effect-summon",
    });
    let effectReady = effectQueued;
    while (effectReady.pendingBurstChecks.length > 0) {
      const actingPlayerId = effectReady.pendingBurstChecks[0]!.actingPlayerId;
      const resolveBurstCheck = getLegalActions({
        state: effectReady,
        actingPlayerId,
        ...lookups,
        getRegisteredBurstActions: () => undefined,
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" ||
          a.kind === "decline_pending_burst_check"
      );
      expect(resolveBurstCheck).toBeDefined();
      effectReady = applyLegalAction({
        state: effectReady,
        action: resolveBurstCheck!,
        ...lookups,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }

    const fieldPlaceSourceDef: CardDefinition = {
      cardNo: "TEST-FIELD-PLACE-BEN",
      name: "効果配置テストソース",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const placeDefs = new Map<string, CardDefinition>([
      ...ALL_CARDS.map((def) => [def.cardNo, def] as const),
      [fieldPlaceSourceDef.cardNo, fieldPlaceSourceDef],
    ]);
    const getPlaceDef = (id: string) => placeDefs.get(id);
    const placeSource = createCardInstance(fieldPlaceSourceDef, {
      instanceId: "place-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const benInTrash = createCardInstance(card, {
      instanceId: "ben-effect-placed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const beforeFieldPlace = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [placeSource, benInTrash],
    });
    const afterFieldPlace = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth09-cards:1438",
      state: beforeFieldPlace,
      sourceInstanceId: "place-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getPlaceDef,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              count: 1,
              destination: "field",
            },
          },
        ],
      },
    });
    const fieldPlaceEvents = collectTriggerEventsFromStateDelta({
      beforeState: beforeFieldPlace,
      afterState: afterFieldPlace,
      source: "action_resolution",
      chainId: "test-field-place-ben",
      attackId: null,
      enterFieldCausedByPlayerId: "alice",
      getCardDefinitionById: getPlaceDef,
    });
    expect(
      fieldPlaceEvents.filter(
        (event) =>
          event.eventKind === "summon" &&
          event.relatedInstanceId === "ben-effect-placed"
      )
    ).toHaveLength(0);
    expect(
      fieldPlaceEvents.find(
        (event) =>
          event.eventKind === "place" &&
          event.relatedInstanceId === "ben-effect-placed"
      )
    ).toMatchObject({ cause: "self_effect" });
    const fieldPlaceQueued = collectAndQueueTriggerReactions({
      beforeState: beforeFieldPlace,
      afterState: afterFieldPlace,
      source: "action_resolution",
      chainId: "test-field-place-ben",
      getCardDefinitionById: getPlaceDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
      enterFieldCausedByPlayerId: "alice",
    });
    expect(
      fieldPlaceQueued.pendingTriggeredEffects.some(
        (pending) => pending.relatedInstanceId === "ben-effect-placed"
      )
    ).toBe(false);

    const mixedPlaySourceBefore = createCardInstance(card, {
      instanceId: "ben-normal-source-mixed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const mixedPlacedBefore = createCardInstance(card, {
      instanceId: "ben-field-place-mixed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const mixedPlayBefore = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [mixedPlaySourceBefore, mixedPlacedBefore],
    });
    const mixedPlayAfter: GameState = {
      ...mixedPlayBefore,
      log: [
        ...mixedPlayBefore.log,
        "effect:return_from_trash:alice:1:field",
        "effect:field_place:return_from_trash:alice:ben-field-place-mixed",
      ],
      cardInstances: mixedPlayBefore.cardInstances.map((instance) =>
        instance.instanceId === "ben-normal-source-mixed"
          ? {
              ...instance,
              zone: "field",
              zoneRoleName: "spirit",
              normalCoreCount: 1,
            }
          : instance.instanceId === "ben-field-place-mixed"
            ? {
                ...instance,
                zone: "field",
                zoneRoleName: "spirit",
              }
            : instance
      ),
    };
    const mixedPlayEvents = collectTriggerEventsFromStateDelta({
      beforeState: mixedPlayBefore,
      afterState: mixedPlayAfter,
      source: "action_resolution",
      chainId: "test-mixed-play-field-place",
      attackId: null,
      enterFieldCausedByPlayerId: "alice",
      enterFieldCauseExcludedInstanceIds: ["ben-normal-source-mixed"],
      getCardDefinitionById,
    });
    const mixedPlaySourceEvent = mixedPlayEvents.find(
      (event) => event.relatedInstanceId === "ben-normal-source-mixed"
    );
    expect(mixedPlaySourceEvent).toMatchObject({ eventKind: "summon" });
    expect(mixedPlaySourceEvent).not.toHaveProperty("cause");
    expect(
      mixedPlayEvents.find(
        (event) => event.relatedInstanceId === "ben-field-place-mixed"
      )
    ).toMatchObject({ eventKind: "place", cause: "self_effect" });

    const mixedMultiSummonBefore = createCardInstance(card, {
      instanceId: "ben-multi-summon-mixed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const mixedMultiPlacedBefore = createCardInstance(card, {
      instanceId: "ben-multi-place-mixed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
      normalCoreCount: 0,
    });
    const mixedMultiBefore = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [mixedMultiSummonBefore, mixedMultiPlacedBefore],
    });
    const mixedMultiAfter: GameState = {
      ...mixedMultiBefore,
      log: [
        ...mixedMultiBefore.log,
        "effect:summon:multi:from=hand:count=1:cost=0:interactive=true",
        "effect:summon:ben-multi-summon-mixed:self:multi-placement",
        "effect:search_deck:alice:1:field",
        "effect:field_place:search_deck:alice:ben-multi-place-mixed",
      ],
      cardInstances: mixedMultiBefore.cardInstances.map((instance) =>
        instance.instanceId === "ben-multi-summon-mixed"
          ? {
              ...instance,
              zone: "field",
              zoneRoleName: "spirit",
              normalCoreCount: 1,
            }
          : instance.instanceId === "ben-multi-place-mixed"
            ? {
                ...instance,
                zone: "field",
                zoneRoleName: "spirit",
              }
            : instance
      ),
    };
    const mixedMultiEvents = collectTriggerEventsFromStateDelta({
      beforeState: mixedMultiBefore,
      afterState: mixedMultiAfter,
      source: "action_resolution",
      chainId: "test-mixed-multi-field-place",
      attackId: null,
      enterFieldCausedByPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      mixedMultiEvents.find(
        (event) => event.relatedInstanceId === "ben-multi-summon-mixed"
      )
    ).toMatchObject({ eventKind: "summon", cause: "self_effect" });
    expect(
      mixedMultiEvents.find(
        (event) => event.relatedInstanceId === "ben-multi-place-mixed"
      )
    ).toMatchObject({ eventKind: "place", cause: "self_effect" });

    const resolveAction = getLegalActions({
      state: effectReady,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "ben-effect-summon"
    );
    expect(resolveAction).toBeDefined();
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected BSTH09-R01 resolve action");
    }
    expect(resolveAction.candidateTargetInstanceIds).toContain("bob-target");

    const declared = applyLegalAction({
      state: effectReady,
      action: resolveAction,
      ...lookups,
    }).state;
    expect(declared.window).toBe("stack");
    const passActor = declared.stackWindow?.priorityPlayerId;
    expect(passActor).toBeDefined();
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: passActor!,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const targetPendingState = applyLegalAction({
      state: declared,
      action: pass!,
      ...lookups,
    }).state;
    expect(targetPendingState.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      sourceInstanceId: "ben-effect-summon",
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });

    const targetAction = getLegalActions({
      state: targetPendingState,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const resolved = applyLegalAction({
      state: targetPendingState,
      action: targetAction!,
      targetInstanceIds: ["bob-target"],
      ...lookups,
    }).state;
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-target")
        ?.pendingLeaveKind
    ).toBe("destroy");

    const effectSummonerDef: CardDefinition = {
      cardNo: "TEST-EFFECT-SUMMON-BEN",
      name: "効果召喚テストソース",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const playCardSourceDef: CardDefinition = {
      ...effectSummonerDef,
      cardNo: "TEST-PLAY-CARD-NESTED-EFFECT-SUMMON",
      name: "通常プレイ内効果召喚テストソース",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "summon",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    };
    const allDefs = [...ALL_CARDS, effectSummonerDef, playCardSourceDef];
    const localDefMap = new Map<string, CardDefinition>(
      allDefs.map((def) => [def.cardNo, def])
    );
    const localGetCardDefinitionById = (id: string) => localDefMap.get(id);
    const localTriggeredLookup = buildTriggeredEffectLookup(allDefs);
    const localLookups = {
      getCardDefinitionById: localGetCardDefinitionById,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(allDefs),
      getRegisteredMagicActions: buildMagicLookup(allDefs),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(allDefs),
    };
    const effectSource = createCardInstance(effectSummonerDef, {
      instanceId: "effect-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const effectSummonState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [effectSource, inHand, bobTarget],
    };
    const effectSummonEffect: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "main" as const },
      steps: [
        {
          action: {
            kind: "summon" as const,
            target: {
              kind: "from_zone" as const,
              zone: "hand" as const,
              filter: { category: ["spirit" as const] },
              count: 1,
            },
            costModifier: "free" as const,
          },
        },
        {
          connector: "after_triggers" as const,
          action: {
            kind: "count_increase" as const,
            player: "self" as const,
            amount: 1,
          },
        },
      ],
    };
    localDefMap.set(effectSummonerDef.cardNo, {
      ...effectSummonerDef,
      effects: [effectSummonEffect],
    });
    const resolveBenPendingToDestroy = (
      state: GameState,
      benInstanceId: string,
      targetInstanceId: string
    ): GameState => {
      let current = state;
      if (current.pendingMultiPlacement !== null) {
        const placementAction = getLegalActions({
          state: current,
          actingPlayerId: current.pendingMultiPlacement.actingPlayerId,
          ...localLookups,
        }).find((a) => a.kind === "resolve_pending_multi_placement");
        expect(placementAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: placementAction!,
          multiPlacementAllocations:
            placementAction?.kind === "resolve_pending_multi_placement"
              ? placementAction.targets.map((target) => ({
                  destinationInstanceId: target.instanceId,
                  placements: [{ kind: "reserve_normal", amount: 1 }],
                }))
              : [],
          ...localLookups,
        }).state;
      }
      if (current.pendingEnterFieldPlacement !== null) {
        const placementAction = getLegalActions({
          state: current,
          actingPlayerId: current.pendingEnterFieldPlacement.actingPlayerId,
          ...localLookups,
        }).find((a) => a.kind === "resolve_pending_enter_field_placement");
        expect(placementAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: placementAction!,
          enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          ...localLookups,
        }).state;
      }
      while (current.pendingBurstChecks.length > 0) {
        const actingPlayerId = current.pendingBurstChecks[0]!.actingPlayerId;
        const burstCheckAction = getLegalActions({
          state: current,
          actingPlayerId,
          ...localLookups,
          getRegisteredBurstActions: () => undefined,
        }).find(
          (a) =>
            a.kind === "resolve_pending_burst_check" ||
            a.kind === "decline_pending_burst_check"
        );
        expect(burstCheckAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: burstCheckAction!,
          ...localLookups,
          getRegisteredBurstActions: () => undefined,
        }).state;
      }
      let actions = getLegalActions({
        state: current,
        actingPlayerId: "alice",
        ...localLookups,
      });
      let resolveBen = actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          (a.sourceEffectInstanceId ?? a.sourceInstanceId) === benInstanceId
      );
      if (!resolveBen) {
        const select = actions.find(
          (a) =>
            a.kind === "select_pending_to_resolve" &&
            a.sourceInstanceId === benInstanceId
        );
        expect(select).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: select!,
          skipOptionalEffect: true,
          ...localLookups,
        }).state;
        actions = getLegalActions({
          state: current,
          actingPlayerId: "alice",
          ...localLookups,
        });
        resolveBen = actions.find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            (a.sourceEffectInstanceId ?? a.sourceInstanceId) === benInstanceId
        );
      }
      const autoResolvedToTargetSelection =
        current.pendingEffectTargetSelection?.sourceInstanceId ===
        benInstanceId;
      if (
        !autoResolvedToTargetSelection &&
        (!resolveBen || resolveBen.kind !== "resolve_pending_triggered_effect")
      ) {
        throw new Error(
          `expected BSTH09-R01 resolve action for ${benInstanceId}`
        );
      }
      let targetPending = current;
      if (targetPending.pendingEffectTargetSelection === null) {
        expect(resolveBen).toBeDefined();
        const declaredState = applyLegalAction({
          state: current,
          action: resolveBen!,
          ...localLookups,
        }).state;
        const passActor = declaredState.stackWindow?.priorityPlayerId;
        expect(passActor).toBeDefined();
        const passAction = getLegalActions({
          state: declaredState,
          actingPlayerId: passActor!,
          ...localLookups,
        }).find((a) => a.kind === "pass_stack");
        expect(passAction).toBeDefined();
        targetPending = applyLegalAction({
          state: declaredState,
          action: passAction!,
          ...localLookups,
        }).state;
      }
      const targetAction = getLegalActions({
        state: targetPending,
        actingPlayerId: "alice",
        ...localLookups,
      }).find((a) => a.kind === "resolve_pending_effect_target");
      expect(targetAction).toBeDefined();
      const resolvedState = applyLegalAction({
        state: targetPending,
        action: targetAction!,
        targetInstanceIds: [targetInstanceId],
        ...localLookups,
      }).state;
      expect(
        resolvedState.cardInstances.find(
          (c) => c.instanceId === targetInstanceId
        )?.pendingLeaveKind
      ).toBe("destroy");
      return resolvedState;
    };
    const settleEffectSummon = (state: GameState): GameState => {
      let current = state;
      if (current.pendingMultiPlacement !== null) {
        const placementAction = getLegalActions({
          state: current,
          actingPlayerId: current.pendingMultiPlacement.actingPlayerId,
          ...localLookups,
        }).find((a) => a.kind === "resolve_pending_multi_placement");
        expect(placementAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: placementAction!,
          multiPlacementAllocations:
            placementAction?.kind === "resolve_pending_multi_placement"
              ? placementAction.targets.map((target) => ({
                  destinationInstanceId: target.instanceId,
                  placements: [{ kind: "reserve_normal", amount: 1 }],
                }))
              : [],
          ...localLookups,
        }).state;
      }
      if (current.pendingEnterFieldPlacement !== null) {
        const placementAction = getLegalActions({
          state: current,
          actingPlayerId: current.pendingEnterFieldPlacement.actingPlayerId,
          ...localLookups,
        }).find((a) => a.kind === "resolve_pending_enter_field_placement");
        expect(placementAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: placementAction!,
          enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          ...localLookups,
        }).state;
      }
      while (current.pendingBurstChecks.length > 0) {
        const actingPlayerId = current.pendingBurstChecks[0]!.actingPlayerId;
        const burstCheckAction = getLegalActions({
          state: current,
          actingPlayerId,
          ...localLookups,
          getRegisteredBurstActions: () => undefined,
        }).find(
          (a) =>
            a.kind === "resolve_pending_burst_check" ||
            a.kind === "decline_pending_burst_check"
        );
        expect(burstCheckAction).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: burstCheckAction!,
          ...localLookups,
          getRegisteredBurstActions: () => undefined,
        }).state;
      }
      return current;
    };
    const afterEffectSummon = settleEffectSummon(
      runActionMainResolution({
        state: effectSummonState,
        chainId: "test-effect-summon-ben",
        triggerBeforeState: effectSummonState,
        startLogs: [],
        endLogs: [],
        context: {
          chainId: "test-effect-summon-ben",
          resolutionKind: "field_card_effect_action",
          actingPlayerId: "alice",
          sourceKind: "spirit",
          sourceCard: effectSource,
          sourceDefinition: effectSummonerDef,
          targetInstanceIds: [],
          getCardDefinitionById: localGetCardDefinitionById,
          getRegisteredTriggeredEffectActions: localTriggeredLookup,
          getRegisteredBurstActions: undefined,
        },
        resolveEffect: (state, context) =>
          executeEffect({
            state,
            sourceInstanceId: "effect-source",
            actingPlayerId: "alice",
            chainId: context.chainId,
            getCardDefinitionById: localGetCardDefinitionById,
            getRegisteredTriggeredEffectActions: localTriggeredLookup,
            effect: effectSummonEffect,
          }),
      })
    );
    const effectRoutePendings =
      afterEffectSummon.pendingTriggeredEffects.filter(
        (p) => p.relatedInstanceId === "ben-effect-summon"
      );
    expect(effectRoutePendings).toHaveLength(1);
    expect(effectRoutePendings[0]).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "ben-effect-summon",
    });

    const afterLegacyContextEffectSummon = settleEffectSummon(
      runActionMainResolution({
        state: effectSummonState,
        chainId: "test-legacy-context-effect-summon-ben",
        triggerBeforeState: effectSummonState,
        startLogs: [],
        endLogs: [],
        context: {
          chainId: "test-legacy-context-effect-summon-ben",
          actingPlayerId: "alice",
          sourceCard: effectSource,
          sourceDefinition: effectSummonerDef,
          targetInstanceIds: [],
          getCardDefinitionById: localGetCardDefinitionById,
          getRegisteredTriggeredEffectActions: localTriggeredLookup,
          getRegisteredBurstActions: undefined,
        },
        resolveEffect: (state, context) =>
          executeEffect({
            state,
            sourceInstanceId: "effect-source",
            actingPlayerId: "alice",
            chainId: context.chainId,
            getCardDefinitionById: localGetCardDefinitionById,
            getRegisteredTriggeredEffectActions: localTriggeredLookup,
            effect: effectSummonEffect,
          }),
      })
    );
    const legacyRoutePendings =
      afterLegacyContextEffectSummon.pendingTriggeredEffects.filter(
        (p) => p.relatedInstanceId === "ben-effect-summon"
      );
    expect(legacyRoutePendings).toHaveLength(1);
    expect(legacyRoutePendings[0]).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "ben-effect-summon",
    });

    const playSourceHand = createCardInstance(playCardSourceDef, {
      instanceId: "play-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const playSourceField = {
      ...playSourceHand,
      zone: "field" as const,
      zoneRoleName: "spirit" as const,
      normalCoreCount: 1,
    };
    const nestedBen = createCardInstance(card, {
      instanceId: "ben-play-nested-effect",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const nestedBobTarget = createCardInstance(targetDef, {
      instanceId: "bob-target-play-nested",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const nestedBeforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: 2, reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [playSourceHand, nestedBen, nestedBobTarget],
    };
    const nestedPlayState: GameState = {
      ...nestedBeforeState,
      cardInstances: [playSourceField, nestedBen, nestedBobTarget],
    };
    const afterNestedPlayEffectSummon = settleEffectSummon(
      runActionMainResolution({
        state: nestedPlayState,
        chainId: "test-play-card-nested-effect-summon",
        triggerBeforeState: nestedBeforeState,
        startLogs: [],
        endLogs: [],
        context: {
          chainId: "test-play-card-nested-effect-summon",
          resolutionKind: "play_card_action",
          actingPlayerId: "alice",
          sourceKind: "spirit",
          sourceCard: playSourceField,
          sourceDefinition: playCardSourceDef,
          targetInstanceIds: [],
          getCardDefinitionById: localGetCardDefinitionById,
          getRegisteredTriggeredEffectActions: localTriggeredLookup,
          getRegisteredBurstActions: undefined,
        },
        resolveEffect: (state, context) =>
          executeEffect({
            state,
            sourceInstanceId: "play-source",
            actingPlayerId: "alice",
            chainId: context.chainId,
            getCardDefinitionById: localGetCardDefinitionById,
            getRegisteredTriggeredEffectActions: localTriggeredLookup,
            effect: effectSummonEffect,
          }),
      })
    );
    const nestedSummonPendings =
      afterNestedPlayEffectSummon.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "summon"
      );
    expect(
      nestedSummonPendings.some(
        (pending) => pending.relatedInstanceId === "play-source"
      )
    ).toBe(false);
    expect(
      nestedSummonPendings.filter(
        (pending) => pending.relatedInstanceId === "ben-play-nested-effect"
      )
    ).toHaveLength(1);
    expect(
      nestedSummonPendings.find(
        (pending) => pending.relatedInstanceId === "ben-play-nested-effect"
      )?.cause
    ).toBe("self_effect");

    const effectRouteResolve = getLegalActions({
      state: afterEffectSummon,
      actingPlayerId: "alice",
      ...localLookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        (a.sourceEffectInstanceId ?? a.sourceInstanceId) === "ben-effect-summon"
    );
    expect(effectRouteResolve).toBeDefined();
    if (
      !effectRouteResolve ||
      effectRouteResolve.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected BSTH09-R01 resolve action after effect summon");
    }
    const effectRouteDeclared = applyLegalAction({
      state: afterEffectSummon,
      action: effectRouteResolve,
      ...localLookups,
    }).state;
    const effectRoutePassActor =
      effectRouteDeclared.stackWindow?.priorityPlayerId;
    expect(effectRoutePassActor).toBeDefined();
    const effectRoutePass = getLegalActions({
      state: effectRouteDeclared,
      actingPlayerId: effectRoutePassActor!,
      ...localLookups,
    }).find((a) => a.kind === "pass_stack");
    expect(effectRoutePass).toBeDefined();
    const effectRouteTargetPending = applyLegalAction({
      state: effectRouteDeclared,
      action: effectRoutePass!,
      ...localLookups,
    }).state;
    const effectRouteTargetAction = getLegalActions({
      state: effectRouteTargetPending,
      actingPlayerId: "alice",
      ...localLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(effectRouteTargetAction).toBeDefined();
    const effectRouteResolved = applyLegalAction({
      state: effectRouteTargetPending,
      action: effectRouteTargetAction!,
      targetInstanceIds: ["bob-target"],
      ...localLookups,
    }).state;
    expect(
      effectRouteResolved.cardInstances.find(
        (c) => c.instanceId === "bob-target"
      )?.pendingLeaveKind
    ).toBe("destroy");

    const triggeredBen = createCardInstance(card, {
      instanceId: "ben-triggered-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const triggeredTarget = createCardInstance(targetDef, {
      instanceId: "bob-target-triggered",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const triggeredSource = createCardInstance(effectSummonerDef, {
      instanceId: "triggered-effect-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const triggeredSummonPending = useResolvePendingTriggeredEffectAsAction({
      state: {
        ...effectSummonState,
        cardInstances: [triggeredSource, triggeredBen, triggeredTarget],
        pendingTriggeredEffects: [
          {
            pendingId: "pending-trigger-summons-ben",
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId: "test:bsth09-cards:2237",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "triggered-effect-source",
            amount: null,
            step: "main",
            window: "none",
            resolvedSourceInstanceIds: ["triggered-effect-source"],
          },
        ],
      },
      actingPlayerId: "alice",
      pendingId: "pending-trigger-summons-ben",
      resolveEffect: (state, context) =>
        executeEffect({
          state,
          sourceInstanceId: "triggered-effect-source",
          actingPlayerId: "alice",
          chainId: context.chainId,
          getCardDefinitionById: localGetCardDefinitionById,
          getRegisteredTriggeredEffectActions: localTriggeredLookup,
          effect: effectSummonEffect,
        }),
      getCardDefinitionById: localGetCardDefinitionById,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
      getRegisteredBurstActions: undefined,
    }).state;
    expect(triggeredSummonPending.pendingMultiPlacement).not.toBeNull();
    expect(
      triggeredSummonPending.pendingTriggeredEffects.filter(
        (pending) => pending.relatedInstanceId === "ben-triggered-summon"
      )
    ).toHaveLength(0);
    const triggeredEffectResolved = settleEffectSummon(triggeredSummonPending);
    const triggeredRoutePendings =
      triggeredEffectResolved.pendingTriggeredEffects.filter(
        (p) => p.relatedInstanceId === "ben-triggered-summon"
      );
    expect(triggeredRoutePendings).toHaveLength(1);
    expect(triggeredRoutePendings[0]).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "ben-triggered-summon",
    });
    resolveBenPendingToDestroy(
      triggeredEffectResolved,
      "ben-triggered-summon",
      "bob-target-triggered"
    );

    const burstBen = createCardInstance(card, {
      instanceId: "ben-burst-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const burstTarget = createCardInstance(targetDef, {
      instanceId: "bob-target-burst",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const burstSource = createCardInstance(effectSummonerDef, {
      instanceId: "burst-effect-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const burstEffectResolved = playBurstFollowUpCardWithoutPayingCost({
      state: {
        ...effectSummonState,
        cardInstances: [burstSource, burstBen, burstTarget],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-effect-source",
      targetInstanceId: "ben-burst-summon",
      getCardDefinitionById: localGetCardDefinitionById,
      getRegisteredTriggeredEffectActions: localTriggeredLookup,
      getRegisteredBurstActions: undefined,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      chainId: "test-burst-follow-up-summon",
    }).state;
    expect(burstEffectResolved.log).toContain(
      "effect:summon:ben-burst-summon:self:burst_follow_up"
    );
    const burstRoutePendings =
      burstEffectResolved.pendingTriggeredEffects.filter(
        (p) => p.relatedInstanceId === "ben-burst-summon"
      );
    expect(burstRoutePendings).toHaveLength(1);
    expect(burstRoutePendings[0]).toMatchObject({
      eventKind: "summon",
      cause: "self_effect",
      relatedInstanceId: "ben-burst-summon",
    });
    resolveBenPendingToDestroy(
      burstEffectResolved,
      "ben-burst-summon",
      "bob-target-burst"
    );
  });

  it("BSTH09-R01: deck_reveal の field pick でも効果召喚として cause 付き summon 誘発に乗る", () => {
    const sourceDef: CardDefinition = {
      cardNo: "TEST-DECK-REVEAL-SUMMON-BEN",
      name: "デッキオープン効果召喚テストソース",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = [...ALL_CARDS, sourceDef];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const getDef = (id: string) => defMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const source = createCardInstance(sourceDef, {
      instanceId: "deck-reveal-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 0,
    });
    const benInDeck = createCardInstance(card, {
      instanceId: "ben-deck-reveal-summon",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler = createCardInstance(cardNoMap.get("BSTH09-C01")!, {
      instanceId: "deck-reveal-filler",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const beforeReveal: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, benInDeck, filler],
    };
    const afterPending = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth09-cards:2397",
      state: beforeReveal,
      sourceInstanceId: "deck-reveal-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 2,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: card.name } },
                  destination: "field",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
      },
    });
    const pick = getLegalActions({
      state: afterPending,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pick).toBeDefined();
    const afterReveal = finishCoreChoices(
      applyLegalAction({
        state: afterPending,
        action: pick!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        selectedDeckRevealCardIds: ["ben-deck-reveal-summon"],
      }).state,
      getDef,
      { getRegisteredTriggeredEffectActions: triggeredLookup }
    );
    expect(afterReveal.log).toContain(
      "effect:summon:ben-deck-reveal-summon:self:deck_reveal"
    );
    expect(
      afterReveal.cardInstances.find(
        (instance) => instance.instanceId === "ben-deck-reveal-summon"
      )
    ).toMatchObject({ zone: "field", zoneRoleName: "spirit" });

    expect(
      afterReveal.pendingTriggeredEffects.filter(
        (pending) =>
          pending.eventKind === "summon" &&
          pending.relatedInstanceId === "ben-deck-reveal-summon"
      )
    ).toHaveLength(1);
    expect(
      afterReveal.pendingTriggeredEffects.find(
        (pending) => pending.relatedInstanceId === "ben-deck-reveal-summon"
      )
    ).toMatchObject({ cause: "self_effect" });
  });
});

describe("BSTH09-R02 八橋", () => {
  const card = cardNoMap.get("BSTH09-R02")!;
  it("弁々条件で 八橋/弁々にBP+5000(no_duplicate) / 手札・手元フラッシュ/スタック手札破棄gate", () => {
    const bpEffect = card.effects![0]!;
    expect(bpEffect.condition?.[0]?.kind).toBe("field_has");
    expect(bpEffect.usageLimit).toEqual({ kind: "no_duplicate" });
    const bp = bpEffect.steps[0]!.action;
    expect(bp.kind).toBe("bp_modify");
    if (bp.kind === "bp_modify") expect(bp.amount).toBe(5000);
    const gate = card.effects![1]!;
    expect(gate.stub).toBeUndefined();
    expect(gate.timingScope).toEqual({ player: "self", period: "attack" });
    expect(gate.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(gate.usageLimit).toEqual({ kind: "no_duplicate" });
    const action = gate.steps[0]!.action;
    expect(action.kind).toBe("gate_flash_stack_hand_discard");
    if (action.kind === "gate_flash_stack_hand_discard") {
      expect(action.targetEffectLabels).toEqual(["flash", "stack"]);
      expect(action.sourceActivationZones).toEqual(["hand", "set_aside"]);
      expect(action.count).toMatchObject({ divisor: 2 });
    }
  });
});

describe("BSTH09-R03 進撃の小人 (magic)", () => {
  const card = cardNoMap.get("BSTH09-R03")!;
  it("勇傑/妖戒 発生源限定自己回収 + フラッシュ(cap:1 ライフ下限保護)", () => {
    expect(card.effects!.length).toBe(2);
    expect(card.effects![1]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    // [0] 〔ターンに1回:同名〕勇傑/妖戒効果でデッキオープン＆手札5枚以下の発生源限定自己回収を実装
    //     (BSFT01-C04 add 型同型 + per_card_name usageLimit)。[1] フラッシュは life_damage_interception。
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![0]!.timing).toEqual({
      kind: "card_event",
      event: "revealed",
    });
    expect(card.effects![0]!.condition).toEqual([
      { kind: "trigger_tribes", tribes: ["勇傑", "妖戒"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
      { kind: "hand_count", player: "self", max: 5 },
    ]);
    expect(card.effects![1]!.stub).toBeUndefined();
    const flashAction = card.effects![1]!.steps[0]!.action;
    expect(flashAction.kind).toBe("life_damage_interception");
    if (flashAction.kind === "life_damage_interception") {
      expect(flashAction.mode).toBe("replace");
      expect(flashAction.cap).toBe(1);
      expect(flashAction.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        minCost: 4,
      });
    }
  });
});

describe("BSTH09-TR01(A) 柱斧 (転醒nexus)", () => {
  const card = cardNoMap.get("BSTH09-TR01(A)")!;
  it("rebirth / 配置時 destroy / メイン draw(turn) / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    expect(card.effects![0]!.steps[0]!.action.kind).toBe("rebirth");
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("destroy");
    const draw = card.effects![2]!;
    expect(draw.steps[0]!.action.kind).toBe("draw");
    expect(draw.usageLimit).toEqual({ kind: "per_instance", duration: "turn" });
  });

  it("配置時destroy は最もBPの低い相手 1 体に絞る extremal セレクタ (stub撤去)", () => {
    const destroy = card.effects![1]!;
    expect(destroy.stub).toBeUndefined();
    const action = destroy.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.extremal).toEqual({
        metric: "bp",
        mode: "lowest",
      });
      expect(action.target.count).toBe(1);
    } else {
      throw new Error("destroy filter target expected");
    }
  });

  it("[board] 最もBPの低い相手 1 体のみ破壊・他は残る", () => {
    const src = createCardInstance(card, {
      instanceId: "hashiruono-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手フィールドに BP 2000 / 4000 / 5000 のスピリットを並べる。
    const low = createCardInstance(cardNoMap.get("BSDB01-C05")!, {
      instanceId: "bp2000",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1, // クリリン Lv1 BP2000
    });
    const mid = createCardInstance(cardNoMap.get("BSDB01-C01")!, {
      instanceId: "bp4000",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1, // 孫悟空 Lv1 BP4000
    });
    const high = createCardInstance(cardNoMap.get("BSDB01-C02")!, {
      instanceId: "bp5000",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1, // ベジータ Lv1 BP5000
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src, low, mid, high],
    });
    const after = runEffect(before, card.effects![1]!, "hashiruono-1", "alice");
    const byId = (id: string) =>
      after.cardInstances.find((x) => x.instanceId === id)!;
    expect(byId("bp2000").pendingLeaveKind).toBe("destroy"); // 最低BP → 破壊
    expect(byId("bp4000").pendingLeaveKind).toBeNull(); // 対象外
    expect(byId("bp5000").pendingLeaveKind).toBeNull(); // 対象外
  });
});

describe("BSTH09-X01 針妙丸", () => {
  const card = cardNoMap.get("BSTH09-X01")!;
  it("effects[0] は effect_declaration(stack) への任意割り込み、effects[1] メイン終了時 (phase main end) は stub 解消", () => {
    const interrupt = card.effects![0]!;
    expect(interrupt.stub).toBeUndefined();
    expect(interrupt.timing).toMatchObject({
      kind: "game_event",
      player: "opponent",
      event: "effect_declaration",
      triggerEffectTiming: "stack",
      triggerEffectLabel: "stack",
    });
    expect(interrupt.timingScope).toBeUndefined();
    expect(interrupt.condition).toEqual([
      { kind: "min_level", value: 1 },
      { kind: "step_phase", step: "attack", whose: "self" },
      {
        kind: "self_state",
        state: "on_field",
        battleState: "attacking",
        pendingDeclaration: "attack",
      },
    ]);
    expect(interrupt.executionMode).toBe("optional");
    expect(interrupt.steps[0]!.action).toEqual({
      kind: "borrow_card_event_effect",
      target: { kind: "self" },
      borrowEvents: ["attack"],
      suppressResponseStack: true,
    });

    const phase = card.effects!.find((e) => e.timing.kind === "phase")!;
    if (phase.timing.kind === "phase") {
      expect(phase.timing.step).toBe("main");
      expect(phase.timing.subPhase).toBe("end");
    }
    expect(card.effects![1]!.stub).toBeUndefined();
  });

  it("コア移動後、3種類を合算して0〜3つ選ぶ", () => {
    expect(card.effects![1]!.steps[1]).toMatchObject({
      id: "removalTargets",
      connector: "conditional_result",
      targetSelectionTiming: "on_step",
      action: {
        kind: "noop",
        target: {
          zone: ["field", "mirage", "burst"],
          count: { min: 0, max: 3 },
        },
      },
    });
  });
});

describe("BSTH09-X01 effects[0] 盤面変化: 相手スタック効果発揮前の攻撃時効果割り込み", () => {
  const baseX01 = cardNoMap.get("BSTH09-X01")!;
  const deckCard: CardDefinition = {
    cardNo: "TEST-BSTH09-X01-DECK",
    name: "テスト用デッキカード",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const bobStackSource: CardDefinition = {
    cardNo: "TEST-BSTH09-X01-BOB-STACK",
    name: "テスト用相手スタック源",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["blue"],
    textLines: ["スタック", "自分はデッキから1枚ドローする。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0, 1],
      },
    ],
  };
  const otherAttackerDef: CardDefinition = {
    ...deckCard,
    cardNo: "TEST-BSTH09-X01-OTHER-ATTACKER",
    name: "テスト用別アタッカー",
    cost: 1,
  };
  const bobTargetDef: CardDefinition = {
    ...deckCard,
    cardNo: "TEST-BSTH09-X01-BOB-TARGET",
    name: "テスト用相手対象",
    colors: ["blue"],
    symbolColors: ["blue"],
    cost: 1,
  };
  const grantedAttackEffect: NonNullable<CardDefinition["effects"]>[number] = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    textRef: [0, 1],
  };
  const grantedSecondAttackEffect: NonNullable<
    CardDefinition["effects"]
  >[number] = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    textRef: [0, 1],
  };
  const grantedTargetAttackEffect: NonNullable<
    CardDefinition["effects"]
  >[number] = {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "exhaust",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: 1,
          },
        },
      },
    ],
    textRef: [0, 1],
  };
  const grantSourceDef: CardDefinition = {
    ...deckCard,
    cardNo: "TEST-BSTH09-X01-GRANT-SOURCE",
    name: "テスト用アタック時効果付与源",
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "自分はデッキから1枚ドローする。",
    ],
    effects: [],
  };
  const attachedBraveDef: CardDefinition = {
    ...deckCard,
    cardNo: "TEST-BSTH09-X01-ATTACHED-BRAVE",
    name: "テスト用合体ブレイヴ",
    printedCategory: "brave",
    textLines: [
      "【合体中】Lv1-Lv2『このスピリットのアタック時』",
      "自分はデッキから1枚ドローする。",
    ],
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { combined: true },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0, 1],
      },
    ],
  };
  const x01Card = baseX01;
  const definitions = [
    x01Card,
    grantSourceDef,
    attachedBraveDef,
    bobStackSource,
    bobTargetDef,
    otherAttackerDef,
    deckCard,
  ];
  const localCardMap = new Map(definitions.map((def) => [def.cardNo, def]));
  const getDefinition = (id: string) => localCardMap.get(id);
  const lookups = {
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredBurstActions: () => undefined,
  };

  function bobStack(
    activationLabel?: ActiveStack["activationLabel"]
  ): ActiveStack {
    return {
      stackId: "stack:bob-stack",
      actionKind: "field_card_effect",
      chainId: "chain:bob-stack",
      actingPlayerId: "bob",
      cardInstanceId: "bob-stack-source",
      cardDefinitionId: bobStackSource.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "stack",
      ...(activationLabel !== undefined ? { activationLabel } : {}),
      fieldEffectSourceKind: "field",
      fieldEffectRegistrationIndex: 0,
      previousResponseSourcePlayerId: "alice",
      previousPendingStackAction: null,
    };
  }

  function makeState(options: {
    x01Cores?: number;
    activeAttack?: "x01" | "other" | "none" | "pre_attack";
    bobActivationLabel?: ActiveStack["activationLabel"];
    grantKind?: "draw" | "two_draws" | "target" | "none";
    attachedBrave?: boolean;
  }): GameState {
    const x01 = createCardInstance(x01Card, {
      instanceId: "alice-x01",
      ownerPlayerId: "alice",
      zone: "field",
      cores: options.x01Cores ?? 1,
      attachedChildrenIds: options.attachedBrave
        ? ["alice-attached-brave"]
        : [],
    });
    const attachedBrave = options.attachedBrave
      ? createCardInstance(attachedBraveDef, {
          instanceId: "alice-attached-brave",
          ownerPlayerId: "alice",
          zone: "field",
          attachedToInstanceId: "alice-x01",
        })
      : null;
    const bobSource = createCardInstance(bobStackSource, {
      instanceId: "bob-stack-source",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const bobTarget = createCardInstance(bobTargetDef, {
      instanceId: "bob-target",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const grantSource = createCardInstance(grantSourceDef, {
      instanceId: "alice-grant-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const aliceDeck = createCardInstance(deckCard, {
      instanceId: "alice-deck-1",
      ownerPlayerId: "alice",
      zone: "deck",
    });
    const bobDeck = createCardInstance(deckCard, {
      instanceId: "bob-deck-1",
      ownerPlayerId: "bob",
      zone: "deck",
    });
    const otherAttacker =
      options.activeAttack === "other"
        ? createCardInstance(otherAttackerDef, {
            instanceId: "alice-other-attacker",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          })
        : null;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        x01,
        ...(attachedBrave ? [attachedBrave] : []),
        grantSource,
        bobSource,
        bobTarget,
        aliceDeck,
        bobDeck,
        ...(otherAttacker ? [otherAttacker] : []),
      ],
    });
    // grant_effect 解決後の state を直接構成する。borrow 側は CE.metadata.grantedEffect を候補化する。
    const buildGrantedAttackCes = (
      createdAtAttackId: string | null
    ): ContinuousEffect[] => {
      const grantKind = options.grantKind ?? "draw";
      const effects: Array<[string, typeof grantedAttackEffect]> = [];
      if (grantKind === "draw" || grantKind === "two_draws") {
        effects.push(["draw", grantedAttackEffect]);
      }
      if (grantKind === "two_draws") {
        effects.push(["draw-2", grantedSecondAttackEffect]);
      }
      if (grantKind === "target") {
        effects.push(["target", grantedTargetAttackEffect]);
      }
      return effects.map(([suffix, grantedEffect]) => ({
        effectId: `ce:alice-x01-granted-attack:${suffix}`,
        sourceInstanceId: grantSource.instanceId,
        sourceDefinitionId: grantSourceDef.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "while_on_field" },
        createdAtTurn: base.turnNumber,
        createdAtAttackId,
        modifierTag: "granted_effect" as const,
        targetInstanceId: x01.instanceId,
        metadata: {
          grantedEffect,
          grantPlayerRef: "self",
        },
      }));
    };
    if (options.activeAttack === "none") {
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "stack",
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          ...buildGrantedAttackCes(null),
        ],
        stackWindow: {
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          actingPlayerId: "bob",
          previousWindow: "none",
          stackResponseSourcePlayerId: "bob",
          subStackEverOpened: false,
          burstWindowKind: null,
          pendingStackAction: bobStack(options.bobActivationLabel),
        },
      };
    }
    if (options.activeAttack === "pre_attack") {
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "pre_declaration_stack",
        activeContinuousEffects: [
          ...base.activeContinuousEffects,
          ...buildGrantedAttackCes(null),
        ],
        preDeclarationStackWindow: {
          kind: "attack",
          actingPlayerId: "alice",
          sourceInstanceId: "alice-x01",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          previousWindow: "attack",
          stackResponseSourcePlayerId: "bob",
          subStackEverOpened: false,
          burstWindowKind: null,
          pendingStackAction: bobStack(options.bobActivationLabel),
        },
      };
    }
    const attackingInstanceId =
      options.activeAttack === "other" ? "alice-other-attacker" : "alice-x01";
    const attackingEntityId = `battle-entity:${attackingInstanceId}`;
    const attackingMemberInstanceIds =
      attackingInstanceId === "alice-x01" && options.attachedBrave
        ? [attackingInstanceId, "alice-attached-brave"]
        : [attackingInstanceId];
    return {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      window: "stack",
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        ...buildGrantedAttackCes(`attack:${attackingInstanceId}`),
      ],
      battleEntities: [
        {
          entityId: attackingEntityId,
          memberInstanceIds: attackingMemberInstanceIds,
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        ...(options.activeAttack === "other"
          ? [
              {
                entityId: "battle-entity:alice-x01",
                memberInstanceIds: ["alice-x01"],
                resolvedBp: 8000,
                resolvedSymbols: ["red"],
                attackState: "idle" as const,
              },
            ]
          : []),
      ],
      activeAttack: {
        attackId: `attack:${attackingInstanceId}`,
        primaryEntityId: attackingEntityId,
        participantEntityIds: [attackingEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          { participantEntityId: attackingEntityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [attackingEntityId],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: null,
        },
      },
      stackWindow: {
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        actingPlayerId: "bob",
        previousWindow: "flash_before_block",
        stackResponseSourcePlayerId: "bob",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: bobStack(options.bobActivationLabel),
      },
    };
  }

  function passInitialResponse(state: GameState): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((candidate) =>
      state.preDeclarationStackWindow
        ? candidate.kind === "pass_pre_declaration_stack"
        : state.stackWindow
          ? candidate.kind === "pass_stack"
          : candidate.kind === "pass_battle_flash"
    );
    expect(action).toBeDefined();
    return applyLegalAction({ state, action: action!, ...lookups }).state;
  }

  function resolveAliceTriggeredEffect(
    state: GameState,
    skipOptionalEffect = false
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_triggered_effect"
    );
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      ...lookups,
      skipOptionalEffect,
    }).state;
  }

  function passOpenStack(state: GameState): GameState {
    const stackWindow =
      state.stackWindow ??
      state.preDeclarationStackWindow ??
      state.activeAttack?.flashWindowState;
    expect(stackWindow?.priorityPlayerId).toBeDefined();
    const action = getLegalActions({
      state,
      actingPlayerId: stackWindow!.priorityPlayerId,
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "pass_stack" ||
        candidate.kind === "pass_pre_declaration_stack" ||
        candidate.kind === "pass_battle_flash"
    );
    expect(action).toBeDefined();
    return applyLegalAction({ state, action: action!, ...lookups }).state;
  }

  it("accept: X01が攻撃中なら自身のアタック時効果を先に発揮し、その後に相手stack効果を解決する", () => {
    const interrupted = passInitialResponse(makeState({ activeAttack: "x01" }));
    expect(interrupted.pendingTriggeredEffects).toHaveLength(1);
    expect(interrupted.pendingTriggeredEffects[0]).toMatchObject({
      actingPlayerId: "alice",
      eventKind: "effect_declaration",
      relatedInstanceId: "bob-stack-source",
      effectActivationTiming: "stack",
    });

    const x01Stacked = resolveAliceTriggeredEffect(interrupted);
    const resolved = passOpenStack(x01Stacked);

    expect(resolved.log).toContain(
      `borrow_card_event_effect:defer_response_stack:stack:bob-stack:${bobStackSource.cardNo}`
    );
    expect(resolved.log).toContain(
      `borrow_card_event_effect:executed:${x01Card.cardNo}:-1:as:alice-x01`
    );
    const aliceDrawIndex = resolved.log.indexOf("effect:draw:alice:1");
    const bobDrawIndex = resolved.log.indexOf("effect:draw:bob:1");
    expect(aliceDrawIndex).toBeGreaterThanOrEqual(0);
    expect(bobDrawIndex).toBeGreaterThan(aliceDrawIndex);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "alice-deck-1")
        ?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("accept: X01自身のアタック宣言への相手stackにも、攻撃成立前から割り込んでから再開する", () => {
    const interrupted = passInitialResponse(
      makeState({ activeAttack: "pre_attack" })
    );
    expect(interrupted.pendingTriggeredEffects).toHaveLength(1);

    const x01Stacked = resolveAliceTriggeredEffect(interrupted);
    const resolved = passOpenStack(x01Stacked);

    expect(resolved.log).toContain(
      `borrow_card_event_effect:defer_response_stack:stack:bob-stack:${bobStackSource.cardNo}`
    );
    const aliceDrawIndex = resolved.log.indexOf("effect:draw:alice:1");
    const bobDrawIndex = resolved.log.indexOf("effect:draw:bob:1");
    expect(aliceDrawIndex).toBeGreaterThanOrEqual(0);
    expect(bobDrawIndex).toBeGreaterThan(aliceDrawIndex);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "alice-deck-1")
        ?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("decline: private declaration をスキップすると相手stack効果は通常解決する", () => {
    const interrupted = passInitialResponse(makeState({ activeAttack: "x01" }));
    const resolved = resolveAliceTriggeredEffect(interrupted, true);

    expect(resolved.log).not.toContain(
      `borrow_card_event_effect:defer_response_stack:stack:bob-stack:${bobStackSource.cardNo}`
    );
    expect(resolved.log).toContain("effect:draw:bob:1");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("activationLabel:none の本文中stack使用には割り込まない", () => {
    const resolved = passInitialResponse(
      makeState({ activeAttack: "x01", bobActivationLabel: "none" })
    );

    expect(resolved.pendingPrivateDeclarations).toHaveLength(0);
    expect(resolved.log).not.toContain(
      `borrow_card_event_effect:defer_response_stack:stack:bob-stack:${bobStackSource.cardNo}`
    );
    expect(resolved.log).toContain("effect:draw:bob:1");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("Lv不足・attack中でない・X01がアタッカーでない場合は割り込まない", () => {
    const cases: Array<[string, Parameters<typeof makeState>[0]]> = [
      ["Lv不足", { activeAttack: "x01", x01Cores: 0 }],
      ["attack中でない", { activeAttack: "none" }],
      ["X01がアタッカーでない", { activeAttack: "other" }],
    ];

    for (const [, options] of cases) {
      const resolved = passInitialResponse(makeState(options));
      expect(resolved.pendingPrivateDeclarations).toHaveLength(0);
      expect(resolved.log).toContain("effect:draw:bob:1");
    }
  });

  it("accept: 合体ブレイヴから追加されたアタック時効果も借用候補に含めて先に発揮する", () => {
    const interrupted = passInitialResponse(
      makeState({
        activeAttack: "x01",
        grantKind: "none",
        attachedBrave: true,
      })
    );
    expect(interrupted.pendingTriggeredEffects).toHaveLength(1);

    const x01Stacked = resolveAliceTriggeredEffect(interrupted);
    const resolved = passOpenStack(x01Stacked);

    expect(resolved.log).toContain(
      `borrow_card_event_effect:executed:${attachedBraveDef.cardNo}:0:as:alice-x01`
    );
    const aliceDrawIndex = resolved.log.indexOf("effect:draw:alice:1");
    const bobDrawIndex = resolved.log.indexOf("effect:draw:bob:1");
    expect(aliceDrawIndex).toBeGreaterThanOrEqual(0);
    expect(bobDrawIndex).toBeGreaterThan(aliceDrawIndex);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("choice: 複数の借用候補選択中は相手stackを待機させ、選択後に再開する", () => {
    const interrupted = passInitialResponse(
      makeState({ activeAttack: "x01", grantKind: "two_draws" })
    );
    const choosing = passOpenStack(resolveAliceTriggeredEffect(interrupted));
    expect(choosing.pendingBorrowedEffectChoice).toMatchObject({
      actingPlayerId: "alice",
      targetInstanceId: "alice-x01",
    });
    expect(choosing.pendingStackCascade?.remainingStacks[0]?.stackId).toBe(
      "stack:bob-stack"
    );

    const action = getLegalActions({
      state: choosing,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_borrowed_effect_choice" &&
        candidate.borrowedEffectIndex === -1
    );
    expect(action).toBeDefined();
    expect(action).not.toHaveProperty("effectSourceDefinitionId");
    expect(action).not.toHaveProperty("effectSourceInstanceId");
    const resolved = applyLegalAction({
      state: choosing,
      action: action!,
      ...lookups,
    }).state;

    const aliceDrawIndex = resolved.log.indexOf("effect:draw:alice:1");
    const bobDrawIndex = resolved.log.indexOf("effect:draw:bob:1");
    expect(aliceDrawIndex).toBeGreaterThanOrEqual(0);
    expect(bobDrawIndex).toBeGreaterThan(aliceDrawIndex);
    expect(resolved.pendingStackCascade).toBeNull();
  });

  it("target selection: 借用効果の対象選択中は相手stackを待機させ、対象解決後に再開する", () => {
    const interrupted = passInitialResponse(
      makeState({ activeAttack: "x01", grantKind: "target" })
    );
    const selecting = passOpenStack(resolveAliceTriggeredEffect(interrupted));
    expect(selecting.pendingBorrowedEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      choosingPlayerId: "alice",
      targetInstanceId: "alice-x01",
    });
    expect(selecting.pendingStackCascade?.remainingStacks[0]?.stackId).toBe(
      "stack:bob-stack"
    );

    const action = getLegalActions({
      state: selecting,
      actingPlayerId: "alice",
      ...lookups,
    }).find((candidate) => candidate.kind === "resolve_borrowed_effect_target");
    expect(action).toBeDefined();
    const resolved = applyLegalAction({
      state: selecting,
      action: action!,
      targetInstanceIds: ["bob-target"],
      ...lookups,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-target")
        ?.exhaustState
    ).toBe("exhausted");
    const bobDrawIndex = resolved.log.indexOf("effect:draw:bob:1");
    expect(bobDrawIndex).toBeGreaterThanOrEqual(0);
    expect(resolved.pendingStackCascade).toBeNull();
  });
});

describe("BSTH09-X01 effects[1] 盤面変化: 異種アクション間の共有カウント予算(3つまで)", () => {
  const card = cardNoMap.get("BSTH09-X01")!;
  const effect = card.effects![1]!;

  const testNexus: CardDefinition = {
    cardNo: "TEST-BSTH09-X01-NEXUS",
    name: "テストネクサス",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const testMirage: CardDefinition = {
    cardNo: "TEST-BSTH09-X01-MIRAGE",
    name: "テストミラージュ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "moved_to_trash" },
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        textRef: [],
      },
    ],
  };
  const testBurst: CardDefinition = {
    cardNo: "TEST-BSTH09-X01-BURST",
    name: "テストバースト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: ["【バースト：適当】"],
    keywordTags: ["burst"],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const testLookup = (id: string): CardDefinition | undefined =>
    id === card.cardNo
      ? card
      : id === testNexus.cardNo
        ? testNexus
        : id === testMirage.cardNo
          ? testMirage
          : id === testBurst.cardNo
            ? testBurst
            : undefined;
  const ALICE = "alice";
  const BOB = "bob";

  function setup() {
    const src = createCardInstance(card, {
      instanceId: "x01-src",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const nexus1 = createCardInstance(testNexus, {
      instanceId: "bob-nexus-1",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const mirage1 = createCardInstance(testMirage, {
      instanceId: "bob-mirage-1",
      ownerPlayerId: BOB,
      zone: "mirage",
    });
    const mirage2 = createCardInstance(testMirage, {
      instanceId: "bob-mirage-2",
      ownerPlayerId: BOB,
      zone: "mirage",
    });
    const burst1 = createCardInstance(testBurst, {
      instanceId: "bob-burst-1",
      ownerPlayerId: BOB,
      zone: "burst",
    });
    const burst2 = createCardInstance(testBurst, {
      instanceId: "bob-burst-2",
      ownerPlayerId: BOB,
      zone: "burst",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, nexus1, mirage1, mirage2, burst1, burst2],
      playerOverrides: [{ trashNormalCoreCount: 2 }, {}],
    });
    return {
      before: {
        ...before,
        setBurstStates: [
          { playerId: BOB, cardInstanceId: "bob-burst-1" },
          { playerId: BOB, cardInstanceId: "bob-burst-2" },
        ],
        mirageSetStates: [
          { playerId: BOB, cardInstanceId: mirage1.instanceId },
          { playerId: BOB, cardInstanceId: mirage2.instanceId },
        ],
      },
      src,
      nexus1,
      mirage1,
      mirage2,
      burst1,
      burst2,
    };
  }

  it("ミラージュ破棄は moved_to_trash を発揮させず、セット状態も同時に外す", () => {
    const ctx = setup();
    const suppressingMirageDiscard: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            fromZone: "mirage",
            count: 1,
            suppressMovedToTrashEffects: true,
          },
        },
      ],
      textRef: [],
    };

    const after = executeEffect({
      chainId: "test:bsth09-cards:3466",
      state: {
        ...ctx.before,
        cardInstances: ctx.before.cardInstances.filter(
          (instance) => instance.instanceId !== ctx.mirage2.instanceId
        ),
        mirageSetStates: [
          { playerId: BOB, cardInstanceId: ctx.mirage1.instanceId },
        ],
      },
      effect: suppressingMirageDiscard,
      sourceInstanceId: ctx.src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: testLookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      after.cardInstances.find(
        (instance) => instance.instanceId === ctx.mirage1.instanceId
      )?.zone
    ).toBe("trash");
    expect(after.mirageSetStates).toEqual([]);
  });

  it("任意上限のミラージュ選択は、抑止なしなら moved_to_trash を発揮する", () => {
    const ctx = setup();
    const optionalMirageDiscard: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            fromZone: "mirage",
            count: { min: 0, max: 2 },
          },
        },
      ],
      textRef: [],
    };

    const pending = executeEffect({
      chainId: "test:bsth09-cards:3510",
      state: ctx.before,
      effect: optionalMirageDiscard,
      sourceInstanceId: ctx.src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: testLookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const action = getLegalActions({
      state: pending,
      actingPlayerId: BOB,
      getCardDefinitionById: testLookup,
    }).find((candidate) => candidate.kind === "resolve_pending_zone_selection");
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: pending,
      action: action!,
      selectedZoneCardIds: [ctx.mirage1.instanceId],
      getCardDefinitionById: testLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(
      after.cardInstances.find(
        (instance) => instance.instanceId === ctx.mirage1.instanceId
      )?.zone
    ).toBe("hand");
    expect(after.mirageSetStates).toEqual([
      { playerId: BOB, cardInstanceId: ctx.mirage2.instanceId },
    ]);
  });

  function chooseTogether(ids: string[]) {
    const ctx = setup();
    const pending = executeEffect({
      chainId: "test:shinmyoumaru:combined-selection",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: testLookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const selection = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById: testLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(
      selection,
      JSON.stringify({
        log: pending.log.slice(-10),
        pending: pending.pendingStepOptionalTargetSelection,
      })
    ).toBeDefined();
    expect(selection).toMatchObject({
      candidateTargetInstanceIds: expect.arrayContaining([
        ctx.nexus1.instanceId,
        ctx.mirage1.instanceId,
        ctx.mirage2.instanceId,
        ctx.burst1.instanceId,
        ctx.burst2.instanceId,
      ]),
    });
    expect(pending.players[0]!.trashNormalCoreCount).toBe(0);
    expect(
      pending.cardInstances.find((c) => c.instanceId === ctx.src.instanceId)!
        .normalCoreCount
    ).toBe(4);
    const after = applyLegalAction({
      state: pending,
      action: selection!,
      targetInstanceIds: ids,
      getCardDefinitionById: testLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(after.pendingZoneSelection).toBeNull();
    expect(after.pendingDiscardSetBurstCountSelection).toBeNull();
    return applyStateBasedActions(after);
  }
  it("3種類を1つずつ一度に選び、選んだ3つだけ除去する", () => {
    const after = chooseTogether([
      "bob-nexus-1",
      "bob-mirage-2",
      "bob-burst-2",
    ]);
    expect(
      after.cardInstances
        .filter((c) => c.zone === "trash")
        .map((c) => c.instanceId)
        .sort()
    ).toEqual(["bob-burst-2", "bob-mirage-2", "bob-nexus-1"]);
    expect(after.setBurstStates.map((b) => b.cardInstanceId)).toEqual([
      "bob-burst-1",
    ]);
    expect(after.mirageSetStates.map((b) => b.cardInstanceId)).toEqual([
      "bob-mirage-1",
    ]);
    expect(after.log).toContain("moved_to_trash:suppressed:bob:1");
  });
  it("0つでも確定できる", () => {
    expect(
      chooseTogether([]).cardInstances.filter((c) => c.zone === "trash")
    ).toEqual([]);
  });
  it("バーストだけ1つ選べる", () => {
    expect(
      chooseTogether(["bob-burst-2"])
        .cardInstances.filter((c) => c.zone === "trash")
        .map((c) => c.instanceId)
    ).toEqual(["bob-burst-2"]);
  });
  it("合計4つは拒否する", () => {
    expect(() =>
      chooseTogether([
        "bob-nexus-1",
        "bob-mirage-1",
        "bob-mirage-2",
        "bob-burst-1",
      ])
    ).toThrow();
  });
});

describe("BSTH09-X02 正邪", () => {
  const card = cardNoMap.get("BSTH09-X02")!;

  it("effects[0] 残置付与は grant_effect、effects[1] 最高Lv扱いは override_properties(level:max) で表現", () => {
    expect(card.effects!.length).toBe(2);
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![1]!.stub).toBeUndefined();
  });

  it("effects[0] DSL構造: timingScope(自分アタックstep) + grant_effect(target:filter 勇傑/妖戒/付喪 maxCost7 printed) + grantedEffect(leave_field/opponent_effect, stay_on_field+core_distribute)", () => {
    const grantEffect = card.effects![0]!;
    expect(grantEffect.timing).toEqual({ kind: "continuous" });
    expect(grantEffect.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    const action = grantEffect.steps[0]!.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind !== "grant_effect") return;
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      count: "all",
      filter: {
        category: ["spirit"],
        tribes: ["勇傑", "妖戒", "付喪"],
        maxCost: 7,
        costBasis: "printed",
      },
    });
    expect(action.duration).toEqual({
      scope: "step",
      whose: "self",
      step: "attack",
    });
    expect(action.grantedEffect!.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    expect(action.grantedEffect!.executionMode).toBe("optional");
    expect(action.grantedEffect!.steps[0]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
    expect(action.grantedEffect!.steps[1]!.action).toEqual({
      kind: "core_distribute",
      from: { kind: "field_and_reserve_self" },
      to: { kind: "self" },
      amount: "all",
      mode: "player_choice",
    });
  });

  it("[board] 相手起因のフィールド離脱で同じ状態のまま残せる(execute)", () => {
    const source = createCardInstance(card, {
      instanceId: "masakado-source",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    // 正邪自身も本来コスト5/妖戒・幻想なので自身の filter (勇傑/妖戒/付喪, maxCost:7) に合致する。
    const ally = createCardInstance(card, {
      instanceId: "masakado-ally",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const state = {
      ...createEmptyGameState({ cardInstances: [source, ally] }),
      step: "attack" as const,
      activePlayerId: "player-1",
    };
    const granted = executeEffect({
      chainId: "test:bsth09-cards:3718",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "masakado-source",
      actingPlayerId: "player-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "masakado-ally"
      )
    ).toBe(true);

    const chainId = "masakado-opponent-leave";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "masakado-ally",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "player-2",
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "leave_field",
          relatedInstanceId: "masakado-ally",
          relatedPlayerId: "player-1",
          cause: "opponent_effect",
          chainId,
        },
      ],
      getCardDefinitionById
    );
    const pending = queued.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "granted_effect"
    )[0]!;
    expect(pending.relatedInstanceId).toBe("masakado-ally");

    const action = getLegalActions({
      state: queued,
      actingPlayerId: "player-1",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === pending.pendingId
    );
    expect(action).toBeDefined();
    let resolved = applyLegalAction({
      state: queued,
      action: action!,
      getCardDefinitionById,
      skipOptionalEffect: false,
    }).state;
    let guard = 0;
    while (resolved.stackWindow && guard++ < 10) {
      const actingPlayerId = resolved.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: resolved,
        actingPlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(pass).toBeDefined();
      resolved = applyLegalAction({
        state: resolved,
        action: pass!,
        getCardDefinitionById,
      }).state;
    }

    const allyAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "masakado-ally"
    )!;
    expect(allyAfter.zone).toBe("field");
    expect(allyAfter.exhaustState).toBe("exhausted");
    expect(allyAfter.pendingLeaveKind).toBeNull();
  });

  it("[board] メインステップ (自分のアタックステップ外) では timingScope 未充足のため誘発 pending が積まれない", () => {
    const source = createCardInstance(card, {
      instanceId: "masakado-main-source",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const ally = createCardInstance(card, {
      instanceId: "masakado-main-ally",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 2,
    });
    const mainState = {
      ...createEmptyGameState({ cardInstances: [source, ally] }),
      step: "main" as const,
      activePlayerId: "player-1",
    };
    const granted = executeEffect({
      chainId: "test:bsth09-cards:3821",
      state: mainState,
      effect: card.effects![0]!,
      sourceInstanceId: "masakado-main-source",
      actingPlayerId: "player-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    // CE 自体は timingScope に関わらず登録される (isContinuousEffectSuppressed: "timingScope
    // only narrows the active period; it is not an activation gate")。
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "masakado-main-ally"
      )
    ).toBe(true);

    const chainId = "masakado-main-leave";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "masakado-main-ally",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "player-2",
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "leave_field",
          relatedInstanceId: "masakado-main-ally",
          relatedPlayerId: "player-1",
          cause: "opponent_effect",
          chainId,
        },
      ],
      getCardDefinitionById
    );
    // メインステップ (自分のアタックステップ外) では isCEActiveForScope が false になり、
    // 誘発 pending は積まれない (grant-effect-system.ts の timingScope ゲート)。
    expect(
      queued.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toHaveLength(0);
  });

  it("[board] 自分のアタックステップ・正邪Lv2以上のとき、本来コスト7以下の妖戒スピリットは最高Lv扱いになる", () => {
    const masakado = createCardInstance(card, {
      instanceId: "masakado",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // levelDefs lv2.requiredCores === 2
    });
    const yousenDef: CardDefinition = {
      cardNo: "TEST-YOUSEN",
      name: "test yousen spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 5, bp: 2000 },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "妖戒",
      effects: [],
    };
    const targetCard = createCardInstance(yousenDef, {
      instanceId: "yousen-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // 単独では Lv1
    });
    const getDef = (id: string) =>
      id === "TEST-YOUSEN" ? yousenDef : getCardDefinitionById(id);

    const attackState = {
      ...createEmptyGameState({ cardInstances: [masakado, targetCard] }),
      step: "attack" as const,
      activePlayerId: "alice",
    };
    const afterAttack = rebuildContinuousEffectsFromField(attackState, getDef);
    expect(getEffectiveLevel(afterAttack, targetCard, yousenDef, getDef)).toBe(
      2
    );

    // timingScope: { player: "self", period: "attack" } — メインステップでは適用されない
    const mainState = { ...attackState, step: "main" as const };
    const afterMain = rebuildContinuousEffectsFromField(mainState, getDef);
    expect(getEffectiveLevel(afterMain, targetCard, yousenDef, getDef)).toBe(1);
  });

  it("[board] filter に maxCost/costBasis を含んでいても動的メンバーシップ (global CE) になり、CE 登録後に場入りした対象にも即座に適用される", () => {
    const masakado = createCardInstance(card, {
      instanceId: "masakado",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const yousenDef: CardDefinition = {
      cardNo: "TEST-YOUSEN",
      name: "test yousen spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 5, bp: 2000 },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "妖戒",
      effects: [],
    };
    const getDef = (id: string) =>
      id === "TEST-YOUSEN" ? yousenDef : getCardDefinitionById(id);

    const attackState = {
      ...createEmptyGameState({ cardInstances: [masakado] }),
      step: "attack" as const,
      activePlayerId: "alice",
    };
    const afterAttack = rebuildContinuousEffectsFromField(attackState, getDef);

    // CE 登録は既存 field カード (masakado のみ) 基準。CE 自体が targetInstanceId 固定の
    // snapshot でなく targetFilter ベースの global CE であることを確認する。
    const ce = afterAttack.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "override_properties" &&
        (c.metadata?.properties as Record<string, unknown> | undefined)
          ?.level === "max"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBeUndefined();
    expect(ce!.targetFilter).toBeDefined();

    // CE 登録後に新規スピリットが場入りしても（rebuild 済 state に直接追加）、
    // targetFilter の動的メンバーシップにより即座に最高Lv扱いになる。
    const lateJoiner = createCardInstance(yousenDef, {
      instanceId: "yousen-late",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const withLateJoiner = {
      ...afterAttack,
      cardInstances: [...afterAttack.cardInstances, lateJoiner],
    };
    expect(
      getEffectiveLevel(withLateJoiner, lateJoiner, yousenDef, getDef)
    ).toBe(2);
  });
});

describe("BSTH09-X03 雷鼓", () => {
  const card = cardNoMap.get("BSTH09-X03")!;
  it("弁々+八橋でBP+10000 (field_has×2)", () => {
    const e = card.effects![0]!;
    expect(e.condition?.length).toBe(2);
    const a = e.steps[0]!.action;
    if (a.kind === "bp_modify") expect(a.amount).toBe(10000);
  });

  it("[3,4] Lv2-Lv3 付喪/勇傑/妖戒スピのアタック時 choice(相手ライフ→リザーブ or 赤シンボル+1) を game_event + triggerFilter で配線", () => {
    const trig = card.effects![1]!;
    expect(trig.stub).toBeUndefined();
    expect(trig.textRef).toEqual([3, 4]);
    expect(trig.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "attack",
      triggerFilter: {
        category: ["spirit"],
        tribes: ["付喪", "勇傑", "妖戒"],
      },
    });
    expect(trig.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(trig.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(trig.steps).toHaveLength(1);
    const step = trig.steps[0]!;
    expect(step.action.kind).toBe("core_move");
    if (step.action.kind === "core_move") {
      expect(step.action.from).toEqual({ kind: "life", player: "opponent" });
      expect(step.action.to).toEqual({ kind: "reserve", player: "opponent" });
      expect(step.action.amount).toBe(1);
    }
    expect(step.choice).toHaveLength(1);
    const choiceAction = step.choice![0]!.action;
    expect(choiceAction.kind).toBe("symbol_add");
    if (choiceAction.kind === "symbol_add") {
      expect(choiceAction.target).toEqual({
        kind: "trigger_related_instance",
      });
      expect(choiceAction.symbol).toBe("red");
      expect(choiceAction.duration).toEqual({ scope: "battle" });
    }
  });

  it("[board] choiceIndex:0(既定) で相手ライフのコア1個がリザーブへ移動する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(card, {
      instanceId: "raiko-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2, // Lv2
    });
    const state: GameState = { ...base, cardInstances: [source] };
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const result = executeEffect({
      chainId: "test:bsth09-cards:4038",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "raiko-source",
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: "raiko-source",
    });
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(
      bobBefore.lifeNormalCoreCount - 1
    );
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
  });

  it("[board] choiceIndex:1 でトリガー対象カード(アタックしたスピリット)に赤シンボルがバトル終了まで付与される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(card, {
      instanceId: "raiko-source-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const attacker = createCardInstance(card, {
      instanceId: "raiko-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = { ...base, cardInstances: [source, attacker] };
    const result = executeEffect({
      chainId: "test:bsth09-cards:4072",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "raiko-source-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
      triggerRelatedInstanceId: "raiko-attacker",
      choiceIndex: 1,
    });
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.targetInstanceId === "raiko-attacker" &&
          (ce as { modifierSymbol?: string[] }).modifierSymbol?.[0] === "red" &&
          ce.duration?.scope === "battle"
      )
    ).toBe(true);
    // choice 側を選んだので相手ライフは減らない。
    const bobAfter = result.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(5);
  });
});
