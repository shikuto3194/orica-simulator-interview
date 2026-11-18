/**
 * 待機 (pending leave) flush は「原因の効果チェーンが閉じた時点」でのみ実移動する
 * (04_state-based-rules.md トラッシュ移動の遅延 / 例1)。
 *
 * 回帰の原因: flush ゲートはプレイヤー入力待ちの効果解決継続 (continuation, 例:
 * `pendingCoreSplitSelection` コア配分選択) を「チェーン未閉鎖」と見なしておらず、
 * コスト支払い消滅した待機カードを、本体効果の配分選択が未解決のまま早期にトラッシュへ
 * 移動させていた (snapshot 2026-06-19: アクセル BSTH01-R05 のコスト消滅 card-10)。
 *
 * Phase 1 修正: `hasOutstandingEffectResolutionContinuation` を flush ゲートに配線し、
 * 継続が残っている間は flush しない。継続が resume → finalize した時点で初めて flush する。
 */
import { describe, it, expect } from "vitest";
import type {
  GameState,
  PendingCoreSplitSelection,
  PendingLeaveEntity,
  PendingTriggeredEffect,
} from "../src/model";
import {
  flushPendingLeaves,
  hasOutstandingEffectResolutionContinuation,
} from "../src/state-based-actions";
import { getLegalActions } from "../src/index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition } from "../src/model";

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `Spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/**
 * コスト支払いで消滅待機 (defer=true) になったスピリット 1 体を持つ state を作る。
 * `withSplit` が true なら、本体効果のコア配分選択 (`pendingCoreSplitSelection`) を
 * 立てたまま = チェーン未閉鎖の状況にする。
 */
function makeState(withSplit: boolean): {
  state: GameState;
  defs: CardDefinition[];
} {
  const def = makeSpirit("V-VANISH");
  const chainId = "accel:4:alice:main:card-37";
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "field-V",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0, // コア 0 = 最低 Lv コスト(1) 未満 → 消滅
      }),
    ],
  });
  const vanished = base.cardInstances.map((c) =>
    c.instanceId === "field-V"
      ? {
          ...c,
          pendingLeaveKind: "vanish" as const,
          pendingLeaveCause: "cost_payment" as const,
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }
      : c
  );
  const leaveEntity: PendingLeaveEntity = {
    instanceId: "field-V",
    kind: "vanish",
    cause: "cost_payment",
    causePlayerId: null,
    chainId,
    deferZoneMoveUntilChainEnd: true,
    leaveFieldCoreDestinationOverride: null,
  };
  const split: PendingCoreSplitSelection = {
    pendingId: "cms-0",
    actingPlayerId: "alice",
    sourceInstanceId: "card-37",
    sourceDefinitionId: "BSTH01-R05",
    fromLocation: { kind: "void", player: "self" },
    totalAmount: 3,
    destinations: [
      { location: { kind: "reserve", player: "self" }, cap: 2 },
      { location: { kind: "trash", player: "self" } },
    ],
    effectTiming: { kind: "activated", mode: "main" },
  };
  const state: GameState = {
    ...base,
    cardInstances: vanished,
    pendingLeaveEntities: [leaveEntity],
    pendingCoreSplitSelection: withSplit ? split : null,
  };
  return { state, defs: [def] };
}

describe("待機 flush は効果解決継続 (continuation) の間は保留する (例1)", () => {
  it("継続検出ヘルパは pendingCoreSplitSelection を未閉鎖と判定する", () => {
    expect(
      hasOutstandingEffectResolutionContinuation(makeState(true).state)
    ).toBe(true);
    expect(
      hasOutstandingEffectResolutionContinuation(makeState(false).state)
    ).toBe(false);
  });

  it("配分選択が未解決の間は消滅待機のまま (field 残留・トラッシュ未移動)", () => {
    const { state, defs } = makeState(true);
    const after = flushPendingLeaves(state, (id) =>
      defs.find((d) => d.cardNo === id)
    );
    const v = after.cardInstances.find((c) => c.instanceId === "field-V");
    expect(v?.zone).toBe("field");
    expect(v?.pendingLeaveKind).toBe("vanish");
    expect(after.pendingLeaveEntities).toHaveLength(1);
    expect(
      after.log.some(
        (l) => l.startsWith("pending-leave-flushed:") && l.includes("field-V")
      )
    ).toBe(false);
  });

  it("継続が解消されれば flush でトラッシュへ実移動する", () => {
    const { state, defs } = makeState(false);
    const after = flushPendingLeaves(state, (id) =>
      defs.find((d) => d.cardNo === id)
    );
    const v = after.cardInstances.find((c) => c.instanceId === "field-V");
    expect(v?.zone).toBe("trash");
    expect(v?.pendingLeaveKind).toBeNull();
    expect(after.pendingLeaveEntities).toHaveLength(0);
    expect(
      after.log.some(
        (l) => l.startsWith("pending-leave-flushed:") && l.includes("field-V")
      )
    ).toBe(true);
  });
});

/**
 * Phase 3 機械ガード(1): SSOT 列挙の網羅性。
 *
 * `hasOutstandingEffectResolutionContinuation` が「プレイヤー入力待ちの効果解決継続」
 * フィールド群を漏れなく見ていることを保証する。将来 continuation フィールドが追加されて
 * このヘルパに配線し忘れると flush 早期化が再発するため、各フィールド単独で true を返すことを
 * 機械検知する (feedback_mechanical_guard_over_point_fix の SSOT 列挙)。
 */
describe("hasOutstandingEffectResolutionContinuation SSOT 列挙ガード", () => {
  const CONTINUATION_FIELDS = [
    "pendingCoreSplitSelection",
    "pendingCoreCountSelection",
    "pendingCoreSourceAllocation",
    "pendingCoreDistribution",
    "pendingMultiPlacement",
    "pendingZoneSelection",
    "pendingCoreShootSelection",
    "pendingEffectTargetSelection",
    "pendingTargetedDisclosureContinuation",
    "pendingEnterFieldPlacement",
    "pendingPayToActCoreGate",
    "pendingStackCascade",
    "pendingBraveCombineChoice",
    "pendingTenshoSummon",
    "pendingReverseRebirthSummon",
    "pendingStoneFlipCombine",
  ] as const;

  it("全 continuation が null のときは false", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    expect(hasOutstandingEffectResolutionContinuation(base)).toBe(false);
  });

  for (const field of CONTINUATION_FIELDS) {
    it(`${field} が立っていれば未閉鎖と判定する`, () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      // ヘルパは `!== null` のみ見るため、形は問わずセンチネルで足りる。
      const state = { ...base, [field]: {} } as unknown as GameState;
      expect(hasOutstandingEffectResolutionContinuation(state)).toBe(true);
    });
  }
});

/**
 * Phase 3 機械ガード(2): legal-action 優先順位の不変条件。
 *
 * Phase 2 の検証で「premature finalize の誘発/神託早期収集は無害」と結論できる前提は、
 * 「continuation が立っている間は legal-actions が継続解決アクションのみを返し、
 * 早期収集された誘発効果 (pendingTriggeredEffects) は解決できない」という順序不変条件
 * (legal-actions.ts: continuation gate を triggered-effect gate より前で early-return) に
 * 依存している。新 continuation を triggered-effect gate より後ろに追加するとこの前提が崩れ、
 * 誘発が継続より先に解決されうる。それを機械検知する。
 */
describe("継続中は legal-action が継続解決のみを返す (誘発の早期解決を防ぐ順序不変条件)", () => {
  function triggeredEffect(): PendingTriggeredEffect {
    return {
      pendingId: "pte-0",
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "accel:4:alice:main:card-37",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
      selectedByTurnPlayer: true,
    };
  }

  it("CoreSplit 継続 + 早期収集済み誘発がある場合、継続解決のみが legal で誘発解決は出ない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const split: PendingCoreSplitSelection = {
      pendingId: "cms-0",
      actingPlayerId: "alice",
      sourceInstanceId: "card-37",
      sourceDefinitionId: "BSTH01-R05",
      fromLocation: { kind: "void" },
      totalAmount: 2,
      destinations: [
        { location: { kind: "reserve", playerId: "alice" } },
        { location: { kind: "trash", playerId: "alice" } },
      ],
      effectTiming: { kind: "phase", step: "main" },
    };
    const state: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
      pendingCoreSplitSelection: split,
      pendingTriggeredEffects: [triggeredEffect()],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_core_split")).toBe(
      true
    );
    expect(
      actions.some((a) => a.kind === "resolve_pending_triggered_effect")
    ).toBe(false);
  });
});
