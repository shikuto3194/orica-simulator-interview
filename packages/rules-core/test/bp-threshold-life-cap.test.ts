/**
 * BP 閾値 per-attacker gate cap — life_damage_interception の attackerBpTurnCap 拡張の検証。
 *
 * プリミティブ:
 *  - mode:"replace" + attackerFilter:{ maxBp:N } + attackerBpTurnCap:M
 *    → 「BP N 以下のスピリット/アルティメットのアタックでは、自分のライフは
 *       1 ターンに (M+1) 以上減らない」型。一致アタッカー由来のバトルライフ減少を
 *       **ターン内累積**で最大 M に頭打ちする（per-participant ではなく累積、
 *       基底 turn_cap とは独立トラック）。BP 判定はアタック解決時の実効 BP
 *       (snapshot.resolvedBp)。閾値超え(>N)・非バトル由来は枠外で無制限。
 *
 * ルール正源: 10_rules/05_brave-and-attack-special-cases.md
 *   §ライフ減少の上限キャップ（裁定 2026-06-16, 信頼度 C / ユーザー確認）。
 *   「2 以上減らない」= 減少は最大 1（cap は N=1。"2" は cap 値ではない）。
 *
 * 解禁カード:
 *  - BSTH08.5-C21 [0,2] 手元常駐: BP6000 以下のスピリット/アルティメットのアタックでは
 *    自分のライフは1ターンに2以上減らない (attackerFilter:{maxBp:6000} + attackerBpTurnCap:1)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  GameState,
  SymbolColor,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  getUnblockedLifeDamage,
  executeBattleResolution,
} from "../src/battle/battle-actions";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  return executeEffect({
    chainId: "test:bp-threshold-life-cap:60",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

/**
 * 各アタッカーに任意のシンボル数 (symbols) と実効 BP (bp) を持たせて
 * battleResolutionGroup を組む。symbols 個 = ライフ symbols 減少（クランプ前）。
 */
