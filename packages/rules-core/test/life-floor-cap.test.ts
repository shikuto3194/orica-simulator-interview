/**
 * 条件付きライフ下限保護 — life_damage_interception の cap / 攻撃者限定 floor 拡張の検証。
 *
 * プリミティブ:
 *  - mode:"replace" + cap:N → 一致アタッカーのライフ減少を最大 N にクランプ
 *    （「相手のアタックでは自分のライフは N しか減らない」, N=1 が定番）。
 *    cap 省略 (=0) は従来の完全防止。per-participant に getUnblockedLifeDamage が適用。
 *  - mode:"floor" + attackerFilter → 一致アタッカー由来のバトルライフ減少を
 *    「残ライフ ≥ floor」になるようクランプ（「効果記述を持つ相手のアタックでは
 *    ライフは1以下にならない」= floor:2）。
 *
 * ルール正源: 10_rules/05_brave-and-attack-special-cases.md L118
 * 「ブロックされなかった参加体のライフ減少を…まとめて処理」= per-participant 帰属。
 *
 * 解禁カード:
 *  - BSTH08-C01  [2] このターン自分のライフは1しか減らない (cap:1, フィルタ無し)
 *  - BSTH07-R10  [1] 効果記述を持つ相手のアタックでライフは1しか減らない (cap:1 + hasEffectText)
 *  - BSTH09-R03  [1] コスト4以上の相手のアタックでライフは1しか減らない (cap:1 + minCost:4)
 *  - BSTH05.5-R10 [2] 効果記述を持つ相手のアタックでライフは1以下にならない (floor:2 + hasEffectText)
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
import { getUnblockedLifeDamage } from "../src/battle/battle-actions";
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
    chainId: "test:life-floor-cap:58",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

/**
 * 各アタッカーに任意のシンボル数 (symbols) を持たせて battleResolutionGroup を組む。
 * symbols 個 = ライフ symbols 減少（クランプ前）。
 */
