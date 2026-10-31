/**
 * Step 4/4 of ENGINE-remove-from-game-attached-brave-orphan deep-mode landing:
 * executeRemoveFromGame の queuePendingLeave 経由化を e2e で検証。
 *
 * Step 3 までは `queuePendingLeave({kind:"remove_from_game"})` を直接呼ぶ scaffolding で
 * checkBraveLeaveChoice / resolveBraveLeaveChoice の挙動を unit テスト。Step 4 では
 * `executeRemoveFromGame` をエントリポイントに、合体ブレイヴを伴うホストを対象とし、
 * 配線済みの field 分岐 (toRemove.filter(c=>c.zone==='field') → queuePendingLeave) が
 * 正しく pendingBraveLeaveChoice を起動し、'keep' / 'send_with_host' どちらでも
 * orphan が発生しない事を直接 assert する。
 *
 * 最終目的: BSLH01-T10[1]「相手のスピリット/アルティメット4体を除外する。この効果で
 * 離れた対象はフィールドに残せない」相当のフラッシュ効果が、合体ブレイヴをアタッチした
 * ホストに対して使われたときに orphan を発生させないこと。
 */
import { describe, it, expect } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeRemoveFromGame,
  flushPendingLeaves,
  resolveBraveLeaveChoice,
} from "../src";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function hostSpiritDef(): CardDefinition {
  return {
    cardNo: "RFG-S4-HOST",
    name: "ステップ4ホストスピリット",
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
    cardNo: "RFG-S4-BRAVE",
    name: "ステップ4テストブレイヴ",
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
  ["RFG-S4-HOST", hostSpiritDef()],
  ["RFG-S4-BRAVE", braveDef()],
]);
const getDef = (id: string) => defMap.get(id);

const OPP_TARGET = {
  selfCard: false,
  player: "opponent" as const,
  count: -1,
};

function setupCombinedUnit(): GameState {
  // bob (相手) のフィールドにホスト + 合体中ブレイヴを置く。
  // alice が相手として remove_from_game を打つ想定。
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

describe("ENGINE-remove-from-game-attached-brave-orphan Step 4: executeRemoveFromGame e2e", () => {
  it("合体ホスト除外 → flushPendingLeaves で pendingBraveLeaveChoice (leaveKind=remove_from_game) が立つ", () => {
    const state = setupCombinedUnit();
    const queued = executeRemoveFromGame(
      state,
      ALICE,
      { kind: "remove_from_game", target: OPP_TARGET },
      getDef,
      "alice-src",
      ["host-1"]
    );
    // executeRemoveFromGame は queuePendingLeave を経由した。pendingLeaveEntities に host が乗る。
    const pl = queued.pendingLeaveEntities.find(
      (p) => p.instanceId === "host-1"
    );
    expect(pl?.kind).toBe("remove_from_game");

    const flushed = flushPendingLeaves(queued, getDef);
    // 合体ホスト離脱はブレイヴ残存の choice を必ず立てる (kind 無差別)。
    expect(flushed.pendingBraveLeaveChoice).not.toBeNull();
    expect(flushed.pendingBraveLeaveChoice?.hostInstanceId).toBe("host-1");
    expect(flushed.pendingBraveLeaveChoice?.leaveKind).toBe("remove_from_game");
    expect(flushed.pendingBraveLeaveChoice?.braveInstanceIds).toEqual([
      "brave-1",
    ]);
    // 選択前なのでホスト/ブレイヴ共に場に残る。
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "host-1")?.zone
    ).toBe("field");
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "brave-1")?.zone
    ).toBe("field");
  });

  it("choice='keep': ホストのみ removed_from_game へ。ブレイヴは合体解除して場残留 (orphan 防止: ブレイヴはフィールドに正常に存在し、host への参照無し)", () => {
    const state = setupCombinedUnit();
    const queued = executeRemoveFromGame(
      state,
      ALICE,
      { kind: "remove_from_game", target: OPP_TARGET },
      getDef,
      "alice-src",
      ["host-1"]
    );
    const flushed = flushPendingLeaves(queued, getDef);
    const kept = resolveBraveLeaveChoice(flushed, "keep");
    const finalState = flushPendingLeaves(kept, getDef);

    expect(finalState.pendingBraveLeaveChoice).toBeNull();
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "host-1")?.zone
    ).toBe("removed_from_game");
    const brave = finalState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    expect(brave?.zone).toBe("field");
    // orphan 防止: 合体リンクは解除済みでブレイヴは独立した場の存在として残る。
    expect(brave?.attachedToInstanceId).toBeNull();
  });

  it("choice='send_with_host': ブレイヴも removed_from_game へ追従 (orphan 完全防止 + コア 3 個リザーブ復帰)", () => {
    const state = setupCombinedUnit();
    const bobReserveBefore = state.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;

    const queued = executeRemoveFromGame(
      state,
      ALICE,
      { kind: "remove_from_game", target: OPP_TARGET },
      getDef,
      "alice-src",
      ["host-1"]
    );
    const flushed = flushPendingLeaves(queued, getDef);
    const sent = resolveBraveLeaveChoice(flushed, "send_with_host");
    const finalState = flushPendingLeaves(sent, getDef);

    expect(finalState.pendingBraveLeaveChoice).toBeNull();
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "host-1")?.zone
    ).toBe("removed_from_game");
    const brave = finalState.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    expect(brave?.zone).toBe("removed_from_game");
    expect(brave?.attachedToInstanceId).toBeNull();
    // ホスト 2 + ブレイヴ 1 = 3 コアが bob リザーブへ戻る。
    const bobReserveAfter = finalState.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;
    expect(bobReserveAfter).toBe(bobReserveBefore + 3);
  });
});
