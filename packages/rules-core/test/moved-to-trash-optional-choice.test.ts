/**
 * moved_to_trash の任意手札追加（「加えられる」= 任意効果）のテスト。
 *
 * 仕様:
 *   - カードテキスト「…トラッシュに置かれたこのカードは手札に加えられる。」は
 *     可能形 = 任意効果。プレイヤーが手札に加えるか否かを選べる。
 *   - 任意効果は move プリミティブ内で即 pending を立てず `pendingTrashOptionalAdds` に退避し、
 *     他 pending が無い安定点で `materializeDeferredTrashOptionalAdds` が
 *     `pendingDeckReveal`(revealed_choice, origin="trash") に変換する。
 *   - これによりソース効果（例: BSTH01-R05 アクセルの step2=コア取得）が中断されない。
 *   - スタック窓は開かない（ユーザー裁定: ピック画面の add/not 選択のみ）。
 *
 * 対象カード: BSTH01-R12 幻象「ルナクロック」（executionMode: "optional"）。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src/index";
import {
  processMovedToTrashEffects,
  materializeDeferredTrashOptionalAdds,
} from "../src/effect/structured-effect-interpreter";
import { useAccelCardAsAction } from "../src/mechanics/accel-change-system";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const ルナクロック = cardNoMap.get("BSTH01-R12")!;
const 小悪魔 = cardNoMap.get("BSTH01-R05")!;
const ルーミア = cardNoMap.get("BSTH01-C04")!;
const C03 = cardNoMap.get("BSTH04-C03")!; // 召喚時: デッキ上2枚破棄→トラッシュの起幻黄/紫1枚を手札
const メディスン = cardNoMap.get("BSTH04-C02")!; // 起幻・黄（C03 の探索対象）

function setupTrashed() {
  const r12 = createCardInstance(ルナクロック, {
    instanceId: "r12-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "trash",
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [r12],
  });
  return { state, r12Id: r12.instanceId };
}

describe("moved_to_trash 任意手札追加 (BSTH01-R12)", () => {
  it("optional 効果は強制加入せず pendingTrashOptionalAdds に退避する（即 pending を立てない）", () => {
    const { state, r12Id } = setupTrashed();

    const result = processMovedToTrashEffects(state, [r12Id], getDef, {
      sourceColors: ["red"],
      fromZone: "deck",
    });

    // 強制で手札に入らない / トラッシュ据え置き
    expect(result.cardInstances.find((c) => c.instanceId === r12Id)!.zone).toBe(
      "trash"
    );
    // mid-effect では pending を立てず、退避キューに積むだけ
    expect(result.pendingDeckReveal).toBeNull();
    expect(result.pendingTrashOptionalAdds).toHaveLength(1);
    expect(result.pendingTrashOptionalAdds[0]!.actingPlayerId).toBe("alice");
    expect(result.pendingTrashOptionalAdds[0]!.instanceIds).toContain(r12Id);
  });

  it("materialize で revealed_choice pending (origin=trash) に変換される", () => {
    const { state, r12Id } = setupTrashed();
    const deferred = processMovedToTrashEffects(state, [r12Id], getDef, {
      sourceColors: ["red"],
      fromZone: "deck",
    });

    const result = materializeDeferredTrashOptionalAdds(deferred);

    expect(result.pendingTrashOptionalAdds).toHaveLength(0);
    const pending = result.pendingDeckReveal;
    expect(pending).not.toBeNull();
    expect(pending!.phase).toBe("revealed_choice");
    expect(pending!.origin).toBe("trash");
    expect(pending!.actingPlayerId).toBe("alice");
    expect(pending!.revealedAutoAddCandidateIds).toContain(r12Id);
  });

  it("選択なしで解決するとトラッシュ据え置きで pending 完了", () => {
    const { state, r12Id } = setupTrashed();
    const pendingState = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(state, [r12Id], getDef, {
        sourceColors: ["red"],
        fromZone: "deck",
      })
    );

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action).toBeDefined();

    const baseHand = pendingState.players.find(
      (p) => p.id === "alice"
    )!.handCount;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [],
    });

    expect(resolved.pendingDeckReveal).toBeNull();
    expect(resolved.pendingTrashOptionalAdds).toHaveLength(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === r12Id)!.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")!.handCount).toBe(
      baseHand
    );
  });

  it("選択するとトラッシュから手札へ移動し pending 完了", () => {
    const { state, r12Id } = setupTrashed();
    const pendingState = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(state, [r12Id], getDef, {
        sourceColors: ["red"],
        fromZone: "deck",
      })
    );

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;

    const baseHand = pendingState.players.find(
      (p) => p.id === "alice"
    )!.handCount;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [r12Id],
    });

    expect(resolved.pendingDeckReveal).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === r12Id)!.zone
    ).toBe("hand");
    expect(resolved.players.find((p) => p.id === "alice")!.handCount).toBe(
      baseHand + 1
    );
  });
});

describe("BSTH01-R05 アクセル + R12 同時: R05 step2(コア取得) が壊れない", () => {
  it("R12 を含む 3 枚トラッシュ後も R05 のコア配分 pending が出て、解決後に R12 任意追加が出る", () => {
    const r05Effect = 小悪魔.accelData!.effects![0]!;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 0,
      startingVoidNormalCoreCount: 5,
      playerOverrides: [
        { reserveNormalCoreCount: 0, trashNormalCoreCount: 0 },
        {},
      ],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(小悪魔, {
          instanceId: "k1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(ルナクロック, {
          instanceId: "d1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(ルーミア, {
          instanceId: "d2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(ルーミア, {
          instanceId: "d3",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 3 } : p
      ),
    };

    const afterAccel = executeEffect({
      chainId: "test:moved-to-trash-optional-choice:206",
      state,
      effect: r05Effect,
      sourceInstanceId: "k1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      costPaidThisEffect: 2,
    });

    // R05 step2（コア取得）は中断されず pending が出ている（回帰防止の要点）
    expect(afterAccel.pendingCoreSplitSelection).not.toBeNull();
    // R12 の任意追加は退避キューに積まれている（mid-effect で割り込まない）
    expect(afterAccel.pendingTrashOptionalAdds).toHaveLength(1);
    expect(afterAccel.pendingTrashOptionalAdds[0]!.instanceIds).toContain("d1");
    expect(afterAccel.pendingDeckReveal).toBeNull();
    // 3 枚ともトラッシュ
    for (const id of ["d1", "d2", "d3"]) {
      expect(
        afterAccel.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }

    // コア配分を解決すると、安定点で R12 任意追加が materialize される
    const splitAction = getLegalActions({
      state: afterAccel,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    expect(splitAction).toBeDefined();

    const total = afterAccel.pendingCoreSplitSelection!.totalAmount;
    // destinations[1](トラッシュ) は cap 無しなので全量をそちらへ配分（reserve cap 回避）
    const { state: afterSplit } = applyLegalAction({
      state: afterAccel,
      action: splitAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreSplitDistribution: [0, total],
    });

    expect(afterSplit.pendingCoreSplitSelection).toBeNull();
    expect(afterSplit.pendingTrashOptionalAdds).toHaveLength(0);
    // R12 の任意追加プロンプトが出ている
    expect(afterSplit.pendingDeckReveal).not.toBeNull();
    expect(afterSplit.pendingDeckReveal!.origin).toBe("trash");
    expect(afterSplit.pendingDeckReveal!.revealedAutoAddCandidateIds).toContain(
      "d1"
    );
  });
});

describe("BSTH04-C03『破棄→トラッシュから加える』と moved_to_trash 任意追加の共存", () => {
  it("捨てた2枚はトラッシュに残り C03 の探索が機能、R12 の任意追加は後で発火する", () => {
    // C03 召喚時: デッキ上2枚破棄 → トラッシュの起幻黄/紫1枚を手札に。
    // 捨てる2枚 = [R12(紅魔, moved_to_trash 任意追加あり), メディスン(起幻黄)]。
    const summonEffect = C03.effects![1]!; // [0]=continuous, [1]=card_event:summon
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(C03, {
          instanceId: "c03",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(ルナクロック, {
          instanceId: "d1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(メディスン, {
          instanceId: "d2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };

    let afterSummon = executeEffect({
      chainId: "test:moved-to-trash-optional-choice:292",
      state,
      effect: summonEffect,
      effectIndex: 1,
      sourceInstanceId: "c03",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const executeMill = getLegalActions({
      state: afterSummon,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    afterSummon = applyLegalAction({
      state: afterSummon,
      action: executeMill,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    // R12 は強制加入されずトラッシュに残り、任意追加は遅延キューへ。
    expect(
      afterSummon.cardInstances.find((c) => c.instanceId === "d1")!.zone
    ).toBe("trash");
    expect(afterSummon.pendingTrashOptionalAdds).toHaveLength(1);
    expect(afterSummon.pendingTrashOptionalAdds[0]!.instanceIds).toContain(
      "d1"
    );

    // C03 step2 は「トラッシュにある起幻黄/紫」を探索 → 捨てた メディスン(d2) を発見・手札へ。
    // = 捨てた札がトラッシュに残っていたことの証明（旧・強制即時加入なら壊れうる箇所）。
    expect(
      afterSummon.cardInstances.find((c) => c.instanceId === "d2")!.zone
    ).toBe("hand");

    // C03 が解決し切った安定点で R12 の任意追加が materialize される。
    while (afterSummon.pendingBurstChecks.length > 0) {
      const check = afterSummon.pendingBurstChecks[0]!;
      const action = getLegalActions({
        state: afterSummon,
        actingPlayerId: check.actingPlayerId,
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_burst_check")!;
      afterSummon = applyLegalAction({
        state: afterSummon,
        action,
        getCardDefinitionById: getDef,
      }).state;
    }
    const materialized = materializeDeferredTrashOptionalAdds(afterSummon);
    expect(materialized.pendingTrashOptionalAdds).toHaveLength(0);
    expect(materialized.pendingDeckReveal).not.toBeNull();
    expect(materialized.pendingDeckReveal!.origin).toBe("trash");
    expect(
      materialized.pendingDeckReveal!.revealedAutoAddCandidateIds
    ).toContain("d1");
  });
});

describe("回帰: 小悪魔アクセル自身の使用後 cleanup と R12 任意追加の安定点競合 (2026-07-20)", () => {
  it("useAccelCardAsAction 経由(実戦と同じ経路)でコア配分解決直後に pendingDeckReveal が materialize される", () => {
    // 実戦で観測されたバグ: 小悪魔(BSTH01-R05)のアクセルでミルされた R12 の
    // 任意手札追加が、アクセル完了時点では出現せず、次の無関係な合法手
    // (紅魔館の配置) を取った瞬間に初めて出現したように見えた。
    //
    // 原因: legal-actions-apply.ts の共有 post-action 安定点で
    // materializeDeferredTrashOptionalAdds を finalizePendingAccelCleanups より先に
    // 呼んでいたため、小悪魔自身の使用後 cleanup (pendingAccelCleanups) がまだ
    // 残っている間にガードでブロックされ、同じ安定点で発火し損ねていた。
    //
    // 上の describe ブロック「R05 step2 が壊れない」は executeEffect を直接呼ぶため
    // pendingAccelCleanups 自体が発生せずこの競合を検出できない。本テストは
    // useAccelCardAsAction (アクセルカード自身の cleanup も含む実際の経路) を使う。
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 0,
      startingVoidNormalCoreCount: 5,
      playerOverrides: [
        { reserveNormalCoreCount: 4, trashNormalCoreCount: 0 },
        {},
      ],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(小悪魔, {
          instanceId: "k1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(ルナクロック, {
          instanceId: "d1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(ルーミア, {
          instanceId: "d2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(ルーミア, {
          instanceId: "d3",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 3 } : p
      ),
    };

    const afterAccel = useAccelCardAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "k1",
      accelData: 小悪魔.accelData!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;

    // 小悪魔自身の cleanup はコア配分待ちに阻まれて退避キューに積まれている。
    expect(afterAccel.pendingAccelCleanups).toHaveLength(1);
    expect(afterAccel.pendingTrashOptionalAdds).toHaveLength(1);
    expect(afterAccel.pendingDeckReveal).toBeNull();

    const splitAction = getLegalActions({
      state: afterAccel,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    expect(splitAction).toBeDefined();

    const total = afterAccel.pendingCoreSplitSelection!.totalAmount;
    const { state: afterSplit } = applyLegalAction({
      state: afterAccel,
      action: splitAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreSplitDistribution: [0, total],
    });

    // 小悪魔自身の cleanup はこの安定点で完了しているはず。
    expect(afterSplit.pendingAccelCleanups).toHaveLength(0);
    expect(
      afterSplit.cardInstances.find((c) => c.instanceId === "k1")!.zone
    ).toBe("set_aside");
    // 回帰の要点: 同じ安定点で R12 の任意追加も materialize され、
    // 次の無関係な合法手を待たずにプロンプトが出ていること。
    expect(afterSplit.pendingTrashOptionalAdds).toHaveLength(0);
    expect(afterSplit.pendingDeckReveal).not.toBeNull();
    expect(afterSplit.pendingDeckReveal!.origin).toBe("trash");
    expect(afterSplit.pendingDeckReveal!.revealedAutoAddCandidateIds).toContain(
      "d1"
    );
  });
});
