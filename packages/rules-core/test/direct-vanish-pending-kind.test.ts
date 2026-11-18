/**
 * 直接「消滅させる」効果 (executeVanish) の pendingLeaveKind が `"vanish"` であり、
 * `"destroy"` ではないことを検証する回帰テスト。
 *
 * 裁定 (10_rules/04 §離脱理由と移動先): 破壊 / 消滅 / バウンスは別 pendingLeaveKind。
 * 旧バグ: executeVanish が pendingLeave を kind:"destroy" で queue していたため、
 *   - 「消滅したとき」(eventKind="vanish") トリガーが発火しない
 *   - 「破壊されたとき」(eventKind="destroy") トリガーが誤発火する
 *   - CE replace_field_exit の trigger:"vanish" マッチが効かない
 * いずれもルール違反。コア除去経由のコア不足消滅 (state-based) は
 * 正しく kind:"vanish" を使用していたが、直接消滅プリミティブだけが
 * kind:"destroy" で書かれていた。
 */
import { describe, it, expect } from "vitest";
import {
  collectTriggerEventsFromStateDelta,
  createCardInstance,
  createEmptyGameState,
  executeVanish,
} from "../src";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

function setupOpponentSpirit(): { state: GameState; instanceId: string } {
  const def = spiritDef("DIRECT-VANISH-TARGET");
  const card = createCardInstance(def, {
    instanceId: "target-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return {
    state: { ...base, cardInstances: [card] },
    instanceId: "target-1",
  };
}

describe("executeVanish: pendingLeaveKind は 'vanish' を使う", () => {
  it("直接「消滅させる」効果で対象は pendingLeaveKind='vanish' になる (kind:'destroy' でない)", () => {
    const { state, instanceId } = setupOpponentSpirit();
    const after = executeVanish(
      state,
      ALICE,
      { selfCard: false, player: "opponent", count: -1 },
      () => spiritDef("DIRECT-VANISH-TARGET"),
      "alice-src"
    );
    const card = after.cardInstances.find((c) => c.instanceId === instanceId);
    expect(card?.pendingLeaveKind).toBe("vanish");
  });

  it("pendingLeaveEntities にも kind:'vanish' で積まれる", () => {
    const { state, instanceId } = setupOpponentSpirit();
    const after = executeVanish(
      state,
      ALICE,
      { selfCard: false, player: "opponent", count: -1 },
      () => spiritDef("DIRECT-VANISH-TARGET"),
      "alice-src"
    );
    const pl = after.pendingLeaveEntities.find(
      (p) => p.instanceId === instanceId
    );
    expect(pl).toBeDefined();
    expect(pl?.kind).toBe("vanish");
    // cause は effect_resolution (直接効果由来)、causePlayerId は効果コントローラー。
    expect(pl?.cause).toBe("effect_resolution");
    expect(pl?.causePlayerId).toBe(ALICE);
  });

  it("trigger emit: eventKind は 'vanish' であって 'destroy' ではない", () => {
    const { state } = setupOpponentSpirit();
    const after = executeVanish(
      state,
      ALICE,
      { selfCard: false, player: "opponent", count: -1 },
      () => spiritDef("DIRECT-VANISH-TARGET"),
      "alice-src"
    );
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state,
      afterState: after,
      source: "action_resolution",
    });
    const leaveEvents = events.filter(
      (e) =>
        e.eventKind === "destroy" ||
        e.eventKind === "vanish" ||
        e.eventKind === "bounce"
    );
    expect(leaveEvents).toHaveLength(1);
    expect(leaveEvents[0]!.eventKind).toBe("vanish");
    expect(leaveEvents[0]!.eventKind).not.toBe("destroy");
  });

  it("対象のコアはリザーブへ戻る (消滅セマンティクス維持)", () => {
    const { state } = setupOpponentSpirit();
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const bobReserveBefore = bobBefore.reserveNormalCoreCount;
    const after = executeVanish(
      state,
      ALICE,
      { selfCard: false, player: "opponent", count: -1 },
      () => spiritDef("DIRECT-VANISH-TARGET"),
      "alice-src"
    );
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    expect(bobAfter.reserveNormalCoreCount).toBe(bobReserveBefore + 1);
  });
});
