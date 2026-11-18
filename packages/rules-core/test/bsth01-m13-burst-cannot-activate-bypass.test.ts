/**
 * BSTH01-M13「大妖精」バースト: 相手の「バースト効果を発揮できない」効果を無視して発揮できる。
 *
 * 裁定 (P3-77, 2026-06-01 ユーザー確認):
 *   - セット中の「一切の効果を受けない」(節①) は zone 束縛で、発揮(解決)時点には及ばない。
 *   - 「発揮できない」(cannot_activate) のみ能動バイパス → バースト効果は発揮される。
 *   - 「無効にする」(nullify) は受ける → バースト効果は発揮されない。
 *
 * カードデータの Effect.ignoresOpponentCannotActivateBurst フラグが
 * useResolvePendingBurstCheckAsAction → isBurstEffectNullifiedByOpponent まで
 * 正しく伝搬することを end-to-end で検証する。
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
import type { ContinuousEffect, GameState } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);
const M13 = getCardDefinitionById("BSTH01-M13")!;

const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

/** bob (相手) が alice のバースト効果に課す抑制 CE。 */
function bobBurstSuppressorCE(
  kind: "nullify" | "cannot_activate"
): ContinuousEffect {
  return {
    effectId: `sup-${kind}`,
    sourceInstanceId: "bob-src",
    sourceDefinitionId: "TEST-SUPPRESSOR",
    actingPlayerId: "bob",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "negate_opponent_burst",
    metadata: { burstSuppressKind: kind },
  };
}

function baseScenario(ces: ContinuousEffect[]): GameState {
  const burst = createCardInstance(M13, {
    instanceId: "m13",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "m13" }],
    activeContinuousEffects: ces,
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:bsth01-m13-burst-cannot-activate-bypass:73",
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

function resolveBurst(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_burst_check");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...lookups,
  }).state;
}

function passBurstStackWindow(state: GameState): GameState {
  expect(state.window).toBe("stack");
  expect(state.stackWindow?.burstWindowKind).toBeDefined();
  const action = getLegalActions({
    state,
    actingPlayerId: state.stackWindow!.priorityPlayerId,
    getCardDefinitionById,
    ...lookups,
  }).find((a) => a.kind === "pass_stack");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...lookups,
  }).state;
}

function resolveBurstThroughWindows(state: GameState): GameState {
  const afterDeclaration = resolveBurst(state);
  expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");
  const afterActivationPass = passBurstStackWindow(afterDeclaration);
  expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
    "effect_declaration"
  );
  return passBurstStackWindow(afterActivationPass);
}

describe("BSTH01-M13 バースト: 発揮できない無視 / 無効は受ける", () => {
  it("相手の『発揮できない』を無視して発揮し field 召喚される", () => {
    const after = resolveBurstThroughWindows(
      baseScenario([bobBurstSuppressorCE("cannot_activate")])
    );
    const m13 = after.cardInstances.find((c) => c.instanceId === "m13")!;
    expect(m13.zone).toBe("field");
    expect(after.log.some((l) => l.includes("burst:effect-suppressed"))).toBe(
      false
    );
  });

  it("相手の『無効にする』は受け、効果不発で field 召喚されない", () => {
    const after = resolveBurstThroughWindows(
      baseScenario([bobBurstSuppressorCE("nullify")])
    );
    const m13 = after.cardInstances.find((c) => c.instanceId === "m13")!;
    expect(m13.zone).not.toBe("field");
    expect(after.log.some((l) => l.includes("burst:effect-suppressed"))).toBe(
      true
    );
  });

  it("抑制なしでは通常どおり発揮し field 召喚される", () => {
    const after = resolveBurstThroughWindows(baseScenario([]));
    const m13 = after.cardInstances.find((c) => c.instanceId === "m13")!;
    expect(m13.zone).toBe("field");
  });
});
