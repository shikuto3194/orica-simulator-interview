/**
 * P3-84 統合テスト: 複合シナリオの待機状態 flush 順序を end-to-end で検証する。
 *
 * A召喚 → コスト支払いで B消滅(維持コア) → B消滅待機
 * → A召喚時「相手のスピリット1体を破壊する。この効果発揮後、自分はデッキの上から1枚ドローする。」
 * → C破壊 → C破壊待機 → 破壊派生 → C実移動
 * → 自分ドロー(この効果発揮後) → 召喚時チェーン全解決後 → B実移動
 *
 * ルール: 04_state-based-rules.md 例1(コスト消滅=チェーン全体で最後に移動)/
 *         例2(効果離脱=自分のサブチェーンで「この効果発揮後」より前に移動)。
 *
 * 最終状態(B・C とも trash、ドロー成立)は正しい。さらに P3-85 修正により deferred 解決経路
 * (resolve_pending_triggered_effect の多段スタック窓)でも中間の flush 順序が
 * ルールどおり C移動 < ドロー < B移動 になる (flush gate を ownerChainId の子孫包含判定に再設計)。
 * 詳細: issues/archive/P3-85/index.md。
 */
import { describe, it, expect } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  playSummonAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeSpirit(
  cardNo: string,
  effects: CardDefinition["effects"] = undefined,
  cost = 1
): CardDefinition {
  const base: CardDefinition = {
    cardNo,
    name: `Spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  return effects !== undefined ? { ...base, effects } : base;
}

function lookups(defs: CardDefinition[]) {
  return {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  };
}

/** 静止するまで legal-action を回す (resolve / target 選択 / pass / burst を順次適用)。 */
function driveToQuiescence(
  state: GameState,
  defs: CardDefinition[]
): GameState {
  const { getCardDefinitionById, getRegisteredTriggeredEffectActions } =
    lookups(defs);
  const stubs = {
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  } as const;
  let cur = state;
  for (let i = 0; i < 80; i++) {
    let progressed = false;
    for (const pid of ["alice", "bob"]) {
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: pid,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...stubs,
      });
      const act =
        actions.find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            !("choiceIndex" in a && a.choiceIndex !== undefined)
        ) ??
        actions.find((a) => a.kind === "resolve_pending_effect_target") ??
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find((a) => a.kind === "pass_stack") ??
        actions.find((a) => a.kind === "resolve_pending_burst_check") ??
        actions.find((a) => a.kind === "decline_pending_burst_check");
      if (!act) continue;
      cur = applyLegalAction({
        state: cur,
        action: act,
        ...(act.kind === "resolve_pending_effect_target"
          ? { targetInstanceIds: ["field-C"] }
          : {}),
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        ...stubs,
        getRegisteredBattleImmediateEffectActions: () => [],
      }).state;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return cur;
}

function setup() {
  const defA = makeSpirit(
    "A-SUMMON",
    [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
          { connector: "after_triggers", action: { kind: "draw", count: 1 } },
        ],
      },
    ],
    1
  );
  const defB = makeSpirit("B-FIELD");
  const defC = makeSpirit("C-TARGET");
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(defA, {
        instanceId: "hand-A",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(defB, {
        instanceId: "field-B",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(defC, {
        instanceId: "field-C",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3, deckCount: 5 }],
  });
  const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
  const defs = [defA, defB, defC];
  const lk = lookups(defs);
  const summoned = playSummonAsAction({
    state,
    actingPlayerId: "alice",
    cardInstanceId: "hand-A",
    paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: lk.getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lk.getRegisteredTriggeredEffectActions,
  }).state;
  return { summoned, defs };
}

describe("P3-84 統合: 維持コア消滅 × 召喚時破壊 × この効果発揮後ドロー", () => {
  it("召喚直後: B はコスト支払い消滅待機のまま場に残り、召喚時誘発が pending (例1)", () => {
    const { summoned } = setup();
    const B = summoned.cardInstances.find((c) => c.instanceId === "field-B");
    expect(B?.zone).toBe("field");
    expect(B?.pendingLeaveCause).toBe("cost_payment");
    expect(B?.deferZoneMoveUntilChainEnd).toBe(true);
    expect(
      summoned.pendingTriggeredEffects.some((p) => p.eventKind === "summon")
    ).toBe(true);
  });

  it("最終状態: B・C とも trash へ移動し、自分はドローする", () => {
    const { summoned, defs } = setup();
    const final = driveToQuiescence(summoned, defs);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-A")?.zone
    ).toBe("field");
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-C")?.zone
    ).toBe("trash");
    expect(final.log.some((l) => l.includes("effect:draw:alice:1"))).toBe(true);
  });

  // P3-85 修正済: deferred 解決経路でもネスト鎖の親子を追跡し、C は自分のサブチェーン境界
  // (after_triggers) で「この効果発揮後」より前に移動、B は召喚チェーン全体 (子孫含む) 閉鎖後に移動。
  it("flush 順序 C移動 < ドロー < B移動 (例1/例2) — deferred 経路でもルール順序", () => {
    const { summoned, defs } = setup();
    const final = driveToQuiescence(summoned, defs);
    const idx = (pred: (l: string) => boolean) => final.log.findIndex(pred);
    const cFlush = idx(
      (l) => l.startsWith("pending-leave-flushed:") && l.includes("field-C")
    );
    const draw = idx((l) => l.includes("effect:draw:alice:1"));
    const bFlush = idx(
      (l) => l.startsWith("pending-leave-flushed:") && l.includes("field-B")
    );
    expect(cFlush).toBeLessThan(draw);
    expect(draw).toBeLessThan(bFlush);
  });
});
