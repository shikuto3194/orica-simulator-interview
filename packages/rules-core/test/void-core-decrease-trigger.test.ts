/**
 * void_core_decrease トリガー event の検証 (BSSL01-C02「タンク」基盤)。
 *
 * collectTriggerEventsFromStateDelta は voidNormalCoreCount の減少で void_core_decrease を
 * 発火するが、以下の 2 種は「(相手が相手の効果で)ボイドからコアを増やした」に数えない
 * (裁定 2026-08-02、ユーザー確認):
 *   - 創界神/導界者/創界石ネクサス（独立コア管理、hasIndependentCoreManagement）への
 *     コア移動。神託等は汎用コア移動ソースから既に除外されている
 *     (08d_grandwalker-nexus.md「汎用コア移動ソース除外」) が、その裏返しとして
 *     発火面（void_core_decrease イベント）でも独立管理カードへの着地分は除外する。
 *   - (契約)カウント+N。executeCountIncrease はカウント+N を
 *     「ボイドからカウントエリアへ概念的に移動」として voidNormalCoreCount を直接減算する
 *     (structured-modifiers.ts) が、これはコアを物理的にスピリット/アルティメット等へ
 *     置く操作ではない。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  collectTriggerEventsFromStateDelta,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(): CardDefinition {
  return {
    cardNo: "TEST-SPIRIT-01",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 通常の創界神（独立コア管理・汎用コア移動ソース除外の検証用） */
function grandwalkerDef(): CardDefinition {
  return {
    cardNo: "TEST-GW-01",
    name: "[創界神]テスト",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["god"],
    textLines: [],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

function getDefLookup(defs: CardDefinition[]) {
  const byId = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => byId.get(id);
}

function withVoidDecrease(
  before: GameState,
  playerId: string,
  by: number
): GameState {
  return {
    ...before,
    players: before.players.map((p) =>
      p.id === playerId
        ? { ...p, voidNormalCoreCount: p.voidNormalCoreCount - by }
        : p
    ),
  };
}

function withCoreCount(
  state: GameState,
  instanceId: string,
  normalCoreCount: number
): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === instanceId ? { ...c, normalCoreCount } : c
    ),
  };
}

describe("collectTriggerEventsFromStateDelta: void_core_decrease", () => {
  it("スピリットへの通常コア配置はボイド減少分そのまま発火する（回帰ガード）", () => {
    const spirit = createCardInstance(spiritDef(), {
      instanceId: "spirit-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [spirit],
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    const after = withVoidDecrease(
      withCoreCount(before, "spirit-1", 1),
      BOB,
      1
    );

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDefLookup([spiritDef()]),
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(1);
    expect(events[0]!.cause).toBe("self_effect");
  });

  it("創界神ネクサスへのコア移動（神託等）は発火しない", () => {
    const gw = createCardInstance(grandwalkerDef(), {
      instanceId: "gw-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [gw],
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    const after = withVoidDecrease(withCoreCount(before, "gw-1", 1), BOB, 1);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDefLookup([grandwalkerDef()]),
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(0);
  });

  it("裁定: 「自分のスピリット/創界神ネクサスにコア1個ずつまで置く」でスピリット0個・創界神1個を選んだ場合も発火しない", () => {
    const spirit = createCardInstance(spiritDef(), {
      instanceId: "spirit-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const gw = createCardInstance(grandwalkerDef(), {
      instanceId: "gw-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [spirit, gw],
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    // スピリットに0個・創界神に1個 = スピリットは変化なし、創界神のみ+1。
    const after = withVoidDecrease(withCoreCount(before, "gw-1", 1), BOB, 1);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDefLookup([spiritDef(), grandwalkerDef()]),
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(0);
  });

  it("創界神とスピリットの両方に置いた場合はスピリットへ乗った分のみ amount に計上する", () => {
    const spirit = createCardInstance(spiritDef(), {
      instanceId: "spirit-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const gw = createCardInstance(grandwalkerDef(), {
      instanceId: "gw-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [spirit, gw],
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    const afterCores = withCoreCount(
      withCoreCount(before, "spirit-1", 1),
      "gw-1",
      1
    );
    const after = withVoidDecrease(afterCores, BOB, 2);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
      getCardDefinitionById: getDefLookup([spiritDef(), grandwalkerDef()]),
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(1);
  });

  it("(契約)カウント+N によるボイド消費は発火しない", () => {
    const before = createEmptyGameState({
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    const after: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === BOB
          ? {
              ...p,
              voidNormalCoreCount: p.voidNormalCoreCount - 1,
              countValue: p.countValue + 1,
            }
          : p
      ),
    };

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(0);
  });

  it("getCardDefinitionById 未指定時は独立コア管理判定をスキップし従来どおり発火する (fail-open)", () => {
    const gw = createCardInstance(grandwalkerDef(), {
      instanceId: "gw-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [gw],
      playerOverrides: [{}, { voidNormalCoreCount: 5 }],
    });
    const after = withVoidDecrease(withCoreCount(before, "gw-1", 1), BOB, 1);

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: BOB,
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(1);
  });

  it("ALICE 視点でも同様 (プレイヤー非依存の一般化を確認)", () => {
    const gw = createCardInstance(grandwalkerDef(), {
      instanceId: "gw-alice-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [gw],
      playerOverrides: [{ voidNormalCoreCount: 5 }, {}],
    });
    const after = withVoidDecrease(
      withCoreCount(before, "gw-alice-1", 1),
      ALICE,
      1
    );

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDefLookup([grandwalkerDef()]),
    }).filter((e) => e.eventKind === "void_core_decrease");

    expect(events).toHaveLength(0);
  });
});
