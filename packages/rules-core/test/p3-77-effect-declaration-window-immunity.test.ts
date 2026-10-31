/**
 * P3-77 Step A: 節②耐性を効果発揮宣言窓(②窓)に再タイミングした検証。
 *
 * 確定裁定: 「発動している間」= 効果発揮宣言窓〜効果解決後。発動成立(=②窓 open,
 * setBurstStates から除去) からカード+コントローラに相手効果耐性を付与し、解決後に除去。
 *
 * バーストの2段階窓 (発動宣言窓→効果発揮宣言窓) は main step 経路で開く
 * (legal-actions-apply: step==="main")。本テストは main step でフローを駆動する。
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
import { isPlayerImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { GameState } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);
const X07 = getCardDefinitionById("BSTH01-X07")!;

const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

function buildMainStepScenario(): GameState {
  const x07Burst = createCardInstance(X07, {
    instanceId: "x07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "main",
    cardInstances: [x07Burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:p3-77-effect-declaration-window-immunity:53",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "main",
        window: "main_step",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

function findStackPass(state: GameState, actingPlayerId: string) {
  const actions = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...lookups,
  });
  return actions.find((a) => a.kind === "pass_stack");
}

describe("P3-77 Step A: 効果発揮宣言窓での節②耐性", () => {
  it("発動宣言窓→効果発揮宣言窓で card+player 耐性が有効、解決後に除去", () => {
    let state = buildMainStepScenario();

    // 1. バースト発動 → 発動宣言窓 (activation)
    const resolveAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_burst_check");
    expect(resolveAction).toBeDefined();
    state = applyLegalAction({
      state,
      action: resolveAction!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    expect(state.window).toBe("stack");
    expect(state.stackWindow?.burstWindowKind).toBe("activation");
    // 発動宣言窓ではまだ節②(player)耐性なし
    expect(isPlayerImmuneToOpponentEffect(state, "alice", "bob")).toBe(false);

    // 2. 発動宣言窓をパス → 効果発揮宣言窓 (effect_declaration)
    const responder = state.stackWindow!.priorityPlayerId;
    const pass1 = findStackPass(state, responder);
    expect(pass1).toBeDefined();
    state = applyLegalAction({
      state,
      action: pass1!,
      getCardDefinitionById,
      ...lookups,
    }).state;
    expect(state.stackWindow?.burstWindowKind).toBe("effect_declaration");

    // 効果発揮宣言窓で節②耐性が有効
    expect(isPlayerImmuneToOpponentEffect(state, "alice", "bob")).toBe(true);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.targetInstanceId === "x07" &&
          typeof (ce.metadata as { burstActivationWindow?: unknown })
            ?.burstActivationWindow === "string"
      )
    ).toBe(true);

    // 3. 効果発揮宣言窓をパス → 解決
    const responder2 = state.stackWindow!.priorityPlayerId;
    const pass2 = findStackPass(state, responder2);
    expect(pass2).toBeDefined();
    state = applyLegalAction({
      state,
      action: pass2!,
      getCardDefinitionById,
      ...lookups,
    }).state;

    // 解決後: 窓 CE は除去、X07 は field 召喚
    expect(isPlayerImmuneToOpponentEffect(state, "alice", "bob")).toBe(false);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          typeof (ce.metadata as { burstActivationWindow?: unknown })
            ?.burstActivationWindow === "string"
      )
    ).toBe(false);
    const x07 = state.cardInstances.find((c) => c.instanceId === "x07")!;
    expect(x07.zone).toBe("field");
  });
});
