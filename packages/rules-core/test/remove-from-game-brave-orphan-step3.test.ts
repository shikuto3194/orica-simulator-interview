/**
 * Step 3/4 of ENGINE-remove-from-game-attached-brave-orphan deep-mode landing:
 * checkBraveLeaveChoice / resolveBraveLeaveChoice の remove_from_game 対応を直接ユニットテスト。
 *
 * 検証対象:
 * - Step 1: PendingLeaveKind = "remove_from_game" 型拡張
 * - Step 2: flushPendingLeaves の getDefaultLeaveDestinationZone("remove_from_game") = "removed_from_game"
 * - Step 3 (本ステップ): checkBraveLeaveChoice / resolveBraveLeaveChoice が kind 無差別で
 *   remove_from_game を扱い、合体ブレイヴ orphan を防止できる事を確認。
 *   scaffolding として queuePendingLeave({kind:"remove_from_game"}) を直接呼ぶ
 *   (executeRemoveFromGame の queuePendingLeave 経由化は Step 4 で実装)。
 *
 * 最終目的: BSLH01-T10[1] の合体ブレイヴ orphan 解消 (Step 4 で executeRemoveFromGame を配線後に
 * 真の e2e 統合が成立する)。
 */
import { describe, it, expect } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  queuePendingLeave,
  resolveBraveLeaveChoice,
} from "../src";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function hostSpiritDef(): CardDefinition {
  return {
    cardNo: "RFG-HOST",
    name: "ホストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

function braveDef(): CardDefinition {
  return {
    cardNo: "RFG-BRAVE",
    name: "テストブレイヴ",
    printedCategory: "brave",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>([
  ["RFG-HOST", hostSpiritDef()],
  ["RFG-BRAVE", braveDef()],
]);
const getDef = (id: string) => defMap.get(id);

function setupCombinedUnit(): GameState {
  const host = createCardInstance(hostSpiritDef(), {
    instanceId: "host-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 2,
    attachedChildrenIds: ["brave-1"],
  });
  const brave = createCardInstance(braveDef(), {
    instanceId: "brave-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
    attachedToInstanceId: "host-1",
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return { ...base, cardInstances: [host, brave] };
}

describe("remove_from_game + 合体ブレイヴ host: checkBraveLeaveChoice 配線 (Step 3)", () => {
  it("queuePendingLeave({kind:'remove_from_game'}) → flushPendingLeaves で残存選択待ちが立つ", () => {
    const state = setupCombinedUnit();

    const queued = queuePendingLeave({
      state,
      instanceId: "host-1",
      kind: "remove_from_game",
      cause: "effect",
      chainId: "test-rfg-chain",
      causePlayerId: ALICE,
    });
    const pl = queued.pendingLeaveEntities.find(
      (p) => p.instanceId === "host-1"
    );
    expect(pl?.kind).toBe("remove_from_game");

    const flushed = flushPendingLeaves(queued, getDef);

    // 合体ホストの remove_from_game 離脱はブレイヴ残存の選択待ちを立てる。
    expect(flushed.pendingBraveLeaveChoice).not.toBeNull();
    expect(flushed.pendingBraveLeaveChoice?.hostInstanceId).toBe("host-1");
    expect(flushed.pendingBraveLeaveChoice?.leaveKind).toBe("remove_from_game");
    expect(flushed.pendingBraveLeaveChoice?.braveInstanceIds).toEqual([
      "brave-1",
    ]);

    // 選択前なのでホスト/ブレイヴ共に場に残る。
    const host = flushed.cardInstances.find((c) => c.instanceId === "host-1");
    const brave = flushed.cardInstances.find((c) => c.instanceId === "brave-1");
    expect(host?.zone).toBe("field");
    expect(brave?.zone).toBe("field");
  });

  it("resolveBraveLeaveChoice('keep'): ホストのみ removed_from_game へ、ブレイヴは場残留", () => {
    const state = setupCombinedUnit();
    const queued = queuePendingLeave({
      state,
      instanceId: "host-1",
      kind: "remove_from_game",
      cause: "effect",
      chainId: "test-rfg-chain",
      causePlayerId: ALICE,
    });
    const flushed = flushPendingLeaves(queued, getDef);
    expect(flushed.pendingBraveLeaveChoice).not.toBeNull();

    const kept = resolveBraveLeaveChoice(flushed, "keep");
    // 選択待ちは解除済み。
    expect(kept.pendingBraveLeaveChoice).toBeNull();
    // ホストは flush で removed_from_game に着地済みのはず。
    const finalState = flushPendingLeaves(kept, getDef);
    const host = finalState.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    const brave = finalState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    expect(host?.zone).toBe("removed_from_game");
    // ブレイヴはフィールドに残り、合体リンクが解除されている。
    expect(brave?.zone).toBe("field");
    expect(brave?.attachedToInstanceId).toBeNull();
  });

  it("resolveBraveLeaveChoice('send_with_host'): ブレイヴも removed_from_game へ追従 (orphan 防止)", () => {
    const state = setupCombinedUnit();
    const bobReserveBefore = state.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;

    const queued = queuePendingLeave({
      state,
      instanceId: "host-1",
      kind: "remove_from_game",
      cause: "effect",
      chainId: "test-rfg-chain",
      causePlayerId: ALICE,
    });
    const flushed = flushPendingLeaves(queued, getDef);
    expect(flushed.pendingBraveLeaveChoice).not.toBeNull();

    const sent = resolveBraveLeaveChoice(flushed, "send_with_host");
    // ブレイヴ用の新規 pendingLeaveEntities が積まれる (kind は host と同じ remove_from_game)。
    const bravePl = sent.pendingLeaveEntities.find(
      (p) => p.instanceId === "brave-1"
    );
    expect(bravePl?.kind).toBe("remove_from_game");

    const finalState = flushPendingLeaves(sent, getDef);
    const host = finalState.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    const brave = finalState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    // 双方 removed_from_game へ。orphan は発生しない。
    expect(host?.zone).toBe("removed_from_game");
    expect(brave?.zone).toBe("removed_from_game");
    // 合体リンクは解除済み。
    expect(brave?.attachedToInstanceId).toBeNull();
    expect(host?.attachedChildrenIds).toEqual([]);
    // ホスト 2 + ブレイヴ 1 = 3 コアが bob リザーブへ戻る。
    const bobReserveAfter = finalState.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;
    expect(bobReserveAfter).toBe(bobReserveBefore + 3);
  });
});
