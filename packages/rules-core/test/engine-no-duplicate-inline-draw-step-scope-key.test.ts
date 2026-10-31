/**
 * ENGINE-no-duplicate-inline-dispatch-scope-key の回帰テスト。
 *
 * turn-system.ts の inline draw-step dispatch (queue を経由しない同期呼び出し、L114-130 の
 * canUseEffectByUsageLimit と L315/430 の recordEffectUsageIfLimited) は
 * triggerEventScopeKey が未配線だったため、`usageLimit.kind:"no_duplicate"` を inline draw-step
 * 効果に使うと legal-actions-shared.ts の「triggerEventScopeKey 両側 undefined = legacy 経路として
 * 全 record 照合」分岐に落ちる。no_duplicate の照合ロジック自体は record.duration を見ない
 * (10_rules/03c 裁定 2026-06-24) ため、通常の duration:"turn" ベースの自動 prune
 * (clearExpiredEffectUsageRecords) に頼らず、scope key 自体で「別イベント」を識別できる必要がある。
 *
 * 本テストは turn-system.ts の buildDrawStepTriggerEventScopeKey (`draw-step:${turnNumber}:${player}:${stepSequence}`)
 * 配線後、以下を実 pipeline (advanceStep) で検証する:
 * - 別 turnNumber (= 別 draw-step event) の record は、たとえ duration:"game" で自動 prune
 *   されない場合でも、scope key が異なるため今ターンのドローステップをブロックしない
 *   (fix 前は両側 undefined で全 record 照合に落ち、ブロックされていた)。
 * - 同ターン (同 draw-step scope key) の record はブロックする（同一トリガー内の重複防止は維持）。
 */
import { describe, expect, it } from "vitest";
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

function buildState(options: {
  turnNumber: number;
  effectUsageRecords?: GameState["effectUsageRecords"];
}): GameState {
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
    ...(options.effectUsageRecords
      ? { effectUsageRecords: options.effectUsageRecords }
      : {}),
  };
}

const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("ENGINE-no-duplicate-inline-dispatch-scope-key: inline draw-step no_duplicate は per-event scope でリセットされる", () => {
  it("別 turnNumber の record (duration:'game' で自動 prune されない) があっても、scope key が異なるため今ターンで発火する (旧 regression: 永久ブロックされていた)", () => {
    const state = buildState({
      turnNumber: 2,
      effectUsageRecords: [
        {
          sourceInstanceId: "nodup-1",
          sourceDefinitionId: TEST_NODUP_DRAW.cardNo,
          effectLabel: "effect:0",
          turnNumber: 1,
          step: "draw",
          // duration:"game" は isRecordInDurationScope で常に true → clearExpiredEffectUsageRecords
          // による自動 prune が効かない。scope key の差異だけで正しくブロックされないことを検証する
          // (fix 前は triggerEventScopeKey 未配線で両側 undefined = 全 record 照合に落ち、
          // この record 1 件だけでずっとブロックされ続けていた)。
          duration: "game",
          count: 1,
          triggerEventScopeKey: "draw-step:1:alice",
        },
      ],
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    // usageLimit で 1 枚 (inline draw_modify amount:1) + システムドロー 1 枚 = 2 枚。
    expect(alice(after).handCount).toBe(2);
    expect(alice(after).deckCount).toBe(8);
    const recorded = after.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === TEST_NODUP_DRAW.cardNo
    );
    // 旧 record (duration:"game", turnNumber:1) は prune されずそのまま残り、
    // 新規発火分 (turnNumber:2) が別レコードとして追加される。
    expect(recorded).toHaveLength(2);
    const newRecord = recorded.find((r) => r.turnNumber === 2)!;
    expect(newRecord.triggerEventScopeKey).toBe("draw-step:2:alice:1");
  });

  it("同じドローステップのrecordがあれば重複発揮をブロックする", () => {
    const state = buildState({
      turnNumber: 2,
      effectUsageRecords: [
        {
          sourceInstanceId: "nodup-1",
          sourceDefinitionId: TEST_NODUP_DRAW.cardNo,
          effectLabel: "effect:0",
          turnNumber: 2,
          step: "draw",
          duration: "turn",
          count: 1,
          triggerEventScopeKey: "draw-step:2:alice:1",
        },
      ],
    });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(after.step).toBe("draw");
    // inline 加算はブロックされ、システムドロー 1 枚のみ。
    expect(alice(after).handCount).toBe(1);
    expect(alice(after).deckCount).toBe(9);
    const recorded = after.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === TEST_NODUP_DRAW.cardNo
    );
    expect(recorded).toHaveLength(1);
  });

  it("record が無ければ通常どおり発火する (ベースライン)", () => {
    const state = buildState({ turnNumber: 2 });
    const after = advanceStep(state, getCardDefinitionById, lookup);
    expect(alice(after).handCount).toBe(2);
    const recorded = after.effectUsageRecords.filter(
      (r) => r.sourceDefinitionId === TEST_NODUP_DRAW.cardNo
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.triggerEventScopeKey).toBe("draw-step:2:alice:1");
  });
});
