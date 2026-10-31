import { describe, expect, it } from "vitest";
import type { CardDefinition, CollectedTriggerEvent } from "../src";
import {
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
  queuePendingReactionsRawForTesting,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

/**
 * リスナー無し step イベントで空 pending が累積しないことを保証する回帰テスト。
 *
 * 経緯: P3-36 で `select_pending_to_resolve` を導入した結果、
 * `start_step` / `end_step` / `after_draw` 等のステップイベントが
 * リスナー無しでも `pendingTriggeredEffects` に積まれていたバグが GUI に露出した。
 * 6 step 送り（新規ゲーム想定）で空 pending が累積し、毎ステップ
 * 「中身が空の select_pending_to_resolve ボタン」が増殖する症状になっていた。
 */

function makeStartStepEvent(
  actingPlayerId: string = "alice"
): CollectedTriggerEvent {
  return {
    actingPlayerId,
    eventKind: "start_step",
    source: "step_transition",
    chainId: "test:listener-less-step-event:23",
    attackId: null,
    relatedPlayerId: actingPlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
}

function makeEndStepEvent(
  actingPlayerId: string = "alice"
): CollectedTriggerEvent {
  return {
    actingPlayerId,
    eventKind: "end_step",
    source: "step_transition",
    chainId: "test:listener-less-step-event:40",
    attackId: null,
    relatedPlayerId: actingPlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "end",
    subPhase: "end",
  };
}

const emptyDefinitionLookup = (_id: string): CardDefinition | undefined =>
  undefined;
const emptyTriggerLookup = buildTriggeredEffectLookup([]);

describe("listener-less step events do not leak empty pendings", () => {
  it("リスナー無し start_step イベントは pendingTriggeredEffects に積まれない", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice")],
      undefined,
      {
        getCardDefinitionById: emptyDefinitionLookup,
        getRegisteredTriggeredEffectActions: emptyTriggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(next.pendingTriggeredEffects).toHaveLength(0);
  });

  it("複数の listener-less ステップイベントを連続 queue しても累積しない", () => {
    let state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const events: CollectedTriggerEvent[] = [
      makeStartStepEvent("alice"),
      makeEndStepEvent("alice"),
      makeStartStepEvent("bob"),
      makeEndStepEvent("bob"),
      makeStartStepEvent("alice"),
      makeEndStepEvent("alice"),
    ];
    for (const event of events) {
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [event],
        undefined,
        {
          getCardDefinitionById: emptyDefinitionLookup,
          getRegisteredTriggeredEffectActions: emptyTriggerLookup,
          getRegisteredBurstActions: () => undefined,
        }
      );
    }
    expect(state.pendingTriggeredEffects).toHaveLength(0);
  });

  it("レガシー経路（options 未提供）は従来動作維持: raw pending を残す", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const next = queuePendingReactionsRawForTesting(state, [
      makeStartStepEvent("alice"),
    ]);
    expect(next.pendingTriggeredEffects).toHaveLength(1);
  });
});

/**
 * 743cc69 の `end_attack_step` 修正と対称の回帰テスト。
 * マジック解決中に発火する `after_draw` / `increase_hand` (game_event)
 * イベントは action_resolution 経由で `collectAndQueueTriggerReactions`
 * に流れる。 `getRegisteredTriggeredEffectActions` を渡し損ねていると
 * リスナー無し event が空 pending として残留し、 GUI 側で
 * 「次のステップ」が押せなくなる。
 *
 * ユーザー報告の T7 メインステップ pendingTriggeredEffects 残留 (2 件) を再現する。
 */
import { playMagicCardAsAction } from "../src/index";
import { createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";

describe("magic resolution does not leak listener-less after_draw/increase_hand", () => {
  function makeDrawMagic(): CardDefinition {
    const drawEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          label: "draw3",
          action: { kind: "draw", player: "self", count: 3 },
        },
      ],
    };
    return {
      cardNo: "TEST-DRAW-MAGIC",
      name: "テストドローマジック",
      printedCategory: "magic",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [drawEffect],
    };
  }

  it("playMagicCardAsAction (low-level): draw 後に空 pending が残らない", () => {
    const def = makeDrawMagic();
    const lookup = (id: string): CardDefinition | undefined =>
      id === def.cardNo ? def : undefined;
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const magicCard = createCardInstance(def, {
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const stateWithMagic = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magicCard],
      step: "main",
      activePlayerId: "alice",
    });
    // alice にデッキ枚数を持たせる (draw が成立するように)
    const state: ReturnType<typeof createEmptyGameState> = {
      ...stateWithMagic,
      players: stateWithMagic.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 30 } : p
      ),
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: magicCard.instanceId,
      paymentSources: [],
      withoutCost: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });

    const leakedListenerLessPendings =
      result.state.pendingTriggeredEffects.filter(
        (p) =>
          (p.eventKind === "after_draw" || p.eventKind === "increase_hand") &&
          p.resolvedSourceInstanceIds.length === 0
      );
    expect(leakedListenerLessPendings).toHaveLength(0);
  });
});

// 注: applyLegalAction(use_magic) GUI 経路の統合検証は scenarios + Playwright 側で
// 実施する (action shape の組み立てに getLegalActions の生成が必要になり、 unit test
// での再現コストが大きい)。 上記 low-level テストで playMagicCardAsAction → context →
// runActionMainResolution の経路が修正済みであることを保証している。
//
// 旧チェーン全体: applyLegalAction.use_magic →
//   playMagicCardAsAction (getRegisteredTriggeredEffectActions を forward) →
//   resolveMagicMainAndMoveToTrash (createEffectActionContext に渡す) →
//   runActionMainResolution (context.getRegisteredTriggeredEffectActions で読み出し) →
//   collectAndQueueTriggerReactions (リスナー無し event を捨てる)
// この forward が抜けていた箇所を全 7 callsite で塞いだ。
