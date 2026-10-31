import { flushReadyEffectCompletions } from "../src/effect/effect-completion";
/**
 * BSRK01 (るろうに剣心) カードの effects 検証テスト。
 * 飛天御剣流マジック / 契約煌臨「剣心」中心。
 * 契約煌臨の多ゾーン召喚・OC・名称付与能力・「疲労状態でブロックできる」・「相手の効果で防げない」・
 * 自分ターン限定条件・創界神コア全ボイド・セット済みバースト破棄は基盤未対応のため stub。
 * 条件付き destroy / bounce / BP+ バフ等の確定効果のみ DSL 変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";
import {
  applyLegalAction,
  advanceStep,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeReevaluationCheck,
  getEffectiveBp,
  getEffectiveSymbols,
  getAvailableFieldCardEffectLegalActions,
  getLegalActions,
  queueEffectActivationTriggers,
  rebuildContinuousEffectsFromField,
  sanitizeStateForViewer,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
  confirmAttackDeclarationAsAction,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import { generateMagicRegistrations } from "../src/effect/structured-effect-registrations";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { executeReplaceAttackDeclaration } from "../src/effect/attack-declaration-replacement";
import { confirmBlockDeclarationAsAction } from "../src/battle/battle-actions";
import { maybeFinalizeDesignatedAttackAfterPendingReactions } from "../src/legal/attack-burst-flow";
import { getAttackEntityId } from "../src/battle/battle-shared";
import { createStepExecutionContext } from "../src/step-execution-context";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

function makeTestSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

describe("BSRK01-CX01 緋村 剣心", () => {
  type Cx01SourceMode = "field" | "soul_state" | "advent_source";
  type Cx01DestroyKind = "effect" | "bp_compare";

  function closeCx01BattleFlashWindow(options: {
    state: GameState;
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions: ReturnType<
      typeof buildTriggeredEffectLookup
    >;
    getRegisteredBurstActions: ReturnType<typeof buildBurstEffectLookup>;
  }): GameState {
    const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
    const openAction = getLegalActions({
      state: options.state,
      actingPlayerId: options.state.activePlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    if (!openAction) {
      return options.state;
    }

    const openedState = applyLegalAction({
      state: options.state,
      action: openAction,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).state;
    const firstPriorityPlayerId =
      openedState.activeAttack?.flashWindowState?.priorityPlayerId ??
      options.state.activePlayerId;
    const firstPassAction = getLegalActions({
      state: openedState,
      actingPlayerId: firstPriorityPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const passedState = applyLegalAction({
      state: openedState,
      action: firstPassAction!,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).state;
    const nextPriorityPlayerId =
      passedState.activeAttack?.flashWindowState?.priorityPlayerId;

    if (!nextPriorityPlayerId) {
      return passedState;
    }

    const secondPassAction = getLegalActions({
      state: passedState,
      actingPlayerId: nextPriorityPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");

    return applyLegalAction({
      state: passedState,
      action: secondPassAction!,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }).state;
  }

  function runDeckBottomScenario(options: {
    sourceMode: Cx01SourceMode;
    destroyKind: Cx01DestroyKind;
    multiple?: boolean;
  }): void {
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const burstLookup = buildBurstEffectLookup(ALL_CARDS);
    const destroyAction: Effect["steps"][number]["action"] =
      options.destroyKind === "bp_compare"
        ? {
            kind: "bp_compare_destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: options.multiple ? 2 : 1,
            },
          }
        : {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: options.multiple ? 2 : 1,
            },
          };
    const victimFixture: CardDefinition = {
      ...makeTestSpirit("BSRK01-CX01-VICTIM"),
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    };
    const destroyFixture: CardDefinition = {
      ...makeTestSpirit("BSRK01-CX01-DESTROY-SOURCE"),
      cardNo: "BSRK01-CX01-DESTROY-SOURCE",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "cx01-test-destroy",
              action: destroyAction,
            },
          ],
        },
      ],
    };
    const fixtureGetDef = (id: string): CardDefinition | undefined =>
      id === destroyFixture.cardNo
        ? destroyFixture
        : id === victimFixture.cardNo
          ? victimFixture
          : getDef(id);
    const cx01 = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount:
        options.sourceMode === "field" || options.sourceMode === "soul_state"
          ? 1
          : 0,
      attachedToInstanceId:
        options.sourceMode === "advent_source" ? "alice-host" : null,
    });
    const host = createCardInstance(card("BSRK01-C04"), {
      instanceId: "alice-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    host.underCards = [{ cardInstanceId: "alice-cx01", role: "advent_source" }];
    const kaoru = createCardInstance(card("BSRK01-C02"), {
      instanceId: "alice-kaoru",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const destroySource = createCardInstance(destroyFixture, {
      instanceId: "alice-destroy-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimFixture, {
      instanceId: "bob-victim",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const deckTail = createCardInstance(card("BSRK01-C07"), {
      instanceId: "bob-deck-tail",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const aliceOverride =
      options.sourceMode === "soul_state"
        ? {
            deckCount: 0,
            soulStateInstanceIds: ["alice-cx01"],
            contractCardNo: "BSRK01-CX01",
          }
        : { deckCount: 0 };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances:
        options.sourceMode === "advent_source"
          ? [host, kaoru, cx01, destroySource, victim, deckTail]
          : [cx01, destroySource, victim, deckTail],
      playerOverrides: [aliceOverride, { deckCount: 1 }],
    });
    if (options.multiple) {
      base.cardInstances.push({ ...victim, instanceId: "bob-victim-2" });
    }
    const victimIds = options.multiple
      ? ["bob-victim", "bob-victim-2"]
      : ["bob-victim"];
    const destroyStack: ActiveStack = {
      stackId: "cx01-test-destroy-stack",
      actionKind: "field_card_effect",
      chainId: "cx01-test-destroy-chain",
      actingPlayerId: "alice",
      cardInstanceId: "alice-destroy-source",
      cardDefinitionId: destroyFixture.cardNo,
      targetInstanceIds: victimIds,
      targetStepId: "cx01-test-destroy",
      targetEffectFilterTags: [],
      targetSelectionResolved: true,
      fieldEffectSourceKind: "spirit",
    };
    const afterDestroy = resolveStackCascade(
      { ...base, activePlayerId: "alice", step: "main" },
      [destroyStack],
      {
        getCardDefinitionById: fixtureGetDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredBurstActions: burstLookup,
      }
    );

    expect(
      afterDestroy.cardInstances.find((c) => c.instanceId === "bob-victim")
    ).toMatchObject({ zone: "field", pendingLeaveKind: "destroy" });
    expect(afterDestroy.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({ instanceId: "bob-victim", kind: "destroy" })
    );
    const pending = afterDestroy.pendingTriggeredEffects.find(
      (p) => p.eventKind === "destroy" && p.relatedInstanceId === "bob-victim"
    );
    expect(pending?.registeredLeaveFieldPreFlushSourceKeys?.length).toBe(1);

    const resolveActions = getLegalActions({
      state: afterDestroy,
      actingPlayerId: "alice",
      getCardDefinitionById: fixtureGetDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveActions).toHaveLength(1);
    const resolveAction = resolveActions[0]!;
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: afterDestroy,
      action: resolveAction,
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).state;
    const triggeredStack = declared.stackWindow
      ?.pendingStackAction as ActiveStack;
    expect(triggeredStack?.actionKind).toBe("triggered_effect");
    const stillHeld = flushPendingLeaves(declared, fixtureGetDef);
    expect(
      stillHeld.cardInstances.find((c) => c.instanceId === "bob-victim")
    ).toMatchObject({ zone: "field", pendingLeaveKind: "destroy" });

    const final = resolveStackCascade(
      { ...declared, stackWindow: null, pendingStackCascade: null },
      [triggeredStack],
      {
        getCardDefinitionById: fixtureGetDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(final.pendingTriggeredEffects).toHaveLength(0);
    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "bob-victim")
    ).toMatchObject({ zone: "deck", pendingLeaveKind: null });
    expect(
      final.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-tail", ...victimIds]);
  }

  it.each(["field", "soul_state", "advent_source"] as const)(
    "【不殺のるろうに】: %s 発揮元から自分が破壊した相手対象を production trigger 経路でデッキ下へ戻す",
    (sourceMode) => {
      runDeckBottomScenario({ sourceMode, destroyKind: "effect" });
    }
  );

  it("【不殺のるろうに】: 自分の BP 比べ破壊でも相手対象をデッキ下へ戻す", () => {
    runDeckBottomScenario({ sourceMode: "field", destroyKind: "bp_compare" });
  });

  it.each(["field", "soul_state", "advent_source"] as const)(
    "【不殺のるろうに】: %s は同時破壊に1回だけ誘発し、破壊した全対象を戻す",
    (sourceMode) => {
      runDeckBottomScenario({
        sourceMode,
        destroyKind: "effect",
        multiple: true,
      });
    }
  );

  it("【不殺のるろうに】: 通常バトル破壊でも相手対象を production trigger 経路でデッキ下へ戻す", () => {
    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const burstLookup = buildBurstEffectLookup(ALL_CARDS);
    const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(ALL_CARDS);
    const blockerFixture: CardDefinition = {
      ...makeTestSpirit("BSRK01-CX01-BATTLE-BLOCKER"),
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    };
    const fixtureGetDef = (id: string): CardDefinition | undefined =>
      id === blockerFixture.cardNo ? blockerFixture : getDef(id);
    const cx01 = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const blocker = createCardInstance(blockerFixture, {
      instanceId: "bob-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const deckTail = createCardInstance(card("BSRK01-C07"), {
      instanceId: "bob-deck-tail",
      ownerPlayerId: "bob",
      zone: "deck",
    });
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cx01, blocker, deckTail],
        playerOverrides: [{ deckCount: 0 }, { deckCount: 1 }],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const lookupOptions = {
      getCardDefinitionById: fixtureGetDef,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    };
    const attackAction = getLegalActions({
      state: base,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((legalAction) => legalAction.kind === "attack");
    expect(attackAction).toBeDefined();
    const attackTentative = applyLegalAction({
      state: base,
      action: attackAction!,
      ...lookupOptions,
    }).state;
    const attackPassAction = getLegalActions({
      state: attackTentative,
      actingPlayerId: "bob",
      ...lookupOptions,
    }).find((legalAction) => legalAction.kind === "pass_pre_declaration_stack");
    expect(attackPassAction).toBeDefined();
    const attacked = applyLegalAction({
      state: attackTentative,
      action: attackPassAction!,
      ...lookupOptions,
    }).state;
    const readyToBlock = closeCx01BattleFlashWindow({
      state: attacked,
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    });
    const blockAction = getLegalActions({
      state: readyToBlock,
      actingPlayerId: "bob",
      ...lookupOptions,
    }).find((legalAction) => legalAction.kind === "block");
    expect(blockAction).toBeDefined();
    expect(getAttackEntityId(readyToBlock, "alice-cx01")).toBeDefined();
    const blockTentative = applyLegalAction({
      state: readyToBlock,
      action: blockAction!,
      ...lookupOptions,
    }).state;
    const blocked = applyLegalAction({
      state: blockTentative,
      action: getLegalActions({
        state: blockTentative,
        actingPlayerId: "alice",
        ...lookupOptions,
      }).find(
        (legalAction) => legalAction.kind === "pass_pre_declaration_stack"
      )!,
      ...lookupOptions,
    }).state;
    const afterBattle = closeCx01BattleFlashWindow({
      state: blocked,
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    });

    expect(
      afterBattle.cardInstances.find((c) => c.instanceId === "bob-blocker")
    ).toMatchObject({ zone: "field", pendingLeaveKind: "destroy" });
    const resolveAction = getLegalActions({
      state: afterBattle,
      actingPlayerId: "alice",
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: afterBattle,
      action: resolveAction!,
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).state;
    const triggeredStack = declared.stackWindow
      ?.pendingStackAction as ActiveStack;
    const final = resolveStackCascade(
      { ...declared, stackWindow: null, pendingStackCascade: null },
      [triggeredStack],
      {
        getCardDefinitionById: fixtureGetDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    expect(
      final.cardInstances.find((c) => c.instanceId === "bob-blocker")
    ).toMatchObject({ zone: "deck", pendingLeaveKind: null });
    expect(
      final.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-tail", "bob-blocker"]);
  });
});

function walkDeckRevealPickAndOrder(
  state: GameState,
  selectedPickIds: string[],
  remainderPlacements?: Record<string, "top" | "bottom">
): GameState {
  const pickAction = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
  expect(pickAction).toBeDefined();
  let current = applyLegalAction({
    state,
    action: pickAction!,
    getCardDefinitionById: getDef,
    selectedDeckRevealCardIds: selectedPickIds,
  }).state;

  if (current.pendingDeckReveal?.phase === "ordering_remainder") {
    const orderAction = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction!.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected deck reveal order action");
    }
    const remaining = orderAction!.remainingCardInstanceIds;
    current = applyLegalAction({
      state: current,
      action: orderAction!,
      getCardDefinitionById: getDef,
      deckRevealRemainderOrder: remaining,
      deckRevealRemainderPlacements:
        remainderPlacements ??
        Object.fromEntries(
          remaining.map((id, index) => [id, index === 0 ? "top" : "bottom"])
        ),
    }).state;
  }

  return current;
}

function makeBsrk01C01DeckRevealState(options: {
  handCount: number;
  setAsideCount?: number;
}): { state: GameState; sourceId: string } {
  const source = createCardInstance(card("BSRK01-C01"), {
    instanceId: "bsrk01-c01-source",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "in_use",
  });
  const handCards = Array.from({ length: options.handCount }, (_, i) =>
    createCardInstance(card("BSTH01-C01"), {
      instanceId: `hand-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    })
  );
  const setAsideCards = Array.from(
    { length: options.setAsideCount ?? 0 },
    (_, i) =>
      createCardInstance(card("BSTH01-C01"), {
        instanceId: `setaside-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "set_aside",
      })
  );
  const deckCards = [
    createCardInstance(card("BSRK01-C02"), {
      instanceId: "deck-pick",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    }),
    createCardInstance(card("BSTH01-C01"), {
      instanceId: "deck-rest-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    }),
    createCardInstance(card("BSTH01-C01"), {
      instanceId: "deck-rest-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    }),
    createCardInstance(card("BSTH01-C01"), {
      instanceId: "deck-tail",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    }),
  ];
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    sourceId: source.instanceId,
    state: {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [source, ...handCards, ...setAsideCards, ...deckCards],
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              handCount: options.handCount,
              deckCount: deckCards.length,
            }
          : player
      ),
    },
  };
}

describe("BSRK01-C06 飛天御剣流『飛龍閃』", () => {
  const c = card("BSRK01-C06");
  it("スタック: 相手スピリット/アルティメット1体を手札に戻す(bounce) + バースト破棄(discard_set_burst)", () => {
    // BSRK01-C06 effects[0]: bounce
    const bounce = c.effects![0]!;
    expect(bounce.timing).toEqual({ kind: "activated", mode: "stack" });
    // 〔アタックステップ〕限定 = timingScope。stub は解消済み。
    expect(bounce.timingScope).toEqual({ player: "both", period: "attack" });
    expect(bounce.stub).toBeUndefined();
    const action = bounce.steps[0]!.action;
    expect(action.kind).toBe("bounce");
    if (action.kind === "bounce") {
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
    }
    // BSRK01-C06 effects[1] / effects[2]: バースト破棄 (新規プリミティブ discard_set_burst)。
    // テキスト〔自分のメインステップ/お互いのアタックステップ〕は TimingScope の単一
    // player/period では表現できないため、同 steps を持つ effect を 2 件に分割登録する。
    // effect[1] = {self, main}, effect[2] = {both, attack}。
    const burstMain = c.effects![1]!;
    expect(burstMain.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(burstMain.timingScope).toEqual({ player: "self", period: "main" });
    expect(burstMain.stub).toBeUndefined();
    expect(burstMain.steps).toHaveLength(1);
    const burstMainAction = burstMain.steps[0]!.action;
    expect(burstMainAction.kind).toBe("discard_set_burst");
    if (burstMainAction.kind === "discard_set_burst") {
      expect(burstMainAction.player).toBe("opponent");
      expect(burstMainAction.count).toBe(1);
    }
    const burstAtk = c.effects![2]!;
    expect(burstAtk.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(burstAtk.timingScope).toEqual({ player: "both", period: "attack" });
    expect(burstAtk.stub).toBeUndefined();
    expect(burstAtk.steps).toHaveLength(1);
    const burstAtkAction = burstAtk.steps[0]!.action;
    expect(burstAtkAction.kind).toBe("discard_set_burst");
    if (burstAtkAction.kind === "discard_set_burst") {
      expect(burstAtkAction.player).toBe("opponent");
      expect(burstAtkAction.count).toBe(1);
    }
  });

  it("『バースト1つを破棄する』本文をバーストセット可能カードとして扱わない", () => {
    expect(c.keywordTags).not.toContain("burst");

    const source = createCardInstance(c, {
      instanceId: "c06-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup([c]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c]),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([c]),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([c]),
      getRegisteredBurstActions: buildBurstEffectLookup([c]),
    });

    expect(actions.some((action) => action.kind === "set_burst")).toBe(false);
  });
});

describe("BSRK01-C07 明神 弥彦", () => {
  const c = card("BSRK01-C07");
  const alice = (s: GameState) => s.players.find((p) => p.id === "alice")!;

  it("Lv2 continuous: 相手の効果による『アタックステップ終了』を禁止する restrict_end_attack_step を持つ", () => {
    expect(c.printedCategory).toBe("nexus");
    const eff = c.effects![1]!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.timingScope).toEqual({ player: "self", period: "attack" });
    expect(eff.applicability).toMatchObject({ level: { min: 2, max: 2 } });
    expect(eff.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "剣心" }],
    });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("restrict_end_attack_step");
    if (action.kind === "restrict_end_attack_step") {
      expect(action.player).toBe("opponent");
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[board] メインステップ終了時: トラッシュの非ソウルコアのみ明治スピリットへ配分され、1個以上置いたので1ドロー後手札5枚以下に調整される", () => {
    const kenshin = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "alice-kenshin",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const yahiko = createCardInstance(card("BSRK01-C07"), {
      instanceId: "alice-yahiko",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        activePlayerId: "alice",
        playerOverrides: [
          {
            trashNormalCoreCount: 5,
            soulCoreLocation: { kind: "trash" },
            handCount: 4,
            deckCount: 1,
          },
          {},
        ],
        cardInstances: [kenshin, yahiko],
      }),
      step: "main",
    } as GameState;

    const eff = { ...c.effects![0]!, executionMode: "mandatory" as const };
    const distributeStep = eff.steps[0]!;
    expect(distributeStep.action.kind).toBe("core_distribute");
    if (distributeStep.action.kind === "core_distribute") {
      expect(distributeStep.action.effectKind).toBe("normal_only");
    }

    const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
    const burstLookup = buildBurstEffectLookup(ALL_CARDS);

    const afterAttempt = executeEffect({
      chainId: "test:bsrk01-cards:819",
      state: before,
      effect: eff,
      sourceInstanceId: "alice-yahiko",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterAttempt.pendingCoreDistribution).not.toBeNull();
    // 「剣心」(明治・剣士) も系統「明治」を持つため候補に含まれる。
    expect(afterAttempt.pendingCoreDistribution?.candidates).toEqual([
      { instanceId: "alice-kenshin", definitionId: "BSRK01-CX01" },
      { instanceId: "alice-yahiko", definitionId: "BSRK01-C07" },
    ]);

    const distributeAction = getLegalActions({
      state: afterAttempt,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distributeAction).toBeDefined();
    const afterDistribute = applyLegalAction({
      state: afterAttempt,
      action: distributeAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
      coreDistributionAllocations: { "alice-yahiko": 3 },
    }).state;

    expect(alice(afterDistribute).trashNormalCoreCount).toBe(2); // 5 - 3
    // 《ソウルコア》以外: ソウルコアは選択候補に入らずトラッシュに残る。
    expect(alice(afterDistribute).soulCoreLocation).toEqual({ kind: "trash" });
    const target = afterDistribute.cardInstances.find(
      (x) => x.instanceId === "alice-yahiko"
    )!;
    expect(target.normalCoreCount).toBe(3);

    // 1個以上置いたので、続くドローが optional choice として立つ。
    expect(afterDistribute.pendingStepOptionalChoice).not.toBeNull();
    const optionalChoice = afterDistribute.pendingStepOptionalChoice!;
    const afterDrawChoice = applyLegalAction({
      state: afterDistribute,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${optionalChoice.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: optionalChoice.actingPlayerId,
        pendingId: optionalChoice.pendingId,
        sourceInstanceId: optionalChoice.sourceInstanceId,
        effectIndex: optionalChoice.effectIndex,
        stepIndex: optionalChoice.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).state;

    // 1ドロー(4→5)→ドロー後、手札5枚以下は既に満たすため戻す枚数は0（no-op）。
    expect(alice(afterDrawChoice).handCount).toBe(5);
    expect(alice(afterDrawChoice).deckCount).toBe(0);
    expect(afterDrawChoice.pendingZoneSelection ?? null).toBeNull();
  });
});

describe("BSRK01-R01 飛天御剣流『九頭龍閃』", () => {
  const c = card("BSRK01-R01");
  it("フラッシュ: 自分の「剣心」すべて BP+20000 (turn) + スタック: BP20000以下の相手スピリット2体破壊", () => {
    const flash = c.effects![0]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const buff = flash.steps[0]!.action;
    expect(buff.kind).toBe("bp_modify");
    if (buff.kind === "bp_modify") {
      expect(buff.amount).toBe(20000);
      expect(buff.duration).toEqual({ scope: "turn" });
      expect(buff.target).toMatchObject({
        kind: "filter",
        player: "self",
        count: "all",
      });
    }
    // 「疲労状態でブロックできる」を allow_block_while_exhausted で配線（旧 stub 撤去）。
    const bwx = flash.steps[1]!.action;
    expect(bwx.kind).toBe("allow_block_while_exhausted");
    if (bwx.kind === "allow_block_while_exhausted") {
      expect(bwx.target).toMatchObject({
        kind: "filter",
        player: "self",
        count: "all",
      });
    }
    expect(flash.stub).toBeUndefined();

    const stack = c.effects![1]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.stub).toBeUndefined();
    expect(stack.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "剣心" }],
      includeSoulState: true,
    });
    const destroy = stack.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy") {
      expect(destroy.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"], maxBp: 20000 },
        count: 2,
      });
    }
  });

  it("フラッシュ: BP+20000 は『剣心』名だけに適用され、他の自分カードへ漏れない", () => {
    const kenshinDef = card("BSRK01-CX01");
    const kaoruDef = card("BSRK01-C02");
    const source = createCardInstance(c, {
      instanceId: "r01-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const kenshin = createCardInstance(kenshinDef, {
      instanceId: "kenshin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const kaoru = createCardInstance(kaoruDef, {
      instanceId: "kaoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [source, kenshin, kaoru],
    };
    const beforeKenshin = getEffectiveBp(state, kenshin, kenshinDef, card);
    const beforeKaoru = getEffectiveBp(state, kaoru, kaoruDef, card);

    const after = executeEffect({
      chainId: "test:bsrk01-cards:970",
      state,
      effect: c.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "r01-source",
      actingPlayerId: "alice",
      getCardDefinitionById: card,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    expect(
      getEffectiveBp(
        after,
        after.cardInstances.find((x) => x.instanceId === "kenshin-1")!,
        kenshinDef,
        card
      )
    ).toBe(beforeKenshin + 20000);
    expect(
      getEffectiveBp(
        after,
        after.cardInstances.find((x) => x.instanceId === "kaoru-1")!,
        kaoruDef,
        card
      )
    ).toBe(beforeKaoru);
  });
});

describe("BSRK01-R02 飛天御剣流『天翔龍閃』", () => {
  const c = card("BSRK01-R02");

  const plainNexusDef: CardDefinition = {
    cardNo: "TEST-BSRK01-R02-NEXUS",
    name: "テストネクサス",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: ["white"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const grandwalkerNexusDef: CardDefinition = {
    ...plainNexusDef,
    cardNo: "TEST-BSRK01-R02-GW",
    name: "テスト創界神ネクサス",
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
  };
  const kenshinDef: CardDefinition = {
    ...plainNexusDef,
    cardNo: "TEST-BSRK01-R02-KENSHIN",
    name: "テスト剣心",
    printedCategory: "spirit",
  };
  const opponentImmuneNexusCE: ContinuousEffect = {
    effectId: "test-cbd-bob-nexus",
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed",
    targetInstanceId: "bob-nexus",
    metadata: { source: "opponent_effect" },
  };

  function makeState(options: {
    selfCount: number;
    selfKenshinAdvented?: boolean;
    nexusImmune?: boolean;
  }): GameState {
    const alice = createCardInstance(c, {
      instanceId: "alice-src",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const cards = [
      alice,
      createCardInstance(plainNexusDef, {
        instanceId: "bob-nexus",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      }),
      createCardInstance(grandwalkerNexusDef, {
        instanceId: "bob-gw-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(grandwalkerNexusDef, {
        instanceId: "bob-gw-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
      }),
    ];
    if (options.selfKenshinAdvented) {
      cards.push({
        ...createCardInstance(kenshinDef, {
          instanceId: "alice-kenshin",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        underCards: [
          { cardInstanceId: "alice-advent-src", role: "advent_source" },
        ],
      });
    }
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { countValue: options.selfCount },
        { voidNormalCoreCount: 0 },
      ],
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: cards,
      activeContinuousEffects: options.nexusImmune
        ? [opponentImmuneNexusCE]
        : [],
    };
  }

  const flashGetDef = (id: string): CardDefinition | undefined =>
    id === plainNexusDef.cardNo
      ? plainNexusDef
      : id === grandwalkerNexusDef.cardNo
        ? grandwalkerNexusDef
        : id === kenshinDef.cardNo
          ? kenshinDef
          : getDef(id);

  // 2 ステップ (destroy / core_move) はそれぞれ独立した対象選択を要するため、
  // 単一ステップに切り出して個別に実行する (integration-real-cards.test.ts:3356 と同型)。
  function runStep(
    state: GameState,
    stepIndex: 0 | 1,
    targetInstanceIds: string[]
  ): GameState {
    const flash = c.effects![0]!;
    return executeEffect({
      chainId: "test:bsrk01-cards:1124",
      state,
      effect: { ...flash, steps: [flash.steps[stepIndex]!] },
      sourceInstanceId: "alice-src",
      actingPlayerId: "alice",
      getCardDefinitionById: flashGetDef,
      targetInstanceIds,
    });
  }

  it("stub 解消: turn_player 条件 + destroy(相手ネクサス2つまで、創界神を除外) + core_move(相手創界神ネクサス2つのコア全ボイド)", () => {
    const flash = c.effects![0]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.condition).toContainEqual({
      kind: "turn_player",
      player: "self",
    });

    const state = makeState({ selfCount: 0 });
    const afterDestroy = runStep(state, 0, ["bob-nexus"]);
    expect(
      afterDestroy.pendingLeaveEntities.some(
        (e) => e.instanceId === "bob-nexus"
      )
    ).toBe(true);
    // 創界神ネクサスは無印 category:["nexus"] destroy の対象から除外される (targetsGrandwalker 省略)。
    expect(
      afterDestroy.pendingLeaveEntities.some((e) => e.instanceId === "bob-gw-1")
    ).toBe(false);

    const afterCoreMove = runStep(state, 1, ["bob-gw-1", "bob-gw-2"]);
    const bobPlayer = afterCoreMove.players.find((p) => p.id === "bob")!;
    const gw1 = afterCoreMove.cardInstances.find(
      (x) => x.instanceId === "bob-gw-1"
    )!;
    const gw2 = afterCoreMove.cardInstances.find(
      (x) => x.instanceId === "bob-gw-2"
    )!;
    expect(gw1.normalCoreCount).toBe(0);
    expect(gw2.normalCoreCount).toBe(0);
    expect(bobPlayer.voidNormalCoreCount).toBe(2 + 3);
    // 破壊されていない通常ネクサス (bob-nexus) はコア移動の対象外 (targetsGrandwalker:"only" で除外)。
    const nexus = afterCoreMove.cardInstances.find(
      (x) => x.instanceId === "bob-nexus"
    )!;
    expect(
      afterCoreMove.pendingLeaveEntities.some(
        (e) => e.instanceId === "bob-nexus"
      )
    ).toBe(false);
    expect(nexus.zone).toBe("field");
  });

  it("煌臨中の「剣心」なし/カウント6未満: 相手の『破壊されない』に阻まれ nexus 残存", () => {
    const after = runStep(makeState({ selfCount: 5, nexusImmune: true }), 0, [
      "bob-nexus",
    ]);
    expect(
      after.pendingLeaveEntities.some(
        (e) => e.instanceId === "bob-nexus" && !e.blockedByResistance
      )
    ).toBe(false);
    const nexus = after.cardInstances.find((x) => x.instanceId === "bob-nexus");
    expect(nexus?.zone).toBe("field");
  });

  it("煌臨中の「剣心」あり ∧ カウント6以上: 相手の『破壊されない』を貫通し nexus 破壊", () => {
    const after = runStep(
      makeState({ selfCount: 6, selfKenshinAdvented: true, nexusImmune: true }),
      0,
      ["bob-nexus"]
    );
    expect(
      after.pendingLeaveEntities.some(
        (e) => e.instanceId === "bob-nexus" && !e.blockedByResistance
      )
    ).toBe(true);
  });

  it("煌臨中の「剣心」ありでもカウント6未満なら通常防止可能のまま残存", () => {
    const after = runStep(
      makeState({ selfCount: 5, selfKenshinAdvented: true, nexusImmune: true }),
      0,
      ["bob-nexus"]
    );
    expect(
      after.pendingLeaveEntities.some(
        (e) => e.instanceId === "bob-nexus" && !e.blockedByResistance
      )
    ).toBe(false);
  });
});

describe("BSRK01-R03 [御庭番衆編]緋村 剣心", () => {
  const c = card("BSRK01-R03");
  const handCardDef = card("BSRK01-C02");
  const sakabatoDef = card("BSRK01-X01");
  const cost8KenshinDef = card("BSRK01-X02");
  const derivedSakabatoDef: CardDefinition = {
    ...sakabatoDef,
    cardNo: "TEST-BSRK01-R03-DERIVED-SAKABATO",
    name: "[派生]逆刃刀",
  };

  const getR03Def = (id: string): CardDefinition | undefined =>
    id === derivedSakabatoDef.cardNo ? derivedSakabatoDef : getDef(id);

  function buildSwapState(options?: { setAsideOnly?: boolean }): GameState {
    const source = createCardInstance(c, {
      instanceId: "r03-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const outgoing = createCardInstance(handCardDef, {
      instanceId: "alice-outgoing",
      ownerPlayerId: "alice",
      zone: options?.setAsideOnly ? "set_aside" : "hand",
    });
    const incoming = createCardInstance(sakabatoDef, {
      instanceId: "alice-sakabato",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const cost8Kenshin = createCardInstance(cost8KenshinDef, {
      instanceId: "alice-cost8-kenshin",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const derivedSakabato = createCardInstance(derivedSakabatoDef, {
      instanceId: "alice-derived-sakabato",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 2 }, {}],
      cardInstances: [
        source,
        outgoing,
        incoming,
        cost8Kenshin,
        derivedSakabato,
      ],
    });
  }

  it("BSRK01-R03 effects[1]: OC中Lv1-Lv2フラッシュの手札⇔トラッシュ入替を queue_hand_trash_swap で表現する", () => {
    const effect = c.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 2,
    });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "queue_hand_trash_swap",
      outgoingFilter: {},
      outgoingZones: ["hand"],
      incomingFilter: {
        filterOr: [
          { cardName: { contains: "逆刃刀" } },
          { cardName: { contains: "剣心" }, minCost: 8, maxCost: 8 },
        ],
      },
    });
  });

  it("BSRK01-R03 effects[1]: 手札1枚とトラッシュの逆刃刀を atomic に入れ替え、コスト8の剣心も候補に含める", () => {
    const effect = c.effects![1]!;
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1303",
      state: buildSwapState(),
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(queued.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      queued.pendingHandTrashSwapChoice!.outgoingCandidateInstanceIds
    ).toEqual(["alice-outgoing"]);
    expect(queued.pendingHandTrashSwapChoice!.outgoingZones).toEqual(["hand"]);
    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual([
      "alice-sakabato",
      "alice-cost8-kenshin",
      "alice-derived-sakabato",
    ]);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_hand_trash",
        actionId: "test:bsrk01-r03-swap",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: queued.pendingHandTrashSwapChoice!.pendingId,
        sourceInstanceId: "r03-source",
        sourceCardNo: "BSRK01-R03",
        outgoingCardInstanceId: "alice-outgoing",
        outgoingCardNo: handCardDef.cardNo,
        incomingCardInstanceId: "alice-sakabato",
        incomingCardNo: sakabatoDef.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    }).state;

    expect(result.pendingHandTrashSwapChoice).toBeNull();
    expect(
      result.cardInstances.find((x) => x.instanceId === "alice-outgoing")!.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((x) => x.instanceId === "alice-sakabato")!.zone
    ).toBe("hand");
  });

  it("BSRK01-R03 effects[1]: stale action で手元へ移った outgoing を入替できない", () => {
    const effect = c.effects![1]!;
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1356",
      state: buildSwapState(),
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const staleState: GameState = {
      ...queued,
      cardInstances: queued.cardInstances.map((x) =>
        x.instanceId === "alice-outgoing" ? { ...x, zone: "set_aside" } : x
      ),
    };

    expect(() =>
      applyLegalAction({
        state: staleState,
        action: {
          kind: "swap_hand_trash",
          actionId: "test:bsrk01-r03-stale-set-aside",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: queued.pendingHandTrashSwapChoice!.pendingId,
          sourceInstanceId: "r03-source",
          sourceCardNo: "BSRK01-R03",
          outgoingCardInstanceId: "alice-outgoing",
          outgoingCardNo: handCardDef.cardNo,
          incomingCardInstanceId: "alice-sakabato",
          incomingCardNo: sakabatoDef.cardNo,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      })
    ).toThrow(/Invalid hand\/trash swap/);
  });

  it("BSRK01-R03 effects[1]: 原文は『手札と』なので手元だけでは入替 pending を生成しない", () => {
    const effect = c.effects![1]!;
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1396",
      state: buildSwapState({ setAsideOnly: true }),
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(queued.pendingHandTrashSwapChoice).toBeNull();
  });

  it("BSRK01-R03 effects[1]: 入替で手札に戻る側も cannot_be_bounced を受けていれば候補から除外する", () => {
    const effect = c.effects![1]!;
    const resistance: ContinuousEffect = {
      effectId: "test-bsrk01-r03-cannot-be-bounced",
      sourceInstanceId: "test-resistance-source",
      sourceDefinitionId: "TEST-RESISTANCE",
      actingPlayerId: "alice",
      controllerPlayerId: "alice",
      targetInstanceId: "alice-sakabato",
      modifierTag: "cannot_be_bounced",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      metadata: { source: "all" },
    };
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1422",
      state: {
        ...buildSwapState(),
        activeContinuousEffects: [resistance],
      },
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(queued.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["alice-cost8-kenshin", "alice-derived-sakabato"]);
  });

  it("BSRK01-R03 effects[1]: 入替で手札に戻る側も effect_immunity を受けていれば候補から除外する", () => {
    const effect = c.effects![1]!;
    const immunity: ContinuousEffect = {
      effectId: "test-bsrk01-r03-trash-effect-immunity",
      sourceInstanceId: "test-immunity-source",
      sourceDefinitionId: "TEST-IMMUNITY",
      actingPlayerId: "alice",
      controllerPlayerId: "alice",
      targetInstanceId: "alice-sakabato",
      modifierTag: "defense_immune",
      immunityPlayerScope: "any",
      duration: { scope: "while_in_trash" },
      createdAtTurn: 1,
      createdAtAttackId: null,
    };
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1455",
      state: {
        ...buildSwapState(),
        activeContinuousEffects: [immunity],
      },
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(queued.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["alice-cost8-kenshin", "alice-derived-sakabato"]);
  });

  it("BSRK01-R03 effects[1]: 解決時に incoming が cannot_be_bounced なら入替を拒否する", () => {
    const effect = c.effects![1]!;
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1475",
      state: buildSwapState(),
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const resistance: ContinuousEffect = {
      effectId: "test-bsrk01-r03-cannot-be-bounced-after-queue",
      sourceInstanceId: "test-resistance-source",
      sourceDefinitionId: "TEST-RESISTANCE",
      actingPlayerId: "alice",
      controllerPlayerId: "alice",
      targetInstanceId: "alice-sakabato",
      modifierTag: "cannot_be_bounced",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      metadata: { source: "all" },
    };

    expect(() =>
      applyLegalAction({
        state: {
          ...queued,
          activeContinuousEffects: [resistance],
        },
        action: {
          kind: "swap_hand_trash",
          actionId: "test:bsrk01-r03-incoming-blocked",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: queued.pendingHandTrashSwapChoice!.pendingId,
          sourceInstanceId: "r03-source",
          sourceCardNo: "BSRK01-R03",
          outgoingCardInstanceId: "alice-outgoing",
          outgoingCardNo: handCardDef.cardNo,
          incomingCardInstanceId: "alice-sakabato",
          incomingCardNo: sakabatoDef.cardNo,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      })
    ).toThrow(/incoming blocked by resistance/);
  });

  it("BSRK01-R03 effects[1]: 解決時に incoming が effect_immunity なら入替を拒否する", () => {
    const effect = c.effects![1]!;
    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1525",
      state: buildSwapState(),
      effect,
      sourceInstanceId: "r03-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getR03Def,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const immunity: ContinuousEffect = {
      effectId: "test-bsrk01-r03-trash-effect-immunity-after-queue",
      sourceInstanceId: "test-immunity-source",
      sourceDefinitionId: "TEST-IMMUNITY",
      actingPlayerId: "alice",
      controllerPlayerId: "alice",
      targetInstanceId: "alice-sakabato",
      modifierTag: "defense_immune",
      immunityPlayerScope: "any",
      duration: { scope: "while_in_trash" },
      createdAtTurn: 1,
      createdAtAttackId: null,
    };

    expect(() =>
      applyLegalAction({
        state: {
          ...queued,
          activeContinuousEffects: [immunity],
        },
        action: {
          kind: "swap_hand_trash",
          actionId: "test:bsrk01-r03-incoming-immune",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
          pendingId: queued.pendingHandTrashSwapChoice!.pendingId,
          sourceInstanceId: "r03-source",
          sourceCardNo: "BSRK01-R03",
          outgoingCardInstanceId: "alice-outgoing",
          outgoingCardNo: handCardDef.cardNo,
          incomingCardInstanceId: "alice-sakabato",
          incomingCardNo: sakabatoDef.cardNo,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      })
    ).toThrow(/incoming blocked by resistance/);
  });

  it("BSRK01-R03 effects[1]: 全 incoming 候補が immunity ならフラッシュ起動を列挙しない", () => {
    const listFlashActions = (state: GameState) =>
      getAvailableFieldCardEffectLegalActions(
        {
          state,
          actingPlayerId: "alice",
          getCardDefinitionById: getR03Def,
          getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([c]),
          getRegisteredTriggeredEffectActions: () => [],
        },
        "flash"
      );

    expect(
      listFlashActions(buildSwapState()).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceCardNo === "BSRK01-R03"
      )
    ).toBe(true);

    const blockedIncomingIds = [
      "alice-sakabato",
      "alice-cost8-kenshin",
      "alice-derived-sakabato",
    ];
    const blockedState: GameState = {
      ...buildSwapState(),
      activeContinuousEffects: blockedIncomingIds.map(
        (targetInstanceId, index): ContinuousEffect => ({
          effectId: `test-bsrk01-r03-all-trash-immune-${index}`,
          sourceInstanceId: `test-immunity-source-${index}`,
          sourceDefinitionId: "TEST-IMMUNITY",
          actingPlayerId: "alice",
          controllerPlayerId: "alice",
          targetInstanceId,
          modifierTag: "defense_immune",
          immunityPlayerScope: "any",
          duration: { scope: "while_in_trash" },
          createdAtTurn: 1,
          createdAtAttackId: null,
        })
      ),
    };

    expect(
      listFlashActions(blockedState).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceCardNo === "BSRK01-R03"
      )
    ).toBe(false);
  });

  it('queue_hand_trash_swap: cardName:"self" は物理 host ではなく効果テキスト元の名前で incoming を絞る', () => {
    const hostDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-HOST"),
      name: "物理ホスト",
    };
    const effectSourceDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-EFFECT-SOURCE"),
      name: "借用テキスト",
    };
    const outgoingDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-OUTGOING"),
      name: "出す手札",
    };
    const hostNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-HOST-NAME"),
      name: hostDef.name,
    };
    const effectNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-EFFECT-NAME"),
      name: effectSourceDef.name,
    };
    const defs = new Map(
      [
        hostDef,
        effectSourceDef,
        outgoingDef,
        hostNamedTrashDef,
        effectNamedTrashDef,
      ].map((definition) => [definition.cardNo, definition])
    );
    const getLocalDef = (id: string): CardDefinition | undefined =>
      defs.get(id);
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "queue_hand_trash_swap",
            outgoingFilter: {},
            outgoingZones: ["hand"],
            incomingFilter: { cardName: "self" },
          },
        },
      ],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(effectSourceDef, {
          instanceId: "effect-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          attachedToInstanceId: "host-source",
        }),
        createCardInstance(outgoingDef, {
          instanceId: "alice-outgoing",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostNamedTrashDef, {
          instanceId: "host-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(effectNamedTrashDef, {
          instanceId: "effect-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    });

    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1706",
      state,
      effect,
      sourceInstanceId: "host-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getLocalDef,
      getRegisteredTriggeredEffectActions: () => [],
      effectSourceInstanceId: "effect-source",
      effectSourceDefinitionId: effectSourceDef.cardNo,
    });

    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["effect-name-trash"]);
  });

  it('borrow_card_event_effect 経路の queue_hand_trash_swap でも cardName:"self" は借用元名で incoming を絞る', () => {
    const hostDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-HOST"),
      name: "借用ホスト",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "borrow_card_event_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    hasCardEventEffect: ["summon"],
                  },
                  count: 1,
                },
                borrowEvents: ["summon"],
              },
            },
          ],
        },
      ],
    };
    const donorDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-DONOR"),
      name: "借用ドナー",
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "トラッシュにあるこのカード1枚を手札と入れ替えられる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [
            {
              action: {
                kind: "queue_hand_trash_swap",
                outgoingFilter: {},
                outgoingZones: ["hand"],
                incomingFilter: { cardName: "self" },
              },
            },
          ],
        },
      ],
    };
    const outgoingDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-OUTGOING"),
      name: "出す手札",
    };
    const hostNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-HOST-NAME"),
      name: hostDef.name,
    };
    const donorNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-DONOR-NAME"),
      name: donorDef.name,
    };
    const defs = new Map(
      [
        hostDef,
        donorDef,
        outgoingDef,
        hostNamedTrashDef,
        donorNamedTrashDef,
      ].map((definition) => [definition.cardNo, definition])
    );
    const getLocalDef = (id: string): CardDefinition | undefined =>
      defs.get(id);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "borrow-host-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(donorDef, {
          instanceId: "borrow-donor-source",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(outgoingDef, {
          instanceId: "borrow-alice-outgoing",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostNamedTrashDef, {
          instanceId: "borrow-host-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(donorNamedTrashDef, {
          instanceId: "borrow-donor-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    });

    const queued = executeEffect({
      chainId: "test:bsrk01-cards:1831",
      state,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "borrow-host-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getLocalDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["borrow-donor-source"],
    });

    expect(queued.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      queued.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["borrow-donor-name-trash"]);
  });

  it('borrow_card_event_effect の対象選択 resume 後も cardName:"self" は借用元名で incoming を絞る', () => {
    const hostDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-HOST"),
      name: "借用resumeホスト",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "borrow_card_event_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    hasCardEventEffect: ["summon"],
                  },
                  count: 1,
                },
                borrowEvents: ["summon"],
              },
            },
          ],
        },
      ],
    };
    const donorDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-DONOR"),
      name: "借用resumeドナー",
      textLines: [
        "Lv1『このスピリットの召喚時』",
        "相手のスピリット1体を疲労させる。その後、トラッシュにあるこのカード1枚を手札と入れ替えられる。",
      ],
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [
            {
              id: "select_first",
              targetSelectionTiming: "on_step",
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
            {
              action: {
                kind: "queue_hand_trash_swap",
                outgoingFilter: {},
                outgoingZones: ["hand"],
                incomingFilter: { cardName: "self" },
              },
            },
          ],
        },
      ],
    };
    const outgoingDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-OUTGOING"),
      name: "出す手札",
    };
    const enemyDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-ENEMY"),
      name: "対象スピリット",
    };
    const hostNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-HOST-NAME"),
      name: hostDef.name,
    };
    const donorNamedTrashDef: CardDefinition = {
      ...makeTestSpirit("TEST-BSRK01-R03-BORROW-RESUME-DONOR-NAME"),
      name: donorDef.name,
    };
    const defs = new Map(
      [
        hostDef,
        donorDef,
        outgoingDef,
        enemyDef,
        hostNamedTrashDef,
        donorNamedTrashDef,
      ].map((definition) => [definition.cardNo, definition])
    );
    const getLocalDef = (id: string): CardDefinition | undefined =>
      defs.get(id);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "borrow-resume-host-source",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(donorDef, {
          instanceId: "borrow-resume-donor-source",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemyDef, {
          instanceId: "borrow-resume-enemy",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "recovered",
        }),
        createCardInstance(outgoingDef, {
          instanceId: "borrow-resume-alice-outgoing",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostNamedTrashDef, {
          instanceId: "borrow-resume-host-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(donorNamedTrashDef, {
          instanceId: "borrow-resume-donor-name-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    });
    const pendingState = executeEffect({
      chainId: "test:bsrk01-cards:1981",
      state,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "borrow-resume-host-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getLocalDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["borrow-resume-donor-source"],
    });
    const pending = pendingState.pendingBorrowedEffectTargetSelection;

    expect(pending).toMatchObject({
      effectSourceInstanceId: "borrow-resume-donor-source",
      effectSourceDefinitionId: donorDef.cardNo,
    });

    const resumed = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_borrowed_effect_target",
        actingPlayerId: "alice",
        pendingId: pending!.pendingId,
      },
      targetInstanceIds: ["borrow-resume-enemy"],
      getCardDefinitionById: getLocalDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(resumed.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      resumed.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["borrow-resume-donor-name-trash"]);
  });
});

describe("BSRK01-C02 神谷 薫", () => {
  const c = card("BSRK01-C02");
  it("配置時: デッキ上2枚を見て1枚を手札→残りデッキ下(deck_reveal) + 相手ターン課税(require_hand_gain_cost) + 耐性は配線済み", () => {
    const place = c.effects![0]!;
    expect(place.timing).toEqual({ kind: "card_event", event: "place" });
    expect(place.executionMode).toBe("optional");
    expect(place.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const reveal = place.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(2);
      expect(reveal.picks).toEqual([{ count: 1 }]);
      expect(reveal.remainder).toBe("bottom");
    }
    // 相手手札増加への課税 (require_hand_gain_cost、詳細は
    // bsrk01-c02-hand-gain-cost-gate.test.ts で検証)。
    expect(c.effects![1]!.stub).toBeUndefined();
    expect(c.effects![1]!.timingScope).toEqual({
      player: "opponent",
      period: "turn",
    });
    expect(c.effects![1]!.steps).toHaveLength(1);
    expect(c.effects![1]!.steps[0]!.action).toEqual({
      kind: "require_hand_gain_cost",
      player: "opponent",
      costAmount: 1,
      duration: { scope: "while_on_field" },
    });

    // Lv2 手札5枚以下＆「剣心」がいれば、このネクサスと自分の手札は相手の効果を受けない。
    const lv2 = c.effects![2]!;
    expect(lv2.stub).toBeUndefined();
    expect(lv2.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "hand_count", player: "self", max: 5 },
      { kind: "field_has", player: "self", cardNames: [{ contains: "剣心" }] },
    ]);
    expect(lv2.steps).toHaveLength(2);
    expect(lv2.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "while_on_field" },
    });
    expect(lv2.steps[1]!.connector).toBe("simultaneous");
    expect(lv2.steps[1]!.action).toEqual({
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
  });

  it("Lv2 + 手札5枚以下 + 「剣心」在場: ネクサス自身と手札が相手起因効果に免疫成立", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 5 }, {}],
    });
    const self = createCardInstance(c, {
      instanceId: "kaoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 (requiredCores:1)
    });
    const kenshin = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "kenshin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(c, {
      instanceId: "alice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self, kenshin, handCard],
    };
    const lv2 = c.effects![2]!;
    const next = executeEffect({
      chainId: "test:bsrk01-cards:2106",
      state,
      effect: lv2,
      sourceInstanceId: "kaoru-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const selfCard = next.cardInstances.find(
      (ci) => ci.instanceId === "kaoru-1"
    )!;
    const hand = next.cardInstances.find(
      (ci) => ci.instanceId === "alice-hand-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        next,
        selfCard,
        "bob",
        "none",
        undefined,
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(next, hand, "bob", "none", undefined, getDef)
    ).toBe(true);
  });

  it("「剣心」不在なら免疫は登録されない", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 5 }, {}],
    });
    const self = createCardInstance(c, {
      instanceId: "kaoru-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const handCard = createCardInstance(c, {
      instanceId: "alice-hand-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...base,
      cardInstances: [self, handCard],
    };
    const lv2 = c.effects![2]!;
    const next = executeEffect({
      chainId: "test:bsrk01-cards:2157",
      state,
      effect: lv2,
      sourceInstanceId: "kaoru-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const hand = next.cardInstances.find(
      (ci) => ci.instanceId === "alice-hand-2"
    )!;
    expect(
      isCardImmuneToOpponentEffect(next, hand, "bob", "none", undefined, getDef)
    ).toBe(false);
  });
});

describe("BSRK01-C03 飛天御剣流『双龍閃』", () => {
  it("破壊から派生した不殺を解決してから、効果発揮後のバウンスへ進む", () => {
    const victim = makeTestSpirit("TEST-C03-VICTIM");
    const survivor: CardDefinition = {
      ...makeTestSpirit("TEST-C03-SURVIVOR"),
      printedCategory: "ultimate",
    };
    const defs = [...ALL_CARDS, victim, survivor];
    const lookups = {
      getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredMagicActions: buildMagicLookup(defs),
    };
    const instance = (definition: CardDefinition, id: string, player: string) =>
      createCardInstance(definition, {
        instanceId: id,
        ownerPlayerId: player,
        controllerPlayerId: player,
        zone: "field",
        normalCoreCount: 1,
      });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance(card("BSRK01-CX01"), "kenshin", "alice"),
          { ...instance(card("BSRK01-C03"), "magic", "alice"), zone: "hand" },
          instance(victim, "victim", "bob"),
          instance(survivor, "survivor", "bob"),
        ],
      }),
      step: "attack",
      turnNumber: 2,
    };
    let current = executeEffect({
      chainId: "test:bsrk01-cards:2208",
      state,
      effect: card("BSRK01-C03").effects![2]!,
      sourceInstanceId: "magic",
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      current.cardInstances.find((c) => c.instanceId === "survivor")?.zone
    ).toBe("field");
    expect(
      current.pendingTriggeredEffects.some((p) => p.eventKind === "destroy")
    ).toBe(true);
    expect(current.pendingEffectTargetSelection).toBeNull();
    const trigger = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "kenshin"
    );
    expect(trigger).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: trigger!,
      ...lookups,
    }).state;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      ...lookups,
    }).state;
    expect(
      current.cardInstances.find((c) => c.instanceId === "victim")?.zone
    ).toBe("deck");
    expect(
      current.cardInstances.find((c) => c.instanceId === "survivor")?.zone
    ).toBe("hand");
  });
  const c = card("BSRK01-C03");
  it("スタック: BP15000以下の相手スピリット1体破壊→相手スピ/アル1体を手札に戻す + メインは draw3+deck_bottom", () => {
    const modeReduction = c.effects![0]!;
    expect(modeReduction.stub).toBeUndefined();
    expect(modeReduction.textRef).toEqual([0]);
    expect(modeReduction.steps[0]!.action).toEqual({
      kind: "treat_as",
      appliesToCard: true,
      cardStateOnly: true,
      aspects: ["reduction_symbol"],
      asColor: "red",
      whenUsingEffectMode: "main",
      addsReductionSymbol: true,
    });

    // メイン: 3ドロー後、手札5枚以下になるよう内容を見せずデッキの下へ戻す。
    const main = c.effects![1]!;
    expect(main.timing).toEqual({ kind: "activated", mode: "main" });
    expect(main.steps[0]!.action).toEqual({ kind: "draw", count: 3 });
    expect(main.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: -1,
      targetHandSize: 5,
      destination: "deck_bottom",
    });

    const stack = c.effects![2]!;
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    expect(stack.stub).toBeUndefined();
    expect(stack.condition).toContainEqual({
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "剣心" }],
      includeSoulState: true,
    });
    const destroy = stack.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (destroy.kind === "destroy") {
      expect(destroy.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"], maxBp: 15000 },
        count: 1,
      });
    }
    const bounce = stack.steps[1]!.action;
    expect(bounce.kind).toBe("bounce");
    if (bounce.kind === "bounce") {
      expect(bounce.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
    }
  });

  it("メイン効果の支払い時だけ赤軽減シンボルが追加される", () => {
    const redSupplier = card("BSRK01-C04");
    const whiteSupplier = card("BSRK01-C02");
    const magic = createCardInstance(c, {
      instanceId: "c03-hand",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const redFields = [0, 1].map((i) =>
      createCardInstance(redSupplier, {
        instanceId: `red-field-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const whiteField = createCardInstance(whiteSupplier, {
      instanceId: "white-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magic, ...redFields, whiteField],
    });
    const base = {
      state,
      actingPlayerId: "alice",
      card: c,
      sourceInstanceId: magic.instanceId,
      getCardDefinitionById: (id: string) => cardNoMap.get(id),
    };

    const mainReduction = calculateReduction({ ...base, effectMode: "main" });
    expect(mainReduction.totalReduction).toBe(3);
    expect(mainReduction.satisfiedReductionSymbolCount).toBe(3);
    expect(mainReduction.requiredReductionSymbolCount).toBe(3);
    expect(
      calculateReduction({ ...base, effectMode: "stack" }).totalReduction
    ).toBe(2);
    expect(calculateReduction(base).totalReduction).toBe(2);

    expect(
      matchesCardFilter(
        c,
        c,
        { reductionSymbolsSatisfied: "all" },
        {
          satisfiedReductionSymbolCount: 2,
          requiredReductionSymbolCount: 3,
        }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        c,
        c,
        { reductionSymbolsSatisfied: "all" },
        {
          satisfiedReductionSymbolCount: 3,
          requiredReductionSymbolCount: 3,
        }
      )
    ).toBe(true);
  });
});

describe("BSRK01-C04 [黒笠編]緋村 剣心", () => {
  const c = card("BSRK01-C04");
  type C04NoKillSourceMode = "field" | "soul_state" | "advent_source";
  type PendingResolveAction = Extract<
    ReturnType<typeof getLegalActions>[number],
    { kind: "resolve_pending_triggered_effect" }
  >;

  function runBattosaiSuppressionScenario(options: {
    sourceMode?: C04NoKillSourceMode;
    includeKaoru: boolean;
    countValue?: number;
  }): {
    stateBeforeDestroy: GameState;
    afterDestroy: GameState;
    resolveActions: PendingResolveAction[];
    fixtureGetDef: (definitionId: string) => CardDefinition | undefined;
    triggeredLookup: ReturnType<typeof buildTriggeredEffectLookup>;
    burstLookup: ReturnType<typeof buildBurstEffectLookup>;
  } {
    const victimFixture: CardDefinition = {
      ...makeTestSpirit("BSRK01-C04-VICTIM"),
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    };
    const destroyFixture: CardDefinition = {
      ...makeTestSpirit("BSRK01-C04-DESTROY-SOURCE"),
      cardNo: "BSRK01-C04-DESTROY-SOURCE",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "c04-test-destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const defs = [...ALL_CARDS, victimFixture, destroyFixture];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const fixtureGetDef = (definitionId: string): CardDefinition | undefined =>
      defMap.get(definitionId);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const burstLookup = buildBurstEffectLookup(defs);
    const sourceMode = options.sourceMode ?? "field";
    const c04 = createCardInstance(c, {
      instanceId: "alice-c04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const cx01 = createCardInstance(card("BSRK01-CX01"), {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: sourceMode === "advent_source" ? 0 : 1,
      attachedToInstanceId: sourceMode === "advent_source" ? "alice-c04" : null,
    });
    if (sourceMode === "advent_source") {
      c04.underCards = [
        { cardInstanceId: "alice-cx01", role: "advent_source" },
      ];
    }
    const kaoru = createCardInstance(card("BSRK01-C02"), {
      instanceId: "alice-kaoru",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const destroySource = createCardInstance(destroyFixture, {
      instanceId: "alice-destroy-source-c04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const victim = createCardInstance(victimFixture, {
      instanceId: "bob-victim-c04",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const deckTail = createCardInstance(card("BSRK01-C07"), {
      instanceId: "bob-deck-tail-c04",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const aliceOverride =
      sourceMode === "soul_state"
        ? {
            countValue: options.countValue ?? 0,
            deckCount: 0,
            soulStateInstanceIds: ["alice-cx01"],
            contractCardNo: "BSRK01-CX01",
          }
        : { countValue: options.countValue ?? 0, deckCount: 0 };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        c04,
        cx01,
        ...(options.includeKaoru ? [kaoru] : []),
        destroySource,
        victim,
        deckTail,
      ],
      playerOverrides: [aliceOverride, { deckCount: 1 }],
    });
    const stateBeforeDestroy = rebuildContinuousEffectsFromField(
      { ...base, activePlayerId: "alice", step: "main" },
      fixtureGetDef
    );
    const destroyStack: ActiveStack = {
      stackId: "c04-test-destroy-stack",
      actionKind: "field_card_effect",
      chainId: "c04-test-destroy-chain",
      actingPlayerId: "alice",
      cardInstanceId: "alice-destroy-source-c04",
      cardDefinitionId: destroyFixture.cardNo,
      targetInstanceIds: ["bob-victim-c04"],
      targetStepId: "c04-test-destroy",
      targetEffectFilterTags: [],
      targetSelectionResolved: true,
      fieldEffectSourceKind: "spirit",
    };
    const afterDestroy = resolveStackCascade(
      stateBeforeDestroy,
      [destroyStack],
      {
        getCardDefinitionById: fixtureGetDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );
    const resolveActions = getLegalActions({
      state: afterDestroy,
      actingPlayerId: "alice",
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredBurstActions: burstLookup,
    }).filter(
      (action): action is PendingResolveAction =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );

    return {
      stateBeforeDestroy,
      afterDestroy,
      resolveActions,
      fixtureGetDef,
      triggeredLookup,
      burstLookup,
    };
  }

  function getSuppressionHeadings(state: GameState): Array<string | undefined> {
    return state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "effect_suppression")
      .map(
        (ce) =>
          (ce.metadata as { effectFilter?: { heading?: string } } | undefined)
            ?.effectFilter?.heading
      );
  }

  it("契約煌臨宣言は adventData へ移行 (contract / own_turn / spirit)", () => {
    // 契約煌臨宣言の activated/flash stub は削除され declare_advent 経路に移行。
    expect(c.adventData).toBeDefined();
    const ad = c.adventData!;
    expect(ad.adventVariant).toBe("contract");
    expect(ad.adventTiming).toBe("own_turn");
    expect(ad.soulCoreDest).toBe("trash");
    expect(ad.adventCondition.targetCategory).toEqual(["spirit"]);
    // 煌臨先「緋村 剣心」(カード名一致) は AdventCondition に cardName が無いため
    // minCost は印字されず未設定 (TODO P3-89)。
    expect(ad.adventCondition.minCost).toBeUndefined();
  });

  it("煌臨時: ボイドからコア2個を自分のリザーブへ(core_move) + 名称付き効果抑止を suppress_effect で表す", () => {
    // 宣言 stub 削除後、effects[0] が『煌臨時』(card_event:advent) になる。
    const advent = c.effects![0]!;
    expect(advent.timing).toEqual({ kind: "card_event", event: "advent" });
    expect(advent.executionMode).toBe("optional");
    const move = advent.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "void", player: "self" });
      expect(move.to).toEqual({ kind: "reserve", player: "self" });
      expect(move.amount).toBe(2);
    }
    const noKaoru = c.effects![1]!;
    expect(noKaoru.stub).toBeUndefined();
    expect(noKaoru.heading).toBe("回帰の抜刀斎");
    expect(noKaoru.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(noKaoru.timing).toEqual({ kind: "continuous" });
    expect(noKaoru.condition).toEqual([
      {
        kind: "field_lacks",
        player: "self",
        cardNames: [{ contains: "薫" }],
      },
    ]);
    expect(noKaoru.steps[0]!.action).toEqual({
      kind: "suppress_effect",
      target: {
        kind: "filter",
        player: "self",
        zone: "field",
        filter: {
          soulState: "include",
          adventSourceScope: "include",
        },
        count: "all",
      },
      effectFilter: { heading: "不殺のるろうに" },
      duration: { scope: "while_on_field" },
    });
    expect(noKaoru.textRef).toEqual([6, 7]);

    const oc = c.effects![2]!;
    expect(oc.stub).toBeUndefined();
    expect(oc.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(oc.timing).toEqual({ kind: "continuous" });
    expect(oc.condition).toEqual([
      { kind: "count_value", player: "self", min: 6 },
    ]);
    expect(oc.steps[0]!.action).toEqual({
      kind: "suppress_effect",
      target: {
        kind: "filter",
        player: "self",
        zone: "field",
        filter: {},
        count: "all",
      },
      effectFilter: { heading: "回帰の抜刀斎" },
      duration: { scope: "while_on_field" },
    });
    expect(oc.textRef).toEqual([9, 10]);
  });

  it.each(["field", "soul_state", "advent_source"] as const)(
    "薫がいない間: %s の自分の【不殺のるろうに】誘発を production 経路で抑止する",
    (sourceMode) => {
      const { stateBeforeDestroy, afterDestroy, resolveActions } =
        runBattosaiSuppressionScenario({
          sourceMode,
          includeKaoru: false,
        });

      expect(getSuppressionHeadings(stateBeforeDestroy)).toContain(
        "不殺のるろうに"
      );
      expect(
        afterDestroy.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "bob-victim-c04"
        )
      ).toMatchObject({ zone: "trash", pendingLeaveKind: null });
      expect(resolveActions).toHaveLength(0);

      expect(
        afterDestroy.cardInstances
          .filter(
            (cardInstance) =>
              cardInstance.ownerPlayerId === "bob" &&
              cardInstance.zone === "deck"
          )
          .map((cardInstance) => cardInstance.instanceId)
      ).toEqual(["bob-deck-tail-c04"]);
    }
  );

  it("薫がいる間: 自分の【不殺のるろうに】誘発は抑止されずデッキ下へ戻す", () => {
    const {
      stateBeforeDestroy,
      afterDestroy,
      resolveActions,
      fixtureGetDef,
      triggeredLookup,
      burstLookup,
    } = runBattosaiSuppressionScenario({ includeKaoru: true });

    expect(getSuppressionHeadings(stateBeforeDestroy)).not.toContain(
      "不殺のるろうに"
    );
    expect(resolveActions).toHaveLength(1);
    const declared = applyLegalAction({
      state: afterDestroy,
      action: resolveActions[0]!,
      getCardDefinitionById: fixtureGetDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: burstLookup,
    }).state;
    const triggeredStack = declared.stackWindow
      ?.pendingStackAction as ActiveStack;
    const final = resolveStackCascade(
      { ...declared, stackWindow: null, pendingStackCascade: null },
      [triggeredStack],
      {
        getCardDefinitionById: fixtureGetDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: burstLookup,
      }
    );

    expect(
      final.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-victim-c04"
      )
    ).toMatchObject({ zone: "deck", pendingLeaveKind: null });
    expect(
      final.cardInstances
        .filter(
          (cardInstance) =>
            cardInstance.ownerPlayerId === "bob" && cardInstance.zone === "deck"
        )
        .map((cardInstance) => cardInstance.instanceId)
    ).toEqual(["bob-deck-tail-c04", "bob-victim-c04"]);
  });

  it("OC中: 【回帰の抜刀斎】自身が抑止され、薫不在でも【不殺のるろうに】誘発は残る", () => {
    const { stateBeforeDestroy, resolveActions } =
      runBattosaiSuppressionScenario({
        includeKaoru: false,
        countValue: 6,
      });

    const headings = getSuppressionHeadings(stateBeforeDestroy);
    expect(headings).toContain("回帰の抜刀斎");
    expect(headings).not.toContain("不殺のるろうに");
    expect(resolveActions).toHaveLength(1);
  });
});

describe("BSRK01-CX01 緋村 剣心", () => {
  const c = card("BSRK01-CX01");

  function makeHitenTestMagic(): CardDefinition {
    return {
      cardNo: "TEST-HITEN-MAGIC",
      name: "飛天御剣流『検証』",
      printedCategory: "magic",
      colors: ["red"],
      cost: 2,
      reductionSymbols: ["red", "white"],
      levelDefs: [],
      symbolColors: [],
      textLines: ["メイン：自分はデッキから1枚ドローする。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        },
      ],
    };
  }

  function passStackUntilClosed(options: {
    state: GameState;
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredMagicActions: ReturnType<typeof buildMagicLookup>;
    getRegisteredFieldCardEffectActions: ReturnType<
      typeof buildFieldCardEffectLookup
    >;
    getRegisteredTriggeredEffectActions: ReturnType<
      typeof buildTriggeredEffectLookup
    >;
    getRegisteredBurstActions: ReturnType<typeof buildBurstEffectLookup>;
  }): GameState {
    let current = options.state;
    for (let guard = 0; guard < 6 && current.stackWindow; guard++) {
      const actingPlayerId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredMagicActions: options.getRegisteredMagicActions,
        getRegisteredFieldCardEffectActions:
          options.getRegisteredFieldCardEffectActions,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredMagicActions: options.getRegisteredMagicActions,
        getRegisteredFieldCardEffectActions:
          options.getRegisteredFieldCardEffectActions,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }).state;
    }
    expect(current.stackWindow).toBeNull();
    return current;
  }

  function runHitenMagicScenario(options: {
    includeWhiteReductionSource: boolean;
    sourceMode?: "field" | "soul_state" | "advent_source";
    preventCostReduction?: boolean;
    suppressCx01?: boolean;
    magicCost?: number;
    magicReductionSymbols?: CardDefinition["reductionSymbols"];
  }): {
    stateBeforeUse: GameState;
    declared: GameState;
    afterMagic: GameState;
    actionTotalReduction: number;
    lookups: {
      getCardDefinitionById: (
        definitionId: string
      ) => CardDefinition | undefined;
      getRegisteredMagicActions: ReturnType<typeof buildMagicLookup>;
      getRegisteredFieldCardEffectActions: ReturnType<
        typeof buildFieldCardEffectLookup
      >;
      getRegisteredTriggeredEffectActions: ReturnType<
        typeof buildTriggeredEffectLookup
      >;
      getRegisteredBurstActions: ReturnType<typeof buildBurstEffectLookup>;
    };
  } {
    const sourceMode = options.sourceMode ?? "field";
    const hitenMagic: CardDefinition = {
      ...makeHitenTestMagic(),
      ...(options.magicCost !== undefined ? { cost: options.magicCost } : {}),
      ...(options.magicReductionSymbols !== undefined
        ? { reductionSymbols: [...options.magicReductionSymbols] }
        : {}),
    };
    const whiteSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-WHITE-SYMBOL"),
      colors: ["white"],
      symbolColors: ["white"],
    };
    const redSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-RED-SYMBOL"),
      colors: ["red"],
      symbolColors: ["red"],
    };
    const preventReductionSource: CardDefinition = {
      ...makeTestSpirit("TEST-PREVENT-HITEN-REDUCTION"),
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "prevent_cost_reduction",
                player: "opponent",
                filter: {
                  category: ["magic"],
                  cardName: { contains: "飛天御剣流" },
                },
                restrictedKinds: ["magic"],
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const suppressCx01Source: CardDefinition = {
      ...makeTestSpirit("TEST-SUPPRESS-CX01-HITEN"),
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "suppress_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {},
                  count: "all",
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const defs = [
      ...ALL_CARDS,
      hitenMagic,
      whiteSymbolSource,
      redSymbolSource,
      preventReductionSource,
      suppressCx01Source,
    ];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const lookups = {
      getCardDefinitionById: (definitionId: string) => defMap.get(definitionId),
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: sourceMode === "field" ? 1 : 0,
      attachedToInstanceId:
        sourceMode === "advent_source" ? "alice-advent-host" : null,
    });
    const adventHost = createCardInstance(card("BSRK01-C04"), {
      instanceId: "alice-advent-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    adventHost.underCards =
      sourceMode === "advent_source"
        ? [{ cardInstanceId: cx01.instanceId, role: "advent_source" }]
        : [];
    const magic = createCardInstance(hitenMagic, {
      instanceId: "alice-hiten-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckCard = createCardInstance(card("BSRK01-C07"), {
      instanceId: "alice-deck-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const whiteSource = createCardInstance(whiteSymbolSource, {
      instanceId: "alice-white-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const redSource = createCardInstance(redSymbolSource, {
      instanceId: "alice-red-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const preventSource = createCardInstance(preventReductionSource, {
      instanceId: "bob-prevent-hiten-reduction",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const suppressSource = createCardInstance(suppressCx01Source, {
      instanceId: "bob-suppress-cx01",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: options.includeWhiteReductionSource
        ? [
            ...(sourceMode === "advent_source" ? [adventHost] : []),
            cx01,
            ...(sourceMode === "field" ? [] : [redSource]),
            whiteSource,
            magic,
            deckCard,
            ...(options.preventCostReduction ? [preventSource] : []),
            ...(options.suppressCx01 ? [suppressSource] : []),
          ]
        : [
            ...(sourceMode === "advent_source" ? [adventHost] : []),
            cx01,
            ...(sourceMode === "field" ? [] : [redSource]),
            magic,
            deckCard,
            ...(options.preventCostReduction ? [preventSource] : []),
            ...(options.suppressCx01 ? [suppressSource] : []),
          ],
      playerOverrides: [
        {
          reserveNormalCoreCount:
            options.preventCostReduction || options.suppressCx01 ? 2 : 1,
          deckCount: 1,
          handCount: 1,
          ...(sourceMode === "soul_state"
            ? {
                contractCardNo: "BSRK01-CX01",
                soulStateInstanceIds: [cx01.instanceId],
              }
            : {}),
        },
        {},
      ],
    });
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    if (options.preventCostReduction || options.suppressCx01) {
      state = rebuildContinuousEffectsFromField(
        state,
        lookups.getCardDefinitionById
      );
    }
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "alice-hiten-magic"
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") {
      throw new Error("use_magic not found");
    }
    const declared = applyLegalAction({
      state,
      action: useMagic,
      paymentSources:
        useMagic.finalCost > 0
          ? [{ kind: "reserve", amount: useMagic.finalCost }]
          : [],
      ...lookups,
    }).state;
    const afterMagic = passStackUntilClosed({
      state: declared,
      ...lookups,
    });
    return {
      stateBeforeUse: state,
      declared,
      afterMagic,
      actionTotalReduction: useMagic.totalReduction,
      lookups,
    };
  }

  it("シンボルは白としても扱い、シンボル数を増やさない", () => {
    const symbolEff = c.effects!.find(
      (effect) =>
        effect.steps[0]?.action.kind === "treat_as" &&
        effect.steps[0].action.aspects?.includes("symbol")
    )!;
    expect(symbolEff.steps[0]!.action).toEqual({
      kind: "treat_as",
      aspects: ["symbol"],
      asColor: "white",
    });
    expect(symbolEff.stub).toBeUndefined();
    const hitenReductionEffects = c.effects!.filter(
      (effect) =>
        effect.steps[0]?.action.kind === "treat_as" &&
        effect.steps[0]?.action.waivesReductionRequirement === "all"
    );
    expect(hitenReductionEffects).toHaveLength(2);
    expect(hitenReductionEffects.map((effect) => effect.applicability)).toEqual(
      [
        {
          zone: "field",
          level: { min: 1, max: 2 },
          soulState: false,
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        {
          zone: ["soul_state", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
      ]
    );
    for (const hitenReduction of hitenReductionEffects) {
      expect(hitenReduction.stub).toBeUndefined();
      expect(hitenReduction.timing).toEqual({ kind: "continuous" });
      expect(hitenReduction.usageLimit).toEqual({ kind: "no_duplicate" });
      expect(hitenReduction.limitGroupId).toBe(
        "BSRK01-CX01-hiten-magic-reduction"
      );
      expect(hitenReduction.steps[0]!.action).toEqual({
        kind: "treat_as",
        aspects: ["reduction_symbol"],
        whenPayingForFilter: {
          category: ["magic"],
          cardName: { contains: "飛天御剣流" },
        },
        waivesReductionRequirement: "all",
      });
    }
    const hitenCounts = c.effects!.filter(
      (effect) => effect.steps[0]?.action.kind === "count_increase"
    );
    expect(hitenCounts).toHaveLength(2);
    expect(hitenCounts.map((effect) => effect.applicability)).toEqual([
      {
        zone: "field",
        level: { min: 1, max: 2 },
        soulState: false,
        adventSourceHostVariants: ["contract", "f_contract"],
      },
      {
        zone: ["soul_state", "advent_source"],
        adventSourceHostVariants: ["contract", "f_contract"],
      },
    ]);
    for (const hitenCount of hitenCounts) {
      expect(hitenCount.stub).toBeUndefined();
      expect(hitenCount.timing).toEqual({
        kind: "game_event",
        event: "effect_completed",
        player: "self",
        latchSourceAtEffectActivationStart: true,
        triggerFilter: {
          category: ["magic"],
          cardName: { contains: "飛天御剣流" },
          reductionSymbolsSatisfied: "all",
        },
      });
      expect(hitenCount.usageLimit).toEqual({ kind: "no_duplicate" });
      expect(hitenCount.limitGroupId).toBe("BSRK01-CX01-hiten-magic-count");
      expect(hitenCount.steps[0]!.action).toEqual({
        kind: "count_increase",
        player: "self",
        amount: 2,
      });
    }
    // BSRK01-CX01[0] は契約煌臨の被煌臨側 intrinsic として engine 側で解消済み。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps).toHaveLength(0);
    // 【不殺のるろうに】破壊対象を pre-flush の related instance としてデッキ下へ送る。
    const rurouniEffects = c.effects!.filter((effect) =>
      effect.textRef?.every((line) => [2, 3].includes(line))
    );
    expect(rurouniEffects).toHaveLength(2);
    expect(rurouniEffects.map((effect) => effect.applicability)).toEqual([
      {
        zone: "field",
        level: { min: 1, max: 2 },
        soulState: false,
        adventSourceHostVariants: ["contract", "f_contract"],
      },
      {
        zone: ["soul_state", "advent_source"],
        adventSourceHostVariants: ["contract", "f_contract"],
      },
    ]);
    for (const effect of rurouniEffects) {
      expect(effect.timing).toMatchObject({
        kind: "game_event",
        event: "destroy",
        player: "opponent",
        cause: ["opponent_effect", "battle", "opponent_bp_compare"],
        sourceWhose: "either",
      });
      expect(effect.steps).toHaveLength(1);
      expect(effect.stub).toBeUndefined();
    }
  });

  it("Lv0 の CX01 は白シンボル化を登録しない", () => {
    const getCardDefinitionById = (definitionId: string) =>
      definitionId === c.cardNo ? c : cardNoMap.get(definitionId);
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01-lv0-symbol",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cx01],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.sourceInstanceId === cx01.instanceId
      )
    ).toHaveLength(0);
    expect(
      getEffectiveSymbols(
        rebuilt,
        rebuilt.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === cx01.instanceId
        )!,
        c,
        getCardDefinitionById
      )
    ).toEqual(["red"]);
  });

  it("効果抑止中の CX01 は白シンボル化を登録しない", () => {
    const suppressCx01Source: CardDefinition = {
      ...makeTestSpirit("TEST-SUPPRESS-CX01-SYMBOL"),
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "suppress_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {},
                  count: "all",
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const defs = [...ALL_CARDS, suppressCx01Source];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const getCardDefinitionById = (definitionId: string) =>
      defMap.get(definitionId);
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01-suppressed-symbol",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const suppressSource = createCardInstance(suppressCx01Source, {
      instanceId: "bob-suppress-cx01-symbol",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cx01, suppressSource],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: rebuilt,
        checkKind: "effect_suppression",
        sourceInstanceId: cx01.instanceId,
        targetInstanceIds: [],
        getCardDefinitionById,
      })
    ).toBe(false);
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.sourceInstanceId === cx01.instanceId
      )
    ).toHaveLength(0);
    expect(
      getEffectiveSymbols(
        rebuilt,
        rebuilt.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === cx01.instanceId
        )!,
        c,
        getCardDefinitionById
      )
    ).toEqual(["red"]);
  });

  it("飛天御剣流マジックの全軽減を満たして効果発揮後に場にいればカウント2する", () => {
    const { afterMagic, actionTotalReduction, lookups } = runHitenMagicScenario(
      { includeWhiteReductionSource: true }
    );
    expect(actionTotalReduction).toBe(2);
    expect(
      afterMagic.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "effect_completed" &&
          pending.relatedInstanceId === "alice-hiten-magic" &&
          pending.effectSourceTotalReduction === 2 &&
          pending.effectSourceSatisfiedReductionSymbolCount === 2 &&
          pending.effectSourceRequiredReductionSymbolCount === 2
      )
    ).toBe(true);
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeDefined();
    const declared = applyLegalAction({
      state: afterMagic,
      action: resolveAction!,
      ...lookups,
    }).state;
    const final = passStackUntilClosed({ state: declared, ...lookups });
    expect(
      final.players.find((player) => player.id === "alice")!.countValue
    ).toBe(2);
  });

  it("pending を挟む飛天御剣流マジックも全軽減後に CX01 がカウント2する", () => {
    const hitenMagic = card("BSRK01-C01");
    const whiteSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-WHITE-SYMBOL-PENDING-HITEN"),
      colors: ["white"],
      symbolColors: ["white"],
    };
    const redSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-RED-SYMBOL-PENDING-HITEN"),
      colors: ["red"],
      symbolColors: ["red"],
    };
    const defs = [...ALL_CARDS, whiteSymbolSource, redSymbolSource];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const lookups = {
      getCardDefinitionById: (definitionId: string) => defMap.get(definitionId),
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(hitenMagic, {
      instanceId: "alice-hiten-pending-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const whiteSource = createCardInstance(whiteSymbolSource, {
      instanceId: "alice-white-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const redSource = createCardInstance(redSymbolSource, {
      instanceId: "alice-red-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const deckCards = ["alice-deck-a", "alice-deck-b", "alice-deck-c"].map(
      (instanceId) =>
        createCardInstance(card("BSRK01-C07"), {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cx01, whiteSource, redSource, magic, ...deckCards],
        playerOverrides: [
          { reserveNormalCoreCount: 1, deckCount: 3, handCount: 1 },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === magic.instanceId
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") {
      throw new Error("use_magic not found");
    }
    expect(useMagic.totalReduction).toBe(2);
    expect(useMagic.finalCost).toBe(1);

    const declared = applyLegalAction({
      state,
      action: useMagic,
      paymentSources: [{ kind: "reserve", amount: useMagic.finalCost }],
      ...lookups,
    }).state;
    const afterStack = passStackUntilClosed({
      state: declared,
      ...lookups,
    });
    expect(afterStack.pendingDeckReveal).not.toBeNull();

    const pickAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterStack,
      action: pickAction!,
      selectedDeckRevealCardIds: ["alice-deck-a"],
      ...lookups,
    }).state;
    expect(afterPick.pendingDeckReveal?.phase).toBe("ordering_remainder");
    const orderAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected deck reveal order action");
    }
    const afterPending = applyLegalAction({
      state: afterPick,
      action: orderAction,
      deckRevealRemainderOrder: orderAction.remainingCardInstanceIds,
      deckRevealRemainderPlacements: Object.fromEntries(
        orderAction.remainingCardInstanceIds.map((id) => [id, "bottom"])
      ),
      ...lookups,
    }).state;

    const pending = afterPending.pendingTriggeredEffects.find(
      (current) =>
        current.eventKind === "effect_completed" &&
        current.relatedInstanceId === magic.instanceId
    );
    expect(pending).toMatchObject({
      effectSourceTotalReduction: 2,
      effectSourceSatisfiedReductionSymbolCount: 2,
      effectSourceRequiredReductionSymbolCount: 2,
      eligibleSourceInstanceIds: [cx01.instanceId],
    });
    const resolveAction = getLegalActions({
      state: afterPending,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeDefined();
    const declaredCount = applyLegalAction({
      state: afterPending,
      action: resolveAction!,
      ...lookups,
    }).state;
    const final = passStackUntilClosed({ state: declaredCount, ...lookups });
    expect(
      final.players.find((player) => player.id === "alice")!.countValue
    ).toBe(2);
  });

  it("飛天御剣流マジック使用開始ラッチはコスト支払い前の CX01 を記録する", () => {
    const hitenMagic: CardDefinition = {
      ...makeHitenTestMagic(),
      cardNo: "TEST-HITEN-MAGIC-COST3",
      cost: 3,
    };
    const whiteSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-WHITE-SYMBOL-PRE-PAYMENT-HITEN"),
      colors: ["white"],
      symbolColors: ["white"],
    };
    const redSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-RED-SYMBOL-PRE-PAYMENT-HITEN"),
      colors: ["red"],
      symbolColors: ["red"],
    };
    const defs = [...ALL_CARDS, hitenMagic, whiteSymbolSource, redSymbolSource];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const lookups = {
      getCardDefinitionById: (definitionId: string) => defMap.get(definitionId),
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01-pre-payment",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(hitenMagic, {
      instanceId: "alice-hiten-pre-payment-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const whiteSource = createCardInstance(whiteSymbolSource, {
      instanceId: "alice-white-source-pre-payment",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const redSource = createCardInstance(redSymbolSource, {
      instanceId: "alice-red-source-pre-payment",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [cx01, whiteSource, redSource, magic],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === magic.instanceId
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") {
      throw new Error("use_magic not found");
    }
    expect(useMagic.totalReduction).toBe(2);
    expect(useMagic.finalCost).toBe(1);

    const declared = applyLegalAction({
      state,
      action: useMagic,
      paymentSources: [
        { kind: "card", instanceId: cx01.instanceId, amount: 1 },
      ],
      ...lookups,
    }).state;
    expect(
      declared.cardInstances.find((card) => card.instanceId === cx01.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      declared.stackWindow?.pendingStackAction
        ?.eligibleSourceInstanceIdsAtEffectActivationStart
    ).toEqual([cx01.instanceId]);
  });

  it("飛天御剣流マジック使用開始時にいない CX01 は効果中に出てもカウントしない", () => {
    const hitenMagic = makeHitenTestMagic();
    const defs = [...ALL_CARDS, hitenMagic];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const lookups = {
      getCardDefinitionById: (definitionId: string) => defMap.get(definitionId),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const magic = createCardInstance(hitenMagic, {
      instanceId: "alice-hiten-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const cx01 = createCardInstance(c, {
      instanceId: "alice-cx01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magic, cx01],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    const triggerOptions = {
      state,
      activatorPlayerId: "alice",
      relatedInstanceId: magic.instanceId,
      effectSourceTotalReduction: 2,
      effectSourceSatisfiedReductionSymbolCount: 2,
      effectSourceRequiredReductionSymbolCount: 2,
      ...lookups,
    };

    const notLatched = flushReadyEffectCompletions(
      queueEffectActivationTriggers({
        chainId: "test:bsrk01-cards:3655",
        ...triggerOptions,
        eligibleSourceInstanceIds: [],
      }),
      lookups
    );
    expect(
      getLegalActions({
        state: notLatched,
        actingPlayerId: "alice",
        getCardDefinitionById: lookups.getCardDefinitionById,
        getRegisteredFieldCardEffectActions:
          lookups.getRegisteredFieldCardEffectActions,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: lookups.getRegisteredBurstActions,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceCardNo === "BSRK01-CX01"
      )
    ).toBe(false);

    const latched = flushReadyEffectCompletions(
      queueEffectActivationTriggers({
        chainId: "test:bsrk01-cards:3679",
        ...triggerOptions,
        eligibleSourceInstanceIds: [cx01.instanceId],
      }),
      lookups
    );
    expect(
      getLegalActions({
        state: latched,
        actingPlayerId: "alice",
        getCardDefinitionById: lookups.getCardDefinitionById,
        getRegisteredFieldCardEffectActions:
          lookups.getRegisteredFieldCardEffectActions,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: lookups.getRegisteredBurstActions,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceCardNo === "BSRK01-CX01"
      )
    ).toBe(true);
  });

  it("use_magic 後のスタック応答で場に出た CX01 は飛天御剣流マジック解決後にカウントしない", () => {
    const hitenMagic = makeHitenTestMagic();
    const whiteSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-WHITE-SYMBOL-LATE-CX01"),
      colors: ["white"],
      symbolColors: ["white"],
    };
    const redSymbolSource: CardDefinition = {
      ...makeTestSpirit("TEST-RED-SYMBOL-LATE-CX01"),
      colors: ["red"],
      symbolColors: ["red"],
    };
    const defs = [...ALL_CARDS, hitenMagic, whiteSymbolSource, redSymbolSource];
    const defMap = new Map(defs.map((def) => [def.cardNo, def]));
    const lookups = {
      getCardDefinitionById: (definitionId: string) => defMap.get(definitionId),
      getRegisteredMagicActions: buildMagicLookup(defs),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: buildBurstEffectLookup(defs),
    };
    const magic = createCardInstance(hitenMagic, {
      instanceId: "alice-hiten-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckCard = createCardInstance(card("BSRK01-C07"), {
      instanceId: "alice-deck-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const whiteSource = createCardInstance(whiteSymbolSource, {
      instanceId: "alice-white-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const redSource = createCardInstance(redSymbolSource, {
      instanceId: "alice-red-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [whiteSource, redSource, magic, deckCard],
      playerOverrides: [{ reserveNormalCoreCount: 1, deckCount: 1 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
    };
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === magic.instanceId
    );
    expect(useMagic).toBeDefined();
    if (!useMagic || useMagic.kind !== "use_magic") {
      throw new Error("use_magic not found");
    }
    expect(useMagic.totalReduction).toBe(2);

    const declared = applyLegalAction({
      state,
      action: useMagic,
      paymentSources: [],
      ...lookups,
    }).state;
    const lateCx01 = createCardInstance(c, {
      instanceId: "alice-cx01-late",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const declaredWithLateCx01: GameState = {
      ...declared,
      cardInstances: [...declared.cardInstances, lateCx01],
    };
    const afterMagic = passStackUntilClosed({
      state: declaredWithLateCx01,
      ...lookups,
    });
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeUndefined();
    expect(
      afterMagic.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);
  });

  it.each([
    ["field", 2],
    ["soul_state", 0],
    ["advent_source", 2],
  ] as const)(
    "BSRK01-CX01 は %s でも全軽減を満たすが、効果発揮後のスピリットの有無でカウント+%iになる",
    (sourceMode, expectedCount) => {
      const { afterMagic, actionTotalReduction, lookups } =
        runHitenMagicScenario({
          includeWhiteReductionSource: false,
          sourceMode,
        });
      expect(actionTotalReduction).toBe(2);
      expect(
        afterMagic.pendingTriggeredEffects.some(
          (pending) =>
            pending.eventKind === "effect_completed" &&
            pending.effectSourceSatisfiedReductionSymbolCount === 2 &&
            pending.effectSourceRequiredReductionSymbolCount === 2
        )
      ).toBe(true);
      const resolveAction = getLegalActions({
        state: afterMagic,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceCardNo === "BSRK01-CX01"
      );
      expect(resolveAction).toBeDefined();
      const declared = applyLegalAction({
        state: afterMagic,
        action: resolveAction!,
        ...lookups,
      }).state;
      const final = passStackUntilClosed({ state: declared, ...lookups });
      expect(
        final.players.find((player) => player.id === "alice")!.countValue
      ).toBe(expectedCount);
      expect(final.stackWindow).toBeNull();
      expect(final.pendingTriggeredEffects).toHaveLength(0);
      expect(
        final.cardInstances.find(
          (instance) => instance.instanceId === "alice-hiten-magic"
        )?.zone
      ).toBe("trash");
    }
  );

  it("カウント効果への応答で魂状態になった剣心は、別のスピリットがいてもカウントしない", () => {
    const { afterMagic, lookups } = runHitenMagicScenario({
      includeWhiteReductionSource: true,
    });
    const resolve = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolve).toBeDefined();
    const declared = applyLegalAction({
      state: afterMagic,
      action: resolve!,
      ...lookups,
    }).state;
    const soul = executeEffect({
      chainId: "test:cx01-soul-before-count",
      state: declared,
      sourceInstanceId: "alice-cx01",
      actingPlayerId: "alice",
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "enter_soul_state", target: { kind: "self" } } },
        ],
      },
      ...lookups,
    });
    expect(soul.players[0]!.soulStateInstanceIds).toContain("alice-cx01");
    const final = passStackUntilClosed({ state: soul, ...lookups });
    expect(final.players[0]!.countValue).toBe(0);
    expect(final.stackWindow).toBeNull();
    expect(final.pendingTriggeredEffects).toHaveLength(0);
  });

  it("白シンボル供給がなくても飛天御剣流マジックの軽減シンボルすべてを満たしてカウントする", () => {
    const { afterMagic, actionTotalReduction, lookups } = runHitenMagicScenario(
      { includeWhiteReductionSource: false }
    );
    expect(actionTotalReduction).toBe(2);
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeDefined();
    const declared = applyLegalAction({
      state: afterMagic,
      action: resolveAction!,
      ...lookups,
    }).state;
    const final = passStackUntilClosed({ state: declared, ...lookups });
    expect(
      final.players.find((player) => player.id === "alice")!.countValue
    ).toBe(2);
  });

  it("軽減できない制約があると飛天御剣流マジックでも全軽減未充足のためカウントしない", () => {
    const { afterMagic, actionTotalReduction, lookups } = runHitenMagicScenario(
      {
        includeWhiteReductionSource: false,
        preventCostReduction: true,
      }
    );
    expect(actionTotalReduction).toBe(0);
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeUndefined();
    expect(
      afterMagic.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);
  });

  it("効果抑止中の CX01 は飛天御剣流マジックの全軽減 waiver に参加しない", () => {
    const { stateBeforeUse, afterMagic, actionTotalReduction, lookups } =
      runHitenMagicScenario({
        includeWhiteReductionSource: true,
        suppressCx01: true,
        magicCost: 4,
        magicReductionSymbols: ["red", "white", "red", "white"],
      });
    expect(
      stateBeforeUse.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(true);
    expect(
      executeReevaluationCheck({
        state: stateBeforeUse,
        checkKind: "effect_suppression",
        sourceInstanceId: "alice-cx01",
        targetInstanceIds: [],
        getCardDefinitionById: lookups.getCardDefinitionById,
      })
    ).toBe(false);
    expect(actionTotalReduction).toBe(2);
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeUndefined();
    expect(
      afterMagic.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);
  });

  it("効果抑止中の CX01 は全軽減済み飛天御剣流マジックの使用開始ラッチにも参加しない", () => {
    const { declared, afterMagic, actionTotalReduction, lookups } =
      runHitenMagicScenario({
        includeWhiteReductionSource: true,
        suppressCx01: true,
      });
    expect(actionTotalReduction).toBe(2);
    expect(
      declared.stackWindow?.pendingStackAction
        ?.eligibleSourceInstanceIdsAtEffectActivationStart ?? []
    ).toEqual([]);
    const resolveAction = getLegalActions({
      state: afterMagic,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceCardNo === "BSRK01-CX01"
    );
    expect(resolveAction).toBeUndefined();
    expect(
      afterMagic.players.find((player) => player.id === "alice")!.countValue
    ).toBe(0);
  });
});

describe("BSRK01-C01 飛天御剣流『龍槌閃』", () => {
  const c = card("BSRK01-C01");

  function makeBsrk01C01FlashSummonState(
    targetKind: "hand" | "set_aside" | "trash" | "soul_state" | "advent_source"
  ): { state: GameState; sourceId: string; targetId: string; hostId?: string } {
    const source = createCardInstance(c, {
      instanceId: "bsrk01-c01-flash-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const targetId = `kenshin-${targetKind}`;
    const target = createCardInstance(card("BSRK01-CX01"), {
      instanceId: targetId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone:
        targetKind === "hand"
          ? "hand"
          : targetKind === "set_aside"
            ? "set_aside"
            : targetKind === "trash"
              ? "trash"
              : "field",
      zoneRoleName:
        targetKind === "advent_source" ? "advent-source" : undefined,
      normalCoreCount: 0,
    });
    const hostId = "advent-host";
    const host =
      targetKind === "advent_source"
        ? createCardInstance(card("BSRK01-CX01"), {
            instanceId: hostId,
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          })
        : null;
    if (host) {
      host.underCards = [
        { cardInstanceId: targetId, role: "advent_source" as const },
      ];
    }
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...(host ? [host] : []), target],
      playerOverrides: [
        {
          handCount: targetKind === "hand" ? 1 : 0,
          reserveNormalCoreCount: 3,
        },
        {},
      ],
    });
    return {
      sourceId: source.instanceId,
      targetId,
      ...(host ? { hostId } : {}),
      state: {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        window: "flash",
        players:
          targetKind === "soul_state"
            ? base.players.map((player) =>
                player.id === "alice"
                  ? { ...player, soulStateInstanceIds: [targetId] }
                  : player
              )
            : base.players,
      },
    };
  }

  function runBsrk01C01FlashSummon(options: {
    state: GameState;
    sourceId: string;
    targetId: string;
    resolvePendingPlacement?: boolean;
  }): GameState {
    const after = executeEffect({
      chainId: "test:bsrk01-cards:4050",
      state: options.state,
      effect: c.effects![1]!,
      sourceInstanceId: options.sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: [options.targetId],
    });
    if (
      options.resolvePendingPlacement === false ||
      after.pendingMultiPlacement === null
    ) {
      return after;
    }
    const resolveAction = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(resolveAction).toBeDefined();
    return applyLegalAction({
      state: after,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: options.targetId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;
  }

  it("effects[0]: 手札4枚以下なら deck_reveal で手札追加、5枚以上なら hand_swap に分岐する", () => {
    const effect = c.effects![0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.condition).toEqual([
      { kind: "hand_count", player: "self", min: 5 },
    ]);
    expect(effect.steps[1]!.condition).toEqual([
      { kind: "hand_count", player: "self", max: 4 },
    ]);
    const swapReveal = effect.steps[0]!.action;
    const addReveal = effect.steps[1]!.action;
    expect(addReveal.kind).toBe("deck_reveal");
    expect(swapReveal.kind).toBe("deck_reveal");
    if (addReveal.kind !== "deck_reveal" || swapReveal.kind !== "deck_reveal")
      throw new Error("unexpected action");
    expect(addReveal.picks).toEqual([{ count: 1 }]);
    expect(addReveal.revealTo).toBe("self");
    expect(addReveal.remainder).toBe("top_bottom_split");
    expect(swapReveal.picks).toEqual([{ count: 1, destination: "hand_swap" }]);
    expect(swapReveal.revealTo).toBe("self");
    expect(swapReveal.remainder).toBe("top_bottom_split");
  });

  it("BSRK01-C01 effects[1]: 手札/手元/トラッシュ/魂状態/煌臨元の契約スピリット1枚を対象にする", () => {
    const effect = c.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    const step = effect.steps[0]!;
    expect(step.action.kind).toBe("summon");
    if (step.action.kind !== "summon") throw new Error("unexpected action");
    expect(step.action.costModifier).toBe("free");
    expect(step.action.target).toMatchObject({
      kind: "from_zone",
      zone: ["hand", "set_aside", "trash"],
      count: 1,
      includeAdventSource: true,
      includeSoulState: true,
      filter: {
        category: ["spirit"],
        maxCost: 3,
        requiredKeywordTags: ["contract"],
      },
    });
  });

  it("BSRK01-C01 effects[1]: 手札/手元/トラッシュの契約スピリットをコストなし召喚して維持コアを置く", () => {
    for (const targetKind of ["hand", "set_aside", "trash"] as const) {
      const { state, sourceId, targetId } =
        makeBsrk01C01FlashSummonState(targetKind);
      const after = runBsrk01C01FlashSummon({ state, sourceId, targetId });
      const summoned = after.cardInstances.find(
        (card) => card.instanceId === targetId
      )!;
      expect(summoned.zone).toBe("field");
      expect(summoned.zoneRoleName).toBe("spirit");
      expect(summoned.normalCoreCount).toBe(1);
      expect(after.pendingMultiPlacement).toBeNull();
      const alice = after.players.find((player) => player.id === "alice")!;
      expect(alice.reserveNormalCoreCount).toBe(2);
      if (targetKind === "hand") expect(alice.handCount).toBe(0);
    }
  });

  it("BSRK01-C01 effects[1]: 魂状態と煌臨元の契約スピリットも同じ対象枠で召喚できる", () => {
    const soul = makeBsrk01C01FlashSummonState("soul_state");
    const afterSoul = runBsrk01C01FlashSummon({
      state: soul.state,
      sourceId: soul.sourceId,
      targetId: soul.targetId,
      resolvePendingPlacement: true,
    });
    const soulSummoned = afterSoul.cardInstances.find(
      (card) => card.instanceId === soul.targetId
    )!;
    expect(soulSummoned.zone).toBe("field");
    expect(soulSummoned.zoneRoleName).toBe("spirit");
    expect(soulSummoned.normalCoreCount).toBe(1);
    expect(
      afterSoul.players.find((player) => player.id === "alice")!
        .soulStateInstanceIds
    ).not.toContain(soul.targetId);

    const advent = makeBsrk01C01FlashSummonState("advent_source");
    const afterAdvent = runBsrk01C01FlashSummon({
      state: advent.state,
      sourceId: advent.sourceId,
      targetId: advent.targetId,
    });
    const adventSummoned = afterAdvent.cardInstances.find(
      (card) => card.instanceId === advent.targetId
    )!;
    expect(adventSummoned.zone).toBe("field");
    expect(adventSummoned.zoneRoleName).toBe("spirit");
    expect(adventSummoned.normalCoreCount).toBe(1);
    const host = afterAdvent.cardInstances.find(
      (card) => card.instanceId === advent.hostId
    )!;
    expect(
      host.underCards.some((entry) => entry.cardInstanceId === advent.targetId)
    ).toBe(false);
  });

  it("BSRK01-C01 effects[0]: 手札4枚以下なら選んだデッキ上カードを手札に加える", () => {
    const { state, sourceId } = makeBsrk01C01DeckRevealState({
      handCount: 4,
    });
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-cards:4191",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(
      afterReveal.pendingDeckReveal!.picks[0]!.destination
    ).toBeUndefined();

    const finalState = walkDeckRevealPickAndOrder(afterReveal, ["deck-pick"]);
    expect(
      finalState.cardInstances.find((card) => card.instanceId === "deck-pick")!
        .zone
    ).toBe("hand");
    expect(finalState.pendingZoneSelection).toBeNull();
    expect(
      finalState.players.find((player) => player.id === "alice")!.handCount
    ).toBe(5);
    expect(
      finalState.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["deck-rest-1", "deck-tail", "deck-rest-2"]);
    expect(finalState.log).toContain(
      "deck_reveal:picked_cards_private:alice:count=1"
    );
    expect(finalState.log.join("\n")).not.toContain(
      "deck_reveal:picked_cards:alice"
    );
    expect(finalState.log.join("\n")).not.toContain(card("BSRK01-C02").name);
  });

  it("BSRK01-C01 effects[0]: 『内容を見る』deck_reveal は解決者だけに見え、revealed 効果を発火しない", () => {
    const opener = createCardInstance(card("BSTH09-C01"), {
      instanceId: "private-opener",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const sakuya = createCardInstance(card("BSTH09-M01"), {
      instanceId: "private-sakuya",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [opener, sakuya],
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, deckCount: 1, handCount: 0 }
          : player
      ),
    };
    const privateReveal: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 1,
            revealTo: "self",
            picks: [],
            remainder: "top_bottom_split",
          },
        },
      ],
    };
    const publicReveal: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 1,
            revealTo: "both",
            picks: [],
            remainder: "bottom",
          },
        },
      ],
    };

    const privateState = executeEffect({
      chainId: "test:bsrk01-cards:4284",
      state,
      effect: privateReveal,
      sourceInstanceId: "private-opener",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const revealed = privateState.cardInstances.find(
      (card) => card.instanceId === "private-sakuya"
    )!;
    expect(revealed.zone).toBe("revealed");
    expect(revealed.revealedTo).toBe("self");
    expect(revealed.revealedByPlayerId).toBe("alice");
    expect(privateState.pendingDeckReveal?.revealedDispositionMap).toBe(
      undefined
    );

    const aliceView = sanitizeStateForViewer(privateState, "alice");
    const bobView = sanitizeStateForViewer(privateState, "bob");
    const spectatorView = sanitizeStateForViewer(privateState, null);
    expect(
      aliceView.cardInstances.find(
        (card) => card.instanceId === "private-sakuya"
      )!.definitionId
    ).toBe("BSTH09-M01");
    expect(
      bobView.cardInstances.find(
        (card) => card.instanceId === "private-sakuya"
      )!.definitionId
    ).toBe("_hidden_card_");
    expect(
      spectatorView.cardInstances.find(
        (card) => card.instanceId === "private-sakuya"
      )!.definitionId
    ).toBe("_hidden_card_");

    const publicState = executeEffect({
      chainId: "test:bsrk01-cards:4320",
      state,
      effect: publicReveal,
      sourceInstanceId: "private-opener",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(publicState.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(
      publicState.pendingDeckReveal?.revealedDispositionMap?.["private-sakuya"]
    ).toEqual({ kind: "set_as_burst" });
  });

  it("BSRK01-C01 effects[0]: 手札4枚以下でも『加えられる』なので0枚選択できる", () => {
    const { state, sourceId } = makeBsrk01C01DeckRevealState({
      handCount: 4,
    });
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-cards:4337",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    if (pickAction?.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("unexpected pick action");
    }
    expect(pickAction.canSkip).toBe(true);

    const afterSkip = applyLegalAction({
      state: afterReveal,
      action: pickAction,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [],
    }).state;
    const orderAction = getLegalActions({
      state: afterSkip,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected order action");
    }
    expect(orderAction.remainingCardInstanceIds).toEqual([
      "deck-pick",
      "deck-rest-1",
      "deck-rest-2",
    ]);
    const finalState = applyLegalAction({
      state: afterSkip,
      action: orderAction,
      getCardDefinitionById: getDef,
      deckRevealRemainderOrder: ["deck-pick", "deck-rest-1", "deck-rest-2"],
      deckRevealRemainderPlacements: {
        "deck-pick": "top",
        "deck-rest-1": "bottom",
        "deck-rest-2": "bottom",
      },
    }).state;
    expect(
      finalState.players.find((player) => player.id === "alice")!.handCount
    ).toBe(4);
    expect(
      finalState.cardInstances.find((card) => card.instanceId === "deck-pick")!
        .zone
    ).toBe("deck");
  });

  it("BSRK01-C01 effects[0]: 手札5枚以上なら手札だけを候補に1対1入替する", () => {
    const { state, sourceId } = makeBsrk01C01DeckRevealState({
      handCount: 5,
      setAsideCount: 1,
    });
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-cards:4400",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.picks[0]!.destination).toBe(
      "hand_swap"
    );

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: ["deck-pick"],
    }).state;
    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(afterPick.pendingZoneSelection?.swapPickedInstanceId).toBe(
      "deck-pick"
    );
    expect(
      afterPick.pendingZoneSelection?.deckRevealResumeAfterSwapSelection?.phase
    ).toBe("ordering_remainder");
    expect(afterPick.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
      "hand-0",
      "hand-1",
      "hand-2",
      "hand-3",
      "hand-4",
    ]);
    expect(
      afterPick.pendingZoneSelection?.candidateCardInstanceIds
    ).not.toContain("setaside-0");

    const swapAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(swapAction).toBeDefined();
    const afterSwapChoice = applyLegalAction({
      state: afterPick,
      action: swapAction!,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: ["hand-0"],
    }).state;
    expect(afterSwapChoice.pendingZoneSelection).toBeNull();
    expect(afterSwapChoice.pendingDeckReveal?.phase).toBe("ordering_remainder");

    const orderAction = getLegalActions({
      state: afterSwapChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected order action");
    }
    expect(orderAction.remainingCardInstanceIds).toEqual([
      "deck-rest-1",
      "deck-rest-2",
      "hand-0",
    ]);
    expect(() =>
      applyLegalAction({
        state: afterSwapChoice,
        action: orderAction,
        getCardDefinitionById: getDef,
        deckRevealRemainderOrder: ["deck-rest-1", "hand-0", "deck-rest-2"],
      })
    ).toThrow(/top_bottom_split requires placements/);

    const finalState = applyLegalAction({
      state: afterSwapChoice,
      action: orderAction,
      getCardDefinitionById: getDef,
      deckRevealRemainderOrder: ["hand-0", "deck-rest-1", "deck-rest-2"],
      deckRevealRemainderPlacements: {
        "deck-rest-1": "top",
        "hand-0": "top",
        "deck-rest-2": "bottom",
      },
    }).state;

    expect(
      finalState.cardInstances.find((card) => card.instanceId === "deck-pick")!
        .zone
    ).toBe("hand");
    expect(
      finalState.cardInstances.find((card) => card.instanceId === "hand-0")!
        .zone
    ).toBe("deck");
    expect(
      finalState.cardInstances.find((card) => card.instanceId === "setaside-0")!
        .zone
    ).toBe("set_aside");
    expect(
      finalState.players.find((player) => player.id === "alice")!.handCount
    ).toBe(5);
    expect(
      finalState.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["deck-rest-1", "hand-0", "deck-tail", "deck-rest-2"]);
    expect(finalState.pendingZoneSelection).toBeNull();
  });

  it("BSRK01-C01 effects[0]: order 解決は余分IDを拒否して無関係カードを deck に動かさない", () => {
    const { state, sourceId } = makeBsrk01C01DeckRevealState({
      handCount: 5,
    });
    const intruder = createCardInstance(card("BSTH01-C01"), {
      instanceId: "bob-intruder",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const withIntruder: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, intruder],
    };
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-cards:4531",
      state: withIntruder,
      effect: c.effects![0]!,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: ["deck-pick"],
    }).state;
    const swapAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(swapAction).toBeDefined();
    const afterSwapChoice = applyLegalAction({
      state: afterPick,
      action: swapAction!,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: ["hand-0"],
    }).state;
    const orderAction = getLegalActions({
      state: afterSwapChoice,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    expect(() =>
      applyLegalAction({
        state: afterSwapChoice,
        action: orderAction!,
        getCardDefinitionById: getDef,
        deckRevealRemainderOrder: [
          "deck-rest-1",
          "hand-0",
          "deck-rest-2",
          "bob-intruder",
        ],
        deckRevealRemainderPlacements: {
          "deck-rest-1": "top",
          "hand-0": "top",
          "deck-rest-2": "bottom",
          "bob-intruder": "bottom",
        },
      })
    ).toThrow(/Deck reveal remainder order/);
    expect(
      afterSwapChoice.cardInstances.find(
        (card) => card.instanceId === "bob-intruder"
      )!.zone
    ).toBe("hand");
  });

  it("BSRK01-C01 effects[0]: 入替をスキップした picked 札も残りカードとして上/下へ戻せる", () => {
    const { state, sourceId } = makeBsrk01C01DeckRevealState({
      handCount: 5,
    });
    const afterReveal = executeEffect({
      chainId: "test:bsrk01-cards:4598",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: sourceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: ["deck-pick"],
    }).state;
    const swapAction = getLegalActions({
      state: afterPick,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(swapAction).toBeDefined();
    const afterSkip = applyLegalAction({
      state: afterPick,
      action: swapAction!,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [],
    }).state;
    const orderAction = getLegalActions({
      state: afterSkip,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    if (orderAction?.kind !== "resolve_pending_deck_reveal_order") {
      throw new Error("unexpected order action");
    }
    expect(orderAction.remainingCardInstanceIds).toEqual([
      "deck-rest-1",
      "deck-rest-2",
      "deck-pick",
    ]);

    const finalState = applyLegalAction({
      state: afterSkip,
      action: orderAction,
      getCardDefinitionById: getDef,
      deckRevealRemainderOrder: ["deck-pick", "deck-rest-2", "deck-rest-1"],
      deckRevealRemainderPlacements: {
        "deck-pick": "top",
        "deck-rest-1": "bottom",
        "deck-rest-2": "bottom",
      },
    }).state;
    expect(
      finalState.cardInstances.find((card) => card.instanceId === "deck-pick")!
        .zone
    ).toBe("deck");
    expect(
      finalState.players.find((player) => player.id === "alice")!.handCount
    ).toBe(5);
    expect(
      finalState.cardInstances
        .filter(
          (card) => card.ownerPlayerId === "alice" && card.zone === "deck"
        )
        .map((card) => card.instanceId)
    ).toEqual(["deck-pick", "deck-tail", "deck-rest-1", "deck-rest-2"]);
  });
});

describe("BSRK01 残り (M01/R03/X01/X02) は置換/結誓で stub", () => {
  it("各カードは effects を持ち、確定不能部はステップ0の stub として明示される", () => {
    for (const no of ["BSRK01-M01", "BSRK01-R03", "BSRK01-X01", "BSRK01-X02"]) {
      const c = card(no);
      expect(c.effects && c.effects.length).toBeGreaterThan(0);
      // 未解消スライスはステップ空（=純 stub）であり、各効果に stub 説明が付く。
      // (契約煌臨宣言の activated/flash stub は adventData へ移行済み: M01/R03/X02)
      // 例外: BSRK01-M01[0] / BSRK01-R03[0] / BSRK01-X02[0] = 「マジック効果コピー」
      //   借用発揮 (borrow_magic_effect、既存 primitive) で stale-stub sweep 済み
      //   (bsrk01-magic-effect-borrow.test.ts)。
      //   M01 は旧 effects[1] だったが、代替コスト煌臨 stub (旧[0]) が
      //   adventData.alternateCostAdvent へ移行し effects[] から削除された
      //   (ADVENT_HEADER 特例、cc3e9b006) ため index が 1→0 にシフトした。
      // 例外: BSRK01-R03[1] = OC中フラッシュの手札⇔トラッシュ入替は
      //   queue_hand_trash_swap で stale-stub sweep 済み。
      // 例外: BSRK01-X02[2] (旧[1]、借用発揮追加で index shift) =
      //   【OC中＆煌臨中】Lv1-Lv2 効果耐性は既存プリミティブ (count_value +
      //   self_state.advented + applicability.level + effect_immunity continuous) で
      //   stale-stub sweep 済み (bsrk01-x02-oc-advent-immunity.test.ts)。
      // 例外: BSRK01-X02[1] = 「さらに、バトル終了時…回復する」は
      //   card_event:attack+deferredTo:battle_end + remove_from_game→recover(conditional_cost)
      //   で stub 解消 (ENGINE-battle-end-deferral-target-carry、
      //   bsrk01-x02-battle-end-recover.test.ts)。
      // 例外: BSRK01-X01[1] = 合体中メインステップ終了時の飛天御剣流回収→
      //   手札5枚以下デッキ下戻しは既存 search_zone + discard targetHandSize で解消。
      // 例外: BSRK01-X01[0] = 合体結誓トリガー (card_event:brave_combined +
      //   combined_host_advent_source_card_name) → 手札4枚以下破棄 (discard) + ライフコア配置禁止
      //   (restrict_core_placement) + 手札増加禁止 (hand_gain_prevention、新設 primitive)
      //   で stub 解消 (bsrk01-x01-hand-gain-prevention.test.ts)。
      for (let i = 0; i < c.effects!.length; i++) {
        const eff = c.effects![i]!;
        if (no === "BSRK01-M01" && i === 0) {
          expect(eff.steps.length).toBeGreaterThan(0);
          expect(eff.stub).toBeUndefined();
          continue;
        }
        if (no === "BSRK01-R03" && (i === 0 || i === 1)) {
          expect(eff.steps.length).toBeGreaterThan(0);
          expect(eff.stub).toBeUndefined();
          continue;
        }
        if (no === "BSRK01-X02" && (i === 0 || i === 1 || i === 2)) {
          expect(eff.steps.length).toBeGreaterThan(0);
          expect(eff.stub).toBeUndefined();
          continue;
        }
        if (no === "BSRK01-X01" && (i === 0 || i === 1)) {
          expect(eff.steps.length).toBeGreaterThan(0);
          expect(eff.stub).toBeUndefined();
          continue;
        }
        expect(eff.steps).toHaveLength(0);
        expect(typeof eff.stub).toBe("string");
        expect(eff.stub!.length).toBeGreaterThan(0);
      }
    }
  });

  it("BSRK01-C05 は flash[0] が deferredTo:battle_end の end_attack_step、stack[1] が replace_attack_declaration (両方 stub 解消)", () => {
    const c = card("BSRK01-C05");
    expect(c.effects).toHaveLength(2);
    // effect[0]: このバトル終了時アタックステップ終了 = effect 単位 deferredTo:battle_end
    expect(c.effects![0]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
      deferredTo: "battle_end",
    });
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("end_attack_step");
    expect(c.effects![0]!.stub).toBeUndefined();
    // effect[1]: アタック宣言置換 (ENGINE-attack-declaration-replacement-primitive)。
    expect(c.effects![1]!.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(c.effects![1]!.timingScope).toEqual({
      player: "opponent",
      period: "attack",
    });
    expect(c.effects![1]!.stub).toBeUndefined();
    const replaceAction = c.effects![1]!.steps[0]!.action;
    expect(replaceAction.kind).toBe("replace_attack_declaration");
    if (replaceAction.kind === "replace_attack_declaration") {
      expect(replaceAction.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: 1,
      });
      expect(replaceAction.forcedBlocker).toMatchObject({
        kind: "filter",
        player: "self",
      });
    }
  });

  it.each([
    ["BSRK01-M01", "both_attack_step", 4],
    ["BSRK01-R03", "both_attack_step", 2],
    ["BSRK01-X02", "own_turn", 8],
  ] as const)(
    "%s は契約煌臨宣言を adventData (contract / %s / C%i以上) へ移行",
    (no, timing, minCount) => {
      const c = card(no);
      expect(c.adventData).toBeDefined();
      const ad = c.adventData!;
      expect(ad.adventVariant).toBe("contract");
      expect(ad.adventTiming).toBe(timing);
      expect(ad.soulCoreDest).toBe("trash");
      expect(ad.adventCondition.minCost).toBeUndefined();
      expect(ad.adventCondition.targetCategory).toEqual(["spirit"]);
      expect(ad.declareCondition).toEqual([
        { kind: "count_value", player: "self", min: minCount },
      ]);
      // 契約煌臨宣言の activated/flash stub は削除済み (declare_advent 経路へ)。
      const declStub = (c.effects ?? []).find(
        (e) =>
          e.timing.kind === "activated" &&
          e.timing.mode === "flash" &&
          typeof e.stub === "string" &&
          e.stub.includes("契約煌臨の宣言")
      );
      expect(declStub).toBeUndefined();
    }
  );

  it("BSRK01-M01 の代替契約煌臨 (〔ターンに1回:同名〕[3]) は adventData.alternateCostAdvent へ移行済み", () => {
    const c = card("BSRK01-M01");
    expect(c.adventData!.alternateCostAdvent).toEqual({
      condition: [{ kind: "count_value", player: "self", min: 6 }],
      timing: "opponent_attack_step",
    });
    // effects[] には現れない (ADVENT_HEADER 特例、cc3e9b006)
    const staleStub = (c.effects ?? []).find(
      (e) => typeof e.stub === "string" && e.stub.includes("ソウルコア")
    );
    expect(staleStub).toBeUndefined();
  });
});

describe("BSRK01-X01 逆刃刀", () => {
  const x01 = card("BSRK01-X01");

  function buildX01MainEndState(
    options: {
      activePlayerId?: "alice" | "bob";
      combined?: boolean;
      window?: GameState["window"];
    } = {}
  ): GameState {
    const combined = options.combined ?? true;
    const source = createCardInstance(x01, {
      instanceId: "alice-x01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      ...(combined ? { attachedToInstanceId: "alice-host" } : {}),
    });
    const host = createCardInstance(card("BSRK01-X02"), {
      instanceId: "alice-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
      attachedChildrenIds: combined ? ["alice-x01"] : [],
    });
    const handCards = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(card("BSRK01-C07"), {
        instanceId: `alice-hand-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    const hitenA = createCardInstance(card("BSRK01-C01"), {
      instanceId: "alice-hiten-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const hitenB = createCardInstance(card("BSRK01-C03"), {
      instanceId: "alice-hiten-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, source, ...handCards, hitenA, hitenB],
        playerOverrides: [{ handCount: 6, deckCount: 0 }, {}],
      }),
      activePlayerId: options.activePlayerId ?? "alice",
      step: "main",
      window: options.window ?? "step_end",
    };
  }

  const x01TriggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
  const x01BurstLookup = buildBurstEffectLookup(ALL_CARDS);
  const x01LookupOpts = {
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: x01TriggeredLookup,
    getRegisteredBurstActions: x01BurstLookup,
  };

  function findX01ResolveAction(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      ...x01LookupOpts,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "alice-host" &&
        action.sourceEffectInstanceId === "alice-x01" &&
        action.sourceCardNo === "BSRK01-X01" &&
        action.skipOnly !== true
    );
  }

  function resolveX01TriggeredStack(state: GameState): GameState {
    const triggeredStack = state.stackWindow?.pendingStackAction as
      | ActiveStack
      | undefined;
    expect(triggeredStack).toMatchObject({
      actionKind: "triggered_effect",
      cardInstanceId: "alice-host",
      cardDefinitionId: "BSRK01-X02",
      effectSourceInstanceId: "alice-x01",
      effectSourceDefinitionId: "BSRK01-X01",
      triggeredSourceCardNo: "BSRK01-X01",
    });
    if (!triggeredStack) {
      throw new Error("missing BSRK01-X01 triggered stack");
    }
    return resolveStackCascade(
      { ...state, stackWindow: null, pendingStackCascade: null },
      [triggeredStack],
      x01LookupOpts
    );
  }

  function resolveX01Discard(state: GameState): GameState {
    expect(state.pendingZoneSelection).toMatchObject({
      actionKind: "discard_hand",
      sourceZone: "hand",
      maxCount: 2,
      destination: "deck_bottom",
    });
    return applyLegalAction({
      state,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["alice-hand-0", "alice-hand-1"],
      ...x01LookupOpts,
    }).state;
  }

  function resolveX01ProductionReturnTarget(
    state: GameState,
    returnId = "alice-hiten-a"
  ): GameState {
    expect(state.pendingEffectTargetSelection).toMatchObject({
      actingPlayerId: "alice",
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
    expect(
      state.pendingEffectTargetSelection!.candidateInstanceIds.sort()
    ).toEqual(["alice-hiten-a", "alice-hiten-b"]);
    const resolveTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...x01LookupOpts,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(resolveTargetAction).toBeDefined();
    if (!resolveTargetAction) {
      throw new Error("missing BSRK01-X01 return target action");
    }
    return applyLegalAction({
      state,
      action: resolveTargetAction,
      targetInstanceIds: [returnId],
      ...x01LookupOpts,
    }).state;
  }

  function expectNoX01MainEndResolve(state: GameState): void {
    expect(
      state.pendingTriggeredEffects.some(
        (pending) =>
          pending.sourceInstanceIds?.includes("alice-x01") ||
          pending.sourceInstanceIds?.includes("alice-host") ||
          pending.resolvedSourceInstanceIds?.includes("alice-x01") ||
          pending.resolvedSourceInstanceIds?.includes("alice-host")
      )
    ).toBe(false);
    expect(findX01ResolveAction(state)).toBeUndefined();
  }

  it("BSRK01-X01 effects[1] は合体中メインステップ終了時に飛天御剣流回収→手札5枚以下デッキ下戻し", () => {
    const effect = x01.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "self",
      subPhase: "end",
    });
    expect(effect.applicability).toEqual({ combined: true });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps[0]!.action).toMatchObject({
      kind: "search_zone",
      zone: "trash",
      count: 1,
      destination: "hand",
      mandatory: true,
    });
    expect(effect.steps[1]!.action).toMatchObject({
      kind: "discard",
      player: "self",
      targetHandSize: 5,
      destination: "deck_bottom",
    });
    expect(effect.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "return_hiten_magic",
    });
  });

  it("BSRK01-X01 effects[1]: 回収成功時だけ後段が続き、手札を5枚以下になるようデッキ下へ戻す", () => {
    const afterReturnPrompt = executeEffect({
      chainId: "test:bsrk01-cards:5004",
      state: buildX01MainEndState(),
      effect: x01.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "alice-x01",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: x01TriggeredLookup,
    });
    expect(afterReturnPrompt.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      sourceZone: "trash",
      maxCount: 1,
      destination: "hand",
    });
    expect(
      afterReturnPrompt.pendingZoneSelection!.candidateCardInstanceIds.sort()
    ).toEqual(["alice-hiten-a", "alice-hiten-b"]);
    expect(afterReturnPrompt.pendingZoneSelection!.canSkip).toBe(false);
    expect(afterReturnPrompt.pendingZoneSelection!.continuation).toMatchObject({
      resumeStepIndex: 1,
      recordStepId: "return_hiten_magic",
    });

    const afterReturn = applyLegalAction({
      state: afterReturnPrompt,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["alice-hiten-a"],
      ...x01LookupOpts,
    }).state;
    expect(
      afterReturn.cardInstances.find((c) => c.instanceId === "alice-hiten-a")!
        .zone
    ).toBe("hand");
    expect(afterReturn.players.find((p) => p.id === "alice")!.handCount).toBe(
      7
    );
    expect(afterReturn.pendingZoneSelection).toMatchObject({
      actionKind: "discard_hand",
      sourceZone: "hand",
      maxCount: 2,
      destination: "deck_bottom",
    });

    const final = applyLegalAction({
      state: afterReturn,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["alice-hand-0", "alice-hand-1"],
      ...x01LookupOpts,
    }).state;
    expect(final.pendingZoneSelection).toBeNull();
    expect(final.players.find((p) => p.id === "alice")!.handCount).toBe(5);
    expect(final.players.find((p) => p.id === "alice")!.deckCount).toBe(2);
    expect(
      final.cardInstances.find((c) => c.instanceId === "alice-hand-0")!.zone
    ).toBe("deck");
    expect(
      final.cardInstances.find((c) => c.instanceId === "alice-hiten-a")!.zone
    ).toBe("hand");
    expect(
      final.cardInstances.find((c) => c.instanceId === "alice-hiten-b")!.zone
    ).toBe("trash");
  });

  it("BSRK01-X01 effects[1]: main step_end の本番誘発経路で宣言・stack 解決後に選択待ちへ入る", () => {
    const queued = advanceStep(
      buildX01MainEndState({ window: "none" }),
      getDef,
      x01TriggeredLookup,
      x01BurstLookup
    );
    expect(queued.step).toBe("main");
    expect(queued.window).toBe("step_end");

    const resolveAction = findX01ResolveAction(queued);
    // registrationIndex:1 (effects[0] の合体結誓 card_event:brave_combined トリガーが
    // 新設 registrationIndex:0 を占めるようになったため、effects[1] のこのトリガーは
    // index 1 にシフトした)。
    expect(resolveAction).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      actingPlayerId: "alice",
      sourceInstanceId: "alice-host",
      sourceDefinitionId: "BSRK01-X02",
      sourceEffectInstanceId: "alice-x01",
      sourceEffectDefinitionId: "BSRK01-X01",
      sourceCardNo: "BSRK01-X01",
      executionMode: "optional",
      sourceKind: "spirit",
      registrationIndex: 1,
    });
    if (
      !resolveAction ||
      resolveAction.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("missing BSRK01-X01 resolve action");
    }

    const declared = applyLegalAction({
      state: queued,
      action: resolveAction,
      ...x01LookupOpts,
    }).state;
    expect(declared.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceInstanceId: "alice-x01",
        sourceDefinitionId: "BSRK01-X01",
        effectLabel: "effect:1",
        duration: "turn",
        count: 1,
      })
    );

    const afterStack = resolveX01TriggeredStack(declared);
    expect(afterStack.pendingTriggeredEffects).toHaveLength(0);
    expect(afterStack.pendingZoneSelection).toBeNull();

    const afterReturn = resolveX01ProductionReturnTarget(afterStack);
    expect(
      afterReturn.cardInstances.find((c) => c.instanceId === "alice-hiten-a")!
        .zone
    ).toBe("hand");
    expect(afterReturn.players.find((p) => p.id === "alice")!.handCount).toBe(
      7
    );

    const final = resolveX01Discard(afterReturn);
    expect(final.pendingZoneSelection).toBeNull();
    expect(final.players.find((p) => p.id === "alice")!.handCount).toBe(5);
    expect(final.players.find((p) => p.id === "alice")!.deckCount).toBe(2);
    expect(
      final.cardInstances.find((c) => c.instanceId === "alice-hiten-a")!.zone
    ).toBe("hand");
  });

  it("BSRK01-X01 effects[1]: 非合体中と相手メイン終了時は誘発せず、同名ターン1回の2回目も宣言できない", () => {
    const notCombined = advanceStep(
      buildX01MainEndState({ combined: false, window: "none" }),
      getDef,
      x01TriggeredLookup,
      x01BurstLookup
    );
    expectNoX01MainEndResolve(notCombined);

    const opponentMainEnd = advanceStep(
      buildX01MainEndState({
        activePlayerId: "bob",
        window: "none",
      }),
      getDef,
      x01TriggeredLookup,
      x01BurstLookup
    );
    expectNoX01MainEndResolve(opponentMainEnd);

    const firstQueued = advanceStep(
      buildX01MainEndState({ window: "none" }),
      getDef,
      x01TriggeredLookup,
      x01BurstLookup
    );
    const firstResolve = findX01ResolveAction(firstQueued);
    if (
      !firstResolve ||
      firstResolve.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("missing first BSRK01-X01 resolve action");
    }
    const firstDeclared = applyLegalAction({
      state: firstQueued,
      action: firstResolve,
      ...x01LookupOpts,
    }).state;

    const secondQueued = advanceStep(
      {
        ...buildX01MainEndState({ window: "none" }),
        effectUsageRecords: firstDeclared.effectUsageRecords,
      },
      getDef,
      x01TriggeredLookup,
      x01BurstLookup
    );
    expectNoX01MainEndResolve(secondQueued);
  });
});

// ============================================================
// engine gap: mode:"stack" magic の registration
// ============================================================
// 旧 generateMagicRegistrations は mode が "main"/"flash" 以外を skip しており、
// 「スタック」キーワード magic (mode:"stack" 直書き) は registration 0 件 = 一切使用不能だった。
// fix 後は timing:"stack" の reg を 1 件登録する（フラッシュ窓は開かず、開いている
// スタック窓での応答時のみ使用可能）。
describe("BSRK01 スタック magic registration (engine gap fix)", () => {
  it.each([
    ["BSRK01-C06", 0],
    ["BSRK01-R01", 1],
    ["BSRK01-R02", 1],
    ["BSRK01-C03", 2],
  ] as const)(
    "%s の mode:'stack' 効果[%i] が timing:'stack' reg を生成する",
    (no, idx) => {
      const def = card(no);
      const regs = generateMagicRegistrations(def);
      const stackReg = regs.find(
        (r) => r.timing === "stack" && r.effectIndex === idx
      );
      expect(stackReg).toBeDefined();
      // 〔アタックステップ〕限定が registration に伝搬している。
      expect(stackReg!.timingScope).toEqual({
        player: "both",
        period: "attack",
      });
    }
  );

  it("flash magic は flash reg のみ生成する (flash→stack 派生は廃止: 公式Q&A Q5)", () => {
    // フラッシュ効果はスタック効果ではない。スタックタイミングで使えるのは mode:"stack" の
    // スタック効果のみ。よって flash 効果から timing:"stack" reg を派生してはならない。
    const flashMagic: CardDefinition = {
      cardNo: "TEST-FLASH-REG",
      name: "テスト・フラッシュreg",
      printedCategory: "magic",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const regs = generateMagicRegistrations(flashMagic);
    expect(regs.map((r) => r.timing)).toEqual(["flash"]);
  });
});

// ============================================================
// engine gap fix の統合検証: スタック窓で C06 が使用可能になる
// ============================================================
// 〔アタックステップ〕のスタック窓で responder が C06 を use_magic できること、
// かつ timingScope によりアタックステップ以外では候補に出ないことを検証する。
describe("BSRK01-C06 スタック magic はアタックステップのスタック窓で使用可能", () => {
  const triggerSpirit: CardDefinition = {
    cardNo: "TEST-TRIGGER-SRC",
    name: "テスト誘発源",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  const targetSpirit: CardDefinition = {
    ...triggerSpirit,
    cardNo: "TEST-BOUNCE-TARGET",
    name: "テストバウンス対象",
    effects: [],
  };
  const c06 = card("BSRK01-C06");
  const defs = [triggerSpirit, targetSpirit, c06];
  const lookups = {
    getCardDefinitionById: (id: string) =>
      new Map(defs.map((d) => [d.cardNo, d])).get(id),
    getRegisteredMagicActions: buildMagicLookup(defs),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
    getRegisteredBurstActions: buildBurstEffectLookup(defs),
  };

  function openStackWindowAt(step: "attack" | "main"): GameState {
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(triggerSpirit, {
            instanceId: "alice-src",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpirit, {
            instanceId: "alice-target",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(c06, {
            instanceId: "bob-c06",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
        playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
      }),
      step,
      activePlayerId: "alice",
      pendingTriggeredEffects: [
        {
          pendingId: "trig-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:bsrk01-cards:5322",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "alice-src",
          amount: null,
          step,
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
    const aliceActions = getLegalActions({
      state: base,
      actingPlayerId: "alice",
      ...lookups,
    });
    const decl = aliceActions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    )!;
    const declared = applyLegalAction({
      state: base,
      action: decl,
      ...lookups,
    }).state;
    expect(declared.window).toBe("stack");
    expect(declared.stackWindow!.priorityPlayerId).toBe("bob");
    return declared;
  }

  it("アタックステップのスタック窓で bob は C06 を use_magic できる", () => {
    const windowState = openStackWindowAt("attack");
    const bobActions = getLegalActions({
      state: windowState,
      actingPlayerId: "bob",
      ...lookups,
    });
    const useC06 = bobActions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-c06"
    );
    expect(useC06).toBeDefined();
  });

  it("相手(alice)のメインステップのスタック窓では bob 視点で『相手の』main なので effect[1]({self=bob,main}) は不一致 → C06 は不使用", () => {
    // テキスト〔自分のメインステップ/お互いのアタックステップ〕は 2 effect 分割で
    // effect[1]={self,main}, effect[2]={both,attack}。
    // openStackWindowAt("main") は activePlayerId=alice なので step=main は alice の main。
    // bob から見ると「相手の main」 → effect[1]({self=bob,main}) は false。
    // effect[2]({both,attack}) は step=main なので false。
    // ⇒ verifier 反証どおり、main step 中の alice ターンで bob から C06 は legal でない。
    const windowState = openStackWindowAt("main");
    const bobActions = getLegalActions({
      state: windowState,
      actingPlayerId: "bob",
      ...lookups,
    });
    const useC06s = bobActions.filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-c06"
    );
    expect(useC06s).toHaveLength(0);
  });
});

// ============================================================
// ENGINE-attack-declaration-replacement-primitive: BSRK01-C05『龍咬閃』
// ============================================================
// 相手のアタック宣言 (preDeclarationStackWindow.kind==="attack") の最中にアタッカー自体を
// 差し替え、差し替え後の新アタックを自分の指定カードへ forced_block させる primitive の
// 実カード定義 (executeReplaceAttackDeclaration + confirmAttackDeclarationAsAction +
// maybeFinalizeDesignatedAttackAfterPendingReactions + confirmBlockDeclarationAsAction の
// 一連の合成) を、designated-attack-burst-finalization.test.ts と同じ低レベル API で検証する。
describe("BSRK01-C05『龍咬閃』replace_attack_declaration: アタッカー差し替え + forced blocker", () => {
  const ATTACKER_A = makeTestSpirit("TEST-C05-ATTACKER-A");
  const ATTACKER_B = makeTestSpirit("TEST-C05-ATTACKER-B");
  const KENSHIN = { ...makeTestSpirit("TEST-C05-KENSHIN"), name: "緋村 剣心" };
  const c05 = card("BSRK01-C05");
  const testCardMap = new Map<string, CardDefinition>([
    [ATTACKER_A.cardNo, ATTACKER_A],
    [ATTACKER_B.cardNo, ATTACKER_B],
    [KENSHIN.cardNo, KENSHIN],
    [c05.cardNo, c05],
  ]);
  const testGetCardDefinitionById = (id: string) => testCardMap.get(id);

  function buildAttackDeclaredState(): GameState {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["bob", "alice"] }),
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [
        createCardInstance(ATTACKER_A, {
          instanceId: "bob-attacker-a",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(ATTACKER_B, {
          instanceId: "bob-attacker-b",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(KENSHIN, {
          instanceId: "alice-kenshin",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      testGetCardDefinitionById
    );
    return useAttackAsAction({
      state: rebuilt,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-attacker-a",
      getCardDefinitionById: testGetCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
  }

  const replaceAction = c05.effects![1]!.steps[0]!.action;
  if (replaceAction.kind !== "replace_attack_declaration") {
    throw new Error(
      "BSRK01-C05 effects[1] は replace_attack_declaration のはず"
    );
  }

  it("スタック応答: 宣言前スタック窓の sourceInstanceId を新アタッカーへ差し替え、forced blocker を予約する", () => {
    const declared = buildAttackDeclaredState();
    expect(declared.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-attacker-a",
      actingPlayerId: "bob",
    });

    const stepCtx = createStepExecutionContext(declared);
    const replaced = executeReplaceAttackDeclaration(
      replaceAction,
      declared,
      "alice",
      "alice-c05-source",
      testGetCardDefinitionById,
      stepCtx,
      ["bob-attacker-b"]
    );

    expect(replaced.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-attacker-b",
      actingPlayerId: "bob",
      pendingForcedBlockerInstanceId: "alice-kenshin",
    });
  });

  it("宣言確定 → burst 待機解消 → forced_block 窓 → ブロック確定まで通すと、盤面は新アタッカーを剣心がブロックした状態になる", () => {
    const declared = buildAttackDeclaredState();
    const stepCtx = createStepExecutionContext(declared);
    const replaced = executeReplaceAttackDeclaration(
      replaceAction,
      declared,
      "alice",
      "alice-c05-source",
      testGetCardDefinitionById,
      stepCtx,
      ["bob-attacker-b"]
    );

    const afterPass = usePassPreDeclarationStackAsAction({
      state: replaced,
      actingPlayerId: "alice",
    });
    const confirmed = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: testGetCardDefinitionById }
    );

    // 元の宣言 (bob-attacker-a) はなかったものになり、bob-attacker-b が primaryEntity になる。
    const expectedAttackerEntityId = getAttackEntityId(
      confirmed.state,
      "bob-attacker-b"
    );
    expect(confirmed.state.activeAttack?.primaryEntityId).toBe(
      expectedAttackerEntityId
    );
    expect(confirmed.state.activeAttack?.forcedBlockerInstanceId).toBe(
      "alice-kenshin"
    );
    // bob-attacker-a は宣言に使われず、疲労もしていない。
    const attackerACard = confirmed.state.cardInstances.find(
      (c) => c.instanceId === "bob-attacker-a"
    );
    expect(attackerACard?.exhaustState).toBe("recovered");

    const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
      confirmed.state,
      { getCardDefinitionById: testGetCardDefinitionById }
    );
    expect(finalized.window).toBe("pre_declaration_stack");
    expect(finalized.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "alice-kenshin",
      actingPlayerId: "alice",
    });

    const blocked = confirmBlockDeclarationAsAction(
      finalized.preDeclarationStackWindow!,
      finalized,
      { getCardDefinitionById: testGetCardDefinitionById }
    );

    const expectedKenshinEntityId = getAttackEntityId(
      blocked.state,
      "alice-kenshin"
    );
    expect(blocked.blockerEntityId).toBe(expectedKenshinEntityId);
    expect(
      blocked.state.activeAttack?.blockAssignments.find(
        (assignment) =>
          assignment.participantEntityId === expectedAttackerEntityId
      )?.blockedByEntityIds
    ).toContain(expectedKenshinEntityId);
  });

  it("『可能なら』: 合法な新アタッカー候補が存在しない場合は no-op で元の宣言が維持される", () => {
    const declared = buildAttackDeclaredState();
    const stepCtx = createStepExecutionContext(declared);
    // bob-attacker-b を疲労させて「合法な差し替え候補なし」を作る。
    const noLegalCandidateState: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "bob-attacker-b"
          ? { ...c, exhaustState: "exhausted" as const }
          : c
      ),
    };
    const untouched = executeReplaceAttackDeclaration(
      replaceAction,
      noLegalCandidateState,
      "alice",
      "alice-c05-source",
      testGetCardDefinitionById,
      stepCtx,
      undefined // 対象選択パイプラインが合法候補なしで resolvedTargetIds を返さない場合を模す
    );
    expect(untouched).toBe(noLegalCandidateState);
    expect(untouched.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-attacker-a",
    });
    expect(
      untouched.preDeclarationStackWindow?.pendingForcedBlockerInstanceId
    ).toBeUndefined();
  });

  it("production dispatch: 相手のアタック宣言窓で alice は BSRK01-C05 を use_magic として選べる (getLegalActions)", () => {
    const declared = buildAttackDeclaredState();
    const stateWithC05InHand: GameState = {
      ...declared,
      cardInstances: [
        ...declared.cardInstances,
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const magicLookup = buildMagicLookup([
      ATTACKER_A,
      ATTACKER_B,
      KENSHIN,
      c05,
    ]);
    const aliceActions = getLegalActions({
      state: stateWithC05InHand,
      actingPlayerId: "alice",
      getCardDefinitionById: testGetCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
        ATTACKER_A,
        ATTACKER_B,
        KENSHIN,
        c05,
      ]),
    });
    const useC05 = aliceActions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "alice-c05"
    );
    expect(useC05).toBeDefined();
    expect(useC05).toMatchObject({ kind: "use_magic", timing: "stack" });
  });
});
