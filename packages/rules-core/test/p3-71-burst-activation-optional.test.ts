/**
 * P3-71 回帰: バースト発動は任意（ルール上「発動宣言」）。
 *
 * - 発動可能なバーストがあるとき、responder には発動 (resolve) と並んで
 *   「発動しない」(decline_pending_burst_check) が提供される。
 * - decline を適用すると当該 pendingBurstCheck は発火せず破棄され、
 *   バーストカードはセットされたまま (zone=burst / setBurstStates 不変) 残る。
 *
 * 典拠: 10_rules/04_state-based-rules.md:154,158（バースト「発動宣言」=任意）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { GameState } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);
const X07 = getCardDefinitionById("BSTH01-X07")!; // 【バースト：自分のライフ減少後】自己召喚

const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

function buildScenario(): GameState {
  const x07Burst = createCardInstance(X07, {
    instanceId: "x07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [x07Burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:p3-71-burst-activation-optional:54",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

describe("P3-71: バースト発動は任意", () => {
  it("発動可能なバーストには resolve と decline の両方が提供される", () => {
    const state = buildScenario();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    });
    expect(actions.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      true
    );
    expect(actions.some((a) => a.kind === "decline_pending_burst_check")).toBe(
      true
    );
  });

  it("decline 適用でチェックは破棄され、バーストは発火せずセットのまま残る", () => {
    const state = buildScenario();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    });
    const decline = actions.find(
      (a) => a.kind === "decline_pending_burst_check"
    )!;

    const after = applyLegalAction({
      state,
      action: decline,
      getCardDefinitionById,
      ...lookups,
    }).state;

    const x07After = after.cardInstances.find((c) => c.instanceId === "x07")!;
    // 発火していない: 召喚もトラッシュ移動もしていない。
    expect(x07After.zone).toBe("burst");
    // バーストはセットされたまま残る。
    expect(after.setBurstStates.some((s) => s.cardInstanceId === "x07")).toBe(
      true
    );
    // チェックは消費済み。
    expect(after.pendingBurstChecks).toHaveLength(0);
  });
});