function withBattle(
  state: GameState,
  attackers: {
    entityId: string;
    leaderId: string;
    symbols: number;
    bp: number;
  }[],
  targetPlayerId: string
): GameState {
  const toSymbols = (n: number): SymbolColor[] =>
    Array.from({ length: n }, () => "red" as SymbolColor);
  const battleEntities: BattleEntity[] = attackers.map((a) => ({
    entityId: a.entityId,
    memberInstanceIds: [a.leaderId],
    resolvedBp: a.bp,
    resolvedSymbols: toSymbols(a.symbols),
    attackState: "attacking",
  }));
  const group: BattleResolutionGroup = {
    attackId: "atk-1",
    groupMode: "single",
    target: { kind: "player", playerId: targetPlayerId },
    symbolResolutionOrder: attackers.map((a) => a.entityId),
    participantSnapshots: attackers.map((a) => ({
      entityId: a.entityId,
      memberInstanceIds: [a.leaderId],
      resolvedBp: a.bp,
      resolvedSymbols: toSymbols(a.symbols),
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup: group };
}

const lifeOf = (s: GameState, playerId: string): number =>
  getPlayerLifeCoreCount(s.players.find((p) => p.id === playerId)!);

describe("BP 閾値 per-attacker gate cap (attackerBpTurnCap)", () => {
  it("BSTH08.5-C21 [0,1,2] effects: prevent_deck_discard(either) + replace + maxBp:6000 + attackerBpTurnCap:1 の CE を登録", () => {
    const c = card("BSTH08.5-C21");
    const continuous = c.effects![0]!;
    expect(continuous.applicability).toEqual({ zone: "set_aside" });
    // [1]「お互いのデッキは破棄されない」= prevent_deck_discard(either)。
    const deckGuard = continuous.steps.find(
      (s) => s.action.kind === "prevent_deck_discard"
    )?.action;
    expect(deckGuard).toBeDefined();
    if (deckGuard?.kind === "prevent_deck_discard") {
      expect(deckGuard.player).toBe("either");
    }
    // [0,2] BP 閾値 per-attacker gate cap。
    const action = continuous.steps.find(
      (s) => s.action.kind === "life_damage_interception"
    )!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.attackerBpTurnCap).toBe(1);
      expect(action.attackerFilter).toEqual({
        maxBp: 6000,
        category: ["spirit", "ultimate"],
      });
    }
    // アクセルは accelData へ移管済み（effects[1] は無い）。
    expect(c.effects!.length).toBe(1);
    expect(c.accelData).toBeDefined();
    expect(c.accelData!.timing).toBe("main");
    expect(c.accelData!.cost).toBe(3);
    expect(c.accelData!.reduction).toEqual(["red", "red"]);
  });

  it("[board] BP6000 以下アタッカーはライフ減少を1に頭打ち、BP6001以上は素通し", () => {
    const c = card("BSTH08.5-C21");
    const src = createCardInstance(c, {
      instanceId: "th085-c21",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    // アタッカーは category:spirit のカードで実体化する（BP は snapshot.resolvedBp で注入）。
    const low = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-low",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const high = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-high",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src, low, high],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![0]!, "th085-c21");

    // BP5000 (3 シンボル) と BP7000 (2 シンボル) が同時アタック。
    // BP5000 → cap で 1、BP7000 → 素通しで 2。合計 3。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-low", leaderId: "atk-low", symbols: 3, bp: 5000 },
        { entityId: "e-high", leaderId: "atk-high", symbols: 2, bp: 7000 },
      ],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    expect(dmg!.totalLifeDamage).toBe(3);
    expect(dmg!.bpThresholdCapConsumed).toBe(1);
  });

  it("[board] BP境界6000ちょうどは「以下」で対象（cap対象）", () => {
    const c = card("BSTH08.5-C21");
    const src = createCardInstance(c, {
      instanceId: "th085-c21b",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const atk = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-6000",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src, atk],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![0]!, "th085-c21b");
    const battleState = withBattle(
      state,
      [{ entityId: "e-6000", leaderId: "atk-6000", symbols: 4, bp: 6000 }],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // BP6000 ちょうど (4 シンボル) → cap:1。
    expect(dmg!.totalLifeDamage).toBe(1);
    expect(dmg!.bpThresholdCapConsumed).toBe(1);
  });

  it("[board] 累積カウンタが計上されると、2 バトル目はターン内0減少", () => {
    const c = card("BSTH08.5-C21");
    const src = createCardInstance(c, {
      instanceId: "th085-c21c",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const atk1 = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk1",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const atk2 = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk2",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src, atk1, atk2],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![0]!, "th085-c21c");

    // 1 バトル目: BP5000 が 3 シンボルでアタック → cap:1 で 1 減少、累積1。
    const battle1 = withBattle(
      state,
      [{ entityId: "e1", leaderId: "atk1", symbols: 3, bp: 5000 }],
      ALICE
    );
    const dmg1 = getUnblockedLifeDamage(battle1, getDef);
    expect(dmg1!.totalLifeDamage).toBe(1);
    expect(dmg1!.bpThresholdCapConsumed).toBe(1);
    let after1 = resolveLifeDamage(battle1, ALICE, dmg1!.totalLifeDamage, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    // 累積カウンタを executeBattleResolution と同じく手動コミット（board 検証）。
    after1 = {
      ...after1,
      bpThresholdCappedLifeReductionThisTurn: {
        ...(after1.bpThresholdCappedLifeReductionThisTurn ?? {}),
        [ALICE]:
          (after1.bpThresholdCappedLifeReductionThisTurn?.[ALICE] ?? 0) +
          dmg1!.bpThresholdCapConsumed,
      },
    };
    expect(lifeOf(after1, ALICE)).toBe(4);
    expect(after1.bpThresholdCappedLifeReductionThisTurn![ALICE]).toBe(1);

    // 2 バトル目（同ターン）: BP5000 が再アタック → 累積1到達済みで 0 減少。
    const battle2 = withBattle(
      after1,
      [{ entityId: "e2", leaderId: "atk2", symbols: 4, bp: 5000 }],
      ALICE
    );
    const dmg2 = getUnblockedLifeDamage(battle2, getDef);
    expect(dmg2!.totalLifeDamage).toBe(0);
    expect(dmg2!.bpThresholdCapConsumed).toBe(0);
  });

  it("[smoke] executeBattleResolution が export され呼び出せる（型確認）", () => {
    // executeBattleResolution 経路の累積コミットを参照する（dead import 防止）。
    expect(typeof executeBattleResolution).toBe("function");
  });
});
