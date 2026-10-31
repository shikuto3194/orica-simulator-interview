/**
 * BSTH02.7-M01「博愛のオルレアン人形」effects[2] の検証。
 *
 * 原文 (Lv1-Lv2-Lv3): 「本来のコストを含むコストが5～8の系統：「導魔」/「動玩」を持つ
 * 自分の黄のスピリットは相手の効果で破壊/消滅したとき、同じ状態でフィールドに残せる。」
 *
 * grant_effect (P3-99) で対象群 (自分の黄・導魔/動玩・本来コスト5-8のスピリット) へ
 * card_event(destroy/vanish, cause:opponent_effect) + stay_on_field(optional) を付与する。
 * SSOT: BSFT01-C04 effects[1] / BSFT01-TR05(A) effects[1] と同型 (memory
 * project_grant_effect_duration_taxonomy)。costBasis:"printed" で「本来のコストを含む」=
 * 軽減後ではなく印字コストを判定する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  queuePendingLeave,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth02-7-m01-stay-on-field-grant:44",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function grantedEffectPendings(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (pending) => pending.mechanic?.kind === "granted_effect"
  );
}

function resolveGrantedEffectPending(
  state: GameState,
  pendingId: string
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      candidate.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();
  let current = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    skipOptionalEffect: false,
  }).state;

  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const actingPlayerId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass, `pass_stack for ${actingPlayerId}`).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
    }).state;
  }

  return current;
}

describe("BSTH02.7-M01 effects[2]: grant_effect(stay_on_field) 本来コスト5-8 導魔/動玩 黄スピリット", () => {
  const m01 = card("BSTH02.7-M01");
  const grantEffect = m01.effects![2]!;

  it("DSL 構造: filter(spirit/yellow/導魔・動玩/cost5-8/printed) + grantedEffect(destroy/vanish, opponent_effect, stay_on_field optional)", () => {
    expect(grantEffect.timing).toEqual({ kind: "continuous" });
    expect(grantEffect.stub).toBeUndefined();
    expect(grantEffect.textRef).toEqual([5, 6]);

    const action = grantEffect.steps[0]!.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind !== "grant_effect") return;
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      count: "all",
      filter: {
        category: ["spirit"],
        colors: ["yellow"],
        tribes: ["導魔", "動玩"],
        minCost: 5,
        maxCost: 8,
        exclude: {
          filterOr: [
            { maxCost: 4, costBasis: "printed" },
            { minCost: 9, costBasis: "printed" },
          ],
        },
      },
    });
    expect(action.duration).toEqual({ scope: "while_on_field" });
    expect(action.grantedEffect.timing).toEqual({
      kind: "card_event",
      event: ["destroy", "vanish"],
      cause: ["opponent_effect"],
    });
    expect(action.grantedEffect.executionMode).toBe("optional");
    expect(action.grantedEffect.steps[0]!.action).toEqual({
      kind: "stay_on_field",
      target: { kind: "self" },
    });
  });

  it("[board] 相手起因の破壊で同じ状態のまま残せる(execute)", () => {
    const source = createCardInstance(m01, {
      instanceId: "m01-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH02.7-M01 自身も cost7/黄/動玩なので自身の filter に合致する。
    const ally = createCardInstance(m01, {
      instanceId: "m01-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [source, ally] }),
      grantEffect,
      "m01-source"
    );
    expect(
      granted.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "m01-ally"
      )
    ).toBe(true);

    const chainId = "m01-opponent-destroy";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "m01-ally",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "m01-ally",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId,
        },
      ],
      getDef
    );
    const pending = grantedEffectPendings(queued)[0]!;
    expect(pending.relatedInstanceId).toBe("m01-ally");

    const resolved = resolveGrantedEffectPending(queued, pending.pendingId);
    const allyAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "m01-ally"
    )!;
    expect(allyAfter.zone).toBe("field");
    expect(allyAfter.exhaustState).toBe("exhausted");
    expect(allyAfter.pendingLeaveKind).toBeNull();
    expect(resolved.pendingLeaveEntities).toHaveLength(0);
  });

  it("[board] 自分起因(self_effect)の破壊では残置反応が発火しない", () => {
    const source = createCardInstance(m01, {
      instanceId: "m01-self-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const ally = createCardInstance(m01, {
      instanceId: "m01-self-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [source, ally] }),
      grantEffect,
      "m01-self-source"
    );
    const chainId = "m01-self-destroy";
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "m01-self-ally",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: ALICE,
        chainId,
      }),
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "m01-self-ally",
          relatedPlayerId: ALICE,
          cause: "self_effect",
          chainId,
        },
      ],
      getDef
    );
    expect(grantedEffectPendings(queued)).toHaveLength(0);
  });

  it("[board] 本来コスト5-8の範囲外(コスト3)のスピリットは対象に含まれない", () => {
    const source = createCardInstance(m01, {
      instanceId: "m01-range-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // BSTH02.7-C03: 黄/動玩/コスト4。5-8範囲外なので付与対象外。
    const outOfRange = createCardInstance(card("BSTH02.7-C03"), {
      instanceId: "m01-range-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [source, outOfRange] }),
      grantEffect,
      "m01-range-source"
    );
    const chainId = "m01-range-destroy";
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "m01-range-ally",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId,
      }),
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "m01-range-ally",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId,
        },
      ],
      getDef
    );
    expect(grantedEffectPendings(queued)).toHaveLength(0);
  });
});
