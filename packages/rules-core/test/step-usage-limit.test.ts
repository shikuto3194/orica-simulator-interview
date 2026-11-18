/**
 * Step-level usageLimit 強制 (effect-interpreter)。
 *
 * effect.usageLimit は宣言時に消費されるが、効果の途中ステップに付いた
 * step.usageLimit (`choice` 以外) は従来どこからも消費されず no-op だった。
 * BSTH04-転醒R01 の回復ステップ〔ターンに1回〕等が強制されない原因。
 *
 * ここでは合成効果 (step0 = 無制限 draw / step1 = per_instance turn 制限 draw) を
 * 同一ターンに 2 回実行し、制限ステップが 2 回目に skip されることを
 * 使用枠の台帳 (listEffectUsage) と log で確認する。
 */
import { describe, expect, it } from "vitest";
import { listEffectUsage } from "./helpers/effect-usage-fixture";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, Effect, GameState } from "../src";

const srcCard: CardDefinition = {
  cardNo: "STEP-LIMIT-SRC",
  name: "ステップ制限テスト",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defMap = new Map<string, CardDefinition>([[srcCard.cardNo, srcCard]]);

// step0: 毎回発揮 / step1: 〔ターンに1回〕(per_instance turn)
const effect: Effect = {
  timing: { kind: "activated", mode: "main" },
  steps: [
    { action: { kind: "draw", count: 1 } },
    {
      action: { kind: "draw", count: 1 },
      usageLimit: { kind: "per_instance", duration: "turn" },
    },
  ],
};

function makeState(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(srcCard, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    turnNumber: 3,
  };
}

function run(state: GameState): GameState {
  return executeEffect({
    chainId: "test:step-usage-limit:68",
    state,
    effect,
    effectIndex: 0,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) => defMap.get(id),
  });
}

describe("step.usageLimit を effect-interpreter が強制する", () => {
  it("制限ステップは同一ターン内 1 回だけ消費され、2 回目は skip される", () => {
    const stepLabel = "__step:STEP-LIMIT-SRC:0:1";

    // 1 回目: step1 が発揮 → 記録が 1 件残る
    const after1 = run(makeState());
    const recs1 = listEffectUsage(after1).filter((e) => e.label === stepLabel);
    expect(recs1).toHaveLength(1);
    expect(recs1[0]!.amount).toBe(1);
    expect(recs1[0]!.sourceInstanceId).toBe("src-1");
    expect(
      after1.log.some((l) => l.startsWith("effect:step-usage-exhausted:"))
    ).toBe(false);

    // 同一ターンに 2 回目: step1 は skip (exhausted)、記録は増えない
    const after2 = run(after1);
    const recs2 = listEffectUsage(after2).filter((e) => e.label === stepLabel);
    expect(recs2).toHaveLength(1);
    expect(recs2[0]!.amount).toBe(1);
    expect(recs2[0]!.sourceInstanceId).toBe("src-1");
    expect(
      after2.log.some((l) =>
        l.startsWith("effect:step-usage-exhausted:src-1:0:1")
      )
    ).toBe(true);
  });

  it("ターンが変われば再び発揮できる (turn duration のリセット)", () => {
    const stepLabel = "__step:STEP-LIMIT-SRC:0:1";
    const after1 = run(makeState());
    // 別ターンの state で再実行 (使用枠の台帳は引き継ぐが turnNumber が異なる)
    const nextTurn: GameState = { ...after1, turnNumber: 4 };
    const after2 = run(nextTurn);
    const recs = listEffectUsage(after2).filter((e) => e.label === stepLabel);
    // turn=3 と turn=4 の 2 件 (duration scope が turn 別)
    expect(recs).toHaveLength(2);
    expect(
      after2.log.some((l) => l.startsWith("effect:step-usage-exhausted:"))
    ).toBe(false);
  });
});
