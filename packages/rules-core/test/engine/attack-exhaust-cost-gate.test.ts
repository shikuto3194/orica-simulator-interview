/**
 * BSFT01-TR07(B) Lv2-Lv3:
 * 「相手のスピリット/アルティメットがアタックするとき、相手は相手の
 * スピリット/アルティメット1体を疲労させなければアタックできない。」
 *
 * 10_rules/02:136-137 によりアタック宣言後にアタッカー自身が疲労するため、
 * 本 gate の疲労コストは宣言元とは別の回復状態カードから支払う。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../../card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../../src/effect/structured-effect-registrations";
import {
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getAttackDeclarationBlockReason,
  getLegalActions,
  joinActiveAttackAsAction,
  useAttackAsAction,
} from "../../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../../src";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);
const TR07B = cardNoMap.get("BSFT01-TR07(B)")!;
const TR07A = cardNoMap.get("BSFT01-TR07(A)")!;
const LUCY = cardNoMap.get("BSFT01-CX01")!;
const EXHAUST_TRIGGER_SPIRIT = cardNoMap.get("BSSA01-X02")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(
  expandCardDefinitionsWithBackFaces(ALL_CARDS)
);

function tr07ExhaustGateEffect() {
  const effect = TR07B.effects!.find((e) =>
    e.steps.some((step) => step.action.kind === "require_attack_exhaust_cost")
  );
  if (!effect) throw new Error("BSFT01-TR07(B) exhaust gate effect missing");
  return effect;
}

function buildState(
  withCostBuddy: boolean,
  options: {
    costBuddyAttachedChild?: boolean;
    withSecondGate?: boolean;
    withSecondCostBuddy?: boolean;
    withJoiner?: boolean;
    withJoinCost?: boolean;
    withJoinCostSecond?: boolean;
  } = {}
): GameState {
  const tr07 = createCardInstance(TR07B, {
    instanceId: "tr07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 2,
  });
  const tr07Second = createCardInstance(TR07B, {
    instanceId: "tr07-2",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 2,
  });
  const attacker = createCardInstance(LUCY, {
    instanceId: "attacker",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const costBuddy = createCardInstance(LUCY, {
    instanceId: "cost-buddy",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: options.costBuddyAttachedChild ? ["cost-brave"] : [],
  });
  const costBrave = createCardInstance(TR07A, {
    instanceId: "cost-brave",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 0,
    attachedToInstanceId: "cost-buddy",
  });
  const costBuddySecond = createCardInstance(LUCY, {
    instanceId: "cost-buddy-2",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const joiner = createCardInstance(LUCY, {
    instanceId: "joiner",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const joinCost = createCardInstance(LUCY, {
    instanceId: "join-cost",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const joinCostSecond = createCardInstance(LUCY, {
    instanceId: "join-cost-2",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const cardInstances = [
    tr07,
    ...(options.withSecondGate ? [tr07Second] : []),
    attacker,
    ...(withCostBuddy ? [costBuddy] : []),
    ...(options.withSecondCostBuddy ? [costBuddySecond] : []),
    ...(options.costBuddyAttachedChild ? [costBrave] : []),
    ...(options.withJoiner ? [joiner] : []),
    ...(options.withJoinCost ? [joinCost] : []),
    ...(options.withJoinCostSecond ? [joinCostSecond] : []),
  ];
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
  });
  return {
    ...state,
    turnNumber: 2,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
  };
}

function withSimultaneousAttackGrant(state: GameState): GameState {
  const grant: ContinuousEffect = {
    effectId: "test-simultaneous-attack",
    sourceInstanceId: "tr07",
    sourceDefinitionId: TR07B.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "while_on_field" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "allow_simultaneous_attack",
    targetInstanceId: "bob",
    metadata: {
      filter: { category: ["spirit", "ultimate"] },
      maxCount: 2,
      blockerCapacity: 1,
    },
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, grant],
  };
}

function registerGate(state: GameState, sourceInstanceId = "tr07"): GameState {
  return executeEffect({
    chainId: "test:attack-exhaust-cost-gate:174",
    state,
    effect: tr07ExhaustGateEffect(),
    sourceInstanceId,
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
}

function withCannotBeExhaustedByOpponentEffect(
  state: GameState,
  instanceId: string
): GameState {
  const resistance: ContinuousEffect = {
    effectId: `test-cannot-exhaust:${instanceId}`,
    sourceInstanceId: instanceId,
    sourceDefinitionId: LUCY.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "while_on_field" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
    modifierTag: "cannot_be_exhausted",
    targetInstanceId: instanceId,
    metadata: { source: "opponent" },
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, resistance],
  };
}

describe("require_attack_exhaust_cost gate", () => {
  it("BSFT01-TR07(B) defines the Lv2-Lv3 attack exhaust gate without a stub", () => {
    const effect = tr07ExhaustGateEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.timingScope).toEqual({
      player: "opponent",
      period: "attack",
    });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.steps[0]!.action).toEqual({
      kind: "require_attack_exhaust_cost",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: "all",
      },
      costTargetFilter: { category: ["spirit", "ultimate"] },
      duration: { scope: "while_on_field" },
    });
  });

  it("registers an attack_exhaust_cost_gate CE and hides attacks when no separate ready cost source exists", () => {
    const state = registerGate(buildState(false));
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "attack_exhaust_cost_gate"
      )
    ).toBe(true);

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
  });

  it("offers attack actions per exhaust cost source and exhausts that source on declaration", () => {
    const state = registerGate(buildState(true));
    const attack = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).find(
      (action) =>
        action.kind === "attack" &&
        action.sourceInstanceId === "attacker" &&
        action.attackExhaustCostSourceInstanceId === "cost-buddy" &&
        action.targetInstanceId === undefined
    );
    expect(attack).toBeDefined();

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceId: "cost-buddy",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const confirmed = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "attacker")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "cost-buddy")
        ?.exhaustState
    ).toBe("exhausted");
    expect(confirmed.log).toContain(
      "attack:exhaust-cost-paid:attacker:cost-buddy"
    );
  });

  it("rejects stale attack exhaust cost selections when no gate is active", () => {
    const state = buildState(true);

    expect(() =>
      useAttackAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        attackExhaustCostSourceInstanceId: "cost-buddy",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      })
    ).toThrow(/requires an exhaust cost source/);
  });

  it("requires one exhaust cost source per overlapping attack_exhaust_cost_gate", () => {
    const state = registerGate(
      registerGate(
        buildState(true, {
          withSecondGate: true,
          withSecondCostBuddy: true,
        })
      ),
      "tr07-2"
    );
    const attack = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).find(
      (action) =>
        action.kind === "attack" &&
        action.sourceInstanceId === "attacker" &&
        action.attackExhaustCostSourceInstanceIds?.includes("cost-buddy") &&
        action.attackExhaustCostSourceInstanceIds?.includes("cost-buddy-2")
    );
    expect(attack).toBeDefined();
    if (attack?.kind !== "attack") throw new Error("expected attack action");

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceIds:
        attack.attackExhaustCostSourceInstanceIds,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const confirmed = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "cost-buddy")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "cost-buddy-2")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("hides attacks when overlapping gates have fewer ready cost sources than required", () => {
    const state = registerGate(
      registerGate(buildState(true, { withSecondGate: true })),
      "tr07-2"
    );

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
    expect(
      getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }).some(
        (action) =>
          action.kind === "attack" && action.sourceInstanceId === "attacker"
      )
    ).toBe(false);
  });

  it("exhausts attached children when the exhaust cost source is a combined host", () => {
    const state = registerGate(
      buildState(true, { costBuddyAttachedChild: true })
    );

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceId: "cost-buddy",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const confirmed = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "cost-buddy")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "cost-brave")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("does not offer a cost source that cannot be exhausted by the gate source", () => {
    const state = withCannotBeExhaustedByOpponentEffect(
      registerGate(buildState(true)),
      "cost-buddy"
    );

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
    expect(
      getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }).some(
        (action) =>
          action.kind === "attack" &&
          action.attackExhaustCostSourceInstanceId === "cost-buddy"
      )
    ).toBe(false);
  });

  it("requires and pays the exhaust cost for join_active_attack declarations", () => {
    const state = registerGate(
      buildState(true, { withJoiner: true, withJoinCost: true })
    );
    const stateWithExhaustTriggerCost: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "join-cost"
          ? {
              ...card,
              definitionId: EXHAUST_TRIGGER_SPIRIT.cardNo,
              normalCoreCount: 2,
            }
          : card
      ),
    };
    const tentative = useAttackAsAction({
      state: stateWithExhaustTriggerCost,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceId: "cost-buddy",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const attacking = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(() =>
      joinActiveAttackAsAction({
        state: attacking,
        actingPlayerId: "bob",
        sourceInstanceId: "joiner",
        getCardDefinitionById,
      })
    ).toThrow(/requires an exhaust cost source/);

    const joined = joinActiveAttackAsAction({
      state: attacking,
      actingPlayerId: "bob",
      sourceInstanceId: "joiner",
      attackExhaustCostSourceInstanceId: "join-cost",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(
      joined.cardInstances.find((card) => card.instanceId === "joiner")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      joined.cardInstances.find((card) => card.instanceId === "join-cost")
        ?.exhaustState
    ).toBe("exhausted");
    expect(joined.log).toContain("attack:exhaust-cost-paid:joiner:join-cost");
    expect(
      joined.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "exhaust" &&
          pending.relatedInstanceId === "join-cost"
      )
    ).toBe(true);
  });

  it("rejects stale join_active_attack exhaust cost selections when no gate is active", () => {
    const state = buildState(true, { withJoiner: true, withJoinCost: true });
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const attacking = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(() =>
      joinActiveAttackAsAction({
        state: attacking,
        actingPlayerId: "bob",
        sourceInstanceId: "joiner",
        attackExhaustCostSourceInstanceId: "join-cost",
        getCardDefinitionById,
      })
    ).toThrow(/requires an exhaust cost source/);
  });

  it("requires and pays per-participant exhaust costs for simultaneous attack participants", () => {
    const state = withSimultaneousAttackGrant(
      registerGate(buildState(true, { withJoiner: true, withJoinCost: true }))
    );

    expect(() =>
      useAttackAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        attackExhaustCostSourceInstanceId: "cost-buddy",
        additionalSourceInstanceIds: ["joiner"],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      })
    ).toThrow(/participant requires an exhaust cost source/);

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceId: "cost-buddy",
      additionalSourceInstanceIds: ["joiner"],
      additionalAttackExhaustCostSourceInstanceIds: {
        joiner: "join-cost",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const confirmed = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "joiner")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "join-cost")
        ?.exhaustState
    ).toBe("exhausted");
    expect(confirmed.log).toContain(
      "attack:exhaust-cost-paid:joiner:join-cost"
    );
  });

  it("requires multiple exhaust cost sources for simultaneous attack participants when gates overlap", () => {
    const state = withSimultaneousAttackGrant(
      registerGate(
        registerGate(
          buildState(true, {
            withSecondGate: true,
            withSecondCostBuddy: true,
            withJoiner: true,
            withJoinCost: true,
            withJoinCostSecond: true,
          })
        ),
        "tr07-2"
      )
    );

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker",
      attackExhaustCostSourceInstanceIds: ["cost-buddy", "cost-buddy-2"],
      additionalSourceInstanceIds: ["joiner"],
      additionalAttackExhaustCostSourceInstanceIds: {
        joiner: ["join-cost", "join-cost-2"],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });
    const confirmed = confirmAttackDeclarationAsAction(
      tentative.preDeclarationStackWindow!,
      tentative,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }
    ).state;

    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "joiner")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "join-cost")
        ?.exhaustState
    ).toBe("exhausted");
    expect(confirmed.log).toContain(
      "attack:exhaust-cost-paid:joiner:join-cost"
    );
    expect(confirmed.log).toContain(
      "attack:exhaust-cost-paid:joiner:join-cost-2"
    );
  });

  it("rejects simultaneous participants that reuse a primary exhaust cost source", () => {
    const state = withSimultaneousAttackGrant(
      registerGate(
        registerGate(
          buildState(true, {
            withSecondGate: true,
            withSecondCostBuddy: true,
            withJoiner: true,
            withJoinCost: true,
          })
        ),
        "tr07-2"
      )
    );

    expect(() =>
      useAttackAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker",
        attackExhaustCostSourceInstanceIds: ["cost-buddy", "cost-buddy-2"],
        additionalSourceInstanceIds: ["joiner"],
        additionalAttackExhaustCostSourceInstanceIds: {
          joiner: ["join-cost", "cost-buddy-2"],
        },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      })
    ).toThrow(
      /Simultaneous attack participant requires an exhaust cost source/
    );
  });
});
