/**
 * BSTH02-XX01 八雲 紫:
 * 「煌臨元カード2枚を破棄することで、相手のフラッシュ効果を無効にする」。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  type ActiveStack,
  adventSourceIdsOf,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  queueEffectDeclarationTriggers,
} from "../src";
import {
  getCandidateTargetInstanceIds,
  resolveEmptyFireTargetCounts,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition } from "../src";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function card(cardNo: string): CardDefinition {
  const def = cardNoMap.get(cardNo);
  if (!def) throw new Error(`missing card: ${cardNo}`);
  return def;
}

function makeState(sourceCount: number, otherSourceCount = 0) {
  const host = {
    ...createCardInstance(card("BSTH02-XX01"), {
      instanceId: "alice-yukari",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    }),
    underCards: Array.from({ length: sourceCount }, (_, i) => ({
      cardInstanceId: `alice-source-${i}`,
      role: "advent_source" as const,
    })),
  };
  const sources = Array.from({ length: sourceCount }, (_, i) =>
    createCardInstance(card("BSTH02-C01"), {
      instanceId: `alice-source-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    })
  );
  const otherHost = {
    ...createCardInstance(card("BSTH02-C02"), {
      instanceId: "alice-other-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    }),
    underCards: Array.from({ length: otherSourceCount }, (_, i) => ({
      cardInstanceId: `alice-other-source-${i}`,
      role: "advent_source" as const,
    })),
  };
  const otherSources = Array.from({ length: otherSourceCount }, (_, i) =>
    createCardInstance(card("BSTH02-C03"), {
      instanceId: `alice-other-source-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    })
  );
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances:
      otherSourceCount > 0
        ? [host, ...sources, otherHost, ...otherSources]
        : [host, ...sources],
  });
}

function makeMagicStack(patch: Partial<ActiveStack> = {}): ActiveStack {
  return {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: BOB,
    cardInstanceId: "bob-magic",
    cardDefinitionId: "BSTH02-C01",
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    chosenTiming: "flash",
    previousPendingStackAction: null,
    ...patch,
  } as ActiveStack;
}

describe("BSTH02-XX01 八雲 紫 煌臨元破棄フラッシュ無効", () => {
  const adventAttackEffect = card("BSTH02-XX01").effects![0]!;
  const effect = card("BSTH02-XX01").effects![1]!;
  const getRegisteredTriggeredEffectActions =
    buildTriggeredEffectLookup(ALL_CARDS);

  function makeAdventAttackState(options: { handCost?: boolean } = {}) {
    const host = createCardInstance(card("BSTH02-XX01"), {
      instanceId: "alice-yukari",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    const handCost = createCardInstance(card("BSTH02-C01"), {
      instanceId: "alice-hand-cost",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const targets = [0, 1].map((i) =>
      createCardInstance(card("BSTH02-C02"), {
        instanceId: `bob-target-${i}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    return createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ handCount: options.handCost === false ? 0 : 1 }, {}],
      cardInstances:
        options.handCost === false
          ? [host, ...targets]
          : [host, handCost, ...targets],
    });
  }

  function resolveStepOptionalChoice(
    state: ReturnType<typeof makeAdventAttackState>,
    choice: "execute" | "decline"
  ) {
    const pending = state.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    return applyLegalAction({
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending!.pendingId}:${choice}`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.choosingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  it("shape: 相手フラッシュ効果発揮前誘発 + 煌臨元2枚破棄 conditional_cost", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "effect_declaration",
      triggerEffectTiming: "flash",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.steps[0]!.action).toMatchObject({
      kind: "move_card",
      target: {
        kind: "filter",
        player: "self",
        filter: {},
        count: 2,
        zone: "field",
      },
      from: {
        zone: "field",
        player: "self",
        sourceUnderCardRole: "advent_source",
      },
      to: { zone: "trash" },
      count: 2,
      requireFullCount: true,
    });
    expect(effect.steps[1]).toMatchObject({
      connector: "conditional_cost",
      action: {
        kind: "negate",
        negateTarget: "effect",
        targetEffectTiming: "flash",
      },
    });
  });

  it("shape: 煌臨先は煌臨中に限定し、手札1枚を煌臨元追加コストにする", () => {
    expect(card("BSTH02-XX01").adventData?.adventCondition).toMatchObject({
      targetCategory: ["spirit"],
      tribes: ["幻想"],
      adventState: "advented",
    });
    expect(adventAttackEffect.stub).toBeUndefined();
    expect(adventAttackEffect.steps[1]).toMatchObject({
      id: "add_advent_source_cost",
      executionMode: "optional",
      action: {
        kind: "move_card",
        target: {
          kind: "filter",
          player: "self",
          filter: {},
          count: 1,
          zone: "hand",
        },
        from: { zone: "hand", player: "self" },
        to: { zone: "field", sourceUnderCardRole: "advent_source" },
        count: 1,
        requireFullCount: true,
      },
    });
    expect(adventAttackEffect.steps[2]).toMatchObject({
      connector: "conditional_cost",
      action: {
        kind: "unblockable",
        target: { kind: "self" },
        duration: { scope: "battle" },
      },
    });
    expect(adventAttackEffect.steps[3]).toMatchObject({
      connector: "conditional_result",
      action: { kind: "recover", target: { kind: "self" } },
    });
  });

  it("煌臨/アタック時: 手札1枚を煌臨元に追加して回復しブロックされない", () => {
    const pending = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:252",
      state: makeAdventAttackState(),
      effect: adventAttackEffect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["bob-target-0", "bob-target-1"],
      sequentialTargetConsumption: true,
    });
    expect(pending.pendingStepOptionalChoice).not.toBeNull();
    const after = resolveStepOptionalChoice(pending, "execute");

    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    const cost = after.cardInstances.find(
      (c) => c.instanceId === "alice-hand-cost"
    )!;

    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-target-0")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-target-1")?.zone
    ).toBe("deck");
    expect(cost.zone).toBe("field");
    expect(cost.zoneRoleName).toBe("advent-source");
    expect(cost.normalCoreCount).toBe(0);
    expect(adventSourceIdsOf(host)).toContain("alice-hand-cost");
    expect(host.exhaustState).toBe("recovered");
    expect(after.players.find((p) => p.id === ALICE)?.handCount).toBe(0);
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "alice-yukari" &&
          ce.duration.scope === "battle"
      )
    ).toBe(true);
  });

  it("煌臨/アタック時: 手札コストを払えなければ回復/ブロック不可は発生しない", () => {
    const pending = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:294",
      state: makeAdventAttackState({ handCost: false }),
      effect: adventAttackEffect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["bob-target-0", "bob-target-1"],
    });
    expect(pending.pendingStepOptionalChoice).not.toBeNull();
    const choices = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).filter((a) => a.kind === "resolve_pending_step_optional_choice");
    expect(choices.map((a) => a.choice)).toEqual(["decline"]);
    const after = resolveStepOptionalChoice(pending, "decline");

    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-target-0")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-target-1")?.zone
    ).toBe("deck");
    expect(adventSourceIdsOf(host)).toEqual([]);
    expect(host.exhaustState).toBe("exhausted");
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === "alice-yukari"
      )
    ).toBe(false);
  });

  it("フラッシュ効果無効はマジックのフラッシュ効果スタックにも届く", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(card("BSTH02-XX01"), {
          instanceId: "alice-yukari",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        }),
        createCardInstance(card("BSTH02-C01"), {
          instanceId: "bob-magic",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "in_use",
        }),
      ],
    });
    const request = {
      negateTarget: "effect" as const,
      targetController: "opponent" as const,
      targetEffectTiming: "flash" as const,
    };

    expect(
      stackMatchesNegateAction({
        state,
        stack: makeMagicStack(),
        request,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      })
    ).toBe(true);
    expect(
      stackMatchesNegateAction({
        state,
        stack: makeMagicStack({ chosenTiming: "main" }),
        request,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      })
    ).toBe(false);
    expect(
      stackMatchesNegateAction({
        state,
        stack: makeMagicStack({ activationLabel: "none" }),
        request,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      })
    ).toBe(true);
  });

  it("ことで構文の任意誘発として triggered registration へ optional が伝播する", () => {
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const registrations =
      getRegisteredTriggeredEffectActions("BSTH02-XX01") ?? [];
    const registration = registrations.find(
      (r) =>
        r.eventKind === "effect_declaration" &&
        r.eventMatcher?.family === "effect_declaration" &&
        r.eventMatcher.effectActivationTiming === "flash"
    );

    expect(registration).toBeDefined();
    expect(registration?.executionMode).toBe("optional");
    expect(registration).toMatchObject({
      requiredTargetCount: 2,
      candidateTargetPlayerScope: "acting_player",
      candidateTargetZones: ["field"],
      sourceUnderCardRole: "advent_source",
      targetRequiresFullCount: true,
    });
  });

  it("対象候補はこのスピリットの煌臨元だけに絞る", () => {
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const registration = (
      getRegisteredTriggeredEffectActions("BSTH02-XX01") ?? []
    ).find(
      (r) =>
        r.eventKind === "effect_declaration" &&
        r.eventMatcher?.family === "effect_declaration" &&
        r.eventMatcher.effectActivationTiming === "flash"
    );
    expect(registration).toBeDefined();

    const candidates = getCandidateTargetInstanceIds(
      makeState(3, 2),
      ALICE,
      registration!,
      {
        getCardDefinitionById,
        sourceInstanceId: "alice-yukari",
        sourceDefinition: card("BSTH02-XX01"),
      }
    );

    expect(candidates).toEqual([
      "alice-source-0",
      "alice-source-1",
      "alice-source-2",
    ]);
  });

  it("煌臨元が2枚未満なら対象不足で発揮候補を出さない", () => {
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const registration = (
      getRegisteredTriggeredEffectActions("BSTH02-XX01") ?? []
    ).find(
      (r) =>
        r.eventKind === "effect_declaration" &&
        r.eventMatcher?.family === "effect_declaration" &&
        r.eventMatcher.effectActivationTiming === "flash"
    );
    expect(registration).toBeDefined();

    const candidates = getCandidateTargetInstanceIds(
      makeState(1),
      ALICE,
      registration!,
      {
        getCardDefinitionById,
        sourceInstanceId: "alice-yukari",
        sourceDefinition: card("BSTH02-XX01"),
      }
    );
    const counts = resolveEmptyFireTargetCounts({
      requiredTargetCount: registration!.requiredTargetCount ?? 0,
      maxTargetCount:
        registration!.maxTargetCount ?? registration!.requiredTargetCount ?? 0,
      candidateCount: candidates.length,
      gatedByConditionalCost:
        registration!.targetGatedByConditionalCost === true,
      requiresFullCount: registration!.targetRequiresFullCount === true,
    });

    expect(candidates).toEqual(["alice-source-0"]);
    expect(counts.block).toBe(true);
  });

  it("effect_declaration は activationLabel=none でも chosenTiming=flash なら発揮前誘発する", () => {
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(ALL_CARDS);
    const state = {
      ...makeState(2),
      activePlayerId: BOB,
      step: "attack" as const,
    };

    const none = queueEffectDeclarationTriggers({
      state,
      stack: makeMagicStack({ activationLabel: "none" }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const flash = queueEffectDeclarationTriggers({
      state,
      stack: makeMagicStack({ activationLabel: "flash" }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    expect(none.pendingTriggeredEffects).toHaveLength(1);
    expect(flash.pendingTriggeredEffects).toHaveLength(1);
    expect(none.pendingTriggeredEffects[0]?.eventKind).toBe(
      "effect_declaration"
    );
    expect(flash.pendingTriggeredEffects[0]?.eventKind).toBe(
      "effect_declaration"
    );
  });

  it("煌臨元2枚を破棄して host の underCards から外す", () => {
    const pending = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:512",
      state: makeState(2),
      effect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["alice-source-0", "alice-source-1"],
    });
    const after = flushPendingLeaves(pending, getCardDefinitionById);

    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-0")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-1")?.zone
    ).toBe("trash");
    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    expect(adventSourceIdsOf(host)).toEqual([]);
    expect(after.log).toContain("effect:move_card:field->trash:2cards");
    expect(after.log).toContain("effect:negate:registered:effect");
  });

  it("煌臨元が3枚以上なら選んだ2枚だけを破棄する", () => {
    const pending = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:537",
      state: makeState(3),
      effect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["alice-source-2", "alice-source-0"],
    });
    const after = flushPendingLeaves(pending, getCardDefinitionById);

    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-0")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-1")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-2")?.zone
    ).toBe("trash");
    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    expect(adventSourceIdsOf(host)).toEqual(["alice-source-1"]);
    expect(after.log).toContain("effect:move_card:field->trash:2cards");
    expect(after.log).toContain("effect:negate:registered:effect");
  });

  it("煌臨元が1枚だけなら部分破棄せず negate も発生しない", () => {
    const after = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:565",
      state: makeState(1),
      effect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["alice-source-0"],
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-0")?.zone
    ).toBe("field");
    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    expect(adventSourceIdsOf(host)).toEqual(["alice-source-0"]);
    expect(after.log).not.toContain("effect:move_card:field->trash:1cards");
    expect(after.log).not.toContain("effect:negate:registered:effect");
  });

  it("別スピリットの煌臨元はコスト候補に混ぜない", () => {
    const after = executeEffect({
      chainId: "test:bsth02-xx01-advent-source-negate:586",
      state: makeState(1, 2),
      effect,
      sourceInstanceId: "alice-yukari",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: ["alice-source-0"],
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-source-0")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-other-source-0")
        ?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "alice-other-source-1")
        ?.zone
    ).toBe("field");
    const host = after.cardInstances.find(
      (c) => c.instanceId === "alice-yukari"
    )!;
    const otherHost = after.cardInstances.find(
      (c) => c.instanceId === "alice-other-host"
    )!;
    expect(adventSourceIdsOf(host)).toEqual(["alice-source-0"]);
    expect(adventSourceIdsOf(otherHost)).toEqual([
      "alice-other-source-0",
      "alice-other-source-1",
    ]);
    expect(after.log).not.toContain("effect:move_card:field->trash:2cards");
    expect(after.log).not.toContain("effect:negate:registered:effect");
  });
});
