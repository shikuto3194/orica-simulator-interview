/**
 * vanish の「この効果でブレイヴはフィールドに残せない」(VanishAction.braveCannotRemain)。
 *
 * 裁定 (10_rules/05_brave-and-attack-special-cases.md L65-68): 合体スピリットが
 * フィールドを離れるとき、ブレイヴの扱いは 2 択 — (1) フィールドに残す /
 * (2) 残さず合体先と同じ場所へ移動。「この効果でブレイヴはフィールドに残せない」は
 * 選択肢 (1) を禁じ、(2) を強制する (BSTS01-R03『暴食之王』)。
 *
 * 実装: executeVanish(braveCannotRemain) → pendingLeave.forceBraveSendWithHost →
 *   flushPendingLeaves がブレイヴをホストと同じ場所 (トラッシュ) へ送り、コアはリザーブへ。
 *   通常 (フラグ無し) は checkBraveLeaveChoice が残存の選択待ち (pendingBraveLeaveChoice)
 *   を立て、ブレイヴはフィールドに残り得る。
 */
import { describe, it, expect } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeVanish,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, EffectTarget, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function hostSpiritDef(): CardDefinition {
  return {
    cardNo: "BRAVE-HOST",
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
    cardNo: "BRAVE-CARD",
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
  ["BRAVE-HOST", hostSpiritDef()],
  ["BRAVE-CARD", braveDef()],
]);
const getDef = (id: string) => defMap.get(id);

/** bob の合体ユニット (host + 合体中ブレイヴ) を場に置く。 */
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

const targetHost: EffectTarget = {
  selfCard: false,
  player: "opponent",
  count: 1,
};

describe("vanish braveCannotRemain: ブレイヴはフィールドに残せない", () => {
  it("ホスト消滅時、ブレイヴもトラッシュへ送られ、コアはリザーブへ", () => {
    const state = setupCombinedUnit();
    const bobReserveBefore = state.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;

    const afterVanish = executeVanish(
      state,
      ALICE,
      targetHost,
      getDef,
      "alice-src",
      ["host-1"],
      undefined,
      undefined,
      true
    );
    // forceBraveSendWithHost が pendingLeave に乗る。
    const pl = afterVanish.pendingLeaveEntities.find(
      (p) => p.instanceId === "host-1"
    );
    expect(pl?.forceBraveSendWithHost).toBe(true);

    const flushed = flushPendingLeaves(afterVanish, getDef);

    const host = flushed.cardInstances.find((c) => c.instanceId === "host-1");
    const brave = flushed.cardInstances.find((c) => c.instanceId === "brave-1");
    // ホスト・ブレイヴとも場を離れトラッシュへ。
    expect(host?.zone).toBe("trash");
    expect(brave?.zone).toBe("trash");
    // 残存の選択待ちは立たない。
    expect(flushed.pendingBraveLeaveChoice).toBeNull();
    // 合体リンクは解除済み。
    expect(brave?.attachedToInstanceId).toBeNull();
    expect(host?.attachedChildrenIds).toEqual([]);
    // ホスト 2 + ブレイヴ 1 = コア 3 個が bob リザーブへ。
    const bobReserveAfter = flushed.players.find(
      (p) => p.id === BOB
    )!.reserveNormalCoreCount;
    expect(bobReserveAfter).toBe(bobReserveBefore + 3);
  });

  it("フラグ無しの通常消滅では残存の選択待ちが立ち、ブレイヴは即トラッシュにならない", () => {
    const state = setupCombinedUnit();
    const afterVanish = executeVanish(
      state,
      ALICE,
      targetHost,
      getDef,
      "alice-src",
      ["host-1"]
      // braveCannotRemain 未指定
    );
    const pl = afterVanish.pendingLeaveEntities.find(
      (p) => p.instanceId === "host-1"
    );
    expect(pl?.forceBraveSendWithHost).toBeUndefined();

    const flushed = flushPendingLeaves(afterVanish, getDef);
    // 合体ホストの離脱はブレイヴ残存の選択待ちを立てる。
    expect(flushed.pendingBraveLeaveChoice).not.toBeNull();
    expect(flushed.pendingBraveLeaveChoice?.hostInstanceId).toBe("host-1");
    // 選択前なのでブレイヴはまだ場に残る。
    const brave = flushed.cardInstances.find((c) => c.instanceId === "brave-1");
    expect(brave?.zone).toBe("field");
  });
});
