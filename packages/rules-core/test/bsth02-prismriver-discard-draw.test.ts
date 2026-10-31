import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const PRISMRIVER_CARD_NOS = ["BSTH02-R01", "BSTH02-R02", "BSTH02-R03"] as const;

function card(cardNo: string): CardDefinition {
  const definition = cardNoMap.get(cardNo);
  if (!definition) throw new Error(`missing card definition: ${cardNo}`);
  return definition;
}

function getCardDefinitionById(id: string): CardDefinition | undefined {
  return cardNoMap.get(id);
}

const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

function playerHandCount(state: GameState): number {
  return state.players.find((player) => player.id === ALICE)!.handCount;
}

function playerDeckCount(state: GameState): number {
  return state.players.find((player) => player.id === ALICE)!.deckCount;
}

function playerState(state: GameState, playerId: string) {
  return state.players.find((player) => player.id === playerId)!;
}

function legalActions(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: triggeredLookup,
  });
}

function setup(
  cardNo: (typeof PRISMRIVER_CARD_NOS)[number],
  opts?: {
    handCount?: number;
    deckCount?: number;
    withSelfNexus?: boolean;
    withOpponentNexus?: boolean;
    opponentFieldCores?: number;
    opponentReserveCores?: number;
    opponentTrashCores?: number;
    opponentVoidCores?: number;
  }
): GameState {
  const source = card(cardNo);
  const filler = card("BSTH02-C01");
  const nexus = card("BSTH02-C21");
  const handCount = opts?.handCount ?? 2;
  const deckCount = opts?.deckCount ?? 3;
  const sourceInstance = createCardInstance(source, {
    instanceId: "source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(filler, {
      instanceId: `hand-${index}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    })
  );
  const deck = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(filler, {
      instanceId: `deck-${index}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  const selfNexus =
    opts?.withSelfNexus === true
      ? [
          createCardInstance(nexus, {
            instanceId: "self-nexus",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
          }),
        ]
      : [];
  const opponentNexus =
    opts?.withOpponentNexus === true
      ? [
          createCardInstance(nexus, {
            instanceId: "opponent-nexus",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: opts?.opponentFieldCores ?? 1,
          }),
        ]
      : [];

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        sourceInstance,
        ...hand,
        ...deck,
        ...selfNexus,
        ...opponentNexus,
      ],
      playerOverrides: [
        {
          handCount: handCount + 1,
          deckCount,
          reserveNormalCoreCount: 10,
          trashNormalCoreCount: 0,
        },
        {
          reserveNormalCoreCount: opts?.opponentReserveCores ?? 0,
          trashNormalCoreCount: opts?.opponentTrashCores ?? 0,
          voidNormalCoreCount: opts?.opponentVoidCores ?? 0,
        },
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
}

function summonSource(state: GameState, paymentAmount = 5): GameState {
  const summon = legalActions(state, ALICE).find(
    (action) => action.kind === "summon" && action.sourceInstanceId === "source"
  );
  expect(summon).toBeDefined();
  const opened = applyLegalAction({
    state,
    action: summon!,
    paymentSources: [{ kind: "reserve", amount: paymentAmount }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;

  const bobPass = legalActions(opened, BOB).find(
    (action) => action.kind === "pass_stack"
  );
  expect(bobPass).toBeDefined();
  const afterBobPass = applyLegalAction({
    state: opened,
    action: bobPass!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
  const alicePass = legalActions(afterBobPass, ALICE).find(
    (action) => action.kind === "pass_stack"
  );
  let current = alicePass
    ? applyLegalAction({
        state: afterBobPass,
        action: alicePass,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state
    : afterBobPass;
  if (current.pendingEnterFieldPlacement !== null) {
    const placementAction = legalActions(current, ALICE).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(placementAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: placementAction!,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  while (current.pendingBurstChecks.length > 0) {
    const actingPlayerId = current.pendingBurstChecks[0]!.actingPlayerId;
    const burstCheckAction = legalActions(current, actingPlayerId).find(
      (action) =>
        action.kind === "resolve_pending_burst_check" ||
        action.kind === "decline_pending_burst_check"
    );
    expect(burstCheckAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: burstCheckAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => undefined,
    }).state;
  }
  return current;
}

function selectSummonTriggerIfNeeded(
  state: GameState,
  registrationIndex: number
): GameState {
  const hasResolve = legalActions(state, ALICE).some(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "source" &&
      action.registrationIndex === registrationIndex
  );
  if (hasResolve) return state;
  const select = legalActions(state, ALICE).find(
    (action) =>
      action.kind === "select_pending_to_resolve" &&
      (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "source" &&
      action.registrationIndex === registrationIndex
  );
  expect(select).toBeDefined();
  return applyLegalAction({
    state,
    action: select!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 6 && current.window === "stack"; i++) {
    const pass = [BOB, ALICE]
      .flatMap((playerId) => legalActions(current, playerId))
      .find((action) => action.kind === "pass_stack");
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return current;
}

function resolveSummonCoreMove(
  state: GameState,
  cardNo: (typeof PRISMRIVER_CARD_NOS)[number]
): GameState {
  const ready = selectSummonTriggerIfNeeded(state, 1);
  const resolve = legalActions(ready, ALICE).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "source" &&
      action.sourceCardNo === cardNo &&
      action.registrationIndex === 1
  );
  expect(resolve).toBeDefined();

  const declared = applyLegalAction({
    state: ready,
    action: resolve!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
  return passStackUntilClosed(declared);
}

function resolveSummonDiscardDraw(state: GameState): GameState {
  const ready = selectSummonTriggerIfNeeded(state, 0);
  const resolve = legalActions(ready, ALICE).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      (action.sourceEffectInstanceId ?? action.sourceInstanceId) === "source" &&
      action.sourceCardNo === "BSTH02-R01" &&
      action.registrationIndex === 0
  );
  expect(resolve).toBeDefined();
  return applyLegalAction({
    state: ready,
    action: resolve!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

describe("BSTH02 プリズムリバー共通 召喚時 discard→draw", () => {
  it.each(PRISMRIVER_CARD_NOS)(
    "%s effects[0] は手札1枚破棄 → conditional_cost 2ドローで、旧 activationCost stub を残さない",
    (cardNo) => {
      const effect = card(cardNo).effects![0]!;
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
      expect(effect.executionMode).toBe("optional");
      expect(effect.steps).toHaveLength(2);
      expect(effect.steps[0]!.action).toMatchObject({
        kind: "discard",
        count: 1,
        player: "self",
        fromZone: "hand",
      });
      expect(effect.steps[1]!.action).toEqual({ kind: "draw", count: 2 });
      expect(effect.steps[1]!.connector).toBe("conditional_cost");
    }
  );

  it.each(PRISMRIVER_CARD_NOS)(
    "%s effects[1] はネクサス存在条件付きで、条件stubを残さない",
    (cardNo) => {
      const effect = card(cardNo).effects![1]!;
      expect(effect.stub).toBeUndefined();
      expect(effect.condition).toEqual([
        { kind: "field_has", player: "either", category: ["nexus"] },
      ]);
    }
  );

  it("BSTH02-R01: 召喚時 legal-action 経路で手札破棄候補があれば選択後に2枚ドローする", () => {
    const queued = summonSource(setup("BSTH02-R01"));
    const after = passStackUntilClosed(resolveSummonDiscardDraw(queued));
    expect(after.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(after.pendingZoneSelection?.maxCount).toBe(1);
    expect(after.pendingZoneSelection?.continuation?.resumeStepIndex).toBe(1);
    expect(playerHandCount(after)).toBe(2);

    const resolved = applyLegalAction({
      state: after,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-0"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;

    expect(resolved.pendingZoneSelection).toBeNull();
    expect(
      resolved.cardInstances.find(
        (instance) => instance.instanceId === "hand-0"
      )?.zone
    ).toBe("trash");
    expect(playerHandCount(resolved)).toBe(3);
    expect(playerDeckCount(resolved)).toBe(1);
  });

  it("BSTH02-R01: 手札が無ければ発揮可能な summon triggered resolve 候補は出ず、discard→drawできない", () => {
    const queued = summonSource(
      setup("BSTH02-R01", { handCount: 0, deckCount: 3 })
    );
    const resolveActions = legalActions(queued, ALICE).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "source" &&
        action.sourceCardNo === "BSTH02-R01" &&
        action.registrationIndex === 0
    );
    const executableResolveActions = resolveActions.filter(
      (action) => action.skipOnly !== true
    );

    expect(executableResolveActions).toHaveLength(0);
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0]?.skipOnly).toBe(true);
    expect(playerHandCount(queued)).toBe(0);
    expect(playerDeckCount(queued)).toBe(3);
  });

  it("BSTH02-R01 effects[1]: 相手側だけにネクサスがある場合も「ネクサスがあるとき」の条件でコアをリザーブへ移す", () => {
    const queued = summonSource(
      setup("BSTH02-R01", { withOpponentNexus: true, opponentFieldCores: 1 })
    );
    const resolved = resolveSummonCoreMove(queued, "BSTH02-R01");

    expect(playerState(resolved, BOB).reserveNormalCoreCount).toBe(1);
    expect(resolved.log).toContain("effect:core_move:field:bob->reserve:bob:1");
  });

  it("BSTH02-R02 effects[1]: ネクサス条件下で相手リザーブのコア1個をトラッシュに置く", () => {
    const queued = summonSource(
      setup("BSTH02-R02", { withSelfNexus: true, opponentReserveCores: 1 }),
      3
    );
    const resolved = resolveSummonCoreMove(queued, "BSTH02-R02");

    expect(playerState(resolved, BOB).reserveNormalCoreCount).toBe(0);
    expect(playerState(resolved, BOB).trashNormalCoreCount).toBe(1);
    expect(resolved.log).toContain("effect:core_move:reserve:bob->trash:bob:1");
  });

  it("BSTH02-R02 effects[2]: Lv2-Lv3 自分の手札は相手の効果を受けない", () => {
    const source = createCardInstance(card("BSTH02-R02"), {
      instanceId: "merlin-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const handCard = createCardInstance(card("BSTH02-C01"), {
      instanceId: "alice-hand-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const bobSource = createCardInstance(card("BSTH02-C02"), {
      instanceId: "bob-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, handCard, bobSource],
      playerOverrides: [{ handCount: 1 }, {}],
    });
    const effect = card("BSTH02-R02").effects![2]!;

    expect(effect.stub).toBeUndefined();
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: {
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      },
      duration: { scope: "while_on_field" },
    });

    const resolved = executeEffect({
      chainId: "test:bsth02-prismriver-discard-draw:444",
      state,
      effect,
      sourceInstanceId: "merlin-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const protectedHandCard = resolved.cardInstances.find(
      (instance) => instance.instanceId === "alice-hand-card"
    )!;

    expect(
      isCardImmuneToOpponentEffect(
        resolved,
        protectedHandCard,
        BOB,
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        resolved,
        protectedHandCard,
        ALICE,
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);

    const afterBobDiscard = executeEffect({
      chainId: "test:bsth02-prismriver-discard-draw:476",
      state: resolved,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "opponent",
              fromZone: "hand",
            },
          },
        ],
      },
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      getCardDefinitionById,
    });

    expect(
      afterBobDiscard.cardInstances.find(
        (instance) => instance.instanceId === "alice-hand-card"
      )?.zone
    ).toBe("hand");
    expect(playerHandCount(afterBobDiscard)).toBe(1);

    const afterBobReveal = executeEffect({
      chainId: "test:bsth02-prismriver-discard-draw:503",
      state: resolved,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "reveal_hand",
              player: "opponent",
              revealTo: "self",
            },
          },
        ],
      },
      sourceInstanceId: "bob-source",
      actingPlayerId: BOB,
      getCardDefinitionById,
    });

    expect(
      afterBobReveal.log.some((entry) => entry.startsWith("effect:reveal_hand"))
    ).toBe(false);
  });

  it("BSTH02-R03 effects[1]: ネクサス条件下で相手トラッシュのコア1個をボイドに置く", () => {
    const queued = summonSource(
      setup("BSTH02-R03", { withSelfNexus: true, opponentTrashCores: 1 }),
      3
    );
    const resolved = resolveSummonCoreMove(queued, "BSTH02-R03");

    expect(playerState(resolved, BOB).trashNormalCoreCount).toBe(0);
    expect(playerState(resolved, BOB).voidNormalCoreCount).toBe(1);
    expect(resolved.log).toContain("effect:core_move:trash:bob->void:bob:1");
  });

  it("BSTH02-R01 effects[1]: ネクサスが無ければコア移動の resolve 候補は出ない", () => {
    const queued = summonSource(setup("BSTH02-R01"));
    const resolveActions = legalActions(queued, ALICE).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "source" &&
        action.sourceCardNo === "BSTH02-R01" &&
        action.registrationIndex === 1
    );

    expect(resolveActions).toHaveLength(0);
  });
});
