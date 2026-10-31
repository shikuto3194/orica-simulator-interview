/**
 * BSTH04-X01「[導界者]西行寺 幽々子」effects[1]（【導域】Lv2）の検証。
 *
 * 原文: 「系統:「起幻」を持つ自分の黄/紫のスピリットすべては、相手の効果でフィールドを
 * 離れるとき、疲労状態でフィールドに残ることができる。」
 *
 * 幽々子自身の効果による任意残留。対象自身への効果付与ではない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  queuePendingLeave,
  recomputeAndRebuildContinuousEffects,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import type { CollectedTriggerEvent } from "../src/effect/trigger-system";
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
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  expect(
    state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
      ?.definitionId
  ).toBe("BSTH04-X01");
  expect(effect.timing.kind).toBe("game_event");
  return recomputeAndRebuildContinuousEffects(
    { ...state, activePlayerId: ALICE, step: "attack" },
    getDef
  );
}

function queueDomainEvents(
  state: GameState,
  events: Array<
    Pick<
      CollectedTriggerEvent,
      | "eventKind"
      | "relatedInstanceId"
      | "relatedPlayerId"
      | "cause"
      | "chainId"
    >
  >,
  getDefinition = getDef
) {
  return queuePendingReactionsFromTriggerEvents(
    state,
    events.map((event) => ({
      ...event,
      actingPlayerId: ALICE,
      source: "action_resolution" as const,
      attackId: null,
      amount: 1,
      preFlushLeaveEvent: true,
      suppressBurstCheck: true,
    })),
    undefined,
    {
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    }
  );
}

function grantedEffectPendings(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (pending) =>
      (pending.registeredLeaveFieldStayOnFieldSourceKeys?.length ?? 0) > 0
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
    getRegisteredTriggeredEffectActions,
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
    getRegisteredTriggeredEffectActions,
  }).state;

  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const actingPlayerId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass, `pass_stack for ${actingPlayerId}`).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  return current;
}

describe("BSTH04-X01 effects[1]: 幽々子による起幻/黄・紫スピリットの残留", () => {
  const yuyuko = card("BSTH04-X01");
  it("既存の対象がいる状態で、後から出た2体目も疲労状態で残せる", () => {
    const inst = (no: string, id: string, cores: number) =>
      createCardInstance(card(no), {
        instanceId: id,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: cores,
      });
    const initial = recomputeAndRebuildContinuousEffects(
      {
        ...createEmptyGameState({
          cardInstances: [
            inst("BSTH04-X01", "source", 4),
            inst("BSTH04-X03", "first", 1),
          ],
        }),
        activePlayerId: ALICE,
        step: "attack",
      },
      getDef
    );
    const entered = recomputeAndRebuildContinuousEffects(
      {
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          inst("BSTH04-X03", "late", 1),
        ],
      },
      getDef
    );
    const pendingLeave = queuePendingLeave({
      state: entered,
      instanceId: "late",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "late-destroy",
    });
    const queued = queueDomainEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "late",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId: "late-destroy",
        },
      ],
      getDef
    );
    expect(grantedEffectPendings(queued)).toHaveLength(1);
    const resolved = resolveGrantedEffectPending(
      queued,
      grantedEffectPendings(queued)[0]!.pendingId
    );
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "late")
    ).toMatchObject({
      zone: "field",
      exhaustState: "exhausted",
      pendingLeaveKind: null,
    });
  });
  const grantEffect = yuyuko.effects![1]!;

  it("DSL 構造: 幽々子自身が対象の離脱を観測し、任意で残留させる", () => {
    expect(grantEffect.timing).toMatchObject({
      kind: "game_event",
      event: "leave_field",
      player: "self",
      cause: "opponent_effect",
      triggerFilter: {
        category: ["spirit"],
        colors: ["yellow", "purple"],
        tribes: ["起幻"],
      },
    });
    expect(grantEffect.stub).toBeUndefined();
    expect(grantEffect.textRef).toEqual([11, 12]);

    const action = grantEffect.steps[0]!.action;
    expect(grantEffect.executionMode).toBe("optional");
    expect(action).toEqual({
      kind: "stay_on_field",
      target: {
        kind: "trigger_related_instances",
        includePendingLeave: true,
        count: { min: 1 },
      },
      newExhaustState: "exhausted",
    });
  });

  it("[board] 相手起因の破壊で疲労状態のままフィールドに残せる(execute)", () => {
    const nexus = createCardInstance(yuyuko, {
      instanceId: "yuyuko-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    // BSTH04-X03: 紫/起幻・幻想・冥主 スピリット。filter に合致する。
    const komachi = createCardInstance(card("BSTH04-X03"), {
      instanceId: "komachi-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [nexus, komachi] }),
      grantEffect,
      "yuyuko-nexus"
    );
    const chainId = "yuyuko-opponent-destroy";
    const pendingLeave = queuePendingLeave({
      state: granted,
      instanceId: "komachi-ally",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    const queued = queueDomainEvents(
      pendingLeave,
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "komachi-ally",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId,
        },
      ],
      getDef
    );
    const pending = grantedEffectPendings(queued)[0]!;
    expect(pending.relatedInstanceId).toBe("komachi-ally");

    const resolved = resolveGrantedEffectPending(queued, pending.pendingId);
    const komachiAfter = resolved.cardInstances.find(
      (c) => c.instanceId === "komachi-ally"
    )!;
    expect(komachiAfter.zone).toBe("field");
    expect(komachiAfter.exhaustState).toBe("exhausted");
    expect(komachiAfter.pendingLeaveKind).toBeNull();
    expect(resolved.pendingLeaveEntities).toHaveLength(0);
  });

  it("[board] 自分起因(self_effect)の破壊では残置反応が発火しない", () => {
    const nexus = createCardInstance(yuyuko, {
      instanceId: "yuyuko-self-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const komachi = createCardInstance(card("BSTH04-X03"), {
      instanceId: "komachi-self-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [nexus, komachi] }),
      grantEffect,
      "yuyuko-self-nexus"
    );
    const chainId = "yuyuko-self-destroy";
    const queued = queueDomainEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "komachi-self-ally",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: ALICE,
        chainId,
      }),
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "komachi-self-ally",
          relatedPlayerId: ALICE,
          cause: "self_effect",
          chainId,
        },
      ],
      getDef
    );
    expect(grantedEffectPendings(queued)).toHaveLength(0);
  });

  it("[board] 色/系統が合致しないスピリットは残留対象に含まれない", () => {
    const nexus = createCardInstance(yuyuko, {
      instanceId: "yuyuko-mismatch-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    // BSDB01-M02: 赤/魔人 (色も系統も filter 対象外) スピリットを用いる。
    const outOfScope = createCardInstance(card("BSDB01-M02"), {
      instanceId: "mismatch-ally",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granted = runEffect(
      createEmptyGameState({ cardInstances: [nexus, outOfScope] }),
      grantEffect,
      "yuyuko-mismatch-nexus"
    );
    const queued = queueDomainEvents(
      queuePendingLeave({
        state: granted,
        instanceId: "mismatch-ally",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "mismatch",
      }),
      [
        {
          eventKind: "destroy",
          relatedInstanceId: "mismatch-ally",
          relatedPlayerId: ALICE,
          cause: "opponent_effect",
          chainId: "mismatch",
        },
      ]
    );
    expect(grantedEffectPendings(queued)).toHaveLength(0);
  });
});