function withBattle(
  state: GameState,
  attackers: { entityId: string; leaderId: string; symbols: number }[],
  targetPlayerId: string
): GameState {
  const toSymbols = (n: number): SymbolColor[] =>
    Array.from({ length: n }, () => "red" as SymbolColor);
  const battleEntities: BattleEntity[] = attackers.map((a) => ({
    entityId: a.entityId,
    memberInstanceIds: [a.leaderId],
    resolvedBp: 5000,
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
      resolvedBp: 5000,
      resolvedSymbols: toSymbols(a.symbols),
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup: group };
}

describe("条件付きライフ下限保護 (life_damage_interception cap / 攻撃者限定 floor)", () => {
  it("BSTH08-C01 [2] effects: turn_cap:1 フィルタ無しの CE を登録", () => {
    const c = card("BSTH08-C01");
    const flash = c.effects![2]!;
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("turn_cap");
      expect(action.cap).toBe(1);
      expect(action.attackerFilter).toBeUndefined();
    }
  });

  it("[board] BSTH08-C01: ターン累積でライフ減少を合計1に頭打ち", () => {
    const c = card("BSTH08-C01");
    const magic = createCardInstance(c, {
      instanceId: "th08-c01",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![2]!, "th08-c01");

    const lifeOf = (s: GameState): number =>
      getPlayerLifeCoreCount(s.players.find((p) => p.id === ALICE)!);
    expect(lifeOf(state)).toBe(5);

    // 1 回目: 8 減らそうとしても cap:1 で 1 のみ減少 → 残ライフ 4。
    state = resolveLifeDamage(state, ALICE, 8, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(lifeOf(state)).toBe(4);

    // 2 回目（同ターン・別原因）: 累積が 1 に達しているため 0 減少 → 残ライフ 4。
    state = resolveLifeDamage(state, ALICE, 3, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    expect(lifeOf(state)).toBe(4);
  });

  it("[board] BSTH09-R03: コスト4以上のアタッカーのみ cap:1、コスト3以下は素通し", () => {
    const c = card("BSTH09-R03");
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cap).toBe(1);
      expect(action.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        minCost: 4,
      });
    }
    const src = createCardInstance(c, {
      instanceId: "th09-r03",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const high = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-high",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const low = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-low",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src, high, low],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![1]!, "th09-r03");
    // high(cost4, 3 シンボル) → cap:1 で 1、low(cost3 以下, 2 シンボル) → 2。合計 3。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-high", leaderId: "atk-high", symbols: 3 },
        { entityId: "e-low", leaderId: "atk-low", symbols: 2 },
      ],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    expect(dmg!.totalLifeDamage).toBe(3);
  });

  it("BSTH07-R10 [1] effects: cap:1 + hasEffectText の replace CE を登録", () => {
    const c = card("BSTH07-R10");
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cap).toBe(1);
      expect(action.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        hasEffectText: true,
      });
    }
  });

  it("[board] BSTH05.5-R10: 効果記述を持つアタッカーで残ライフ ≥ 2（floor:2）", () => {
    const c = card("BSTH05.5-R10");
    const flash = c.effects![2]!;
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("floor");
      expect(action.floor).toBe(2);
      expect(action.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        hasEffectText: true,
      });
    }
    const src = createCardInstance(c, {
      instanceId: "th055-r10",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 効果記述を持つ相手スピリット (BSSA01-C04 は効果記述あり) が 5 シンボルでアタック。
    const atk = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-eff",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src, atk],
      playerOverrides: [
        { lifeNormalCoreCount: 4, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = runEffect(state, c.effects![2]!, "th055-r10");
    // ライフ4に 5 シンボル → floor:2 で残ライフ 2 になるよう 2 ダメージに制限。
    const battleState = withBattle(
      state,
      [{ entityId: "e-eff", leaderId: "atk-eff", symbols: 5 }],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    expect(dmg!.totalLifeDamage).toBe(2);
  });

  it("BSFT01-TR09(B) [7,8] effects: turn_cap:2 + 魂状態ルーシィ/相手アタックステップ ゲート", () => {
    const c = card("BSFT01-TR09(B)");
    const reb = c.effects!.find(
      (e) =>
        e.steps?.[0]?.action?.kind === "life_damage_interception" &&
        e.steps[0].action.mode === "turn_cap"
    )!;
    expect(reb).toBeDefined();
    expect(reb.stub).toBeUndefined();
    const action = reb.steps[0]!.action;
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("turn_cap");
      expect(action.cap).toBe(2);
    }
    // ゲート: field_has(includeSoulState) ∧ step_phase(opponent attack)。
    expect(reb.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ルーシィ" }],
        includeSoulState: true,
      },
      { kind: "step_phase", step: "attack", whose: "opponent" },
    ]);
  });

  it("[board] turn_cap:2 はターン累積で合計2まで減少を許容", () => {
    const c = card("BSTH08-C01");
    const magic = createCardInstance(c, {
      instanceId: "th08-c01b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic],
      playerOverrides: [
        { lifeNormalCoreCount: 6, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 6, reserveNormalCoreCount: 0 },
      ],
    });
    // cap:2 の CE を直接登録（TR09(B) と同じ turn_cap モード、フィルタ無し）。
    state = runEffect(
      state,
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "turn_cap",
              cap: 2,
              duration: { scope: "turn" },
            },
          },
        ],
      },
      "th08-c01b"
    );

    const lifeOf = (s: GameState): number =>
      getPlayerLifeCoreCount(s.players.find((p) => p.id === ALICE)!);

    // 1 回目: 1 減少 → 残5、累積1。
    state = resolveLifeDamage(state, ALICE, 1, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(lifeOf(state)).toBe(5);
    // 2 回目: 5 減らそうとしても 残り許容1のみ → 残4、累積2。
    state = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(lifeOf(state)).toBe(4);
    // 3 回目: 累積2到達済み → 0 減少 → 残4。
    state = resolveLifeDamage(state, ALICE, 2, [], {
      cause: "self_effect",
      actingPlayerId: ALICE,
    });
    expect(lifeOf(state)).toBe(4);
  });
});
