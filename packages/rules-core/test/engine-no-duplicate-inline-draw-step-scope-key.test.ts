/**
 * ENGINE-no-duplicate-inline-dispatch-scope-key の回帰テスト。
 *
 * turn-system.ts の inline draw-step dispatch (queue を経由しない同期呼び出しの使用可否判定と
 * 使用記録) は triggerEventScopeKey が未配線だったため、`usageLimit.kind:"no_duplicate"` を
 * inline draw-step 効果に使うと「triggerEventScopeKey 両側 undefined = legacy 経路として
 * 全 record 照合」分岐に落ちていた。no_duplicate の照合ロジック自体は duration を見ない
 * (10_rules/03c 裁定 2026-06-24) ため、scope key 自体で「別イベント」を識別できる必要がある。
 *
 * 本テストは turn-system.ts の buildDrawStepTriggerEventScopeKey (`draw-step:${turnNumber}:${player}:${stepSequence}`)
 * 配線後、以下を実 pipeline (advanceStep) で検証する (使用枠は effectAccounting の event 期間で保持される):
 * - 別 turnNumber (= 別 draw-step event) の使用は、scope key が異なるため今ターンの
 *   ドローステップをブロックしない (fix 前は両側 undefined で全 record 照合に落ち、ブロックされていた)。
 * - 同ターン (同 draw-step scope key) の使用はブロックする（同一トリガー内の重複防止は維持）。
 */
import { describe, expect, it } from "vitest";
import {
  effectUsageEntryCount,
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";
import {
  advanceStep,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";

const TEST_NODUP_DRAW: CardDefinition = {
  cardNo: "TEST-ENGINE-NODUP-DRAW",
  name: "テスト重複不可インラインドロー",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["red"],
  tribe: "テスト",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      // 2 ステップ構成: [0] draw_modify (プレ集計され drawAmount に加算), [1] 追加ステップ
      // (post-execute ループで実行)。usageLimit の record は post-execute 実行対象の
      // エントリ (firstNonDrawModifyStepIndex < steps.length) にのみ記録される
      // (turn-system.ts executeDrawStepDraw)。純粋な draw_modify のみの効果は usageLimit
      // チェックだけ行われ record されない既存挙動のため、本テストは記録経路を踏むために
      // 無害な count_increase を [1] に置く。
      timing: { kind: "phase", step: "draw" },
      inline: true,
      usageLimit: { kind: "no_duplicate" },
      steps: [
        {
          action: {
            kind: "draw_modify",
            amount: 1,
            duration: { scope: "step", step: "draw" },
          },
        },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  ],
} as CardDefinition;

const cardDefsById = new Map<string, CardDefinition>([
  [TEST_NODUP_DRAW.cardNo, TEST_NODUP_DRAW],
]);
const getCardDefinitionById = (id: string) => cardDefsById.get(id);
const lookup = buildTriggeredEffectLookup([TEST_NODUP_DRAW]);

function buildState(options: { turnNumber: number }): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, "bob"] });
  const source = createCardInstance(TEST_NODUP_DRAW, {
    instanceId: "nodup-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const deckCards = Array.from({ length: 10 }, (_, i) =>
    createCardInstance(TEST_NODUP_DRAW, {
      instanceId: `deck-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  return {
    ...base,
    activePlayerId: ALICE,
    turnNumber: options.turnNumber,
    step: "core",
    cardInstances: [source, ...deckCards],
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, deckCount: deckCards.length, handCount: 0 } : p
    ),
  };
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

/** 台帳に残る event 期間の識別子 (例: `event:draw-step:2:alice:1`)。 */
function eventPeriodIds(state: GameState): string[] {
  return listEffectUsage(state)
    .filter((entry) => entry.period === "event")
    .map((entry) => entry.periodId);
}

describe("ENGINE-no-duplicate-inline-dispatch-scope-key: inline draw-step no_duplicate は per-event scope でリセットされる", () => {
  it("別 turnNumber の record (duration:'game' で自動 prune されない) があっても、scope key が異なるため今ターンで発火する (旧 regression: 永久ブロックされていた)", () => {
    // 前ターンの別 draw-step event で使用済みにした状態から今ターンへ進める。
    // scope key の差異だけで今ターンの発火がブロックされないことを検証する
    // (fix 前は triggerEventScopeKey 未配線で両側 undefined = 全 record 照合に落ち、
    // この使用 1 件だけでずっとブロックされ続けていた)。
    const state: GameState = {
      ...seedEffectUsage(buildState({ turnNumber: 1 }), {
        sourceInstanceId: "nodup-1",
        effectLabel: "effect:0",
        usageLimit: { kind: "no_duplicate" },
        triggerEventScopeKey: "draw-step:1:alice",
        getCardDefinitionById,
      }),
      turnNumber: 2,
    };
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    // usageLimit で 1 枚 (inline draw_modify amount:1) + システムドロー 1 枚 = 2 枚。
    expect(alice(after).handCount).toBe(2);
    expect(alice(after).deckCount).toBe(8);
    // 新規発火分は今ターンの draw-step event の枠として記録される。
    expect(eventPeriodIds(after)).toContain("event:draw-step:2:alice:1");
  });

  it("同じドローステップのrecordがあれば重複発揮をブロックする", () => {
    const state = seedEffectUsage(buildState({ turnNumber: 2 }), {
      sourceInstanceId: "nodup-1",
      effectLabel: "effect:0",
      usageLimit: { kind: "no_duplicate" },
      triggerEventScopeKey: "draw-step:2:alice:1",
      getCardDefinitionById,
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    // inline 加算はブロックされ、システムドロー 1 枚のみ。
    expect(alice(after).handCount).toBe(1);
    expect(alice(after).deckCount).toBe(9);
    // ブロックされたため新規の使用は記録されず、事前の1件のままである。
    expect(effectUsageEntryCount(after)).toBe(1);
    expect(eventPeriodIds(after)).toEqual(["event:draw-step:2:alice:1"]);
  });

  it("record が無ければ通常どおり発火する (ベースライン)", () => {
    const state = buildState({ turnNumber: 2 });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(alice(after).handCount).toBe(2);
    expect(effectUsageEntryCount(after)).toBe(1);
    expect(eventPeriodIds(after)).toEqual(["event:draw-step:2:alice:1"]);
  });
});
