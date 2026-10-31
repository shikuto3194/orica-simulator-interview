import { describe, it, expect } from "vitest";
import { createEmptyGameState } from "../src/factories";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type {
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
  Duration,
} from "../src/model";

// ============================================================
// P3-14 D-4: Duration の turns / next 拡張テスト
// ============================================================
//
// 「Nターンの間」「次のターンまで」のような複数ターン継続効果が
// turn_end でどのように除去されるかを検証する。

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

let nextCeSeq = 0;
function makeCe(
  duration: Duration,
  createdAtTurn: number,
  idHint?: string
): ContinuousEffect {
  nextCeSeq += 1;
  return {
    effectId: idHint ?? `ce-${nextCeSeq}`,
    sourceInstanceId: "src-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: "alice",
    duration,
    createdAtTurn,
    createdAtAttackId: null,
    modifierTag: "bp_modifier" as ContinuousEffectTag,
    modifierAmount: -1000,
  };
}

describe("removeExpiredContinuousEffects — D-4 turns / next 拡張", () => {
  it("既定 (turns 省略): 作成ターンの turn_end で消滅", () => {
    const state = makeState();
    state.turnNumber = 5;
    state.activeContinuousEffects = [makeCe({ scope: "turn" }, 5)];

    const result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(0);
  });

  it("turns=2: 作成ターンの turn_end では残り、次ターンの turn_end で消滅", () => {
    const state = makeState();
    state.activeContinuousEffects = [makeCe({ scope: "turn", turns: 2 }, 5)];

    state.turnNumber = 5;
    let result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(1);

    state.activeContinuousEffects = result;
    state.turnNumber = 6;
    result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(0);
  });

  it("turns=3: 3 回分の turn_end を生き延びる", () => {
    const state = makeState();
    state.activeContinuousEffects = [makeCe({ scope: "turn", turns: 3 }, 1)];

    for (const turn of [1, 2]) {
      state.turnNumber = turn;
      const result = removeExpiredContinuousEffects(state, {
        kind: "turn_end",
      });
      expect(result).toHaveLength(1);
      state.activeContinuousEffects = result;
    }
    state.turnNumber = 3;
    const finalResult = removeExpiredContinuousEffects(state, {
      kind: "turn_end",
    });
    expect(finalResult).toHaveLength(0);
  });

  it("next=true: 作成ターンを生き延び、次ターンの turn_end で消滅", () => {
    const state = makeState();
    state.activeContinuousEffects = [makeCe({ scope: "turn", next: true }, 5)];

    state.turnNumber = 5;
    let result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(1);

    state.activeContinuousEffects = result;
    state.turnNumber = 6;
    result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(0);
  });

  it("next=true + turns=2: 合計 3 ターン分の turn_end を生き延びる", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "turn", next: true, turns: 2 }, 1),
    ];

    for (const turn of [1, 2]) {
      state.turnNumber = turn;
      const result = removeExpiredContinuousEffects(state, {
        kind: "turn_end",
      });
      expect(result).toHaveLength(1);
      state.activeContinuousEffects = result;
    }
    state.turnNumber = 3;
    const finalResult = removeExpiredContinuousEffects(state, {
      kind: "turn_end",
    });
    expect(finalResult).toHaveLength(0);
  });

  it("scope=permanent: turns 指定があっても turn_end では消えない", () => {
    const state = makeState();
    state.turnNumber = 100;
    state.activeContinuousEffects = [makeCe({ scope: "permanent" }, 1)];

    const result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(1);
  });

  it("battle + untilTurnEnd: 次バトル未到達でも turn_end で消滅", () => {
    const state = makeState();
    state.turnNumber = 5;
    state.activeContinuousEffects = [
      makeCe({ scope: "battle", untilTurnEnd: true }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    expect(result).toHaveLength(0);
  });

  it("battle + untilTurnEnd: 登録元バトルの battle_end では消滅しない", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      {
        ...makeCe({ scope: "battle", untilTurnEnd: true }, 5),
        createdAtAttackId: "attack-1",
      },
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack-1",
    });
    expect(result).toHaveLength(1);
  });

  it("battle + untilTurnEnd: 登録元後の次バトル battle_end で消滅する", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      {
        ...makeCe({ scope: "battle", untilTurnEnd: true }, 5),
        createdAtAttackId: "attack-1",
      },
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack-2",
    });
    expect(result).toHaveLength(0);
  });

  it("複数 CE の混在: 期限切れだけが除去される", () => {
    const state = makeState();
    state.turnNumber = 6;
    state.activeContinuousEffects = [
      makeCe({ scope: "turn" }, 5, "expired-default"), // expired
      makeCe({ scope: "turn", turns: 2 }, 5, "expired-turns2"), // expired (5+2-1=6)
      makeCe({ scope: "turn", turns: 3 }, 5, "alive-turns3"), // alive (5+3-1=7)
      makeCe({ scope: "turn", next: true }, 5, "expired-next"), // expired (effective=2 → turn 6)
      makeCe({ scope: "turn", next: true, turns: 2 }, 5, "alive-next-turns2"), // alive (effective=3 → turn 7)
      makeCe({ scope: "permanent" }, 1, "alive-permanent"), // alive
    ];

    const result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
    const aliveIds = result.map((ce) => ce.effectId).sort();
    expect(aliveIds).toEqual([
      "alive-next-turns2",
      "alive-permanent",
      "alive-turns3",
    ]);
  });
});

// ============================================================
// scope="step" + whose: 「次の自分のスタートステップまで」型の絞り込み
// (BSTH02.7-C02 effects[0] で新規配線。actingPlayerId=alice の CE が、
//  bob の start step_end では消滅せず、alice 自身の start step_end でのみ消滅する)
// ============================================================
describe("removeExpiredContinuousEffects — step scope + whose フィルタ", () => {
  it("whose:'self' — 自分以外 (bob) の該当ステップ離脱では消滅しない", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "step", step: "start", whose: "self" }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "step_end",
      step: "start",
      activePlayerId: "bob",
    });
    expect(result).toHaveLength(1);
  });

  it("whose:'self' — 自分 (alice) の該当ステップ離脱で消滅する (次の自分のスタートステップまで)", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "step", step: "start", whose: "self" }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "step_end",
      step: "start",
      activePlayerId: "alice",
    });
    expect(result).toHaveLength(0);
  });

  it("whose:'self' — ステップ種別が不一致なら離脱プレイヤーに関わらず消滅しない", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "step", step: "start", whose: "self" }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "step_end",
      step: "main",
      activePlayerId: "alice",
    });
    expect(result).toHaveLength(1);
  });

  it("whose:'opponent' — 相手 (bob) の該当ステップ離脱で消滅する", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "step", step: "start", whose: "opponent" }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "step_end",
      step: "start",
      activePlayerId: "bob",
    });
    expect(result).toHaveLength(0);
  });

  it("whose 未指定 (後方互換): 離脱プレイヤーに関わらずステップ種別一致で消滅する", () => {
    const state = makeState();
    state.activeContinuousEffects = [
      makeCe({ scope: "step", step: "start" }, 5),
    ];

    const result = removeExpiredContinuousEffects(state, {
      kind: "step_end",
      step: "start",
      activePlayerId: "bob",
    });
    expect(result).toHaveLength(0);
  });
});
